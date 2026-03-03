import base64
import io

from langchain_core.tools import tool
from PIL import Image, ImageDraw, ImageFont, ImageColor

from app.tools.registry import register_tool

@register_tool
@tool
def image_annotate(image_b64: str, annotations: list[dict]) -> str:
    """对图片进行标注（添加箭头、文字、框选、高亮），返回标注后图片的 base64。

    annotations 格式示例:
    [
      {"type": "box", "params": {"x": 10, "y": 10, "w": 100, "h": 50, "color": "red"}},
      {"type": "text", "params": {"x": 10, "y": 70, "text": "注释", "color": "red", "size": 20}},
      {"type": "arrow", "params": {"x1": 50, "y1": 50, "x2": 150, "y2": 150, "color": "red"}},
      {"type": "highlight", "params": {"x": 10, "y": 10, "w": 100, "h": 50, "color": "yellow", "alpha": 80}}
    ]
    """
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    for ann in annotations:
        t = ann.get("type", "")
        p = ann.get("params", {})
        color = p.get("color", "red")

        if t == "box":
            draw.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], outline=color, width=2)
        elif t == "text":
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", p.get("size", 16))
            except (OSError, IOError):
                font = ImageFont.load_default()
            draw.text((p["x"], p["y"]), p["text"], fill=color, font=font)
        elif t == "arrow":
            draw.line([(p["x1"], p["y1"]), (p["x2"], p["y2"])], fill=color, width=2)
            draw.polygon([(p["x2"], p["y2"]), (p["x2"] - 8, p["y2"] - 8), (p["x2"] + 8, p["y2"] - 8)], fill=color)
        elif t == "highlight":
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            alpha = p.get("alpha", 80)
            rgb = ImageColor.getrgb(color)
            overlay_draw.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], fill=(*rgb, alpha))
            img = Image.alpha_composite(img, overlay)
            draw = ImageDraw.Draw(img)

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
