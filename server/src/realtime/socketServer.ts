import { Server } from 'socket.io'
import type { Server as HttpServer } from 'http'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import config, { allowedOrigins } from '../config'
import prisma from '../lib/prisma'
import { AUTH_COOKIE_NAME } from '../middleware/auth'
import type { ChatMessage, ClientToServerEvents, ParticipantPresence, ServerToClientEvents, SocketData, WhiteboardStroke } from './types'

const roomParticipants = new Map<string, Map<string, ParticipantPresence>>()
const MAX_CHAT_HISTORY = 50
const SNAPSHOT_INTERVAL = 50
const roomIdSchema = z.string().min(1).max(100)
const cursorSchema = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000), tool: z.string().max(30).optional() })
const chatSchema = z.object({ roomId: roomIdSchema, content: z.string().trim().min(1).max(2000) })
const strokeSchema = z.object({
  roomId: roomIdSchema,
  stroke: z.object({
    clientId: z.string().min(1).max(100),
    points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(1).max(10000),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    size: z.number().finite().min(1).max(64),
    tool: z.enum(['pen', 'eraser', 'line', 'rectangle', 'ellipse']).default('pen'),
  }),
})

type TokenPayload = { sub: string }
type StrokeRecord = Awaited<ReturnType<typeof prisma.whiteboardStroke.findFirst>>

function getCookieValue(cookieHeader: string | undefined, name: string) {
  return cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)
}

function getParticipants(roomId: string) {
  if (!roomParticipants.has(roomId)) roomParticipants.set(roomId, new Map())
  return roomParticipants.get(roomId)!
}

function removeParticipant(roomId: string, userId: string) {
  const participants = roomParticipants.get(roomId)
  if (!participants) return
  participants.delete(userId)
  if (participants.size === 0) roomParticipants.delete(roomId)
}

function serializeStroke(stroke: NonNullable<StrokeRecord> & { user: { displayName: string } }): WhiteboardStroke {
  return {
    id: stroke.id,
    clientId: stroke.clientId,
    roomId: stroke.roomId,
    userId: stroke.userId,
    displayName: stroke.user.displayName,
    color: stroke.color,
    size: stroke.size,
    tool: stroke.tool as WhiteboardStroke['tool'],
    points: stroke.points as WhiteboardStroke['points'],
    timestamp: stroke.createdAt.toISOString(),
  }
}

function serializeMessage(message: { id: string; roomId: string; userId: string; content: string; createdAt: Date; user: { displayName: string } }): ChatMessage {
  return { id: message.id, roomId: message.roomId, userId: message.userId, displayName: message.user.displayName, content: message.content, timestamp: message.createdAt.toISOString() }
}

async function getRoomRole(roomId: string, userId: string) {
  const membership = await prisma.sessionRoomMember.findUnique({ where: { roomId_userId: { roomId, userId } }, select: { role: true } })
  return membership?.role
}

async function getDocument(roomId: string) {
  return prisma.whiteboardDocument.upsert({ where: { roomId }, create: { roomId }, update: {} })
}

async function getBoardState(roomId: string, version: number) {
  const snapshot = await prisma.whiteboardSnapshot.findFirst({ where: { roomId, boardVersion: version }, orderBy: { createdAt: 'desc' } })
  const snapshotStrokes = (snapshot?.state as WhiteboardStroke[] | undefined) ?? []
  const subsequent = await prisma.whiteboardStroke.findMany({
    where: { roomId, boardVersion: version, undoneAt: null, createdAt: snapshot ? { gt: snapshot.createdAt } : undefined },
    include: { user: { select: { displayName: true } } }, orderBy: { createdAt: 'asc' },
  })
  return [...snapshotStrokes, ...subsequent.map(serializeStroke)]
}

async function saveSnapshot(roomId: string, version: number) {
  const strokes = await prisma.whiteboardStroke.findMany({ where: { roomId, boardVersion: version, undoneAt: null }, include: { user: { select: { displayName: true } } }, orderBy: { createdAt: 'asc' } })
  const operationCount = await prisma.whiteboardStroke.count({ where: { roomId, boardVersion: version } })
  await prisma.whiteboardSnapshot.create({ data: { roomId, boardVersion: version, operationCount, state: strokes.map(serializeStroke) } })
}

async function maybeSaveSnapshot(roomId: string, version: number) {
  const [count, latest] = await Promise.all([
    prisma.whiteboardStroke.count({ where: { roomId, boardVersion: version } }),
    prisma.whiteboardSnapshot.findFirst({ where: { roomId, boardVersion: version }, orderBy: { operationCount: 'desc' }, select: { operationCount: true } }),
  ])
  if (count - (latest?.operationCount ?? 0) >= SNAPSHOT_INTERVAL) await saveSnapshot(roomId, version)
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, { maxHttpBufferSize: 100 * 1024, cors: { origin: [...allowedOrigins], credentials: true } })

  io.use(async (socket, next) => {
    try {
      const rawToken = (socket.handshake.auth?.token as string | undefined) ?? getCookieValue(socket.handshake.headers.cookie, AUTH_COOKIE_NAME) ?? (typeof socket.handshake.headers.authorization === 'string' ? socket.handshake.headers.authorization.replace('Bearer ', '') : undefined)
      if (!rawToken) return next(new Error('Authentication required'))
      const payload = jwt.verify(rawToken, config.jwtSecret) as TokenPayload
      const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, displayName: true, email: true } })
      if (!user) return next(new Error('User not found'))
      socket.data.user = user
      socket.data.rooms = new Set()
      return next()
    } catch (error) { return next(error as Error) }
  })

  io.on('connection', (socket) => {
    const user = socket.data.user!

    socket.on('session:join', async ({ roomId }) => {
      try {
        const validRoomId = roomIdSchema.parse(roomId)
        const role = await getRoomRole(validRoomId, user.id)
        if (!role) return socket.emit('session:error', { roomId: validRoomId, message: 'Room not found or access denied' })
        const [document, recentMessages] = await Promise.all([
          getDocument(validRoomId),
          prisma.roomMessage.findMany({ where: { roomId: validRoomId }, include: { user: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: MAX_CHAT_HISTORY }),
        ])
        const [whiteboardStrokes, redoCount] = await Promise.all([
          getBoardState(validRoomId, document.version),
          prisma.whiteboardStroke.count({ where: { roomId: validRoomId, userId: user.id, boardVersion: document.version, undoneAt: { not: null }, redoInvalidatedAt: null } }),
        ])
        socket.join(validRoomId)
        socket.data.rooms?.add(validRoomId)
        const participants = getParticipants(validRoomId)
        const presence: ParticipantPresence = { userId: user.id, displayName: user.displayName, email: user.email, role }
        participants.set(user.id, presence)
        socket.emit('session:joined', { roomId: validRoomId, participants: Array.from(participants.values()), chatHistory: recentMessages.reverse().map(serializeMessage), whiteboardStrokes })
        socket.emit('whiteboard:undo-state', { roomId: validRoomId, canUndo: whiteboardStrokes.some((stroke) => stroke.userId === user.id), canRedo: redoCount > 0 })
        socket.to(validRoomId).emit('session:participant:joined', { roomId: validRoomId, participant: presence })
      } catch (error) { socket.emit('session:error', { roomId, message: error instanceof Error ? error.message : 'Unable to join room' }) }
    })

    socket.on('session:leave', ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId)) return
      socket.leave(roomId); socket.data.rooms?.delete(roomId); removeParticipant(roomId, user.id)
      socket.to(roomId).emit('session:participant:left', { roomId, userId: user.id })
    })

    socket.on('session:cursor', ({ roomId, cursor }) => {
      if (!socket.data.rooms?.has(roomId)) return
      const parsed = cursorSchema.safeParse(cursor)
      if (!parsed.success) return
      const presence = roomParticipants.get(roomId)?.get(user.id)
      if (!presence) return
      presence.cursor = parsed.data
      socket.to(roomId).emit('session:cursor', { roomId, userId: user.id, cursor: parsed.data })
    })

    socket.on('chat:message', async (payload) => {
      const parsed = chatSchema.safeParse(payload)
      if (!parsed.success || !socket.data.rooms?.has(parsed.data.roomId)) return
      try {
        const message = await prisma.roomMessage.create({ data: { roomId: parsed.data.roomId, userId: user.id, content: parsed.data.content }, include: { user: { select: { displayName: true } } } })
        io.to(parsed.data.roomId).emit('chat:message', serializeMessage(message))
      } catch { socket.emit('session:error', { roomId: parsed.data.roomId, message: 'Unable to save message.' }) }
    })

    socket.on('whiteboard:stroke', async (payload) => {
      const parsed = strokeSchema.safeParse(payload)
      if (!parsed.success || !socket.data.rooms?.has(parsed.data.roomId)) return
      const { roomId, stroke } = parsed.data
      if (!roomParticipants.get(roomId)?.has(user.id)) return
      try {
        const role = await getRoomRole(roomId, user.id)
        if (role !== 'owner' && role !== 'editor') return socket.emit('session:error', { roomId, message: 'Your viewer role cannot draw on this board.' })
        const document = await getDocument(roomId)
        const now = new Date()
        await prisma.whiteboardStroke.updateMany({ where: { roomId, userId: user.id, boardVersion: document.version, undoneAt: { not: null }, redoInvalidatedAt: null }, data: { redoInvalidatedAt: now } })
        const saved = await prisma.whiteboardStroke.upsert({
          where: { roomId_clientId: { roomId, clientId: stroke.clientId } },
          create: { roomId, userId: user.id, clientId: stroke.clientId, boardVersion: document.version, color: stroke.color, size: stroke.size, tool: stroke.tool, points: stroke.points },
          update: {}, include: { user: { select: { displayName: true } } },
        })
        const fullStroke = serializeStroke(saved)
        io.to(roomId).emit('whiteboard:stroke', { roomId, stroke: fullStroke })
        socket.emit('whiteboard:undo-state', { roomId, canUndo: true, canRedo: false })
        await maybeSaveSnapshot(roomId, document.version)
      } catch { socket.emit('session:error', { roomId, message: 'Unable to save stroke.' }) }
    })

    socket.on('whiteboard:undo', async ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId) || !roomParticipants.get(roomId)?.has(user.id)) return
      try {
        const role = await getRoomRole(roomId, user.id)
        if (role !== 'owner' && role !== 'editor') return socket.emit('session:error', { roomId, message: 'Your viewer role cannot change this board.' })
        const document = await getDocument(roomId)
        const stroke = await prisma.whiteboardStroke.findFirst({ where: { roomId, userId: user.id, boardVersion: document.version, undoneAt: null }, orderBy: { createdAt: 'desc' } })
        if (!stroke) return socket.emit('whiteboard:undo-state', { roomId, canUndo: false, canRedo: false })
        await prisma.whiteboardStroke.update({ where: { id: stroke.id }, data: { undoneAt: new Date() } })
        io.to(roomId).emit('whiteboard:stroke:removed', { roomId, strokeId: stroke.id })
        const canUndo = await prisma.whiteboardStroke.count({ where: { roomId, userId: user.id, boardVersion: document.version, undoneAt: null } }) > 0
        socket.emit('whiteboard:undo-state', { roomId, canUndo, canRedo: true })
        await saveSnapshot(roomId, document.version)
      } catch { socket.emit('session:error', { roomId, message: 'Unable to undo stroke.' }) }
    })

    socket.on('whiteboard:redo', async ({ roomId }) => {
      if (!socket.data.rooms?.has(roomId) || !roomParticipants.get(roomId)?.has(user.id)) return
      try {
        const role = await getRoomRole(roomId, user.id)
        if (role !== 'owner' && role !== 'editor') return socket.emit('session:error', { roomId, message: 'Your viewer role cannot change this board.' })
        const document = await getDocument(roomId)
        const stroke = await prisma.whiteboardStroke.findFirst({ where: { roomId, userId: user.id, boardVersion: document.version, undoneAt: { not: null }, redoInvalidatedAt: null }, include: { user: { select: { displayName: true } } }, orderBy: { undoneAt: 'desc' } })
        if (!stroke) return socket.emit('whiteboard:undo-state', { roomId, canUndo: false, canRedo: false })
        await prisma.whiteboardStroke.update({ where: { id: stroke.id }, data: { undoneAt: null } })
        io.to(roomId).emit('whiteboard:stroke', { roomId, stroke: serializeStroke(stroke) })
        const canRedo = await prisma.whiteboardStroke.count({ where: { roomId, userId: user.id, boardVersion: document.version, undoneAt: { not: null }, redoInvalidatedAt: null } }) > 0
        socket.emit('whiteboard:undo-state', { roomId, canUndo: true, canRedo })
        await saveSnapshot(roomId, document.version)
      } catch { socket.emit('session:error', { roomId, message: 'Unable to redo stroke.' }) }
    })

    socket.on('disconnect', () => {
      for (const roomId of socket.data.rooms ?? []) { removeParticipant(roomId, user.id); socket.to(roomId).emit('session:participant:left', { roomId, userId: user.id }) }
      socket.data.rooms?.clear()
    })
  })
  return io
}
