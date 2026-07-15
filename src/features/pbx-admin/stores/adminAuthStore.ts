import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminUser {
  username: string;
  role: 'admin';
}

interface AdminAuthState {
  token: string | null;
  user: AdminUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: AdminUser) => void;
  logout: () => void;
  setToken: (token: string) => void;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: (token: string, user: AdminUser) => {
        set({ token, user, isAuthenticated: true });
      },

      logout: () => {
        set({ token: null, user: null, isAuthenticated: false });
      },

      setToken: (token: string) => {
        set({ token });
      },
    }),
    {
      name: 'pbx-admin-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

// API helper with admin token
export async function adminApi(endpoint: string, options: RequestInit = {}) {
  const { token } = useAdminAuthStore.getState();

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };

  // Only set Content-Type for non-FormData requests
  const isFormData = options.body instanceof FormData;
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`/api/pbx-admin${endpoint}`, {
    ...options,
    headers: {
      ...headers,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    useAdminAuthStore.getState().logout();
    window.location.href = '/pbx-admin';
    throw new Error('Session expired');
  }

  return response;
}

export async function reloadFs(): Promise<boolean> {
  try {
    const res = await adminApi('/system/reload', { method: 'POST' });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
