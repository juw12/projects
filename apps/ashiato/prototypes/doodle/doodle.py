"""Ashiato doodle prototype: photo -> hand-drawn style image.

Classic image-processing pipeline (no ML) used to explore the art direction
and to serve as a baseline before training a Core ML style model.

Usage:
    python doodle.py input.jpg output.png --style crayon
"""

import argparse
import time

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from scipy import ndimage

PAPER_COLOR = np.array([250, 246, 236], dtype=np.float32)
INK_COLOR = np.array([58, 50, 64], dtype=np.float32)
WORKING_SIZE = 512


def _resize(image, size=WORKING_SIZE):
    image = image.convert("RGB")
    scale = size / max(image.size)
    new_size = (round(image.width * scale), round(image.height * scale))
    return image.resize(new_size, Image.LANCZOS)


def _noise(shape, sigma, rng):
    field = rng.standard_normal(shape).astype(np.float32)
    field = ndimage.gaussian_filter(field, sigma)
    field -= field.min()
    field /= field.max() + 1e-6
    return field


def _wobble(array, strength, rng):
    """Displace pixels with smooth noise so lines look hand drawn."""
    height, width = array.shape[:2]
    dx = (_noise((height, width), 12, rng) - 0.5) * 2 * strength
    dy = (_noise((height, width), 12, rng) - 0.5) * 2 * strength
    rows, cols = np.mgrid[0:height, 0:width].astype(np.float32)
    coords = [rows + dy, cols + dx]
    if array.ndim == 2:
        return ndimage.map_coordinates(array, coords, order=1, mode="nearest")
    channels = [
        ndimage.map_coordinates(array[..., c], coords, order=1, mode="nearest")
        for c in range(array.shape[2])
    ]
    return np.stack(channels, axis=-1)


def _flat_colors(image, palette_size):
    """Smooth and posterize the photo into a few friendly colors."""
    smoothed = image
    for _ in range(3):
        smoothed = smoothed.filter(ImageFilter.MedianFilter(5))
    smoothed = ImageEnhance.Color(smoothed).enhance(1.35)
    quantized = smoothed.quantize(colors=palette_size, method=Image.Quantize.MEDIANCUT)
    flat = np.asarray(quantized.convert("RGB"), dtype=np.float32)
    # Pastel shift toward paper so colors feel like crayon, not photo.
    return flat * 0.82 + PAPER_COLOR * 0.18


def _outline(image, threshold, thickness):
    """Extended difference-of-Gaussians edge mask (0 = no line, 1 = line)."""
    gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
    gray = ndimage.median_filter(gray, 5)
    blur_small = ndimage.gaussian_filter(gray, 1.2)
    blur_large = ndimage.gaussian_filter(gray, 1.2 * 1.8)
    dog = blur_small - 0.98 * blur_large
    lines = (dog < -threshold).astype(np.float32)
    lines = ndimage.binary_opening(lines > 0, iterations=1).astype(np.float32)
    # Remove tiny specks so only meaningful contours remain.
    labels, count = ndimage.label(lines > 0)
    if count:
        sizes = ndimage.sum(lines > 0, labels, range(1, count + 1))
        keep = np.isin(labels, np.where(sizes >= 25)[0] + 1)
        lines = keep.astype(np.float32)
    if thickness > 1:
        lines = ndimage.grey_dilation(lines, size=(thickness, thickness))
    return ndimage.gaussian_filter(lines, 0.6)


def _stroke_texture(shape, angle_degrees, rng):
    """Directional streaks that imitate crayon or pencil strokes."""
    base = rng.random(shape).astype(np.float32)
    streaks = ndimage.rotate(base, angle_degrees, reshape=False, mode="wrap")
    streaks = ndimage.uniform_filter1d(streaks, size=15, axis=1)
    streaks = ndimage.rotate(streaks, -angle_degrees, reshape=False, mode="wrap")
    streaks -= streaks.min()
    streaks /= streaks.max() + 1e-6
    return streaks


def doodle(photo, style="crayon", seed=7):
    rng = np.random.default_rng(seed)
    image = _resize(photo)
    height, width = image.height, image.width
    paper = np.ones((height, width, 3), dtype=np.float32) * PAPER_COLOR
    grain = _noise((height, width), 0.8, rng)

    if style == "crayon":
        colors = _wobble(_flat_colors(image, 8), 3.0, rng)
        strokes = _stroke_texture((height, width), 35, rng)
        coverage = np.clip(0.55 + 0.6 * strokes - 0.25 * grain, 0, 1)[..., None]
        canvas = paper * (1 - coverage) + colors * coverage
        lines = _wobble(_outline(image, 0.012, 3), 1.5, rng)
        ink_strength = (lines * (0.75 + 0.25 * grain))[..., None]
        canvas = canvas * (1 - ink_strength) + INK_COLOR * ink_strength

    elif style == "pencil":
        gray = np.asarray(image.convert("L"), dtype=np.float32) / 255.0
        gray = ndimage.gaussian_filter(gray, 1.0)
        hatch_a = _stroke_texture((height, width), 45, rng)
        hatch_b = _stroke_texture((height, width), -45, rng)
        shade = np.clip((0.75 - gray) * 1.6, 0, 1)
        darkness = shade * (0.55 * hatch_a + 0.45 * (hatch_b * (shade > 0.5)))
        lines = _wobble(_outline(image, 0.010, 2), 1.2, rng)
        darkness = np.clip(darkness + lines * 0.9, 0, 1)[..., None]
        graphite = np.array([70, 70, 80], dtype=np.float32)
        canvas = paper * (1 - darkness) + graphite * darkness

    elif style == "watercolor":
        colors = _flat_colors(image, 10)
        colors = np.stack(
            [ndimage.gaussian_filter(colors[..., c], 2.5) for c in range(3)], axis=-1
        )
        colors = _wobble(colors, 6.0, rng)
        bloom = _noise((height, width), 6, rng)
        coverage = np.clip(0.55 + 0.45 * bloom, 0, 1)[..., None]
        canvas = paper * (1 - coverage) + colors * coverage
        # Darker pigment pooling at the edges of color regions.
        edges = ndimage.gaussian_gradient_magnitude(colors.mean(axis=2), 1.5)
        edges = np.clip(edges / (edges.max() + 1e-6) * 2.0, 0, 1)[..., None]
        canvas = canvas * (1 - 0.25 * edges)
        lines = _wobble(_outline(image, 0.016, 1), 2.0, rng)[..., None]
        canvas = canvas * (1 - 0.5 * lines) + INK_COLOR * 0.5 * lines

    else:
        raise ValueError(f"Unknown style: {style}")

    canvas *= (0.94 + 0.06 * grain)[..., None]
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--style", default="crayon", choices=["crayon", "pencil", "watercolor"])
    arguments = parser.parse_args()
    start = time.perf_counter()
    result = doodle(Image.open(arguments.input), arguments.style)
    result.save(arguments.output)
    print(f"{arguments.style}: {time.perf_counter() - start:.2f} s -> {arguments.output}")


if __name__ == "__main__":
    main()
