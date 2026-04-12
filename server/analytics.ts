import { formatISO, subDays } from 'date-fns'

import {
  average,
  chartPointComparator,
  chooseLatestTimestamp,
  ensureMetricIds,
  inferChartableMetricIds,
  metricDefinitionsById,
  metricGroupsByResource,
  normalizeDateString,
  percentileNormalized,
  pearsonCorrelation,
  resourceDefinitions,
  type ChartPoint,
  type ChartSeries,
  type DateRangeInput,
  type OverviewMetricCard,
  type OverviewResponse,
  type RelationshipView,
  type SourceGroupView,
  type SourceMetricView,
  type StoredDocument,
  type StoredMetric,
  type StoreState,
} from './lib.js'

function dayKey(value: string): string {
  return value.slice(0, 10)
}

function matchesRange(document: StoredDocument, range: DateRangeInput): boolean {
  const xKey = dayKey(document.x)
  return xKey >= normalizeDateString(range.startDate) && xKey <= normalizeDateString(range.endDate)
}

function documentsInRange(state: StoreState, range: DateRangeInput): StoredDocument[] {
  return state.documents.filter((document) => matchesRange(document, range))
}

function getMetricEntries(documents: StoredDocument[], metricId: string): Array<StoredMetric & { documentX: string; documentXType: StoredDocument['xType'] }> {
  const entries: Array<StoredMetric & { documentX: string; documentXType: StoredDocument['xType'] }> = []
  for (const document of documents) {
    for (const metric of document.metrics) {
      if (metric.metricId === metricId) {
        entries.push({
          ...metric,
          documentX: document.x,
          documentXType: document.xType,
        })
      }
    }
  }
  entries.sort((left, right) => left.documentX.localeCompare(right.documentX))
  return entries
}

function latestPoint<T extends { documentX: string }>(entries: T[]): T | null {
  if (entries.length === 0) {
    return null
  }
  return entries[entries.length - 1]
}

function buildChartSeries(documents: StoredDocument[], metricId: string, includeNormalization = true): ChartSeries | null {
  const definition = metricDefinitionsById.get(metricId)
  if (!definition) {
    return null
  }

  const entries = getMetricEntries(documents, metricId)
  const numericValues = entries.map((entry) => entry.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const points: ChartPoint[] = entries.map((entry) => ({
    x: entry.documentX,
    xType: entry.xType,
    value: entry.value,
    normalizedValue: includeNormalization && entry.value !== null && numericValues.length > 0 ? percentileNormalized(numericValues, entry.value) : null,
    textValue: entry.textValue ?? null,
    unit: entry.unit,
    meta: entry.meta,
  }))

  const latest = latestPoint(entries)
  const stats = {
    min: numericValues.length > 0 ? Math.min(...numericValues) : null,
    max: numericValues.length > 0 ? Math.max(...numericValues) : null,
    mean: average(numericValues),
    latest: latest?.value ?? null,
  }

  return {
    metricId,
    resourceId: definition.resourceId,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    unit: definition.unit,
    xType: points[0]?.xType ?? 'day',
    pointCount: points.length,
    stats,
    points: points.sort(chartPointComparator),
  }
}

function buildSourceGroupView(resourceId: (typeof resourceDefinitions)[number]['id'], documents: StoredDocument[]): SourceGroupView {
  const resource = resourceDefinitions.find((entry) => entry.id === resourceId)
  const resourceDocuments = documents.filter((document) => document.resourceId === resourceId)
  const metricDefinitionsForResource = metricGroupsByResource.get(resourceId) ?? []
  const latestAt = resourceDocuments.reduce<string | null>((current, document) => chooseLatestTimestamp(current, document.x), null)

  const metrics = metricDefinitionsForResource.map((definition) => {
    const metricEntries = getMetricEntries(resourceDocuments, definition.id)
    const numericValues = metricEntries.map((entry) => entry.value).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const latest = latestPoint(metricEntries)
    return {
      metricId: definition.id,
      label: definition.label,
      description: definition.description,
      unit: definition.unit,
      category: definition.category,
      chartable: definition.chartable,
      pointCount: metricEntries.length,
      latestAt: latest ? latest.documentX : null,
      latestValue: latest?.value ?? null,
      latestTextValue: latest?.textValue ?? null,
      min: numericValues.length > 0 ? Math.min(...numericValues) : null,
      max: numericValues.length > 0 ? Math.max(...numericValues) : null,
      mean: average(numericValues),
    } satisfies SourceMetricView
  })

  return {
    resourceId,
    label: resource?.label ?? resourceId,
    description: resource?.description ?? '',
    kind: resource?.kind ?? 'daily',
    path: resource?.path ?? '',
    chartable: Boolean(resource?.chartable),
    documentCount: resourceDocuments.length,
    metricCount: resourceDocuments.reduce((count, document) => count + document.metrics.length, 0),
    latestAt,
    metrics,
  }
}

function buildOverviewMetricCard(documents: StoredDocument[], metricId: string, endDate: string): OverviewMetricCard | null {
  const definition = metricDefinitionsById.get(metricId)
  if (!definition) {
    return null
  }

  const entries = getMetricEntries(documents, metricId)
  const latest = latestPoint(entries)
  const latestAt = latest ? latest.documentX : null
  const end = normalizeDateString(endDate)
  const currentStart = formatISO(subDays(new Date(`${end}T00:00:00.000Z`), 6), { representation: 'date' })
  const priorStart = formatISO(subDays(new Date(`${end}T00:00:00.000Z`), 13), { representation: 'date' })
  const priorEnd = formatISO(subDays(new Date(`${end}T00:00:00.000Z`), 7), { representation: 'date' })

  const currentValues = entries.filter((entry) => dayKey(entry.documentX) >= currentStart && dayKey(entry.documentX) <= end && typeof entry.value === 'number').map((entry) => entry.value as number)
  const priorValues = entries.filter((entry) => dayKey(entry.documentX) >= priorStart && dayKey(entry.documentX) <= priorEnd && typeof entry.value === 'number').map((entry) => entry.value as number)

  return {
    metricId,
    label: definition.label,
    unit: definition.unit,
    latestAt,
    latestValue: latest?.value ?? null,
    latestTextValue: latest?.textValue ?? null,
    current7DayAverage: average(currentValues),
    prior7DayAverage: average(priorValues),
    change: average(currentValues) !== null && average(priorValues) !== null ? (average(currentValues) as number) - (average(priorValues) as number) : null,
  }
}

function correlationInterpretation(correlation: number): string {
  const magnitude = Math.abs(correlation)
  if (magnitude >= 0.75) {
    return correlation > 0 ? 'strong positive alignment' : 'strong inverse alignment'
  }
  if (magnitude >= 0.45) {
    return correlation > 0 ? 'moderate positive alignment' : 'moderate inverse alignment'
  }
  return correlation > 0 ? 'weak positive alignment' : 'weak inverse alignment'
}

function buildRelationships(documents: StoredDocument[]): RelationshipView[] {
  const candidates: Array<[string, string]> = [
    ['daily_readiness.score', 'daily_sleep.score'],
    ['daily_readiness.score', 'daily_activity.score'],
    ['daily_sleep.score', 'daily_activity.score'],
    ['daily_activity.score', 'daily_activity.steps'],
    ['daily_readiness.score', 'daily_spo2.average'],
    ['daily_sleep.score', 'sleep.total_sleep_duration'],
    ['daily_sleep.score', 'sleep.bedtime_start_minutes'],
    ['daily_sleep.score', 'sleep_time.optimal_bedtime.start_offset_minutes'],
    ['session.duration_minutes', 'sleep.total_sleep_duration'],
  ]

  const relationships: RelationshipView[] = []
  for (const [leftMetricId, rightMetricId] of candidates) {
    const leftEntries = getMetricEntries(documents, leftMetricId)
    const rightEntries = getMetricEntries(documents, rightMetricId)
    const rightByDay = new Map(rightEntries.map((entry) => [dayKey(entry.documentX), entry.value] as const))
    const leftValues: number[] = []
    const rightValues: number[] = []
    for (const entry of leftEntries) {
      const rightValue = rightByDay.get(dayKey(entry.documentX))
      if (typeof entry.value === 'number' && typeof rightValue === 'number' && Number.isFinite(entry.value) && Number.isFinite(rightValue)) {
        leftValues.push(entry.value)
        rightValues.push(rightValue)
      }
    }
    const correlation = pearsonCorrelation(leftValues, rightValues)
    if (correlation === null || leftValues.length < 7) {
      continue
    }
    relationships.push({
      leftMetricId,
      rightMetricId,
      leftLabel: metricDefinitionsById.get(leftMetricId)?.label ?? leftMetricId,
      rightLabel: metricDefinitionsById.get(rightMetricId)?.label ?? rightMetricId,
      correlation,
      sampleSize: leftValues.length,
      interpretation: correlationInterpretation(correlation),
    })
  }

  return relationships.sort((left, right) => Math.abs(right.correlation) - Math.abs(left.correlation))
}

export function buildSourceGroups(state: StoreState, range: DateRangeInput): SourceGroupView[] {
  const documents = documentsInRange(state, range)
  return resourceDefinitions.map((resource) => buildSourceGroupView(resource.id, documents))
}

export function buildChartResponse(state: StoreState, metricIds: string[], range: DateRangeInput, normalize = true): {
  range: DateRangeInput
  normalize: boolean
  metricIds: string[]
  series: ChartSeries[]
  emptyState?: string
} {
  const documents = documentsInRange(state, range)
  const selectedMetricIds = ensureMetricIds(metricIds.length > 0 ? metricIds : inferChartableMetricIds())
  const series = selectedMetricIds
    .map((metricId) => buildChartSeries(documents, metricId, normalize))
    .filter((entry): entry is ChartSeries => entry !== null && entry.pointCount > 0)

  return {
    range,
    normalize,
    metricIds: selectedMetricIds,
    series,
    emptyState: series.length === 0 ? 'No chartable data found for the selected range.' : undefined,
  }
}

export function buildOverviewResponse(state: StoreState, range: DateRangeInput): OverviewResponse {
  const documents = documentsInRange(state, range)
  const sourceGroups = buildSourceGroups(state, range)
  if (documents.length === 0) {
    return {
      range,
      keyMetrics: [],
      relationships: [],
      sourceGroups,
      emptyState: 'No stored data yet. Use /api/demo or /api/sync to populate the local store.',
    }
  }

  const keyMetricIds = [
    'daily_readiness.score',
    'daily_sleep.score',
    'daily_activity.score',
    'daily_activity.steps',
    'sleep.bedtime_start_minutes',
    'sleep.bedtime_end_minutes',
    'sleep.total_sleep_duration',
    'session.duration_minutes',
    'sleep.average_heart_rate',
    'sleep_time.optimal_bedtime.start_offset_minutes',
    'daily_spo2.average',
    'vo2_max.value',
    'daily_cardiovascular_age.vascular_age',
    'daily_resilience.level',
  ]

  const keyMetrics = keyMetricIds
    .map((metricId) => buildOverviewMetricCard(documents, metricId, range.endDate))
    .filter((metric): metric is OverviewMetricCard => metric !== null)

  return {
    range,
    keyMetrics,
    relationships: buildRelationships(documents),
    sourceGroups,
  }
}
