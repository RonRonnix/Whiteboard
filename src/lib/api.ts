import { clearAuthState, getAuthToken } from '../store/authStore'
import type { SessionRoom, User } from '../types'

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

type AuthResponse = {
  token: string
  user: User
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken()
  const headers = new Headers(options.headers)

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    clearAuthState()
    throw new Error('Your session expired. Please sign in again.')
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const message = errorBody?.message ?? 'Request failed'
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function loginRequest(payload: { email: string; password: string }) {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function registerRequest(payload: { email: string; password: string; displayName: string; inviteCode: string }) {
  return apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchSessionRooms() {
  return apiFetch<{ rooms: SessionRoom[] }>('/api/session-rooms')
}

export function createSessionRoom(payload: { title: string }) {
  return apiFetch<SessionRoom>('/api/session-rooms', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
