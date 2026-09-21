import { Router } from 'express'
import crypto from 'crypto'
import type { Server } from 'socket.io'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '../realtime/types'

const createRoomSchema = z.object({ title: z.string().trim().min(3).max(80) })
const joinRoomSchema = z.object({ inviteCode: z.string().trim().min(8).max(60) })
const roleSchema = z.object({ role: z.enum(['editor', 'viewer']) })
const inviteSettingsSchema = z.object({ expiresAt: z.string().datetime().nullable() })

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>

function createInviteCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase()
}

async function createUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = createInviteCode()
    const existing = await prisma.sessionRoom.findUnique({ where: { inviteCode }, select: { id: true } })
    if (!existing) return inviteCode
  }
  throw new Error('Unable to generate a unique invite code')
}

async function requireOwner(roomId: string, userId: string) {
  const membership = await prisma.sessionRoomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true },
  })
  if (!membership || membership.role !== 'owner') {
    const error = new Error('Only the room owner can perform this action.') as Error & { status?: number }
    error.status = 403
    throw error
  }
}

export function createSessionRoomsRouter(io: RealtimeServer) {
  const router = Router()
  router.use(requireAuth)

  router.get('/', async (req: AuthRequest, res, next) => {
    try {
      const rooms = await prisma.sessionRoom.findMany({ where: { members: { some: { userId: req.userId } } }, orderBy: { createdAt: 'desc' } })
      return res.json({ rooms })
    } catch (error) { next(error) }
  })

  router.get('/:roomId/members', async (req: AuthRequest, res, next) => {
    try {
      const room = await prisma.sessionRoom.findFirst({ where: { id: req.params.roomId, members: { some: { userId: req.userId } } }, select: { id: true } })
      if (!room) return res.status(404).json({ message: 'Room not found' })
      const members = await prisma.sessionRoomMember.findMany({
        where: { roomId: room.id },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      })
      return res.json({ members })
    } catch (error) { next(error) }
  })

  router.get('/:roomId', async (req: AuthRequest, res, next) => {
    try {
      const room = await prisma.sessionRoom.findFirst({ where: { id: req.params.roomId, members: { some: { userId: req.userId } } } })
      if (!room) return res.status(404).json({ message: 'Room not found' })
      return res.json({ room })
    } catch (error) { next(error) }
  })

  router.post('/', async (req: AuthRequest, res, next) => {
    try {
      const { title } = createRoomSchema.parse(req.body)
      const inviteCode = await createUniqueInviteCode()
      const room = await prisma.sessionRoom.create({ data: { title, inviteCode, createdById: req.userId!, members: { create: { userId: req.userId!, role: 'owner' } } } })
      return res.status(201).json(room)
    } catch (error) { next(error) }
  })

  router.post('/join', async (req: AuthRequest, res, next) => {
    try {
      const { inviteCode } = joinRoomSchema.parse(req.body)
      const room = await prisma.sessionRoom.findUnique({ where: { inviteCode: inviteCode.toUpperCase() } })
      if (!room || room.inviteRevokedAt || (room.inviteExpiresAt && room.inviteExpiresAt <= new Date())) {
        return res.status(404).json({ message: 'No active room matches that code.' })
      }
      await prisma.sessionRoomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId: req.userId! } },
        create: { roomId: room.id, userId: req.userId!, role: 'viewer' }, update: {},
      })
      return res.json({ room })
    } catch (error) { next(error) }
  })

  router.patch('/:roomId/members/:userId', async (req: AuthRequest, res, next) => {
    try {
      const { role } = roleSchema.parse(req.body)
      await requireOwner(req.params.roomId, req.userId!)
      const existing = await prisma.sessionRoomMember.findUnique({ where: { roomId_userId: { roomId: req.params.roomId, userId: req.params.userId } } })
      if (!existing) return res.status(404).json({ message: 'Room member not found' })
      if (existing.role === 'owner') return res.status(400).json({ message: 'The room owner role cannot be changed.' })
      const member = await prisma.sessionRoomMember.update({
        where: { roomId_userId: { roomId: req.params.roomId, userId: req.params.userId } }, data: { role },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      })
      io.to(req.params.roomId).emit('session:member:role', { roomId: req.params.roomId, userId: member.userId, role: member.role })
      return res.json({ member })
    } catch (error) { next(error) }
  })

  router.patch('/:roomId/invite', async (req: AuthRequest, res, next) => {
    try {
      const { expiresAt } = inviteSettingsSchema.parse(req.body)
      const parsedExpiry = expiresAt ? new Date(expiresAt) : null
      if (parsedExpiry && parsedExpiry <= new Date()) return res.status(400).json({ message: 'Invite expiry must be in the future.' })
      await requireOwner(req.params.roomId, req.userId!)
      const room = await prisma.sessionRoom.update({ where: { id: req.params.roomId }, data: { inviteExpiresAt: parsedExpiry } })
      return res.json({ room })
    } catch (error) { next(error) }
  })

  router.post('/:roomId/invite/revoke', async (req: AuthRequest, res, next) => {
    try {
      await requireOwner(req.params.roomId, req.userId!)
      const room = await prisma.sessionRoom.update({ where: { id: req.params.roomId }, data: { inviteRevokedAt: new Date() } })
      return res.json({ room })
    } catch (error) { next(error) }
  })

  router.post('/:roomId/invite/rotate', async (req: AuthRequest, res, next) => {
    try {
      await requireOwner(req.params.roomId, req.userId!)
      const inviteCode = await createUniqueInviteCode()
      const room = await prisma.sessionRoom.update({ where: { id: req.params.roomId }, data: { inviteCode, inviteRevokedAt: null, inviteExpiresAt: null } })
      return res.json({ room })
    } catch (error) { next(error) }
  })

  return router
}
