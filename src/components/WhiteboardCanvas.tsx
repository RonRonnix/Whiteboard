import { useEffect, useRef, useState } from 'react'
import type { NewStroke, Point, WhiteboardStroke } from '../types/realtime'

const COLORS = ['#f97316', '#ef4444', '#fde047', '#34d399', '#22d3ee', '#a855f7', '#cbd5f5']

function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: { points: Point[]; color: string; size: number }) {
  if (stroke.points.length < 2) return
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.size
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
  for (let i = 1; i < stroke.points.length; i += 1) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
  }
  ctx.stroke()
}

type WhiteboardCanvasProps = {
  strokes: WhiteboardStroke[]
  onStrokeComplete: (stroke: NewStroke) => void
  onClearBoard: () => void
  disabled?: boolean
  className?: string
}

export default function WhiteboardCanvas({ strokes, onStrokeComplete, onClearBoard, disabled = false, className }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [brushSize, setBrushSize] = useState(4)
  const drawingRef = useRef(false)
  const liveStrokeRef = useRef<NewStroke | null>(null)
  const devicePixelRatioRef = useRef(1)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    const resize = () => {
      if (!canvas || !ctxRef.current) return
      const parent = canvas.parentElement
      if (!parent) return
      const rect = parent.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      devicePixelRatioRef.current = dpr
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0)
      redraw()
    }

    resize()

    const parentElement = canvas.parentElement
    if (!parentElement) return
    const observer = new ResizeObserver(() => resize())
    observer.observe(parentElement)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    redraw()
  }, [strokes])

  const redraw = () => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const dpr = devicePixelRatioRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    strokes.forEach((stroke) => drawStroke(ctx, stroke))
    if (liveStrokeRef.current) {
      drawStroke(ctx, liveStrokeRef.current)
    }
  }

  const getPointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.preventDefault()
    const point = getPointFromEvent(event)
    if (!point) return
    drawingRef.current = true
    const clientId = createClientId()
    liveStrokeRef.current = {
      clientId,
      points: [point],
      color,
      size: brushSize,
      tool: 'pen',
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !liveStrokeRef.current) return
    event.preventDefault()
    const point = getPointFromEvent(event)
    if (!point) return
    liveStrokeRef.current.points.push(point)
    redraw()
  }

  const commitStroke = () => {
    if (!liveStrokeRef.current) return
    onStrokeComplete(liveStrokeRef.current)
    liveStrokeRef.current = null
    drawingRef.current = false
    redraw()
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()
    commitStroke()
  }

  const handlePointerLeave = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()
    commitStroke()
  }

  const handleClear = () => {
    liveStrokeRef.current = null
    drawingRef.current = false
    onClearBoard()
  }

  return (
    <div className={`relative flex h-[500px] flex-col rounded-2xl border border-slate-900/60 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-inner shadow-black/40 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/70 px-4 py-3">
        <div className="flex items-center gap-2">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              className={`h-6 w-6 rounded-full border ${color === swatch ? 'border-white' : 'border-white/30'}`}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
          <span>Brush</span>
          <input
            type="range"
            min={2}
            max={16}
            step={1}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="w-32 accent-indigo-400"
          />
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <button
            type="button"
            onClick={handleClear}
            className="rounded-xl border border-rose-500/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-400"
          >
            Clear board
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        className={`h-full w-full rounded-b-2xl ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />
    </div>
  )
}
