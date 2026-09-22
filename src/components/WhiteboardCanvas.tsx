import { useCallback, useEffect, useRef, useState } from 'react'
import type { NewStroke, Point, WhiteboardStroke, WhiteboardTool } from '../types/realtime'

const COLORS = ['#f97316', '#ef4444', '#fde047', '#34d399', '#22d3ee', '#a855f7', '#cbd5f5']
const BOARD_WIDTH = 2400
const BOARD_HEIGHT = 1600
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2

function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: { points: Point[]; color: string; size: number; tool?: WhiteboardTool }) {
  if (stroke.points.length === 0) return
  ctx.save()
  const tool = stroke.tool ?? 'pen'
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.size
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const start = stroke.points[0]
  const end = stroke.points[stroke.points.length - 1]
  if (stroke.points.length === 1) {
    ctx.beginPath()
    ctx.arc(start.x, start.y, stroke.size / 2, 0, Math.PI * 2)
    ctx.fillStyle = stroke.color
    ctx.fill()
  } else if (tool === 'rectangle') {
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
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })
  const [zoom, setZoom] = useState(1)
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const cameraOffsetRef = useRef({ x: 0, y: 0 })
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const drawingRef = useRef(false)
  const liveStrokeRef = useRef<NewStroke | null>(null)
  const devicePixelRatioRef = useRef(1)

  const clampCameraOffset = useCallback((offset: { x: number; y: number }, targetZoom: number) => {
    const host = canvasHostRef.current
    if (!host) return offset
    const { width, height } = host.getBoundingClientRect()
    const scaledWidth = BOARD_WIDTH * targetZoom
    const scaledHeight = BOARD_HEIGHT * targetZoom
    const minX = Math.min(0, width - scaledWidth)
    const minY = Math.min(0, height - scaledHeight)
    const maxX = Math.max(0, (width - scaledWidth) / 2)
    const maxY = Math.max(0, (height - scaledHeight) / 2)
    return {
      x: Math.min(maxX, Math.max(minX, offset.x)),
      y: Math.min(maxY, Math.max(minY, offset.y)),
    }
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    const dpr = devicePixelRatioRef.current
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * cameraOffset.x, dpr * cameraOffset.y)
    ctx.fillStyle = '#061a26'
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
    ctx.strokeStyle = '#176b87'
    ctx.lineWidth = 2 / zoom
    ctx.strokeRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
    strokes.forEach((stroke) => drawStroke(ctx, stroke))
    if (liveStrokeRef.current) {
      drawStroke(ctx, liveStrokeRef.current)
    }
  }, [strokes, zoom, cameraOffset])

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
      const nextOffset = clampCameraOffset(cameraOffsetRef.current, zoomRef.current)
      cameraOffsetRef.current = nextOffset
      setCameraOffset(nextOffset)
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
  }, [redraw, clampCameraOffset])

  useEffect(() => {
    redraw()
  }, [redraw])

  const getPointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.min(BOARD_WIDTH, Math.max(0, (event.clientX - rect.left - cameraOffset.x) / zoom)),
      y: Math.min(BOARD_HEIGHT, Math.max(0, (event.clientY - rect.top - cameraOffset.y) / zoom)),
    }
  }

  const getCursorPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const host = canvasHostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.preventDefault()
    if (event.button === 2) {
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      setCursor((current) => ({ ...current, visible: false }))
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return
    const point = getPointFromEvent(event)
    if (!point) return
    const cursorPosition = getCursorPosition(event)
    if (cursorPosition) setCursor({ ...cursorPosition, visible: true })
    event.currentTarget.focus({ preventScroll: true })
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
    const pan = panRef.current
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault()
      const nextOffset = clampCameraOffset({
        x: cameraOffsetRef.current.x + event.clientX - pan.x,
        y: cameraOffsetRef.current.y + event.clientY - pan.y,
      }, zoomRef.current)
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      cameraOffsetRef.current = nextOffset
      setCameraOffset(nextOffset)
      return
    }
    const point = getPointFromEvent(event)
    if (!point) return
    const cursorPosition = getCursorPosition(event)
    if (cursorPosition) setCursor({ ...cursorPosition, visible: true })
    if (!drawingRef.current || !liveStrokeRef.current) return
    event.preventDefault()
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
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }
    if (!drawingRef.current) return
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    commitStroke()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      return
    }
    if (!drawingRef.current) return
    event.preventDefault()
    commitStroke()
  }

  const hideCursor = () => setCursor((current) => ({ ...current, visible: false }))

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const currentZoom = zoomRef.current
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((currentZoom + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(1))))
    if (nextZoom === currentZoom) return
    const currentOffset = cameraOffsetRef.current
    const worldX = (pointerX - currentOffset.x) / currentZoom
    const worldY = (pointerY - currentOffset.y) / currentZoom
    const nextOffset = clampCameraOffset({
      x: pointerX - worldX * nextZoom,
      y: pointerY - worldY * nextZoom,
    }, nextZoom)
    zoomRef.current = nextZoom
    cameraOffsetRef.current = nextOffset
    setZoom(nextZoom)
    setCameraOffset(nextOffset)
  }

  return (
    <div className={`relative flex h-[500px] min-h-0 flex-col overflow-hidden rounded-2xl border border-cyan-950/80 bg-gradient-to-br from-sky-950 via-[#061a26] to-emerald-950/70 shadow-inner shadow-cyan-950/50 ${className ?? ''}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-cyan-900/60 bg-slate-950/25 px-4 py-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTool('pen')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'pen' ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-500/20' : 'border-cyan-950 text-slate-300 hover:border-cyan-700'}`}>
            Pen
          </button>
          <button type="button" onClick={() => setTool('eraser')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'eraser' ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-500/20' : 'border-cyan-950 text-slate-300 hover:border-cyan-700'}`}>
            Eraser
          </button>
          <button type="button" onClick={() => setTool('line')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'line' ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-500/20' : 'border-cyan-950 text-slate-300 hover:border-cyan-700'}`}>
            Line
          </button>
          <button type="button" onClick={() => setTool('rectangle')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'rectangle' ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-500/20' : 'border-cyan-950 text-slate-300 hover:border-cyan-700'}`}>
            Rectangle
          </button>
          <button type="button" onClick={() => setTool('ellipse')} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${tool === 'ellipse' ? 'border-cyan-300 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-500/20' : 'border-cyan-950 text-slate-300 hover:border-cyan-700'}`}>
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
            className="w-32 accent-emerald-400"
          />
          <span className="flex min-w-16 items-center gap-2 text-slate-300">
            <span
              aria-hidden="true"
              className={`inline-block rounded-full border ${tool === 'eraser' ? 'border-slate-100 bg-slate-100/15' : 'border-current bg-current/20'}`}
              style={{ width: Math.max(6, Math.min(brushSize, 24)), height: Math.max(6, Math.min(brushSize, 24)), color }}
            />
            <span className="tabular-nums">{brushSize}px</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-400">
          <span>Zoom</span>
          <span className="text-slate-300">{Math.round(zoom * 100)}%</span>
          <span className="normal-case tracking-normal text-slate-500">Scroll to zoom · right-drag to pan</span>
        </div>
      </div>
      <div ref={canvasHostRef} className="relative min-h-0 flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 block h-full w-full touch-none ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-none'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          onContextMenu={(event) => event.preventDefault()}
          onPointerLeave={hideCursor}
          onPointerEnter={(event) => {
            const cursorPosition = getCursorPosition(event)
            if (cursorPosition) setCursor({ ...cursorPosition, visible: true })
          }}
          tabIndex={0}
        />
        {!disabled && cursor.visible && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute rounded-full ${tool === 'eraser' ? 'border border-slate-100 bg-slate-100/15' : 'border border-white/90 bg-white/10'}`}
            style={{
              width: brushSize * zoom,
              height: brushSize * zoom,
              left: cursor.x,
              top: cursor.y,
              transform: 'translate(-50%, -50%)',
              boxShadow: tool === 'eraser' ? '0 0 0 1px rgba(15, 23, 42, 0.8)' : `0 0 0 1px ${color}`,
            }}
          />
        )}
      </div>
    </div>
  )
}
