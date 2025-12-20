import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import prisma from '../lib/prisma'
import config from '../config'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import crypto from 'crypto'

const router = Router()

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(2).max(50),
  inviteCode: z.string().min(8),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const inviteSchema = z.object({
  email: z.string().email(),
  expiresInDays: z.number().int().min(1).max(30).optional(),
})

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function createToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '1d' })
}

function maskUser(user: { id: string; email: string; displayName: string }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  }
}

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body)
    const normalizedEmail = normalizeEmail(data.email)
    const inviteCode = data.inviteCode.trim().toUpperCase()

    const invite = await prisma.inviteToken.findUnique({ where: { token: inviteCode } })
    if (!invite) {
      return res.status(403).json({ message: 'Invalid invite code' })
    }

    if (invite.usedAt) {
      return res.status(403).json({ message: 'Invite has already been used' })
    }

    if (invite.expiresAt < new Date()) {
      return res.status(403).json({ message: 'Invite has expired' })
    }

    if (normalizeEmail(invite.email) !== normalizeEmail(data.email)) {
      return res.status(403).json({ message: 'Invite email mismatch' })
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(data.password, 10)

    const user = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          displayName: data.displayName,
        },
      })

      await tx.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      })

      return createdUser
    })

    const token = createToken(user.id)

    return res.status(201).json({
      token,
      user: maskUser(user),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/login', async (req, res, next) => {
  try {
    const credentials = loginSchema.parse(req.body)
    const normalizedEmail = normalizeEmail(credentials.email)

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const isValidPassword = await bcrypt.compare(credentials.password, user.passwordHash)
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    const token = createToken(user.id)

    return res.json({
      token,
      user: maskUser(user),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/invite', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const data = inviteSchema.parse(req.body)
    const expiresAt = new Date()
    const expiresInDays = data.expiresInDays ?? 7
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    const token = crypto.randomBytes(4).toString('hex').toUpperCase()

    const invite = await prisma.inviteToken.create({
      data: {
        email: normalizeEmail(data.email),
        token,
        expiresAt,
        issuedById: req.userId!,
      },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        issuedAt: true,
      },
    })

    return res.status(201).json({ invite })
  } catch (error) {
    next(error)
  }
})

router.get('/me', requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
    })

    if (!user) {
      return res.status(404).json({ message: 'User not found' })
    }

    return res.json({ user: maskUser(user) })
  } catch (error) {
    next(error)
  }
})

export default router
