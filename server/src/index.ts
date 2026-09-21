import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import http from 'http'
import config, { isAllowedOrigin } from './config'
import authRouter from './routes/auth'
import { createSessionRoomsRouter } from './routes/sessionRooms'
import { errorHandler } from './middleware/errorHandler'
import { createSocketServer } from './realtime/socketServer'
import prisma from './lib/prisma'

const app = express()
const server = http.createServer(app)
const io = createSocketServer(server)

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
  }),
)
app.use(helmet())
app.use(express.json({ limit: '100kb' }))
app.use(cookieParser())

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many authentication attempts. Please try again later.' },
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authLimiter, authRouter)
app.use('/api/session-rooms', createSessionRoomsRouter(io))
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.path} not found` })
})

app.use(errorHandler)

server.listen(config.port, () => {
  console.log(`API server listening on http://localhost:${config.port}`)
})

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.info(`[server] ${signal} received; closing connections.`)
  io.close()
  server.close(async (error) => {
    await prisma.$disconnect()
    if (error) {
      console.error('[server] Failed to close cleanly', error)
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })
