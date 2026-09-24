"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface LcdDisplayProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** Colour of the main readout (defaults to the LCD text colour). */
  accent?: string;
  size?: "sm" | "md" | "lg";
}

/** Inset LCD readout with tabular digits (BPM, time, key, pitch %). */
export function LcdDisplay({ label, value, sub, accent, size = "md", className, style, ...rest }: LcdDisplayProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("neu-lcd", className)}
      data-size={size}
      style={accent ? ({ "--lcd-accent": accent, ...style } as CSSProperties) : style}
      {...rest}
    >
      <span className="neu-lcd-label">{label}</span>
      <span className="neu-lcd-value">{value}</span>
      {sub !== undefined && <span className="neu-lcd-sub">{sub}</span>}
    </div>
  );
}
