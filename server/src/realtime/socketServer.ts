import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import config, { allowedOrigins } from '../config'
import prisma from '../lib/prisma'
import { AUTH_COOKIE_NAME } from '../middleware/auth'
import type {
  ChatMessage,
  ClientToServerEvents,
  ParticipantPresence,
  ServerToClientEvents,
  SocketData,
  WhiteboardStroke,
} from './types'

const roomParticipants = new Map<string, Map<string, ParticipantPresence>>()
const roomChatHistory = new Map<string, ChatMessage[]>()
const roomWhiteboardStrokes = new Map<string, WhiteboardStroke[]>()
type RedoEntry = { stroke: WhiteboardStroke; index: number }
const roomRedoStrokes = new Map<string, Map<string, RedoEntry[]>>()
const MAX_CHAT_HISTORY = 50
const MAX_WHITEBOARD_STROKES = 1000
const roomIdSchema = z.string().min(1).max(100)
const cursorSchema = z.object({
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  tool: z.string().max(30).optional(),
})
const chatSchema = z.object({ roomId: roomIdSchema, content: z.string().trim().min(1).max(2000) })
const strokeSchema = z.object({
  roomId: roomIdSchema,
  stroke: z.object({
    clientId: z.string().min(1).max(100),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(2).max(10000),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    size: z.number().finite().min(1).max(64),
    tool: z.enum(['pen', 'eraser']).default('pen'),
  }),
})

function getCookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function getParticipants(roomId: string) {
  if (!roomParticipants.has(roomId)) {
    roomParticipants.set(roomId, new Map())
  }
  return roomParticipants.get(roomId)!
}

function getChatHistory(roomId: string) {
  if (!roomChatHistory.has(roomId)) {
    roomChatHistory.set(roomId, [])
  }
  return roomChatHistory.get(roomId)!
}

function pushChatMessage(roomId: string, message: ChatMessage) {
  const history = getChatHistory(roomId)
  history.push(message)
  if (history.length > MAX_CHAT_HISTORY) {
    history.shift()
  }
}

function removeParticipant(roomId: string, userId: string) {
  const participants = roomParticipants.get(roomId)
  if (!participants) return
  participants.delete(userId)
  if (participants.size === 0) {
    roomParticipants.delete(roomId)
    roomChatHistory.delete(roomId)
    roomWhiteboardStrokes.delete(roomId)
    roomRedoStrokes.delete(roomId)
  }
}

function getWhiteboardStrokes(roomId: string) {
  if (!roomWhiteboardStrokes.has(roomId)) {
    roomWhiteboardStrokes.set(roomId, [])
  }
  return roomWhiteboardStrokes.get(roomId)!
}

function pushWhiteboardStroke(roomId: string, stroke: WhiteboardStroke) {
  const strokes = getWhiteboardStrokes(roomId)
  strokes.push(stroke)
  if (strokes.length > MAX_WHITEBOARD_STROKES) {
    strokes.shift()
  }
}

function getRedoStrokes(roomId: string, userId: string) {
  if (!roomRedoStrokes.has(roomId)) roomRedoStrokes.set(roomId, new Map())
  const redosByUser = roomRedoStrokes.get(roomId)!
  if (!redosByUser.has(userId)) redosByUser.set(userId, [])
  return redosByUser.get(userId)!
}

async function getRoomRole(roomId: string, userId: string) {
  const membership = await prisma.sessionRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true },
  })
  return membership?.role
}

type TokenPayload = {
  sub: string
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: 100 * 1024,
    cors: {
      origin: [...allowedOrigins],
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    try {
      const rawToken =
        (socket.handshake.auth?.token as string | undefined) ??
        getCookieValue(socket.handshake.headers.cookie, AUTH_COOKIE_NAME) ??
        (typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace('Bearer ', '')
          : undefined)

      if (!rawToken) {
        return next(new Error('Authentication required'))
      }

      const payload = jwt.verify(rawToken, config.jwtSecret) as TokenPayload

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, displayName: true, email: true },
      })

      if (!user) {
        return next(new Error('User not found'))
      }

      socket.data.user = user
      socket.data.rooms = new Set()
      return next()
    } catch (error) {
      return next(error as Error)
    }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user!

    socket.on('session:join', async ({ roomId }) => {
      try {
        const validRoomId = roomIdSchema.parse(roomId)
        const role = await getRoomRole(validRoomId, user.id)
        if (!role) {
          socket.emit('session:error', { roomId: validRoomId, message: 'Room not found or access denied' })
          return
        }

        socket.join(validRoomId)
        socket.data.rooms?.add(validRoomId)

        const participants = getParticipants(validRoomId)
        const presence: ParticipantPresence = {
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
          role,
        }
        participants.set(user.id, presence)

        socket.emit('session:joined', {
          roomId: validRoomId,
          participants: Array.from(participants.values()),
          chatHistory: getChatHistory(validRoomId),
          whiteboardStrokes: getWhiteboardStrokes(validRoomId),
        })
        const hasOwnStroke = getWhiteboardStrokes(validRoomId).some((stroke) => stroke.userId === user.id)
        socket.emit('whiteboard:undo-state', {
          roomId: validRoomId,
          canUndo: hasOwnStroke,
          canRedo: getRedoStrokes(validRoomId, user.id).length > 0,
        })

        socket.to(validRoomId).emit('session:participant:joined', { roomId: validRoomId, participant: presence })
      } catch (error) {
        socket.emit('session:error', {
          roomId,
          message: error instanceof Error ? error.message : 'Unable to join room',
        })
      }
    })

    socket.on('session:leave', ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId)) return
      socket.leave(roomId)
      socket.data.rooms?.delete(roomId)
      removeParticipant(roomId, user.id)
      socket.to(roomId).emit('session:participant:left', { roomId, userId: user.id })
    })

    socket.on('session:cursor', ({ roomId, cursor }) => {
      if (!socket.data.rooms?.has(roomId)) return
      const parsedCursor = cursorSchema.safeParse(cursor)
      if (!parsedCursor.success) return
      const participants = roomParticipants.get(roomId)
      if (!participants) return
      const presence = participants.get(user.id)
      if (!presence) return
      presence.cursor = parsedCursor.data
      socket.to(roomId).emit('session:cursor', { roomId, userId: user.id, cursor: parsedCursor.data })
    })

    socket.on('chat:message', (payload) => {
      const parsed = chatSchema.safeParse(payload)
      if (!parsed.success || !socket.data.rooms?.has(parsed.data.roomId)) return
      const { roomId, content } = parsed.data
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        roomId,
        userId: user.id,
        displayName: user.displayName,
        content,
        timestamp: new Date().toISOString(),
      }
      pushChatMessage(roomId, message)
      io.to(roomId).emit('chat:message', message)
    })

    socket.on('whiteboard:stroke', async (payload) => {
      const parsed = strokeSchema.safeParse(payload)
      if (!parsed.success || !socket.data.rooms?.has(parsed.data.roomId)) return
      const { roomId, stroke } = parsed.data
      const presence = roomParticipants.get(roomId)?.get(user.id)
      if (!presence) {
        return
      }
      const role = await getRoomRole(roomId, user.id)
      if (role !== 'owner' && role !== 'editor') {
        socket.emit('session:error', { roomId, message: 'Your viewer role cannot draw on this board.' })
        return
      }

      const fullStroke: WhiteboardStroke = {
        id: crypto.randomUUID(),
        clientId: stroke.clientId,
        roomId,
        userId: user.id,
        displayName: user.displayName,
        color: stroke.color,
        size: stroke.size,
        tool: stroke.tool,
        points: stroke.points,
        timestamp: new Date().toISOString(),
      }

      pushWhiteboardStroke(roomId, fullStroke)
      getRedoStrokes(roomId, user.id).length = 0
      io.to(roomId).emit('whiteboard:stroke', { roomId, stroke: fullStroke })
      socket.emit('whiteboard:undo-state', { roomId, canUndo: true, canRedo: false })
    })

    socket.on('whiteboard:undo', async ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId)) return
      const presence = roomParticipants.get(roomId)?.get(user.id)
      if (!presence) {
        return
      }
      const role = await getRoomRole(roomId, user.id)
      if (role !== 'owner' && role !== 'editor') {
        socket.emit('session:error', { roomId, message: 'Your viewer role cannot change this board.' })
        return
      }
      const strokes = getWhiteboardStrokes(roomId)
      const index = strokes.map((stroke) => stroke.userId).lastIndexOf(user.id)
      if (index === -1) {
        socket.emit('whiteboard:undo-state', { roomId, canUndo: false, canRedo: getRedoStrokes(roomId, user.id).length > 0 })
        return
      }
      const [stroke] = strokes.splice(index, 1)
      getRedoStrokes(roomId, user.id).push({ stroke, index })
      io.to(roomId).emit('whiteboard:stroke:removed', { roomId, strokeId: stroke.id })
      socket.emit('whiteboard:undo-state', { roomId, canUndo: strokes.some((item) => item.userId === user.id), canRedo: true })
    })

    socket.on('whiteboard:redo', async ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId)) return
      const presence = roomParticipants.get(roomId)?.get(user.id)
      if (!presence) return
      const role = await getRoomRole(roomId, user.id)
      if (role !== 'owner' && role !== 'editor') {
        socket.emit('session:error', { roomId, message: 'Your viewer role cannot change this board.' })
        return
      }
      const redoStrokes = getRedoStrokes(roomId, user.id)
      const redoEntry = redoStrokes.pop()
      if (!redoEntry) {
        socket.emit('whiteboard:undo-state', { roomId, canUndo: getWhiteboardStrokes(roomId).some((item) => item.userId === user.id), canRedo: false })
        return
      }
      const strokes = getWhiteboardStrokes(roomId)
      strokes.splice(Math.min(redoEntry.index, strokes.length), 0, redoEntry.stroke)
      io.to(roomId).emit('whiteboard:stroke', { roomId, stroke: redoEntry.stroke })
      socket.emit('whiteboard:undo-state', { roomId, canUndo: true, canRedo: redoStrokes.length > 0 })
    })

    socket.on('disconnect', () => {
      const rooms = Array.from(socket.data.rooms ?? [])
      rooms.forEach((roomId) => {
        removeParticipant(roomId, user.id)
        socket.to(roomId).emit('session:participant:left', { roomId, userId: user.id })
      })
      socket.data.rooms?.clear()
    })
  })

  return io
}
