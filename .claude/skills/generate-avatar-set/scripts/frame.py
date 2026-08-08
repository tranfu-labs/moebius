"""Place each cutout at a fixed proportion on a transparent square.

The generator's job ends at "draw a good cat on flat magenta, full bleed". Where that cat
sits inside the final avatar is a deterministic decision, so it belongs here rather than in
a prompt: measure the subject, scale it to a fixed fraction of the frame, pin it a fixed
distance from the top. Baking it into the asset means the UI only has to supply a background
colour and a clip shape — no per-image nudging, and circle and rounded-square containers both
work from the same file.

WIDTH_FRAC / TOP_FRAC were chosen from a sweep: at 1.0 the ears clip and the cheeks touch the
rim, at 0.8 the portrait floats with too much dead colour around it.
"""
import pathlib
import sys

import numpy as np
from PIL import Image

WIDTH_FRAC = 0.86
TOP_FRAC = 0.07
SIZE = 192


def frame(cutout: Image.Image, size: int = SIZE) -> Image.Image:
    alpha = np.asarray(cutout)[..., 3]
    ys, xs = np.where(alpha > 16)
    subject = cutout.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    supersample = size * 4
    width = int(supersample * WIDTH_FRAC)
    height = round(subject.height * width / subject.width)
    subject = subject.resize((width, height), Image.LANCZOS)

    canvas = Image.new("RGBA", (supersample, supersample), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((supersample - width) // 2, int(supersample * TOP_FRAC)))
    return canvas.resize((size, size), Image.LANCZOS)


def main(src_dir: pathlib.Path, out_dir: pathlib.Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for path in sorted(src_dir.glob("*.webp")):
        frame(Image.open(path).convert("RGBA")).save(
            out_dir / path.name, "WEBP", quality=90, method=6,
        )
        count += 1
    print(f"framed {count} -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])))
