import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { API_BASE_URL, fetchRoomMembers, fetchSessionRoom, revokeRoomInvite, rotateRoomInvite, updateRoomInvite, updateRoomMemberRole } from '../lib/api'
import { useAuthStore, type AuthState } from '../store/authStore'
import WhiteboardCanvas from '../components/WhiteboardCanvas'
import type { RoomMember, RoomRole, SessionRoom } from '../types'
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
  const [members, setMembers] = useState<RoomMember[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [roomInfo, setRoomInfo] = useState<SessionRoom | null>(null)
  const [roomInfoError, setRoomInfoError] = useState<string | null>(null)
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([])
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)

  const roomLabel = useMemo(() => roomId?.slice(0, 6).toUpperCase() ?? 'ROOM', [roomId])
  const currentMember = members.find((member) => member.userId === currentUserId)
  const isOwner = currentMember?.role === 'owner'
  const canDraw = currentMember?.role === 'owner' || currentMember?.role === 'editor'

  useEffect(() => {
    if (!roomId) return
    let cancelled = false

    async function loadRoomDetails() {
      try {
        setRoomInfoError(null)
        const [response, memberResponse] = await Promise.all([fetchSessionRoom(roomId), fetchRoomMembers(roomId)])
        if (!cancelled) {
          setRoomInfo(response.room)
          setMembers(memberResponse.members)
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
    if (!roomId || !currentUser) return
    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
      withCredentials: true,
      ...(token ? { auth: { token } } : {}),
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

    socket.on('session:member:role', ({ roomId: updatedRoomId, userId, role }) => {
      if (updatedRoomId !== roomId) return
      setMembers((previous) => previous.map((member) => (member.userId === userId ? { ...member, role } : member)))
      setParticipants((previous) => previous.map((participant) => (participant.userId === userId ? { ...participant, role } : participant)))
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

    socket.on('whiteboard:stroke:removed', ({ roomId: incomingRoomId, strokeId }) => {
      if (incomingRoomId !== roomId) return
      setStrokes((previous) => previous.filter((stroke) => stroke.id !== strokeId))
    })

    socket.on('whiteboard:undo-state', ({ roomId: incomingRoomId, canUndo, canRedo }) => {
      if (incomingRoomId !== roomId) return
      setUndoState({ canUndo, canRedo })
    })

    socket.on('session:error', ({ message }) => {
      setError(message)
      setStatus('error')
    })

    return () => {
      socket.emit('session:leave', { roomId })
      socket.disconnect()
    }
  }, [roomId, token, currentUser])

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

  const handleUndo = useCallback(() => {
    if (!roomId || !socketRef.current || !canDraw || !undoState.canUndo) return
    socketRef.current.emit('whiteboard:undo', { roomId })
  }, [roomId, canDraw, undoState.canUndo])

  const handleRedo = useCallback(() => {
    if (!roomId || !socketRef.current || !canDraw || !undoState.canRedo) return
    socketRef.current.emit('whiteboard:redo', { roomId })
  }, [roomId, canDraw, undoState.canRedo])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTextInput = target instanceof HTMLInputElement && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(target.type)
      if (isTextInput || target instanceof HTMLTextAreaElement || target?.isContentEditable) return
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  const handleRoleChange = async (member: RoomMember, role: Exclude<RoomRole, 'owner'>) => {
    if (!roomId || member.role === role) return
    try {
      const response = await updateRoomMemberRole(roomId, member.userId, role)
      setMembers((previous) => previous.map((item) => (item.userId === member.userId ? response.member : item)))
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : 'Unable to update member role')
    }
  }

  const handleRotateInvite = async () => {
    if (!roomId) return
    try {
      const response = await rotateRoomInvite(roomId)
      setRoomInfo(response.room)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to rotate invite code')
    }
  }

  const handleInviteExpiry = async (expiresAt: string | null) => {
    if (!roomId) return
    try {
      const response = await updateRoomInvite(roomId, { expiresAt })
      setRoomInfo(response.room)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to update invite expiry')
    }
  }

  const handleRevokeInvite = async () => {
    if (!roomId) return
    try {
      const response = await revokeRoomInvite(roomId)
      setRoomInfo(response.room)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to revoke invite')
    }
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

  const handleCursorUpdate = useCallback((cursor: CursorState) => {
    if (!socketRef.current || !roomId) return
    socketRef.current.emit('session:cursor', { roomId, cursor })
  }, [roomId])

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
  }, [status, handleCursorUpdate])

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
            {members.map((member) => {
              const participant = participants.find((item) => item.userId === member.userId)
              return (
              <li key={member.userId} className="rounded-xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">
                    {member.user.displayName}
                    {member.userId === currentUserId && <span className="ml-2 text-xs text-emerald-300">(You)</span>}
                  </p>
                  <p className="text-sm text-slate-400">{member.user.email}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span className="rounded-full border border-slate-700 px-2 py-1 uppercase tracking-wide text-slate-300">{member.role}</span>
                  {isOwner && member.role !== 'owner' ? (
                    <select value={member.role} onChange={(event) => handleRoleChange(member, event.target.value as Exclude<RoomRole, 'owner'>)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100">
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  ) : null}
                </div>
                {participant?.cursor && (
                  <p className="text-xs text-slate-500">
                    Cursor: {Math.round(participant.cursor.x)}, {Math.round(participant.cursor.y)}
                  </p>
                )}
              </li>
              )
            })}
          </ul>
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-6 rounded-3xl border border-slate-900/60 bg-slate-900/40 p-4 shadow-2xl shadow-black/40">
          <div className="flex flex-col gap-4 border-b border-slate-800/70 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-indigo-400">Whiteboard</p>
              <h2 className="text-2xl font-semibold text-white">Sketch ideas together</h2>
              <p className="text-sm text-slate-500">{strokes.length} live strokes</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleUndo} disabled={!canDraw || !undoState.canUndo} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">
                Undo
              </button>
              <button type="button" onClick={handleRedo} disabled={!canDraw || !undoState.canRedo} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-40">
                Redo
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-950/60 px-4 py-3">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.4em] text-slate-500">Invite code</p>
                <p className="text-xl font-mono font-semibold text-white">{roomInfo ? roomInfo.inviteCode : '--------'}</p>
                {roomInfo?.inviteRevokedAt ? <p className="text-xs text-rose-300">Invite revoked</p> : roomInfo?.inviteExpiresAt ? <p className="text-xs text-amber-300">Expires {new Date(roomInfo.inviteExpiresAt).toLocaleString()}</p> : null}
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
            {isOwner && (
              <div className="flex flex-wrap gap-2 text-xs">
                <button type="button" onClick={handleRotateInvite} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 hover:border-indigo-400">Rotate code</button>
                <button type="button" onClick={() => handleInviteExpiry(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 hover:border-indigo-400">Expire in 24h</button>
                <button type="button" onClick={() => handleInviteExpiry(null)} className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 hover:border-indigo-400">No expiry</button>
                <button type="button" onClick={handleRevokeInvite} className="rounded-lg border border-rose-500/60 px-3 py-2 text-rose-200 hover:border-rose-400">Revoke</button>
              </div>
            )}
          </div>
          {roomInfoError && <p className="text-sm text-red-300">{roomInfoError}</p>}
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex flex-1">
              <WhiteboardCanvas
                className="flex-1"
                strokes={strokes}
                onStrokeComplete={handleStrokeComplete}
                disabled={status !== 'connected' || !canDraw}
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
