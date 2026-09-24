"use client";

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cx } from "./cx";

export type LedState = "off" | "on" | "blink";

export interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `transport` is round (CUE / PLAY); `pad` is a square rubber pad; `ghost` has no extrusion until pressed. */
  variant?: "default" | "transport" | "pad" | "ghost";
  size?: "sm" | "md" | "lg";
  led?: LedState;
  /** LED / active glow colour (any CSS colour). */
  ledColor?: string;
  /**
   * Latched look (inset + lit). When provided, the button is exposed as a
   * toggle (`aria-pressed`) unless `aria-pressed` is set explicitly.
   */
  active?: boolean;
}

export function NeuButton({
  variant = "default",
  size = "md",
  led,
  ledColor,
  active,
  className,
  style,
  children,
  type = "button",
  "aria-pressed": ariaPressed,
  ...rest
}: NeuButtonProps) {
  return (
    <button
      type={type}
      className={cx("neu-btn neu-focusable", className)}
      data-variant={variant}
      data-size={size}
      data-active={active || undefined}
      aria-pressed={ariaPressed ?? active}
      style={ledColor ? ({ "--led": ledColor, ...style } as CSSProperties) : style}
      {...rest}
    >
      {led !== undefined && <span className="neu-led" data-state={led} aria-hidden="true" />}
      <span className="neu-btn-content">{children}</span>
    </button>
  );
}
