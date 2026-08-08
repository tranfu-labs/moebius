import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  AgentPortrait,
  PORTRAIT_IDS,
  defaultPortraitId,
  portraitSrc,
  type PortraitId,
} from "@/console/agent-portrait";
import { identityToken } from "@/console/identity";
import type { ExecutionEngine } from "@/console/provider-mark";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

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
  disabled = false,
  onChange,
}: {
  displayName: string;
  slug: string;
  /** Currently chosen face; null means the member is still on the slug default. */
  portraitId: string | null;
  engine?: { cli: ExecutionEngine; providerId?: string };
  disabled?: boolean;
  /** Null restores the slug default rather than freezing today's default as an explicit choice. */
  onChange(portraitId: PortraitId | null): void;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const fallbackId = defaultPortraitId(slug);
  const effectiveId = isPortraitId(portraitId) ? portraitId : fallbackId;
  const background = `var(${identityToken(slug)})`;

  const trigger = (
    <AgentPortrait
      displayName={displayName}
      slug={slug}
      portraitId={portraitId}
      size="heading"
      engine={engine}
    />
  );

  if (disabled) {
    return trigger;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("console.agentPortrait.change", { name: displayName || `@${slug}` })}
        className="rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {trigger}
      </PopoverTrigger>
      {/* 328px is what puts six columns at a 40px face. See PortraitGrid on why 40. */}
      <PopoverContent align="start" className="w-[328px] p-3">
        <p className="text-xs text-sub">{t("console.agentPortrait.hint")}</p>
        <PortraitGrid
          effectiveId={effectiveId}
          fallbackId={fallbackId}
          background={background}
          onPick={(picked) => {
            onChange(picked === fallbackId ? null : picked);
            setOpen(false);
          }}
        />
        <button
          type="button"
          disabled={portraitId === null}
          className={cn(
            "mt-3 w-full rounded-md border border-line px-2 py-1.5 text-xs transition-colors",
            portraitId === null ? "text-hint" : "text-sub hover:bg-hover hover:text-ink",
          )}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          {t("console.agentPortrait.restoreDefault")}
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A radiogroup with roving tabindex: 36 candidates would otherwise be 36 tab stops between the
 * hint text and the restore button.
 *
 * Faces render at 40px, not at the 28px a denser grid would allow. `generate-avatar-set` records
 * that many portrait styles simply stop reading at 28–32px, and a candidate you cannot make out
 * is not a candidate. Enlarging the tiles outright is deliberate in preference to magnifying one
 * on hover: hover does not exist for keyboard or touch, so the people who most need the larger
 * view would be the ones who never get it — and neighbour-scaling is a form this product has
 * already ruled out for the relay rail and the sidebar info panel.
 *
 * Each button fills its grid column instead of carrying a fixed width, so the columns stay the
 * single source of the layout and cannot be overflowed by a mismatched tile size.
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
            aria-label={t(
              id === fallbackId ? "console.agentPortrait.optionDefault" : "console.agentPortrait.option",
              { index: String(index + 1), total: String(PORTRAIT_IDS.length) },
            )}
            tabIndex={index === focusedIndex ? 0 : -1}
            className={cn(
              "inline-flex aspect-square w-full items-center justify-center rounded-full border-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              selected ? "border-accent" : "border-transparent hover:border-line-strong",
            )}
            onClick={() => onPick(id)}
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
