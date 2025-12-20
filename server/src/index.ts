import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import http from 'http'
import config from './config'
import authRouter from './routes/auth'
import sessionRoomsRouter from './routes/sessionRooms'
import { errorHandler } from './middleware/errorHandler'
import { createSocketServer } from './realtime/socketServer'

const app = express()

app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
  }),
)
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRouter)
app.use('/api/session-rooms', sessionRoomsRouter)

app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.path} not found` })
})

app.use(errorHandler)

const server = http.createServer(app)
createSocketServer(server)

server.listen(config.port, () => {
  console.log(`API server listening on http://localhost:${config.port}`)
})
