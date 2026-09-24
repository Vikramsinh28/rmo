import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
  profilePicture: string | null;
  role: string;
  rmoRole?: string;
  loginId?: string | null;
  scope?: string;
  homeZoneId?: number | null;
  homeDivisionId?: number | null;
  homeLobbyId?: number | null;
  isOnboarded: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      user: null,
      token: null,
      setAuth: (user: User) => {
        set(() => ({ user, token: null }));
      },
      clearAuth: () => {
        set(() => ({ user: null, token: null }));
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ user: state.user }),
    }
  )
);
