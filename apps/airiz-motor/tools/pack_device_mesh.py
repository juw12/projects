"""Pack the Ziris unit CAD mesh for the 3D device on the Motor control page.

    python apps/airiz-motor/tools/pack_device_mesh.py <path to ziris_unit_mesh.json>

Input: the packed unit mesh that the PTB FA Simulation builds from the STEP files
(unit3d/ziris_unit_mesh.json, three CAD versions). It is NOT in this repo.
Output: web/data/device-mesh.js (one CAD version, parts merged by how they move and by category).
The output is git-ignored: this repo is public, the CAD is not. Without it the page keeps the drawn picture.

How the parts move (read from the CAD, version EV2 2026-11-06):
  base      fixed: housing, fabric, speaker box, rising motor + gears, motor bracket, nut case
  carriage  rises with the lead-screw nut: nut, nut bracket, 2 guide poles, pan motor
  head      rises and pans about the lead-screw axis: camera head + big pan gear
  screw     lead screw: turns in place while the camera rises
  pinion    pan motor pinion: rises, and spins on its own axis while the head pans
Requires: numpy
"""
import base64
import gzip
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parent / "web" / "data" / "device-mesh.js"
CAD_VERSION = "ev2"
STEP_MM = 0.01  # int16 grid: +-327 mm, far finer than one screen pixel
BIG_PAN_GEAR = "ZIRIS_PAN_GEAR_BIG"
PAN_PINION = "AIO-160_E_GEAR1_9"
# The camera window parts stay solid in the X-ray view, so the eye finds the lens while the head pans.
CAMERA_PARTS = ("MTKS260161H_ZIRIS_CAMERA_CAP", "ZIRIS_HOMEKIT_LENS", "AIO_160_G_CMAERA_RUBBER")
GEAR_MODULE_MM = 0.5  # assumed tooth module, only used for the pinion spin ratio
LEAD_MM = 1.0  # lead-screw travel per turn: same design input as the PTB FA Simulation


def skipped(part, name):
    # Shipping films cover the head; the knurled brass inserts are 35k triangles nobody sees at this size.
    return "PROTECT_FILM" in name or part["cat"] == "insert"


def group_of(part, name):
    if part["cat"] == "screw":
        return "screw"
    if name.startswith(PAN_PINION):
        return "pinion"
    if part["cat"] == "head" or name.startswith(BIG_PAN_GEAR):
        return "head"
    return "carriage" if part["moving"] else "base"


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    unit = json.loads(source.read_text(encoding="utf-8"))
    meta = unit["meta"]
    buffer = gzip.decompress(base64.b64decode(unit["bin"]))
    centre = np.array(meta["center"])
    version = next(v for v in meta["versions"] if v["id"] == CAD_VERSION)

    def arrays(mesh):
        positions = np.frombuffer(buffer, dtype=np.int16, count=mesh["vn"] * 3, offset=mesh["po"]).reshape(-1, 3)
        index_type = np.uint32 if mesh["wide"] else np.uint16
        triangles = np.frombuffer(buffer, dtype=index_type, count=mesh["tn"] * 3, offset=mesh["io"]).reshape(-1, 3)
        return positions * meta["scale"] + centre, triangles.astype(np.int64)

    batches = {}
    pinion_axis = None
    big_gear_radius = None
    for part in version["parts"]:
        mesh = meta["meshes"][part["m"]]
        name = mesh["name"]
        if skipped(part, name):
            continue
        vertices, triangles = arrays(mesh)
        if name.startswith(PAN_PINION):
            pinion_axis = [float((vertices[:, a].min() + vertices[:, a].max()) / 2) for a in (0, 2)]
        if name.startswith(BIG_PAN_GEAR):
            big_gear_radius = float(np.hypot(vertices[:, 0], vertices[:, 2]).max())
        category = part["cat"]
        if name.startswith((BIG_PAN_GEAR, PAN_PINION)):
            category = "panGear"
        elif name.startswith(CAMERA_PARTS):
            category = "camera"
        key = (group_of(part, name), category)
        batch = batches.setdefault(key, {"vertices": [], "triangles": [], "count": 0})
        batch["triangles"].append(triangles + batch["count"])
        batch["vertices"].append(vertices)
        batch["count"] += len(vertices)

    # Pan gear pair: pitch radius of the big gear = tip radius - one module; the pinion takes the rest
    # of the centre distance. Ratio = pinion turns per head turn (approximate, for the animation only).
    centre_distance = float(np.hypot(*pinion_axis))
    big_pitch = big_gear_radius - GEAR_MODULE_MM
    pinion_ratio = big_pitch / (centre_distance - big_pitch)

    chunks = []
    offset = 0
    parts = []
    low = np.full(3, np.inf)
    high = np.full(3, -np.inf)
    for (group, category), batch in sorted(batches.items()):
        vertices = np.concatenate(batch["vertices"])
        triangles = np.concatenate(batch["triangles"])
        low = np.minimum(low, vertices.min(axis=0))
        high = np.maximum(high, vertices.max(axis=0))
        wide = len(vertices) > 65535
        position_bytes = np.round((vertices - centre) / STEP_MM).astype(np.int16).tobytes()
        index_bytes = triangles.astype(np.uint32 if wide else np.uint16).tobytes()
        entry = {"group": group, "cat": category, "vn": len(vertices), "tn": len(triangles), "wide": wide,
                 "centroid": [round(float(v), 2) for v in vertices.mean(axis=0)]}
        for field, data in (("po", position_bytes), ("io", index_bytes)):
            padding = -offset % 4
            chunks.append(b"\0" * padding)
            offset += padding
            entry[field] = offset
            chunks.append(data)
            offset += len(data)
        parts.append(entry)

    payload = {
        "meta": {
            "cad": "EV2 2026-11-06",
            "scale": STEP_MM,
            "center": [float(v) for v in centre],
            "bbox": [[round(float(v), 2) for v in low], [round(float(v), 2) for v in high]],
            "strokeMm": float(meta["stroke"]),
            "leadMm": LEAD_MM,
            "pinion": {"axis": [round(v, 3) for v in pinion_axis], "ratio": round(pinion_ratio, 2)},
            "parts": parts,
        },
        "bin": base64.b64encode(gzip.compress(b"".join(chunks), 9, mtime=0)).decode("ascii"),
    }
    OUTPUT.write_text(
        "/* Generated by apps/airiz-motor/tools/pack_device_mesh.py from the Ziris unit CAD (EV2). Do not edit by hand. */\n"
        "window.AIRIZ_DEVICE_MESH = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    triangle_total = sum(part["tn"] for part in parts)
    print(f"{OUTPUT}: {len(parts)} batches, {triangle_total} triangles, {OUTPUT.stat().st_size / 1e6:.2f} MB, "
          f"pinion axis {payload['meta']['pinion']}")
    for part in parts:
        print(f"  {part['group']:9s} {part['cat']:13s} {part['tn']:6d} triangles")


if __name__ == "__main__":
    main()
