import { Router } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()

const createRoomSchema = z.object({
  title: z.string().min(3).max(80),
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

export default router
