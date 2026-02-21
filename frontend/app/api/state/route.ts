import { NextResponse } from 'next/server'

interface Position { x: number; y: number }
interface RadioMessage { id: number; from: string; message: string; timestamp: string; severity?: 'normal' | 'warning' | 'critical' }
interface Hazard { id: string; position: Position; type: 'fire' | 'smoke' | 'collapse' | 'chemical' | 'other'; label: string; active: boolean }
interface Task { id: string; description: string; priority: 'low' | 'medium' | 'high'; completed: boolean; createdAt: string }
interface Alert { id: string; message: string; level: 'info' | 'warning' | 'critical'; acknowledged: boolean; createdAt: string }

interface NigelState {
  firefighterPosition: Position
  waypoint: Position | null
  radioLog: RadioMessage[]
  firefighterStatus: string
  breadcrumbs: Position[]
  hazards: Hazard[]
  tasks: Task[]
  alerts: Alert[]
  airSupply: number
  roomsCleared: string[]
  missionStartTime: string
  agentProcessing: boolean
}

declare global {
  var _nigelState: NigelState | undefined
}

function ts() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function initState(): NigelState {
  return {
    firefighterPosition: { x: 435, y: 400 },
    waypoint: null,
    radioLog: [
      { id: 1, from: 'SYSTEM', message: 'System online. All systems nominal.', timestamp: ts() },
      { id: 2, from: 'DISPATCH', message: 'FF1 awaiting deployment.', timestamp: ts() },
    ],
    firefighterStatus: 'OK',
    breadcrumbs: [],
    hazards: [],
    tasks: [],
    alerts: [],
    airSupply: 100,
    roomsCleared: [],
    missionStartTime: new Date().toISOString(),
    agentProcessing: false,
  }
}

if (!global._nigelState) {
  global._nigelState = initState()
}

function trimLog(state: NigelState) {
  if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
}

export async function GET() {
  return NextResponse.json(global._nigelState)
}

export async function POST(request: Request) {
  const body = await request.json()
  const state = global._nigelState!

  switch (body.type) {
    case 'dispatcher_places_waypoint':
      state.waypoint = body.position
      state.radioLog.push({
        id: Date.now(), from: 'DISPATCH',
        message: 'Waypoint placed. Proceed to target.',
        timestamp: ts(),
      })
      trimLog(state)
      break

    case 'dispatcher_clears_waypoint':
      state.waypoint = null
      state.radioLog.push({ id: Date.now(), from: 'DISPATCH', message: 'Waypoint cleared.', timestamp: ts() })
      trimLog(state)
      break

    case 'firefighter_position_update':
      if (state.firefighterPosition) {
        state.breadcrumbs.push({ ...state.firefighterPosition })
      }
      if (state.breadcrumbs.length > 100) state.breadcrumbs.shift()
      state.firefighterPosition = body.position
      break

    case 'firefighter_status_update':
      state.firefighterStatus = body.status
      state.radioLog.push({
        id: Date.now(), from: 'FF1',
        message: `STATUS: ${(body.status as string).toUpperCase()}`,
        timestamp: ts(),
      })
      trimLog(state)
      break

    case 'firefighter_voice_message':
      state.radioLog.push({
        id: Date.now(), from: 'FF1',
        message: body.message,
        timestamp: ts(),
      })
      trimLog(state)
      break

    case 'dispatcher_voice_message':
    case 'dispatcher_radio_message':
      state.radioLog.push({
        id: Date.now(), from: 'DISPATCH',
        message: body.message,
        timestamp: ts(),
      })
      trimLog(state)
      break

    // ── Agent action types ──
    case 'agent_add_hazard':
      state.hazards.push({
        id: body.hazard?.id ?? `haz-${Date.now()}`,
        position: body.hazard?.position ?? state.firefighterPosition,
        type: body.hazard?.type ?? 'other',
        label: body.hazard?.label ?? 'Unknown hazard',
        active: true,
      })
      break

    case 'agent_add_task':
      state.tasks.push({
        id: body.task?.id ?? `task-${Date.now()}`,
        description: body.task?.description ?? '',
        priority: body.task?.priority ?? 'medium',
        completed: false,
        createdAt: new Date().toISOString(),
      })
      break

    case 'agent_complete_task': {
      const task = state.tasks.find(t => t.id === body.taskId)
      if (task) task.completed = true
      break
    }

    case 'agent_add_alert':
      state.alerts.push({
        id: body.alert?.id ?? `alert-${Date.now()}`,
        message: body.alert?.message ?? '',
        level: body.alert?.level ?? 'info',
        acknowledged: false,
        createdAt: new Date().toISOString(),
      })
      break

    case 'agent_acknowledge_alert': {
      const alert = state.alerts.find(a => a.id === body.alertId)
      if (alert) alert.acknowledged = true
      break
    }

    case 'agent_update_air_supply':
      state.airSupply = Math.max(0, Math.min(100, body.airSupply ?? state.airSupply))
      break

    case 'agent_clear_room':
      if (body.room && !state.roomsCleared.includes(body.room)) {
        state.roomsCleared.push(body.room)
      }
      break

    case 'agent_set_processing':
      state.agentProcessing = !!body.processing
      break

    case 'agent_radio_message':
      state.radioLog.push({
        id: Date.now(), from: 'NIGEL',
        message: body.message,
        timestamp: ts(),
        severity: body.severity ?? 'normal',
      })
      trimLog(state)
      break

    case 'reset':
      global._nigelState = initState()
      break
  }

  return NextResponse.json({ ok: true })
}
