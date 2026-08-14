import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useGrowFromAnchor } from "@/ui/overlay-grow";

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
        className={cn("z-50 rounded-xl border border-line bg-sunken p-3 text-ink", className)}
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
