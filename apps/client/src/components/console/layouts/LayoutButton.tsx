"use client";
import { LayoutGrid } from "lucide-react";
import { useState } from "react";
import { LayoutPicker } from "./LayoutPicker";
import { LAYOUTS, type LayoutId } from "./types";

/** Top-bar button that opens the layout preset picker (desktop only) */
export const LayoutButton = ({ layout, onChange }: { layout: LayoutId; onChange: (id: LayoutId) => void }) => {
  const [open, setOpen] = useState(false);
  const current = LAYOUTS.find((l) => l.id === layout);

  return (
    <div className="relative hidden lg:block">
      <button
        type="button"
        className="neu-chip flex items-center gap-1.5 text-xs"
        aria-expanded={open}
        title="Choose a console layout"
        onClick={() => setOpen((o) => !o)}
      >
        <LayoutGrid className="size-3.5" />
        {current?.label ?? "Layout"}
      </button>
      {open && (
        <div className="neu-popover absolute top-10 right-0 z-50 w-72 p-2">
          <LayoutPicker
            layout={layout}
            onChange={(id) => {
              onChange(id);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
};
