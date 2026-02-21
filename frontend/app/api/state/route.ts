import { NextResponse } from 'next/server'

interface Position { x: number; y: number }
interface RadioMessage { id: number; from: string; message: string; timestamp: string }
interface NigelState {
  firefighterPosition: Position
  waypoint: Position | null
  radioLog: RadioMessage[]
  firefighterStatus: string
  breadcrumbs: Position[]
}

declare global {
  // eslint-disable-next-line no-var
  var _nigelState: NigelState | undefined
}

function ts() {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

if (!global._nigelState) {
  global._nigelState = {
    firefighterPosition: { x: 435, y: 400 },
    waypoint: null,
    radioLog: [
      { id: 1, from: 'SYSTEM', message: 'System online. All systems nominal.', timestamp: ts() },
      { id: 2, from: 'DISPATCH', message: 'FF1 awaiting deployment.', timestamp: ts() },
    ],
    firefighterStatus: 'OK',
    breadcrumbs: [],
  }
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
      if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
      break

    case 'dispatcher_clears_waypoint':
      state.waypoint = null
      state.radioLog.push({ id: Date.now(), from: 'DISPATCH', message: 'Waypoint cleared.', timestamp: ts() })
      if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
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
      if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
      break

    case 'firefighter_voice_message':
      state.radioLog.push({
        id: Date.now(), from: 'FF1',
        message: body.message,
        timestamp: ts(),
      })
      if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
      break

    case 'dispatcher_voice_message':
      state.radioLog.push({
        id: Date.now(), from: 'DISPATCH',
        message: body.message,
        timestamp: ts(),
      })
      if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
      break

    case 'reset':
      global._nigelState = {
        firefighterPosition: { x: 435, y: 400 },
        waypoint: null,
        radioLog: [{ id: Date.now(), from: 'SYSTEM', message: 'System reset.', timestamp: ts() }],
        firefighterStatus: 'OK',
        breadcrumbs: [],
      }
      break
  }

  return NextResponse.json({ ok: true })
}
