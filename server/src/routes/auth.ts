import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { z } from 'zod'
import prisma from '../lib/prisma'
import config from '../config'
import { requireAuth, type AuthRequest } from '../middleware/auth'

const router = Router()

const VERIFICATION_TTL_MINUTES = 30
const RESEND_COOLDOWN_MS = 60 * 1000

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(2).max(50),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(8),
})

const resendSchema = z.object({
  email: z.string().email(),
})

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function createToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '1d' })
}

function maskUser(user: { id: string; email: string; displayName: string; status: string; emailVerifiedAt: Date | null }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
  }
}

function generateCode() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

async function issueVerificationToken(userId: string) {
  const token = generateCode()
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000)

  return prisma.emailVerification.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  })
}

async function sendVerificationEmail(email: string, token: string) {
  console.info(`[auth] Verification code for ${email}: ${token}`)
}

router.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body)
    const normalizedEmail = normalizeEmail(data.email)

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existingUser) {
      return res.status(409).json({ message: 'Email already registered' })
    }

    const passwordHash = await bcrypt.hash(data.password, 10)
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        displayName: data.displayName,
        status: 'pending',
      },
    })

    const verification = await issueVerificationToken(user.id)
    await sendVerificationEmail(user.email, verification.token)

    return res.status(201).json({
      requiresVerification: true,
      email: user.email,
      message: 'Verification code sent. Please check your inbox.',
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

    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Please verify your email before signing in.' })
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

router.post('/verify', async (req, res, next) => {
  try {
    const data = verifySchema.parse(req.body)
    const normalizedEmail = normalizeEmail(data.email)
    const code = data.code.trim()

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return res.status(404).json({ message: 'Account not found.' })
    }

    if (user.status === 'active') {
      const token = createToken(user.id)
      return res.json({ token, user: maskUser(user) })
    }

    const verification = await prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        token: code,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!verification) {
      return res.status(400).json({ message: 'Invalid or expired code.' })
    }

    const now = new Date()
    const updatedUser = await prisma.$transaction(async (tx) => {
      await tx.emailVerification.update({
        where: { id: verification.id },
        data: { consumedAt: now },
      })

      return tx.user.update({
        where: { id: user.id },
        data: { status: 'active', emailVerifiedAt: now },
      })
    })

    const token = createToken(updatedUser.id)

    return res.json({
      token,
      user: maskUser(updatedUser),
    })
  } catch (error) {
    next(error)
  }
})

router.post('/resend-code', async (req, res, next) => {
  try {
    const data = resendSchema.parse(req.body)
    const normalizedEmail = normalizeEmail(data.email)

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (!user) {
      return res.status(404).json({ message: 'Account not found.' })
    }

    if (user.status === 'active') {
      return res.status(400).json({ message: 'Account already verified.' })
    }

    const latest = await prisma.emailVerification.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: 'Please wait before requesting another code.' })
    }

    const verification = await issueVerificationToken(user.id)
    await sendVerificationEmail(user.email, verification.token)

    return res.json({ message: 'Verification code resent.' })
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
