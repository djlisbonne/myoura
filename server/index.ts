import cors from 'cors'
import dotenv from 'dotenv'
import express, { type NextFunction, type Request, type Response } from 'express'
import path from 'path'

import { buildChartResponse, buildOverviewResponse, buildSourceGroups } from './analytics.js'
import { buildAuthorizationUrl, callbackRedirect, completeOauthCallback, getOauthStatus, resolveOuraAccessToken } from './auth.js'
import {
  DEFAULT_LOOKBACK_DAYS,
  chartableMetricDefinitions,
  coerceStringList,
  defaultResourceIdsForChart,
  resolveDateRange,
  resourceIdsForSync,
  resourceSchema,
  type ResourceId,
  type ApiErrorBody,
  type HealthResponse,
} from './lib.js'
import { parseChatRequest, runChatCompletion } from './chat.js'
import { buildDemoDocuments, buildSyncRun, createOuraSyncSummary, importDocumentsFromPayload, OuraClient } from './oura.js'
import { JsonStore } from './store.js'

dotenv.config()

const app = express()
const port = Number(process.env.PORT ?? 8787)
const storePath = path.resolve(process.cwd(), 'server/data/oura-store.json')
const store = new JsonStore(storePath)

app.use(cors())
app.use(express.json({ limit: '4mb' }))

function sendError(res: Response, status: number, code: string, message: string, details?: unknown): Response {
  const payload: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  }
  return res.status(status).json(payload)
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false
    }
  }
  return fallback
}

function readRangeFromQuery(query: Request['query']): { startDate?: string; endDate?: string; lookbackDays?: number } {
  const startDate = typeof query.startDate === 'string' ? query.startDate : undefined
  const endDate = typeof query.endDate === 'string' ? query.endDate : undefined
  const lookbackDaysValue = typeof query.lookbackDays === 'string' ? Number(query.lookbackDays) : undefined
  const lookbackDays = Number.isFinite(lookbackDaysValue) ? lookbackDaysValue : undefined
  return { startDate, endDate, lookbackDays }
}

function readMetricIds(query: Request['query']): string[] {
  return coerceStringList(query.metricIds) ?? coerceStringList(query.metrics) ?? defaultResourceIdsForChart()
}

function readResourceIds(body: Record<string, unknown>): ResourceId[] | undefined {
  const values = coerceStringList(body.resourceIds) ?? coerceStringList(body.resources)
  if (!values) {
    return undefined
  }
  const parsed = values.filter((value): value is ResourceId => resourceSchema.safeParse(value).success)
  return parsed.length > 0 ? parsed : undefined
}

app.get('/api/health', async (_req, res) => {
  const state = await store.read()
  const oauth = await getOauthStatus()
  const payload: HealthResponse = {
    ok: true,
    version: state.version,
    store: {
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      documentCount: state.documents.length,
      metricCount: state.documents.reduce((count, document) => count + document.metrics.length, 0),
      syncRunCount: state.syncRuns.length,
      ...(state.demoSeededAt ? { demoSeededAt: state.demoSeededAt } : {}),
    },
    auth: {
      oura: {
        hasPersonalAccessToken: Boolean(process.env.OURA_PERSONAL_ACCESS_TOKEN),
        ...oauth,
      },
    },
  }
  res.json(payload)
})

app.get('/api/auth/oura/status', async (_req, res) => {
  const oauth = await getOauthStatus()
  res.json({
    ok: true,
    oura: {
      hasPersonalAccessToken: Boolean(process.env.OURA_PERSONAL_ACCESS_TOKEN),
      ...oauth,
    },
  })
})

app.get('/api/auth/oura/start', async (_req, res, next) => {
  try {
    const url = await buildAuthorizationUrl()
    res.redirect(url)
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/oura/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : null
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const denied = typeof req.query.error === 'string' ? req.query.error : null

  if (denied) {
    return res.redirect(callbackRedirect(false, denied))
  }

  if (!code) {
    return res.redirect(callbackRedirect(false, 'missing_code'))
  }

  try {
    await completeOauthCallback(code, state)
    return res.redirect(callbackRedirect(true))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'oauth_callback_failed'
    return res.redirect(callbackRedirect(false, message))
  }
})

app.get('/api/sources', async (req, res) => {
  const state = await store.read()
  const range = resolveDateRange(readRangeFromQuery(req.query))
  const sourceGroups = buildSourceGroups(state, range)
  res.json({
    ok: true,
    range,
    sources: sourceGroups,
    chartableMetricIds: chartableMetricDefinitions.map((metric) => metric.id),
  })
})

app.get('/api/overview', async (req, res) => {
  const state = await store.read()
  const range = resolveDateRange(readRangeFromQuery(req.query))
  const overview = buildOverviewResponse(state, range)
  res.json({ ok: true, ...overview })
})

app.get('/api/chart', async (req, res) => {
  const state = await store.read()
  const range = resolveDateRange(readRangeFromQuery(req.query))
  const normalize = parseBoolean(req.query.normalize, true)
  const metricIds = readMetricIds(req.query)
  const chart = buildChartResponse(state, metricIds, range, normalize)
  res.json({ ok: true, ...chart })
})

app.post('/api/demo', async (req, res) => {
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {}
  const daysValue = typeof body.days === 'number' ? body.days : typeof body.days === 'string' ? Number(body.days) : DEFAULT_LOOKBACK_DAYS
  const days = Number.isFinite(daysValue) ? Math.max(1, Math.min(365, Math.round(daysValue))) : DEFAULT_LOOKBACK_DAYS
  const replace = parseBoolean(body.replace, true)
  const startedAt = new Date().toISOString()
  const documents = buildDemoDocuments(days)
  const range = resolveDateRange({ lookbackDays: days })
  const syncRun = buildSyncRun('demo', documents, startedAt, undefined, range, [], days)
  await (replace ? store.replaceDocuments(documents, syncRun) : store.mergeDocuments(documents, syncRun))
  await store.update((state) => {
    state.demoSeededAt = startedAt
    return state
  })
  const finalState = await store.read()

  res.status(201).json({
    ok: true,
    mode: replace ? 'replace' : 'merge',
    summary: createOuraSyncSummary(range, documents, syncRun.resources.map((resourceId) => ({ resourceId })), []),
    state: {
      documentCount: finalState.documents.length,
      syncRunCount: finalState.syncRuns.length,
      demoSeededAt: finalState.demoSeededAt,
    },
  })
})

app.post('/api/sync', async (req, res) => {
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {}
  const resourceIds = resourceIdsForSync(readResourceIds(body))

  const range = resolveDateRange({
    startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body.endDate === 'string' ? body.endDate : undefined,
    lookbackDays:
      typeof body.lookbackDays === 'number'
        ? body.lookbackDays
        : typeof body.lookbackDays === 'string'
          ? Number(body.lookbackDays)
          : DEFAULT_LOOKBACK_DAYS,
  })
  const replace = parseBoolean(body.replace, false)
  const auth = await resolveOuraAccessToken()
  const client = new OuraClient(auth.accessToken)
  const syncResult = await client.sync(range, resourceIds)
  const lookbackDays = typeof body.lookbackDays === 'number' ? body.lookbackDays : typeof body.lookbackDays === 'string' ? Number(body.lookbackDays) : undefined
  const syncRun = buildSyncRun(
    'oura',
    syncResult.documents,
    syncResult.startedAt,
    syncResult.finishedAt,
    range,
    syncResult.warnings,
    Number.isFinite(lookbackDays ?? Number.NaN) ? lookbackDays : undefined,
  )

  const nextState = replace ? await store.replaceDocuments(syncResult.documents, syncRun) : await store.mergeDocuments(syncResult.documents, syncRun)
  const summary = createOuraSyncSummary(range, syncResult.documents, syncResult.resources, syncResult.warnings)

  res.json({
    ok: true,
    mode: replace ? 'replace' : 'merge',
    authMode: auth.authMode,
    summary,
    resources: syncResult.resources,
    warnings: syncResult.warnings,
    state: {
      documentCount: nextState.documents.length,
      syncRunCount: nextState.syncRuns.length,
      updatedAt: nextState.updatedAt,
    },
  })
})

app.post('/api/import', async (req, res) => {
  const body = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {}
  const text = typeof body.text === 'string' ? body.text : null
  const replace = parseBoolean(body.replace, false)

  if (!text) {
    return sendError(res, 400, 'IMPORT_TEXT_MISSING', 'Import requests must include a JSON `text` field.')
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return sendError(res, 400, 'INVALID_IMPORT_JSON', 'Imported file content is not valid JSON.')
  }

  const imported = importDocumentsFromPayload(payload)
  if (imported.documents.length === 0) {
    return sendError(res, 400, 'EMPTY_IMPORT', imported.warnings[0] ?? 'No importable documents found.')
  }

  const orderedDays = imported.documents.map((document) => document.x.slice(0, 10)).sort()
  const range = resolveDateRange({
    startDate: orderedDays[0],
    endDate: orderedDays.at(-1),
  })
  const syncRun = buildSyncRun('oura', imported.documents, new Date().toISOString(), undefined, range, imported.warnings)
  const nextState = replace ? await store.replaceDocuments(imported.documents, syncRun) : await store.mergeDocuments(imported.documents, syncRun)

  res.status(201).json({
    ok: true,
    mode: replace ? 'replace' : 'merge',
    message: `Imported ${imported.documents.length} documents into the local store.`,
    warnings: imported.warnings,
    state: {
      documentCount: nextState.documents.length,
      syncRunCount: nextState.syncRuns.length,
      updatedAt: nextState.updatedAt,
    },
  })
})

app.post('/api/chat', async (req, res, next) => {
  try {
    const body = parseChatRequest(req.body)
    const result = await runChatCompletion(body)
    res.json({
      ok: true,
      reply: result.answer,
      ...result,
    })
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  void next
  if (error instanceof SyntaxError && 'body' in error) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body could not be parsed as JSON.')
  }

  if (error instanceof Error) {
    const message = error.message
    if (message.includes('OPENAI_API_KEY is not configured')) {
      return sendError(res, 503, 'OPENAI_KEY_MISSING', message)
    }
    if (
      message.includes('OURA_CLIENT_ID') ||
      message.includes('No Oura access token is configured') ||
      message.includes('Failed to exchange Oura OAuth token') ||
      message.includes('Stored Oura OAuth token has expired') ||
      message.includes('Invalid Oura OAuth state')
    ) {
      return sendError(res, 503, 'OURA_AUTH_ERROR', message)
    }
    if (message.includes('validation')) {
      return sendError(res, 400, 'INVALID_REQUEST', message)
    }
    return sendError(res, 500, 'INTERNAL_ERROR', message)
  }

  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.')
})

async function start(): Promise<void> {
  await store.init()
  app.listen(port, () => {
    console.log(`Oura local API listening on http://localhost:${port}`)
  })
}

void start().catch((error) => {
  console.error('Failed to start Oura local API')
  console.error(error)
  process.exit(1)
})
