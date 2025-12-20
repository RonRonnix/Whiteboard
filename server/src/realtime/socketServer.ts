import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import config from '../config'
import prisma from '../lib/prisma'
import type {
  ChatMessage,
  ClientToServerEvents,
  ParticipantPresence,
  ServerToClientEvents,
  SocketData,
} from './types'

const roomParticipants = new Map<string, Map<string, ParticipantPresence>>()
const roomChatHistory = new Map<string, ChatMessage[]>()
const MAX_CHAT_HISTORY = 50

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
  }
}

type TokenPayload = {
  sub: string
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
  })

  io.use(async (socket, next) => {
    try {
      const rawToken =
        (socket.handshake.auth?.token as string | undefined) ??
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
        const room = await prisma.sessionRoom.findUnique({ where: { id: roomId } })
        if (!room) {
          socket.emit('session:error', { roomId, message: 'Room not found' })
          return
        }

        socket.join(roomId)
        socket.data.rooms?.add(roomId)

        const participants = getParticipants(roomId)
        const presence: ParticipantPresence = {
          userId: user.id,
          displayName: user.displayName,
          email: user.email,
        }
        participants.set(user.id, presence)

        socket.emit('session:joined', {
          roomId,
          participants: Array.from(participants.values()),
          chatHistory: getChatHistory(roomId),
        })

        socket.to(roomId).emit('session:participant:joined', { roomId, participant: presence })
      } catch (error) {
        socket.emit('session:error', {
          roomId,
          message: error instanceof Error ? error.message : 'Unable to join room',
        })
      }
    })

    socket.on('session:leave', ({ roomId }) => {
      socket.leave(roomId)
      socket.data.rooms?.delete(roomId)
      removeParticipant(roomId, user.id)
      socket.to(roomId).emit('session:participant:left', { roomId, userId: user.id })
    })

    socket.on('session:cursor', ({ roomId, cursor }) => {
      const participants = roomParticipants.get(roomId)
      if (!participants) return
      const presence = participants.get(user.id)
      if (!presence) return
      presence.cursor = cursor
      socket.to(roomId).emit('session:cursor', { roomId, userId: user.id, cursor })
    })

    socket.on('chat:message', ({ roomId, content }) => {
      const trimmed = content.trim()
      if (!trimmed) return
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        roomId,
        userId: user.id,
        displayName: user.displayName,
        content: trimmed,
        timestamp: new Date().toISOString(),
      }
      pushChatMessage(roomId, message)
      io.to(roomId).emit('chat:message', message)
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
