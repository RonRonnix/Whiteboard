import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { API_BASE_URL } from '../lib/api'
import { useAuthStore, type AuthState } from '../store/authStore'
import type {
  ChatMessage,
  ClientToServerEvents,
  CursorState,
  ParticipantPresence,
  ServerToClientEvents,
} from '../types/realtime'

export default function RoomPage() {
  const { roomId: rawRoomId } = useParams<{ roomId: string }>()
  const roomId = rawRoomId ?? ''
  const navigate = useNavigate()
  const token = useAuthStore((state: AuthState) => state.token)
  const currentUserId = useAuthStore((state: AuthState) => state.user?.id)
  const [participants, setParticipants] = useState<ParticipantPresence[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)

  const roomLabel = useMemo(() => roomId?.slice(0, 6).toUpperCase() ?? 'ROOM', [roomId])

  useEffect(() => {
    if (!roomId || !token) {
      setError('Missing room or token')
      setStatus('error')
      return
    }
    setStatus('connecting')
    setError(null)

    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
      auth: { token },
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setStatus('connected')
      socket.emit('session:join', { roomId })
    })

    socket.on('connect_error', (err) => {
      setStatus('error')
      setError(err.message)
    })

    socket.on('session:joined', ({ participants: initial, chatHistory }) => {
      setParticipants(initial)
      setChatMessages(chatHistory)
      setError(null)
    })

    socket.on('session:participant:joined', ({ participant }) => {
      setParticipants((prev) => {
        const exists = prev.some((p) => p.userId === participant.userId)
        if (exists) return prev
        return [...prev, participant]
      })
    })

    socket.on('session:participant:left', ({ userId: leftId }) => {
      setParticipants((prev) => prev.filter((participant) => participant.userId !== leftId))
    })

    socket.on('session:cursor', ({ userId: cursorOwner, cursor }) => {
      setParticipants((prev) =>
        prev.map((participant) =>
          participant.userId === cursorOwner ? { ...participant, cursor } : participant,
        ),
      )
    })

    socket.on('chat:message', (message) => {
      setChatMessages((prev) => [...prev.slice(-49), message])
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })

    socket.on('session:error', ({ message }) => {
      setError(message)
      setStatus('error')
    })

    return () => {
      socket.emit('session:leave', { roomId })
      socket.disconnect()
    }
  }, [roomId, token])

  const handleSendMessage = () => {
    const trimmed = chatInput.trim()
    if (!trimmed || !socketRef.current || !roomId) return
    socketRef.current.emit('chat:message', { roomId, content: trimmed })
    setChatInput('')
  }

  const handleCursorUpdate = (cursor: CursorState) => {
    if (!socketRef.current || !roomId) return
    socketRef.current.emit('session:cursor', { roomId, cursor })
  }

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      handleCursorUpdate({ x: event.clientX, y: event.clientY })
    }

    if (status === 'connected') {
      window.addEventListener('mousemove', handleMouseMove)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [status])

  const leaveRoom = () => {
    navigate('/')
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-50">
      <header className="flex items-center justify-between border-b border-slate-900/70 bg-slate-950/60 px-6 py-4">
        <div className="px-6">
          <p className="text-xs uppercase tracking-[0.4em] text-indigo-400">Session</p>
          <h1 className="text-xl font-semibold text-white">Room {roomLabel}</h1>
          <p className="text-sm text-slate-400">
            Status: <span className={status === 'connected' ? 'text-emerald-300' : 'text-amber-300'}>{status}</span>
          </p>
        </div>
        <button
          onClick={leaveRoom}
          className="mr-6 rounded-xl border border-slate-800 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-slate-700"
        >
          Leave room
        </button>
      </header>

      <main className="grid flex-1 gap-6 px-6 py-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-slate-900/60 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Participants</h2>
              <p className="text-sm text-slate-400">Live cursors update while you move your mouse.</p>
            </div>
            <span className="rounded-full border border-slate-800 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
              {participants.length} online
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {participants.map((participant) => (
              <li key={participant.userId} className="flex items-center justify-between rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">
                    {participant.displayName}
                    {participant.userId === currentUserId && <span className="ml-2 text-xs text-emerald-300">(You)</span>}
                  </p>
                  <p className="text-sm text-slate-400">{participant.email}</p>
                </div>
                {participant.cursor && (
                  <p className="text-xs text-slate-500">
                    Cursor: {Math.round(participant.cursor.x)}, {Math.round(participant.cursor.y)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col rounded-2xl border border-slate-900/60 bg-slate-900/40">
          <div className="border-b border-slate-800/70 px-4 py-3">
            <h2 className="text-lg font-semibold text-white">Chat</h2>
            <p className="text-sm text-slate-400">Share quick notes while collaborating.</p>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {chatMessages.map((message) => (
              <div key={message.id} className="rounded-xl border border-slate-800/60 bg-slate-950/60 px-4 py-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-slate-200">{message.displayName}</span>
                  <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1 text-sm text-slate-100">{message.content}</p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="border-t border-slate-800/70 p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleSendMessage()
                  }
                }}
                placeholder="Type a message"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-2 text-white outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
              />
              <button
                type="button"
                onClick={handleSendMessage}
                className="rounded-xl bg-indigo-500/90 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Send
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
          </div>
        </section>
      </main>
    </div>
  )
}
