"use client";

import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface NeuPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "raised" | "inset" | "flat";
  rounded?: "sm" | "md" | "lg" | "xl";
}

export function NeuPanel({ variant = "raised", rounded = "lg", className, ...rest }: NeuPanelProps) {
  return <div className={cx("neu-panel", className)} data-variant={variant} data-rounded={rounded} {...rest} />;
}
