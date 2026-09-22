import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createSessionRoom, fetchSessionRooms, joinSessionRoom, logoutRequest } from '../lib/api'
import type { SessionRoom } from '../types'
import { useAuthStore, type AuthState } from '../store/authStore'

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

  const handleCreateRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim()) return

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

  const handleJoinRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = joinCode.trim().toUpperCase()
    if (!trimmed) return

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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#083344_0%,_#06111d_42%,_#020617_100%)] text-slate-50">
      <header className="border-b border-cyan-950/80 bg-slate-950/65 px-6 py-4 backdrop-blur">
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

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="rounded-2xl border border-cyan-950/80 bg-slate-950/50 p-6 shadow-lg shadow-cyan-950/30 backdrop-blur-sm">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold text-white">Create a session room</h2>
              <p className="mt-1 text-sm text-slate-400">
                Spin up a private whiteboard room and share the invite code.
              </p>
              <form className="mt-5 flex flex-col gap-4" onSubmit={handleCreateRoom}>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Sprint planning with Design"
                  className="w-full rounded-xl border border-cyan-900 bg-slate-950/70 px-4 py-3 text-base text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                  required
                  minLength={3}
                />
                <button
                  type="submit"
                  disabled={creating}
                  className="cursor-pointer rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:from-cyan-400 hover:to-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? 'Creating…' : 'Create room'}
                </button>
              </form>
            </div>
            <div className="rounded-2xl border border-dashed border-emerald-800/70 bg-emerald-950/15 p-5">
              <h2 className="text-lg font-semibold text-white">Join by invite code</h2>
              <p className="mt-1 text-sm text-slate-400">Enter the 8-character code you received to hop into an existing room.</p>
              <form className="mt-5 flex flex-col gap-4" onSubmit={handleJoinRoom}>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="e.g. 1A2B3C4D"
                  className="w-full rounded-xl border border-cyan-900 bg-slate-950/70 px-4 py-3 text-base tracking-[0.3em] text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/25"
                  required
                  minLength={6}
                />
                <button
                  type="submit"
                  disabled={joining}
                  className="cursor-pointer rounded-xl border border-emerald-500/70 bg-emerald-400/10 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {joining ? 'Joining…' : 'Join room'}
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-cyan-950/80 bg-slate-950/40 p-6 shadow-inner shadow-cyan-950/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Your session rooms</h2>
              <p className="text-sm text-slate-400">Invite-only workspaces you have created.</p>
            </div>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-widest text-emerald-200">
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
                <li key={room.id} className="rounded-xl border border-cyan-950/80 bg-slate-950/65 p-4 transition hover:border-cyan-700">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-white">{room.title}</p>
                      <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{new Date(room.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Invite code</p>
                        <p className="text-lg font-mono font-semibold text-cyan-200">{room.inviteCode}</p>
                      </div>
                      <Link
                        to={`/rooms/${room.id}`}
                        className="rounded-xl border border-cyan-500/60 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 hover:text-white"
                      >
                        Enter room
                      </Link>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-4 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-200">{error}</p>}
        </section>
      </main>
    </div>
  )
}
