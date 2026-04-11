import { addDays, differenceInMinutes, formatISO } from 'date-fns'
import { createHash, randomUUID } from 'crypto'

import {
  clamp,
  dayOrTimestamp,
  dateWindowLabel,
  isNonEmptyString,
  metricDefinitionsById,
  nowIso,
  OURA_API_BASE,
  percentileNormalized,
  resourceDefinitions,
  type ChartXType,
  type DateRangeInput,
  type ResourceDefinition,
  type ResourceId,
  type SyncRun,
  type StoredDocument,
  type StoredMetric,
} from './lib.js'

export interface SyncResourceResult {
  resourceId: ResourceId
  label: string
  fetchedDocuments: number
  storedDocuments: number
  metricCount: number
  warnings: string[]
}

export interface SyncResult {
  startedAt: string
  finishedAt: string
  documents: StoredDocument[]
  resources: SyncResourceResult[]
  warnings: string[]
}

interface MultiDocumentResponse<T> {
  data: T[]
  next_token: string | null
}

function resourceById(resourceId: ResourceId): ResourceDefinition {
  const resource = resourceDefinitions.find((entry) => entry.id === resourceId)
  if (!resource) {
    throw new Error(`Unsupported Oura resource: ${resourceId}`)
  }
  return resource
}

function resourceHeader(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
}

function safeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function metricForId(metricId: string) {
  return metricDefinitionsById.get(metricId)
}

function createMetric(
  metricId: string,
  x: { x: string; xType: ChartXType },
  value: number | null,
  textValue?: string | null,
  rawValue?: unknown,
  meta?: Record<string, unknown>,
): StoredMetric | null {
  const definition = metricForId(metricId)
  if (!definition) {
    return null
  }

  return {
    metricId: definition.id,
    resourceId: definition.resourceId,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    value,
    textValue: textValue ?? null,
    unit: definition.unit,
    x: x.x,
    xType: x.xType,
    rawValue,
    meta,
  }
}

function pushMetric(
  metrics: StoredMetric[],
  metricId: string,
  x: { x: string; xType: ChartXType },
  value: number | null,
  textValue?: string | null,
  rawValue?: unknown,
  meta?: Record<string, unknown>,
): void {
  const metric = createMetric(metricId, x, value, textValue, rawValue, meta)
  if (metric) {
    metrics.push(metric)
  }
}

function createDocument(
  resourceId: ResourceId,
  x: { x: string; xType: ChartXType },
  raw: unknown,
  metrics: StoredMetric[],
  resourceLabel = resourceById(resourceId).label,
): StoredDocument {
  const rawRecord = safeRecord(raw)
  const officialId =
    (isNonEmptyString(rawRecord.id) && rawRecord.id) ||
    (isNonEmptyString(rawRecord.document_id) && rawRecord.document_id) ||
    null
  const hash = createHash('sha1')
    .update(JSON.stringify({ resourceId, x: x.x, raw: rawRecord, metrics }))
    .digest('hex')
    .slice(0, 16)

  return {
    id: officialId ? `${resourceId}:${officialId}` : `${resourceId}:${hash}`,
    resourceId,
    resourceLabel,
    kind: resourceById(resourceId).kind,
    x: x.x,
    xType: x.xType,
    day: x.xType === 'day' ? x.x : stringValue(rawRecord.day),
    timestamp: x.xType === 'timestamp' ? x.x : stringValue(rawRecord.timestamp) ?? stringValue(rawRecord.start_datetime),
    raw,
    metrics,
  }
}

function buildDailyX(raw: Record<string, unknown>): { x: string; xType: ChartXType } {
  return dayOrTimestamp({ day: stringValue(raw.day), timestamp: stringValue(raw.timestamp) }, nowIso())
}

function ordinalFromList(value: string | null | undefined, mapping: Record<number, string>): number | null {
  if (!value) {
    return null
  }
  for (const [ordinal, label] of Object.entries(mapping)) {
    if (label === value) {
      return Number(ordinal)
    }
  }
  return null
}

function parseNumeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bedtimeStartMinutes(value: unknown): number | null {
  const text = typeof value === 'string' ? value : null
  if (!text) {
    return null
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const minutes = parsed.getUTCHours() * 60 + parsed.getUTCMinutes()
  return minutes < 720 ? minutes + 1440 : minutes
}

function extractActivityDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'daily_activity.score', x, parseNumeric(item.score))
  pushMetric(metrics, 'daily_activity.steps', x, parseNumeric(item.steps))
  pushMetric(metrics, 'daily_activity.active_calories', x, parseNumeric(item.active_calories))
  pushMetric(metrics, 'daily_activity.total_calories', x, parseNumeric(item.total_calories))
  pushMetric(metrics, 'daily_activity.equivalent_walking_distance', x, parseNumeric(item.equivalent_walking_distance))
  pushMetric(metrics, 'daily_activity.sedentary_time', x, parseNumeric(item.sedentary_time))
  pushMetric(metrics, 'daily_activity.resting_time', x, parseNumeric(item.resting_time))
  pushMetric(metrics, 'daily_activity.non_wear_time', x, parseNumeric(item.non_wear_time))
  pushMetric(metrics, 'daily_activity.inactivity_alerts', x, parseNumeric(item.inactivity_alerts))
  pushMetric(metrics, 'daily_activity.average_met_minutes', x, parseNumeric(item.average_met_minutes))
  pushMetric(metrics, 'daily_activity.high_activity_met_minutes', x, parseNumeric(item.high_activity_met_minutes))
  pushMetric(metrics, 'daily_activity.high_activity_time', x, parseNumeric(item.high_activity_time))
  pushMetric(metrics, 'daily_activity.low_activity_met_minutes', x, parseNumeric(item.low_activity_met_minutes))
  pushMetric(metrics, 'daily_activity.low_activity_time', x, parseNumeric(item.low_activity_time))
  pushMetric(metrics, 'daily_activity.medium_activity_met_minutes', x, parseNumeric(item.medium_activity_met_minutes))
  pushMetric(metrics, 'daily_activity.medium_activity_time', x, parseNumeric(item.medium_activity_time))
  pushMetric(metrics, 'daily_activity.sedentary_met_minutes', x, parseNumeric(item.sedentary_met_minutes))
  pushMetric(metrics, 'daily_activity.target_calories', x, parseNumeric(item.target_calories))
  pushMetric(metrics, 'daily_activity.target_meters', x, parseNumeric(item.target_meters))
  pushMetric(metrics, 'daily_activity.meters_to_target', x, parseNumeric(item.meters_to_target))

  const contributors = safeRecord(item.contributors)
  pushMetric(metrics, 'daily_activity.contributors.meet_daily_targets', x, parseNumeric(contributors.meet_daily_targets))
  pushMetric(metrics, 'daily_activity.contributors.move_every_hour', x, parseNumeric(contributors.move_every_hour))
  pushMetric(metrics, 'daily_activity.contributors.recovery_time', x, parseNumeric(contributors.recovery_time))
  pushMetric(metrics, 'daily_activity.contributors.stay_active', x, parseNumeric(contributors.stay_active))
  pushMetric(metrics, 'daily_activity.contributors.training_frequency', x, parseNumeric(contributors.training_frequency))
  pushMetric(metrics, 'daily_activity.contributors.training_volume', x, parseNumeric(contributors.training_volume))

  return createDocument('daily_activity', x, item, metrics)
}

function extractReadinessDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'daily_readiness.score', x, parseNumeric(item.score))
  pushMetric(metrics, 'daily_readiness.temperature_deviation', x, parseNumeric(item.temperature_deviation))
  pushMetric(metrics, 'daily_readiness.temperature_trend_deviation', x, parseNumeric(item.temperature_trend_deviation))

  const contributors = safeRecord(item.contributors)
  pushMetric(metrics, 'daily_readiness.contributors.activity_balance', x, parseNumeric(contributors.activity_balance))
  pushMetric(metrics, 'daily_readiness.contributors.body_temperature', x, parseNumeric(contributors.body_temperature))
  pushMetric(metrics, 'daily_readiness.contributors.hrv_balance', x, parseNumeric(contributors.hrv_balance))
  pushMetric(metrics, 'daily_readiness.contributors.previous_day_activity', x, parseNumeric(contributors.previous_day_activity))
  pushMetric(metrics, 'daily_readiness.contributors.previous_night', x, parseNumeric(contributors.previous_night))
  pushMetric(metrics, 'daily_readiness.contributors.recovery_index', x, parseNumeric(contributors.recovery_index))
  pushMetric(metrics, 'daily_readiness.contributors.resting_heart_rate', x, parseNumeric(contributors.resting_heart_rate))
  pushMetric(metrics, 'daily_readiness.contributors.sleep_balance', x, parseNumeric(contributors.sleep_balance))
  pushMetric(metrics, 'daily_readiness.contributors.sleep_regularity', x, parseNumeric(contributors.sleep_regularity))

  return createDocument('daily_readiness', x, item, metrics)
}

function extractDailySleepDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'daily_sleep.score', x, parseNumeric(item.score))

  const contributors = safeRecord(item.contributors)
  pushMetric(metrics, 'daily_sleep.contributors.deep_sleep', x, parseNumeric(contributors.deep_sleep))
  pushMetric(metrics, 'daily_sleep.contributors.efficiency', x, parseNumeric(contributors.efficiency))
  pushMetric(metrics, 'daily_sleep.contributors.latency', x, parseNumeric(contributors.latency))
  pushMetric(metrics, 'daily_sleep.contributors.rem_sleep', x, parseNumeric(contributors.rem_sleep))
  pushMetric(metrics, 'daily_sleep.contributors.restfulness', x, parseNumeric(contributors.restfulness))
  pushMetric(metrics, 'daily_sleep.contributors.timing', x, parseNumeric(contributors.timing))
  pushMetric(metrics, 'daily_sleep.contributors.total_sleep', x, parseNumeric(contributors.total_sleep))

  return createDocument('daily_sleep', x, item, metrics)
}

function extractDailyStressDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'daily_stress.stress_high', x, parseNumeric(item.stress_high))
  pushMetric(metrics, 'daily_stress.recovery_high', x, parseNumeric(item.recovery_high))
  return createDocument('daily_stress', x, item, metrics)
}

function extractDailyResilienceDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  const level = typeof item.level === 'string' ? item.level : null
  pushMetric(metrics, 'daily_resilience.level', x, ordinalFromList(level, { 1: 'limited', 2: 'adequate', 3: 'solid', 4: 'strong', 5: 'exceptional' }), level, level)

  const contributors = safeRecord(item.contributors)
  pushMetric(metrics, 'daily_resilience.contributors.sleep_recovery', x, parseNumeric(contributors.sleep_recovery))
  pushMetric(metrics, 'daily_resilience.contributors.daytime_recovery', x, parseNumeric(contributors.daytime_recovery))
  pushMetric(metrics, 'daily_resilience.contributors.stress', x, parseNumeric(contributors.stress))

  return createDocument('daily_resilience', x, item, metrics)
}

function extractDailySpo2Document(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  const spo2 = safeRecord(item.spo2_percentage)
  pushMetric(metrics, 'daily_spo2.average', x, parseNumeric(spo2.average))
  pushMetric(metrics, 'daily_spo2.breathing_disturbance_index', x, parseNumeric(item.breathing_disturbance_index))
  return createDocument('daily_spo2', x, item, metrics)
}

function extractCardiovascularAgeDocument(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'daily_cardiovascular_age.vascular_age', x, parseNumeric(item.vascular_age))
  return createDocument('daily_cardiovascular_age', x, item, metrics)
}

function extractVo2Document(item: Record<string, unknown>): StoredDocument {
  const x = buildDailyX(item)
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'vo2_max.value', x, parseNumeric(item.vo2_max))
  return createDocument('vo2_max', x, item, metrics)
}

function extractSleepDocument(item: Record<string, unknown>): StoredDocument {
  const x = dayOrTimestamp({ day: stringValue(item.day), timestamp: stringValue(item.bedtime_start) ?? stringValue(item.timestamp) }, nowIso())
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'sleep.total_sleep_duration', x, parseNumeric(item.total_sleep_duration))
  pushMetric(metrics, 'sleep.time_in_bed', x, parseNumeric(item.time_in_bed))
  pushMetric(metrics, 'sleep.bedtime_start_minutes', x, bedtimeStartMinutes(item.bedtime_start))
  pushMetric(metrics, 'sleep.deep_sleep_duration', x, parseNumeric(item.deep_sleep_duration))
  pushMetric(metrics, 'sleep.light_sleep_duration', x, parseNumeric(item.light_sleep_duration))
  pushMetric(metrics, 'sleep.rem_sleep_duration', x, parseNumeric(item.rem_sleep_duration))
  pushMetric(metrics, 'sleep.awake_time', x, parseNumeric(item.awake_time))
  pushMetric(metrics, 'sleep.efficiency', x, parseNumeric(item.efficiency))
  pushMetric(metrics, 'sleep.latency', x, parseNumeric(item.latency))
  pushMetric(metrics, 'sleep.lowest_heart_rate', x, parseNumeric(item.lowest_heart_rate))
  pushMetric(metrics, 'sleep.average_heart_rate', x, parseNumeric(item.average_heart_rate))
  pushMetric(metrics, 'sleep.average_hrv', x, parseNumeric(item.average_hrv))
  pushMetric(metrics, 'sleep.readiness_score_delta', x, parseNumeric(item.readiness_score_delta))
  pushMetric(metrics, 'sleep.sleep_score_delta', x, parseNumeric(item.sleep_score_delta))
  const sleepType = typeof item.type === 'string' ? item.type : null
  pushMetric(metrics, 'sleep.type', x, ordinalFromList(sleepType, { 0: 'deleted', 1: 'rest', 2: 'sleep', 3: 'late_nap', 4: 'long_sleep' }), sleepType, sleepType)
  return createDocument('sleep', x, item, metrics)
}

function extractHeartrateDocument(item: Record<string, unknown>): StoredDocument {
  const x = dayOrTimestamp({ timestamp: stringValue(item.timestamp), day: stringValue(item.day) }, nowIso())
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'heartrate.bpm', x, parseNumeric(item.bpm), undefined, item.bpm, {
    source: item.source,
  })
  return createDocument('heartrate', x, item, metrics)
}

function extractWorkoutDocument(item: Record<string, unknown>): StoredDocument {
  const x = dayOrTimestamp({ day: stringValue(item.day), timestamp: stringValue(item.start_datetime) ?? stringValue(item.end_datetime) ?? stringValue(item.timestamp) }, nowIso())
  const metrics: StoredMetric[] = []
  pushMetric(metrics, 'workout.calories', x, parseNumeric(item.calories), undefined, item.calories, {
    activity: item.activity,
  })
  pushMetric(metrics, 'workout.distance', x, parseNumeric(item.distance), undefined, item.distance, {
    activity: item.activity,
  })
  const startDatetime = stringValue(item.start_datetime)
  const endDatetime = stringValue(item.end_datetime)
  if (startDatetime && endDatetime) {
    const duration = differenceInMinutes(new Date(endDatetime), new Date(startDatetime))
    pushMetric(metrics, 'workout.duration_minutes', x, Number.isFinite(duration) ? duration : null, undefined, duration, {
      activity: item.activity,
    })
  }
  const intensity = typeof item.intensity === 'string' ? item.intensity : null
  pushMetric(metrics, 'workout.intensity', x, ordinalFromList(intensity, { 1: 'easy', 2: 'moderate', 3: 'hard' }), intensity, intensity, {
    activity: item.activity,
  })
  const source = typeof item.source === 'string' ? item.source : null
  pushMetric(metrics, 'workout.source', x, ordinalFromList(source, { 1: 'manual', 2: 'autodetected', 3: 'confirmed', 4: 'workout_heart_rate' }), source, source, {
    activity: item.activity,
  })
  return createDocument('workout', x, item, metrics)
}

function extractTagDocument(resourceId: 'tag' | 'enhanced_tag', item: Record<string, unknown>): StoredDocument {
  const x = dayOrTimestamp({ day: stringValue(item.day), timestamp: stringValue(item.timestamp) }, nowIso())
  const metrics: StoredMetric[] = []
  const textValue = typeof item.text === 'string' ? item.text : null
  const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : []
  pushMetric(metrics, `${resourceId}.count`, x, 1, textValue, textValue ?? tags.join(', '), { tags })
  return createDocument(resourceId, x, item, metrics)
}

function normalizeResourceItem(resourceId: ResourceId, item: unknown): StoredDocument | null {
  const raw = safeRecord(item)
  switch (resourceId) {
    case 'daily_activity':
      return extractActivityDocument(raw)
    case 'daily_readiness':
      return extractReadinessDocument(raw)
    case 'daily_sleep':
      return extractDailySleepDocument(raw)
    case 'daily_stress':
      return extractDailyStressDocument(raw)
    case 'daily_resilience':
      return extractDailyResilienceDocument(raw)
    case 'daily_spo2':
      return extractDailySpo2Document(raw)
    case 'daily_cardiovascular_age':
      return extractCardiovascularAgeDocument(raw)
    case 'vo2_max':
      return extractVo2Document(raw)
    case 'sleep':
      return extractSleepDocument(raw)
    case 'heartrate':
      return extractHeartrateDocument(raw)
    case 'workout':
      return extractWorkoutDocument(raw)
    case 'tag':
      return extractTagDocument('tag', raw)
    case 'enhanced_tag':
      return extractTagDocument('enhanced_tag', raw)
    default:
      return null
  }
}

function isStoredMetricLike(value: unknown): value is StoredMetric {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as StoredMetric).metricId === 'string' &&
      typeof (value as StoredMetric).resourceId === 'string' &&
      typeof (value as StoredMetric).x === 'string',
  )
}

function isStoredDocumentLike(value: unknown): value is StoredDocument {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as StoredDocument).id === 'string' &&
      typeof (value as StoredDocument).resourceId === 'string' &&
      typeof (value as StoredDocument).x === 'string' &&
      Array.isArray((value as StoredDocument).metrics) &&
      (value as StoredDocument).metrics.every(isStoredMetricLike),
  )
}

export function importDocumentsFromPayload(payload: unknown): { documents: StoredDocument[]; warnings: string[] } {
  const warnings: string[] = []
  const documents: StoredDocument[] = []

  const collectStoredDocuments = (items: unknown[]) => {
    for (const item of items) {
      if (isStoredDocumentLike(item)) {
        documents.push(item)
      }
    }
  }

  if (Array.isArray(payload)) {
    collectStoredDocuments(payload)
  }

  const root = safeRecord(payload)

  if (Array.isArray(root.documents)) {
    collectStoredDocuments(root.documents)
  }

  if (documents.length === 0) {
    for (const resource of resourceDefinitions) {
      const items = root[resource.id]
      if (!Array.isArray(items)) {
        continue
      }

      for (const item of items) {
        const document = normalizeResourceItem(resource.id, item)
        if (document) {
          documents.push(document)
        }
      }
    }
  }

  if (documents.length === 0) {
    warnings.push('No importable documents were found. Use app store JSON or resource-keyed Oura JSON.')
  }

  return { documents, warnings }
}

async function fetchResourcePage(
  baseUrl: string,
  token: string,
  resource: ResourceDefinition,
  range: DateRangeInput,
  nextToken?: string | null,
): Promise<MultiDocumentResponse<unknown>> {
  const url = new URL(`${baseUrl}${resource.path}`)
  url.searchParams.set('start_date', range.startDate)
  url.searchParams.set('end_date', range.endDate)
  if (nextToken) {
    url.searchParams.set('next_token', nextToken)
  }

  const response = await fetch(url, {
    headers: resourceHeader(token),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Oura ${resource.id} request failed with ${response.status}: ${body || response.statusText}`)
  }

  const payload = (await response.json()) as MultiDocumentResponse<unknown>
  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    next_token: typeof payload.next_token === 'string' ? payload.next_token : null,
  }
}

async function fetchAllResourceDocuments(
  baseUrl: string,
  token: string,
  resource: ResourceDefinition,
  range: DateRangeInput,
): Promise<{ rawCount: number; documents: StoredDocument[] }> {
  const rawItems: unknown[] = []
  let nextToken: string | null | undefined = undefined

  do {
    const page = await fetchResourcePage(baseUrl, token, resource, range, nextToken)
    rawItems.push(...page.data)
    nextToken = page.next_token
  } while (nextToken)

  const documents = rawItems
    .map((item) => normalizeResourceItem(resource.id, item))
    .filter((document): document is StoredDocument => document !== null)

  return {
    rawCount: rawItems.length,
    documents,
  }
}

export class OuraClient {
  constructor(private readonly token: string, private readonly baseUrl = OURA_API_BASE) {}

  async sync(range: DateRangeInput, resourceIds: ResourceId[]): Promise<SyncResult> {
    const startedAt = nowIso()
    const resources: SyncResourceResult[] = []
    const warnings: string[] = []
    const documents: StoredDocument[] = []

    for (const resourceId of resourceIds) {
      const resource = resourceById(resourceId)
      try {
        const result = await fetchAllResourceDocuments(this.baseUrl, this.token, resource, range)
        documents.push(...result.documents)
        resources.push({
          resourceId,
          label: resource.label,
          fetchedDocuments: result.rawCount,
          storedDocuments: result.documents.length,
          metricCount: result.documents.reduce((count, document) => count + document.metrics.length, 0),
          warnings: [],
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(message)
        resources.push({
          resourceId,
          label: resource.label,
          fetchedDocuments: 0,
          storedDocuments: 0,
          metricCount: 0,
          warnings: [message],
        })
      }
    }

    return {
      startedAt,
      finishedAt: nowIso(),
      documents,
      resources,
      warnings,
    }
  }
}

function mulberry32(seed: number): () => number {
  let t = seed
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng()
}

function randomPick<T>(rng: () => number, values: T[]): T {
  return values[Math.floor(rng() * values.length) % values.length]
}

function demoDailyMetricSets(day: Date, dayIndex: number, rng: () => number) {
  const readinessScore = clamp(Math.round(68 + Math.sin(dayIndex / 4) * 11 + randomBetween(rng, -6, 6)), 25, 100)
  const sleepScore = clamp(Math.round(70 + Math.cos(dayIndex / 5) * 10 + randomBetween(rng, -8, 4)), 20, 100)
  const activityScore = clamp(Math.round(61 + Math.sin(dayIndex / 3) * 9 + randomBetween(rng, -7, 7)), 15, 100)
  const steps = Math.round(6200 + Math.sin(dayIndex / 2.4) * 1800 + randomBetween(rng, -900, 1400))
  const totalSleep = Math.round(6.3 * 3600 + Math.cos(dayIndex / 4.5) * 1100 + randomBetween(rng, -900, 900))
  const deepSleep = Math.round(totalSleep * (0.17 + randomBetween(rng, -0.03, 0.04)))
  const remSleep = Math.round(totalSleep * (0.22 + randomBetween(rng, -0.04, 0.04)))
  const lightSleep = Math.max(0, totalSleep - deepSleep - remSleep - Math.round(randomBetween(rng, 600, 1100)))
  const awakeTime = Math.round(randomBetween(rng, 8, 42) * 60)
  const stressHigh = Math.round(randomBetween(rng, 1200, 8400))
  const recoveryHigh = Math.round(randomBetween(rng, 1800, 12600))
  const vascularAge = clamp(Math.round(40 + Math.sin(dayIndex / 10) * 2 + randomBetween(rng, -1.5, 2.5)), 18, 100)
  const vo2Max = clamp(Math.round(36 + Math.sin(dayIndex / 8) * 2.5 + randomBetween(rng, -1.2, 1.8)), 18, 80)

  return {
    readinessScore,
    sleepScore,
    activityScore,
    steps,
    totalSleep,
    deepSleep,
    remSleep,
    lightSleep,
    awakeTime,
    stressHigh,
    recoveryHigh,
    vascularAge,
    vo2Max,
  }
}

export function buildDemoDocuments(days = 30): StoredDocument[] {
  const rng = mulberry32(0xdeadbeef)
  const documents: StoredDocument[] = []
  const end = new Date()
  const start = addDays(end, -Math.max(1, days - 1))

  for (let index = 0; index < days; index += 1) {
    const current = addDays(start, index)
    const nextDay = addDays(current, 1)
    const day = formatISO(current, { representation: 'date' })
    const nextDayIso = formatISO(nextDay, { representation: 'date' })
    const series = demoDailyMetricSets(current, index, rng)
    const readinessBase = series.readinessScore
    const sleepBase = series.sleepScore
    const activityBase = series.activityScore
    const wakingTemp = Number((randomBetween(rng, -0.25, 0.35) + (readinessBase < 60 ? 0.12 : 0)).toFixed(2))
    const trendTemp = Number((wakingTemp * 0.7 + randomBetween(rng, -0.08, 0.1)).toFixed(2))
    const resilienceLevel = randomPick(rng, ['limited', 'adequate', 'solid', 'strong', 'exceptional'])
    const workoutIntensity = randomPick(rng, ['easy', 'moderate', 'hard'])
    const workoutSource = randomPick(rng, ['manual', 'autodetected', 'confirmed', 'workout_heart_rate'])

    documents.push(
      extractActivityDocument({
        id: `demo-activity-${day}`,
        day,
        timestamp: `${day}T18:30:00`,
        score: activityBase,
        active_calories: Math.round(430 + activityBase * 9.5),
        average_met_minutes: Number((35 + activityBase / 2).toFixed(1)),
        equivalent_walking_distance: Math.round(4800 + series.steps * 0.7),
        high_activity_met_minutes: Math.round(30 + activityBase * 0.7),
        high_activity_time: Math.round(1500 + activityBase * 25),
        inactivity_alerts: Math.max(0, Math.round(randomBetween(rng, 0, 4))),
        low_activity_met_minutes: Math.round(70 + activityBase * 1.3),
        low_activity_time: Math.round(2800 + activityBase * 35),
        medium_activity_met_minutes: Math.round(90 + activityBase * 1.5),
        medium_activity_time: Math.round(3000 + activityBase * 38),
        met: {
          interval: 300,
          items: [2.1, 2.4, 3.2],
          timestamp: `${day}T12:00:00`,
        },
        meters_to_target: Math.max(0, 10000 - series.steps),
        non_wear_time: Math.round(randomBetween(rng, 0, 15) * 60),
        resting_time: Math.round(randomBetween(rng, 6, 10) * 3600),
        sedentary_met_minutes: Math.round(240 + randomBetween(rng, 0, 120)),
        sedentary_time: Math.round(randomBetween(rng, 7, 11) * 3600),
        steps: series.steps,
        target_calories: Math.round(550 + randomBetween(rng, 0, 180)),
        target_meters: Math.round(5000 + randomBetween(rng, 0, 4500)),
        total_calories: Math.round(1800 + activityBase * 14),
        contributors: {
          meet_daily_targets: clamp(Math.round(activityBase * 0.9 + randomBetween(rng, -6, 9)), 1, 100),
          move_every_hour: clamp(Math.round(58 + randomBetween(rng, -10, 12)), 1, 100),
          recovery_time: clamp(Math.round(50 + readinessBase * 0.2 + randomBetween(rng, -8, 10)), 1, 100),
          stay_active: clamp(Math.round(activityBase + randomBetween(rng, -5, 8)), 1, 100),
          training_frequency: clamp(Math.round(46 + randomBetween(rng, -12, 10)), 1, 100),
          training_volume: clamp(Math.round(44 + randomBetween(rng, -15, 12)), 1, 100),
        },
      }),
      extractReadinessDocument({
        id: `demo-readiness-${day}`,
        day,
        timestamp: `${day}T08:00:00`,
        score: readinessBase,
        temperature_deviation: wakingTemp,
        temperature_trend_deviation: trendTemp,
        contributors: {
          activity_balance: clamp(Math.round(70 + randomBetween(rng, -9, 6)), 1, 100),
          body_temperature: clamp(Math.round(58 + wakingTemp * 50 + randomBetween(rng, -5, 5)), 1, 100),
          hrv_balance: clamp(Math.round(54 + randomBetween(rng, -8, 11)), 1, 100),
          previous_day_activity: clamp(Math.round(50 + activityBase * 0.25 + randomBetween(rng, -8, 8)), 1, 100),
          previous_night: clamp(Math.round(63 + sleepBase * 0.25 + randomBetween(rng, -7, 6)), 1, 100),
          recovery_index: clamp(Math.round(61 + randomBetween(rng, -10, 10)), 1, 100),
          resting_heart_rate: clamp(Math.round(68 + randomBetween(rng, -11, 8)), 1, 100),
          sleep_balance: clamp(Math.round(63 + sleepBase * 0.22 + randomBetween(rng, -8, 8)), 1, 100),
          sleep_regularity: clamp(Math.round(58 + randomBetween(rng, -10, 12)), 1, 100),
        },
      }),
      extractDailySleepDocument({
        id: `demo-daily-sleep-${day}`,
        day,
        timestamp: `${day}T07:45:00`,
        score: sleepBase,
        contributors: {
          deep_sleep: clamp(Math.round(61 + randomBetween(rng, -12, 7)), 1, 100),
          efficiency: clamp(Math.round(66 + randomBetween(rng, -10, 8)), 1, 100),
          latency: clamp(Math.round(69 + randomBetween(rng, -11, 6)), 1, 100),
          rem_sleep: clamp(Math.round(60 + randomBetween(rng, -8, 8)), 1, 100),
          restfulness: clamp(Math.round(64 + randomBetween(rng, -9, 8)), 1, 100),
          timing: clamp(Math.round(62 + randomBetween(rng, -11, 8)), 1, 100),
          total_sleep: clamp(Math.round(70 + randomBetween(rng, -8, 6)), 1, 100),
        },
      }),
      extractDailyStressDocument({
        id: `demo-stress-${day}`,
        day,
        stress_high: series.stressHigh,
        recovery_high: series.recoveryHigh,
      }),
      extractDailyResilienceDocument({
        id: `demo-resilience-${day}`,
        day,
        contributors: {
          sleep_recovery: 0.45 + randomBetween(rng, -0.08, 0.11),
          daytime_recovery: 0.42 + randomBetween(rng, -0.1, 0.13),
          stress: 0.28 + randomBetween(rng, -0.05, 0.08),
        },
        level: resilienceLevel,
      }),
      extractDailySpo2Document({
        id: `demo-spo2-${day}`,
        day,
        spo2_percentage: {
          average: Number((96.2 + randomBetween(rng, -0.7, 0.5)).toFixed(2)),
        },
        breathing_disturbance_index: Math.round(randomBetween(rng, 4, 19)),
      }),
      extractCardiovascularAgeDocument({
        day,
        vascular_age: series.vascularAge,
      }),
      extractVo2Document({
        id: `demo-vo2-${day}`,
        day,
        timestamp: `${day}T09:15:00`,
        vo2_max: series.vo2Max,
      }),
      extractSleepDocument({
        id: `demo-sleep-period-${day}`,
        day,
        period: 1,
        type: randomBetween(rng, 0, 1) > 0.12 ? 'long_sleep' : 'sleep',
        bedtime_start: `${day}T22:48:00`,
        bedtime_end: `${nextDayIso}T06:54:00`,
        average_breath: Number((0.25 + randomBetween(rng, -0.02, 0.03)).toFixed(2)),
        average_heart_rate: Number((51 + randomBetween(rng, -4, 5)).toFixed(1)),
        average_hrv: Math.round(48 + randomBetween(rng, -12, 18)),
        awake_time: series.awakeTime,
        deep_sleep_duration: series.deepSleep,
        efficiency: Math.round(80 + randomBetween(rng, -7, 6)),
        heart_rate: {
          interval: 300,
          items: [49, 50, 48, 51, 52, 50],
          timestamp: `${day}T22:48:00.000`,
        },
        hrv: {
          interval: 300,
          items: [42, 47, 49, 45, 50],
          timestamp: `${day}T22:48:00.000`,
        },
        latency: Math.round(randomBetween(rng, 8, 24) * 60),
        light_sleep_duration: series.lightSleep,
        low_battery_alert: false,
        lowest_heart_rate: Math.round(44 + randomBetween(rng, -4, 4)),
        movement_30_sec: '1143222134',
        readiness_score_delta: Math.round(randomBetween(rng, -4, 6)),
        rem_sleep_duration: series.remSleep,
        restless_periods: Math.round(randomBetween(rng, 2, 12)),
        sleep_phase_5_min: '444423323441114',
        sleep_score_delta: Math.round(randomBetween(rng, -5, 5)),
        sleep_algorithm_version: 'v2',
        sleep_analysis_reason: 'foreground_sleep_analysis',
        time_in_bed: series.totalSleep + series.awakeTime + Math.round(randomBetween(rng, 400, 1200)),
        total_sleep_duration: series.totalSleep,
      }),
    )

    if (index % 2 === 0) {
      documents.push(
        extractWorkoutDocument({
          id: `demo-workout-${day}`,
          day,
          activity: randomPick(rng, ['walking', 'running', 'strength_training', 'cycling', 'yoga']),
          calories: Math.round(randomBetween(rng, 180, 540)),
          distance: Math.round(randomBetween(rng, 1200, 8100)),
          intensity: workoutIntensity,
          source: workoutSource,
          label: randomPick(rng, ['Morning session', 'Afternoon block', 'Recovery cardio', 'Threshold work', 'Long walk']),
          start_datetime: `${day}T17:10:00`,
          end_datetime: `${day}T18:02:00`,
        }),
      )
    }

    if (index % 3 === 0) {
      documents.push(
        extractTagDocument('tag', {
          id: `demo-tag-${day}`,
          day,
          timestamp: `${day}T13:05:00`,
          text: randomPick(rng, ['coffee', 'travel', 'late meal', 'stressful day', 'good sleep hygiene']),
          tags: [randomPick(rng, ['habit', 'context', 'experiment'])],
        }),
      )
    }

    if (index % 5 === 0) {
      documents.push(
        extractTagDocument('enhanced_tag', {
          id: `demo-enhanced-tag-${day}`,
          day,
          timestamp: `${day}T19:15:00`,
          text: randomPick(rng, ['supplement', 'meditation', 'heat exposure', 'cold plunge']),
          tags: [randomPick(rng, ['recovery', 'routine'])],
          source: 'manual',
        }),
      )
    }

    if (index >= days - 7) {
      for (let sampleIndex = 0; sampleIndex < 12; sampleIndex += 1) {
        const sampleMinute = sampleIndex * 120
        const sampleTime = new Date(current.getTime() + sampleMinute * 60000)
        documents.push(
          extractHeartrateDocument({
            id: `demo-heartrate-${day}-${sampleIndex}`,
            timestamp: sampleTime.toISOString(),
            bpm: Math.round(58 + Math.sin(sampleIndex / 2) * 5 + randomBetween(rng, -4, 4)),
            source: sampleIndex % 3 === 0 ? 'session' : sampleIndex % 2 === 0 ? 'awake' : 'rest',
          }),
        )
      }
    }
  }

  return documents
}

export function buildSyncRun(source: 'demo' | 'oura', documents: StoredDocument[], startedAt: string, finishedAt = nowIso(), range?: DateRangeInput, warnings: string[] = [], lookbackDays?: number): SyncRun {
  return {
    id: randomUUID(),
    source,
    startedAt,
    finishedAt,
    status: warnings.length > 0 ? 'partial' : 'ok',
    range,
    lookbackDays,
    resources: [...new Set(documents.map((document) => document.resourceId))],
    counts: {
      documents: documents.length,
      metrics: documents.reduce((count, document) => count + document.metrics.length, 0),
    },
    warnings,
  }
}

export function createOuraSyncSummary(range: DateRangeInput, documents: StoredDocument[], resources: Array<{ resourceId: string }>, warnings: string[]): {
  rangeLabel: string
  documents: number
  metrics: number
  resources: number
  warnings: string[]
} {
  return {
    rangeLabel: dateWindowLabel(range.startDate, range.endDate),
    documents: documents.length,
    metrics: documents.reduce((count, document) => count + document.metrics.length, 0),
    resources: resources.length,
    warnings,
  }
}

export function resourceIdsForSync(requested?: ResourceId[]): ResourceId[] {
  if (requested && requested.length > 0) {
    return requested
  }
  return resourceDefinitions.map((resource) => resource.id)
}

export function defaultResourceIdsForChart(): string[] {
  return [
    'daily_readiness.score',
    'daily_sleep.score',
    'daily_activity.score',
    'daily_activity.steps',
    'sleep.total_sleep_duration',
    'sleep.average_heart_rate',
    'heartrate.bpm',
  ]
}

export function ensureMetricIds(metricIds: string[]): string[] {
  return metricIds.filter((metricId) => metricDefinitionsById.has(metricId))
}

export function buildMetricNormalizationPoints(values: StoredMetric[]): { value: number | null; normalizedValue: number | null }[] {
  const numericValues = values.map((metric) => metric.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return values.map((metric) => {
    if (metric.value === null) {
      return { value: null, normalizedValue: null }
    }
    if (numericValues.length === 0) {
      return { value: metric.value, normalizedValue: null }
    }
    const normalizedValue = percentileNormalized(numericValues, metric.value)
    return {
      value: metric.value,
      normalizedValue,
    }
  })
}
