import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation failed',
      issues: error.errors.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }

  if (error instanceof Error) {
    const status = (error as Error & { status?: number }).status ?? 500
    return res.status(status).json({ message: error.message })
  }

  return res.status(500).json({ message: 'Unexpected server error' })
}
