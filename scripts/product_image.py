#!/usr/bin/env python3
"""공급사 상품 이미지를 우프 등록 규칙에 맞게 다듬는다.

  thumbnail  대표이미지(정방형 썸네일).
             배경이 흰색(FFF)인 누끼컷이면 전체에 #F7F7F7 을 multiply 로 한 겹
             얹는다 — 흰 배경이 F7F7F7 이 되고 제품 색은 그만큼만 살짝 눌린다
             (포토샵에서 F7F7F7 단색 레이어를 곱하기로 올린 것과 같다).
             배경이 흰색이 아니면(연출컷 등) 손대지 않는다.
             정방형이 아니면 흰 배경일 때만 여백을 채워 정방형으로 만든다.

  normalize  상세·추가이미지. 카페24가 받는 형식(JPG/PNG/GIF)과 5MB 제한에 맞춘다.
             움직이는 webp 는 GIF 로, 정지 webp 는 JPG 로 바꾼다.

사용:
  python3 product_image.py thumbnail --input in.jpg --output out.jpg [--color F7F7F7]
  python3 product_image.py normalize --input in.webp --output-dir dir
결과는 표준출력 JSON 한 줄.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops, ImageSequence

MAX_BYTES = 5 * 1024 * 1024
# 배경 판정: 테두리 픽셀의 이 비율 이상이 이 값보다 밝으면 흰 배경으로 본다.
# JPG 압축 노이즈 때문에 255 딱 맞는 값만 보면 흰 배경을 놓친다.
WHITE_LEVEL = 248
WHITE_RATIO = 0.97


def to_rgb_on_white(image):
    """투명 영역은 흰 배경으로 본다 (누끼 PNG)."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        canvas = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        canvas.alpha_composite(rgba)
        return canvas.convert("RGB")
    return image.convert("RGB")


def border_pixels(image, band=None):
    width, height = image.size
    band = band or max(2, min(width, height) // 100)
    pixels = image.load()
    step = max(1, min(width, height) // 400)
    points = []
    for x in range(0, width, step):
        for y in list(range(0, band)) + list(range(height - band, height)):
            points.append(pixels[x, y])
    for y in range(0, height, step):
        for x in list(range(0, band)) + list(range(width - band, width)):
            points.append(pixels[x, y])
    return points


def white_ratio(image):
    points = border_pixels(image)
    if not points:
        return 0.0
    white = sum(1 for (r, g, b) in points if r >= WHITE_LEVEL and g >= WHITE_LEVEL and b >= WHITE_LEVEL)
    return white / len(points)


def parse_color(text):
    text = text.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def save_jpeg_under_limit(image, path):
    for quality in (92, 88, 84, 80, 75):
        image.save(path, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
        if os.path.getsize(path) <= MAX_BYTES:
            return quality
    # 그래도 크면 크기를 줄인다.
    scaled = image.copy()
    while os.path.getsize(path) > MAX_BYTES and scaled.width > 600:
        scaled = scaled.resize((int(scaled.width * 0.85), int(scaled.height * 0.85)), Image.LANCZOS)
        scaled.save(path, "JPEG", quality=80, optimize=True, progressive=True)
    return 80


def cmd_thumbnail(args):
    source = Image.open(args.input)
    image = to_rgb_on_white(source)
    ratio = white_ratio(image)
    is_white_bg = ratio >= WHITE_RATIO
    square_before = image.width == image.height
    padded = False
    if not square_before and is_white_bg:
        side = max(image.width, image.height)
        canvas = Image.new("RGB", (side, side), (255, 255, 255))
        canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
        image = canvas
        padded = True
    multiplied = False
    if is_white_bg:
        layer = Image.new("RGB", image.size, parse_color(args.color))
        image = ImageChops.multiply(image, layer)
        multiplied = True
    quality = save_jpeg_under_limit(image, args.output)
    corner = image.getpixel((2, 2))
    print(json.dumps({
        "ok": True,
        "whiteBackground": is_white_bg,
        "whiteRatio": round(ratio, 4),
        "multiplied": multiplied,
        "padded": padded,
        "square": image.width == image.height,
        "width": image.width,
        "height": image.height,
        "corner": "#%02X%02X%02X" % corner,
        "bytes": os.path.getsize(args.output),
        "quality": quality,
        "output": args.output
    }))


def cmd_normalize(args):
    source = Image.open(args.input)
    fmt = (source.format or "").upper()
    base = os.path.splitext(os.path.basename(args.input))[0]
    size = os.path.getsize(args.input)
    animated = getattr(source, "is_animated", False) and getattr(source, "n_frames", 1) > 1

    if fmt in ("JPEG", "PNG", "GIF") and size <= MAX_BYTES:
        print(json.dumps({"ok": True, "output": args.input, "format": fmt, "converted": False, "bytes": size}))
        return

    if animated:
        out = os.path.join(args.output_dir, f"{base}.gif")
        frames = []
        durations = []
        for frame in ImageSequence.Iterator(source):
            frames.append(to_rgb_on_white(frame).convert("P", palette=Image.ADAPTIVE, colors=255))
            durations.append(frame.info.get("duration", source.info.get("duration", 80)))
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations,
                       loop=source.info.get("loop", 0), optimize=True, disposal=2)
        # 움직이는 이미지가 5MB 를 넘으면 프레임을 솎는다.
        step = 2
        while os.path.getsize(out) > MAX_BYTES and step <= 6:
            kept = frames[::step]
            kept_durations = [sum(durations[i:i + step]) for i in range(0, len(durations), step)]
            kept[0].save(out, save_all=True, append_images=kept[1:], duration=kept_durations,
                         loop=source.info.get("loop", 0), optimize=True, disposal=2)
            step += 1
        if os.path.getsize(out) > MAX_BYTES:
            # 끝까지 크면 첫 장만 정지 이미지로.
            out = os.path.join(args.output_dir, f"{base}.jpg")
            save_jpeg_under_limit(to_rgb_on_white(frames[0].convert("RGB")), out)
            print(json.dumps({"ok": True, "output": out, "format": "JPEG", "converted": True,
                              "note": "움직이는 이미지가 5MB를 넘어 첫 장만 사용", "bytes": os.path.getsize(out)}))
            return
        print(json.dumps({"ok": True, "output": out, "format": "GIF", "converted": True, "bytes": os.path.getsize(out)}))
        return

    out = os.path.join(args.output_dir, f"{base}.jpg")
    save_jpeg_under_limit(to_rgb_on_white(source), out)
    print(json.dumps({"ok": True, "output": out, "format": "JPEG", "converted": True, "bytes": os.path.getsize(out)}))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    thumb = sub.add_parser("thumbnail")
    thumb.add_argument("--input", required=True)
    thumb.add_argument("--output", required=True)
    thumb.add_argument("--color", default="F7F7F7")
    norm = sub.add_parser("normalize")
    norm.add_argument("--input", required=True)
    norm.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        if args.command == "thumbnail":
            cmd_thumbnail(args)
        else:
            cmd_normalize(args)
    except Exception as error:  # noqa: BLE001 - 호출한 쪽에 원인을 그대로 전한다
        print(json.dumps({"ok": False, "error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
