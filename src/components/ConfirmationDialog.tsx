import { useEffect, useState } from 'react'

type ConfirmationDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export default function ConfirmationDialog({ open, title, description, confirmLabel, tone = 'primary', onConfirm, onClose }: ConfirmationDialogProps) {
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, submitting, onClose])

  useEffect(() => {
    if (!open) setSubmitting(false)
  }, [open])

  if (!open) return null

  const confirm = async () => {
    setSubmitting(true)
    try {
      await onConfirm()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const confirmClass = tone === 'danger'
    ? 'bg-rose-500 text-white hover:bg-rose-400'
    : 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 hover:from-cyan-300 hover:to-emerald-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={() => { if (!submitting) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="confirmation-title" className="w-full max-w-md rounded-2xl border border-cyan-800/70 bg-slate-950 p-6 shadow-2xl shadow-cyan-950/50" onMouseDown={(event) => event.stopPropagation()}>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Confirm action</p>
        <h2 id="confirmation-title" className="mt-2 text-xl font-semibold text-white">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={submitting} className="cursor-pointer rounded-xl border border-cyan-900 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => { void confirm() }} disabled={submitting} className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}>
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
