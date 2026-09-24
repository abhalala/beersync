"use client";
import { forwardRef, type ComponentType } from "react";
import { BrowseLayout } from "./BrowseLayout";
import { EssentialLayout } from "./EssentialLayout";
import { PerformanceLayout } from "./PerformanceLayout";
import { TurntableLayout } from "./TurntableLayout";
import type { LayoutId } from "./types";
import { VerticalLayout } from "./VerticalLayout";

/**
 * Renders the desktop console body (waveforms + decks + mixer + library) in
 * the chosen preset arrangement. Intended for ≥1024px; the mobile tabs stay
 * outside this component. Forwards its scroll container ref so the parent
 * can reset scroll position when the preset changes (presets differ a lot
 * in total height).
 */
export const ConsoleLayout = forwardRef<HTMLDivElement, { layout: LayoutId; className?: string }>(
  ({ layout, className }, ref) => {
    const Body = LAYOUT_COMPONENTS[layout] ?? PerformanceLayout;
    return (
      <div ref={ref} className={className}>
        <Body />
      </div>
    );
  }
);
ConsoleLayout.displayName = "ConsoleLayout";

const LAYOUT_COMPONENTS: Record<LayoutId, ComponentType> = {
  performance: PerformanceLayout,
  vertical: VerticalLayout,
  essential: EssentialLayout,
  browse: BrowseLayout,
  turntable: TurntableLayout,
};
