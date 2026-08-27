import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useGrowFromAnchor } from "@/ui/overlay-grow";

const OpenContext = React.createContext(false);

/**
 * A select whose list is ours to draw. A native `<select>` hands its popup to the operating
 * system, which then ignores the product's surfaces entirely — a light system panel dropping out
 * of a dark control is the one place on this page where the design simply stops.
 *
 * Built on Radix like the six other primitives already in this package, so the popup inherits the
 * same overlay behaviour as the popover and the dropdown menu rather than becoming a third kind
 * of floating thing.
 */
function Select({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>): JSX.Element {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? uncontrolled;
  const handleOpenChange = React.useCallback((next: boolean) => {
    if (open === undefined) {
      setUncontrolled(next);
    }
    onOpenChange?.(next);
  }, [open, onOpenChange]);

  return (
    <OpenContext.Provider value={isOpen}>
      <SelectPrimitive.Root open={isOpen} onOpenChange={handleOpenChange} {...props}>
        {children}
      </SelectPrimitive.Root>
    </OpenContext.Provider>
  );
}

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-sunken px-2.5 text-sm text-ink transition-colors",
      "hover:border-accent/60 focus:border-accent focus:outline-none",
      "disabled:cursor-default disabled:opacity-50 data-[placeholder]:text-hint",
      className,
    )}
    {...props}
  >
    <span className="min-w-0 truncate text-left">{children}</span>
    <SelectPrimitive.Icon asChild>
      <ChevronDown
        className="h-3.5 w-3.5 shrink-0 text-hint transition-transform duration-150"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, position = "popper", sideOffset = 6, children, ...props }, forwardedRef) => {
  const open = React.useContext(OpenContext);
  // Same engine as the popover — interruptible, reversible, group-preempting — but the geometry
  // is vertical only: the list is exactly as wide as its trigger, so there is nothing for it to
  // grow into sideways. It unrolls.
  const { present, ref } = useGrowFromAnchor(open, "select");
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
    <SelectPrimitive.Portal forceMount>
      <SelectPrimitive.Content
        ref={setRefs}
        position={position}
        sideOffset={sideOffset}
        className={cn(
          "z-layer-floating min-w-[var(--radix-select-trigger-width)] rounded-lg border border-line bg-sunken p-1 text-ink",
          className,
        )}
        data-overlay-clip="vertical"
        {...props}
      >
        <SelectPrimitive.Viewport className="max-h-72">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-lg py-1.5 pl-2 pr-7 text-sm outline-none",
      "data-[highlighted]:bg-hover data-[state=checked]:bg-sel",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
      <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} aria-hidden="true" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
