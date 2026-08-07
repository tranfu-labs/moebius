"""Round 3: anthropomorphic cats, same framing as the human round.

The species swap is not a style change. Framing, personality beats and collar hints all carry
over from round 2 unchanged; only the creature differs. Two things this buys us:
- gender presentation stops being a variable at all (round 1 had the model assigning
  "manager = woman, developer = man" on its own)
- coat pattern is a far stronger small-size cue than human hairstyle: ginger vs tortoiseshell vs
  siamese are large blocks of colour that survive 32px, where hairstyle does not

Hard requirement: upright, clothed, shoulders-up portraits — a profile picture, never a pet photo
and never an animal on all fours.
"""
import base64
import os
import pathlib
import sys

from openai import OpenAI
from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).parent / "avatars8"
OUT.mkdir(exist_ok=True)

# (slug, personality beat, collar hint, coat) — coats chosen to stay distinct at 32px
CAST = [
    ("engineering-manager", "HEADWEAR: no headwear, crisp upright collar. CANDID MOMENT: chin dipped, eyes half-lidded and levelled straight at the viewer with unimpressed authority, one ear rotated back, mouth a flat smug line — the look of someone who has already decided", "open shirt collar", "ginger orange tabby with cream chest"),
    ("software-developer", "HEADWEAR: slouchy oversized knit beanie pushed back, round glasses. CANDID MOMENT: completely zoned out, pupils drifted far to the upper corner, mouth slightly ajar, glasses sliding down the muzzle, head lolling to one side — caught mid-thought and not present at all", "plain crew neckline", "solid black with a small white chest patch"),
    ("qa-engineer", "HEADWEAR: no hat, thin wire-frame glasses. CANDID MOMENT: extreme SIDE-EYE — head and body squarely facing forward but eyes cut hard to the side, pupils shoved to the far corner of the eyes, one eyebrow raised, lips pressed thin in silent judgement", "buttoned collar", "silver grey mackerel tabby with clear stripes"),
    ("product-manager", "HEADWEAR: bright patterned headscarf tied back. CANDID MOMENT: eyes squeezed shut in delight, mouth wide in a laugh with the tip of the tongue sticking out (a blep), whiskers pushed forward, head thrown back — mid-burst of enthusiasm", "soft round neckline", "calico with bold orange, black and white patches"),
    ("product-designer", "HEADWEAR: soft wool beret tilted. CANDID MOMENT: enormous glossy round eyes gazing up and away at nothing, pupils blown wide, mouth a tiny soft oh, head tipped back — lost somewhere else entirely", "loose draped collar", "long-haired pure white with blue eyes"),
    ("security-analyst", "HEADWEAR: hood pulled up. CANDID MOMENT: face mostly shadowed inside the hood, body angled away, only the eyes swivelled back to lock onto the viewer in a hard narrow stare, ears flattened slightly — caught watching", "high zipped collar", "seal point siamese, dark face and pale body"),
    ("data-analyst", "HEADWEAR: no headwear, severely minimal. CANDID MOMENT: dead-flat unblinking stare directly into the lens, absolutely no expression whatsoever, one ear swivelled backwards in irritation, pupils tiny — utterly unmoved", "thin knit neckline", "solid russian blue grey"),
    ("operations-engineer", "HEADWEAR: worn canvas cap worn straight. CANDID MOMENT: caught mid-yawn, mouth stretched wide open showing fangs and curled tongue, eyes screwed shut, whiskers splayed — an enormous undignified yawn", "sturdy work collar", "thick-furred brown tabby with a broad face"),
    ("content-writer", "HEADWEAR: soft slouchy knit cap. CANDID MOMENT: head tilted far over to one shoulder, eyes softly narrowed into contented slits, tiny closed smile, ears relaxed sideways — melting into a slow blink", "soft scarf-like neckline", "tortoiseshell, mottled black and ginger"),
]

PALETTE = ["#FF00FF"] * 9

ROSTER = "\n".join(
    f"{i + 1}. Coat: {coat}. {beat}. Neckline: {collar}. Background {PALETTE[i]}."
    for i, (_slug, beat, collar, coat) in enumerate(CAST)
)

PROMPT = f"""A 3x3 grid of exactly 9 circular avatar portraits on a plain white background, evenly spaced, equal size.

WHAT THESE ARE: anthropomorphic CAT characters posed exactly like human profile pictures.
- Each cat is UPRIGHT and BIPEDAL, sitting or standing like a person, WEARING CLOTHES.
- Head-and-shoulders framing, cropped at the chest, facing the viewer — the same composition a person
  would use for a work profile photo.
- ABSOLUTELY NOT on all fours. NOT a pet photograph. NOT a cat lying down, curled up, or in any animal
  posture. NO whole-body shots. These are portraits of characters who happen to be cats.

SHARED STYLE — identical across all nine:
- Flat, clean vector-style illustration with soft simple shading. No photorealism, no 3D render, no texture.
- FRAMING, and this is critical: the #FF00FF magenta fills the ENTIRE SQUARE CELL, edge to edge to
  edge. There is NO circle, NO disc, NO round badge, NO vignette, NO frame, NO border, NO rounded
  shape of ANY kind anywhere. The cell is simply a magenta square with a cat on it.
- The cat is BIG in the cell: the head spans most of the width, the top of the head or the ear tips
  come close to the top edge, and the SHOULDERS RUN OFF THE BOTTOM EDGE of the square and are cut
  by it. The cat must NOT float as a small shape in the middle with magenta all around it.
- The magenta is a chroma key backdrop: absolutely flat, no gradient, no shading, no texture, no
  drop shadow, and no magenta tint anywhere on the cat itself. Hard clean edge between cat and backdrop.
- Consistent rendering, but framing and head angle vary a lot between them — this is a set of snapshots,
  not a row of ID photographs.
- Same line weight and same simplified shape language throughout.
- These are CANDID SNAPSHOTS, not posed portraits. Each cat is caught in an unguarded moment it did not
  intend anyone to see. Expressions are BIG and slightly undignified: eyes cut hard to the side, pupils
  shoved into the corners, eyelids half-lowered, mouths open mid-yawn or mid-laugh, ears rotated back or
  flattened, heads lolling well off-vertical. Push each expression further than feels polite.
- Faces fill MORE of the circle than a formal portrait would — crop in closer, let the head sit slightly
  off-centre, let ears or a shoulder run past the circle edge. Break the tidy centred framing.
- Cat features stay real — triangular ears, muzzle, whiskers, real cat eye shapes with visible pupils.
  Never a human face. The comedy comes from a real cat wearing a very human expression.
- Head tilt, gaze direction and body angle vary as described below, while framing stays consistent.
- Not chibi, not kawaii mascot, not a children's sticker. Grown-up, calm, characterful.

HARD CONSTRAINTS:
- NO props, NO tools, NO objects, NO equipment, NO icons, NO text, NO letters, NO numbers, NO logos.
  Occupation is suggested ONLY through neckline, headwear and personality in the face.
- HEADWEAR expresses personality, it is not decoration. Where a cat is specified to wear nothing,
  draw nothing on the head — that restraint is the characterisation. Where headwear is specified,
  the CAT EARS must still read clearly: ears poke through, out from under, or around the hat.
  Never hide or flatten the ears, never draw a human head shape.
- Nothing in the artwork may be magenta or pink-purple: no magenta clothing, headwear, eyes, nose or fur.
- Clothing is muted and dark but NOT all identical black across the nine; vary the garment tones.

THE NINE, left to right, top to bottom:
{ROSTER}

Every portrait must read clearly when scaled down to 32 pixels: bold silhouette, large areas of coat colour,
strong contrast between face and background, no hairline detail."""


def circle_crop(image: Image.Image, size: int) -> Image.Image:
    scaled = image.convert("RGBA").resize((size * 4, size * 4), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4, size * 4), fill=255)
    scaled.putalpha(mask)
    return scaled.resize((size, size), Image.LANCZOS)


def main() -> int:
    key = os.environ.get("IMG_API_KEY")
    if not key:
        print("IMG_API_KEY not set", file=sys.stderr)
        return 2
    client = OpenAI(api_key=key, base_url="https://api-direct.derouter.ai/openai/v1", timeout=240.0)
    result = client.images.generate(
        model="gpt-image-2", prompt=PROMPT, size="1024x1024", quality="high",
    )
    sheet_path = OUT / "sheet.png"
    sheet_path.write_bytes(base64.b64decode(result.data[0].b64_json))
    print("sheet:", sheet_path)

    sheet = Image.open(sheet_path)
    width, height = sheet.size
    cell_w, cell_h = width // 3, height // 3
    for index, (slug, _beat, _collar, _coat) in enumerate(CAST):
        row, col = divmod(index, 3)
        tile = sheet.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
        tile.save(OUT / f"{slug}.png")
    print("tiles:", len(CAST))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
