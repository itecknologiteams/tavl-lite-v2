import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User, AuthSession } from '@apptypes/api';
import { useAlertDistributionStore } from './alertDistributionStore';
import { useCallStore } from './callStore';
import { setCurrentUserId } from '@services/api';
import sipService from '@services/sip';

interface AuthState {
  user: User | null;
  jsession: string | null;
  isAuthenticated: boolean;
  login: (user: User, jsession: string) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

const SESSION_KEYS_TO_CLEAR = [
  // tavl_softphone_settings and tavl_call_mode are intentionally excluded —
  // they are device-level settings (which extension is on this workstation)
  // and must persist across agent logins.
  'tavl_call_history',
  'tavl_distribution_session',
  'tavl-map-layer',
];

async function fullCleanup(username?: string) {
  try { await useAlertDistributionStore.getState().logout(); } catch {}
  try { await sipService.unregister(); } catch {}
  try { useCallStore.getState().unregister(); } catch {}

  SESSION_KEYS_TO_CLEAR.forEach(k => {
    try { localStorage.removeItem(k); } catch {}
  });
  try { sessionStorage.removeItem('tavl-auth-session'); } catch {}

  if (username) console.log(`📊 ${username} fully logged out`);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      jsession: null,
      isAuthenticated: false,

      login: (user, jsession) => {
        setCurrentUserId(user.id);
        set({
          user,
          jsession,
          isAuthenticated: true,
        });
        
        const distributionRole = user.role === 'supervisor' || user.role === 'admin' 
          ? 'supervisor' 
          : 'agent';
        
        useAlertDistributionStore.getState().login(
          user.id, 
          user.name || user.username, 
          distributionRole
        ).then(() => {
          console.log(`📊 Distribution system: ${user.username} registered as ${distributionRole}`);
        }).catch((err) => {
          console.warn('Distribution login failed:', err.message);
        });
      },

      logout: () => {
        const currentUser = get().user;
        setCurrentUserId(null);
        set({ user: null, jsession: null, isAuthenticated: false });
        fullCleanup(currentUser?.username);
      },

      updateUser: (userData) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        }));
      },
    }),
    {
      name: 'tavl-auth-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        user: state.user,
        jsession: state.jsession,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => {
        return (state: AuthState | undefined) => {
          if (!state?.user?.id) return;
          setCurrentUserId(state.user.id);
          const user = state.user;
          const distributionRole = user.role === 'supervisor' || user.role === 'admin'
            ? 'supervisor'
            : 'agent';
          useAlertDistributionStore.getState().login(
            user.id,
            user.name || user.username,
            distributionRole
          ).catch(() => {});
        };
      },
    }
  )
);
