import { useEffect, useMemo, useState, useTransition } from 'react'
import './App.css'
import { ChatPanel } from './components/ChatPanel'
import { MetricBrowser } from './components/MetricBrowser'
import { OverlayChart } from './components/OverlayChart'
import { SleepTimingPanel, type SleepTimingMode } from './components/SleepTimingPanel'
import { SyncControls } from './components/SyncControls'
import {
  buildMetricCatalog,
  defaultSelectedMetricIds,
  formatMetricValue,
  metricPresets,
  rangeOptions,
  type MetricDefinition,
} from './data/oura'
import { buildChatContext, computePairwiseRelationships } from './lib/analytics'
import {
  completeOuraTokenAuthFromHash,
  fetchChart,
  fetchSources,
  probeHealth,
  sendChat,
  startOuraOAuth,
  syncOuraData,
  type ChartSeries,
  type ChatMessage,
  type OuraAuthStatus,
  type SourceGroupView,
} from './lib/api'
import { type AxisSide, type DisplayMode, type XAxisMode } from './lib/chart'

const sleepTimingMetricIds = [
  'sleep.bedtime_start_minutes',
  'sleep.bedtime_end_minutes',
  'sleep.bedtime_duration_minutes',
  'sleep_time.optimal_bedtime.start_offset_minutes',
  'sleep_time.optimal_bedtime.end_offset_minutes',
  'sleep.total_sleep_duration_minutes',
  'sleep.time_in_bed_minutes',
]

const daysLabel = (days: number) => `${days}d`

function defaultAxisForMetric(metric: MetricDefinition): AxisSide {
  if (metric.metricId.includes('bedtime') || metric.metricId.includes('duration') || metric.unit === 'min' || metric.unit === 'sec') {
    return 'right'
  }
  return 'left'
}

function buildAxisMap(metrics: MetricDefinition[], metricIds: string[]) {
  return metrics.reduce<Record<string, AxisSide | 'off'>>((accumulator, metric) => {
    accumulator[metric.metricId] = metricIds.includes(metric.metricId) ? defaultAxisForMetric(metric) : 'off'
    return accumulator
  }, {})
}

function detectPreset(presets: ReturnType<typeof metricPresets>, selectedMetricIds: string[]) {
  const selected = [...selectedMetricIds].sort().join('|')
  return presets.find((preset) => [...preset.metricIds].sort().join('|') === selected)?.id ?? 'custom'
}

function sourceLabelsForSelection(groups: SourceGroupView[], selectedMetricIds: string[]) {
  return groups
    .filter((group) => group.metrics.some((metric) => selectedMetricIds.includes(metric.metricId)))
    .map((group) => group.label)
}

function App() {
  const [selectedWindow, setSelectedWindow] = useState(30)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('raw')
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>('date')
  const [metricQuery, setMetricQuery] = useState('')
  const [sleepTimingMode, setSleepTimingMode] = useState<SleepTimingMode>('bedtime')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Ask about the metrics in view. The visible chart state is injected with each prompt.',
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [isPending, startTransition] = useTransition()
  const [isBusy, setIsBusy] = useState(false)
  const [apiMode, setApiMode] = useState<'api' | 'demo'>('demo')
  const [syncStatus, setSyncStatus] = useState('Connecting to local API...')
  const [sources, setSources] = useState<SourceGroupView[]>([])
  const [mainSeries, setMainSeries] = useState<ChartSeries[]>([])
  const [sleepTimingSeries, setSleepTimingSeries] = useState<ChartSeries[]>([])
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>([])
  const [metricAxisMap, setMetricAxisMap] = useState<Record<string, AxisSide | 'off'>>({})
  const [ouraAuth, setOuraAuth] = useState<OuraAuthStatus | undefined>()

  useEffect(() => {
    let active = true

    void (async () => {
      const tokenAuthResult = await completeOuraTokenAuthFromHash()
      const result = await probeHealth()
      if (!active) {
        return
      }

      setApiMode(result.mode)
      setOuraAuth(result.ouraAuth)

      const params = new URLSearchParams(window.location.search)
      const authResult = params.get('oura')
      const authReason = params.get('reason')

      if (tokenAuthResult?.connected || authResult === 'connected') {
        setSyncStatus('Oura access token captured locally. Sync now will pull live V2 resources.')
        window.history.replaceState({}, '', window.location.pathname)
        return
      }

      if (authResult === 'error') {
        setSyncStatus(`Oura authorization failed: ${authReason ?? 'unknown error'}`)
        window.history.replaceState({}, '', window.location.pathname)
        return
      }

      if (!result.connected) {
        setSyncStatus('Local API unavailable. The interface is not connected to the server.')
        return
      }

      if (result.ouraAuth?.connected) {
        setSyncStatus('Local API reachable. OAuth token is stored and sync is available.')
        return
      }

      if (result.ouraAuth?.hasClientCredentials) {
        setSyncStatus('Local API reachable. OAuth app is configured, but no user token is stored yet.')
        return
      }

      setSyncStatus('Local API reachable. Oura OAuth app credentials are not configured.')
    })()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      const sourceResponse = await fetchSources(selectedWindow)
      if (!active || !sourceResponse) {
        return
      }

      setSources(sourceResponse.sources)
      setApiMode('api')
    })()

    return () => {
      active = false
    }
  }, [selectedWindow])

  const metricCatalog = useMemo(() => buildMetricCatalog(sources), [sources])
  const chartableMetrics = useMemo(() => metricCatalog.filter((metric) => metric.chartable), [metricCatalog])
  const metricMap = useMemo(() => new Map(metricCatalog.map((metric) => [metric.metricId, metric] as const)), [metricCatalog])
  const availableMetricIds = useMemo(() => chartableMetrics.map((metric) => metric.metricId), [chartableMetrics])
  const presets = useMemo(() => metricPresets(availableMetricIds), [availableMetricIds])

  useEffect(() => {
    if (availableMetricIds.length === 0) {
      setSelectedMetricIds([])
      setMetricAxisMap({})
      return
    }

    setSelectedMetricIds((current) => {
      const next = current.filter((metricId) => availableMetricIds.includes(metricId))
      return next.length > 0 ? next : defaultSelectedMetricIds(availableMetricIds)
    })
  }, [availableMetricIds])

  useEffect(() => {
    if (chartableMetrics.length === 0 || selectedMetricIds.length === 0) {
      return
    }

    setMetricAxisMap((current) => {
      const next = { ...buildAxisMap(chartableMetrics, selectedMetricIds), ...current }
      for (const metric of chartableMetrics) {
        if (!(metric.metricId in next)) {
          next[metric.metricId] = 'off'
        }
        if (selectedMetricIds.includes(metric.metricId) && next[metric.metricId] === 'off') {
          next[metric.metricId] = defaultAxisForMetric(metric)
        }
      }
      return next
    })
  }, [chartableMetrics, selectedMetricIds])

  useEffect(() => {
    let active = true

    void (async () => {
      if (selectedMetricIds.length === 0) {
        setMainSeries([])
        return
      }

      const response = await fetchChart(selectedMetricIds, selectedWindow)
      if (!active || !response) {
        return
      }

      setMainSeries(response.series)
      setApiMode('api')
    })()

    return () => {
      active = false
    }
  }, [selectedMetricIds, selectedWindow])

  useEffect(() => {
    let active = true

    void (async () => {
      const requested = sleepTimingMetricIds.filter((metricId) => availableMetricIds.includes(metricId))
      if (requested.length === 0) {
        setSleepTimingSeries([])
        return
      }

      const response = await fetchChart(requested, selectedWindow)
      if (!active || !response) {
        return
      }

      setSleepTimingSeries(response.series)
    })()

    return () => {
      active = false
    }
  }, [availableMetricIds, selectedWindow])

  const filteredMetrics = useMemo(() => {
    const query = metricQuery.trim().toLowerCase()
    if (!query) {
      return chartableMetrics
    }

    return chartableMetrics.filter((metric) =>
      [metric.label, metric.category, metric.metricId, metric.resourceLabel, metric.unit ?? '', metric.description]
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [chartableMetrics, metricQuery])

  const visibleSeries = useMemo(
    () => mainSeries.filter((entry) => selectedMetricIds.includes(entry.metricId) && metricAxisMap[entry.metricId] !== 'off'),
    [mainSeries, metricAxisMap, selectedMetricIds],
  )

  const visibleMetricIds = useMemo(() => visibleSeries.map((entry) => entry.metricId), [visibleSeries])
  const activePresetId = useMemo(() => detectPreset(presets, visibleMetricIds), [presets, visibleMetricIds])
  const relationships = useMemo(() => computePairwiseRelationships(visibleSeries, metricMap), [metricMap, visibleSeries])
  const sourceLabels = useMemo(() => sourceLabelsForSelection(sources, visibleMetricIds), [sources, visibleMetricIds])
  const chatContext = useMemo(
    () => ({
      ...buildChatContext(visibleSeries, metricMap, relationships, daysLabel(selectedWindow), sourceLabels),
      xAxisMode,
      displayMode,
      axisAssignments: visibleMetricIds.map((metricId) => ({
        metricId,
        axis: metricAxisMap[metricId] ?? 'off',
      })),
    }),
    [displayMode, metricAxisMap, metricMap, relationships, selectedWindow, sourceLabels, visibleMetricIds, visibleSeries, xAxisMode],
  )

  const handleMetricAxisChange = (metricId: string, axis: AxisSide | 'off') => {
    startTransition(() => {
      setMetricAxisMap((current) => ({ ...current, [metricId]: axis }))
      setSelectedMetricIds((current) => {
        if (axis === 'off') {
          return current.filter((entry) => entry !== metricId)
        }
        return current.includes(metricId) ? current : [...current, metricId]
      })
    })
  }

  const handlePresetChange = (presetId: string) => {
    const preset = presets.find((entry) => entry.id === presetId)
    if (!preset) {
      return
    }

    startTransition(() => {
      setSelectedMetricIds(preset.metricIds)
      setMetricAxisMap(buildAxisMap(chartableMetrics, preset.metricIds))
    })
  }

  const handleSendChat = async () => {
    const prompt = chatInput.trim()
    if (!prompt) {
      return
    }

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: prompt }]
    setMessages(nextMessages)
    setChatInput('')
    setIsBusy(true)

    try {
      const response = await sendChat({
        message: prompt,
        context: chatContext,
        messages: nextMessages,
      })

      setMessages((current) => [...current, { role: 'assistant', content: response.reply }])
      setApiMode(response.mode)
      setSyncStatus(response.mode === 'api' ? 'Chat request sent to `/api/chat`.' : 'Chat fell back to local context only.')
    } finally {
      setIsBusy(false)
    }
  }

  const refreshData = async () => {
    const [health, sourceResponse] = await Promise.all([probeHealth(), fetchSources(selectedWindow)])
    setOuraAuth(health.ouraAuth)
    setApiMode(health.mode)
    if (sourceResponse) {
      setSources(sourceResponse.sources)
    }
  }

  const handleSync = async () => {
    setIsBusy(true)
    try {
      const result = await syncOuraData()
      setApiMode(result.mode)
      setSyncStatus(result.message ?? 'Sync request completed.')
      await refreshData()
    } finally {
      setIsBusy(false)
    }
  }

  const latestRelationship = relationships[0]
  const leftCount = visibleMetricIds.filter((metricId) => metricAxisMap[metricId] === 'left').length
  const rightCount = visibleMetricIds.filter((metricId) => metricAxisMap[metricId] === 'right').length
  const latestMetrics = visibleSeries
    .slice(0, 4)
    .map((entry) => {
      const metric = metricMap.get(entry.metricId)
      const latestPoint = [...entry.points].reverse().find((point) => point.value !== null || point.textValue)
      if (!metric || !latestPoint) {
        return null
      }
      return {
        metricId: entry.metricId,
        label: metric.label,
        value: formatMetricValue(metric, latestPoint.value, latestPoint.textValue),
      }
    })
    .filter((entry): entry is { metricId: string; label: string; value: string } => Boolean(entry))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__intro">
          <span className="topbar__eyebrow">Oura Local</span>
          <h1>Compose any Oura metrics in one view.</h1>
          <p>
            The metric list now comes from the OpenAPI-backed local API model, so the interface can browse and overlay the broader
            V2 resource set instead of a fixed hand-picked dashboard.
          </p>
        </div>

        <SyncControls
          onSync={handleSync}
          onAuthorize={startOuraOAuth}
          syncDisabled={!ouraAuth?.connected}
          apiMode={apiMode}
          statusText={syncStatus}
          auth={ouraAuth}
          busy={isBusy}
        />
      </header>

      <main className="workspace">
        <aside className="controls-pane">
          <section className="control-block">
            <div className="control-block__header">
              <span className="control-label">X-axis</span>
              <span className="control-hint">Date or sequence index.</span>
            </div>
            <div className="segmented-control">
              {(['date', 'sequence'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`segment ${xAxisMode === mode ? 'segment--active' : ''}`}
                  onClick={() => setXAxisMode(mode)}
                >
                  {mode === 'date' ? 'Date' : 'Sequence'}
                </button>
              ))}
            </div>
          </section>

          <section className="control-block">
            <div className="control-block__header">
              <span className="control-label">Units</span>
              <span className="control-hint">Absolute or comparative overlays.</span>
            </div>
            <div className="segmented-control segmented-control--stacked">
              {(['raw', 'normalized', 'relative'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`segment ${displayMode === mode ? 'segment--active' : ''}`}
                  onClick={() => setDisplayMode(mode)}
                >
                  {mode === 'raw' ? 'Raw units' : mode === 'normalized' ? 'Relative units' : 'Percent from baseline'}
                </button>
              ))}
            </div>
          </section>

          <section className="control-block">
            <div className="control-block__header">
              <span className="control-label">Window</span>
              <span className="control-hint">{sources.reduce((sum, group) => sum + group.documentCount, 0)} documents loaded.</span>
            </div>
            <div className="segmented-control">
              {rangeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`segment ${selectedWindow === option ? 'segment--active' : ''}`}
                  onClick={() => setSelectedWindow(option)}
                >
                  {daysLabel(option)}
                </button>
              ))}
            </div>
          </section>

          <MetricBrowser
            metrics={filteredMetrics}
            selectedMetricIds={visibleMetricIds}
            axisByMetric={metricAxisMap}
            presets={presets}
            activePresetId={activePresetId}
            query={metricQuery}
            onQueryChange={setMetricQuery}
            onAxisChange={handleMetricAxisChange}
            onPresetChange={handlePresetChange}
            busy={isPending || isBusy}
          />
        </aside>

        <section className="chart-pane">
          <div className="chart-pane__header">
            <div>
              <span className="topbar__eyebrow">Analysis view</span>
              <h2>Custom overlay</h2>
            </div>
            <div className="chart-pane__stats">
              <span>{leftCount} left-axis series</span>
              <span>{rightCount} right-axis series</span>
              <span>{displayMode}</span>
            </div>
          </div>

          {latestMetrics.length > 0 ? (
            <div className="metric-browser__selected-list">
              {latestMetrics.map((metric) => (
                <span key={metric.metricId} className="metric-pill metric-pill--active">
                  <strong>{metric.label}</strong>
                  <span>{metric.value}</span>
                </span>
              ))}
            </div>
          ) : null}

          <OverlayChart
            series={visibleSeries}
            metricMap={metricMap}
            axisByMetric={metricAxisMap}
            displayMode={displayMode}
            xAxisMode={xAxisMode}
          />

          <SleepTimingPanel
            mode={sleepTimingMode}
            onModeChange={setSleepTimingMode}
            series={sleepTimingSeries}
            metricMap={metricMap}
          />

          <div className="chart-pane__footnote">
            <p>
              {latestRelationship
                ? `Current strongest relationship: ${latestRelationship.label}. ${latestRelationship.interpretation}`
                : 'Add at least two metrics to compare relationships over the active window.'}
            </p>
          </div>
        </section>
      </main>

      <section className="chat-section">
        <ChatPanel
          messages={messages}
          input={chatInput}
          onInputChange={setChatInput}
          onSubmit={handleSendChat}
          busy={isBusy}
          context={chatContext}
          apiMode={apiMode}
        />
      </section>
    </div>
  )
}

export default App
