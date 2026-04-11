import type { ChatContextSnapshot } from './analytics'

interface ApiErrorPayload {
  ok?: boolean
  error?: string | { code?: string; message?: string }
  message?: string
  reply?: string
  answer?: string
  content?: string
  text?: string
  status?: string
}

export interface ApiResult<T> {
  ok: boolean
  mode: 'api' | 'demo'
  data: T
  message?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  message: string
  context: ChatContextSnapshot
  messages: ChatMessage[]
}

export interface ChatResponse {
  reply: string
  mode: 'api' | 'demo'
}

async function readJsonResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null

  if (!payload) {
    return null
  }

  return payload
}

function extractErrorMessage(payload: ApiErrorPayload | null, fallback: string) {
  if (!payload) {
    return fallback
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error
  }

  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message
  }

  return payload.message ?? fallback
}

async function requestJson<T>(url: string, init: RequestInit): Promise<ApiResult<T> | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      ...init,
    })

    const payload = await readJsonResponse(response)

    if (!response.ok) {
      return {
        ok: false,
        mode: 'demo',
        data: null as T,
        message: extractErrorMessage(payload, `Request failed with ${response.status}`),
      }
    }

    return {
      ok: true,
      mode: 'api',
      data: (payload ?? null) as T,
    }
  } catch {
    return null
  }
}

function buildDemoReply(request: ChatRequest) {
  const topMetric = request.context.selectedMetrics[0]
  const opening = topMetric
    ? `Demo mode: I am using the visible ${topMetric.label} context you asked to inject.`
    : 'Demo mode: I am using the visible dashboard context you asked to inject.'

  const relation = request.context.keyRelationships[0]
    ? `The strongest visible relationship is ${request.context.keyRelationships[0].label}, which is ${request.context.keyRelationships[0].interpretation.toLowerCase()}`
    : 'There are not enough selected metrics to infer relationships yet.'

  return [
    opening,
    relation,
    `Your prompt: "${request.message}"`,
    'If you connect the chat API, the same context payload will be posted to `/api/chat` automatically.',
  ].join(' ')
}

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const response = await requestJson<{ reply?: string; answer?: string; message?: string; content?: string; text?: string }>(
    '/api/chat',
    {
      method: 'POST',
      body: JSON.stringify({
        message: request.message,
        history: request.messages.slice(0, -1),
        screenContext: request.context,
      }),
    },
  )

  if (response?.ok && response.data) {
    const reply =
      response.data.reply ??
      response.data.answer ??
      response.data.message ??
      response.data.content ??
      response.data.text ??
      'The chat endpoint returned no reply text.'

    return { reply, mode: 'api' }
  }

  return {
    reply: response?.message
      ? `${response.message} ${buildDemoReply(request)}`
      : buildDemoReply(request),
    mode: 'demo',
  }
}

export async function syncOuraData() {
  const response = await requestJson<ApiErrorPayload>('/api/sync', {
    method: 'POST',
  })

  if (response?.ok) {
    return {
      ok: true,
      mode: 'api' as const,
      data: response.data,
      message: response.data?.message ?? 'Sync completed.',
    }
  }

  return {
    ok: true,
    mode: 'demo' as const,
    data: null,
    message: response?.message ?? 'Demo sync completed locally.',
  }
}

export async function importOuraFile(file: File) {
  try {
    const text = await file.text()

    const response = await fetch('/api/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: file.name,
        text,
      }),
    })

    const payload = (await readJsonResponse(response)) ?? {}

    if (!response.ok) {
      return {
        ok: true,
        mode: 'demo' as const,
        data: null,
        message: extractErrorMessage(payload, `Import endpoint returned ${response.status}`),
      }
    }

    return {
      ok: true,
      mode: 'api' as const,
      data: payload,
      message: payload.message ?? `Imported ${file.name}`,
    }
  } catch {
    return {
      ok: true,
      mode: 'demo' as const,
      data: null,
      message: `Import failed locally, so ${file.name} was not loaded into the API store.`,
    }
  }
}

export async function probeHealth() {
  try {
    const response = await fetch('/api/health')
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; store?: { documentCount?: number } } | null

    return {
      connected: response.ok && Boolean(payload?.ok ?? true),
      mode: response.ok ? ('api' as const) : ('demo' as const),
      documentCount: payload?.store?.documentCount ?? 0,
    }
  } catch {
    return {
      connected: false,
      mode: 'demo' as const,
      documentCount: 0,
    }
  }
}

interface ChartPoint {
  x: string
  value: number | null
}

interface ChartSeries {
  metricId: string
  points: ChartPoint[]
}

interface ChartResponse {
  series: ChartSeries[]
}

const liveMetricMap = {
  readiness: 'daily_readiness.score',
  sleepScore: 'daily_sleep.score',
  sleepEfficiency: 'sleep.efficiency',
  hrv: 'sleep.average_hrv',
  restingHeartRate: 'sleep.lowest_heart_rate',
  steps: 'daily_activity.steps',
  strain: 'daily_activity.score',
  bedtimeConsistency: 'sleep.bedtime_start_minutes',
  bodyTempDelta: 'daily_readiness.temperature_deviation',
} as const

const requestedLiveMetricIds = [...new Set(Object.values(liveMetricMap))]

function parseDayKey(value: string) {
  return value.slice(0, 10)
}

function computeBedtimeConsistency(values: Array<number | null>) {
  return values.map((value, index) => {
    if (value === null) {
      return null
    }

    const window = values.slice(Math.max(0, index - 6), index + 1).filter((entry): entry is number => entry !== null)
    if (window.length === 0) {
      return null
    }

    const average = window.reduce((sum, entry) => sum + entry, 0) / window.length
    return Math.abs(value - average)
  })
}

export async function loadDashboardRecords(lookbackDays: number) {
  const health = await probeHealth()
  if (!health.connected) {
    return null
  }

  if (health.documentCount === 0) {
    await fetch('/api/demo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ days: Math.max(lookbackDays, 60), replace: true }),
    })
  }

  const params = new URLSearchParams({
    lookbackDays: String(Math.max(lookbackDays, 14)),
    metricIds: requestedLiveMetricIds.join(','),
  })
  const response = await requestJson<ChartResponse>(`/api/chart?${params.toString()}`, {
    method: 'GET',
  })

  if (!response?.ok) {
    return null
  }

  const dayMap = new Map<string, Partial<Record<string, number>>>()
  for (const series of response.data.series) {
    for (const point of series.points) {
      if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
        continue
      }

      const day = parseDayKey(point.x)
      const current = dayMap.get(day) ?? {}
      current[series.metricId] = point.value
      dayMap.set(day, current)
    }
  }

  const orderedDays = [...dayMap.keys()].sort()
  const bedtimeValues = orderedDays.map((day) => dayMap.get(day)?.['sleep.bedtime_start_minutes'] ?? null)
  const bedtimeConsistency = computeBedtimeConsistency(bedtimeValues)

  const records = orderedDays
    .map((day, index) => {
      const values = dayMap.get(day) ?? {}
      const readiness = values[liveMetricMap.readiness]
      const sleepScore = values[liveMetricMap.sleepScore]
      const sleepEfficiency = values[liveMetricMap.sleepEfficiency]
      const hrv = values[liveMetricMap.hrv]
      const restingHeartRate = values[liveMetricMap.restingHeartRate]
      const steps = values[liveMetricMap.steps]
      const strain = values[liveMetricMap.strain]
      const bodyTempDelta = values[liveMetricMap.bodyTempDelta]
      const bedtime = bedtimeConsistency[index]

      if (
        [readiness, sleepScore, sleepEfficiency, hrv, restingHeartRate, steps, strain, bodyTempDelta, bedtime].some(
          (value) => typeof value !== 'number' || !Number.isFinite(value),
        )
      ) {
        return null
      }

      return {
        date: day,
        readiness,
        sleepScore,
        sleepEfficiency,
        hrv,
        restingHeartRate,
        steps,
        strain,
        bedtimeConsistency: bedtime,
        bodyTempDelta,
      }
    })
    .filter((record): record is {
      date: string
      readiness: number
      sleepScore: number
      sleepEfficiency: number
      hrv: number
      restingHeartRate: number
      steps: number
      strain: number
      bedtimeConsistency: number
      bodyTempDelta: number
    } => record !== null)

  return records
}
