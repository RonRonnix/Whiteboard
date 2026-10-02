import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { io, type Socket } from 'socket.io-client'
import { Check, Copy, LogOut, MessageSquare, SendHorizontal, UserPlus, X } from 'lucide-react'
import { API_BASE_URL, fetchRoomMembers, fetchSessionRoom, revokeRoomInvite, rotateRoomInvite, updateRoomInvite, updateRoomMemberRole } from '../lib/api'
import { useAuthStore, type AuthState } from '../store/authStore'
import WhiteboardCanvas from '../components/WhiteboardCanvas'
import ConfirmationDialog from '../components/ConfirmationDialog'
import type { RoomMember, RoomRole, SessionRoom } from '../types'
import type {
  ChatMessage,
  ChatSaveResult,
  ClientToServerEvents,
  CursorState,
  NewStroke,
  ParticipantPresence,
  ServerToClientEvents,
  StrokeSaveResult,
  WhiteboardStroke,
} from '../types/realtime'

type PendingConfirmation = { title: string; description: string; confirmLabel: string; tone?: 'primary' | 'danger'; action: () => void | Promise<void> }

// Design tokens. Everything below reads these through var(--...), so a re-theme is a one-place change.
const theme = {
  '--bg': '#0e1014',
  '--workspace': '#0b0d11',
  '--surface': '#151920',
  '--surface-2': '#1d222b',
  '--border': '#272c37',
  '--text': '#e9ecf2',
  '--muted': '#9097a8',
  '--accent': '#2dd4bf',
  '--accent-ink': '#04201c',
  '--danger': '#f87171',
  fontFamily: "'Geist Variable', 'Geist', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontSize: '14px',
} as CSSProperties

const AVATAR_HUES = [12, 38, 160, 190, 235, 270, 320]

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]} 42% 38%)`
}

function Avatar({ name, online, size = 28 }: { name: string; online?: boolean; size?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-full font-medium text-white"
        style={{ backgroundColor: avatarColor(name), fontSize: size * 0.4 }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[color:var(--surface)] ${online ? 'bg-[var(--accent)]' : 'bg-slate-600'}`}
          title={online ? 'Online' : 'Offline'}
        />
      )}
    </span>
  )
}

const roleLabel = (role: RoomRole) => role.charAt(0).toUpperCase() + role.slice(1)

export default function RoomPage() {
  const { roomId: rawRoomId } = useParams<{ roomId: string }>()
  const roomId = rawRoomId ?? ''
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
  const [previewStrokes, setPreviewStrokes] = useState<WhiteboardStroke[]>([])
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const peopleRef = useRef<HTMLDivElement | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const chatOpenRef = useRef(false)

  const roomLabel = useMemo(() => roomId?.slice(0, 6).toUpperCase() ?? 'ROOM', [roomId])
  const currentMember = members.find((member) => member.userId === currentUserId)
  const isOwner = currentMember?.role === 'owner'
  const canDraw = currentMember?.role === 'owner' || currentMember?.role === 'editor'
  const boardStrokes = useMemo(() => [...strokes, ...previewStrokes], [strokes, previewStrokes])
  const onlineIds = useMemo(() => new Set(participants.map((participant) => participant.userId)), [participants])
  const bannerError = error ?? roomInfoError

  useEffect(() => {
    chatOpenRef.current = chatOpen
    if (chatOpen) setUnread(0)
  }, [chatOpen])

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
      setChatMessages((prev) => {
        if (prev.some((item) => item.id === message.id)) return prev
        if (!chatOpenRef.current) setUnread((count) => count + 1)
        return [...prev.slice(-49), message]
      })
    })

    socket.on('whiteboard:stroke', ({ roomId: incomingRoomId, stroke }) => {
      if (incomingRoomId !== roomId) return
      setPreviewStrokes((previous) => previous.filter((item) => item.clientId !== stroke.clientId))
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

    socket.on('whiteboard:preview', ({ roomId: incomingRoomId, userId, displayName, stroke }) => {
      if (incomingRoomId !== roomId || userId === currentUserId) return
      const preview: WhiteboardStroke = {
        id: `preview-${stroke.clientId}`,
        clientId: stroke.clientId,
        roomId: incomingRoomId,
        userId,
        displayName,
        color: stroke.color,
        size: stroke.size,
        tool: stroke.tool,
        points: stroke.points,
        timestamp: new Date().toISOString(),
      }
      setPreviewStrokes((previous) => [...previous.filter((item) => item.clientId !== stroke.clientId), preview])
    })

    socket.on('whiteboard:preview:clear', ({ roomId: incomingRoomId, clientId }) => {
      if (incomingRoomId !== roomId) return
      setPreviewStrokes((previous) => previous.filter((item) => item.clientId !== clientId))
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
  }, [roomId, token, currentUser, currentUserId])

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatOpen])

  const createClientId = () => crypto.randomUUID()

  const emitWithRetry = <TResult,>(event: 'whiteboard:stroke' | 'chat:message', payload: unknown, onResult: (result: TResult) => void, attempt = 0) => {
    const socket = socketRef.current
    if (!socket) return
    const acknowledgedSocket = socket.timeout(5000) as unknown as {
      emit: (eventName: string, eventPayload: unknown, callback: (timeoutError: Error | null, result?: TResult) => void) => void
    }
    acknowledgedSocket.emit(event, payload, (timeoutError, result) => {
      if (timeoutError && attempt < 2) {
        window.setTimeout(() => emitWithRetry(event, payload, onResult, attempt + 1), 500 * (attempt + 1))
        return
      }
      onResult((timeoutError ? { ok: false, message: 'Connection timed out. Please try again.' } : result) as TResult)
    })
  }

  const handleSendMessage = () => {
    const trimmed = chatInput.trim()
    if (!trimmed || !socketRef.current || !roomId) return
    const clientId = createClientId()
    emitWithRetry<ChatSaveResult>('chat:message', { roomId, content: trimmed, clientId }, (result) => {
      if (!result.ok) setError(result.message)
    })
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
    setPreviewStrokes((previous) => previous.filter((item) => item.clientId !== clonedStroke.clientId))
    emitWithRetry<StrokeSaveResult>('whiteboard:stroke', { roomId, stroke: clonedStroke }, (result) => {
      if (!result.ok) {
        setStrokes((previous) => previous.filter((item) => item.clientId !== clonedStroke.clientId))
        setError(result.message)
      }
    })
  }

  const handleStrokePreview = (stroke: NewStroke) => {
    if (!roomId || !socketRef.current) return
    socketRef.current.emit('whiteboard:preview', { roomId, stroke })
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

  // Close the people popover on outside click, and the popover/share modal on Escape.
  useEffect(() => {
    if (!peopleOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (peopleRef.current && !peopleRef.current.contains(event.target as Node)) setPeopleOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [peopleOpen])

  useEffect(() => {
    if (!peopleOpen && !shareOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || confirmation) return
      setPeopleOpen(false)
      setShareOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [peopleOpen, shareOpen, confirmation])

  const leaveRoom = () => {
    if (socketRef.current && roomId) {
      socketRef.current.emit('session:leave', { roomId })
      socketRef.current.disconnect()
      socketRef.current = null
    }
    window.location.assign('/')
  }

  const confirmRoleChange = (member: RoomMember, role: Exclude<RoomRole, 'owner'>) => {
    const isPromotion = role === 'editor'
    setConfirmation({
      title: isPromotion ? 'Make this member an editor?' : 'Make this member a viewer?',
      description: isPromotion
        ? `${member.user.displayName} (${member.user.email}) will be able to draw and edit this board.`
        : `${member.user.displayName} (${member.user.email}) will no longer be able to edit the board.`,
      confirmLabel: isPromotion ? 'Make editor' : 'Make viewer',
      action: () => handleRoleChange(member, role),
    })
  }

  const toggleChat = () => setChatOpen((open) => !open)

  const visibleMembers = members.slice(0, 4)
  const hiddenMemberCount = Math.max(0, members.length - visibleMembers.length)
  const inviteRevoked = Boolean(roomInfo?.inviteRevokedAt)
  const inviteHasExpiry = Boolean(roomInfo?.inviteExpiresAt)

  const ghostButton =
    'flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-[color:var(--text)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]'

  return (
    <div style={theme} className="flex h-screen flex-col overflow-hidden bg-[var(--bg)] text-[color:var(--text)]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[color:var(--border)] bg-[var(--surface)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[15px] font-semibold">
            Team room <span className="font-mono font-normal text-[color:var(--muted)]">{roomLabel}</span>
          </h1>
          <span className="flex items-center gap-1.5 text-xs text-[color:var(--muted)]" role="status">
            <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-[var(--accent)]' : status === 'error' ? 'bg-[var(--danger)]' : 'animate-pulse bg-amber-400'}`} />
            {status === 'connected' ? 'Live' : status === 'error' ? 'Disconnected' : 'Connecting'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="relative" ref={peopleRef}>
            <button
              type="button"
              onClick={() => setPeopleOpen((open) => !open)}
              aria-expanded={peopleOpen}
              aria-label={`People in this room (${members.length})`}
              className="flex h-9 items-center rounded-lg px-2 transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
            >
              <span className="flex -space-x-2">
                {visibleMembers.map((member) => (
                  <span key={member.userId} className="rounded-full ring-2 ring-[color:var(--surface)]">
                    <Avatar name={member.user.displayName} online={onlineIds.has(member.userId)} />
                  </span>
                ))}
              </span>
              {hiddenMemberCount > 0 && <span className="ml-2 text-xs text-[color:var(--muted)]">+{hiddenMemberCount}</span>}
            </button>

            {peopleOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-[color:var(--border)] bg-[var(--surface)] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
                <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
                  <h2 className="text-sm font-semibold">People</h2>
                  <span className="text-xs text-[color:var(--muted)]">{onlineIds.size} online</span>
                </div>
                <ul className="max-h-80 overflow-y-auto p-2">
                  {members.map((member) => (
                    <li key={member.userId} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <Avatar name={member.user.displayName} online={onlineIds.has(member.userId)} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {member.user.displayName}
                          {member.userId === currentUserId && <span className="ml-1.5 font-normal text-[color:var(--muted)]">(you)</span>}
                        </p>
                        <p className="truncate text-xs text-[color:var(--muted)]">{member.user.email}</p>
                      </div>
                      {isOwner && member.role !== 'owner' ? (
                        <select
                          value={member.role}
                          aria-label={`Role for ${member.user.displayName}`}
                          onChange={(event) => confirmRoleChange(member, event.target.value as Exclude<RoomRole, 'owner'>)}
                          className="h-8 rounded-md border border-[color:var(--border)] bg-[var(--surface-2)] px-2 text-xs text-[color:var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                      ) : (
                        <span className="text-xs text-[color:var(--muted)]">{roleLabel(member.role)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-[var(--accent)] px-3.5 text-sm font-semibold text-[color:var(--accent-ink)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <UserPlus size={16} strokeWidth={2} />
            Share
          </button>

          <button type="button" onClick={toggleChat} aria-pressed={chatOpen} aria-label="Chat" className={`${ghostButton} relative ${chatOpen ? 'bg-[var(--surface-2)]' : ''}`}>
            <MessageSquare size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">Chat</span>
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-semibold text-[color:var(--accent-ink)]">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setConfirmation({ title: 'Leave this room?', description: 'You will return to your shared workspace. Your board work and messages are already saved.', confirmLabel: 'Leave room', action: leaveRoom })}
            className={ghostButton}
          >
            <LogOut size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <WhiteboardCanvas
            strokes={boardStrokes}
            onStrokeComplete={handleStrokeComplete}
            onStrokePreview={handleStrokePreview}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canDraw && undoState.canUndo}
            canRedo={canDraw && undoState.canRedo}
            disabled={status !== 'connected'}
            canDraw={canDraw}
          />

          {bannerError && (
            <div role="alert" className="absolute left-1/2 top-4 z-20 flex max-w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-lg border border-red-400/30 bg-[#2a1517] py-2.5 pl-4 pr-2 text-sm text-red-200 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <p className="flex-1 pt-0.5">{bannerError}</p>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => {
                  setError(null)
                  setRoomInfoError(null)
                }}
                className="rounded-md p-1 text-red-200/80 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>

        {chatOpen && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-[color:var(--border)] bg-[var(--surface)] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:w-full max-md:max-w-sm">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--border)] pl-4 pr-2">
              <h2 className="text-sm font-semibold">Chat</h2>
              <button type="button" aria-label="Close chat" onClick={toggleChat} className="rounded-md p-2 text-[color:var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[color:var(--text)]">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4">
              {chatMessages.length === 0 ? (
                <p className="mt-8 text-center text-sm text-[color:var(--muted)]">No messages yet. Anything you send here shows up for everyone in the room.</p>
              ) : (
                <ul className="space-y-4">
                  {chatMessages.map((message) => (
                    <li key={message.id} className="flex gap-3">
                      <Avatar name={message.displayName} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{message.displayName}</span>
                          <span className="text-xs text-[color:var(--muted)]">{new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="shrink-0 border-t border-[color:var(--border)] p-3">
              <div className="flex gap-2">
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
                  placeholder="Message the room"
                  aria-label="Message"
                  className="h-9 min-w-0 flex-1 rounded-lg border border-[color:var(--border)] bg-[var(--bg)] px-3 text-sm text-[color:var(--text)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim()}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[color:var(--accent-ink)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SendHorizontal size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          </aside>
        )}
      </main>

      {shareOpen && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShareOpen(false)
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="w-full max-w-md rounded-xl border border-[color:var(--border)] bg-[var(--surface)] shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
            <div className="flex items-start justify-between gap-4 px-5 pt-5">
              <div>
                <h2 id="share-title" className="text-base font-semibold">Share this room</h2>
                <p className="mt-1 text-sm text-[color:var(--muted)]">People with this code can join the room.</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setShareOpen(false)} className="-mr-1 rounded-md p-1.5 text-[color:var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[color:var(--text)]">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pt-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[var(--bg)] py-2.5 pl-4 pr-2.5">
                <span className={`font-mono text-xl tracking-wider ${inviteRevoked ? 'text-[color:var(--muted)] line-through' : ''}`}>{roomInfo ? roomInfo.inviteCode : '--------'}</span>
                <button
                  type="button"
                  onClick={handleCopyInviteCode}
                  disabled={!roomInfo || inviteRevoked}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[color:var(--accent-ink)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copiedCode ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2} />}
                  {copiedCode ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <p className={`mt-2 text-xs ${inviteRevoked ? 'text-[color:var(--danger)]' : 'text-[color:var(--muted)]'}`}>
                {inviteRevoked
                  ? 'This code is revoked and can no longer be used to join.'
                  : roomInfo?.inviteExpiresAt
                    ? `Expires ${new Date(roomInfo.inviteExpiresAt).toLocaleString()}`
                    : 'This code does not expire.'}
              </p>
            </div>

            {isOwner ? (
              <div className="mt-5 space-y-4 border-t border-[color:var(--border)] px-5 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Code expiry</p>
                    <p className="text-xs text-[color:var(--muted)]">Applies to new members only.</p>
                  </div>
                  <div className="flex rounded-lg border border-[color:var(--border)] bg-[var(--bg)] p-0.5" role="group" aria-label="Code expiry">
                    <button
                      type="button"
                      aria-pressed={inviteHasExpiry}
                      onClick={() => setConfirmation({ title: 'Set a 24-hour invite expiry?', description: 'New members can use this code for the next 24 hours only.', confirmLabel: 'Set expiry', action: () => handleInviteExpiry(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()) })}
                      className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${inviteHasExpiry ? 'bg-[var(--surface-2)] text-[color:var(--text)]' : 'text-[color:var(--muted)] hover:text-[color:var(--text)]'}`}
                    >
                      24 hours
                    </button>
                    <button
                      type="button"
                      aria-pressed={!inviteHasExpiry}
                      onClick={() => setConfirmation({ title: 'Remove invite expiry?', description: 'The current invite code will remain active until you revoke or rotate it.', confirmLabel: 'Remove expiry', action: () => handleInviteExpiry(null) })}
                      className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${!inviteHasExpiry ? 'bg-[var(--surface-2)] text-[color:var(--text)]' : 'text-[color:var(--muted)] hover:text-[color:var(--text)]'}`}
                    >
                      No expiry
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Replace the code</p>
                    <p className="text-xs text-[color:var(--muted)]">The old code stops working. Members keep access.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmation({ title: 'Rotate the invite code?', description: 'The current code will immediately stop admitting new members. Existing members keep access.', confirmLabel: 'Rotate code', action: handleRotateInvite })}
                    className="h-8 shrink-0 rounded-md border border-[color:var(--border)] px-3 text-sm font-medium transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                  >
                    Rotate code
                  </button>
                </div>

                <div className="flex items-center justify-between gap-4 border-t border-[color:var(--border)] pt-4">
                  <div>
                    <p className="text-sm font-medium">Revoke invite</p>
                    <p className="text-xs text-[color:var(--muted)]">No one new can join with this code.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmation({ title: 'Revoke this invite code?', description: 'No new user can join with this code. Existing members will keep access.', confirmLabel: 'Revoke invite', tone: 'danger', action: handleRevokeInvite })}
                    className="h-8 shrink-0 rounded-md border border-red-400/40 px-3 text-sm font-medium text-[color:var(--danger)] transition-colors hover:bg-red-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                  >
                    Revoke invite
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-5" />
            )}
          </div>
        </div>
      )}

      {confirmation && <ConfirmationDialog open title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} tone={confirmation.tone} onConfirm={confirmation.action} onClose={() => setConfirmation(null)} />}
    </div>
  )
}
