import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  AgentPortrait,
  PORTRAIT_IDS,
  defaultPortraitId,
  portraitSrc,
  type AgentPortraitSize,
  type PortraitId,
} from "@/console/agent-portrait";
import { identityToken } from "@/console/identity";
import type { ExecutionEngine } from "@/console/provider-mark";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { AnimatedPopoverContent, Popover, PopoverTrigger } from "@/ui/popover";

/** Six per row: the pool divides evenly, so the grid never ends on a ragged partial row. */
const COLUMNS = 6;

/**
 * Lets a member be given a different face. The trigger is the member's own portrait rather than a
 * separate button, because the portrait is both the thing being changed and the only place a user
 * looks when they decide they want it changed.
 *
 * Only the face is selectable. Every candidate renders on the member's existing identity colour,
 * so what the grid shows is exactly what the member will look like — picking on a neutral swatch
 * and then having the colour applied afterwards would make half the choices misleading.
 */
export function AgentPortraitPicker({
  displayName,
  slug,
  portraitId,
  engine,
  size = "heading",
  disabled = false,
  onChange,
}: {
  displayName: string;
  slug: string;
  /** Currently chosen face; null means the member is still on the slug default. */
  portraitId: string | null;
  engine?: { cli: ExecutionEngine; providerId?: string };
  /**
   * Trigger size. A prop rather than a className override: with an engine badge, AgentPortrait
   * applies its className to both the badge wrapper and the portrait, so sizing that way lands
   * on two elements at once.
   */
  size?: AgentPortraitSize;
  disabled?: boolean;
  /** Null restores the slug default rather than freezing today's default as an explicit choice. */
  onChange(portraitId: PortraitId | null): void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const fallbackId = defaultPortraitId(slug);
  const effectiveId = isPortraitId(portraitId) ? portraitId : fallbackId;
  const background = `var(${identityToken(slug)})`;

  const portrait = (
    <AgentPortrait
      displayName={displayName}
      slug={slug}
      portraitId={portraitId}
      size={size}
      engine={engine}
    />
  );
  const trigger = portrait;

  if (disabled) {
    return trigger;
  }

  return (
    <Popover group="agent-portrait" open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("console.agentPortrait.change", { name: displayName || `@${slug}` })}
        className="rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {trigger}
      </PopoverTrigger>
      {/* 352px is what leaves the selection ring a 2px gap around a 40px face; see PortraitGrid. */}
      <AnimatedPopoverContent align="start" className="w-[352px] p-3">
        {/*
          A standing preview at the size the portrait is actually worn, so the face being judged
          is never the 40px thumbnail. It sits above the grid and stays put: picking updates it
          in place rather than closing the popover, which is what makes comparing successive
          candidates possible at all — the previous build committed and dismissed on first click,
          so a user could only ever see one candidate large, and only after the choice was made.
        */}
        <div className="flex flex-col items-center gap-2 pb-1">
          <AgentPortrait
            displayName={displayName}
            slug={slug}
            portraitId={portraitId}
            size="preview"
            engine={engine}
          />
          <p className="max-w-full truncate text-sm text-ink">{displayName || `@${slug}`}</p>
        </div>
        <PortraitGrid
          effectiveId={effectiveId}
          fallbackId={fallbackId}
          background={background}
          onPick={(picked) => onChange(picked === fallbackId ? null : picked)}
        />
      </AnimatedPopoverContent>
    </Popover>
  );
}

/**
 * A radiogroup with roving tabindex: 36 candidates would otherwise be 36 tab stops to cross.
 *
 * Faces render at 40px, not at the 28px a denser grid would allow. `generate-avatar-set` records
 * that many portrait styles simply stop reading at 28–32px, and a candidate you cannot make out
 * is not a candidate. Legibility beyond that is the standing preview's job, not a hover state's:
 * the preview serves pointer, keyboard and touch identically, and it survives the choice.
 *
 * Each button fills its grid column instead of carrying a fixed width, so the columns stay the
 * single source of the layout and cannot be overflowed by a mismatched tile size. The popover
 * width is then chosen so those columns land on 48px: minus the 2px selection border that leaves
 * 44px around a 40px face, i.e. a 2px gap. Sizing the column any tighter presses the ring flat
 * against the portrait, where it stops reading as a selection and starts reading as a heavy
 * outline on the artwork.
 */
function PortraitGrid({
  effectiveId,
  fallbackId,
  background,
  onPick,
}: {
  effectiveId: PortraitId;
  fallbackId: PortraitId;
  background: string;
  onPick(id: PortraitId): void;
}): JSX.Element {
  const { t } = useI18n();
  const [focusedIndex, setFocusedIndex] = useState(() =>
    Math.max(0, PORTRAIT_IDS.indexOf(effectiveId)),
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (!shouldFocus.current) {
      return;
    }
    shouldFocus.current = false;
    const options = gridRef.current?.querySelectorAll<HTMLButtonElement>("[role='radio']");
    options?.[focusedIndex]?.focus();
  }, [focusedIndex]);

  const move = (nextIndex: number): void => {
    const clamped = Math.min(PORTRAIT_IDS.length - 1, Math.max(0, nextIndex));
    shouldFocus.current = true;
    setFocusedIndex(clamped);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    if (event.key in step) {
      event.preventDefault();
      move(focusedIndex + step[event.key]!);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      move(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      move(PORTRAIT_IDS.length - 1);
    }
  };

  return (
    <div
      ref={gridRef}
      role="radiogroup"
      aria-label={t("console.agentPortrait.groupLabel")}
      className="mt-2 grid grid-cols-6 gap-2"
      onKeyDown={handleKeyDown}
    >
      {PORTRAIT_IDS.map((id, index) => {
        const selected = id === effectiveId;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t("console.agentPortrait.option", {
              index: String(index + 1),
              total: String(PORTRAIT_IDS.length),
            })}
            tabIndex={index === focusedIndex ? 0 : -1}
            className={cn(
              "inline-flex aspect-square w-full items-center justify-center rounded-full border-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "border-accent" : "border-transparent hover:border-line-strong",
            )}
            // Selection and roving focus move together, as a radiogroup requires. Letting focus
            // lag behind leaves two accented rings on screen at once and makes the arrow keys
            // resume from whatever was selected when the popover opened.
            onClick={() => {
              move(index);
              onPick(id);
            }}
          >
            <span
              aria-hidden="true"
              className="inline-block h-10 w-10 overflow-hidden rounded-full"
              style={{ backgroundColor: background }}
            >
              <img src={portraitSrc(id)} alt="" loading="lazy" decoding="async" className="h-full w-full" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

function isPortraitId(value: string | null): value is PortraitId {
  return value !== null && (PORTRAIT_IDS as readonly string[]).includes(value);
}
