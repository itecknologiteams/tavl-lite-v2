import { create } from 'zustand';

export const FOOTER_HEIGHT = 32;

interface LayoutState {
  trackBarHeight: number;
  setTrackBarHeight: (height: number) => void;
  /** Total width in px of right-side panels overlaying the map (detail + history). */
  rightPanelWidth: number;
  setRightPanelWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  trackBarHeight: 0,
  setTrackBarHeight: (height) => set({ trackBarHeight: height }),
  rightPanelWidth: 0,
  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),
}));
