import { formatISO, parseISO, subDays } from 'date-fns'
import { z } from 'zod'

export const STORE_VERSION = 1
export const DEFAULT_LOOKBACK_DAYS = 30
export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5'
export const OURA_API_BASE = 'https://api.ouraring.com'

export const resourceSchema = z.enum([
  'daily_activity',
  'daily_readiness',
  'daily_sleep',
  'daily_stress',
  'daily_resilience',
  'daily_spo2',
  'daily_cardiovascular_age',
  'vo2_max',
  'sleep',
  'heartrate',
  'workout',
  'tag',
  'enhanced_tag',
])

export type ResourceId = z.infer<typeof resourceSchema>

export type ResourceKind = 'daily' | 'intraday' | 'event' | 'profile'
export type MetricCategory = 'score' | 'quantity' | 'duration' | 'rate' | 'ordinal' | 'text' | 'event'
export type ChartXType = 'day' | 'timestamp'

export interface ResourceDefinition {
  id: ResourceId
  label: string
  description: string
  path: string
  kind: ResourceKind
  defaultLookbackDays: number
  chartable: boolean
}

export interface MetricDefinition {
  id: string
  resourceId: ResourceId
  label: string
  description: string
  unit?: string
  category: MetricCategory
  chartable: boolean
  preferredYScale?: 'linear' | 'log'
  ordinalLabels?: Record<number, string>
}

export interface StoredMetric {
  metricId: string
  resourceId: ResourceId
  label: string
  description: string
  category: MetricCategory
  value: number | null
  textValue?: string | null
  unit?: string
  x: string
  xType: ChartXType
  rawValue?: unknown
  meta?: Record<string, unknown>
}

export interface StoredDocument {
  id: string
  resourceId: ResourceId
  resourceLabel: string
  kind: ResourceKind
  x: string
  xType: ChartXType
  day?: string
  timestamp?: string
  raw: unknown
  metrics: StoredMetric[]
}

export interface SyncRun {
  id: string
  source: 'demo' | 'oura'
  startedAt: string
  finishedAt: string
  status: 'ok' | 'partial' | 'error'
  range?: {
    startDate: string
    endDate: string
  }
  lookbackDays?: number
  resources: string[]
  counts: {
    documents: number
    metrics: number
  }
  warnings: string[]
}

export interface StoreState {
  version: number
  createdAt: string
  updatedAt: string
  demoSeededAt?: string
  documents: StoredDocument[]
  syncRuns: SyncRun[]
}

export interface ChartPoint {
  x: string
  xType: ChartXType
  value: number | null
  normalizedValue: number | null
  textValue?: string | null
  unit?: string
  meta?: Record<string, unknown>
}

export interface ChartSeries {
  metricId: string
  resourceId: ResourceId
  label: string
  description: string
  category: MetricCategory
  unit?: string
  xType: ChartXType
  pointCount: number
  stats: {
    min: number | null
    max: number | null
    mean: number | null
    latest: number | null
  }
  points: ChartPoint[]
}

export interface SourceMetricView {
  metricId: string
  label: string
  description: string
  unit?: string
  category: MetricCategory
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
  resourceId: ResourceId
  label: string
  description: string
  kind: ResourceKind
  path: string
  chartable: boolean
  documentCount: number
  metricCount: number
  latestAt: string | null
  metrics: SourceMetricView[]
}

export interface OverviewMetricCard {
  metricId: string
  label: string
  unit?: string
  latestAt: string | null
  latestValue: number | null
  latestTextValue?: string | null
  current7DayAverage: number | null
  prior7DayAverage: number | null
  change: number | null
}

export interface RelationshipView {
  leftMetricId: string
  rightMetricId: string
  leftLabel: string
  rightLabel: string
  correlation: number
  sampleSize: number
  interpretation: string
}

export interface OverviewResponse {
  range: {
    startDate: string
    endDate: string
  }
  keyMetrics: OverviewMetricCard[]
  relationships: RelationshipView[]
  sourceGroups: SourceGroupView[]
  emptyState?: string
}

export interface HealthResponse {
  ok: true
  version: number
  store: {
    createdAt: string
    updatedAt: string
    documentCount: number
    metricCount: number
    syncRunCount: number
    demoSeededAt?: string
  }
  auth?: {
    oura: {
      hasPersonalAccessToken: boolean
      hasClientCredentials: boolean
      connected: boolean
      expiresAt?: string
      scope?: string
    }
  }
}

export interface ChatContext {
  page?: string
  visibleMetricIds?: string[]
  visibleSourceIds?: string[]
  selection?: Record<string, unknown>
  chart?: unknown
  overview?: unknown
  notes?: string
}

export interface ChatMessageInput {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequestBody {
  message: string
  history?: ChatMessageInput[]
  screenContext?: ChatContext
  model?: string
  temperature?: number
  maxOutputTokens?: number
}

export interface ChatResponseBody {
  answer: string
  model: string
  contextInjected: boolean
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export interface DateRangeInput {
  startDate: string
  endDate: string
}

export const resourceDefinitions: ResourceDefinition[] = [
  {
    id: 'daily_activity',
    label: 'Daily activity',
    description: 'Activity score, calories, steps, and movement contributors.',
    path: '/v2/usercollection/daily_activity',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_readiness',
    label: 'Daily readiness',
    description: 'Readiness score plus temperature and recovery contributors.',
    path: '/v2/usercollection/daily_readiness',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_sleep',
    label: 'Daily sleep',
    description: 'Daily sleep score and contributor breakdown.',
    path: '/v2/usercollection/daily_sleep',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_stress',
    label: 'Daily stress',
    description: 'Stress and recovery time at the day level.',
    path: '/v2/usercollection/daily_stress',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_resilience',
    label: 'Daily resilience',
    description: 'Resilience level and contributors.',
    path: '/v2/usercollection/daily_resilience',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_spo2',
    label: 'Daily SpO2',
    description: 'Overnight oxygen saturation and breathing disturbance data.',
    path: '/v2/usercollection/daily_spo2',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'daily_cardiovascular_age',
    label: 'Cardiovascular age',
    description: 'Daily vascular age estimate.',
    path: '/v2/usercollection/daily_cardiovascular_age',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'vo2_max',
    label: 'VO2 max',
    description: 'VO2 max estimate by day.',
    path: '/v2/usercollection/vO2_max',
    kind: 'daily',
    defaultLookbackDays: 60,
    chartable: true,
  },
  {
    id: 'sleep',
    label: 'Sleep periods',
    description: 'Raw sleep period records with staging and sleep-phase details.',
    path: '/v2/usercollection/sleep',
    kind: 'daily',
    defaultLookbackDays: 30,
    chartable: true,
  },
  {
    id: 'heartrate',
    label: 'Heart rate',
    description: 'Intraday heart rate samples.',
    path: '/v2/usercollection/heartrate',
    kind: 'intraday',
    defaultLookbackDays: 14,
    chartable: true,
  },
  {
    id: 'workout',
    label: 'Workouts',
    description: 'Workout sessions captured by the ring or the app.',
    path: '/v2/usercollection/workout',
    kind: 'event',
    defaultLookbackDays: 60,
    chartable: true,
  },
  {
    id: 'tag',
    label: 'Tags',
    description: 'Tagged notes and habits attached to a day.',
    path: '/v2/usercollection/tag',
    kind: 'event',
    defaultLookbackDays: 90,
    chartable: true,
  },
  {
    id: 'enhanced_tag',
    label: 'Enhanced tags',
    description: 'Extended tag records with richer metadata.',
    path: '/v2/usercollection/enhanced_tag',
    kind: 'event',
    defaultLookbackDays: 90,
    chartable: true,
  },
]

const dailyActivityMetrics: MetricDefinition[] = [
  { id: 'daily_activity.score', resourceId: 'daily_activity', label: 'Activity score', description: 'Daily activity score from Oura.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.steps', resourceId: 'daily_activity', label: 'Steps', description: 'Total steps.', unit: 'steps', category: 'quantity', chartable: true },
  { id: 'daily_activity.active_calories', resourceId: 'daily_activity', label: 'Active calories', description: 'Active calories expended.', unit: 'kcal', category: 'quantity', chartable: true },
  { id: 'daily_activity.total_calories', resourceId: 'daily_activity', label: 'Total calories', description: 'Total calories expended.', unit: 'kcal', category: 'quantity', chartable: true },
  { id: 'daily_activity.equivalent_walking_distance', resourceId: 'daily_activity', label: 'Equivalent walking distance', description: 'Equivalent walking distance.', unit: 'm', category: 'quantity', chartable: true },
  { id: 'daily_activity.sedentary_time', resourceId: 'daily_activity', label: 'Sedentary time', description: 'Sedentary time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.resting_time', resourceId: 'daily_activity', label: 'Resting time', description: 'Resting time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.non_wear_time', resourceId: 'daily_activity', label: 'Non-wear time', description: 'Time without the ring worn.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.inactivity_alerts', resourceId: 'daily_activity', label: 'Inactivity alerts', description: 'Received inactivity alerts.', unit: 'count', category: 'quantity', chartable: true },
  { id: 'daily_activity.average_met_minutes', resourceId: 'daily_activity', label: 'Average MET minutes', description: 'Average metabolic equivalent in minutes.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'daily_activity.high_activity_met_minutes', resourceId: 'daily_activity', label: 'High activity MET minutes', description: 'High activity MET minutes.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'daily_activity.high_activity_time', resourceId: 'daily_activity', label: 'High activity time', description: 'High activity time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.low_activity_met_minutes', resourceId: 'daily_activity', label: 'Low activity MET minutes', description: 'Low activity MET minutes.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'daily_activity.low_activity_time', resourceId: 'daily_activity', label: 'Low activity time', description: 'Low activity time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.medium_activity_met_minutes', resourceId: 'daily_activity', label: 'Medium activity MET minutes', description: 'Medium activity MET minutes.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'daily_activity.medium_activity_time', resourceId: 'daily_activity', label: 'Medium activity time', description: 'Medium activity time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_activity.sedentary_met_minutes', resourceId: 'daily_activity', label: 'Sedentary MET minutes', description: 'Sedentary MET minutes.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'daily_activity.target_calories', resourceId: 'daily_activity', label: 'Target calories', description: 'Daily calorie target.', unit: 'kcal', category: 'quantity', chartable: true },
  { id: 'daily_activity.target_meters', resourceId: 'daily_activity', label: 'Target meters', description: 'Daily movement target.', unit: 'm', category: 'quantity', chartable: true },
  { id: 'daily_activity.meters_to_target', resourceId: 'daily_activity', label: 'Meters to target', description: 'Remaining meters to target.', unit: 'm', category: 'quantity', chartable: true },
  { id: 'daily_activity.contributors.meet_daily_targets', resourceId: 'daily_activity', label: 'Meet daily targets', description: 'Contribution of meeting daily targets.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.contributors.move_every_hour', resourceId: 'daily_activity', label: 'Move every hour', description: 'Contribution of inactivity alerts.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.contributors.recovery_time', resourceId: 'daily_activity', label: 'Recovery time', description: 'Contribution of recovery time.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.contributors.stay_active', resourceId: 'daily_activity', label: 'Stay active', description: 'Contribution of activity in the last day.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.contributors.training_frequency', resourceId: 'daily_activity', label: 'Training frequency', description: 'Contribution of exercise frequency.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_activity.contributors.training_volume', resourceId: 'daily_activity', label: 'Training volume', description: 'Contribution of exercise volume.', unit: 'score', category: 'score', chartable: true },
]

const dailyReadinessMetrics: MetricDefinition[] = [
  { id: 'daily_readiness.score', resourceId: 'daily_readiness', label: 'Readiness score', description: 'Daily readiness score.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.temperature_deviation', resourceId: 'daily_readiness', label: 'Temperature deviation', description: 'Temperature deviation in Celsius.', unit: '°C', category: 'quantity', chartable: true },
  { id: 'daily_readiness.temperature_trend_deviation', resourceId: 'daily_readiness', label: 'Temperature trend deviation', description: 'Temperature trend deviation in Celsius.', unit: '°C', category: 'quantity', chartable: true },
  { id: 'daily_readiness.contributors.activity_balance', resourceId: 'daily_readiness', label: 'Activity balance', description: 'Contribution of activity balance to readiness.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.body_temperature', resourceId: 'daily_readiness', label: 'Body temperature', description: 'Contribution of body temperature to readiness.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.hrv_balance', resourceId: 'daily_readiness', label: 'HRV balance', description: 'Contribution of HRV balance to readiness.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.previous_day_activity', resourceId: 'daily_readiness', label: 'Previous day activity', description: 'Contribution of previous day activity.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.previous_night', resourceId: 'daily_readiness', label: 'Previous night', description: 'Contribution of previous night sleep.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.recovery_index', resourceId: 'daily_readiness', label: 'Recovery index', description: 'Contribution of recovery index.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.resting_heart_rate', resourceId: 'daily_readiness', label: 'Resting heart rate', description: 'Contribution of resting heart rate.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.sleep_balance', resourceId: 'daily_readiness', label: 'Sleep balance', description: 'Contribution of sleep balance.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_readiness.contributors.sleep_regularity', resourceId: 'daily_readiness', label: 'Sleep regularity', description: 'Contribution of sleep regularity.', unit: 'score', category: 'score', chartable: true },
]

const dailySleepMetrics: MetricDefinition[] = [
  { id: 'daily_sleep.score', resourceId: 'daily_sleep', label: 'Sleep score', description: 'Daily sleep score.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.deep_sleep', resourceId: 'daily_sleep', label: 'Deep sleep', description: 'Contribution of deep sleep.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.efficiency', resourceId: 'daily_sleep', label: 'Efficiency', description: 'Contribution of sleep efficiency.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.latency', resourceId: 'daily_sleep', label: 'Latency', description: 'Contribution of sleep latency.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.rem_sleep', resourceId: 'daily_sleep', label: 'REM sleep', description: 'Contribution of REM sleep.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.restfulness', resourceId: 'daily_sleep', label: 'Restfulness', description: 'Contribution of sleep restfulness.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.timing', resourceId: 'daily_sleep', label: 'Timing', description: 'Contribution of sleep timing.', unit: 'score', category: 'score', chartable: true },
  { id: 'daily_sleep.contributors.total_sleep', resourceId: 'daily_sleep', label: 'Total sleep', description: 'Contribution of total sleep.', unit: 'score', category: 'score', chartable: true },
]

const dailyStressMetrics: MetricDefinition[] = [
  { id: 'daily_stress.stress_high', resourceId: 'daily_stress', label: 'Stress high', description: 'High stress duration.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'daily_stress.recovery_high', resourceId: 'daily_stress', label: 'Recovery high', description: 'High recovery duration.', unit: 'sec', category: 'duration', chartable: true },
]

const dailyResilienceMetrics: MetricDefinition[] = [
  { id: 'daily_resilience.level', resourceId: 'daily_resilience', label: 'Resilience level', description: 'Long-term resilience level.', unit: 'level', category: 'ordinal', chartable: true, ordinalLabels: { 1: 'limited', 2: 'adequate', 3: 'solid', 4: 'strong', 5: 'exceptional' } },
  { id: 'daily_resilience.contributors.sleep_recovery', resourceId: 'daily_resilience', label: 'Sleep recovery', description: 'Sleep recovery contributor.', unit: 'score', category: 'quantity', chartable: true },
  { id: 'daily_resilience.contributors.daytime_recovery', resourceId: 'daily_resilience', label: 'Daytime recovery', description: 'Daytime recovery contributor.', unit: 'score', category: 'quantity', chartable: true },
  { id: 'daily_resilience.contributors.stress', resourceId: 'daily_resilience', label: 'Stress', description: 'Stress contributor.', unit: 'score', category: 'quantity', chartable: true },
]

const dailySpo2Metrics: MetricDefinition[] = [
  { id: 'daily_spo2.average', resourceId: 'daily_spo2', label: 'Average SpO2', description: 'Nightly oxygen saturation average.', unit: '%', category: 'quantity', chartable: true },
  { id: 'daily_spo2.breathing_disturbance_index', resourceId: 'daily_spo2', label: 'Breathing disturbance index', description: 'Breathing disturbance index.', unit: 'index', category: 'quantity', chartable: true },
]

const cardiovascularAgeMetrics: MetricDefinition[] = [
  { id: 'daily_cardiovascular_age.vascular_age', resourceId: 'daily_cardiovascular_age', label: 'Vascular age', description: 'Predicted vascular age.', unit: 'years', category: 'quantity', chartable: true },
]

const vo2Metrics: MetricDefinition[] = [
  { id: 'vo2_max.value', resourceId: 'vo2_max', label: 'VO2 max', description: 'VO2 max estimate.', unit: 'ml/kg/min', category: 'quantity', chartable: true },
]

const sleepMetrics: MetricDefinition[] = [
  { id: 'sleep.total_sleep_duration', resourceId: 'sleep', label: 'Total sleep duration', description: 'Total sleep duration.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.time_in_bed', resourceId: 'sleep', label: 'Time in bed', description: 'Time spent in bed.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.bedtime_start_minutes', resourceId: 'sleep', label: 'Bedtime start', description: 'Bedtime start as minutes from midnight.', unit: 'min', category: 'quantity', chartable: true },
  { id: 'sleep.deep_sleep_duration', resourceId: 'sleep', label: 'Deep sleep duration', description: 'Duration in deep sleep.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.light_sleep_duration', resourceId: 'sleep', label: 'Light sleep duration', description: 'Duration in light sleep.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.rem_sleep_duration', resourceId: 'sleep', label: 'REM sleep duration', description: 'Duration in REM sleep.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.awake_time', resourceId: 'sleep', label: 'Awake time', description: 'Awake time.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.efficiency', resourceId: 'sleep', label: 'Efficiency', description: 'Sleep efficiency.', unit: 'score', category: 'score', chartable: true },
  { id: 'sleep.latency', resourceId: 'sleep', label: 'Latency', description: 'Sleep latency.', unit: 'sec', category: 'duration', chartable: true },
  { id: 'sleep.lowest_heart_rate', resourceId: 'sleep', label: 'Lowest heart rate', description: 'Lowest heart rate during sleep.', unit: 'bpm', category: 'rate', chartable: true },
  { id: 'sleep.average_heart_rate', resourceId: 'sleep', label: 'Average heart rate', description: 'Average heart rate during sleep.', unit: 'bpm', category: 'rate', chartable: true },
  { id: 'sleep.average_hrv', resourceId: 'sleep', label: 'Average HRV', description: 'Average heart rate variability during sleep.', unit: 'ms', category: 'quantity', chartable: true },
  { id: 'sleep.readiness_score_delta', resourceId: 'sleep', label: 'Readiness score delta', description: 'Effect on readiness score.', unit: 'score', category: 'score', chartable: true },
  { id: 'sleep.sleep_score_delta', resourceId: 'sleep', label: 'Sleep score delta', description: 'Effect on sleep score.', unit: 'score', category: 'score', chartable: true },
  { id: 'sleep.type', resourceId: 'sleep', label: 'Sleep type', description: 'Sleep type classification.', unit: 'type', category: 'ordinal', chartable: true, ordinalLabels: { 0: 'deleted', 1: 'rest', 2: 'sleep', 3: 'late_nap', 4: 'long_sleep' } },
]

const heartRateMetrics: MetricDefinition[] = [
  { id: 'heartrate.bpm', resourceId: 'heartrate', label: 'Heart rate', description: 'Heart rate samples.', unit: 'bpm', category: 'rate', chartable: true },
]

const workoutMetrics: MetricDefinition[] = [
  { id: 'workout.calories', resourceId: 'workout', label: 'Workout calories', description: 'Calories burned in workout.', unit: 'kcal', category: 'quantity', chartable: true },
  { id: 'workout.distance', resourceId: 'workout', label: 'Workout distance', description: 'Distance traveled during workout.', unit: 'm', category: 'quantity', chartable: true },
  { id: 'workout.duration_minutes', resourceId: 'workout', label: 'Workout duration', description: 'Workout duration in minutes.', unit: 'min', category: 'duration', chartable: true },
  { id: 'workout.intensity', resourceId: 'workout', label: 'Workout intensity', description: 'Workout intensity classification.', unit: 'level', category: 'ordinal', chartable: true, ordinalLabels: { 1: 'easy', 2: 'moderate', 3: 'hard' } },
  { id: 'workout.source', resourceId: 'workout', label: 'Workout source', description: 'Workout source classification.', unit: 'source', category: 'ordinal', chartable: true, ordinalLabels: { 1: 'manual', 2: 'autodetected', 3: 'confirmed', 4: 'workout_heart_rate' } },
]

const tagMetrics: MetricDefinition[] = [
  { id: 'tag.count', resourceId: 'tag', label: 'Tag count', description: 'Tag event count.', unit: 'count', category: 'event', chartable: true },
]

const enhancedTagMetrics: MetricDefinition[] = [
  { id: 'enhanced_tag.count', resourceId: 'enhanced_tag', label: 'Enhanced tag count', description: 'Enhanced tag event count.', unit: 'count', category: 'event', chartable: true },
]

export const metricDefinitions: MetricDefinition[] = [
  ...dailyActivityMetrics,
  ...dailyReadinessMetrics,
  ...dailySleepMetrics,
  ...dailyStressMetrics,
  ...dailyResilienceMetrics,
  ...dailySpo2Metrics,
  ...cardiovascularAgeMetrics,
  ...vo2Metrics,
  ...sleepMetrics,
  ...heartRateMetrics,
  ...workoutMetrics,
  ...tagMetrics,
  ...enhancedTagMetrics,
]

export const metricDefinitionsById = new Map(metricDefinitions.map((metric) => [metric.id, metric] as const))
export const resourceDefinitionsById = new Map(resourceDefinitions.map((resource) => [resource.id, resource] as const))

export const chartableMetricDefinitions = metricDefinitions.filter((metric) => metric.chartable)

export const resourceIds = resourceDefinitions.map((resource) => resource.id)

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

export function resourceIdsForSync(requested?: ResourceId[]): ResourceId[] {
  if (requested && requested.length > 0) {
    return requested
  }
  return resourceDefinitions.map((resource) => resource.id)
}

export function ensureMetricIds(metricIds: string[]): string[] {
  return metricIds.filter((metricId) => metricDefinitionsById.has(metricId))
}

export const groupMetricsByResource = (): Map<ResourceId, MetricDefinition[]> => {
  const grouped = new Map<ResourceId, MetricDefinition[]>()
  for (const resource of resourceDefinitions) {
    grouped.set(resource.id, metricDefinitions.filter((metric) => metric.resourceId === resource.id))
  }
  return grouped
}

export const metricGroupsByResource = groupMetricsByResource()

export const resourceZodSchema = z.object({
  resourceIds: z.array(resourceSchema).optional(),
})

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1),
      }),
    )
    .optional(),
  screenContext: z.record(z.string(), z.unknown()).optional(),
  model: z.string().trim().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(16).max(8192).optional(),
})

export function nowIso(): string {
  return new Date().toISOString()
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function coerceStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    const filtered = items.map((entry) => entry.trim()).filter(Boolean)
    return filtered.length > 0 ? filtered : undefined
  }

  if (typeof value === 'string') {
    const filtered = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return filtered.length > 0 ? filtered : undefined
  }

  return undefined
}

export function normalizeDateString(value: string): string {
  const parsed = parseISO(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return value.length >= 10 ? value.slice(0, 10) : formatISO(parsed, { representation: 'date' })
}

export function resolveDateRange(input?: Partial<DateRangeInput> & { lookbackDays?: number }): DateRangeInput {
  const endDate = input?.endDate ?? formatISO(new Date(), { representation: 'date' })
  if (input?.startDate) {
    return { startDate: normalizeDateString(input.startDate), endDate: normalizeDateString(endDate) }
  }
  const lookbackDays = input?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS
  return {
    startDate: formatISO(subDays(parseISO(`${endDate}T00:00:00.000Z`), lookbackDays), { representation: 'date' }),
    endDate: normalizeDateString(endDate),
  }
}

export function safeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function average(values: number[]): number | null {
  if (values.length === 0) {
    return null
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) {
    return null
  }
  const mean = average(values)
  if (mean === null) {
    return null
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function pearsonCorrelation(left: number[], right: number[]): number | null {
  const sampleSize = Math.min(left.length, right.length)
  if (sampleSize < 3) {
    return null
  }
  const x = left.slice(0, sampleSize)
  const y = right.slice(0, sampleSize)
  const xMean = average(x)
  const yMean = average(y)
  if (xMean === null || yMean === null) {
    return null
  }
  let numerator = 0
  let xDenominator = 0
  let yDenominator = 0
  for (let index = 0; index < sampleSize; index += 1) {
    const dx = x[index] - xMean
    const dy = y[index] - yMean
    numerator += dx * dy
    xDenominator += dx ** 2
    yDenominator += dy ** 2
  }
  const denominator = Math.sqrt(xDenominator * yDenominator)
  if (!denominator) {
    return null
  }
  return numerator / denominator
}

export function formatMaybeNumber(value: number | null, fractionDigits = 1): string {
  if (value === null || Number.isNaN(value)) {
    return 'n/a'
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: value % 1 === 0 ? 0 : Math.min(fractionDigits, 1),
  }).format(value)
}

export function safeJsonStringify(value: unknown, space = 2, maxLength = 12000): string {
  const json = JSON.stringify(value, null, space)
  if (!json) {
    return 'null'
  }
  if (json.length <= maxLength) {
    return json
  }
  return `${json.slice(0, maxLength)}\n...<truncated>`
}

export function formatMetricValue(metric: MetricDefinition, value: number | null, textValue?: string | null): string {
  if (metric.category === 'ordinal' || metric.category === 'text') {
    return textValue ?? 'n/a'
  }
  if (value === null) {
    return 'n/a'
  }
  if (metric.unit === 'sec') {
    return `${Math.round(value)} sec`
  }
  if (metric.unit === 'min') {
    return `${Math.round(value)} min`
  }
  if (metric.unit === 'kcal') {
    return `${Math.round(value)} kcal`
  }
  if (metric.unit === 'steps' || metric.unit === 'count' || metric.unit === 'm' || metric.unit === 'years') {
    return `${formatMaybeNumber(value, value % 1 === 0 ? 0 : 1)} ${metric.unit}`
  }
  if (metric.unit === 'bpm' || metric.unit === 'score' || metric.unit === '%') {
    return `${formatMaybeNumber(value, value % 1 === 0 ? 0 : 1)} ${metric.unit}`
  }
  return formatMaybeNumber(value)
}

export function metricOrdinalValue(metricId: string, rawText: string | null | undefined): number | null {
  const metric = metricDefinitionsById.get(metricId)
  if (!metric || !metric.ordinalLabels || !rawText) {
    return null
  }
  for (const [ordinalKey, label] of Object.entries(metric.ordinalLabels)) {
    if (label === rawText) {
      return Number(ordinalKey)
    }
  }
  return null
}

export function inferChartableMetricIds(): string[] {
  return chartableMetricDefinitions.map((metric) => metric.id)
}

export function dayOrTimestamp(input: { day?: string | null; timestamp?: string | null }, fallback: string): {
  x: string
  xType: ChartXType
} {
  if (isNonEmptyString(input.timestamp)) {
    return { x: input.timestamp, xType: 'timestamp' }
  }
  if (isNonEmptyString(input.day)) {
    return { x: normalizeDateString(input.day), xType: 'day' }
  }
  return { x: fallback, xType: 'timestamp' }
}

export function chooseLatestTimestamp(left: string | null, right: string | null): string | null {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return left > right ? left : right
}

export function percentileNormalized(values: number[], value: number): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  if (min === max) {
    return 0.5
  }
  return clamp((value - min) / (max - min), 0, 1)
}

export function chartPointComparator(left: ChartPoint, right: ChartPoint): number {
  if (left.x === right.x) {
    return 0
  }
  return left.x < right.x ? -1 : 1
}

export function dateWindowLabel(startDate: string, endDate: string): string {
  return `${startDate} → ${endDate}`
}
