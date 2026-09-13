# 云胡牌 · PWA 图标生成（PIL 手绘：墨绿绒布 + 鎏金描边 + 象牙「胡」）
import math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/Users/clouseren/Library/Application Support/kimi-desktop/daimon-share/daimon/runtime/python/fonts/NotoSansCJKsc-Bold.otf"
OUT = "/Users/clouseren/Documents/Kimi/Workspaces/application_rebuild/yun-hu-pai"

FELT_TOP = (26, 77, 58)     # #1a4d3a
FELT_BOT = (14, 53, 39)     # #0e3527
GOLD = (212, 175, 55)       # #d4af37
GOLD_HI = (244, 221, 138)
IVORY = (245, 240, 225)
CINNABAR = (192, 57, 43)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def make_icon(size, path, radius_ratio=0.22, pad_ratio=0.0):
    S = size * 4  # 4x 超采样再缩小，边缘顺滑
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = int(S * pad_ratio)
    box = [pad, pad, S - pad, S - pad]
    radius = int(S * radius_ratio)

    # 绒布渐变底（竖向）
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(FELT_TOP, FELT_BOT, y / S))
    # 叠一点噪点纹理
    rnd = random.Random(42)
    noise = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    nd = ImageDraw.Draw(noise)
    for _ in range(int(S * S * 0.012)):
        x, y = rnd.randint(0, S - 1), rnd.randint(0, S - 1)
        v = rnd.randint(8, 26)
        nd.point((x, y), fill=(255, 255, 255, v))
    grad = Image.alpha_composite(grad, noise)

    # 圆角蒙版
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # 鎏金双线框
    inset1 = pad + int(S * 0.045)
    inset2 = pad + int(S * 0.075)
    d.rounded_rectangle([inset1, inset1, S - inset1, S - inset1], radius=int(radius * 0.82),
                        outline=GOLD, width=max(2, int(S * 0.012)))
    d.rounded_rectangle([inset2, inset2, S - inset2, S - inset2], radius=int(radius * 0.74),
                        outline=(*GOLD, 130), width=max(1, int(S * 0.005)))

    # 中央「胡」字（象牙白 + 朱砂投影 + 金光晕）
    cx, cy = S / 2, S / 2 - S * 0.015
    fsize = int(S * 0.56)
    font = ImageFont.truetype(FONT, fsize)
    # 光晕：多次偏移画金色再模糊
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gdr = ImageDraw.Draw(glow)
    gdr.text((cx, cy), "胡", font=font, fill=(*GOLD_HI, 200), anchor="mm")
    glow = glow.filter(ImageFilter.GaussianBlur(int(S * 0.03)))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.text((cx + S * 0.012, cy + S * 0.018), "胡", font=font, fill=CINNABAR, anchor="mm")  # 朱砂影
    d.text((cx, cy), "胡", font=font, fill=IVORY, anchor="mm")

    # 底部三颗鎏金点（中發白意象抽象化）
    dot_r = int(S * 0.018)
    dy = S * 0.845
    for i, dx in enumerate([-S * 0.09, 0, S * 0.09]):
        d.ellipse([cx + dx - dot_r, dy - dot_r, cx + dx + dot_r, dy + dot_r],
                  fill=GOLD if i != 1 else GOLD_HI)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)
    print("saved", path, size)

make_icon(512, OUT + "/icon-512.png")
make_icon(192, OUT + "/icon-192.png")
# iOS apple-touch-icon：不支持透明，给不透明方角底
make_icon(180, OUT + "/apple-touch-icon.png", radius_ratio=0.0)
make_icon(32, OUT + "/favicon-32.png", radius_ratio=0.25)
