'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import ThreeScene from '@/components/three-scene'

// ─── Canvas constants ───────────────────────────────────────────────
const CW = 900
const CH = 500
const RIGHT_PANEL_WIDTH = 240
const MIN_LEFT_PANEL_WIDTH = 280
const MIN_CENTER_PANEL_WIDTH = 460

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

type FeedKind = 'video' | 'live'

interface CameraFeed {
  id: string
  label: string
  kind: FeedKind
  src?: string
  note?: string
}

// Ordered row-major (2 columns x 3 rows). Slot 4 is row 2 / col 2.
const CAMERA_FEEDS: CameraFeed[] = [
  { id: 'FF1', label: 'UNIT FF1', kind: 'video', src: '/api/feeds/videoplayback.mp4' },
  { id: 'FF2', label: 'UNIT FF2', kind: 'video', src: '/api/feeds/vid2.mp4' },
  { id: 'FF3', label: 'UNIT FF3', kind: 'video', src: '/api/feeds/vid3.mp4' },
  { id: 'FF4', label: 'RAW CAM', kind: 'live', note: 'LIVE INPUT' },
  { id: 'FF5', label: 'UNIT FF5', kind: 'video', src: '/api/feeds/vid4.mp4' },
  { id: 'FF6', label: 'UNIT FF6', kind: 'video', src: '/api/feeds/vid5.mp4' },
]

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
  // Transparent clear — background is owned by Three.js
  ctx.clearRect(0, 0, CW, CH)

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
  const [expandedFeedId, setExpandedFeedId] = useState<string | null>(null)
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null)
  const [liveFeedError, setLiveFeedError] = useState<string | null>(null)
  const [isCompactLayout, setIsCompactLayout] = useState(false)
  const [leftPanelWidth, setLeftPanelWidth] = useState(310)
  const [isResizingFeeds, setIsResizingFeeds] = useState(false)
  const startRef = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const expandedFeed = CAMERA_FEEDS.find(feed => feed.id === expandedFeedId) ?? null

  const clampLeftPanelWidth = useCallback((nextWidth: number) => {
    if (typeof window === 'undefined') return nextWidth
    const maxWidth = Math.max(
      MIN_LEFT_PANEL_WIDTH,
      window.innerWidth - RIGHT_PANEL_WIDTH - MIN_CENTER_PANEL_WIDTH - 36,
    )
    return Math.min(Math.max(nextWidth, MIN_LEFT_PANEL_WIDTH), maxWidth)
  }, [])

  // ── Speech-to-Text state ──
  const [isRecording, setIsRecording] = useState(false)
  const [interimText, setInterimText] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const finalTranscriptRef = useRef('')

  // Clock + tick
  useEffect(() => {
    startRef.current = Date.now()
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

  useEffect(() => {
    let mounted = true
    let stream: MediaStream | null = null

    const initCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setLiveFeedError('CAMERA API UNAVAILABLE')
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })

        if (!mounted) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        setLiveStream(stream)
        setLiveFeedError(null)
      } catch {
        setLiveFeedError('CAMERA ACCESS BLOCKED')
      }
    }

    initCamera()

    return () => {
      mounted = false
      if (stream) stream.getTracks().forEach(track => track.stop())
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      setIsCompactLayout(window.innerWidth < 1180)
      setLeftPanelWidth(prev => clampLeftPanelWidth(prev))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampLeftPanelWidth])

  const startResizingFeeds = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (isCompactLayout) return
    resizeStartRef.current = { x: e.clientX, width: leftPanelWidth }
    setIsResizingFeeds(true)
    e.preventDefault()
  }, [isCompactLayout, leftPanelWidth])

  useEffect(() => {
    if (!isResizingFeeds) return

    const onMouseMove = (e: MouseEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const resized = start.width + (e.clientX - start.x)
      setLeftPanelWidth(clampLeftPanelWidth(resized))
    }

    const onMouseUp = () => {
      setIsResizingFeeds(false)
      resizeStartRef.current = null
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingFeeds, clampLeftPanelWidth])

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

  // ── Speech Recognition helpers ──
  const startRecording = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SpeechRecognitionAPI = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) {
      console.error('SpeechRecognition not supported in this browser')
      return
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    finalTranscriptRef.current = ''
    setInterimText('')

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

    recognition.onerror = () => {
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }, [])

  const stopRecording = useCallback(async () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    setIsRecording(false)

    // Wait a moment to let final results settle
    await new Promise(r => setTimeout(r, 300))

    const transcript = (finalTranscriptRef.current || interimText).trim()
    setInterimText('')

    if (transcript) {
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'dispatcher_voice_message', message: transcript }),
      })
    }
  }, [interimText])

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
        height: isCompactLayout ? 'auto' : '40px',
        borderBottom: '1px solid #1a1a1a',
        display: 'flex',
        alignItems: isCompactLayout ? 'stretch' : 'center',
        justifyContent: 'space-between',
        flexDirection: isCompactLayout ? 'column' : 'row',
        gap: isCompactLayout ? '8px' : 0,
        padding: isCompactLayout ? '8px 10px' : '0 16px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', width: isCompactLayout ? '100%' : 'auto' }}>
          <span className="font-display" style={{
            fontSize: '13px', fontWeight: 900, color: '#fff', letterSpacing: '0.12em',
          }}>
            FIRE<span style={{ color: '#ff3131' }}>COMMAND</span>
          </span>
          <span className="font-mono" style={{ fontSize: '9px', color: '#4d1010', letterSpacing: '0.2em' }}>
            DISPATCHER
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <Stat label="TIME" value={time || '00:00:00'} />
            <Stat label="ELAPSED" value={fmtElapsed(elapsed)} accent />
            <Stat label="FF1" value={state.firefighterStatus}
              valueColor={statusColor(state.firefighterStatus)} />
          </div>

          <Link href="/" className="font-mono" style={{
            fontSize: '9px', color: '#333', textDecoration: 'none', letterSpacing: '0.1em',
          }}>← HOME</Link>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: isCompactLayout ? '1fr' : `${leftPanelWidth}px 1fr ${RIGHT_PANEL_WIDTH}px`,
        gridTemplateRows: isCompactLayout ? 'minmax(330px, 42vh) minmax(280px, 36vh) minmax(220px, 1fr)' : '1fr',
        gap: '8px',
        padding: '8px',
        overflow: isCompactLayout ? 'auto' : 'hidden',
      }}>

        {/* Left: Camera Grid */}
        <div style={{ position: 'relative', minHeight: 0 }}>
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%' }}>
            <div className="panel-header">MULTI-UNIT VIEWPORTS</div>
            <div style={{
              padding: '10px',
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
              gap: '8px',
              minHeight: 0,
            }}>
              {CAMERA_FEEDS.map(feed => (
                <FeedTile
                  key={feed.id}
                  feed={feed}
                  liveStream={liveStream}
                  liveFeedError={liveFeedError}
                  isExpanded={expandedFeedId === feed.id}
                  statusText={feed.id === 'FF1' ? state.firefighterStatus : undefined}
                  onToggleExpand={setExpandedFeedId}
                />
              ))}
            </div>
            <div style={{ padding: '10px', borderTop: '1px solid #1a1a1a' }}>
              <div className="font-mono" style={{ fontSize: '8px', color: '#2a2a2a', textAlign: 'center', letterSpacing: '0.1em' }}>
                ROW 2 / COL 2 IS THE LIVE RAW CAMERA FEED
              </div>
            </div>
          </div>

          {!isCompactLayout && (
            <button
              type="button"
              aria-label="Resize camera feed panel"
              onMouseDown={startResizingFeeds}
              style={{
                position: 'absolute',
                top: '8px',
                bottom: '8px',
                right: '-10px',
                width: '12px',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'col-resize',
                zIndex: 8,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: '5px',
                width: '2px',
                background: isResizingFeeds ? '#ff3131' : '#1a1a1a',
                boxShadow: isResizingFeeds ? '0 0 8px rgba(255,49,49,0.8)' : 'none',
              }} />
            </button>
          )}
        </div>

        {/* Center: Map
          ─────────────────────────────────────────────────────────────────
          TODO: THREE.JS INTEGRATION
          Replace the ThreeJsPlaceholder div below with your Three.js canvas.

          Expected ROS topics (via ROSbridge ws://ROS_HOST:9090):
            Point cloud : /odin1/cloud_slam   (sensor_msgs/PointCloud2)
            FF position : /odin1/odometry     (nav_msgs/Odometry)
            Path trail  : /odin1/path         (nav_msgs/Path)
            Floor plan  : /slam_cloud_accumulator/map (sensor_msgs/PointCloud2)

          The waypoint overlay canvas MUST remain on top (z-index: 1) so
          dispatcher click-to-waypoint keeps working after you swap in Three.js.
          Set your Three.js renderer's domElement to position:absolute, inset:0.
          ─────────────────────────────────────────────────────────────────
        */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <span>3D MAP // LOCATION</span>
            <span className="font-mono" style={{ fontSize: '8px', color: '#4d4d4d' }}>
              {state.waypoint
                ? `WPT: (${Math.round(state.waypoint.x)}, ${Math.round(state.waypoint.y)})`
                : 'NO WAYPOINT'}
            </span>
          </div>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

            {/* ── THREE.JS SCENE ─────────────────────────────────────────
                Three.js scene for real-time point cloud visualization
            ─────────────────────────────────────────────────────────── */}
            <ThreeScene />

            {/* ── WAYPOINT OVERLAY ─────────────────────────────────────
                This canvas stays on top. Do not remove it.
                It handles click-to-waypoint and draws the FF dot + trail
                until those are owned by the Three.js scene.
            ─────────────────────────────────────────────────────────── */}
            <canvas
              ref={canvasRef}
              width={CW}
              height={CH}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                cursor: 'crosshair', display: 'block',
                zIndex: 1,
                background: 'transparent',
              }}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMove}
              onMouseLeave={() => setWaypointPreview(null)}
            />
          </div>
        </div>

        {/* Right: Radio Log */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <div className="panel-header" style={{ justifyContent: 'space-between' }}>
            <span>RADIO LOG</span>
            {/* ── Mic Button ── */}
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={() => { if (isRecording) stopRecording() }}
              className="font-mono"
              style={{
                background: isRecording ? '#2a0000' : 'transparent',
                border: `1px solid ${isRecording ? '#ff3131' : '#2a2a2a'}`,
                borderRadius: '3px',
                color: isRecording ? '#ff3131' : '#666',
                fontSize: '8px',
                padding: '3px 8px',
                cursor: 'pointer',
                letterSpacing: '0.1em',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                boxShadow: isRecording ? '0 0 8px rgba(255,49,49,0.4)' : 'none',
              }}
            >
              <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                <rect x="3" y="0" width="4" height="7" rx="2"
                  fill={isRecording ? '#ff3131' : '#666'}
                  style={{ transition: 'fill 0.15s' }}
                />
                <path d="M1 6 Q1 10 5 10 Q9 10 9 6"
                  stroke={isRecording ? '#ff3131' : '#666'}
                  strokeWidth="1" fill="none"
                  style={{ transition: 'stroke 0.15s' }}
                />
                <line x1="5" y1="10" x2="5" y2="13"
                  stroke={isRecording ? '#ff3131' : '#666'}
                  strokeWidth="1"
                  style={{ transition: 'stroke 0.15s' }}
                />
              </svg>
              {isRecording ? 'LIVE' : 'HOLD'}
            </button>
          </div>

          {/* Interim transcript preview */}
          {isRecording && (
            <div style={{
              padding: '6px 8px',
              borderBottom: '1px solid #1a1a1a',
              background: '#0a0000',
            }}>
              <div className="font-mono" style={{
                fontSize: '8px', color: '#ff3131', letterSpacing: '0.1em',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <span style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: '#ff3131',
                  animation: 'pulse-dot 1s infinite',
                  flexShrink: 0,
                }} />
                TRANSMITTING
              </div>
              {(interimText || finalTranscriptRef.current) && (
                <div className="font-mono" style={{
                  fontSize: '9px', color: '#c0c0c0', marginTop: '4px',
                  fontStyle: 'italic',
                }}>
                  {finalTranscriptRef.current}{interimText}
                </div>
              )}
            </div>
          )}


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

      {expandedFeed && (
        <div
          onClick={() => setExpandedFeedId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.84)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            className="panel"
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(1100px, 94vw)',
              height: 'min(760px, 88vh)',
              padding: '14px',
              background: '#040404',
            }}
          >
            <FeedTile
              feed={expandedFeed}
              liveStream={liveStream}
              liveFeedError={liveFeedError}
              isExpanded
              statusText={expandedFeed.id === 'FF1' ? state.firefighterStatus : undefined}
              onToggleExpand={() => setExpandedFeedId(null)}
              lightbox
            />
          </div>
        </div>
      )}
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
          ; (e.currentTarget as HTMLButtonElement).style.color = '#ff3131'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = dim ? '#1a1a1a' : '#2a2a2a'
          ; (e.currentTarget as HTMLButtonElement).style.color = dim ? '#333' : '#a0a0a0'
      }}
    >
      {label}
    </button>
  )
}

function FeedTile({
  feed,
  liveStream,
  liveFeedError,
  isExpanded,
  statusText,
  onToggleExpand,
  lightbox,
}: {
  feed: CameraFeed
  liveStream: MediaStream | null
  liveFeedError: string | null
  isExpanded: boolean
  statusText?: string
  onToggleExpand: (id: string | null) => void
  lightbox?: boolean
}) {
  return (
    <div style={{
      border: '1px solid #1a1a1a',
      background: '#030303',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 7px',
        borderBottom: '1px solid #1a1a1a',
      }}>
        <span className="font-display" style={{
          fontSize: lightbox ? '11px' : '9px',
          color: '#fff',
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {feed.label}
        </span>
        <button
          className="font-mono"
          onClick={() => onToggleExpand(isExpanded ? null : feed.id)}
          style={{
            border: '1px solid #2a2a2a',
            background: 'none',
            color: '#a0a0a0',
            fontSize: lightbox ? '8px' : '7px',
            cursor: 'pointer',
            letterSpacing: '0.08em',
            padding: lightbox ? '5px 8px' : '3px 5px',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          {isExpanded ? 'SHRINK' : 'EXPAND'}
        </button>
      </div>

      <div className="scanlines" style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000' }}>
        <FeedViewport feed={feed} liveStream={liveStream} liveFeedError={liveFeedError} />
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTop: '1px solid #1a1a1a',
        padding: lightbox ? '6px 8px' : '4px 6px',
      }}>
        <span className="font-mono" style={{
          fontSize: lightbox ? '8px' : '7px',
          color: feed.kind === 'live' ? '#ff3131' : '#666',
          letterSpacing: '0.08em',
        }}>
          {feed.kind === 'live' ? (liveStream ? 'LIVE INPUT' : 'NO SIGNAL') : 'SIMULATED LIVE FEED'}
        </span>
        {statusText && (
          <span className="font-mono" style={{
            fontSize: lightbox ? '8px' : '7px',
            color: statusColor(statusText),
            letterSpacing: '0.08em',
          }}>
            {statusText.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  )
}

function FeedViewport({
  feed,
  liveStream,
  liveFeedError,
}: {
  feed: CameraFeed
  liveStream: MediaStream | null
  liveFeedError: string | null
}) {
  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const replayVideoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = liveVideoRef.current
    if (!el || feed.kind !== 'live') return
    if (liveStream) {
      el.srcObject = liveStream
      void el.play().catch(() => { })
      return
    }
    el.srcObject = null
  }, [feed.kind, liveStream])

  useEffect(() => {
    const el = replayVideoRef.current
    if (!el || feed.kind !== 'video') return
    el.muted = true
    el.defaultMuted = true
    el.volume = 0
    void el.play().catch(() => { })
  }, [feed.kind, feed.src])

  if (feed.kind === 'live') {
    return (
      <>
        <video
          ref={liveVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {!liveStream && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0,0,0,0.7)',
            padding: '8px',
          }}>
            <span className="font-mono" style={{
              color: '#666',
              fontSize: '8px',
              letterSpacing: '0.12em',
              textAlign: 'center',
              lineHeight: 1.6,
            }}>
              {liveFeedError ?? 'INITIALIZING CAMERA'}
            </span>
          </div>
        )}
      </>
    )
  }

  return (
    <video
      ref={replayVideoRef}
      src={feed.src}
      autoPlay
      muted
      loop
      playsInline
      disablePictureInPicture
      controlsList="nodownload noplaybackrate noremoteplayback"
      controls={false}
      tabIndex={-1}
      onContextMenu={e => e.preventDefault()}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  )
}
