export type CursorState = {
  x: number
  y: number
  tool?: string
}

export type ParticipantPresence = {
  userId: string
  displayName: string
  email: string
  cursor?: CursorState
}

export type ChatMessage = {
  id: string
  roomId: string
  userId: string
  displayName: string
  content: string
  timestamp: string
}

export type ClientToServerEvents = {
  'session:join': (payload: { roomId: string }) => void
  'session:leave': (payload: { roomId: string }) => void
  'session:cursor': (payload: { roomId: string; cursor: CursorState }) => void
  'chat:message': (payload: { roomId: string; content: string }) => void
}

export type ServerToClientEvents = {
  'session:joined': (payload: {
    roomId: string
    participants: ParticipantPresence[]
    chatHistory: ChatMessage[]
  }) => void
  'session:participant:joined': (payload: { roomId: string; participant: ParticipantPresence }) => void
  'session:participant:left': (payload: { roomId: string; userId: string }) => void
  'session:cursor': (payload: { roomId: string; userId: string; cursor: CursorState }) => void
  'chat:message': (message: ChatMessage) => void
  'session:error': (payload: { roomId?: string; message: string }) => void
}

export type SocketUser = {
  id: string
  displayName: string
  email: string
}

export type SocketData = {
  user?: SocketUser
  rooms?: Set<string>
}
