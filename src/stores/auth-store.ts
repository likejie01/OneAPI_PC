import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserProfile } from '../shared/contracts'

interface AuthState {
  user: UserProfile | null
  bootstrapping: boolean
  pendingTwoFactor: boolean
  setUser: (user: UserProfile | null) => void
  setBootstrapping: (value: boolean) => void
  setPendingTwoFactor: (value: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      bootstrapping: true,
      pendingTwoFactor: false,
      setUser: (user) => set({ user }),
      setBootstrapping: (bootstrapping) => set({ bootstrapping }),
      setPendingTwoFactor: (pendingTwoFactor) => set({ pendingTwoFactor }),
      reset: () =>
        set({
          user: null,
          pendingTwoFactor: false,
        }),
    }),
    {
      name: 'oneapi-desktop-auth',
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
)
