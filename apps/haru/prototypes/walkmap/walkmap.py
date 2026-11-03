"""Haru walk-map prototype.

Simulates a month of noisy GPS walks over a synthetic street network,
map-matches each fix to a road segment, accumulates visit counts and
"pioneered" distance, and renders the PlainWalk-style blank map.

Usage:
    python walkmap.py --days 30 --out output
"""

import argparse
import json
import math
from pathlib import Path

import networkx as nx
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.spatial import cKDTree

PAPER = (250, 246, 236)
FAINT_GRID = (238, 232, 218)
INK = (58, 50, 64)
PIONEER = (232, 120, 84)
SPOT = (90, 150, 200)


def build_city(seed=3, size=40, spacing=60.0):
    """Jittered grid with missing blocks and a few diagonal avenues (meters)."""
    rng = np.random.default_rng(seed)
    graph = nx.Graph()
    for row in range(size):
        for col in range(size):
            jitter = rng.normal(0, spacing * 0.12, 2)
            graph.add_node((row, col), pos=(col * spacing + jitter[0], row * spacing + jitter[1]))
    for row in range(size):
        for col in range(size):
            for d_row, d_col in [(0, 1), (1, 0)]:
                neighbor = (row + d_row, col + d_col)
                if neighbor in graph and rng.random() > 0.12:
                    graph.add_edge((row, col), neighbor)
    for start in [(0, 5), (8, 0), (0, 22)]:
        row, col = start
        while (row + 1, col + 1) in graph:
            graph.add_edge((row, col), (row + 1, col + 1))
            row, col = row + 1, col + 1
    for u, v in graph.edges:
        graph.edges[u, v]["length"] = math.dist(graph.nodes[u]["pos"], graph.nodes[v]["pos"])
    largest = max(nx.connected_components(graph), key=len)
    return graph.subgraph(largest).copy()


def simulate_walk(graph, rng, home, daily_targets, noise_m=6.0, fix_spacing_m=5.0):
    """Shortest-path walk home -> random stops -> home, sampled as noisy GPS fixes."""
    nodes = list(graph.nodes)
    stops = [home] + [nodes[i] for i in rng.choice(len(nodes), daily_targets)] + [home]
    path = []
    for start, end in zip(stops, stops[1:]):
        leg = nx.shortest_path(graph, start, end, weight="length")
        path.extend(leg if not path else leg[1:])
    fixes = []
    for u, v in zip(path, path[1:]):
        a = np.array(graph.nodes[u]["pos"])
        b = np.array(graph.nodes[v]["pos"])
        steps = max(1, int(np.linalg.norm(b - a) / fix_spacing_m))
        for t in np.linspace(0, 1, steps, endpoint=False):
            fixes.append(a + (b - a) * t + rng.normal(0, noise_m, 2))
    return np.array(fixes)


class SegmentMatcher:
    """Snap GPS fixes to nearest road segment using sampled points + KD-tree.

    A segment only counts as walked when matched fixes cover enough of its
    length; this stops GPS jitter at intersections from painting stubs on
    side streets the user never entered.
    """

    COVERAGE_BINS = 10

    def __init__(self, graph, sample_m=4.0):
        self.graph = graph
        points, owners, positions = [], [], []
        self.edges = list(graph.edges)
        for index, (u, v) in enumerate(self.edges):
            a = np.array(graph.nodes[u]["pos"])
            b = np.array(graph.nodes[v]["pos"])
            count = max(2, int(np.linalg.norm(b - a) / sample_m))
            for t in np.linspace(0, 1, count):
                points.append(a + (b - a) * t)
                owners.append(index)
                positions.append(t)
        self.tree = cKDTree(np.array(points))
        self.owners = np.array(owners)
        self.canonical = {frozenset(edge): edge for edge in self.edges}
        self.bins = np.minimum((np.array(positions) * self.COVERAGE_BINS).astype(int), self.COVERAGE_BINS - 1)

    def match(self, fixes, max_distance_m=20.0, min_coverage=0.6, fill_gaps=True):
        distances, indices = self.tree.query(fixes)
        near = distances < max_distance_m
        hit = indices[near]
        edge_bin_pairs = np.unique(np.stack([self.owners[hit], self.bins[hit]], axis=1), axis=0)
        edge_ids, covered_bins = np.unique(edge_bin_pairs[:, 0], return_counts=True)
        coverage = covered_bins / self.COVERAGE_BINS
        confirmed = {int(e) for e, c in zip(edge_ids, coverage) if c >= min_coverage}
        matched = {self.edges[e] for e in confirmed}
        if fill_gaps:
            matched |= self._fill_gaps(fixes, indices, near, confirmed)
        return matched

    def _fill_gaps(self, fixes, indices, near, confirmed, slack_m=30.0):
        """Connect consecutive confirmed segments (in walk order) via the
        shortest road path, if that path is plausible given the GPS distance
        travelled between them."""
        sequence = []  # (edge index, fix index) in time order, deduplicated
        for fix_index in np.flatnonzero(near):
            edge = int(self.owners[indices[fix_index]])
            if edge in confirmed and (not sequence or sequence[-1][0] != edge):
                sequence.append((edge, fix_index))
        step_lengths = np.concatenate([[0.0], np.linalg.norm(np.diff(fixes, axis=0), axis=1)])
        travelled = np.cumsum(step_lengths)
        filled = set()
        for (edge_a, fix_a), (edge_b, fix_b) in zip(sequence, sequence[1:]):
            ends_a = set(self.edges[edge_a])
            ends_b = set(self.edges[edge_b])
            if ends_a & ends_b:
                continue
            gps_distance = travelled[fix_b] - travelled[fix_a]
            best_path, best_length = None, math.inf
            for source in ends_a:
                for target in ends_b:
                    try:
                        length, path = nx.single_source_dijkstra(
                            self.graph, source, target, cutoff=gps_distance + slack_m, weight="length"
                        )
                    except nx.NetworkXNoPath:
                        continue
                    if length < best_length:
                        best_path, best_length = path, length
            if best_path:
                filled |= {tuple(edge) for edge in zip(best_path, best_path[1:])}
        # Store edges in the same orientation as self.edges so counts don't split.
        return {self.canonical[frozenset(edge)] for edge in filled}


def render(graph, visits, first_day, spots, day, scale=0.5, margin=40, show_city=False):
    xs = [p[0] for _, p in graph.nodes(data="pos")]
    ys = [p[1] for _, p in graph.nodes(data="pos")]
    width = int((max(xs) - min(xs)) * scale) + 2 * margin
    height = int((max(ys) - min(ys)) * scale) + 2 * margin

    def to_px(pos):
        return (
            (pos[0] - min(xs)) * scale + margin,
            (pos[1] - min(ys)) * scale + margin,
        )

    canvas = Image.new("RGB", (width, height), PAPER)
    draw = ImageDraw.Draw(canvas)
    if show_city:
        for u, v in graph.edges:
            draw.line([to_px(graph.nodes[u]["pos"]), to_px(graph.nodes[v]["pos"])], fill=FAINT_GRID, width=2)
    max_visits = max(visits.values()) if visits else 1
    for (u, v), count in sorted(visits.items(), key=lambda item: item[1]):
        strength = math.log1p(count) / math.log1p(max_visits)
        line_width = int(2 + 7 * strength)
        shade = tuple(int(PAPER[c] + (INK[c] - PAPER[c]) * (0.35 + 0.65 * strength)) for c in range(3))
        color = PIONEER if first_day[(u, v)] == day else shade
        draw.line([to_px(graph.nodes[u]["pos"]), to_px(graph.nodes[v]["pos"])], fill=color, width=line_width, joint="curve")
    for spot in spots:
        x, y = to_px(spot)
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill=SPOT, outline=INK, width=2)
    return canvas.filter(ImageFilter.SMOOTH)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", default="output")
    arguments = parser.parse_args()
    output = Path(arguments.out)
    output.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(11)
    graph = build_city()
    matcher = SegmentMatcher(graph)
    home = min(graph.nodes, key=lambda n: math.dist(graph.nodes[n]["pos"], (1100, 1100)))
    total_road_m = sum(length for _, _, length in graph.edges(data="length"))

    visits, first_day, spots, stats = {}, {}, [], []
    for day in range(1, arguments.days + 1):
        fixes = simulate_walk(graph, rng, home, daily_targets=int(rng.integers(1, 4)))
        matched = matcher.match(fixes)
        pioneered_m = 0.0
        for edge in matched:
            if edge not in visits:
                first_day[edge] = day
                pioneered_m += graph.edges[edge]["length"]
            visits[edge] = visits.get(edge, 0) + 1
        if rng.random() < 0.4:
            spots.append(tuple(fixes[int(rng.integers(len(fixes)))]))
        explored_m = sum(graph.edges[e]["length"] for e in visits)
        walked_m = float(np.sum(np.linalg.norm(np.diff(fixes, axis=0), axis=1)))
        stats.append({
            "day": day,
            "gps_fixes": len(fixes),
            "walked_km_raw_gps": round(walked_m / 1000, 2),
            "pioneered_km": round(pioneered_m / 1000, 2),
            "explored_km_total": round(explored_m / 1000, 2),
            "city_explored_pct": round(100 * explored_m / total_road_m, 1),
        })
        if day in (1, 7, arguments.days):
            render(graph, visits, first_day, spots, day).save(output / f"map_day{day:02d}.png")

    render(graph, visits, first_day, spots, arguments.days, show_city=True).save(output / "map_overlay.png")
    (output / "stats.json").write_text(json.dumps(stats, indent=2))
    print(json.dumps(stats[-1], indent=2))


if __name__ == "__main__":
    main()
