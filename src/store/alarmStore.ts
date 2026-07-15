import { create } from 'zustand';
import type { Alarm } from '@apptypes/vehicle';

interface AlarmState {
  alarms: Alarm[];
  unacknowledgedCount: number;
  filter: {
    severity?: string;
    vehicleId?: string;
    timeRange?: { start: Date; end: Date };
  };
  
  setAlarms: (alarms: Alarm[]) => void;
  addAlarm: (alarm: Alarm) => void;
  acknowledgeAlarm: (alarmId: string) => void;
  setFilter: (filter: Partial<AlarmState['filter']>) => void;
  clearFilter: () => void;
}

export const useAlarmStore = create<AlarmState>((set) => ({
  alarms: [],
  unacknowledgedCount: 0,
  filter: {},

  setAlarms: (alarms) => {
    const unacked = alarms.filter((a) => !a.acknowledged).length;
    set({ alarms, unacknowledgedCount: unacked });
  },

  addAlarm: (alarm) => {
    set((state) => ({
      alarms: [alarm, ...state.alarms],
      unacknowledgedCount: alarm.acknowledged 
        ? state.unacknowledgedCount 
        : state.unacknowledgedCount + 1,
    }));
  },

  acknowledgeAlarm: (alarmId) => {
    set((state) => ({
      alarms: state.alarms.map((a) =>
        a.id === alarmId ? { ...a, acknowledged: true } : a
      ),
      unacknowledgedCount: Math.max(0, state.unacknowledgedCount - 1),
    }));
  },

  setFilter: (filter) => {
    set((state) => ({
      filter: { ...state.filter, ...filter },
    }));
  },

  clearFilter: () => set({ filter: {} }),
}));
