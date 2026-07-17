"""Build FixEmbed's legacy-to-Components-V2 marketing animation."""

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


def card_with_shadow(
    layer: Image.Image,
    source: Image.Image,
    *,
    position: tuple[int, int],
    bounds: tuple[int, int],
) -> None:
    card = rounded_image(contain(source, bounds), 12)
    shadow = Image.new("RGBA", (card.width + 40, card.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (20, 20, card.width + 19, card.height + 19),
        radius=17,
        fill=(0, 0, 0, 155),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(15))
    layer.alpha_composite(shadow, (position[0] - 20, position[1] - 20))
    layer.alpha_composite(card, position)


def comparison_copy(
    draw: ImageDraw.ImageDraw,
    *,
    title: tuple[str, str],
    title_second_color: tuple[int, int, int],
    benefits: tuple[str, ...],
    label: str,
    summary: str,
    active: bool,
) -> None:
    x = 520
    draw.text((x, 108), title[0], font=font(33, bold=True), fill=WHITE)
    draw.text((x, 150), title[1], font=font(33, bold=True), fill=title_second_color)

    marker_color = BLURPLE if active else (91, 96, 113)
    text_color = WHITE if active else (188, 192, 205)
    for index, benefit in enumerate(benefits):
        y = 237 + index * 45
        draw.ellipse((x + 2, y + 7, x + 14, y + 19), fill=marker_color)
        draw.text((x + 30, y), benefit, font=font(18), fill=text_color)

    draw.text(
        (x, 448),
        label,
        font=font(15, bold=True),
        fill=CYAN if active else (132, 138, 158),
    )
    draw.text((x, 475), summary, font=font(17, bold=True), fill=MUTED)


def before_scene(frame: Image.Image, before: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    card_with_shadow(layer, before, position=(48, 108), bounds=(410, 390))
    comparison_copy(
        draw,
        title=("The embed worked.", "But it stopped short."),
        title_second_color=MUTED,
        benefits=(
            "Playable media",
            "No quote-post context",
            "No engagement stats",
            "Legacy card layout",
        ),
        label="BEFORE",
        summary="The post, without the full story.",
        active=False,
    )
    paste_with_alpha(frame, layer, (0, 0), alpha)


def after_scene(frame: Image.Image, after: Image.Image, alpha: float) -> None:
    layer = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    card_with_shadow(layer, after, position=(48, 95), bounds=(412, 418))
    comparison_copy(
        draw,
        title=("Then FixEmbed", "brings it to life."),
        title_second_color=CYAN,
        benefits=(
            "Verified identities",
            "Quote-post context",
            "Real engagement stats",
            "Modern Components V2",
        ),
        label="AFTER",
        summary="One link. The whole post.",
        active=True,
    )
    paste_with_alpha(frame, layer, (0, 0), alpha)


def build(
    before_path: Path,
    after_path: Path,
    logo_path: Path,
    output: Path,
    poster: Path,
) -> None:
    before = ImageEnhance.Contrast(Image.open(before_path).convert("RGB")).enhance(1.02)
    after = ImageEnhance.Contrast(Image.open(after_path).convert("RGB")).enhance(1.02)
    logo = Image.open(logo_path).convert("RGBA")
    logo.thumbnail((52, 52), Image.Resampling.LANCZOS)

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
    parser.add_argument("before", type=Path, help="Legacy embed reference image")
    parser.add_argument("after", type=Path, help="Components V2 reference image")
    parser.add_argument("--logo", type=Path, default=Path("assets/logo.png"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-v3.gif"),
    )
    parser.add_argument(
        "--poster",
        type=Path,
        default=Path("assets/marketing/fixembed-before-after-v3-poster.png"),
    )
    args = parser.parse_args()
    build(args.before, args.after, args.logo, args.output, args.poster)


if __name__ == "__main__":
    main()
