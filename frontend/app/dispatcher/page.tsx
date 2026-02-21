'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

// ─── Canvas constants ───────────────────────────────────────────────
const CW = 900
const CH = 500

// Building wall segments [x1,y1,x2,y2]
const WALLS: [number, number, number, number][] = [
  // Outer walls (with entry gap at bottom x=405-465)
  [80, 50, 820, 50],
  [80, 50, 80, 450],
  [820, 50, 820, 450],
  [80, 450, 405, 450],
  [465, 450, 820, 450],
  // Upper room dividers — vertical
  [290, 50, 290, 135], [290, 180, 290, 210],  // left, door gap 135-180
  [530, 50, 530, 135], [530, 180, 530, 210],  // right, door gap 135-180
  // Horizontal wall separating upper rooms from corridor
  [80, 210, 170, 210], [230, 210, 400, 210], [460, 210, 580, 210], // gaps at 170-230, 400-460
  // Corridor → staging horizontal wall
  [80, 340, 370, 340], [435, 340, 820, 340],  // gap at 370-435
]

const ROOM_LABELS = [
  { x: 183, y: 130, label: 'ROOM A' },
  { x: 410, y: 130, label: 'ROOM B' },
  { x: 672, y: 130, label: 'ROOM C' },
  { x: 400, y: 280, label: 'CORRIDOR' },
  { x: 435, y: 400, label: 'STAGING' },
]

// ─── Types ──────────────────────────────────────────────────────────
interface Pos { x: number; y: number }
interface Msg { id: number; from: string; message: string; timestamp: string }
interface State {
  firefighterPosition: Pos
  waypoint: Pos | null
  radioLog: Msg[]
  firefighterStatus: string
  breadcrumbs: Pos[]
}

// ─── Helpers ─────────────────────────────────────────────────────────
function statusColor(s: string) {
  if (s === 'OK') return '#22c55e'
  if (s === 'Searching') return '#eab308'
  if (s === 'Victim Found') return '#f97316'
  return '#ff3131'
}

function fromColor(from: string) {
  if (from === 'DISPATCH') return '#ff3131'
  if (from === 'SYSTEM') return '#4d4d4d'
  return '#a0a0a0'
}

// ─── Canvas draw ─────────────────────────────────────────────────────
function drawMap(
  ctx: CanvasRenderingContext2D,
  state: State,
  waypointPreview: Pos | null,
  tick: number,
) {
  ctx.clearRect(0, 0, CW, CH)

  // Background
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, CW, CH)

  // Tactical dot grid
  ctx.fillStyle = '#0f0f0f'
  for (let x = 0; x < CW; x += 30) {
    for (let y = 0; y < CH; y += 30) {
      ctx.fillRect(x, y, 1, 1)
    }
  }

  // Floor fill (inside building)
  ctx.fillStyle = '#080808'
  ctx.fillRect(81, 51, 738, 398)

  // Walls
  ctx.strokeStyle = '#4d1010'
  ctx.lineWidth = 2
  ctx.lineCap = 'square'
  for (const [x1, y1, x2, y2] of WALLS) {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Room labels
  ctx.font = '9px "Space Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#2a2a2a'
  for (const { x, y, label } of ROOM_LABELS) {
    ctx.fillText(label, x, y)
  }

  // Breadcrumbs
  const crumbs = state.breadcrumbs
  for (let i = 0; i < crumbs.length; i++) {
    const alpha = (i / crumbs.length) * 0.6
    ctx.fillStyle = `rgba(255,49,49,${alpha})`
    ctx.beginPath()
    ctx.arc(crumbs[i].x, crumbs[i].y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  // Waypoint preview (mouse hover)
  if (waypointPreview) {
    ctx.strokeStyle = 'rgba(255,49,49,0.3)'
    ctx.lineWidth = 1
    const s = 12
    ctx.beginPath()
    ctx.moveTo(waypointPreview.x - s, waypointPreview.y)
    ctx.lineTo(waypointPreview.x + s, waypointPreview.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(waypointPreview.x, waypointPreview.y - s)
    ctx.lineTo(waypointPreview.x, waypointPreview.y + s)
    ctx.stroke()
  }

  // Waypoint
  if (state.waypoint) {
    const { x, y } = state.waypoint
    const pulse = 0.6 + 0.4 * Math.sin(tick * 0.08)
    ctx.strokeStyle = `rgba(255,49,49,${pulse})`
    ctx.lineWidth = 1.5
    const s = 14
    ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255,49,49,${pulse * 0.8})`
    ctx.stroke()
    // outer ring
    ctx.beginPath()
    ctx.arc(x, y, 16 + Math.sin(tick * 0.1) * 3, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255,49,49,${0.2 * pulse})`
    ctx.stroke()
    // label
    ctx.font = '8px "Space Mono", monospace'
    ctx.fillStyle = '#ff3131'
    ctx.textAlign = 'left'
    ctx.fillText('TARGET', x + 10, y - 10)
  }

  // FF dot
  const { x, y } = state.firefighterPosition
  const glow = 0.7 + 0.3 * Math.sin(tick * 0.05)
  ctx.shadowColor = '#ff3131'
  ctx.shadowBlur = 12 * glow
  ctx.fillStyle = '#ff3131'
  ctx.beginPath()
  ctx.arc(x, y, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0

  // FF direction ring
  ctx.strokeStyle = `rgba(255,49,49,0.4)`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(x, y, 12, 0, Math.PI * 2)
  ctx.stroke()

  // FF label
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 9px "Space Mono", monospace'
  ctx.textAlign = 'left'
  ctx.fillText('FF1', x + 14, y + 4)

  ctx.textAlign = 'left'
}

// ─── Main component ──────────────────────────────────────────────────
export default function DispatcherPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<State>({
    firefighterPosition: { x: 435, y: 400 },
    waypoint: null, radioLog: [], firefighterStatus: 'OK', breadcrumbs: [],
  })
  const [waypointPreview, setWaypointPreview] = useState<Pos | null>(null)
  const [tick, setTick] = useState(0)
  const [time, setTime] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  const logRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // Clock + tick
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1)
      setTime(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 100)
    return () => clearInterval(id)
  }, [])

  // Poll state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/state')
        const data = await res.json()
        setState(data)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 300)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [state.radioLog.length])

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawMap(ctx, state, waypointPreview, tick)
  }, [state, waypointPreview, tick])

  // Canvas coordinate conversion
  const toCanvas = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (CW / rect.width),
      y: (e.clientY - rect.top) * (CH / rect.height),
    }
  }, [])

  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = toCanvas(e)
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dispatcher_places_waypoint', position: pos }),
    })
  }, [toCanvas])

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    setWaypointPreview(toCanvas(e))
  }, [toCanvas])

  const clearWaypoint = async () => {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dispatcher_clears_waypoint' }),
    })
  }

  const resetAll = async () => {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'reset' }),
    })
  }

  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    const ss = (s % 60).toString().padStart(2, '0')
    return `${m}:${ss}`
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#000',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{
        height: '40px', borderBottom: '1px solid #1a1a1a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span className="font-display" style={{
            fontSize: '13px', fontWeight: 900, color: '#fff', letterSpacing: '0.12em',
          }}>
            FIRE<span style={{ color: '#ff3131' }}>COMMAND</span>
          </span>
          <span className="font-mono" style={{ fontSize: '9px', color: '#4d1010', letterSpacing: '0.2em' }}>
            NIGEL // DISPATCHER
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            <Stat label="TIME" value={time || '00:00:00'} />
            <Stat label="ELAPSED" value={fmtElapsed(elapsed)} accent />
            <Stat label="FF1" value={state.firefighterStatus}
              valueColor={statusColor(state.firefighterStatus)} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <HBtn onClick={clearWaypoint} label="CLR WPT" />
            <HBtn onClick={resetAll} label="RESET" dim />
          </div>
          <Link href="/" className="font-mono" style={{
            fontSize: '9px', color: '#333', textDecoration: 'none', letterSpacing: '0.1em',
          }}>← HOME</Link>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: '180px 1fr 240px',
        gap: '8px', padding: '8px', overflow: 'hidden',
      }}>

        {/* Left: Units */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header">UNITS</div>
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
            <UnitCard
              id="FF1"
              status={state.firefighterStatus}
              pos={state.firefighterPosition}
              waypoint={state.waypoint}
              active
            />
            <UnitCard id="FF2" status="STANDBY" pos={null} waypoint={null} active={false} />
          </div>
          <div style={{ padding: '10px', borderTop: '1px solid #1a1a1a' }}>
            <div className="font-mono" style={{ fontSize: '8px', color: '#2a2a2a', textAlign: 'center', letterSpacing: '0.1em' }}>
              CLICK MAP TO SET WAYPOINT
            </div>
          </div>
        </div>

        {/* Center: Map */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <span>3D MAP + LOCATION</span>
            <span className="font-mono" style={{ fontSize: '8px', color: '#4d4d4d' }}>
              {state.waypoint
                ? `WPT: (${Math.round(state.waypoint.x)}, ${Math.round(state.waypoint.y)})`
                : 'NO WAYPOINT'}
            </span>
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              style={{ width: '100%', height: '100%', cursor: 'crosshair', display: 'block' }}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMove}
              onMouseLeave={() => setWaypointPreview(null)}
            />
          </div>
        </div>

        {/* Right: Radio Log */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="panel-header">RADIO LOG</div>
          <div
            ref={logRef}
            style={{
              flex: 1, overflowY: 'auto', padding: '8px',
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}
          >
            {state.radioLog.map(msg => (
              <div key={msg.id} className="anim-in" style={{ flexShrink: 0 }}>
                <span className="font-mono" style={{ fontSize: '8px', color: '#333' }}>
                  {msg.timestamp}
                </span>
                {' '}
                <span className="font-mono" style={{
                  fontSize: '9px', fontWeight: 700,
                  color: fromColor(msg.from),
                }}>
                  [{msg.from}]
                </span>
                {' '}
                <span className="font-mono" style={{ fontSize: '9px', color: '#c0c0c0' }}>
                  {msg.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────

function Stat({ label, value, accent, valueColor }: {
  label: string; value: string; accent?: boolean; valueColor?: string
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="font-mono" style={{ fontSize: '7px', color: '#333', letterSpacing: '0.15em' }}>{label}</div>
      <div className="font-mono" style={{
        fontSize: '11px', fontWeight: 700,
        color: valueColor ?? (accent ? '#ff3131' : '#fff'),
        letterSpacing: '0.05em',
      }}>{value}</div>
    </div>
  )
}

function HBtn({ onClick, label, dim }: { onClick: () => void; label: string; dim?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="font-mono"
      style={{
        background: 'none',
        border: `1px solid ${dim ? '#1a1a1a' : '#2a2a2a'}`,
        color: dim ? '#333' : '#a0a0a0',
        fontSize: '8px',
        padding: '4px 10px',
        cursor: 'pointer',
        letterSpacing: '0.1em',
        fontFamily: 'inherit',
        transition: 'all 0.1s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#ff3131'
        ;(e.currentTarget as HTMLButtonElement).style.color = '#ff3131'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = dim ? '#1a1a1a' : '#2a2a2a'
        ;(e.currentTarget as HTMLButtonElement).style.color = dim ? '#333' : '#a0a0a0'
      }}
    >
      {label}
    </button>
  )
}

function UnitCard({ id, status, pos, waypoint, active }: {
  id: string
  status: string
  pos: { x: number; y: number } | null
  waypoint: { x: number; y: number } | null
  active: boolean
}) {
  const dist = pos && waypoint
    ? (Math.sqrt((waypoint.x - pos.x) ** 2 + (waypoint.y - pos.y) ** 2) * 0.055).toFixed(1)
    : null

  return (
    <div style={{
      border: `1px solid ${active ? '#2a2a2a' : '#111'}`,
      padding: '10px',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span className="font-display" style={{ fontSize: '11px', fontWeight: 700, color: active ? '#fff' : '#333' }}>
          {id}
        </span>
        <span style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: active ? statusColor(status) : '#222',
          boxShadow: active ? `0 0 6px ${statusColor(status)}` : 'none',
          animation: active && status !== 'OK' ? 'pulse-dot 1.5s infinite' : 'none',
        }} />
      </div>
      <div className="font-mono" style={{ fontSize: '9px', color: active ? statusColor(status) : '#333', marginBottom: '4px' }}>
        {active ? status.toUpperCase() : 'STANDBY'}
      </div>
      {dist && (
        <div className="font-mono" style={{ fontSize: '8px', color: '#666' }}>
          {dist}m to target
        </div>
      )}
      {!active && (
        <div className="font-mono" style={{ fontSize: '8px', color: '#222' }}>NOT DEPLOYED</div>
      )}
    </div>
  )
}
