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

export type Point = {
  x: number
  y: number
}

export type NewStroke = {
  clientId: string
  points: Point[]
  color: string
  size: number
  tool?: string
}

export type WhiteboardStroke = {
  id: string
  clientId?: string
  roomId: string
  userId: string
  displayName: string
  color: string
  size: number
  tool?: string
  points: Point[]
  timestamp: string
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
  'whiteboard:stroke': (payload: { roomId: string; stroke: NewStroke }) => void
  'whiteboard:clear': (payload: { roomId: string }) => void
}

export type ServerToClientEvents = {
  'session:joined': (payload: {
    roomId: string
    participants: ParticipantPresence[]
    chatHistory: ChatMessage[]
    whiteboardStrokes: WhiteboardStroke[]
  }) => void
  'session:participant:joined': (payload: { roomId: string; participant: ParticipantPresence }) => void
  'session:participant:left': (payload: { roomId: string; userId: string }) => void
  'session:cursor': (payload: { roomId: string; userId: string; cursor: CursorState }) => void
  'chat:message': (message: ChatMessage) => void
  'whiteboard:stroke': (payload: { roomId: string; stroke: WhiteboardStroke }) => void
  'whiteboard:clear': (payload: { roomId: string; clearedBy: string }) => void
  'session:error': (payload: { roomId?: string; message: string }) => void
}
