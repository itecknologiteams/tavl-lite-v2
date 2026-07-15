import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Vehicle, Company, VehicleStatus } from '@apptypes/vehicle';

export type ViewMode = 'grid' | 'map' | 'split';

// Trail point for moving vehicles
export interface TrailPoint {
  lat: number;
  lng: number;
  speed: number;
  timestamp: number;
}

export interface AlertLocate {
  objectId: string;
  lat: number;
  lng: number;
  speed: number;
  alertType: string;
  vehicleReg: string;
  gpsTime: string;
  assignedAt: string;
}

// Maximum trail points to keep per vehicle
const MAX_TRAIL_POINTS = 50;

interface VehicleState {
  vehicles: Map<string, Vehicle>;
  companies: Company[];
  selectedVehicle: Vehicle | null;
  pinnedVehicles: Set<string>;
  pinnedVehicleData: Map<string, Vehicle>; // Stores full vehicle data for pinned vehicles
  focusedVehicle: Vehicle | null; // For map centering
  searchQuery: string;
  filterCompany: string | null;
  filterStatus: VehicleStatus | null;
  viewMode: ViewMode;
  mapExpanded: boolean;
  
  // Vehicle trails for moving vehicles
  vehicleTrails: Map<string, TrailPoint[]>;
  showTrails: boolean;
  
  // Actions
  setVehicles: (vehicles: Vehicle[]) => void;
  updateVehicle: (vehicleId: string, data: Partial<Vehicle>) => void;
  setCompanies: (companies: Company[]) => void;
  selectVehicle: (vehicle: Vehicle | null) => void;
  
  // Pin management
  pinVehicle: (vehicleId: string, vehicle?: Vehicle) => void;
  unpinVehicle: (vehicleId: string) => void;
  togglePinVehicle: (vehicleId: string, vehicle?: Vehicle) => void;
  clearPinnedVehicles: () => void;
  getPinnedVehicles: () => Vehicle[];
  
  // Map focus
  focusOnVehicle: (vehicle: Vehicle | null) => void;
  showOnMap: (vehicle: Vehicle) => void;
  // Locate behavior: clear old pins, pin only this vehicle, and focus it
  showOnMapExclusive: (vehicle: Vehicle) => void;
  // Alert-inbox locate: focus/pin without opening vehicle detail panel
  showOnMapExclusiveFocusOnly: (vehicle: Vehicle) => void;
  
  // Filters
  setSearchQuery: (query: string) => void;
  setFilterCompany: (companyId: string | null) => void;
  setFilterStatus: (status: VehicleStatus | null) => void;
  clearFilters: () => void;
  
  // View
  setViewMode: (mode: ViewMode) => void;
  toggleMapExpanded: () => void;
  
  // Trails
  addTrailPoint: (vehicleId: string, point: TrailPoint) => void;
  clearTrail: (vehicleId: string) => void;
  clearAllTrails: () => void;
  toggleShowTrails: () => void;

  // Alert locate (incident scene)
  alertLocate: AlertLocate | null;
  setAlertLocate: (locate: AlertLocate | null) => void;
}

export const useVehicleStore = create<VehicleState>()(
  persist(
    (set, get) => ({
      vehicles: new Map(),
      companies: [],
      selectedVehicle: null,
      pinnedVehicles: new Set(),
      pinnedVehicleData: new Map(),
      focusedVehicle: null,
      searchQuery: '',
      filterCompany: null,
      filterStatus: null,
      viewMode: 'split',
      mapExpanded: false,
      vehicleTrails: new Map(),
      showTrails: true,
      alertLocate: null,

      setVehicles: (vehicles) => {
        const vehicleMap = new Map();
        const state = get();
        const newTrails = new Map(state.vehicleTrails);
        
        vehicles.forEach((v) => {
          vehicleMap.set(v.objectId, v);
          
          // Add trail point for moving vehicles
          if (v.status === 'moving' && v.gpsData && v.gpsData.latitude && v.gpsData.longitude) {
            const existingTrail = newTrails.get(v.objectId) || [];
            const lastPoint = existingTrail[existingTrail.length - 1];
            
            // Only add if position changed (avoid duplicates)
            const newLat = v.gpsData.latitude;
            const newLng = v.gpsData.longitude;
            
            if (!lastPoint || 
                Math.abs(lastPoint.lat - newLat) > 0.00001 || 
                Math.abs(lastPoint.lng - newLng) > 0.00001) {
              const newPoint: TrailPoint = {
                lat: newLat,
                lng: newLng,
                speed: v.gpsData.speed,
                timestamp: Date.now(),
              };
              
              // Keep only last MAX_TRAIL_POINTS
              const updatedTrail = [...existingTrail, newPoint].slice(-MAX_TRAIL_POINTS);
              newTrails.set(v.objectId, updatedTrail);
            }
          }
        });
        
        set({ vehicles: vehicleMap, vehicleTrails: newTrails });
      },

      updateVehicle: (vehicleId, data) => {
        set((state) => {
          const newVehicles = new Map(state.vehicles);
          const newPinnedData = new Map(state.pinnedVehicleData);
          const normalizedId = String(vehicleId);
          
          // Update in vehicles map
          const existing = newVehicles.get(normalizedId);
          if (existing) {
            newVehicles.set(normalizedId, { ...existing, ...data });
          }
          
          // Update in pinnedVehicleData if pinned (or if ID is in pinnedVehicles set)
          const pinnedExisting = newPinnedData.get(normalizedId);
          const isPinned = state.pinnedVehicles.has(normalizedId);
          
          if (pinnedExisting) {
            // Update existing pinned data
            newPinnedData.set(normalizedId, { ...pinnedExisting, ...data });
          } else if (isPinned && data.objectId) {
            // Vehicle is pinned but no data yet - add it
            newPinnedData.set(normalizedId, data as Vehicle);
          }
          
          // Also update selectedVehicle if it matches
          let newSelectedVehicle = state.selectedVehicle;
          if (state.selectedVehicle?.objectId === normalizedId) {
            newSelectedVehicle = { ...state.selectedVehicle, ...data };
          }
          
          return { 
            vehicles: newVehicles, 
            pinnedVehicleData: newPinnedData,
            selectedVehicle: newSelectedVehicle,
          };
        });
      },

      setCompanies: (companies) => set({ companies }),

      selectVehicle: (vehicle) => set({ selectedVehicle: vehicle, ...(vehicle === null ? { alertLocate: null } : {}) }),

      // Pin management
      pinVehicle: (vehicleId, vehicle) => {
        set((state) => {
          const newPinned = new Set(state.pinnedVehicles);
          const newPinnedData = new Map(state.pinnedVehicleData);
          newPinned.add(vehicleId);
          // Store vehicle data if provided, or get from vehicles map
          const vehicleData = vehicle || state.vehicles.get(vehicleId);
          if (vehicleData) {
            newPinnedData.set(vehicleId, vehicleData);
          }
          return { pinnedVehicles: newPinned, pinnedVehicleData: newPinnedData };
        });
      },

      unpinVehicle: (vehicleId) => {
        set((state) => {
          const newPinned = new Set(state.pinnedVehicles);
          const newPinnedData = new Map(state.pinnedVehicleData);
          newPinned.delete(vehicleId);
          newPinnedData.delete(vehicleId);
          return { pinnedVehicles: newPinned, pinnedVehicleData: newPinnedData };
        });
      },

      togglePinVehicle: (vehicleId, vehicle) => {
        set((state) => {
          const newPinned = new Set(state.pinnedVehicles);
          const newPinnedData = new Map(state.pinnedVehicleData);
          if (newPinned.has(vehicleId)) {
            newPinned.delete(vehicleId);
            newPinnedData.delete(vehicleId);
          } else {
            newPinned.add(vehicleId);
            // Store vehicle data if provided, or get from vehicles map
            const vehicleData = vehicle || state.vehicles.get(vehicleId);
            if (vehicleData) {
              newPinnedData.set(vehicleId, vehicleData);
            }
          }
          return { pinnedVehicles: newPinned, pinnedVehicleData: newPinnedData };
        });
      },

      clearPinnedVehicles: () => set({ pinnedVehicles: new Set(), pinnedVehicleData: new Map() }),
      
      getPinnedVehicles: () => {
        const state = get();
        const result: Vehicle[] = [];
        state.pinnedVehicles.forEach((id) => {
          // First check pinnedVehicleData, then vehicles map
          const vehicle = state.pinnedVehicleData.get(id) || state.vehicles.get(id);
          if (vehicle && vehicle.gpsData) {
            result.push(vehicle);
          }
        });
        return result;
      },

      // Map focus
      focusOnVehicle: (vehicle) => set({ focusedVehicle: vehicle }),

      showOnMap: (vehicle) => {
        const state = get();
        // Pin if not already pinned, pass vehicle data
        if (!state.pinnedVehicles.has(vehicle.objectId)) {
          state.pinVehicle(vehicle.objectId, vehicle);
        } else {
          // Update vehicle data if already pinned
          const newPinnedData = new Map(state.pinnedVehicleData);
          newPinnedData.set(vehicle.objectId, vehicle);
          set({ pinnedVehicleData: newPinnedData });
        }
        // Focus on vehicle
        set({ focusedVehicle: vehicle, selectedVehicle: vehicle });
      },

      showOnMapExclusive: (vehicle) => {
        // Replace the pin set with only this vehicle, then focus it
        const pinnedVehicles = new Set<string>([vehicle.objectId]);
        const pinnedVehicleData = new Map<string, Vehicle>([[vehicle.objectId, vehicle]]);
        set({ pinnedVehicles, pinnedVehicleData, focusedVehicle: vehicle, selectedVehicle: vehicle });
      },

      showOnMapExclusiveFocusOnly: (vehicle) => {
        // Alert-inbox locate should focus the map / snapshot without auto-pinning.
        // Also clear selectedVehicle so the details panel doesn't auto-open / stay open.
        set({ focusedVehicle: vehicle, selectedVehicle: null });
      },

      // Filters
      setSearchQuery: (query) => set({ searchQuery: query }),
      setFilterCompany: (companyId) => set({ filterCompany: companyId }),
      setFilterStatus: (status) => set({ filterStatus: status }),
      clearFilters: () => set({
        searchQuery: '',
        filterCompany: null,
        filterStatus: null,
      }),

      // View
      setViewMode: (mode) => set({ viewMode: mode }),
      toggleMapExpanded: () => set((state) => ({ mapExpanded: !state.mapExpanded })),
      
      // Trails
      addTrailPoint: (vehicleId, point) => {
        set((state) => {
          const newTrails = new Map(state.vehicleTrails);
          const existingTrail = newTrails.get(vehicleId) || [];
          const updatedTrail = [...existingTrail, point].slice(-MAX_TRAIL_POINTS);
          newTrails.set(vehicleId, updatedTrail);
          return { vehicleTrails: newTrails };
        });
      },
      
      clearTrail: (vehicleId) => {
        set((state) => {
          const newTrails = new Map(state.vehicleTrails);
          newTrails.delete(vehicleId);
          return { vehicleTrails: newTrails };
        });
      },
      
      clearAllTrails: () => set({ vehicleTrails: new Map() }),
      
      toggleShowTrails: () => set((state) => ({ showTrails: !state.showTrails })),

      setAlertLocate: (locate) => set({ alertLocate: locate }),
    }),
    {
      name: 'tavl-vehicle-store',
      partialize: (state) => ({
        pinnedVehicles: Array.from(state.pinnedVehicles),
        pinnedVehicleData: Array.from(state.pinnedVehicleData.entries()),
        viewMode: state.viewMode,
        showTrails: state.showTrails,
      }),
      merge: (persisted: any, current) => ({
        ...current,
        pinnedVehicles: new Set(persisted?.pinnedVehicles || []),
        pinnedVehicleData: new Map(persisted?.pinnedVehicleData || []),
        viewMode: persisted?.viewMode || 'split',
        showTrails: persisted?.showTrails ?? true,
      }),
    }
  )
);
