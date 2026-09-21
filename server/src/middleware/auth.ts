import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import config from '../config'

export interface AuthRequest extends Request {
  userId?: string
}

export const AUTH_COOKIE_NAME = 'whiteboard_auth'

type TokenPayload = {
  sub: string
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : cookieToken

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' })
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as TokenPayload
    req.userId = decoded.sub
    return next()
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
}
