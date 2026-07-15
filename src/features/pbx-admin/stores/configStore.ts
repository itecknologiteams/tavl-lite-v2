import { create } from 'zustand';

interface PendingChange {
  id: string;
  type: 'extension' | 'trunk' | 'dialplan' | 'queue';
  name: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
}

interface ConfigState {
  pendingChanges: PendingChange[];
  isApplying: boolean;
  lastError: string | null;

  // Actions
  addChange: (change: Omit<PendingChange, 'id' | 'timestamp'>) => void;
  removeChange: (id: string) => void;
  clearChanges: () => void;
  setApplying: (isApplying: boolean) => void;
  setError: (error: string | null) => void;

  // Getters
  hasChanges: () => boolean;
  getChangesByType: (type: PendingChange['type']) => PendingChange[];
  getChangeCount: () => number;
}

export const useConfigStore = create<ConfigState>()((set, get) => ({
  pendingChanges: [],
  isApplying: false,
  lastError: null,

  addChange: (change) => {
    const newChange: PendingChange = {
      ...change,
      id: `${change.type}-${change.name}-${Date.now()}`,
      timestamp: Date.now(),
    };

    set((state) => {
      // Remove any existing pending change for the same item
      const filtered = state.pendingChanges.filter(
        (c) => !(c.type === change.type && c.name === change.name)
      );
      return { pendingChanges: [...filtered, newChange], lastError: null };
    });
  },

  removeChange: (id) => {
    set((state) => ({
      pendingChanges: state.pendingChanges.filter((c) => c.id !== id),
    }));
  },

  clearChanges: () => {
    set({ pendingChanges: [], lastError: null });
  },

  setApplying: (isApplying) => {
    set({ isApplying });
  },

  setError: (error) => {
    set({ lastError: error });
  },

  hasChanges: () => {
    return get().pendingChanges.length > 0;
  },

  getChangesByType: (type) => {
    return get().pendingChanges.filter((c) => c.type === type);
  },

  getChangeCount: () => {
    return get().pendingChanges.length;
  },
}));
