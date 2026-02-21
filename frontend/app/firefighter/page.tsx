'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

// ─── Constants ───────────────────────────────────────────────────────
const STEP = 10
const BOUNDS = { xMin: 82, xMax: 818, yMin: 52, yMax: 448 }

const STATUSES = ['OK', 'Searching', 'Victim Found', 'Need Help'] as const
type StatusType = typeof STATUSES[number]

const FAKE_TRANSCRIPTS = [
  'Hallway is clear, moving to your marker.',
  "Smoke's getting heavy. Visibility dropping.",
  'Copy that. On my way.',
  'There is a door here. Checking if blocked.',
  'Can hear something. Hold on.',
  'Moving through the corridor now.',
  'Structural damage visible on east side.',
  'Civilian located. Requesting guidance.',
  'I see the marker. Almost there.',
  "Air is thicker here. Slowing down.",
]

function statusColor(s: StatusType) {
  if (s === 'OK') return '#22c55e'
  if (s === 'Searching') return '#eab308'
  if (s === 'Victim Found') return '#f97316'
  return '#ff3131'
}

// ─── Arrow SVG ────────────────────────────────────────────────────────
function DirectionArrow({ angle, active }: { angle: number; active: boolean }) {
  return (
    <svg
      viewBox="0 0 100 140"
      style={{
        width: '160px',
        height: '224px',
        transform: `rotate(${angle}deg)`,
        transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        filter: active
          ? 'drop-shadow(0 0 16px rgba(255,49,49,0.9)) drop-shadow(0 0 32px rgba(255,49,49,0.4))'
          : 'drop-shadow(0 0 4px rgba(255,49,49,0.3))',
        animation: active ? 'arrow-pulse 2s ease-in-out infinite' : 'none',
      }}
    >
      {/* Arrow shaft */}
      <rect x="42" y="60" width="16" height="70" fill={active ? '#ff3131' : '#4d1010'} rx="3" />
      {/* Arrow head */}
      <polygon points="50,0 100,70 72,60 72,60 28,60 0,70" fill={active ? '#ff3131' : '#4d1010'} />
    </svg>
  )
}

// ─── Compass ring (when no waypoint) ─────────────────────────────────
function AwaitingIndicator() {
  return (
    <div style={{ position: 'relative', width: '180px', height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* Spinning ring */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        border: '1px solid #1a1a1a',
        borderTopColor: '#4d1010',
        animation: 'spin-slow 3s linear infinite',
      }} />
      <div style={{
        position: 'absolute', inset: '20px', borderRadius: '50%',
        border: '1px solid #111',
        borderBottomColor: '#2a0808',
        animation: 'spin-slow 5s linear infinite reverse',
      }} />
      <div style={{ textAlign: 'center' }}>
        <div className="font-display" style={{
          fontSize: '10px', fontWeight: 700, color: '#4d1010',
          letterSpacing: '0.2em', lineHeight: 1.4,
        }}>
          AWAITING<br />ORDERS
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────
export default function FirefighterPage() {
  const [ffPos, setFfPos] = useState({ x: 435, y: 400 })
  const [waypoint, setWaypoint] = useState<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState<StatusType>('OK')
  const [transmitting, setTransmitting] = useState(false)
  const [lastMsg, setLastMsg] = useState('')
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ffPosRef = useRef(ffPos)
  ffPosRef.current = ffPos

  // Poll state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/state')
        const data = await res.json()
        setWaypoint(data.waypoint)
        setFfPos(data.firefighterPosition)
        setStatus(data.firefighterStatus)
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 300)
    return () => clearInterval(id)
  }, [])

  // Keyboard movement (WASD + arrows)
  useEffect(() => {
    const pressed = new Set<string>()

    const onKeyDown = (e: KeyboardEvent) => {
      pressed.add(e.key)

      let dx = 0, dy = 0
      if (pressed.has('ArrowUp') || pressed.has('w') || pressed.has('W')) dy -= STEP
      if (pressed.has('ArrowDown') || pressed.has('s') || pressed.has('S')) dy += STEP
      if (pressed.has('ArrowLeft') || pressed.has('a') || pressed.has('A')) dx -= STEP
      if (pressed.has('ArrowRight') || pressed.has('d') || pressed.has('D')) dx += STEP

      if (dx !== 0 || dy !== 0) {
        const cur = ffPosRef.current
        const nx = Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, cur.x + dx))
        const ny = Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, cur.y + dy))
        const newPos = { x: nx, y: ny }
        setFfPos(newPos)
        fetch('/api/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'firefighter_position_update', position: newPos }),
        }).catch(() => {})
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      pressed.delete(e.key)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Status cycle
  const cycleStatus = useCallback(async () => {
    const idx = STATUSES.indexOf(status)
    const next = STATUSES[(idx + 1) % STATUSES.length]
    setStatus(next)
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'firefighter_status_update', status: next }),
    })
  }, [status])

  // Hold-to-transmit
  const startHold = useCallback(() => {
    setTransmitting(true)
    holdTimer.current = setTimeout(() => {
      setLastMsg('TRANSMITTING...')
    }, 200)
  }, [])

  const endHold = useCallback(async () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    if (!transmitting) return
    setTransmitting(false)
    const msg = FAKE_TRANSCRIPTS[Math.floor(Math.random() * FAKE_TRANSCRIPTS.length)]
    setLastMsg(msg)
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'firefighter_voice_message', message: `[VOICE] ${msg}` }),
    })
    setTimeout(() => setLastMsg(''), 4000)
  }, [transmitting])

  // Compute arrow angle and distance
  const angle = waypoint
    ? Math.atan2(waypoint.y - ffPos.y, waypoint.x - ffPos.x) * (180 / Math.PI) + 90
    : 0

  const dist = waypoint
    ? (Math.sqrt((waypoint.x - ffPos.x) ** 2 + (waypoint.y - ffPos.y) ** 2) * 0.055).toFixed(1)
    : null

  const onTarget = waypoint && parseFloat(dist ?? '99') < 1.5

  const isNeedHelp = status === 'Need Help'

  return (
    <div style={{
      width: '100vw', height: '100vh', background: '#000',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      userSelect: 'none',
    }}>

      {/* ── Header ── */}
      <div style={{
        height: '44px', borderBottom: '1px solid #1a1a1a', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#ff3131',
            boxShadow: '0 0 8px #ff3131',
            animation: 'pulse-dot 2s infinite',
          }} />
          <span className="font-display" style={{ fontSize: '14px', fontWeight: 900, color: '#fff', letterSpacing: '0.1em' }}>
            FF1
          </span>
          <span className="font-mono" style={{ fontSize: '9px', color: '#4d1010', letterSpacing: '0.15em' }}>
            // NIGEL
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="font-mono" style={{ fontSize: '9px', color: '#333', letterSpacing: '0.1em' }}>
            ↑↓←→ TO MOVE
          </span>
          <Link href="/" className="font-mono" style={{ fontSize: '9px', color: '#333', textDecoration: 'none' }}>
            ← HOME
          </Link>
        </div>
      </div>

      {/* ── Arrow area (top ~65%) ── */}
      <div style={{
        flex: '0 0 65%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px',
        position: 'relative',
      }}>
        {/* Background tac-grid */}
        <div className="tac-bg" style={{ position: 'absolute', inset: 0, opacity: 0.4 }} />

        {/* Alert banner for Need Help */}
        {isNeedHelp && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: '8px', textAlign: 'center',
            animation: 'need-help-flash 0.5s infinite',
          }}>
            <span className="font-display" style={{ fontSize: '12px', fontWeight: 900, color: '#fff', letterSpacing: '0.3em' }}>
              ⚠ NEED HELP ⚠
            </span>
          </div>
        )}

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          {onTarget ? (
            <div style={{ textAlign: 'center' }}>
              <div className="font-display" style={{
                fontSize: '28px', fontWeight: 900, color: '#ff3131',
                letterSpacing: '0.2em',
                textShadow: '0 0 20px rgba(255,49,49,0.8)',
                animation: 'pulse-dot 1s infinite',
              }}>
                ON TARGET
              </div>
            </div>
          ) : waypoint ? (
            <DirectionArrow angle={angle} active />
          ) : (
            <AwaitingIndicator />
          )}

          {/* Distance */}
          <div style={{ textAlign: 'center' }}>
            {dist ? (
              <div className="font-mono" style={{
                fontSize: '32px', fontWeight: 700, color: '#fff', letterSpacing: '0.05em',
              }}>
                {dist}<span style={{ fontSize: '16px', color: '#a0a0a0', marginLeft: '4px' }}>m</span>
              </div>
            ) : (
              <div className="font-mono" style={{ fontSize: '12px', color: '#333', letterSpacing: '0.2em' }}>
                STANDBY
              </div>
            )}
            {dist && (
              <div className="font-mono" style={{ fontSize: '9px', color: '#4d4d4d', letterSpacing: '0.15em', marginTop: '2px' }}>
                TO TARGET
              </div>
            )}
          </div>

          {/* Last transmitted message */}
          {lastMsg && (
            <div className="font-mono anim-in" style={{
              fontSize: '10px', color: '#ff3131', maxWidth: '280px',
              textAlign: 'center', letterSpacing: '0.05em',
              padding: '6px 12px', border: '1px solid #4d1010',
            }}>
              {lastMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── Controls (bottom ~35%) ── */}
      <div style={{
        flex: '0 0 35%', borderTop: '1px solid #1a1a1a',
        display: 'flex', gap: '0', flexShrink: 0,
      }}>

        {/* Status button */}
        <button
          onClick={cycleStatus}
          style={{
            flex: 1,
            background: isNeedHelp ? 'transparent' : '#050505',
            border: 'none',
            borderRight: '1px solid #1a1a1a',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '8px',
            animation: isNeedHelp ? 'need-help-flash 0.5s infinite' : 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onTouchStart={() => {}}
        >
          <div style={{
            width: '20px', height: '20px', borderRadius: '50%',
            background: statusColor(status),
            boxShadow: `0 0 12px ${statusColor(status)}`,
          }} />
          <div className="font-display" style={{
            fontSize: '14px', fontWeight: 700,
            color: statusColor(status),
            letterSpacing: '0.1em',
          }}>
            {status.toUpperCase()}
          </div>
          <div className="font-mono" style={{ fontSize: '8px', color: '#333', letterSpacing: '0.1em' }}>
            TAP TO CHANGE
          </div>
        </button>

        {/* Mic / Transmit button */}
        <button
          onMouseDown={startHold}
          onMouseUp={endHold}
          onMouseLeave={endHold}
          onTouchStart={e => { e.preventDefault(); startHold() }}
          onTouchEnd={e => { e.preventDefault(); endHold() }}
          style={{
            flex: 1,
            background: transmitting ? '#1a0000' : '#050505',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '8px',
            transition: 'background 0.1s',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {/* Mic icon */}
          <svg width="32" height="40" viewBox="0 0 32 40" fill="none">
            <rect x="10" y="0" width="12" height="22" rx="6"
              fill={transmitting ? '#ff3131' : '#2a2a2a'}
              style={{ transition: 'fill 0.1s' }}
            />
            <path d="M5 18 Q5 30 16 30 Q27 30 27 18"
              stroke={transmitting ? '#ff3131' : '#2a2a2a'}
              strokeWidth="2" fill="none"
              style={{ transition: 'stroke 0.1s' }}
            />
            <line x1="16" y1="30" x2="16" y2="38"
              stroke={transmitting ? '#ff3131' : '#2a2a2a'}
              strokeWidth="2"
              style={{ transition: 'stroke 0.1s' }}
            />
            <line x1="10" y1="38" x2="22" y2="38"
              stroke={transmitting ? '#ff3131' : '#2a2a2a'}
              strokeWidth="2"
              style={{ transition: 'stroke 0.1s' }}
            />
          </svg>

          <div className="font-display" style={{
            fontSize: '11px', fontWeight: 700,
            color: transmitting ? '#ff3131' : '#2a2a2a',
            letterSpacing: '0.15em',
            transition: 'color 0.1s',
          }}>
            {transmitting ? 'TRANSMITTING' : 'TRANSMIT'}
          </div>
          <div className="font-mono" style={{ fontSize: '8px', color: '#222', letterSpacing: '0.1em' }}>
            HOLD TO TALK
          </div>
        </button>
      </div>
    </div>
  )
}
