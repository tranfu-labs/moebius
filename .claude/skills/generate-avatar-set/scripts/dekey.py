"""Chroma-key a magenta contact sheet into transparent, full-bleed portrait cutouts.

Magenta rather than a green screen: plenty of cats have green eyes, and a green key punches
holes straight through them. Nothing on a cat — fur, iris, nose, tongue — sits on magenta's hue.

Two framing rules the generator must follow for this to work, both learned the hard way:

- The backdrop must fill the whole cell. If the model draws a magenta *disc* instead, the
  cutout inherits a circular silhouette, and dropping that into a rounded-square container
  shows a circle pasted on a square with the corners bleeding background colour.
- Cells are located by the magenta itself, never by dividing the sheet into equal thirds.
  The sheet has thin white gutters between cells; slicing on arithmetic thirds drags those
  gutters into the tile, and since white is not magenta it survives the key as a pale frame
  around every portrait.
"""
import pathlib
import sys

import numpy as np
from PIL import Image

FULL_KEY = 90.0   # (R+B)/2 - G at or above this is pure backdrop
NO_KEY = 30.0     # at or below this is untouched subject
CELL_MIN = 50     # ignore magenta specks smaller than this when finding bands


def dekey(image: Image.Image) -> Image.Image:
    rgb = np.asarray(image.convert("RGB")).astype(np.float32)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    score = (red + blue) / 2 - green
    alpha = np.clip((FULL_KEY - score) / (FULL_KEY - NO_KEY), 0.0, 1.0)

    # Despill: pixels the cat keeps but which caught magenta at the boundary get red and
    # blue pulled back toward green, in proportion to how much spill they carry.
    spill = np.clip(score - NO_KEY, 0.0, None) * alpha
    limit = np.minimum(spill, np.maximum(np.minimum(red, blue) - green, 0.0))
    out = rgb.copy()
    out[..., 0] -= limit
    out[..., 2] -= limit
    return Image.fromarray(np.dstack([np.clip(out, 0, 255), alpha * 255]).astype(np.uint8), "RGBA")


def _bands(mask: np.ndarray) -> list[tuple[int, int]]:
    runs, start = [], None
    for index, value in enumerate(mask):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(mask) - 1))
    return [run for run in runs if run[1] - run[0] > CELL_MIN]


def cut(sheet_path: pathlib.Path, out_dir: pathlib.Path, names: list[str], size: int = 256) -> int:
    sheet = Image.open(sheet_path).convert("RGB")
    data = np.asarray(sheet).astype(int)
    magenta = (data[..., 0] + data[..., 2]) / 2 - data[..., 1] > 60

    rows, cols = _bands(magenta.any(axis=1)), _bands(magenta.any(axis=0))
    if len(rows) != 3 or len(cols) != 3:
        print(f"expected 3x3 magenta cells, found {len(rows)}x{len(cols)}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(names):
        row, col = divmod(index, 3)
        y0, y1 = rows[row]
        x0, x1 = cols[col]
        # Keep the cell whole: the framing (head near the top, shoulders bleeding off the
        # bottom) is deliberate, and trimming to the subject's bbox would destroy it.
        cell = dekey(sheet.crop((x0, y0, x1 + 1, y1 + 1)))
        cell.resize((size, size), Image.LANCZOS).save(out_dir / f"{name}.webp", "WEBP", quality=90, method=6)
    print(f"keyed {len(names)} -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(cut(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3].split(",")))
