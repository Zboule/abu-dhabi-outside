from PIL import Image, ImageDraw, ImageFont, ImageFilter
W, H = 1290, 2796
def font(size, bold=True):
    for f in ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]:
        try:
            ft = ImageFont.truetype(f, size)
            try: ft.set_variation_by_name("Bold" if bold else "Regular")
            except Exception: pass
            return ft
        except Exception: continue
    return ImageFont.load_default()
def bg(top, bottom):
    im = Image.new("RGB", (W, H), bottom)
    d = ImageDraw.Draw(im)
    for y in range(H):
        k = min(1, y / (H * 0.7))
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return im
def caption(im, title, sub):
    d = ImageDraw.Draw(im)
    ft, fs = font(92), font(46, False)
    y = 150
    for line in title.split("\n"):
        w = d.textlength(line, font=ft); d.text(((W - w) / 2, y), line, font=ft, fill=(255, 255, 255)); y += 108
    y += 18
    for line in sub.split("\n"):
        w = d.textlength(line, font=fs); d.text(((W - w) / 2, y), line, font=fs, fill=(180, 186, 200)); y += 60
    return y
def phone(im, shot, top):
    sc = 0.78
    s = Image.open(shot).convert("RGB").resize((int(1290 * sc), int(2796 * sc)), Image.LANCZOS)
    r = 70
    mask = Image.new("L", s.size, 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, s.size[0], s.size[1]], r, fill=255)
    x = (W - s.size[0]) // 2
    shadow = Image.new("L", (s.size[0] + 120, s.size[1] + 120), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([60, 60, s.size[0] + 60, s.size[1] + 60], r, fill=150)
    im.paste((0, 0, 0), (x - 60, top - 40), shadow.filter(ImageFilter.GaussianBlur(40)))
    border = Image.new("RGB", (s.size[0] + 16, s.size[1] + 16), (58, 60, 68))
    bm = Image.new("L", border.size, 0); ImageDraw.Draw(bm).rounded_rectangle([0, 0, border.size[0], border.size[1]], r + 8, fill=255)
    im.paste(border, (x - 8, top - 8), bm)
    im.paste(s, (x, top), mask)
shots = [
    ("today.png", "When can the kids\ngo out?", "Heat, sun and air quality, hour by hour,\nfor Abu Dhabi.", (22, 40, 30)),
    ("dust.png", "Dust storms show\nup at a glance", "Measured at Environment Agency\nAbu Dhabi stations.", (48, 36, 20)),
    ("smog.png", "Strong sun burns.\nBad air swirls.", "Footprints mark the hours you can go out,\nwater the pool time.", (36, 24, 56)),
]
for k, (shot, t, s, top) in enumerate(shots, 1):
    im = bg(top, (6, 6, 9))
    y = caption(im, t, s)
    phone(im, f"/tmp/store/{shot}", y + 60)
    im.save(f"/tmp/store/out/{k}.png")
# widgets: the today row, light and dark tiles, on a soft wallpaper
raw = Image.open("/tmp/store/widgets-raw.png").convert("RGBA")
rw, rh = raw.size
row = raw.crop((0, rh // 2, rw, rh))  # second row: today
# tiles inside the row (preview layout: 10pt padding, 12pt spacing, label ~30pt; scale 4)
sc = 4
x0, y0 = 10 * sc, 10 * sc + 25 * sc
small = (170 * sc, 170 * sc); medium = (364 * sc, 170 * sc)
xs = [x0, x0 + small[0] + 12 * sc, x0 + small[0] + medium[0] + 24 * sc, x0 + 2 * small[0] + medium[0] + 36 * sc]
tiles = [row.crop((xs[i], y0, xs[i] + (small if i % 2 == 0 else medium)[0], y0 + small[1])) for i in range(4)]
im = bg((30, 50, 90), (12, 16, 30))
d = ImageDraw.Draw(im)
glow = Image.new("RGB", (W, H), (0, 0, 0))
y = caption(im, "Widgets for your\nhome screen", "They follow your settings: kids limits,\npool time, the hours of your day.")
def place(tile, cx, top, width):
    t = tile.resize((width, int(tile.size[1] * width / tile.size[0])), Image.LANCZOS).convert("RGB")
    m = Image.new("L", t.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, t.size[0] - 1, t.size[1] - 1], int(width * (22 / 364 if width > 700 else 22 / 170)), fill=255)
    im.paste(t, (cx - width // 2, top), m)
    return top + t.size[1]
yy = y + 120
yy = place(tiles[3], W // 2, yy, 1130) + 70
sw = 520
place(tiles[0], W // 2 - sw // 2 - 45, yy, sw)
place(tiles[2], W // 2 + sw // 2 + 45, yy, sw)
yy += sw + 70
place(tiles[1], W // 2, yy, 1130)
im.save("/tmp/store/out/4.png")
sheet = Image.new("RGB", (4 * 322 + 50, 699), (40, 40, 40))
for k in range(4):
    sheet.paste(Image.open(f"/tmp/store/out/{k+1}.png").resize((322, 699)), (10 + k * 332, 0))
sheet.save("/tmp/store/out/sheet.png")
for k in range(4): print(k + 1, Image.open(f"/tmp/store/out/{k+1}.png").size)
