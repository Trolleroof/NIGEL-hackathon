'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

// ─── Constants ───────────────────────────────────────────────────────
const STEP = 10
const BOUNDS = { xMin: 82, xMax: 818, yMin: 52, yMax: 448 }
const CW = 900   // logical canvas width (matches dispatcher)
const CH = 500   // logical canvas height

const STATUSES = ['OK', 'Searching', 'Victim Found', 'Need Help'] as const
type StatusType = typeof STATUSES[number]

function statusColor(s: StatusType) {
  if (s === 'OK') return '#22c55e'
  if (s === 'Searching') return '#eab308'
  if (s === 'Victim Found') return '#f97316'
  return '#ff3131'
}

function fromColor(from: string) {
  if (from === 'DISPATCH') return '#ff3131'
  if (from === 'SYSTEM') return '#444'
  return '#a0a0a0'
}

// ─── Mini-map canvas draw ─────────────────────────────────────────────
// Simple walls for the mini-map (same logical coords as dispatcher)
const WALLS: [number, number, number, number][] = [
  [80, 50, 820, 50], [80, 50, 80, 450], [820, 50, 820, 450],
  [80, 450, 405, 450], [465, 450, 820, 450],
  [290, 50, 290, 135], [290, 180, 290, 210],
  [530, 50, 530, 135], [530, 180, 530, 210],
  [80, 210, 170, 210], [230, 210, 400, 210], [460, 210, 580, 210],
  [80, 340, 370, 340], [435, 340, 820, 340],
]

function drawMiniMap(
  ctx: CanvasRenderingContext2D,
  ffPos: { x: number; y: number },
  waypoint: { x: number; y: number } | null,
  breadcrumbs: { x: number; y: number }[],
  tick: number,
) {
  ctx.clearRect(0, 0, CW, CH)

  // Background
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, CW, CH)

  // Grid
  ctx.fillStyle = '#1c1c1c'
  for (let x = 0; x < CW; x += 30) {
    for (let y = 0; y < CH; y += 30) {
      ctx.fillRect(x, y, 1, 1)
    }
  }

  // Floor
  ctx.fillStyle = '#151515'
  ctx.fillRect(81, 51, 738, 398)

  // Walls
  ctx.strokeStyle = '#6b1515'
  ctx.lineWidth = 2
  ctx.lineCap = 'square'
  for (const [x1, y1, x2, y2] of WALLS) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  }

  // Breadcrumbs
  for (let i = 0; i < breadcrumbs.length; i++) {
    const alpha = (i / breadcrumbs.length) * 0.5
    ctx.fillStyle = `rgba(255,49,49,${alpha})`
    ctx.beginPath(); ctx.arc(breadcrumbs[i].x, breadcrumbs[i].y, 2, 0, Math.PI * 2); ctx.fill()
  }

  // Waypoint
  if (waypoint) {
    const pulse = 0.6 + 0.4 * Math.sin(tick * 0.1)
    const s = 14
    ctx.strokeStyle = `rgba(255,49,49,${pulse})`
    ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(waypoint.x - s, waypoint.y); ctx.lineTo(waypoint.x + s, waypoint.y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(waypoint.x, waypoint.y - s); ctx.lineTo(waypoint.x, waypoint.y + s); ctx.stroke()
    ctx.beginPath(); ctx.arc(waypoint.x, waypoint.y, 6, 0, Math.PI * 2); ctx.stroke()
    // line from FF to waypoint
    ctx.strokeStyle = `rgba(255,49,49,0.15)`
    ctx.lineWidth = 1
    ctx.setLineDash([8, 8])
    ctx.beginPath(); ctx.moveTo(ffPos.x, ffPos.y); ctx.lineTo(waypoint.x, waypoint.y); ctx.stroke()
    ctx.setLineDash([])
  }

  // FF dot
  const glow = 0.7 + 0.3 * Math.sin(tick * 0.06)
  ctx.shadowColor = '#ff3131'
  ctx.shadowBlur = 14 * glow
  ctx.fillStyle = '#ff3131'
  ctx.beginPath(); ctx.arc(ffPos.x, ffPos.y, 8, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,49,49,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(ffPos.x, ffPos.y, 14, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 10px "Space Mono", monospace'
  ctx.textAlign = 'left'
  ctx.fillText('YOU', ffPos.x + 16, ffPos.y + 4)
}

// ─── Arrow SVG ────────────────────────────────────────────────────────
function DirectionArrow({ angle }: { angle: number }) {
  return (
    <svg viewBox="0 0 100 140" style={{
      width: '72px', height: '100px',
      transform: `rotate(${angle}deg)`,
      transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      filter: 'drop-shadow(0 0 12px rgba(255,49,49,0.8))',
      animation: 'arrow-pulse 2s ease-in-out infinite',
      flexShrink: 0,
    }}>
      <rect x="42" y="60" width="16" height="70" fill="#ff3131" rx="3" />
      <polygon points="50,0 100,70 72,60 28,60 0,70" fill="#ff3131" />
    </svg>
  )
}

// ─── Camera placeholder ───────────────────────────────────────────────
// TODO: Replace with <img src={`http://${ROS_HOST}:8080/stream?topic=/ff1/odin1/image/compressed`} />
function CamThumb() {
  return (
    <div style={{
      width: '64px', height: '48px',
      background: '#0a0a0a',
      border: '1px solid #1a1a1a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: '2px', flexShrink: 0, position: 'relative',
      overflow: 'hidden',
    }}>
      {/* scanlines */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)',
        pointerEvents: 'none',
      }} />
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none" style={{ opacity: 0.3 }}>
        <rect x="0" y="2" width="11" height="8" rx="1" stroke="#ff3131" strokeWidth="1.2" />
        <polygon points="11,4 16,1 16,11 11,8" fill="#ff3131" opacity="0.5" />
      </svg>
      <span className="font-mono" style={{ fontSize: '6px', color: '#c03030', letterSpacing: '0.1em' }}>
        /ff1/image
      </span>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────
interface Msg { id: number; from: string; message: string; timestamp: string }

export default function FirefighterPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const [ffPos, setFfPos] = useState({ x: 435, y: 400 })
  const [waypoint, setWaypoint] = useState<{ x: number; y: number } | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<{ x: number; y: number }[]>([])
  const [status, setStatus] = useState<StatusType>('OK')
  const [radioLog, setRadioLog] = useState<Msg[]>([])
  const [transmitting, setTransmitting] = useState(false)
  const [lastMsg, setLastMsg] = useState('')
  const [tick, setTick] = useState(0)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ffPosRef = useRef(ffPos)

  // ── Speech-to-Text refs ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')
  const [interimText, setInterimText] = useState('')
  const [finalTranscriptText, setFinalTranscriptText] = useState('')

  useEffect(() => {
    ffPosRef.current = ffPos
  }, [ffPos])

  // Tick for animations
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 80)
    return () => clearInterval(id)
  }, [])

  // Poll state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/state')
        const data = await res.json()
        setWaypoint(data.waypoint)
        setFfPos(data.firefighterPosition)
        setBreadcrumbs(data.breadcrumbs ?? [])
        setStatus(data.firefighterStatus)
        setRadioLog(data.radioLog ?? [])
      } catch { /* ignore */ }
    }
    poll()
    const id = setInterval(poll, 300)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll radio log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [radioLog.length])

  // Draw mini-map
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawMiniMap(ctx, ffPos, waypoint, breadcrumbs, tick)
  }, [ffPos, waypoint, breadcrumbs, tick])

  // Keyboard movement
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
        const newPos = {
          x: Math.max(BOUNDS.xMin, Math.min(BOUNDS.xMax, cur.x + dx)),
          y: Math.max(BOUNDS.yMin, Math.min(BOUNDS.yMax, cur.y + dy)),
        }
        setFfPos(newPos)
        fetch('/api/state', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'firefighter_position_update', position: newPos }),
        }).catch(() => { })
      }
    }
    const onKeyUp = (e: KeyboardEvent) => pressed.delete(e.key)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [])

  // Status cycle
  const cycleStatus = useCallback(async () => {
    const next = STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]
    setStatus(next)
    await fetch('/api/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'firefighter_status_update', status: next }),
    })
  }, [status])

  // ── Real Speech-to-Text for Hold-to-Transmit ──
  const startHold = useCallback(() => {
    setTransmitting(true)
    setInterimText('')
    finalTranscriptRef.current = ''
    setFinalTranscriptText('')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      // Fallback: just show transmitting indicator
      holdTimer.current = setTimeout(() => {
        setLastMsg('TRANSMITTING...')
      }, 200)
      return
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = ''
      let final = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          final += result[0].transcript
        } else {
          interim += result[0].transcript
        }
      }
      finalTranscriptRef.current = final
      setFinalTranscriptText(final)
      setInterimText(interim)
      setLastMsg(final + interim || 'LISTENING...')
    }

    recognition.onerror = () => {
      setTransmitting(false)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [])

  const endHold = useCallback(async () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)

    // Stop recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    if (!transmitting) return
    setTransmitting(false)

    // Wait for final results
    await new Promise(r => setTimeout(r, 300))

    const transcript = (finalTranscriptRef.current || interimText).trim()
    setInterimText('')
    setFinalTranscriptText('')

    if (transcript && transcript !== 'LISTENING...' && transcript !== 'TRANSMITTING...') {
      setLastMsg(transcript)
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'firefighter_voice_message', message: `[VOICE] ${transcript}` }),
      })
    } else {
      setLastMsg('')
    }

    setTimeout(() => setLastMsg(''), 4000)
  }, [transmitting, interimText])

  // Arrow angle + distance
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
      width: '100vw', height: '100dvh', background: '#0d0d0d',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      userSelect: 'none', WebkitUserSelect: 'none',
    }}>

      {/* ── Header ── */}
      <div style={{
        height: '48px', borderBottom: '1px solid #2a2a2a', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', gap: '10px',
      }}>
        {/* Left: cam + unit ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CamThumb />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '7px', height: '7px', borderRadius: '50%',
                background: '#ff3131', boxShadow: '0 0 6px #ff3131',
                animation: 'pulse-dot 2s infinite', flexShrink: 0,
              }} />
              <span className="font-display" style={{ fontSize: '15px', fontWeight: 900, color: '#fff', letterSpacing: '0.08em' }}>
                FF1
              </span>
            </div>
            <div className="font-mono" style={{ fontSize: '8px', color: '#c03030', letterSpacing: '0.12em' }}>
              NIGEL // ACTIVE
            </div>
          </div>
        </div>

        {/* Right: status pill + home */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            padding: '3px 10px', border: `1px solid ${statusColor(status)}`,
            display: 'flex', alignItems: 'center', gap: '5px',
          }}>
            <div style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: statusColor(status),
            }} />
            <span className="font-mono" style={{ fontSize: '9px', color: statusColor(status), letterSpacing: '0.1em' }}>
              {status.toUpperCase()}
            </span>
          </div>
          <Link href="/" className="font-mono" style={{ fontSize: '9px', color: '#555', textDecoration: 'none' }}>
            ←
          </Link>
        </div>
      </div>

      {/* ── Need Help banner ── */}
      {isNeedHelp && (
        <div style={{
          flexShrink: 0, padding: '6px', textAlign: 'center',
          animation: 'need-help-flash 0.5s infinite',
        }}>
          <span className="font-display" style={{ fontSize: '11px', fontWeight: 900, color: '#fff', letterSpacing: '0.3em' }}>
            ⚠ NEED HELP ⚠
          </span>
        </div>
      )}

      {/* ── Mini-map ── */}
      <div style={{ flex: 4, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {/* On-target overlay */}
        {onTarget && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <span className="font-display" style={{
              fontSize: '32px', fontWeight: 900, color: '#ff3131',
              letterSpacing: '0.2em', textShadow: '0 0 24px rgba(255,49,49,0.9)',
              animation: 'pulse-dot 0.8s infinite',
            }}>ON TARGET</span>
          </div>
        )}
        {/* Map label */}
        <div style={{
          position: 'absolute', top: '8px', right: '10px',
          display: 'flex', alignItems: 'center', gap: '4px',
        }}>
          <span className="font-mono" style={{ fontSize: '8px', color: '#555', letterSpacing: '0.1em' }}>
            FLOOR MAP
          </span>
        </div>
      </div>

      {/* ── Direction strip ── */}
      <div style={{
        flex: 2, borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #2a2a2a',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '20px', padding: '0 20px', minHeight: 0, overflow: 'hidden',
        background: '#0f0f0f',
      }}>
        {waypoint && !onTarget ? (
          <>
            <DirectionArrow angle={angle} />
            <div>
              <div className="font-mono" style={{
                fontSize: '36px', fontWeight: 700, color: '#fff',
                letterSpacing: '0.03em', lineHeight: 1,
              }}>
                {dist}<span style={{ fontSize: '16px', color: '#666', marginLeft: '3px' }}>m</span>
              </div>
              <div className="font-mono" style={{ fontSize: '9px', color: '#777', letterSpacing: '0.15em', marginTop: '2px' }}>
                TO TARGET
              </div>
              {lastMsg && (
                <div className="font-mono anim-in" style={{
                  fontSize: '9px', color: '#ff3131', marginTop: '6px',
                  maxWidth: '160px', lineHeight: 1.4,
                }}>
                  {lastMsg}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            {lastMsg ? (
              <div className="font-mono anim-in" style={{ fontSize: '10px', color: '#ff3131', letterSpacing: '0.05em' }}>
                {lastMsg}
              </div>
            ) : (
              <div className="font-mono" style={{ fontSize: '10px', color: '#555', letterSpacing: '0.2em' }}>
                {onTarget ? 'ON TARGET' : 'STANDBY — AWAITING WAYPOINT'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Radio log ── */}
      <div
        ref={logRef}
        style={{
          flex: 1.5, overflowY: 'auto', minHeight: 0,
          borderBottom: '1px solid #2a2a2a',
          padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: '3px',
          background: '#0d0d0d',
        }}
      >
        {radioLog.slice(-20).map(msg => (
          <div key={msg.id} style={{ flexShrink: 0 }}>
            <span className="font-mono" style={{ fontSize: '8px', color: '#2a2a2a' }}>{msg.timestamp} </span>
            <span className="font-mono" style={{ fontSize: '9px', fontWeight: 700, color: fromColor(msg.from) }}>
              [{msg.from}]
            </span>
            {' '}
            <span className="font-mono" style={{ fontSize: '9px', color: '#777' }}>{msg.message}</span>
          </div>
        ))}
        {radioLog.length === 0 && (
          <div className="font-mono" style={{ fontSize: '8px', color: '#1a1a1a', letterSpacing: '0.15em' }}>
            NO RADIO TRAFFIC
          </div>
        )}
      </div>

      {/* ── Bottom controls ── */}
      <div style={{
        flexShrink: 0, height: '88px',
        display: 'flex',
      }}>
        {/* Status */}
        <button
          onClick={cycleStatus}
          style={{
            flex: 1, background: isNeedHelp ? 'transparent' : '#141414',
            border: 'none', borderRight: '1px solid #2a2a2a',
            cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '5px',
            animation: isNeedHelp ? 'need-help-flash 0.5s infinite' : 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onTouchStart={() => { }}
        >
          <div style={{
            width: '16px', height: '16px', borderRadius: '50%',
            background: statusColor(status), boxShadow: `0 0 10px ${statusColor(status)}`,
          }} />
          <div className="font-display" style={{ fontSize: '12px', fontWeight: 700, color: statusColor(status), letterSpacing: '0.08em' }}>
            {status.toUpperCase()}
          </div>
          <div className="font-mono" style={{ fontSize: '7px', color: '#666', letterSpacing: '0.08em' }}>TAP TO CHANGE</div>
        </button>

        {/* Transmit */}
        <button
          onMouseDown={startHold}
          onMouseUp={endHold}
          onMouseLeave={endHold}
          onTouchStart={e => { e.preventDefault(); startHold() }}
          onTouchEnd={e => { e.preventDefault(); endHold() }}
          style={{
            flex: 1, background: transmitting ? '#2a0000' : '#141414',
            border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '5px',
            transition: 'background 0.1s', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="30" viewBox="0 0 32 40" fill="none">
            <rect x="10" y="0" width="12" height="22" rx="6" fill={transmitting ? '#ff3131' : '#555'} style={{ transition: 'fill 0.1s' }} />
            <path d="M5 18 Q5 30 16 30 Q27 30 27 18" stroke={transmitting ? '#ff3131' : '#555'} strokeWidth="2" fill="none" style={{ transition: 'stroke 0.1s' }} />
            <line x1="16" y1="30" x2="16" y2="38" stroke={transmitting ? '#ff3131' : '#555'} strokeWidth="2" style={{ transition: 'stroke 0.1s' }} />
            <line x1="10" y1="38" x2="22" y2="38" stroke={transmitting ? '#ff3131' : '#555'} strokeWidth="2" style={{ transition: 'stroke 0.1s' }} />
          </svg>
          <div className="font-display" style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em',
            color: transmitting ? '#ff3131' : '#888', transition: 'color 0.1s',
          }}>
            {transmitting ? 'TX' : 'TRANSMIT'}
          </div>
          <div className="font-mono" style={{ fontSize: '7px', color: '#666', letterSpacing: '0.08em' }}>HOLD TO TALK</div>
          {transmitting && (interimText || finalTranscriptText) && (
            <div className="font-mono" style={{
              fontSize: '8px', color: '#ff3131', maxWidth: '140px',
              textAlign: 'center', marginTop: '4px',
              fontStyle: 'italic', opacity: 0.8,
            }}>
              {finalTranscriptText}{interimText}
            </div>
          )}
        </button>
      </div>
    </div>
  )
}
