"use client";
import type { ComponentType } from "react";
import { BrowseLayout } from "./BrowseLayout";
import { EssentialLayout } from "./EssentialLayout";
import { PerformanceLayout } from "./PerformanceLayout";
import { TurntableLayout } from "./TurntableLayout";
import type { LayoutId } from "./types";
import { VerticalLayout } from "./VerticalLayout";

/**
 * Renders the desktop console body (waveforms + decks + mixer + library) in
 * the chosen preset arrangement. Intended for ≥1024px; the mobile tabs stay
 * outside this component.
 */
export const ConsoleLayout = ({ layout, className }: { layout: LayoutId; className?: string }) => {
  const Body = LAYOUT_COMPONENTS[layout] ?? PerformanceLayout;
  return (
    <div className={className}>
      <Body />
    </div>
  );
};

const LAYOUT_COMPONENTS: Record<LayoutId, ComponentType> = {
  performance: PerformanceLayout,
  vertical: VerticalLayout,
  essential: EssentialLayout,
  browse: BrowseLayout,
  turntable: TurntableLayout,
};
