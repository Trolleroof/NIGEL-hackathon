'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import ThreeScene from '@/components/three-scene'
import type { OdometryData } from '@/lib/websocket-manager'

const STATUSES = ['OK', 'Searching', 'Victim Found', 'Need Help'] as const
type StatusType = typeof STATUSES[number]
const METERS_TO_FEET = 3.28084
const TARGET_RADIUS_FEET = 5

function statusColor(s: StatusType) {
  if (s === 'OK') return '#22c55e'
  if (s === 'Searching') return '#eab308'
  if (s === 'Victim Found') return '#f97316'
  return '#ff3131'
}

function fromColor(from: string) {
  if (from === 'DISPATCH') return '#ff3131'
  if (from === 'NIGEL') return '#00bfff'
  if (from === 'SYSTEM') return '#444'
  return '#a0a0a0'
}

function fireAgent(trigger: 'radio_message' | 'heartbeat' | 'status_change', message?: string, newStatus?: string) {
  fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger, message, newStatus }),
  }).catch(() => {})
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
interface Msg { id: number; from: string; message: string; timestamp: string; shouldSpeak?: boolean }

export default function FirefighterPage() {
  const logRef = useRef<HTMLDivElement>(null)
  const [ffPos, setFfPos] = useState({ x: 435, y: 400 })
  const [waypoint, setWaypoint] = useState<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState<StatusType>('OK')
  const [radioLog, setRadioLog] = useState<Msg[]>([])
  const [transmitting, setTransmitting] = useState(false)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPositionPostAtRef = useRef(0)
  const lastPostedPosRef = useRef<{ x: number; y: number } | null>(null)

  // ── Speech-to-Text refs ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')
  const [interimText, setInterimText] = useState('')

  // Poll state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/state')
        const data = await res.json()
        setWaypoint(data.waypoint)
        setFfPos(data.firefighterPosition)
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

  // ── TTS for NIGEL messages (ElevenLabs, fallback to browser) ──
  const lastSpokenIdRef = useRef(0)
  useEffect(() => {
    if (!radioLog.length) return
    const newNigelMessages = radioLog.filter(
      msg => msg.from === 'NIGEL' && msg.id > lastSpokenIdRef.current && msg.shouldSpeak !== false
    )
    void (async () => {
      for (const msg of newNigelMessages) {
        lastSpokenIdRef.current = msg.id
        const { speakText } = await import('@/lib/tts')
        await speakText(msg.message)
      }
    })()
  }, [radioLog])

  // Status cycle
  const cycleStatus = useCallback(async () => {
    const next = STATUSES[(STATUSES.indexOf(status) + 1) % STATUSES.length]
    setStatus(next)
    await fetch('/api/state', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'firefighter_status_update', status: next }),
    })
    fireAgent('status_change', undefined, next)
  }, [status])

  // ── Real Speech-to-Text for Hold-to-Transmit ──
  const startHold = useCallback(() => {
    setTransmitting(true)
    setInterimText('')
    finalTranscriptRef.current = ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      // Fallback: just show transmitting indicator
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
      setInterimText(interim)
    }

    recognition.onerror = (event: { error?: string }) => {
      setTransmitting(false)
      const isSecureContext = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
      if (!isSecureContext && event.error === 'not-allowed') {
        console.warn('[Speech] Microphone access requires HTTPS. Use https:// instead of http://')
      }
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

    if (transcript && transcript !== 'LISTENING...' && transcript !== 'TRANSMITTING...') {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'firefighter_voice_message', message: `[VOICE] ${transcript}` }),
      })
      fireAgent('radio_message', transcript)
    }
  }, [transmitting, interimText])

  const handleOdometry = useCallback((odom: OdometryData) => {
    // ODOM is metres in ROS space (x, y, z); UI map uses x,z plane.
    const currentPos = { x: odom.x, y: odom.z }
    setFfPos(currentPos)

    const now = Date.now()
    const last = lastPostedPosRef.current
    const movedEnough = !last || Math.hypot(currentPos.x - last.x, currentPos.y - last.y) >= 0.1
    const due = now - lastPositionPostAtRef.current >= 250
    if (!movedEnough || !due) return

    lastPositionPostAtRef.current = now
    lastPostedPosRef.current = currentPos

    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'firefighter_position_update', position: currentPos }),
    }).catch(() => { })
  }, [])

  // Arrow angle + distance
  const angle = waypoint
    ? Math.atan2(waypoint.y - ffPos.y, waypoint.x - ffPos.x) * (180 / Math.PI) + 90
    : 0
  const distFeet = waypoint
    ? Math.hypot(waypoint.x - ffPos.x, waypoint.y - ffPos.y) * METERS_TO_FEET
    : null
  const distFeetLabel = distFeet !== null ? distFeet.toFixed(1) : null
  const onTarget = waypoint !== null && distFeet !== null && distFeet <= TARGET_RADIUS_FEET
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

      {/* ── Map ── */}
      <div style={{ flex: 4, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
        <ThreeScene showOverlay={false} waypoint={waypoint} onOdometry={handleOdometry} />
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
        {/* FF position indicator */}
        <div style={{
          position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: '6px',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: '#ff3131', boxShadow: '0 0 10px #ff3131',
            animation: 'pulse-dot 1.5s infinite',
          }} />
          <span className="font-mono" style={{ fontSize: '9px', color: '#ff3131', letterSpacing: '0.1em' }}>
            YOU — ({Math.round(ffPos.x)}, {Math.round(ffPos.y)})
          </span>
        </div>
        {/* Map label */}
        
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
                {distFeetLabel}<span style={{ fontSize: '16px', color: '#666', marginLeft: '3px' }}>ft</span>
              </div>
              <div className="font-mono" style={{ fontSize: '9px', color: '#777', letterSpacing: '0.15em', marginTop: '2px' }}>
                TO TARGET
              </div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div className="font-mono" style={{ fontSize: '10px', color: '#555', letterSpacing: '0.2em' }}>
              {onTarget ? 'ON TARGET' : 'STANDBY — AWAITING WAYPOINT'}
            </div>
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
        </button>
      </div>
    </div>
  )
}
