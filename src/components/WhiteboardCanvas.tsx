import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Circle, Eraser, Eye, Minus, Pencil, Plus, Redo2, Slash, Square, Undo2 } from 'lucide-react'
import type { NewStroke, Point, WhiteboardStroke, WhiteboardTool } from '../types/realtime'

const COLORS = ['#f1f5f9', '#fb923c', '#f87171', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9']
const BOARD_WIDTH = 2400
const BOARD_HEIGHT = 1600
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2

// The page behind the board uses --workspace (set in RoomPage). These two are drawn on the canvas itself.
const BOARD = { surface: '#161a21', dot: '#2c313c', edge: '#2c313c' }

const TOOLS: { id: WhiteboardTool; label: string; key: string; Icon: typeof Pencil }[] = [
  { id: 'pen', label: 'Pen', key: 'P', Icon: Pencil },
  { id: 'eraser', label: 'Eraser', key: 'E', Icon: Eraser },
  { id: 'line', label: 'Line', key: 'L', Icon: Slash },
  { id: 'rectangle', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
]

function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

let gridTile: HTMLCanvasElement | null = null
function getGridTile() {
  if (gridTile) return gridTile
  // 160px tile that represents 40 board units, so the dots stay sharp up to 2x zoom on hi-dpi screens.
  const tile = document.createElement('canvas')
  tile.width = 160
  tile.height = 160
  const tctx = tile.getContext('2d')
  if (tctx) {
    tctx.fillStyle = BOARD.dot
    tctx.beginPath()
    tctx.arc(80, 80, 5, 0, Math.PI * 2)
    tctx.fill()
  }
  gridTile = tile
  return tile
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

type IconButtonProps = {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}

function IconButton({ label, shortcut, active, disabled, onClick, children }: IconButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:cursor-not-allowed disabled:opacity-35 ${
          active
            ? 'bg-(--accent) text-(--accent-ink)'
            : 'text-(--muted) hover:bg-(--surface-2) hover:text-(--text) disabled:hover:bg-transparent'
        }`}
      >
        {children}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 flex -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-md border border-(--border) bg-(--surface-2) px-2 py-1 text-xs text-(--text) opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
        {shortcut && <kbd className="rounded bg-(--bg) px-1.5 py-0.5 font-sans text-[11px] text-(--muted)">{shortcut}</kbd>}
      </span>
    </div>
  )
}

type WhiteboardCanvasProps = {
  strokes: WhiteboardStroke[]
  onStrokeComplete: (stroke: NewStroke) => void
  onStrokePreview: (stroke: NewStroke) => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  disabled?: boolean
  canDraw?: boolean
  className?: string
}

export default function WhiteboardCanvas({
  strokes,
  onStrokeComplete,
  onStrokePreview,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  disabled = false,
  canDraw = true,
  className,
}: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [brushSize, setBrushSize] = useState(4)
  const [tool, setTool] = useState<WhiteboardTool>('pen')
  const [cursor, setCursor] = useState({ x: 0, y: 0, visible: false })
  const [zoom, setZoom] = useState(1)
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const cameraOffsetRef = useRef({ x: 0, y: 0 })
  const didCenterRef = useRef(false)
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const drawingRef = useRef(false)
  const liveStrokeRef = useRef<NewStroke | null>(null)
  const devicePixelRatioRef = useRef(1)
  const lastPreviewAtRef = useRef(0)

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

    // Strokes are drawn on their own layer first so the eraser only removes ink, never the board or its grid.
    const layer = layerRef.current ?? (layerRef.current = document.createElement('canvas'))
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width
      layer.height = canvas.height
    }
    const layerCtx = layer.getContext('2d')
    if (!layerCtx) return
    layerCtx.setTransform(1, 0, 0, 1, 0, 0)
    layerCtx.clearRect(0, 0, layer.width, layer.height)
    layerCtx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * cameraOffset.x, dpr * cameraOffset.y)
    strokes.forEach((stroke) => drawStroke(layerCtx, stroke))
    if (liveStrokeRef.current) drawStroke(layerCtx, liveStrokeRef.current)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * cameraOffset.x, dpr * cameraOffset.y)
    ctx.fillStyle = BOARD.surface
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
    const grid = ctx.createPattern(getGridTile(), 'repeat')
    if (grid) {
      grid.setTransform(new DOMMatrix().scale(0.25))
      ctx.fillStyle = grid
      ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
    ctx.clip()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
    ctx.strokeStyle = BOARD.edge
    ctx.lineWidth = 1 / zoom
    ctx.strokeRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
  }, [strokes, zoom, cameraOffset])

  const redrawRef = useRef(redraw)
  useEffect(() => {
    redrawRef.current = redraw
  }, [redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvasHostRef.current
    if (!canvas || !host) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      devicePixelRatioRef.current = dpr
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      const base = didCenterRef.current
        ? cameraOffsetRef.current
        : { x: (rect.width - BOARD_WIDTH * zoomRef.current) / 2, y: (rect.height - BOARD_HEIGHT * zoomRef.current) / 2 }
      if (rect.width > 0) didCenterRef.current = true
      const nextOffset = clampCameraOffset(base, zoomRef.current)
      cameraOffsetRef.current = nextOffset
      setCameraOffset(nextOffset)
      redrawRef.current()
    }

    resize()
    const observer = new ResizeObserver(() => resize())
    observer.observe(host)
    return () => observer.disconnect()
  }, [clampCameraOffset])

  useEffect(() => {
    redraw()
  }, [redraw])

  const applyZoom = useCallback(
    (requested: number, anchor?: { x: number; y: number }) => {
      const host = canvasHostRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      const anchorX = anchor?.x ?? rect.width / 2
      const anchorY = anchor?.y ?? rect.height / 2
      const currentZoom = zoomRef.current
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(requested.toFixed(1))))
      if (nextZoom === currentZoom) return
      const currentOffset = cameraOffsetRef.current
      const worldX = (anchorX - currentOffset.x) / currentZoom
      const worldY = (anchorY - currentOffset.y) / currentZoom
      const nextOffset = clampCameraOffset({ x: anchorX - worldX * nextZoom, y: anchorY - worldY * nextZoom }, nextZoom)
      zoomRef.current = nextZoom
      cameraOffsetRef.current = nextOffset
      setZoom(nextZoom)
      setCameraOffset(nextOffset)
    },
    [clampCameraOffset],
  )

  const resetView = () => {
    const host = canvasHostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    const nextOffset = clampCameraOffset({ x: (rect.width - BOARD_WIDTH) / 2, y: (rect.height - BOARD_HEIGHT) / 2 }, 1)
    zoomRef.current = 1
    cameraOffsetRef.current = nextOffset
    setZoom(1)
    setCameraOffset(nextOffset)
  }

  // Native listener: React attaches wheel handlers as passive, which makes preventDefault() a no-op.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      applyZoom(zoomRef.current + (event.deltaY < 0 ? 0.1 : -0.1), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  useEffect(() => {
    if (!canDraw) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      const match = TOOLS.find((item) => item.key.toLowerCase() === event.key.toLowerCase())
      if (match) setTool(match.id)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canDraw])

  const getPointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.min(BOARD_WIDTH, Math.max(0, (event.clientX - rect.left - cameraOffset.x) / zoom)),
      y: Math.min(BOARD_HEIGHT, Math.max(0, (event.clientY - rect.top - cameraOffset.y) / zoom)),
    }
  }

  const getCursorPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const host = canvasHostRef.current
    if (!host) return null
    const rect = host.getBoundingClientRect()
    return {
      x: Math.min(Math.max(event.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(event.clientY - rect.top, 0), rect.height),
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    // Right-drag pans for everyone; viewers can also pan with a normal drag since they can't draw.
    if (event.button === 2 || (event.button === 0 && !canDraw)) {
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      setCursor((current) => ({ ...current, visible: false }))
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return
    if (disabled || !canDraw) return
    const point = getPointFromEvent(event)
    if (!point) return
    const cursorPosition = getCursorPosition(event)
    if (cursorPosition) setCursor({ ...cursorPosition, visible: true })
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPreviewAtRef.current = 0
    liveStrokeRef.current = {
      clientId: createClientId(),
      points: [point],
      color,
      size: brushSize,
      tool,
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current
    if (pan?.pointerId === event.pointerId) {
      event.preventDefault()
      const nextOffset = clampCameraOffset(
        {
          x: cameraOffsetRef.current.x + event.clientX - pan.x,
          y: cameraOffsetRef.current.y + event.clientY - pan.y,
        },
        zoomRef.current,
      )
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
    const now = performance.now()
    if (now - lastPreviewAtRef.current >= 40) {
      lastPreviewAtRef.current = now
      onStrokePreview({ ...liveStrokeRef.current, points: liveStrokeRef.current.points.map((item) => ({ ...item })) })
    }
    redraw()
  }

  const commitStroke = () => {
    if (!liveStrokeRef.current) return
    onStrokeComplete(liveStrokeRef.current)
    liveStrokeRef.current = null
    drawingRef.current = false
    redraw()
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      return
    }
    if (!drawingRef.current) return
    event.preventDefault()
    commitStroke()
  }

  const hideCursor = () => setCursor((current) => ({ ...current, visible: false }))

  const isEraser = tool === 'eraser'
  const previewSize = Math.max(6, Math.min(brushSize, 22))

  return (
    <div className={`relative h-full w-full overflow-hidden bg-(--workspace) ${className ?? ''}`}>
      <div ref={canvasHostRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 block h-full w-full touch-none focus:outline-none ${
            disabled ? 'cursor-not-allowed opacity-60' : canDraw ? 'cursor-none' : 'cursor-grab active:cursor-grabbing'
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(event) => event.preventDefault()}
          onPointerLeave={hideCursor}
          onPointerEnter={(event) => {
            const cursorPosition = getCursorPosition(event)
            if (cursorPosition) setCursor({ ...cursorPosition, visible: true })
          }}
          tabIndex={0}
          aria-label="Shared whiteboard"
        />
        {!disabled && canDraw && cursor.visible && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute rounded-full border ${isEraser ? 'border-slate-100 bg-slate-100/15' : 'border-white/90 bg-white/10'}`}
            style={{
              width: brushSize * zoom,
              height: brushSize * zoom,
              left: cursor.x,
              top: cursor.y,
              transform: 'translate(-50%, -50%)',
              boxShadow: isEraser ? '0 0 0 1px rgba(15, 23, 42, 0.8)' : `0 0 0 1px ${color}`,
            }}
          />
        )}
      </div>

      {canDraw && strokes.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-(--muted)">
          The board is empty. Pick a tool and start drawing.
        </p>
      )}

      {canDraw ? (
        <>
          <div className="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-(--border) bg-(--surface) p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
            {TOOLS.map(({ id, label, key, Icon }) => (
              <IconButton key={id} label={label} shortcut={key} active={tool === id} onClick={() => setTool(id)}>
                <Icon size={18} strokeWidth={1.75} />
              </IconButton>
            ))}
            <div className="my-1 h-px bg-(--border)" />
            <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={() => onUndo?.()}>
              <Undo2 size={18} strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={() => onRedo?.()}>
              <Redo2 size={18} strokeWidth={1.75} />
            </IconButton>
          </div>

          <div className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-4 overflow-x-auto rounded-xl border border-(--border) bg-(--surface) px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
            <div className={`flex items-center gap-1.5 transition-opacity ${isEraser ? 'pointer-events-none opacity-35' : ''}`} role="group" aria-label="Stroke color">
              {COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Color ${swatch}`}
                  aria-pressed={color === swatch}
                  onClick={() => setColor(swatch)}
                  className={`h-6 w-6 shrink-0 rounded-full ring-offset-2 ring-offset-[#151920] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) ${
                    color === swatch ? 'ring-2 ring-white' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
              <label
                className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full transition hover:scale-110 focus-within:ring-2 focus-within:ring-(--accent)"
                style={{ background: 'conic-gradient(#f87171, #facc15, #4ade80, #22d3ee, #818cf8, #e879f9, #f87171)' }}
                title="Custom color"
              >
                <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Custom stroke color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              </label>
            </div>
            <div className="h-6 w-px shrink-0 bg-(--border)" />
            <div className="flex shrink-0 items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center" aria-hidden="true">
                <span
                  className={`rounded-full ${isEraser ? 'border border-slate-200 bg-slate-200/15' : ''}`}
                  style={{ width: previewSize, height: previewSize, backgroundColor: isEraser ? undefined : color }}
                />
              </span>
              <input
                type="range"
                min={2}
                max={48}
                step={1}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                aria-label={isEraser ? 'Eraser size' : 'Brush size'}
                className="w-28 accent-(--accent)"
              />
              <span className="w-9 text-right text-xs tabular-nums text-(--muted)">{brushSize}px</span>
            </div>
          </div>
        </>
      ) : (
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-(--border) bg-(--surface) px-3 py-2 text-sm text-(--muted) shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <Eye size={16} strokeWidth={1.75} />
          View only. Ask the owner for edit access.
        </div>
      )}

      <div className="absolute bottom-4 right-4 z-10 flex items-center rounded-xl border border-(--border) bg-(--surface) p-1 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => applyZoom(zoomRef.current - 0.1)}
          disabled={zoom <= MIN_ZOOM}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--muted) transition-colors hover:bg-(--surface-2) hover:text-(--text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:opacity-35"
        >
          <Minus size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={resetView}
          title="Reset to 100%"
          className="h-8 min-w-14 rounded-lg px-2 text-xs tabular-nums text-(--text) transition-colors hover:bg-(--surface-2) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => applyZoom(zoomRef.current + 0.1)}
          disabled={zoom >= MAX_ZOOM}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-(--muted) transition-colors hover:bg-(--surface-2) hover:text-(--text) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--accent) disabled:opacity-35"
        >
          <Plus size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
