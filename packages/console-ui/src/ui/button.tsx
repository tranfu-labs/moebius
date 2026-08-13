import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 text-sm font-normal transition-[color,background-color,border-color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-ink text-canvas hover:opacity-85",
        outline: "border border-line bg-card text-ink hover:bg-hover",
        ghost: "text-sub hover:bg-hover hover:text-ink",
        danger: "border border-danger bg-card text-danger hover:bg-hover",
        subtle: "bg-sel text-ink hover:bg-hover"
      },
      size: {
        default: "h-9 px-4",
        sm: "h-[30px] px-3 text-sm",
        lg: "h-9 px-3.5",
        icon: "h-8 w-8 px-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
