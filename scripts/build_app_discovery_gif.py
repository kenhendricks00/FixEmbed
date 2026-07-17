"""Build FixEmbed's Discord App Directory before-and-after promo animation."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


CANVAS = (960, 540)
BACKGROUND_TOP = (7, 9, 17)
BACKGROUND_BOTTOM = (18, 20, 38)
WHITE = (242, 244, 251)
MUTED = (168, 174, 194)
BLURPLE = (88, 101, 242)
CYAN = (62, 207, 255)


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    family = "seguisb.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(f"C:/Windows/Fonts/{family}", size)


def ease(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def cover(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize(
        (round(image.width * ratio), round(image.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    ratio = min(size[0] / image.width, size[1] / image.height)
    return image.resize(
        (round(image.width * ratio), round(image.height * ratio)),
        Image.Resampling.LANCZOS,
    )


def rounded_image(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1),
        radius=radius,
        fill=255,
    )
    result = image.convert("RGBA")
    result.putalpha(mask)
    return result


def background() -> Image.Image:
    frame = Image.new("RGB", CANVAS)
    pixels = frame.load()
    for y in range(CANVAS[1]):
        blend = y / (CANVAS[1] - 1)
        for x in range(CANVAS[0]):
            glow = max(0.0, 1 - math.dist((x, y), (790, 45)) / 560)
            pixels[x, y] = tuple(
                min(
                    255,
                    round(
                        BACKGROUND_TOP[channel] * (1 - blend)
                        + BACKGROUND_BOTTOM[channel] * blend
                        + glow * (18 if channel == 2 else 5)
                    ),
                )
                for channel in range(3)
            )
    return frame.convert("RGBA")


def paste_with_alpha(
    base: Image.Image,
    layer: Image.Image,
    position: tuple[int, int],
    alpha: float,
) -> None:
    alpha = max(0.0, min(1.0, alpha))
    if alpha == 0:
        return
    visible = layer.copy().convert("RGBA")
    visible.putalpha(visible.getchannel("A").point(lambda value: round(value * alpha)))
    base.alpha_composite(visible, position)


def draw_brand(frame: Image.Image, logo: Image.Image) -> None:
    frame.alpha_composite(logo, (38, 32))
    draw = ImageDraw.Draw(frame)
    draw.text((102, 37), "FixEmbed", font=font(28, bold=True), fill=WHITE)
    draw.text((103, 71), "BEFORE  /  AFTER", font=font(12, bold=True), fill=CYAN)


def before_scene(frame: Image.Image, before: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.text((70, 155), "A link shouldn’t look like this.", font=font(38, bold=True), fill=WHITE)
    draw.text((71, 207), "Discord sees the URL—but none of the story.", font=font(20), fill=MUTED)
    draw.rounded_rectangle((65, 278, 895, 397), radius=18, fill=(18, 20, 28, 245))
    draw.rounded_rectangle((65, 278, 71, 397), radius=3, fill=BLURPLE)
    before_fit = contain(before, (785, 88)).convert("RGBA")
    layer.alpha_composite(before_fit, (91, 294))
    draw.text((70, 452), "BEFORE", font=font(15, bold=True), fill=(132, 138, 158))
    paste_with_alpha(frame, layer, (0, 0), alpha)


def after_scene(frame: Image.Image, after: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    card = contain(after, (520, 476))
    card = rounded_image(card, 14)
    shadow = Image.new("RGBA", (card.width + 42, card.height + 42), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (21, 21, card.width + 20, card.height + 20),
        radius=18,
        fill=(0, 0, 0, 160),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    layer.alpha_composite(shadow, (9, 27))
    layer.alpha_composite(card, (30, 48))

    draw.text((590, 112), "Then FixEmbed", font=font(35, bold=True), fill=WHITE)
    draw.text((590, 156), "brings it to life.", font=font(35, bold=True), fill=CYAN)
    benefits = (
        "Playable media",
        "Quote post context",
        "Real engagement stats",
        "Creator and source links",
    )
    for index, benefit in enumerate(benefits):
        y = 248 + index * 48
        draw.ellipse((592, y + 7, 604, y + 19), fill=BLURPLE)
        draw.text((620, y), benefit, font=font(20), fill=WHITE)
    draw.text((590, 459), "AFTER", font=font(15, bold=True), fill=CYAN)
    draw.text((590, 485), "One link. The whole post.", font=font(19, bold=True), fill=MUTED)
    paste_with_alpha(frame, layer, (0, 0), alpha)


def transition_scene(frame: Image.Image, logo: Image.Image, progress: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    opacity = math.sin(progress * math.pi)
    pulse = 1 + math.sin(progress * math.pi) * 0.16
    size = round(88 * pulse)
    icon = logo.resize((size, size), Image.Resampling.LANCZOS)
    x = (CANVAS[0] - size) // 2
    y = (CANVAS[1] - size) // 2
    glow = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((x - 30, y - 30, x + size + 30, y + size + 30), fill=(88, 101, 242, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(24))
    layer.alpha_composite(glow)
    layer.alpha_composite(icon, (x, y))
    line_width = round(310 * ease(progress))
    draw.rounded_rectangle(
        ((CANVAS[0] - line_width) // 2, y + size + 34, (CANVAS[0] + line_width) // 2, y + size + 39),
        radius=3,
        fill=CYAN,
    )
    paste_with_alpha(frame, layer, (0, 0), opacity)


def build(source: Path, logo_path: Path, output: Path, poster: Path) -> None:
    screenshot = Image.open(source).convert("RGB")
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((52, 52), Image.Resampling.LANCZOS)

    # Real Discord capture: original URL above the matching FixEmbed Components V2 card.
    before = screenshot.crop((390, 112, 1080, 192))
    after = screenshot.crop((390, 182, 1082, 846))
    before = ImageEnhance.Contrast(before).enhance(1.04)
    after = ImageEnhance.Contrast(after).enhance(1.04)

    base = background()
    frames: list[Image.Image] = []
    durations: list[int] = []

    for _ in range(14):
        frame = base.copy()
        draw_brand(frame, logo)
        before_scene(frame, before, 1)
        frames.append(frame.convert("RGB"))
        durations.append(110)

    for index in range(10):
        progress = index / 9
        frame = base.copy()
        draw_brand(frame, logo)
        if index < 5:
            before_scene(frame, before, 1 - ease(index / 4))
        else:
            after_scene(frame, after, ease((index - 5) / 4))
        transition_scene(frame, logo, progress)
        frames.append(frame.convert("RGB"))
        durations.append(80)

    for _ in range(22):
        frame = base.copy()
        draw_brand(frame, logo)
        after_scene(frame, after, 1)
        frames.append(frame.convert("RGB"))
        durations.append(110)

    for index in range(8):
        progress = index / 7
        frame = base.copy()
        draw_brand(frame, logo)
        if index < 4:
            after_scene(frame, after, 1 - ease(index / 3))
        else:
            before_scene(frame, before, ease((index - 4) / 3))
        transition_scene(frame, logo, progress)
        frames.append(frame.convert("RGB"))
        durations.append(80)

    output.parent.mkdir(parents=True, exist_ok=True)
    poster.parent.mkdir(parents=True, exist_ok=True)
    frames[30].save(poster, optimize=True)

    palette_source = frames[30].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    palette_frames = [
        item.quantize(palette=palette_source, dither=Image.Dither.NONE)
        for item in frames
    ]
    palette_frames[0].save(
        output,
        save_all=True,
        append_images=palette_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Authorized Discord channel screenshot")
    parser.add_argument(
        "--logo",
        type=Path,
        default=Path("assets/logo.png"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after.gif"),
    )
    parser.add_argument(
        "--poster",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-poster.png"),
    )
    args = parser.parse_args()
    build(args.source, args.logo, args.output, args.poster)


if __name__ == "__main__":
    main()
