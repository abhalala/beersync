"use client";

import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { cx } from "./cx";

export interface NeuToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Visible caption, e.g. "QUANTIZE". Also the accessible name unless aria-label is set. */
  label: string;
  ledColor?: string;
}

/** Small latching switch with a status LED (QUANTIZE, KEY SYNC, SLIP …). */
export function NeuToggle({
  checked,
  onCheckedChange,
  label,
  ledColor,
  className,
  style,
  onClick,
  ...rest
}: NeuToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx("neu-toggle neu-focusable", className)}
      data-active={checked || undefined}
      style={ledColor ? ({ "--led": ledColor, ...style } as CSSProperties) : style}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange?.(!checked);
      }}
      {...rest}
    >
      <span className="neu-led" data-state={checked ? "on" : "off"} aria-hidden="true" />
      <span className="neu-toggle-label">{label}</span>
    </button>
  );
}
