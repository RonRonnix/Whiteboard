import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { loginRequest, registerRequest } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import type { AuthState } from '../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((state: AuthState) => state.login)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    inviteCode: '',
  })
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState<string | null>(null)

  const redirectTo = (location.state as { from?: Location })?.from?.pathname ?? '/'

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'))
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('loading')
    setError(null)

    try {
      const payload =
        mode === 'login'
          ? await loginRequest({ email: form.email, password: form.password })
          : await registerRequest(form)

      login(payload)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-50">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-2xl shadow-slate-950/40">
        <div className="space-y-2 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300">Whiteboard Lab</p>
          <h1 className="text-3xl font-semibold text-white">
            {mode === 'login' ? 'Welcome back' : 'Create an account'}
          </h1>
          <p className="text-sm text-slate-400">
            Sign in with your invite-only credentials to access collaborative sessions.
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-200">Display name</span>
              <input
                type="text"
                name="displayName"
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="e.g. Jordan Woods"
                required
                minLength={2}
              />
            </label>
          )}

          {mode === 'register' && (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-200">Invite code</span>
              <input
                type="text"
                name="inviteCode"
                value={form.inviteCode}
                onChange={(event) =>
                  setForm({ ...form, inviteCode: event.target.value.toUpperCase().trim() })
                }
                className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                placeholder="e.g. A1B2C3D4"
                required
                minLength={8}
              />
            </label>
          )}

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-200">Email</span>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-200">Password</span>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
              placeholder="••••••••"
              required
              minLength={mode === 'login' ? 1 : 8}
            />
          </label>

          {error && <p className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="flex w-full items-center justify-center rounded-xl bg-indigo-500/90 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'loading' ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register & sign in'}
          </button>
        </form>

        <div className="text-sm text-slate-400">
          {mode === 'login' ? (
            <p>
              Need access?{' '}
              <button type="button" onClick={toggleMode} className="font-semibold text-indigo-300 hover:text-indigo-200">
                Request an account
              </button>
            </p>
          ) : (
            <p>
              Already have access?{' '}
              <button type="button" onClick={toggleMode} className="font-semibold text-indigo-300 hover:text-indigo-200">
                Return to sign in
              </button>
            </p>
          )}
          <p className="pt-4 text-xs text-slate-500">
            <Link to="/" className="hover:text-slate-300">
              Back to dashboard
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
