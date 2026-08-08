import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const OpenContext = React.createContext<{ open: boolean; group?: string }>({ open: false });

/**
 * `group` names the set this popover belongs to — one per component that can put several
 * instances on screen, e.g. the run-info popover attached to every message. Opening one preempts
 * the rest of its group; see `useGrowFromAnchor`.
 */
function Popover({
  open = false,
  group,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root> & { group?: string }): JSX.Element {
  const value = React.useMemo(() => ({ open, group }), [open, group]);
  return (
    <OpenContext.Provider value={value}>
      <PopoverPrimitive.Root open={open} {...props}>{children}</PopoverPrimitive.Root>
    </OpenContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

/** Members register while they are on screen, so an opening sibling can find them. */
const groups = new Map<string, Set<() => void>>();

function announceOpen(group: string, self: () => void): void {
  for (const preempt of groups.get(group) ?? []) {
    if (preempt !== self) {
      preempt();
    }
  }
}

function readDuration(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = style.getPropertyValue(name).trim();
  const value = parseFloat(raw);
  if (Number.isNaN(value)) {
    return fallback;
  }
  return raw.endsWith("ms") ? value : value * 1000;
}

/**
 * The panel's box grows out of the corner it is anchored to, and collapses back into that same
 * corner when it closes.
 *
 * Every transition is a fresh animation starting from the element's *current* computed geometry,
 * which is what makes interruption continuous: reversing mid-flight picks up exactly where the
 * panel is rather than restarting. CSS animations cannot do this — they restart from their own
 * first frame, which made a mid-open dismissal jump the panel from 39% grown to full size.
 *
 * Closing is deliberately not the entrance played backwards. The entrance rides a critically
 * damped spring, and that spring's long tail, reversed, barely moves for the first half and then
 * slams shut; measured, a reversed close was still at 7.7% after 240ms. The exit gets its own
 * shorter, plainer curve.
 *
 * Owning all this means owning presence too: Radix decides when to unmount by watching for a CSS
 * `animationend`, which never arrives for a Web Animations API animation.
 */
function useGrowFromAnchor(open: boolean, group?: string): {
  present: boolean;
  ref: React.RefCallback<HTMLDivElement>;
} {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const [present, setPresent] = React.useState(open);
  const animation = React.useRef<Animation | null>(null);
  const closing = React.useRef(false);
  const preempted = React.useRef(false);

  if (open && !present) {
    setPresent(true);
  }

  /**
   * Preempted means another member of the group is taking over. This panel is no longer what the
   * user is looking at, so it gets out of the way instead of finishing at its own pace — that is
   * what makes switching between siblings feel immediate. Note it only speeds the exit up; a
   * dismissal nobody is replacing stays at full length, because then it *is* the thing on screen.
   */
  const preempt = React.useCallback(() => {
    preempted.current = true;
    if (closing.current) {
      // Already on the way out: speed the running animation up in place rather than restart it.
      animation.current?.updatePlaybackRate(2.4);
    }
  }, []);

  React.useEffect(() => {
    if (group === undefined || !present) {
      return;
    }
    const members = groups.get(group) ?? new Set<() => void>();
    members.add(preempt);
    groups.set(group, members);
    return () => {
      members.delete(preempt);
      if (members.size === 0) {
        groups.delete(group);
      }
    };
  }, [group, present, preempt]);

  React.useEffect(() => {
    if (node === null) {
      return;
    }
    const style = getComputedStyle(node);
    const reduced = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // jsdom has no Web Animations API, and a reduced-motion request wants the end state at once.
    if (typeof node.animate !== "function" || reduced) {
      setPresent(open);
      return;
    }

    if (open && group !== undefined) {
      announceOpen(group, preempt);
    }

    const corner = ["--clip-t", "--clip-r", "--clip-b", "--clip-l"]
      .map((name) => style.getPropertyValue(name).trim() || "0")
      .join(" ");
    const collapsed = `inset(${corner} round 12px)`;
    const expanded = "inset(0px 0px 0px 0px round 12px)";

    // Whatever is on screen right now, mid-animation or not, is where the next one starts. A
    // fresh mount has no computed clip yet, and there the fallback has to follow the direction:
    // an opening panel starts collapsed, and only an already-open one starts expanded.
    const currentClip = style.clipPath === "none"
      ? (open ? collapsed : expanded)
      : style.clipPath;
    const currentOpacity = Number.parseFloat(style.opacity);
    const from = Number.isNaN(currentOpacity) ? (open ? 0 : 1) : currentOpacity;

    animation.current?.cancel();
    closing.current = !open;

    const next = node.animate(
      open
        ? [{ clipPath: currentClip, opacity: from }, { clipPath: expanded, opacity: 1 }]
        : [{ clipPath: currentClip, opacity: from }, { clipPath: collapsed, opacity: 0 }],
      {
        duration: open
          ? readDuration(style, "--dur-overlay", 500)
          : readDuration(
            style,
            preempted.current ? "--dur-overlay-preempt" : "--dur-overlay-out",
            preempted.current ? 110 : 260,
          ),
        easing: open
          ? style.getPropertyValue("--ease-spring").trim() || "ease-out"
          : style.getPropertyValue("--ease").trim() || "ease-out",
        fill: "both",
      },
    );
    animation.current = next;
    if (open) {
      preempted.current = false;
    }
    next.onfinish = () => {
      if (closing.current) {
        setPresent(false);
      }
    };
  }, [node, open, group, preempt]);

  React.useEffect(() => {
    if (!present) {
      animation.current?.cancel();
      animation.current = null;
      closing.current = false;
      preempted.current = false;
    }
  }, [present]);

  return { present, ref: setNode };
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, forwardedRef) => {
  const { open, group } = React.useContext(OpenContext);
  const { present, ref } = useGrowFromAnchor(open, group);
  const setRefs = React.useCallback((node: HTMLDivElement | null) => {
    ref(node);
    if (typeof forwardedRef === "function") {
      forwardedRef(node);
    } else if (forwardedRef !== null) {
      forwardedRef.current = node;
    }
  }, [ref, forwardedRef]);

  if (!present) {
    return null;
  }

  return (
    // forceMount keeps Radix from racing us to unmount; the presence above is the only owner.
    <PopoverPrimitive.Portal forceMount>
      <PopoverPrimitive.Content
        ref={setRefs}
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 rounded-md border border-line bg-sunken p-3 text-ink", className)}
        // The growth corner comes from Radix's resolved side/align via globals.css, so it stays
        // correct when the popover flips against a viewport edge.
        data-overlay-clip=""
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
