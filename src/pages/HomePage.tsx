import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSessionRoom, fetchSessionRooms, joinSessionRoom, logoutRequest } from '../lib/api'
import type { SessionRoom } from '../types'
import { useAuthStore, type AuthState } from '../store/authStore'
import ConfirmationDialog from '../components/ConfirmationDialog'

type PendingConfirmation = { title: string; description: string; confirmLabel: string; action: () => Promise<void> }

export default function HomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((state: AuthState) => state.user)
  const logout = useAuthStore((state: AuthState) => state.logout)
  const [rooms, setRooms] = useState<SessionRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)

  const formatInviteCode = (inviteCode: string) => inviteCode.match(/.{1,4}/g)?.join('-') ?? inviteCode

  const handleLogout = async () => {
    try {
      await logoutRequest()
    } finally {
      logout()
    }
  }

  useEffect(() => {
    let isMounted = true

    async function loadRooms() {
      try {
        const response = await fetchSessionRooms()
        if (isMounted) {
          setRooms(response.rooms)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Unable to load rooms')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    loadRooms()

    return () => {
      isMounted = false
    }
  }, [])

  const createRoom = async () => {

    setCreating(true)
    setError(null)

    try {
      const newRoom = await createSessionRoom({ title: title.trim() })
      setRooms((prev) => [newRoom, ...prev])
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create room')
    } finally {
      setCreating(false)
    }
  }

  const joinRoom = async (inviteCode = joinCode.trim().toUpperCase()) => {
    const trimmed = inviteCode

    setJoining(true)
    setError(null)

    try {
      const { room } = await joinSessionRoom({ inviteCode: trimmed })
      setJoinCode('')
      navigate(`/rooms/${room.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to join room')
    } finally {
      setJoining(false)
    }
  }

  const handleCreateRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const roomTitle = title.trim()
    if (!roomTitle) return
    setConfirmation({ title: 'Create this room?', description: `A new shared workspace named “${roomTitle}” will be created. You will be its owner.`, confirmLabel: 'Create room', action: createRoom })
  }

  const handleJoinRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const inviteCode = joinCode.trim().toUpperCase()
    if (!inviteCode) return
    setConfirmation({ title: 'Join this room?', description: `You will join the room using invite code ${inviteCode}.`, confirmLabel: 'Join room', action: () => joinRoom(inviteCode) })
  }

  return (
    <div className="min-h-screen bg-transparent text-slate-50">
      <header className="border-b border-slate-800/90 bg-[#070c14]/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-cyan-300">Whiteboard Lab</p>
            <h1 className="text-xl font-semibold text-white">Your shared workspace</h1>
          </div>
          <div className="text-right text-sm text-slate-400">
            <p className="font-medium text-slate-100">{user?.displayName}</p>
            <p>{user?.email}</p>
            <button
              onClick={handleLogout}
              className="mt-2 cursor-pointer text-xs font-semibold uppercase tracking-wide text-emerald-300 hover:text-emerald-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-14">
        <section>
          <div className="grid items-stretch gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-700/70 bg-[#0c1520]/95 p-7 shadow-xl shadow-black/30 backdrop-blur-sm">
              <div className="min-h-[4.5rem]">
                <h2 className="text-lg font-semibold text-white">Create a session room</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Spin up a private whiteboard room and share the invite code.
                </p>
              </div>
              <form className="mt-5 flex flex-col gap-4" onSubmit={handleCreateRoom}>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Sprint planning with Design"
                  className="w-full rounded-xl border border-slate-700 bg-[#070e17] px-4 py-3 text-base text-white shadow-inner shadow-black/25 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-400/25"
                  required
                  minLength={3}
                />
                <button
                  type="submit"
                  disabled={creating}
                  className="cursor-pointer rounded-xl bg-teal-400 px-6 py-3 text-sm font-bold uppercase tracking-wide text-slate-950 shadow-[0_0_26px_rgba(45,212,191,0.35)] transition hover:bg-teal-300 hover:shadow-[0_0_32px_rgba(45,212,191,0.5)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? 'Creating…' : 'Create room'}
                </button>
              </form>
            </div>
            <div className="rounded-2xl border border-slate-700/70 bg-[#0c1520]/95 p-7 shadow-xl shadow-black/30 backdrop-blur-sm">
              <div className="min-h-[4.5rem]">
                <h2 className="text-lg font-semibold text-white">Join by invite code</h2>
                <p className="mt-1 text-sm text-slate-400">Enter the 8-character code you received to hop into an existing room.</p>
              </div>
              <form className="mt-5 flex flex-col gap-4" onSubmit={handleJoinRoom}>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="e.g. 1A2B3C4D"
                  className="w-full rounded-xl border border-slate-700 bg-[#070e17] px-4 py-3 font-mono text-base tracking-[0.22em] text-white shadow-inner shadow-black/25 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-400/25"
                  required
                  minLength={6}
                />
                <button
                  type="submit"
                  disabled={joining}
                  className="cursor-pointer rounded-xl border border-slate-700 bg-[#0a121d] px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-300 transition hover:border-teal-400/60 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {joining ? 'Joining…' : 'Join room'}
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-[#0c1520]/95 p-7 shadow-xl shadow-black/30 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Your session rooms</h2>
              <p className="text-sm text-slate-400">Invite-only workspaces you have created.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-400/10 px-3 py-1 text-xs uppercase tracking-widest text-teal-200">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(94,234,212,0.95)]" />
              {rooms.length} active
            </span>
          </div>

          {loading ? (
            <p className="mt-6 text-slate-400">Loading rooms…</p>
          ) : rooms.length === 0 ? (
            <p className="mt-6 text-slate-400">No rooms yet. Create your first session above.</p>
          ) : (
            <ul className="mt-6 space-y-4">
              {rooms.map((room) => (
                <li key={room.id} className="rounded-xl border border-slate-800 bg-[#121d2a] p-4 transition hover:border-teal-500/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-teal-400/35 bg-teal-400/10 font-mono text-sm text-teal-200">◇</span>
                      <div>
                        <p className="text-base font-semibold text-white">{room.title}</p>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{new Date(room.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-[0.65rem] uppercase tracking-[0.18em] text-slate-500">Invite code</p>
                        <p className="font-mono text-sm font-semibold tracking-[0.08em] text-teal-200">{formatInviteCode(room.inviteCode)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfirmation({ title: 'Enter this room?', description: `Open “${room.title}” and join its live collaboration session.`, confirmLabel: 'Enter room', action: async () => { navigate(`/rooms/${room.id}`) } })}
                        className="cursor-pointer rounded-xl border border-cyan-500/60 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 hover:text-white"
                      >
                        Enter room
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-4 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-200">{error}</p>}
        </section>
      </main>
      {confirmation && <ConfirmationDialog open title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} onConfirm={confirmation.action} onClose={() => setConfirmation(null)} />}
    </div>
  )
}
