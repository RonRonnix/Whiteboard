import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewStroke, Point, WhiteboardStroke, WhiteboardTool } from '../types/realtime'

const COLORS = ['#f97316', '#ef4444', '#fde047', '#34d399', '#22d3ee', '#a855f7', '#cbd5f5']

function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: { points: Point[]; color: string; size: number; tool?: WhiteboardTool }) {
  if (stroke.points.length < 2) return
  ctx.save()
  const tool = stroke.tool ?? 'pen'
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.size
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const start = stroke.points[0]
  const end = stroke.points[stroke.points.length - 1]
  if (tool === 'rectangle') {
    ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
  } else if (tool === 'ellipse') {
    const radiusX = Math.abs(end.x - start.x) / 2
    const radiusY = Math.abs(end.y - start.y) / 2
    ctx.beginPath()
    ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, radiusX, radiusY, 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    if (tool === 'line') {
      ctx.lineTo(end.x, end.y)
    } else {
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
    }
    ctx.stroke()
  }
  ctx.restore()
}

type WhiteboardCanvasProps = {
  strokes: WhiteboardStroke[]
  onStrokeComplete: (stroke: NewStroke) => void
  disabled?: boolean
  className?: string
}

export default function WhiteboardCanvas({ strokes, onStrokeComplete, disabled = false, className }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [brushSize, setBrushSize] = useState(4)
  const [tool, setTool] = useState<WhiteboardTool>('pen')
  const drawingRef = useRef(false)
  const liveStrokeRef = useRef<NewStroke | null>(null)
  const devicePixelRatioRef = useRef(1)

  const redraw = useCallback(() => {
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
  }, [strokes])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    const resize = () => {
      if (!canvas || !ctxRef.current) return
      const host = canvasHostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      devicePixelRatioRef.current = dpr
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0)
      redraw()
    }

    resize()

    const host = canvasHostRef.current
    if (!host) return
    const observer = new ResizeObserver(() => resize())
    observer.observe(host)

    return () => {
      observer.disconnect()
    }
  }, [redraw])

  useEffect(() => {
    redraw()
  }, [redraw])

  const getPointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.preventDefault()
    const point = getPointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    const clientId = createClientId()
    liveStrokeRef.current = {
      clientId,
      points: [point],
      color,
      size: brushSize,
      tool,
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitStroke()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()
    commitStroke()
  }

  return (
    <div className={`relative flex h-[500px] min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-900/60 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-inner shadow-black/40 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTool('pen')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'pen' ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            Pen
          </button>
          <button type="button" onClick={() => setTool('eraser')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'eraser' ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            Eraser
          </button>
          <button type="button" onClick={() => setTool('line')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'line' ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            Line
          </button>
          <button type="button" onClick={() => setTool('rectangle')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'rectangle' ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            Rectangle
          </button>
          <button type="button" onClick={() => setTool('ellipse')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'ellipse' ? 'border-indigo-400 bg-indigo-500/20 text-white' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}>
            Ellipse
          </button>
        </div>
        {tool !== 'eraser' && <div className="flex items-center gap-2">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              onClick={() => setColor(swatch)}
              className={`h-6 w-6 rounded-full border ${color === swatch ? 'border-white' : 'border-white/30'}`}
              style={{ backgroundColor: swatch }}
            />
          ))}
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Custom stroke color" className="h-7 w-7 cursor-pointer rounded-full border border-white/30 bg-transparent p-0" />
        </div>}
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
          <span>{tool === 'eraser' ? 'Eraser' : 'Brush'}</span>
          <input
            type="range"
            min={2}
            max={48}
            step={1}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
            className="w-32 accent-indigo-400"
          />
          <span className="w-5 text-right tabular-nums">{brushSize}</span>
        </div>
      </div>
      <div ref={canvasHostRef} className="min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className={`block h-full w-full touch-none ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      </div>
    </div>
  )
}
