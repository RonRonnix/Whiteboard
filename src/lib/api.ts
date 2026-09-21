import { clearAuthState, getAuthToken } from '../store/authStore'
import type { RoomMember, RoomRole, SessionRoom, User } from '../types'

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

type AuthResponse = {
  token?: string
  user: User
}

type RegisterResponse = {
  requiresVerification: true
  email: string
  message: string
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
    credentials: 'include',
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

export function registerRequest(payload: { email: string; password: string; displayName: string }) {
  return apiFetch<RegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function verifyEmailRequest(payload: { email: string; code: string }) {
  return apiFetch<AuthResponse>('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function resendVerificationRequest(payload: { email: string }) {
  return apiFetch<{ message: string }>('/api/auth/resend-code', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function logoutRequest() {
  return apiFetch<{ message: string }>('/api/auth/logout', { method: 'POST' })
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

export function joinSessionRoom(payload: { inviteCode: string }) {
  return apiFetch<{ room: SessionRoom }>('/api/session-rooms/join', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function fetchSessionRoom(roomId: string) {
  return apiFetch<{ room: SessionRoom }>(`/api/session-rooms/${roomId}`)
}

export function fetchRoomMembers(roomId: string) {
  return apiFetch<{ members: RoomMember[] }>(`/api/session-rooms/${roomId}/members`)
}

export function updateRoomMemberRole(roomId: string, userId: string, role: Exclude<RoomRole, 'owner'>) {
  return apiFetch<{ member: RoomMember }>(`/api/session-rooms/${roomId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export function rotateRoomInvite(roomId: string) {
  return apiFetch<{ room: SessionRoom }>(`/api/session-rooms/${roomId}/invite/rotate`, { method: 'POST' })
}

export function updateRoomInvite(roomId: string, payload: { expiresAt: string | null }) {
  return apiFetch<{ room: SessionRoom }>(`/api/session-rooms/${roomId}/invite`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export function revokeRoomInvite(roomId: string) {
  return apiFetch<{ room: SessionRoom }>(`/api/session-rooms/${roomId}/invite/revoke`, { method: 'POST' })
}
