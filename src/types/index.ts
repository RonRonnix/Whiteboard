export type User = {
  id: string
  email: string
  displayName: string
  status: 'pending' | 'active'
  emailVerifiedAt: string | null
}

export type SessionRoom = {
  id: string
  title: string
  inviteCode: string
  createdAt: string
  createdById: string
}
