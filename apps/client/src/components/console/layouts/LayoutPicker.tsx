"use client";
import { cn } from "@/lib/utils";
import { LAYOUTS, type LayoutId } from "./types";

/**
 * Accessible radiogroup for picking the console layout preset. Neumorphic
 * chip row; each option shows its label and a one-line description.
 */
export const LayoutPicker = ({
  layout,
  onChange,
  className,
}: {
  layout: LayoutId;
  onChange: (id: LayoutId) => void;
  className?: string;
}) => (
  <div role="radiogroup" aria-label="Console layout" className={cn("neu-well flex flex-col gap-1 p-1.5", className)}>
    {LAYOUTS.map((preset) => (
      <button
        key={preset.id}
        type="button"
        role="radio"
        aria-checked={layout === preset.id}
        onClick={() => onChange(preset.id)}
        className={cn(
          "neu-chip flex-col items-start gap-0.5 px-2.5 py-1.5 text-left",
          layout === preset.id && "neu-inset-sm text-[var(--neu-text)]"
        )}
      >
        <span className="flex w-full items-baseline justify-between gap-2 text-xs font-semibold">
          {preset.label}
          <span className="text-[9px] font-normal text-[var(--neu-muted)]">{preset.inspiredBy}</span>
        </span>
        <span className="text-[10px] font-normal text-[var(--neu-muted)]">{preset.description}</span>
      </button>
    ))}
  </div>
);
