import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { useGrowFromAnchor } from "@/ui/overlay-grow";

const OpenContext = React.createContext(false);

/**
 * Wraps Radix's root so the open state is always readable. Callers here are mostly uncontrolled
 * (`<DropdownMenu>` with no `open`), but the enter and exit animations need to know the state.
 * Passing `open` from outside still works; both usages hold.
 */
function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>): JSX.Element {
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
      <DropdownMenuPrimitive.Root open={isOpen} onOpenChange={handleOpenChange} {...props}>
        {children}
      </DropdownMenuPrimitive.Root>
    </OpenContext.Provider>
  );
}
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-lg px-2 py-1.5 text-sm outline-none focus:bg-hover",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" strokeWidth={1.5} />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn("z-layer-floating min-w-32 rounded-xl border border-line bg-sunken p-1 text-ink", className)}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, forwardedRef) => {
  const open = React.useContext(OpenContext);
  // Shares the popover's behaviour: the menu grows out of the corner it is anchored to, and is
  // interruptible and reversible.
  const { present, ref } = useGrowFromAnchor(open, "dropdown-menu");
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
    <DropdownMenuPrimitive.Portal forceMount>
      <DropdownMenuPrimitive.Content
        ref={setRefs}
        sideOffset={sideOffset}
        className={cn("z-layer-floating min-w-36 rounded-xl border border-line bg-sunken p-1 text-ink", className)}
        data-overlay-clip=""
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-lg px-2 py-1.5 text-sm outline-none focus:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-hover",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" strokeWidth={1.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
};
