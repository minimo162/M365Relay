"""Exercise bundled Pillow, including native image and font support."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, AvifImagePlugin

work = Path(sys.argv[1])
with Image.new("RGB", (64, 32), "white") as source:
    draw = ImageDraw.Draw(source)
    draw.rectangle((0, 0, 31, 31), fill=(255, 0, 0))
    draw.text((34, 2), "OK", fill="black", font=ImageFont.load_default())
    png, jpeg = work / "pillow-check.png", work / "pillow-check.jpg"
    with png.open("xb") as output:
        source.save(output, format="PNG")
    with jpeg.open("xb") as output:
        source.save(output, format="JPEG", quality=95)
with Image.open(png) as loaded:
    assert loaded.size == (64, 32)
    assert loaded.getpixel((5, 5)) == (255, 0, 0)
    with loaded.crop((0, 0, 16, 16)) as cropped:
        with cropped.resize((8, 8), Image.Resampling.LANCZOS) as resized:
            assert resized.getpixel((3, 3)) == (255, 0, 0)
with Image.open(jpeg) as loaded:
    assert loaded.size == (64, 32)
    red, green, blue = loaded.getpixel((5, 5))
    assert red > 245 and green < 10 and blue < 10
assert AvifImagePlugin.SUPPORTED is False
print("PASS bundled Pillow PNG/JPEG, crop, resize, text; AVIF intentionally excluded")
