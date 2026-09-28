import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";

const buttonVariants = cva("awh-ui-button", {
  variants: {
    variant: {
      default: "awh-ui-button-default",
      secondary: "awh-ui-button-secondary",
      ghost: "awh-ui-button-ghost",
      danger: "awh-ui-button-danger",
    },
    size: { default: "awh-ui-button-md", icon: "awh-ui-button-icon", sm: "awh-ui-button-sm" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
