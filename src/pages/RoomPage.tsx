import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { API_BASE_URL, fetchSessionRoom } from '../lib/api'
import { useAuthStore, type AuthState } from '../store/authStore'
import WhiteboardCanvas from '../components/WhiteboardCanvas'
import type { SessionRoom } from '../types'
import type {
  ChatMessage,
  ClientToServerEvents,
  CursorState,
  NewStroke,
  ParticipantPresence,
  ServerToClientEvents,
  WhiteboardStroke,
} from '../types/realtime'

export default function RoomPage() {
  const { roomId: rawRoomId } = useParams<{ roomId: string }>()
  const roomId = rawRoomId ?? ''
  const navigate = useNavigate()
  const token = useAuthStore((state: AuthState) => state.token)
  const currentUser = useAuthStore((state: AuthState) => state.user)
  const currentUserId = currentUser?.id
  const [participants, setParticipants] = useState<ParticipantPresence[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [roomInfo, setRoomInfo] = useState<SessionRoom | null>(null)
  const [roomInfoError, setRoomInfoError] = useState<string | null>(null)
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([])
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  const roomLabel = useMemo(() => roomId?.slice(0, 6).toUpperCase() ?? 'ROOM', [roomId])

  useEffect(() => {
    if (!roomId) return
    let cancelled = false

    async function loadRoomDetails() {
      try {
        setRoomInfoError(null)
        const response = await fetchSessionRoom(roomId)
        if (!cancelled) {
          setRoomInfo(response.room)
        }
      } catch (err) {
        if (!cancelled) {
          setRoomInfoError(err instanceof Error ? err.message : 'Unable to load room info')
        }
      }
    }

    loadRoomDetails()

    return () => {
      cancelled = true
    }
  }, [roomId])

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

    socket.on('session:joined', ({ participants: initial, chatHistory, whiteboardStrokes }) => {
      setParticipants(initial)
      setChatMessages(chatHistory)
      setStrokes(whiteboardStrokes)
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

    socket.on('whiteboard:stroke', ({ roomId: incomingRoomId, stroke }) => {
      if (incomingRoomId !== roomId) return
      setStrokes((prev) => {
        if (stroke.clientId) {
          const existingIndex = prev.findIndex((item) => item.clientId === stroke.clientId)
          if (existingIndex !== -1) {
            const next = [...prev]
            next[existingIndex] = stroke
            return next
          }
        }
        return [...prev, stroke]
      })
    })

    socket.on('whiteboard:clear', ({ roomId: clearedRoomId }) => {
      if (clearedRoomId !== roomId) return
      setStrokes([])
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

  const handleStrokeComplete = (stroke: NewStroke) => {
    if (!roomId || !socketRef.current) return

    const clonedStroke: NewStroke = {
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
    }

    const optimisticStroke: WhiteboardStroke = {
      id: `local-${clonedStroke.clientId}`,
      clientId: clonedStroke.clientId,
      roomId,
      userId: currentUserId ?? 'local-user',
      displayName: currentUser?.displayName ?? 'You',
      color: clonedStroke.color,
      size: clonedStroke.size,
      tool: clonedStroke.tool,
      points: clonedStroke.points,
      timestamp: new Date().toISOString(),
    }

    setStrokes((prev) => [...prev, optimisticStroke])
    socketRef.current.emit('whiteboard:stroke', { roomId, stroke: clonedStroke })
  }

  const handleClearBoard = () => {
    if (!roomId || !socketRef.current) return
    setStrokes([])
    socketRef.current.emit('whiteboard:clear', { roomId })
  }

  const handleCopyInviteCode = async () => {
    if (!roomInfo) return
    try {
      await navigator.clipboard.writeText(roomInfo.inviteCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1500)
    } catch (copyError) {
      console.warn('Unable to copy invite code', copyError)
    }
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

      <main className="flex w-full flex-1 flex-col gap-6 px-6 py-6 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
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

        <section className="flex min-h-0 flex-1 flex-col gap-6 rounded-3xl border border-slate-900/60 bg-slate-900/40 p-4 shadow-2xl shadow-black/40">
          <div className="flex flex-col gap-4 border-b border-slate-800/70 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-indigo-400">Whiteboard</p>
              <h2 className="text-2xl font-semibold text-white">Sketch ideas together</h2>
              <p className="text-sm text-slate-500">{strokes.length} live strokes</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.4em] text-slate-500">Invite code</p>
                <p className="text-xl font-mono font-semibold text-white">{roomInfo ? roomInfo.inviteCode : '--------'}</p>
              </div>
              <button
                type="button"
                onClick={handleCopyInviteCode}
                disabled={!roomInfo}
                className="rounded-xl border border-indigo-500/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-200 transition hover:border-indigo-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {copiedCode ? 'Copied!' : 'Copy code'}
              </button>
            </div>
          </div>
          {roomInfoError && <p className="text-sm text-red-300">{roomInfoError}</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex flex-1">
              <WhiteboardCanvas
                className="flex-1"
                strokes={strokes}
                onStrokeComplete={handleStrokeComplete}
                onClearBoard={handleClearBoard}
                disabled={status !== 'connected'}
              />
            </div>
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 lg:w-80 xl:w-96">
              <div className="flex items-center justify-between border-b border-slate-800/60 px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-indigo-400">Chat</p>
                  <h3 className="text-lg font-semibold text-white">Share quick notes</h3>
                  <p className="text-sm text-slate-400">Messages stay in sync while you draw.</p>
                </div>
              </div>
              <div className="flex max-h-[32rem] flex-col">
                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                  {chatMessages.map((message) => (
                    <div key={message.id} className="rounded-xl border border-slate-800/60 bg-slate-950/70 px-4 py-3">
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
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
