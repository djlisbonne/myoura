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

export interface ChatRequestContext {
  headline: string
  windowLabel: string
  selectedMetrics: Array<{
    metricId: string
    label: string
    latest: string
  }>
  keyRelationships: Array<{
    label: string
    interpretation: string
  }>
  sourceLabels: string[]
  notes: string[]
  xAxisMode: 'date' | 'sequence'
  displayMode: 'raw' | 'normalized' | 'relative'
  axisAssignments: Array<{
    metricId: string
    axis: 'left' | 'right' | 'off'
  }>
}

export interface ChatRequest {
  message: string
  context: ChatRequestContext
  messages: ChatMessage[]
}

export interface ChatResponse {
  reply: string
  mode: 'api' | 'demo'
}

export interface OuraAuthStatus {
  hasClientCredentials: boolean
  hasPersonalAccessToken: boolean
  connected: boolean
  authMode?: 'oauth' | 'pat' | 'none'
  expiresAt?: string
  scope?: string
  responseType?: 'code' | 'token'
  redirectUri?: string
}

export interface SourceMetricView {
  metricId: string
  label: string
  description: string
  unit?: string
  category: string
  chartable: boolean
  pointCount: number
  latestAt: string | null
  latestValue: number | null
  latestTextValue?: string | null
  min: number | null
  max: number | null
  mean: number | null
}

export interface SourceGroupView {
  resourceId: string
  label: string
  description: string
  kind: 'daily' | 'intraday' | 'event' | 'profile'
  path: string
  chartable: boolean
  documentCount: number
  metricCount: number
  latestAt: string | null
  metrics: SourceMetricView[]
}

export interface ChartPoint {
  x: string
  xType: 'day' | 'timestamp'
  value: number | null
  normalizedValue: number | null
  textValue?: string | null
  unit?: string
  meta?: Record<string, unknown>
}

export interface ChartSeries {
  metricId: string
  resourceId: string
  label: string
  description: string
  category: string
  unit?: string
  xType: 'day' | 'timestamp'
  pointCount: number
  stats: {
    min: number | null
    max: number | null
    mean: number | null
    latest: number | null
  }
  points: ChartPoint[]
}

interface SourcesResponse {
  ok: true
  range: {
    startDate: string
    endDate: string
  }
  sources: SourceGroupView[]
  chartableMetricIds: string[]
}

interface ChartResponse {
  ok: true
  range: {
    startDate: string
    endDate: string
  }
  normalize: boolean
  metricIds: string[]
  series: ChartSeries[]
  emptyState?: string
}

async function readJsonResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null
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
    'If you connect the chat API, the same screen context will be posted to `/api/chat` automatically.',
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
    reply: response?.message ? `${response.message} ${buildDemoReply(request)}` : buildDemoReply(request),
    mode: 'demo',
  }
}

export async function probeHealth() {
  try {
    const response = await fetch('/api/health')
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean
      store?: { documentCount?: number }
      auth?: { oura?: OuraAuthStatus }
    } | null

    return {
      connected: response.ok && Boolean(payload?.ok ?? true),
      mode: response.ok ? ('api' as const) : ('demo' as const),
      documentCount: payload?.store?.documentCount ?? 0,
      ouraAuth: payload?.auth?.oura,
    }
  } catch {
    return {
      connected: false,
      mode: 'demo' as const,
      documentCount: 0,
      ouraAuth: undefined,
    }
  }
}

export function startOuraOAuth() {
  window.location.href = '/api/auth/oura/start'
}

export async function completeOuraTokenAuthFromHash() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  if (!hash) {
    return null
  }

  const params = new URLSearchParams(hash)
  const accessToken = params.get('access_token')
  if (!accessToken) {
    return null
  }

  const tokenType = params.get('token_type') ?? undefined
  const expiresInValue = params.get('expires_in')
  const expiresIn = expiresInValue ? Number(expiresInValue) : undefined
  const scope = params.get('scope') ?? undefined

  const response = await requestJson<{ connected?: boolean }>('/api/auth/oura/token', {
    method: 'POST',
    body: JSON.stringify({
      accessToken,
      tokenType,
      expiresIn,
      scope,
    }),
  })

  if (response?.ok) {
    window.history.replaceState({}, '', window.location.pathname)
    return { connected: true }
  }

  return null
}

export async function fetchSources(lookbackDays: number) {
  const response = await requestJson<SourcesResponse>(`/api/sources?lookbackDays=${lookbackDays}`, {
    method: 'GET',
  })

  return response?.ok ? response.data : null
}

export async function fetchChart(metricIds: string[], lookbackDays: number) {
  if (metricIds.length === 0) {
    return null
  }

  const params = new URLSearchParams({
    lookbackDays: String(lookbackDays),
    metricIds: metricIds.join(','),
  })

  const response = await requestJson<ChartResponse>(`/api/chart?${params.toString()}`, {
    method: 'GET',
  })

  return response?.ok ? response.data : null
}

export async function syncOuraData() {
  const response = await requestJson<{ message?: string; authMode?: string }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ replace: false }),
  })

  if (response?.ok) {
    return {
      ok: true,
      mode: 'api' as const,
      message: response.data?.message ?? 'Sync completed.',
    }
  }

  return {
    ok: true,
    mode: 'demo' as const,
    message: response?.message ?? 'Sync failed. Check Oura authorization state.',
  }
}
