import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

const OpenContext = React.createContext<boolean | undefined>(undefined);

function Popover({
  open,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>): JSX.Element {
  return (
    <OpenContext.Provider value={open}>
      <PopoverPrimitive.Root open={open} {...props}>{children}</PopoverPrimitive.Root>
    </OpenContext.Provider>
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * The panel's box grows out of the corner it is anchored to, and shrinks back into that same
 * corner when it closes.
 *
 * Driven through the Web Animations API rather than CSS keyframes because the animation has to
 * survive being interrupted. A CSS animation restarts from its own first keyframe, so clicking
 * the trigger mid-open made the panel jump to full size and only then fade — measured at 39%
 * grown, with the closing animation starting from 100%. Here a single animation object spans
 * closed → open, and reversing is `playbackRate = -1`: WAAPI plays backwards from wherever it
 * currently is, so position stays continuous through any number of reversals.
 *
 * Owning that means owning presence too — Radix decides when to unmount by watching for a CSS
 * `animationend`, which never arrives for a WAAPI animation.
 */
function useGrowFromAnchor(open: boolean): {
  present: boolean;
  ref: React.RefCallback<HTMLDivElement>;
} {
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);
  const [present, setPresent] = React.useState(open);
  const animation = React.useRef<Animation | null>(null);

  if (open && !present) {
    setPresent(true);
  }

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

    if (animation.current === null) {
      const corner = ["--clip-t", "--clip-r", "--clip-b", "--clip-l"]
        .map((name) => style.getPropertyValue(name).trim() || "0")
        .join(" ");
      const created = node.animate(
        [
          { clipPath: `inset(${corner} round 12px)`, opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.25 },
          { clipPath: "inset(0px 0px 0px 0px round 12px)", opacity: 1, offset: 1 },
        ],
        {
          duration: parseFloat(style.getPropertyValue("--dur-overlay")) || 500,
          easing: style.getPropertyValue("--ease-spring").trim() || "ease-out",
          fill: "both",
        },
      );
      created.pause();
      created.currentTime = 0;
      animation.current = created;
    }

    const running = animation.current;
    running.playbackRate = open ? 1 : -1;
    running.play();
    // Only a reversal that reaches the start retires the panel; finishing forwards means open.
    running.onfinish = () => {
      if (running.playbackRate < 0) {
        setPresent(false);
      }
    };
  }, [node, open]);

  React.useEffect(() => {
    if (!present) {
      animation.current?.cancel();
      animation.current = null;
    }
  }, [present]);

  return { present, ref: setNode };
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, forwardedRef) => {
  const open = React.useContext(OpenContext) ?? false;
  const { present, ref } = useGrowFromAnchor(open);

  if (!present) {
    return null;
  }

  return (
    // forceMount keeps Radix from racing us to unmount; the presence above is the only owner.
    <PopoverPrimitive.Portal forceMount>
      <PopoverPrimitive.Content
        ref={(node) => {
          ref(node);
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef !== null) {
            forwardedRef.current = node;
          }
        }}
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
