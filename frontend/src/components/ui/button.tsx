import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:opacity-80",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:[@media(hover:hover)]:bg-primary/90 active:bg-primary/85",
        destructive: "bg-destructive text-destructive-foreground hover:[@media(hover:hover)]:bg-destructive/90 active:bg-destructive/85",
        outline: "border border-input bg-background hover:[@media(hover:hover)]:bg-accent hover:[@media(hover:hover)]:text-accent-foreground active:bg-accent/80",
        secondary: "bg-secondary text-secondary-foreground hover:[@media(hover:hover)]:bg-secondary/80 active:bg-secondary/70",
        ghost: "hover:[@media(hover:hover)]:bg-accent hover:[@media(hover:hover)]:text-accent-foreground active:bg-accent/80",
        link: "text-primary underline-offset-4 hover:[@media(hover:hover)]:underline",
      },
      size: {
        default: "min-h-[2.5rem] px-4 py-2",
        sm: "min-h-[2.25rem] rounded-md px-3",
        lg: "min-h-[2.75rem] rounded-md px-8",
        icon: "min-h-[2.75rem] min-w-[2.75rem] h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
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
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
