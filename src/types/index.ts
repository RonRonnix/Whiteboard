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
  inviteExpiresAt: string | null
  inviteRevokedAt: string | null
}

export type RoomRole = 'owner' | 'editor' | 'viewer'

export type RoomMember = {
  roomId: string
  userId: string
  role: RoomRole
  joinedAt: string
  user: Pick<User, 'id' | 'email' | 'displayName'>
}
