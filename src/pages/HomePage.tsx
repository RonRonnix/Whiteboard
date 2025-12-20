import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createSessionRoom, fetchSessionRooms } from '../lib/api'
import type { SessionRoom } from '../types'
import { useAuthStore, type AuthState } from '../store/authStore'

export default function HomePage() {
  const user = useAuthStore((state: AuthState) => state.user)
  const logout = useAuthStore((state: AuthState) => state.logout)
  const [rooms, setRooms] = useState<SessionRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)

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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <header className="border-b border-slate-900/70 bg-slate-950/70 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-indigo-400">Whiteboard Lab</p>
            <h1 className="text-xl font-semibold text-white">Realtime Collaboration Hub</h1>
          </div>
          <div className="text-right text-sm text-slate-400">
            <p className="font-medium text-slate-100">{user?.displayName}</p>
            <p>{user?.email}</p>
            <button
              onClick={logout}
              className="mt-2 text-xs font-semibold uppercase tracking-wide text-indigo-300 hover:text-indigo-200"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <section className="rounded-2xl border border-slate-900/60 bg-slate-900/60 p-6 shadow-lg shadow-black/40">
          <h2 className="text-lg font-semibold text-white">Create a session room</h2>
          <p className="mt-1 text-sm text-slate-400">
            Spin up a private whiteboard room and invite teammates with the generated session code.
          </p>
          <form className="mt-5 flex flex-col gap-4 md:flex-row" onSubmit={handleCreateRoom}>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Sprint planning with Design"
              className="flex-1 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-base text-white outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
              required
              minLength={3}
            />
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-indigo-500/90 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create room'}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-900/60 bg-slate-900/40 p-6 shadow-inner shadow-black/30">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Your session rooms</h2>
              <p className="text-sm text-slate-400">Invite-only workspaces you have created.</p>
            </div>
            <span className="rounded-full border border-slate-800 px-3 py-1 text-xs uppercase tracking-widest text-slate-400">
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
                <li key={room.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-white">{room.title}</p>
                      <p className="text-xs uppercase tracking-[0.4em] text-slate-500">{new Date(room.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xs text-slate-400">Invite code</p>
                        <p className="text-lg font-mono font-semibold text-indigo-300">{room.inviteCode}</p>
                      </div>
                      <Link
                        to={`/rooms/${room.id}`}
                        className="rounded-xl border border-indigo-500/60 px-4 py-2 text-sm font-semibold text-indigo-200 transition hover:border-indigo-400 hover:text-white"
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
