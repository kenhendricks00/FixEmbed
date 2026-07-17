"""Build a perspective-wall FixEmbed App Directory banner concept."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

from build_discovery_banner_concept import CANVAS, cover, gradient_background


WALL_SIZE = (1920, 1100)
CARD_SIZE = (600, 500)
GAP = 28
MARGIN_X = 32
MARGIN_Y = 36


def rounded_card(
    image: Image.Image,
    accent: tuple[int, int, int],
) -> Image.Image:
    card = cover(image, CARD_SIZE).convert("RGBA")
    card = ImageEnhance.Contrast(card).enhance(1.03)
    card = ImageEnhance.Sharpness(card).enhance(1.08)

    overlay = Image.new("RGBA", CARD_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle(
        (0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1),
        radius=22,
        outline=(*accent, 185),
        width=4,
    )
    draw.rounded_rectangle(
        (0, 18, 7, CARD_SIZE[1] - 18),
        radius=4,
        fill=(*accent, 245),
    )
    card.alpha_composite(overlay)

    mask = Image.new("L", CARD_SIZE, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1),
        radius=22,
        fill=255,
    )
    card.putalpha(mask)
    return card


def card_shadow(card: Image.Image) -> Image.Image:
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 255))
    shadow.putalpha(card.getchannel("A").point(lambda value: round(value * 0.72)))
    return shadow.filter(ImageFilter.GaussianBlur(18))


def build_wall(
    sources: tuple[Path, ...],
    colors: tuple[tuple[int, int, int], ...],
) -> Image.Image:
    wall = Image.new("RGBA", WALL_SIZE, (20, 22, 28, 255))
    wall_draw = ImageDraw.Draw(wall)

    for row in range(2):
        for column in range(3):
            index = row * 3 + column
            x = MARGIN_X + column * (CARD_SIZE[0] + GAP)
            y = MARGIN_Y + row * (CARD_SIZE[1] + GAP)

            color = colors[index]
            wall_draw.rounded_rectangle(
                (x - 10, y - 10, x + CARD_SIZE[0] + 10, y + CARD_SIZE[1] + 10),
                radius=28,
                fill=(13, 15, 20, 255),
            )

            card = rounded_card(Image.open(sources[index]).convert("RGB"), color)
            wall.alpha_composite(card_shadow(card), (x + 10, y + 14))
            wall.alpha_composite(card, (x, y))

    return wall


def perspective_coefficients(
    destination: tuple[tuple[float, float], ...],
    source: tuple[tuple[float, float], ...],
) -> tuple[float, ...]:
    matrix: list[list[float]] = []
    values: list[float] = []
    for (x, y), (u, v) in zip(destination, source, strict=True):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        values.extend((u, v))
    return tuple(np.linalg.solve(np.asarray(matrix), np.asarray(values)))


def perspective_wall(wall: Image.Image) -> Image.Image:
    width, height = WALL_SIZE
    source = (
        (0.0, 0.0),
        (float(width), 0.0),
        (float(width), float(height)),
        (0.0, float(height)),
    )
    destination = (
        (180.0, -150.0),
        (1710.0, 15.0),
        (1940.0, 720.0),
        (-140.0, 565.0),
    )
    coefficients = perspective_coefficients(destination, source)
    return wall.transform(
        CANVAS,
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def colored_glows() -> Image.Image:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    glows = (
        ((-90, 430, 310, 830), (45, 205, 255, 150)),
        ((80, 360, 520, 790), (225, 48, 108, 105)),
        ((1370, -190, 1880, 310), (82, 235, 150, 105)),
        ((1480, 260, 1990, 800), (255, 69, 0, 130)),
    )
    for bounds, color in glows:
        draw.ellipse(bounds, fill=color)
    return layer.filter(ImageFilter.GaussianBlur(115))


def edge_blur_mask() -> Image.Image:
    mask = Image.new("L", CANVAS, 0)
    pixels = mask.load()
    for y in range(CANVAS[1]):
        for x in range(CANVAS[0]):
            edge = min(x, CANVAS[0] - 1 - x, y, CANVAS[1] - 1 - y)
            pixels[x, y] = round(255 * max(0.0, 1 - edge / 115))
    return mask.filter(ImageFilter.GaussianBlur(18))


def edge_vignette() -> Image.Image:
    mask = Image.new("L", CANVAS, 255)
    pixels = mask.load()
    for y in range(CANVAS[1]):
        for x in range(CANVAS[0]):
            horizontal = min(1.0, min(x, CANVAS[0] - 1 - x) / 185)
            vertical = min(1.0, min(y, CANVAS[1] - 1 - y) / 110)
            pixels[x, y] = round(255 * min(horizontal, vertical))
    mask = mask.filter(ImageFilter.GaussianBlur(28))
    darkness = Image.new("RGBA", CANVAS, (0, 0, 0, 155))
    darkness.putalpha(ImageChops.invert(mask).point(lambda value: round(value * 0.62)))
    return darkness


def build(sources: tuple[Path, ...], output: Path) -> None:
    colors = (
        (225, 48, 108),  # Instagram
        (50, 165, 255),  # X / Twitter
        (230, 0, 35),  # Pinterest
        (0, 150, 235),  # Pixiv
        (255, 69, 0),  # Reddit
        (250, 90, 170),  # Threads
    )
    wall = build_wall(sources, colors)
    warped = perspective_wall(wall)

    canvas = gradient_background()
    canvas.alpha_composite(colored_glows())

    shadow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    shadow.putalpha(warped.getchannel("A").filter(ImageFilter.GaussianBlur(24)))
    canvas.alpha_composite(shadow, (12, 18))
    canvas.alpha_composite(warped)

    # Blur only the perimeter, preserving readable, high-resolution cards in
    # the center while matching the atmospheric falloff of the reference.
    blurred = canvas.filter(ImageFilter.GaussianBlur(8))
    canvas = Image.composite(blurred, canvas, edge_blur_mask())
    canvas.alpha_composite(edge_vignette())

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, quality=95, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instagram", type=Path)
    parser.add_argument("twitter", type=Path)
    parser.add_argument("pinterest", type=Path)
    parser.add_argument("pixiv", type=Path)
    parser.add_argument("reddit", type=Path)
    parser.add_argument("threads", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "assets/marketing/fixembed-discovery-banner-concept-v2.png"
        ),
    )
    args = parser.parse_args()
    build(
        (
            args.instagram,
            args.twitter,
            args.pinterest,
            args.pixiv,
            args.reddit,
            args.threads,
        ),
        args.output,
    )


if __name__ == "__main__":
    main()
