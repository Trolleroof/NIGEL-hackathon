import { NextResponse } from 'next/server'

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY ?? ''
const CEREBRAS_URL = 'https://api.cerebras.ai/v1/chat/completions'
const MODEL = 'llama3.1-8b'
type AgentTrigger = 'radio_message' | 'heartbeat' | 'status_change'

interface NigelPosition {
  x: number
  y: number
}

interface NigelHazard {
  id: string
  position: NigelPosition
  type: string
  label: string
  active: boolean
}

interface NigelTask {
  id: string
  description: string
  priority: 'low' | 'medium' | 'high'
  completed: boolean
  createdAt: string
}

interface NigelAlert {
  id: string
  message: string
  level: 'info' | 'warning' | 'critical'
  acknowledged: boolean
  createdAt: string
}

interface NigelRadioMessage {
  id: number
  from: string
  message: string
  timestamp: string
  severity?: 'normal' | 'warning' | 'critical'
  shouldSpeak?: boolean
}

interface AgentState {
  firefighterPosition: NigelPosition
  waypoint: NigelPosition | null
  radioLog: NigelRadioMessage[]
  firefighterStatus: string
  hazards: NigelHazard[]
  tasks: NigelTask[]
  alerts: NigelAlert[]
  airSupply: number
  roomsCleared: string[]
  agentProcessing: boolean
  missionStartTime: string
}

interface AgentAction {
  type: 'place_hazard' | 'create_task' | 'complete_task' | 'set_alert' | 'place_waypoint' | 'update_air_supply' | 'clear_room'
  hazardType?: string
  hazardLabel?: string
  position?: { x: number; y: number }
  taskDescription?: string
  taskPriority?: 'low' | 'medium' | 'high'
  taskId?: string
  alertMessage?: string
  alertLevel?: 'info' | 'warning' | 'critical'
  airSupply?: number
  room?: string
}

interface AgentResponse {
  radioMessage: string
  severity: 'normal' | 'warning' | 'critical'
  actions: AgentAction[]
  shouldSpeak: boolean
}

const TS_FORMAT: Intl.DateTimeFormatOptions = {
  hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
}

function nowTs() {
  return new Date().toLocaleTimeString('en-US', TS_FORMAT)
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function trimRadioLog(state: AgentState) {
  if (state.radioLog.length > 120) state.radioLog = state.radioLog.slice(-120)
}

function buildSystemPrompt(state: Record<string, unknown>): string {
  const radioLog = (state.radioLog as Array<Record<string, string>>) ?? []
  const last10 = radioLog.slice(-10)
  const elapsed = state.missionStartTime
    ? Math.floor((Date.now() - new Date(state.missionStartTime as string).getTime()) / 1000)
    : 0
  const elapsedMin = Math.floor(elapsed / 60)

  return `You are NIGEL, an AI mission assistant embedded in a firefighter's command system. You monitor radio communications and mission state to provide tactical support.

CURRENT MISSION STATE:
- Firefighter Position: (${(state.firefighterPosition as { x: number; y: number })?.x}, ${(state.firefighterPosition as { x: number; y: number })?.y})
- Firefighter Status: ${state.firefighterStatus}
- Air Supply: ${state.airSupply}%
- Rooms Cleared: ${(state.roomsCleared as string[])?.join(', ') || 'None'}
- Active Hazards: ${JSON.stringify(state.hazards ?? [])}
- Open Tasks: ${JSON.stringify((state.tasks as Array<{ completed: boolean }>)?.filter(t => !t.completed) ?? [])}
- Unacknowledged Alerts: ${JSON.stringify((state.alerts as Array<{ acknowledged: boolean }>)?.filter(a => !a.acknowledged) ?? [])}
- Mission Elapsed: ${elapsedMin} minutes
- Waypoint: ${state.waypoint ? JSON.stringify(state.waypoint) : 'None'}

LAST 10 RADIO MESSAGES:
${last10.map(m => `[${m.timestamp}] ${m.from}: ${m.message}`).join('\n')}

YOUR ROLE:
- Analyze incoming messages for hazard reports, distress signals, status updates
- Place hazard markers when firefighters report smoke, fire, collapse, or chemicals
- Create tasks for action items mentioned in radio traffic
- Issue alerts for critical situations (mayday, collapse, trapped, flashover)
- Monitor air supply and remind when getting low
- Track room clearance progress
- Be concise and tactical in your radio messages — you're on an active fireground

RESPONSE FORMAT (strict JSON):
{
  "radioMessage": "Your tactical radio response (keep brief, <40 words)",
  "severity": "normal|warning|critical",
  "actions": [
    {
      "type": "place_hazard|create_task|complete_task|set_alert|update_air_supply|clear_room",
      "hazardType": "fire|smoke|collapse|chemical|other",
      "hazardLabel": "description",
      "taskDescription": "what needs to be done",
      "taskPriority": "low|medium|high",
      "alertMessage": "alert text",
      "alertLevel": "info|warning|critical",
      "airSupply": 85,
      "room": "room name"
    }
  ],
  "shouldSpeak": true
}

RULES:
- Always respond with valid JSON only, no markdown or explanation
- Only include actions that are directly relevant to the trigger
- For heartbeat triggers with nothing urgent, you may return an empty radioMessage and shouldSpeak: false
- If a mayday or emergency is reported, ALWAYS set severity to "critical" and create a critical alert
- When smoke/fire/collapse is reported, place a hazard marker
- Keep radioMessage empty string if there's nothing meaningful to say (e.g. routine position updates)`
}

async function callCerebras(systemPrompt: string, userMessage: string): Promise<AgentResponse> {
  const res = await fetch(CEREBRAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 512,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[NIGEL Agent] Cerebras API error:', res.status, errText)
    throw new Error(`Cerebras API error: ${res.status}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? '{}'

  let cleaned = content.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  try {
    return JSON.parse(cleaned)
  } catch {
    console.error('[NIGEL Agent] Failed to parse response:', cleaned)
    return { radioMessage: '', severity: 'normal', actions: [], shouldSpeak: false }
  }
}

function executeActions(actions: AgentAction[], state: AgentState) {
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'place_hazard':
          state.hazards.push({
            id: id('haz'),
            position: action.position ?? state.firefighterPosition,
            type: action.hazardType ?? 'other',
            label: action.hazardLabel ?? 'Hazard reported',
            active: true,
          })
          break

        case 'create_task':
          state.tasks.push({
            id: id('task'),
            description: action.taskDescription ?? 'Follow up on reported condition',
            priority: action.taskPriority ?? 'medium',
            completed: false,
            createdAt: new Date().toISOString(),
          })
          break

        case 'complete_task':
          if (action.taskId) {
            const task = state.tasks.find(t => t.id === action.taskId)
            if (task) task.completed = true
          }
          break

        case 'set_alert':
          state.alerts.push({
            id: id('alert'),
            message: action.alertMessage ?? 'Situation update',
            level: action.alertLevel ?? 'info',
            acknowledged: false,
            createdAt: new Date().toISOString(),
          })
          break

        case 'update_air_supply':
          if (action.airSupply !== undefined) {
            state.airSupply = Math.max(0, Math.min(100, action.airSupply))
          }
          break

        case 'clear_room':
          if (action.room) {
            if (!state.roomsCleared.includes(action.room)) {
              state.roomsCleared.push(action.room)
            }
          }
          break

        case 'place_waypoint':
          if (action.position) state.waypoint = action.position
          break
      }
    } catch (err) {
      console.error(`[NIGEL Agent] Failed to execute action ${action.type}:`, err)
    }
  }
}

function buildFallbackResponse(
  trigger: AgentTrigger,
  message: string | undefined,
  newStatus: string | undefined,
  state: AgentState,
): AgentResponse {
  const text = (message ?? '').toLowerCase()
  const actions: AgentAction[] = []
  let radioMessage = ''
  let severity: AgentResponse['severity'] = 'normal'
  let shouldSpeak = false

  if (trigger === 'heartbeat') {
    if (state.airSupply <= 20) {
      severity = 'critical'
      shouldSpeak = true
      radioMessage = 'FF1 low air critical. Exit route and relief crew now.'
      actions.push({
        type: 'set_alert',
        alertLevel: 'critical',
        alertMessage: 'CRITICAL LOW AIR: FF1 at or below 20%',
      })
    } else if (state.airSupply <= 35) {
      severity = 'warning'
      shouldSpeak = true
      radioMessage = 'FF1 low air warning. Confirm egress route and report status.'
      actions.push({
        type: 'set_alert',
        alertLevel: 'warning',
        alertMessage: 'LOW AIR warning for FF1',
      })
    }
    return { radioMessage, severity, actions, shouldSpeak }
  }

  if (trigger === 'status_change') {
    if (newStatus === 'Need Help') {
      severity = 'critical'
      shouldSpeak = true
      radioMessage = 'Need Help acknowledged. Marking emergency and notifying command.'
      actions.push({
        type: 'set_alert',
        alertLevel: 'critical',
        alertMessage: 'FF1 reported NEED HELP',
      })
    }
    return { radioMessage, severity, actions, shouldSpeak }
  }

  if (!text) {
    return { radioMessage, severity, actions, shouldSpeak }
  }

  const emergency = /(mayday|trapped|collapse|man down|evacuate now|flashover|explosion)/.test(text)
  const hazard = /(smoke|fire|heat|chemical|toxic|gas leak)/.test(text)
  const lowAir = /(low air|air low|bottle low|running out of air)/.test(text)

  if (emergency) {
    severity = 'critical'
    shouldSpeak = true
    radioMessage = 'Emergency traffic acknowledged. All units hold channel and dispatch rescue support.'
    actions.push({
      type: 'set_alert',
      alertLevel: 'critical',
      alertMessage: 'Emergency traffic detected on radio',
    })
  } else if (hazard) {
    severity = 'warning'
    shouldSpeak = true
    radioMessage = 'Hazard report copied. Marking map and advising caution through sector.'
    actions.push({
      type: 'place_hazard',
      hazardType: text.includes('smoke') ? 'smoke' : text.includes('chemical') ? 'chemical' : 'fire',
      hazardLabel: 'Radio-reported hazard',
      position: state.firefighterPosition,
    })
  } else if (lowAir) {
    severity = 'warning'
    shouldSpeak = true
    radioMessage = 'Low-air report copied. Start egress and provide interval updates.'
    actions.push({
      type: 'set_alert',
      alertLevel: 'warning',
      alertMessage: 'Low-air report over radio',
    })
  }

  return { radioMessage, severity, actions, shouldSpeak }
}

export async function POST(request: Request) {
  const body = await request.json()
  const { trigger, message, newStatus } = body as {
    trigger: AgentTrigger
    message?: string
    newStatus?: string
  }

  const state = global._nigelState as unknown as AgentState | undefined
  if (!state) {
    return NextResponse.json({ error: 'State not initialized' }, { status: 500 })
  }

  state.agentProcessing = true

  try {
    let agentResponse: AgentResponse

    if (!CEREBRAS_API_KEY) {
      agentResponse = buildFallbackResponse(trigger, message, newStatus, state)
    } else {
      const systemPrompt = buildSystemPrompt(state as unknown as Record<string, unknown>)

      let userMessage = ''
      switch (trigger) {
        case 'radio_message':
          userMessage = `New radio message received: "${message}". Analyze and respond.`
          break
        case 'heartbeat':
          userMessage = 'Periodic heartbeat check. Review current mission state and flag anything time-sensitive (low air, stale status, unresolved reports). If nothing needs attention, return empty radioMessage and shouldSpeak: false.'
          break
        case 'status_change':
          userMessage = `Firefighter status changed to: "${newStatus}". Assess the situation and respond.`
          break
        default:
          userMessage = 'General check-in. Review state and respond if needed.'
      }

      try {
        agentResponse = await callCerebras(systemPrompt, userMessage)
      } catch {
        agentResponse = buildFallbackResponse(trigger, message, newStatus, state)
      }
    }

    if (agentResponse.actions?.length) {
      executeActions(agentResponse.actions, state)
    }

    if (agentResponse.radioMessage) {
      state.radioLog.push({
        id: Date.now(),
        from: 'NIGEL',
        message: agentResponse.radioMessage,
        timestamp: nowTs(),
        severity: agentResponse.severity ?? 'normal',
        shouldSpeak: agentResponse.shouldSpeak,
      })
      trimRadioLog(state)
    }

    return NextResponse.json({
      ok: true,
      radioMessage: agentResponse.radioMessage,
      severity: agentResponse.severity,
      shouldSpeak: agentResponse.shouldSpeak,
      actionsExecuted: agentResponse.actions?.length ?? 0,
    })
  } catch (err) {
    console.error('[NIGEL Agent] Error:', err)
    return NextResponse.json({ error: 'Agent processing failed' }, { status: 500 })
  } finally {
    state.agentProcessing = false
  }
}
