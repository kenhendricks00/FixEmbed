"""Build a high-resolution cascading FixEmbed App Directory banner concept."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


CANVAS = (1800, 600)
CARD_SIZE = (520, 690)
BACKGROUND_TOP = (7, 9, 17)
BACKGROUND_BOTTOM = (15, 18, 34)


def gradient_background() -> Image.Image:
    image = Image.new("RGB", CANVAS)
    pixels = image.load()
    for y in range(CANVAS[1]):
        blend = y / (CANVAS[1] - 1)
        for x in range(CANVAS[0]):
            center_glow = max(0.0, 1 - math.dist((x, y), (900, 250)) / 980)
            pixels[x, y] = tuple(
                round(
                    BACKGROUND_TOP[channel] * (1 - blend)
                    + BACKGROUND_BOTTOM[channel] * blend
                    + center_glow * (8 if channel == 2 else 2)
                )
                for channel in range(3)
            )
    return image.convert("RGBA")


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize(
        (round(image.width * ratio), round(image.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def rounded_card(image: Image.Image, accent: tuple[int, int, int]) -> Image.Image:
    card = cover(image, CARD_SIZE).convert("RGBA")
    card = ImageEnhance.Contrast(card).enhance(1.03)
    card = ImageEnhance.Sharpness(card).enhance(1.08)

    accent_layer = Image.new("RGBA", CARD_SIZE, (0, 0, 0, 0))
    accent_draw = ImageDraw.Draw(accent_layer)
    accent_draw.rounded_rectangle(
        (0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1),
        radius=22,
        outline=(*accent, 220),
        width=4,
    )
    accent_draw.rounded_rectangle(
        (0, 18, 7, CARD_SIZE[1] - 18),
        radius=4,
        fill=(*accent, 255),
    )
    card.alpha_composite(accent_layer)

    mask = Image.new("L", CARD_SIZE, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, CARD_SIZE[0] - 1, CARD_SIZE[1] - 1),
        radius=22,
        fill=255,
    )
    card.putalpha(mask)
    return card


def glow_layer(
    position: tuple[int, int],
    color: tuple[int, int, int],
    *,
    radius: int = 170,
) -> Image.Image:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    x, y = position
    draw.ellipse(
        (x - radius, y - radius, x + radius, y + radius),
        fill=(*color, 145),
    )
    return layer.filter(ImageFilter.GaussianBlur(radius // 2))


def rotated_card(
    image: Image.Image,
    accent: tuple[int, int, int],
    angle: float,
) -> Image.Image:
    card = rounded_card(image, accent)
    return card.rotate(
        angle,
        resample=Image.Resampling.BICUBIC,
        expand=True,
        fillcolor=(0, 0, 0, 0),
    )


def card_shadow(card: Image.Image) -> Image.Image:
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    shadow.putalpha(card.getchannel("A").point(lambda value: round(value * 0.75)))
    black = Image.new("RGBA", card.size, (0, 0, 0, 255))
    black.putalpha(shadow.getchannel("A"))
    return black.filter(ImageFilter.GaussianBlur(24))


def edge_vignette() -> Image.Image:
    mask = Image.new("L", CANVAS, 255)
    pixels = mask.load()
    for y in range(CANVAS[1]):
        for x in range(CANVAS[0]):
            horizontal = min(1.0, min(x, CANVAS[0] - 1 - x) / 150)
            vertical = min(1.0, min(y, CANVAS[1] - 1 - y) / 95)
            pixels[x, y] = round(255 * min(horizontal, vertical))
    mask = mask.filter(ImageFilter.GaussianBlur(28))
    darkness = Image.new("RGBA", CANVAS, (0, 0, 0, 155))
    darkness.putalpha(ImageChops.invert(mask).point(lambda value: round(value * 0.7)))
    return darkness


def build(
    sources: tuple[Path, Path, Path, Path],
    output: Path,
) -> None:
    colors = (
        (225, 48, 108),  # Instagram
        (255, 69, 0),  # Reddit
        (50, 165, 255),  # X / Twitter
        (230, 0, 35),  # Pinterest
    )
    angles = (-5.5, -2.0, 2.0, 5.5)
    positions = ((-80, -20), (350, -80), (790, -40), (1230, -85))

    source_images = tuple(Image.open(path).convert("RGB") for path in sources)
    cards = tuple(
        rotated_card(image, color, angle)
        for image, color, angle in zip(source_images, colors, angles, strict=True)
    )

    canvas = gradient_background()
    for (x, y), color in zip(positions, colors, strict=True):
        canvas.alpha_composite(glow_layer((x + 280, y + 340), color))

    # Soft, oversized silhouettes create the old banner's colored depth without
    # sacrificing the clarity of the foreground card captures.
    for card, (x, y) in zip(cards, positions, strict=True):
        blurred = card.resize(
            (round(card.width * 1.08), round(card.height * 1.08)),
            Image.Resampling.BICUBIC,
        ).filter(ImageFilter.GaussianBlur(26))
        blurred.putalpha(
            blurred.getchannel("A").point(lambda value: round(value * 0.28))
        )
        canvas.alpha_composite(blurred, (x - 20, y - 18))

    for card, (x, y) in zip(cards, positions, strict=True):
        canvas.alpha_composite(card_shadow(card), (x + 16, y + 22))
        canvas.alpha_composite(card, (x, y))

    canvas.alpha_composite(edge_vignette())
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, quality=95, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instagram", type=Path)
    parser.add_argument("reddit", type=Path)
    parser.add_argument("twitter", type=Path)
    parser.add_argument("pinterest", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "assets/marketing/fixembed-discovery-banner-concept-v1.png"
        ),
    )
    args = parser.parse_args()
    build(
        (args.instagram, args.reddit, args.twitter, args.pinterest),
        args.output,
    )


if __name__ == "__main__":
    main()
