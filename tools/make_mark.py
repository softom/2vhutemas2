"""Значок сайта для вкладки браузера (решение Р-62).

    python tools/make_mark.py

Значок не рисуется заново — это тот самый кусок страницы, который выбрал
пользователь: снимок знака Вх² с красной осью и штриховкой. Скрипт только
ставит его в квадрат, добавляет воздух по краям и продолжает ось до краёв
листа — на странице она идёт насквозь, и обрубленная полоса выглядела бы
случайной.

Исходный снимок лежит рядом: `tools/mark-source.png`. Готовые значки
пишутся в `web/public/`.
"""
import os
import struct

from PIL import Image, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "mark-source.png")
OUT = os.path.join(ROOT, "web", "public")
PAPER = (239, 230, 211)
#: Поля по бокам, в точках исходного снимка. Выбрано пользователем.
AIR = 22
#: Размеры внутри .ico: больше 64 во вкладке не спрашивают.
ICO_SIZES = (16, 32, 48, 64)
#: Значок на домашнем экране.
TOUCH = 180


def square(im: Image.Image) -> Image.Image:
    """Квадрат с воздухом: бумага по краям, ось — на всю высоту."""
    w, h = im.size
    # Обрезаем пустую бумагу по бокам, чтобы поля задавал AIR, а не снимок.
    mask = ImageChops.difference(im, Image.new("RGB", im.size, PAPER)).convert("L")
    box = mask.point(lambda v: 255 if v > 18 else 0).getbbox()
    crop = im.crop((box[0], 0, box[2], h))
    cw, ch = crop.size

    px = crop.load()
    is_red = lambda c: c[0] > 140 and c[1] < 120 and c[2] < 120  # noqa: E731
    cols = [x for x in range(cw) if sum(1 for y in range(ch) if is_red(px[x, y])) > ch * 0.5]

    side = cw + 2 * AIR
    tile = Image.new("RGB", (side, side), PAPER)
    ox, oy = AIR, (side - ch) // 2
    if cols:
        bar = Image.new("RGB", (cols[-1] - cols[0] + 1, side), px[cols[0] + 1, 2])
        tile.paste(bar, (ox + cols[0], 0))
    tile.paste(crop, (ox, oy))
    return tile


def write_ico(path: str, tile: Image.Image) -> None:
    """ICO из PNG внутри: шесть байт заголовка, по шестнадцать на размер."""
    images = []
    for size in ICO_SIZES:
        buf = os.path.join(OUT, f".ico-{size}.png")
        tile.resize((size, size), Image.LANCZOS).save(buf)
        images.append(open(buf, "rb").read())
        os.remove(buf)

    offset = 6 + 16 * len(images)
    entries, body = [], b""
    for size, data in zip(ICO_SIZES, images):
        entries.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
        body += data
    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries) + body)


tile = square(Image.open(SRC).convert("RGB"))
write_ico(os.path.join(OUT, "favicon.ico"), tile)
tile.resize((TOUCH, TOUCH), Image.LANCZOS).save(os.path.join(OUT, "apple-touch-icon.png"))
print(f"значок {tile.size[0]}×{tile.size[0]} → favicon.ico {ICO_SIZES}, apple-touch-icon.png {TOUCH}")
