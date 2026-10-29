"""
Génère les images de WakeUp-Pc :
  assets/     -> icône et écran de démarrage (utilisés par la compilation Android)
  playstore/  -> icône 512 et image de présentation pour la fiche du Play Store
Lancement : python3 tools/make_assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

GREEN = (52, 199, 89)
BOLT = [(13, 2), (4, 14), (11, 14), (10, 22), (19, 10), (12, 10)]


def bolt(d, cx, cy, u, color=(255, 255, 255, 255)):
    """Dessine l'éclair, centré en (cx, cy), u = taille d'une unité de la grille 24x24."""
    d.polygon([(cx + (x - 11.5) * u, cy + (y - 12) * u) for x, y in BOLT], fill=color)


def font(size, bold=True):
    names = ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"] if bold else ["DejaVuSans.ttf"]
    for name in names:
        for folder in ("/usr/share/fonts/truetype/dejavu/", ""):
            try:
                return ImageFont.truetype(folder + name, size)
            except OSError:
                pass
    return ImageFont.load_default(size)


os.makedirs("assets", exist_ok=True)
os.makedirs("playstore", exist_ok=True)

# Icône classique (carrée, plein cadre)
icon = Image.new("RGBA", (1024, 1024), GREEN + (255,))
bolt(ImageDraw.Draw(icon), 512, 512, 1024 * 0.55 / 20)
icon.save("assets/icon-only.png")

# Icône adaptative Android : avant-plan transparent + fond uni
fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
bolt(ImageDraw.Draw(fg), 512, 512, 1024 * 0.40 / 20)
fg.save("assets/icon-foreground.png")
Image.new("RGBA", (1024, 1024), GREEN + (255,)).save("assets/icon-background.png")

# Écrans de démarrage clair et sombre
for name, bg in (("splash.png", (242, 242, 247, 255)), ("splash-dark.png", (0, 0, 0, 255))):
    s = Image.new("RGBA", (2732, 2732), bg)
    d = ImageDraw.Draw(s)
    box = 560
    x0 = (2732 - box) // 2
    d.rounded_rectangle([x0, x0, x0 + box, x0 + box], radius=130, fill=GREEN + (255,))
    bolt(d, 1366, 1366, box * 0.5 / 20)
    s.save("assets/" + name)

# Play Store : icône 512x512
icon.resize((512, 512), Image.LANCZOS).save("playstore/icon-512.png")

# Play Store : image de présentation 1024x500
W, H = 1024, 500
fg_img = Image.new("RGBA", (W, H))
px = fg_img.load()
for y in range(H):
    t = y / (H - 1)
    c = (int(22 - 11 * t), int(26 - 13 * t), int(44 - 26 * t), 255)
    for x in range(W):
        px[x, y] = c
d = ImageDraw.Draw(fg_img)
d.rounded_rectangle([90, 100, 390, 400], radius=70, fill=GREEN + (255,))
bolt(d, 240, 250, 300 * 0.5 / 20)
d.text((440, 160), "WakeUp-Pc", font=font(88), fill=(255, 255, 255, 255))
d.text((444, 275), "Allume et éteins ton PC", font=font(36, False), fill=(190, 195, 215, 255))
d.text((444, 322), "à distance, en toute sécurité", font=font(36, False), fill=(190, 195, 215, 255))
fg_img.convert("RGB").save("playstore/feature-graphic.png")

print("Images générées dans assets/ et playstore/")
