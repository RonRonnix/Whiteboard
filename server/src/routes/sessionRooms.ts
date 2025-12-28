import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()

const createRoomSchema = z.object({
  title: z.string().min(3).max(80),
})

const joinRoomSchema = z.object({
  inviteCode: z.string().min(6).max(60),
})

router.use(requireAuth)

router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const rooms = await prisma.sessionRoom.findMany({
      where: { createdById: req.userId },
      orderBy: { createdAt: 'desc' },
    })

    return res.json({ rooms })
  } catch (error) {
    next(error)
  }
})

router.get('/:roomId', async (req: AuthRequest, res, next) => {
  try {
    const room = await prisma.sessionRoom.findUnique({ where: { id: req.params.roomId } })

    if (!room) {
      return res.status(404).json({ message: 'Room not found' })
    }

    return res.json({ room })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req: AuthRequest, res, next) => {
  try {
    const { title } = createRoomSchema.parse(req.body)

    const inviteCode = crypto.randomUUID().slice(0, 8).toUpperCase()

    const room = await prisma.sessionRoom.create({
      data: {
        title,
        inviteCode,
        createdById: req.userId!,
      },
    })

    return res.status(201).json(room)
  } catch (error) {
    next(error)
  }
})

router.post('/join', async (req: AuthRequest, res, next) => {
  try {
    const { inviteCode } = joinRoomSchema.parse(req.body)
    const normalizedCode = inviteCode.trim().toUpperCase()

    const room = await prisma.sessionRoom.findUnique({ where: { inviteCode: normalizedCode } })

    if (!room) {
      return res.status(404).json({ message: 'No room matches that code.' })
    }

    return res.json({ room })
  } catch (error) {
    next(error)
  }
})

export default router
