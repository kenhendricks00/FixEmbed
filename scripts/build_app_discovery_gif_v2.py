"""Build the refined FixEmbed before-and-after App Directory animation.

This intentionally reads the original marketing animation as source material so
the approved asset remains reproducible and byte-for-byte untouched.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

from build_app_discovery_gif import (
    BLURPLE,
    CANVAS,
    CYAN,
    MUTED,
    WHITE,
    background,
    contain,
    draw_brand,
    ease,
    font,
    paste_with_alpha,
    rounded_image,
    transition_scene,
)


CARD_BACKGROUND = (18, 19, 23)


def extract_source_assets(
    legacy_gif: Path,
    legacy_poster: Path,
    logo: Image.Image,
) -> tuple[Image.Image, Image.Image]:
    """Recover clean source regions without modifying the approved original."""
    with Image.open(legacy_gif) as animation:
        animation.seek(0)
        first_frame = animation.convert("RGB")

    # Exclude the clipped date divider from the original before-state crop.
    before = first_frame.crop((91, 315, 850, 382))
    before = ImageEnhance.Contrast(before).enhance(1.03)

    with Image.open(legacy_poster) as poster:
        poster_frame = poster.convert("RGB")

    # Keep only the Components V2 card, excluding the overlapping bot header.
    after = poster_frame.crop((78, 79, 507, 516))
    after = ImageEnhance.Contrast(after).enhance(1.03)

    # Replace the old duplicated "X · X" footer with a single, current label.
    clean_after = Image.new("RGB", after.size, CARD_BACKGROUND)
    clean_after.paste(after.crop((0, 0, after.width, 407)), (0, 0))
    draw = ImageDraw.Draw(clean_after)
    draw.line((12, 407, after.width - 12, 407), fill=(55, 57, 64), width=1)

    footer_logo = logo.copy()
    footer_logo.thumbnail((14, 14), Image.Resampling.LANCZOS)
    clean_after.paste(footer_logo, (12, 416), footer_logo)
    draw.text((31, 415), "FixEmbed", font=font(10), fill=(145, 194, 255))
    draw.text((78, 415), "·", font=font(10, bold=True), fill=(105, 109, 120))
    draw.text((88, 415), "X / Twitter", font=font(10), fill=(190, 193, 201))
    draw.text((143, 415), "·", font=font(10, bold=True), fill=(105, 109, 120))
    draw.text((153, 415), "4 days ago", font=font(10), fill=(135, 139, 150))

    return before, clean_after


def before_scene(frame: Image.Image, before: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.text(
        (70, 155),
        "A link shouldn't look like this.",
        font=font(38, bold=True),
        fill=WHITE,
    )
    draw.text(
        (71, 207),
        "Discord sees the URL—but none of the story.",
        font=font(20),
        fill=MUTED,
    )

    # A raw Discord message has no embed rail or artificial card chrome.
    message = contain(before, (790, 80)).convert("RGBA")
    message = rounded_image(message, 8)
    shadow = Image.new("RGBA", (message.width + 30, message.height + 30), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (15, 15, message.width + 14, message.height + 14),
        radius=12,
        fill=(0, 0, 0, 125),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    layer.alpha_composite(shadow, (55, 276))
    layer.alpha_composite(message, (70, 291))

    draw.text((70, 420), "BEFORE", font=font(15, bold=True), fill=(132, 138, 158))
    draw.text(
        (70, 446),
        "A bare URL leaves everyone guessing.",
        font=font(18),
        fill=MUTED,
    )
    paste_with_alpha(frame, layer, (0, 0), alpha)


def after_scene(frame: Image.Image, after: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    card = contain(after, (420, 418))
    card = rounded_image(card, 13)
    shadow = Image.new("RGBA", (card.width + 40, card.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (20, 20, card.width + 19, card.height + 19),
        radius=17,
        fill=(0, 0, 0, 155),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(15))
    layer.alpha_composite(shadow, (28, 80))
    layer.alpha_composite(card, (48, 100))

    draw.text((530, 108), "Then FixEmbed", font=font(34, bold=True), fill=WHITE)
    draw.text((530, 151), "brings it to life.", font=font(34, bold=True), fill=CYAN)
    benefits = (
        "Playable media",
        "Quote-post context",
        "Real engagement stats",
        "Original creator links",
    )
    for index, benefit in enumerate(benefits):
        y = 239 + index * 47
        draw.ellipse((532, y + 7, 544, y + 19), fill=BLURPLE)
        draw.text((560, y), benefit, font=font(19), fill=WHITE)

    draw.text((530, 450), "AFTER", font=font(15, bold=True), fill=CYAN)
    draw.text(
        (530, 476),
        "One link. The whole post.",
        font=font(19, bold=True),
        fill=MUTED,
    )
    paste_with_alpha(frame, layer, (0, 0), alpha)


def build(
    legacy_gif: Path,
    legacy_poster: Path,
    logo_path: Path,
    output: Path,
    poster: Path,
) -> None:
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((52, 52), Image.Resampling.LANCZOS)
    before, after = extract_source_assets(legacy_gif, legacy_poster, logo)

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
    parser.add_argument(
        "--legacy-gif",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after.gif"),
    )
    parser.add_argument(
        "--legacy-poster",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-poster.png"),
    )
    parser.add_argument("--logo", type=Path, default=Path("assets/logo.png"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-v2.gif"),
    )
    parser.add_argument(
        "--poster",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-v2-poster.png"),
    )
    args = parser.parse_args()
    build(
        args.legacy_gif,
        args.legacy_poster,
        args.logo,
        args.output,
        args.poster,
    )


if __name__ == "__main__":
    main()
