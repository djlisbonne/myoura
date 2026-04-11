import { format, subDays } from 'date-fns'

export type MetricCategory =
  | 'Recovery'
  | 'Sleep'
  | 'Activity'
  | 'Physiology'

export interface MetricDefinition {
  id: string
  label: string
  unit: string
  category: MetricCategory
  color: string
  description: string
  precision?: number
}

export const metricCatalog = [
  {
    id: 'readiness',
    label: 'Readiness',
    unit: 'score',
    category: 'Recovery',
    color: '#7dd3fc',
    description: 'Composite recovery signal from overnight biometrics and sleep.',
    precision: 0,
  },
  {
    id: 'sleepScore',
    label: 'Sleep score',
    unit: 'score',
    category: 'Sleep',
    color: '#86efac',
    description: 'Oura sleep quality score across duration, efficiency, and timing.',
    precision: 0,
  },
  {
    id: 'sleepEfficiency',
    label: 'Sleep efficiency',
    unit: '%',
    category: 'Sleep',
    color: '#fbbf24',
    description: 'Fraction of time in bed spent asleep.',
    precision: 0,
  },
  {
    id: 'hrv',
    label: 'HRV',
    unit: 'ms',
    category: 'Recovery',
    color: '#a78bfa',
    description: 'Nightly heart rate variability, a recovery and stress proxy.',
    precision: 0,
  },
  {
    id: 'restingHeartRate',
    label: 'Resting HR',
    unit: 'bpm',
    category: 'Physiology',
    color: '#fb7185',
    description: 'Lowest nightly resting heart rate.',
    precision: 0,
  },
  {
    id: 'steps',
    label: 'Steps',
    unit: 'steps',
    category: 'Activity',
    color: '#22d3ee',
    description: 'Total daily steps accumulated during the day.',
    precision: 0,
  },
  {
    id: 'strain',
    label: 'Strain',
    unit: 'score',
    category: 'Activity',
    color: '#f97316',
    description: 'Load from activity, recovery impact, and duration.',
    precision: 1,
  },
  {
    id: 'bedtimeConsistency',
    label: 'Bedtime consistency',
    unit: 'min',
    category: 'Sleep',
    color: '#c084fc',
    description: 'Spread of bedtime timing over the recent window.',
    precision: 0,
  },
  {
    id: 'bodyTempDelta',
    label: 'Temperature delta',
    unit: '°C',
    category: 'Physiology',
    color: '#fda4af',
    description: 'Deviation from personal baseline.',
    precision: 2,
  },
] as const satisfies readonly MetricDefinition[]

export type MetricId = (typeof metricCatalog)[number]['id']

export interface OuraDay {
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
}

export const defaultSelectedMetricIds: MetricId[] = [
  'readiness',
  'sleepScore',
  'sleepEfficiency',
  'hrv',
]

export const rangeOptions = [7, 14, 30, 60] as const

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const seededNoise = (index: number, salt: number) => {
  const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453
  return raw - Math.floor(raw) - 0.5
}

export function createDemoOuraSeries(days = 60): OuraDay[] {
  const today = new Date()

  return Array.from({ length: days }, (_, index) => {
    const dayIndex = days - 1 - index
    const day = subDays(today, dayIndex)
    const wave = Math.sin(index / 6.1)
    const weekly = Math.cos(index / 3.5)
    const stressSpike = index % 15 === 11 ? 1.6 : 0
    const recoveryLift = index % 12 === 4 ? 1.1 : 0

    const strain = clamp(
      8.3 + wave * 1.3 + weekly * 0.5 + stressSpike + seededNoise(index, 1) * 0.9,
      4.2,
      16.2,
    )
    const sleepEfficiency = clamp(
      86.5 - wave * 3.8 + recoveryLift + seededNoise(index, 2) * 2.4,
      68,
      98,
    )
    const sleepScore = clamp(
      78 + sleepEfficiency * 0.22 + recoveryLift * 2.4 - strain * 0.55 + seededNoise(index, 3) * 5,
      58,
      97,
    )
    const hrv = clamp(
      54 + (sleepEfficiency - 84) * 0.9 - strain * 1.35 + recoveryLift * 5 + seededNoise(index, 4) * 4.3,
      28,
      104,
    )
    const restingHeartRate = clamp(
      57.5 - (sleepEfficiency - 84) * 0.17 + strain * 0.42 - recoveryLift * 0.9 + seededNoise(index, 5) * 1.7,
      47,
      68,
    )
    const readiness = clamp(
      74 + (sleepScore - 76) * 0.38 + (hrv - 50) * 0.27 - (restingHeartRate - 56) * 1.7 - (strain - 8) * 1.3 + seededNoise(index, 6) * 3.7,
      36,
      99,
    )
    const steps = Math.round(
      clamp(
        7600 + wave * 1200 + weekly * 850 + (strain - 8) * 420 + seededNoise(index, 7) * 950,
        2200,
        16800,
      ),
    )
    const bedtimeConsistency = clamp(
      34 - weekly * 6 - recoveryLift * 5 + seededNoise(index, 8) * 3.2,
      8,
      58,
    )
    const bodyTempDelta = clamp(
      (strain - 8.2) * 0.05 - (sleepEfficiency - 85) * 0.018 + seededNoise(index, 9) * 0.035,
      -0.42,
      0.42,
    )

    return {
      date: format(day, 'yyyy-MM-dd'),
      readiness,
      sleepScore,
      sleepEfficiency,
      hrv,
      restingHeartRate,
      steps,
      strain,
      bedtimeConsistency,
      bodyTempDelta,
    }
  })
}

export const demoOuraSeries = createDemoOuraSeries()

export function getMetricDefinition(metricId: MetricId) {
  return metricCatalog.find((metric) => metric.id === metricId)!
}

export function getMetricValue(day: OuraDay, metricId: MetricId) {
  return day[metricId]
}

export function formatMetricValue(metricId: MetricId, value: number) {
  const definition = getMetricDefinition(metricId)
  const precision = definition.precision ?? 0

  if (definition.unit === 'steps') {
    return value.toLocaleString()
  }

  if (definition.unit === '%') {
    return `${value.toFixed(precision)}%`
  }

  if (definition.unit === '°C') {
    return `${value.toFixed(precision)}°`
  }

  return `${value.toFixed(precision)} ${definition.unit}`
}

export function latestRecord(series: OuraDay[]) {
  return series[series.length - 1] ?? null
}

