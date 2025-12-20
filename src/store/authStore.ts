import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'

export type AuthState = {
  user: User | null
  token: string | null
  login: (payload: { user: User; token: string }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login: ({ user, token }) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name: 'whiteboard-auth',
    },
  ),
)

export const getAuthToken = () => useAuthStore.getState().token
export const clearAuthState = () => useAuthStore.getState().logout()
