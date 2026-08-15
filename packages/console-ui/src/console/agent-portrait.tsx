import bengal from "@/assets/portraits/bengal.webp";
import blackSmoke from "@/assets/portraits/black-smoke.webp";
import blackWhiteCow from "@/assets/portraits/black-white-cow.webp";
import blackWhitePatch from "@/assets/portraits/black-white-patch.webp";
import blueCream from "@/assets/portraits/blue-cream.webp";
import bluePoint from "@/assets/portraits/blue-point.webp";
import britishBlue from "@/assets/portraits/british-blue.webp";
import brownTabby from "@/assets/portraits/brown-tabby.webp";
import brownTabbyWhite from "@/assets/portraits/brown-tabby-white.webp";
import calico from "@/assets/portraits/calico.webp";
import chocolateBurmese from "@/assets/portraits/chocolate-burmese.webp";
import cinnamonAby from "@/assets/portraits/cinnamon-aby.webp";
import creamMaine from "@/assets/portraits/cream-maine.webp";
import creamWhiteFluff from "@/assets/portraits/cream-white-fluff.webp";
import egyptianMau from "@/assets/portraits/egyptian-mau.webp";
import fawnOriental from "@/assets/portraits/fawn-oriental.webp";
import gingerTabby from "@/assets/portraits/ginger-tabby.webp";
import gingerWhite from "@/assets/portraits/ginger-white.webp";
import goldenShaded from "@/assets/portraits/golden-shaded.webp";
import greyWhiteTuxedo from "@/assets/portraits/grey-white-tuxedo.webp";
import lilacPoint from "@/assets/portraits/lilac-point.webp";
import orangeChonk from "@/assets/portraits/orange-chonk.webp";
import ragdoll from "@/assets/portraits/ragdoll.webp";
import redLonghair from "@/assets/portraits/red-longhair.webp";
import russianBlue from "@/assets/portraits/russian-blue.webp";
import sealPoint from "@/assets/portraits/seal-point.webp";
import silverMackerel from "@/assets/portraits/silver-mackerel.webp";
import silverShaded from "@/assets/portraits/silver-shaded.webp";
import silverTabbyLonghair from "@/assets/portraits/silver-tabby-longhair.webp";
import smokeGrey from "@/assets/portraits/smoke-grey.webp";
import sphynx from "@/assets/portraits/sphynx.webp";
import torbie from "@/assets/portraits/torbie.webp";
import tortoiseshell from "@/assets/portraits/tortoiseshell.webp";
import tuxedo from "@/assets/portraits/tuxedo.webp";
import whiteLonghair from "@/assets/portraits/white-longhair.webp";
import whiteOddEyed from "@/assets/portraits/white-odd-eyed.webp";
import { identityToken, portraitHash } from "@/console/identity";
import { ProviderMark, type ExecutionEngine } from "@/console/provider-mark";
import { cn } from "@/lib/utils";

/**
 * A fixed pool of pre-generated character portraits, picked by a stable hash of the slug and
 * drawn on the identity colour that same slug already resolves to. Face and colour are hashed
 * independently, so 36 faces multiply out to 216 combinations — that headroom is what stops
 * two members of one team from looking alike, which is far more jarring than a collision
 * across teams because they sit side by side.
 *
 * The pool carries no occupation meaning: a "legal" agent may draw any face in it. A portrait
 * is an identity anchor for scanning, not a description of the role.
 *
 * Keyed by a stable id rather than ordered by position, because a chosen portrait is persisted:
 * storing an index would silently re-point every existing choice the moment the pool grows.
 */
const PORTRAITS = {
  bengal,
  "black-smoke": blackSmoke,
  "black-white-cow": blackWhiteCow,
  "black-white-patch": blackWhitePatch,
  "blue-cream": blueCream,
  "blue-point": bluePoint,
  "british-blue": britishBlue,
  "brown-tabby": brownTabby,
  "brown-tabby-white": brownTabbyWhite,
  calico,
  "chocolate-burmese": chocolateBurmese,
  "cinnamon-aby": cinnamonAby,
  "cream-maine": creamMaine,
  "cream-white-fluff": creamWhiteFluff,
  "egyptian-mau": egyptianMau,
  "fawn-oriental": fawnOriental,
  "ginger-tabby": gingerTabby,
  "ginger-white": gingerWhite,
  "golden-shaded": goldenShaded,
  "grey-white-tuxedo": greyWhiteTuxedo,
  "lilac-point": lilacPoint,
  "orange-chonk": orangeChonk,
  ragdoll,
  "red-longhair": redLonghair,
  "russian-blue": russianBlue,
  "seal-point": sealPoint,
  "silver-mackerel": silverMackerel,
  "silver-shaded": silverShaded,
  "silver-tabby-longhair": silverTabbyLonghair,
  "smoke-grey": smokeGrey,
  sphynx,
  torbie,
  tortoiseshell,
  tuxedo,
  "white-longhair": whiteLonghair,
  "white-odd-eyed": whiteOddEyed,
} as const;

export type PortraitId = keyof typeof PORTRAITS;

/** Pool order is the picker's grid order, so it stays fixed: append new faces, never reorder. */
export const PORTRAIT_IDS = Object.keys(PORTRAITS) as PortraitId[];

/** `preview` exists for surfaces whose whole job is showing the face itself, not labelling a row. */
export type AgentPortraitSize = "compact" | "stack" | "heading" | "hero" | "preview";

/** The face a slug falls back to when the user has not chosen one. */
export function defaultPortraitId(slug: string): PortraitId {
  return PORTRAIT_IDS[portraitHash(slug) % PORTRAIT_IDS.length]!;
}

export function portraitSrc(id: PortraitId): string {
  return PORTRAITS[id];
}

/**
 * Resolves to the chosen face, or the slug's default. An unknown id also falls back rather than
 * rendering an empty frame: a stored choice can outlive the asset it names once the pool changes.
 */
export function portraitFor(slug: string, portraitId?: string | null): string {
  if (portraitId !== undefined && portraitId !== null && portraitId in PORTRAITS) {
    return PORTRAITS[portraitId as PortraitId];
  }
  return PORTRAITS[defaultPortraitId(slug)];
}

/** Engine mark scales with the portrait so callers never size the badge by hand. */
const MARK_SIZE: Record<AgentPortraitSize, { badge: string; glyph: string; offset: string }> = {
  compact: { badge: "h-3 w-3", glyph: "h-2 w-2", offset: "-bottom-0.5 -right-0.5" },
  stack: { badge: "h-3.5 w-3.5", glyph: "h-2.5 w-2.5", offset: "-bottom-0.5 -right-0.5" },
  heading: { badge: "h-4 w-4", glyph: "h-2.5 w-2.5", offset: "-bottom-0.5 -right-0.5" },
  hero: { badge: "h-5 w-5", glyph: "h-3 w-3", offset: "-bottom-1 -right-1" },
  preview: { badge: "h-6 w-6", glyph: "h-3.5 w-3.5", offset: "-bottom-1 -right-1" },
};

const FRAME_SIZE: Record<AgentPortraitSize, string> = {
  compact: "h-5 w-5",
  stack: "h-7 w-7",
  heading: "h-8 w-8",
  hero: "h-14 w-14",
  preview: "h-20 w-20",
};

export function AgentPortrait({
  displayName,
  slug,
  portraitId,
  size = "compact",
  shape = "circle",
  engine,
  className,
  title,
}: {
  displayName: string;
  slug: string;
  /** The face this member has been given; omitted or unknown falls back to the slug's default. */
  portraitId?: string | null;
  size?: AgentPortraitSize;
  /** Circle for individuals, rounded square for teams — the usual container/person split. */
  shape?: "circle" | "squircle";
  /** Execution engine behind this agent; renders as a badge on the portrait. */
  engine?: { cli: ExecutionEngine; providerId?: string };
  className?: string;
  title?: string;
}): JSX.Element {
  const mark = MARK_SIZE[size];
  const portrait = (
    <span
      aria-hidden="true"
      title={title ?? displayName}
      data-agent-portrait={slug}
      className={cn(
        "inline-block shrink-0 overflow-hidden",
        shape === "circle" ? "rounded-full" : "rounded-md",
        FRAME_SIZE[size],
        className,
      )}
      style={{ backgroundColor: `var(${identityToken(slug)})` }}
    >
      {/* Proportion is baked into the asset, so the image simply fills the frame. */}
      <img src={portraitFor(slug, portraitId)} alt="" loading="lazy" decoding="async" className="h-full w-full" />
    </span>
  );

  if (engine === undefined) {
    return portrait;
  }
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {portrait}
      <span
        aria-hidden="true"
        data-agent-engine={engine.cli}
        className={cn(
          "absolute inline-flex items-center justify-center rounded-full border border-line bg-card",
          mark.badge,
          mark.offset,
        )}
      >
        <ProviderMark cli={engine.cli} providerId={engine.providerId} className={cn(mark.glyph, "text-sub")} />
      </span>
    </span>
  );
}
