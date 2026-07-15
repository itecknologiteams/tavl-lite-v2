import { create } from 'zustand';
import type { TrackHistory, TrackPoint, StopPoint, Vehicle } from '@apptypes/vehicle';

// Track display modes
export type TrackMode = 'raw' | 'osrm';

// Load persisted track mode from localStorage
const getPersistedTrackMode = (): TrackMode => {
  try {
    const saved = localStorage.getItem('trackMode');
    if (saved === 'raw' || saved === 'osrm') return saved;
  } catch {}
  return 'raw';
};

interface TrackState {
  // Track data
  isLoading: boolean;
  error: string | null;
  currentTrack: TrackHistory | null;
  
  // Track mode (raw GPS or OSRM road-snapped)
  trackMode: TrackMode;
  osrmRoute: [number, number][] | null; // OSRM matched route coordinates
  
  // Dialog state
  isDialogOpen: boolean;
  selectedVehicle: Vehicle | null;
  
  // Playback state
  isPlaying: boolean;
  playbackSpeed: number; // 1x, 2x, 4x, 8x
  currentPointIndex: number;

  // One-shot focus (used by raw packet list / timeline click)
  focusedTrackPoint: { lat: number; lng: number; zoom?: number } | null;
  
  // Display options
  showStops: boolean;
  showSpeedColors: boolean;
  showGsmMarkers: boolean;
  showLatencyMarkers: boolean;
  showIgnitionEvents: boolean;
  showSpeedEvents: boolean;
  showIdleEvents: boolean;
  speedViolationThreshold: number;
  showTripDetails: boolean;
  
  // Actions
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentTrack: (track: TrackHistory | null) => void;
  
  // Track mode
  setTrackMode: (mode: TrackMode) => void;
  setOsrmRoute: (route: [number, number][] | null) => void;
  
  openDialog: (vehicle: Vehicle) => void;
  closeDialog: (keepTrack?: boolean) => void;
  
  // Playback controls
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setCurrentPointIndex: (index: number | ((prev: number) => number)) => void;
  advancePlayback: () => void;

  focusTrackPoint: (lat: number, lng: number, zoom?: number) => void;
  clearFocusedTrackPoint: () => void;
  
  // Display options
  toggleStops: () => void;
  toggleSpeedColors: () => void;
  toggleGsmMarkers: () => void;
  toggleLatencyMarkers: () => void;
  toggleIgnitionEvents: () => void;
  toggleSpeedEvents: () => void;
  toggleIdleEvents: () => void;
  setSpeedViolationThreshold: (threshold: number) => void;
  toggleTripDetails: () => void;
  
  // Clear all
  clearTrack: () => void;
}

export const useTrackStore = create<TrackState>((set) => ({
  // Initial state
  isLoading: false,
  error: null,
  currentTrack: null,
  
  // Track mode
  trackMode: getPersistedTrackMode(),
  osrmRoute: null,
  
  isDialogOpen: false,
  selectedVehicle: null,
  
  isPlaying: false,
  playbackSpeed: 1,
  currentPointIndex: 0,
  focusedTrackPoint: null,
  
  showStops: true,
  showSpeedColors: true,
  showGsmMarkers: false,
  showLatencyMarkers: false,
  showIgnitionEvents: false,
  showSpeedEvents: false,
  showIdleEvents: false,
  speedViolationThreshold: 80,
  showTripDetails: false,
  
  // Actions
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setCurrentTrack: (track) => set({ 
    currentTrack: track, 
    currentPointIndex: 0,
    isPlaying: false,
    osrmRoute: null, // Clear OSRM route when setting new track
    focusedTrackPoint: null,
  }),
  
  // Track mode actions
  setTrackMode: (mode) => {
    try {
      localStorage.setItem('trackMode', mode);
    } catch {}
    set({ trackMode: mode });
  },
  setOsrmRoute: (route) => set({ osrmRoute: route }),
  
  openDialog: (vehicle) => set({ 
    isDialogOpen: true, 
    selectedVehicle: vehicle,
    currentTrack: null,
    error: null,
    osrmRoute: null,
    focusedTrackPoint: null,
  }),
  closeDialog: (keepTrack = false) => set((state) => ({ 
    isDialogOpen: false, 
    selectedVehicle: null,
    currentTrack: keepTrack ? state.currentTrack : null,
    osrmRoute: keepTrack ? state.osrmRoute : null,
    error: null,
    isPlaying: keepTrack ? state.isPlaying : false,
    currentPointIndex: keepTrack ? state.currentPointIndex : 0,
    focusedTrackPoint: null,
  })),
  
  // Playback
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => set({ isPlaying: false, currentPointIndex: 0 }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setCurrentPointIndex: (indexOrFn) => set((state) => ({
    currentPointIndex: typeof indexOrFn === 'function' 
      ? indexOrFn(state.currentPointIndex) 
      : indexOrFn
  })),
  advancePlayback: () => set((state) => {
    if (!state.currentTrack || state.currentTrack.points.length === 0) {
      return { isPlaying: false };
    }
    if (state.currentPointIndex >= state.currentTrack.points.length - 1) {
      return { isPlaying: false }; // Stop at end
    }
    return { currentPointIndex: state.currentPointIndex + 1 };
  }),

  focusTrackPoint: (lat, lng, zoom) => set({ focusedTrackPoint: { lat, lng, zoom } }),
  clearFocusedTrackPoint: () => set({ focusedTrackPoint: null }),
  
  // Display options
  toggleStops: () => set((state) => ({ showStops: !state.showStops })),
  toggleSpeedColors: () => set((state) => ({ showSpeedColors: !state.showSpeedColors })),
  toggleGsmMarkers: () => set((state) => ({ showGsmMarkers: !state.showGsmMarkers })),
  toggleLatencyMarkers: () => set((state) => ({ showLatencyMarkers: !state.showLatencyMarkers })),
  toggleIgnitionEvents: () => set((state) => ({ showIgnitionEvents: !state.showIgnitionEvents })),
  toggleSpeedEvents: () => set((state) => ({ showSpeedEvents: !state.showSpeedEvents })),
  toggleIdleEvents: () => set((state) => ({ showIdleEvents: !state.showIdleEvents })),
  setSpeedViolationThreshold: (threshold) => set({ speedViolationThreshold: threshold }),
  toggleTripDetails: () => set((state) => ({ showTripDetails: !state.showTripDetails })),
  
  // Clear
  clearTrack: () => set({
    currentTrack: null,
    osrmRoute: null,
    error: null,
    isPlaying: false,
    currentPointIndex: 0,
    showTripDetails: false,
    focusedTrackPoint: null,
  }),
}));
