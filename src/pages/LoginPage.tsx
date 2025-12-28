import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { loginRequest, registerRequest, resendVerificationRequest, verifyEmailRequest } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import type { AuthState } from '../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((state: AuthState) => state.login)
  const [view, setView] = useState<'login' | 'register' | 'verify'>('login')
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
  })
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)

  const redirectTo = (location.state as { from?: Location })?.from?.pathname ?? '/'

  const switchToLogin = () => {
    setView('login')
    setError(null)
    setInfoMessage(null)
    setVerificationCode('')
    setPendingEmail('')
  }

  const switchToRegister = () => {
    setView('register')
    setError(null)
    setInfoMessage(null)
    setVerificationCode('')
    setPendingEmail('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('loading')
    setError(null)
    if (view !== 'register') {
      setInfoMessage(null)
    }

    try {
      if (view === 'login') {
        const payload = await loginRequest({ email: form.email, password: form.password })
        login(payload)
        navigate(redirectTo, { replace: true })
      } else if (view === 'register') {
        const response = await registerRequest({
          email: form.email,
          password: form.password,
          displayName: form.displayName,
        })

        setPendingEmail(response.email)
        setVerificationCode('')
        setInfoMessage(response.message)
        setView('verify')
      } else {
        const emailForVerification = pendingEmail || form.email
        if (!emailForVerification) {
          throw new Error('Missing email for verification')
        }

        const payload = await verifyEmailRequest({ email: emailForVerification, code: verificationCode })
        login(payload)
        navigate(redirectTo, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in')
    } finally {
      setStatus('idle')
    }
  }

  const handleResend = async () => {
    if (!pendingEmail || resendStatus === 'loading') return
    setResendStatus('loading')
    setError(null)

    try {
      const response = await resendVerificationRequest({ email: pendingEmail })
      setInfoMessage(response.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend code')
    } finally {
      setResendStatus('idle')
    }
  }

  const heading =
    view === 'login' ? 'Welcome back' : view === 'register' ? 'Create an account' : 'Verify your email'

  const description =
    view === 'verify'
      ? 'We sent a 6-digit code to the email below. Enter it to finish setup.'
      : 'Sign in or create a free account to start collaborating in shared rooms.'

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12 text-slate-50">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-slate-800/60 bg-slate-900/70 p-8 shadow-2xl shadow-slate-950/40">
        <div className="space-y-2 text-center">
          <p className="text-sm uppercase tracking-[0.3em] text-indigo-300">Whiteboard Lab</p>
          <h1 className="text-3xl font-semibold text-white">{heading}</h1>
          <p className="text-sm text-slate-400">{description}</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {view === 'register' && (
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

          {view !== 'verify' && (
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
          )}

          {view !== 'verify' && (
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
                minLength={view === 'login' ? 1 : 8}
              />
            </label>
          )}

          {view === 'verify' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800/60 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                <p className="font-semibold text-white">{pendingEmail}</p>
                <p className="text-xs text-slate-400">Code valid for 30 minutes.</p>
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-slate-200">Verification code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  name="verificationCode"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-center text-lg font-mono tracking-[0.5em] text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/40"
                  placeholder="123456"
                  required
                />
              </label>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendStatus === 'loading'}
                className="text-sm font-semibold text-indigo-300 hover:text-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resendStatus === 'loading' ? 'Sending…' : 'Resend code'}
              </button>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</p>}
          {infoMessage && !error && (
            <p className="rounded-lg bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200">{infoMessage}</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="flex w-full items-center justify-center rounded-xl bg-indigo-500/90 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'loading'
              ? 'Please wait…'
              : view === 'login'
                ? 'Sign in'
                : view === 'register'
                  ? 'Create account'
                  : 'Verify & continue'}
          </button>
        </form>

        <div className="text-sm text-slate-400">
          {view === 'login' ? (
            <p>
              Need an account?{' '}
              <button type="button" onClick={switchToRegister} className="font-semibold text-indigo-300 hover:text-indigo-200">
                Create one now
              </button>
            </p>
          ) : view === 'register' ? (
            <p>
              Already a member?{' '}
              <button type="button" onClick={switchToLogin} className="font-semibold text-indigo-300 hover:text-indigo-200">
                Return to sign in
              </button>
            </p>
          ) : (
            <div className="space-y-2">
              <p>
                Need to update your email?{' '}
                <button type="button" onClick={switchToRegister} className="font-semibold text-indigo-300 hover:text-indigo-200">
                  Start over
                </button>
              </p>
              <p>
                Already verified?{' '}
                <button type="button" onClick={switchToLogin} className="font-semibold text-indigo-300 hover:text-indigo-200">
                  Return to sign in
                </button>
              </p>
            </div>
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
