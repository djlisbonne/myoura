import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent } from 'react'
import { Search } from 'lucide-react'
import './App.css'
import { ChatPanel } from './components/ChatPanel'
import { OverlayChart } from './components/OverlayChart'
import { SyncControls } from './components/SyncControls'
import {
  demoOuraSeries,
  defaultSelectedMetricIds,
  metricCatalog,
  rangeOptions,
  type MetricId,
} from './data/oura'
import {
  buildChatContext,
  computePairwiseRelationships,
} from './lib/analytics'
import {
  importOuraFile,
  loadDashboardRecords,
  probeHealth,
  sendChat,
  startOuraOAuth,
  syncOuraData,
  type OuraAuthStatus,
} from './lib/api'
import type { ChatMessage } from './lib/api'
import {
  buildOverlayChartData,
  type AxisSide,
  type DisplayMode,
  type XAxisMode,
} from './lib/chart'

const daysLabel = (days: number) => `${days}d`

function sliceWindow(days: number) {
  return demoOuraSeries.slice(-days)
}

function defaultAxisMap() {
  return metricCatalog.reduce<Record<MetricId, AxisSide | 'off'>>((accumulator, metric) => {
    accumulator[metric.id] = defaultSelectedMetricIds.includes(metric.id)
      ? ['readiness', 'sleepScore', 'steps', 'strain'].includes(metric.id)
        ? 'left'
        : 'right'
      : 'off'
    return accumulator
  }, {} as Record<MetricId, AxisSide | 'off'>)
}

function App() {
  const [metricAxisMap, setMetricAxisMap] = useState<Record<MetricId, AxisSide | 'off'>>(defaultAxisMap)
  const [selectedWindow, setSelectedWindow] = useState(30)
  const [displayMode, setDisplayMode] = useState<DisplayMode>('raw')
  const [xAxisMode, setXAxisMode] = useState<XAxisMode>('date')
  const [metricQuery, setMetricQuery] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Ask about the metrics in view. The chart configuration and selected series are sent with every prompt.',
    },
  ])
  const [chatInput, setChatInput] = useState('')
  const [isPending, startTransition] = useTransition()
  const [isBusy, setIsBusy] = useState(false)
  const [apiMode, setApiMode] = useState<'api' | 'demo'>('demo')
  const [syncStatus, setSyncStatus] = useState('Connecting to local API...')
  const [records, setRecords] = useState(() => sliceWindow(30))
  const [ouraAuth, setOuraAuth] = useState<OuraAuthStatus | undefined>()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let active = true

    void probeHealth().then((result) => {
      if (!active) {
        return
      }

      setApiMode(result.mode)
      setOuraAuth(result.ouraAuth)

      const params = new URLSearchParams(window.location.search)
      const authResult = params.get('oura')
      const authReason = params.get('reason')
      if (authResult === 'connected') {
        setSyncStatus('Oura account connected locally. Sync whenever you want to pull fresh data.')
        window.history.replaceState({}, '', window.location.pathname)
        return
      }
      if (authResult === 'error') {
        setSyncStatus(`Oura connection failed: ${authReason ?? 'unknown error'}`)
        window.history.replaceState({}, '', window.location.pathname)
        return
      }

      setSyncStatus(
        result.connected
          ? result.documentCount > 0
            ? 'Local API reachable. Chart is using stored Oura data.'
            : result.ouraAuth?.connected || result.ouraAuth?.hasPersonalAccessToken
              ? 'Local API reachable. Auth is ready; sync when you want live data.'
              : result.ouraAuth?.hasClientCredentials
                ? 'Local API reachable. Use Connect Oura to enable live sync.'
                : 'Local API reachable. Running on demo data until you connect or import.'
          : 'Local API unavailable. The app is running on demo data.',
      )
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    void (async () => {
      const liveRecords = await loadDashboardRecords(selectedWindow)
      if (!active) {
        return
      }

      if (liveRecords && liveRecords.length > 0) {
        setRecords(liveRecords)
        setApiMode('api')
        return
      }

      setRecords(sliceWindow(selectedWindow))
      setApiMode('demo')
    })()

    return () => {
      active = false
    }
  }, [selectedWindow])

  const activeRecords = useMemo(() => records, [records])
  const visibleMetricIds = useMemo(
    () => metricCatalog
      .map((metric) => metric.id)
      .filter((metricId) => metricAxisMap[metricId] !== 'off'),
    [metricAxisMap],
  )
  const chartData = useMemo(
    () => buildOverlayChartData(activeRecords, visibleMetricIds),
    [activeRecords, visibleMetricIds],
  )
  const relationships = useMemo(
    () => computePairwiseRelationships(activeRecords, visibleMetricIds),
    [activeRecords, visibleMetricIds],
  )
  const chatContext = useMemo(
    () => ({
      ...buildChatContext(activeRecords, visibleMetricIds, relationships, daysLabel(selectedWindow)),
      xAxisMode,
      displayMode,
      axisAssignments: visibleMetricIds.map((metricId) => ({
        metricId,
        axis: metricAxisMap[metricId],
      })),
    }),
    [activeRecords, displayMode, metricAxisMap, relationships, selectedWindow, visibleMetricIds, xAxisMode],
  )
  const filteredMetrics = useMemo(() => {
    const query = metricQuery.trim().toLowerCase()
    if (!query) {
      return metricCatalog
    }

    return metricCatalog.filter((metric) =>
      [metric.label, metric.category, metric.unit, metric.description].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
  }, [metricQuery])

  const handleMetricAxisChange = (metricId: MetricId, axis: AxisSide | 'off') => {
    startTransition(() => {
      setMetricAxisMap((current) => ({
        ...current,
        [metricId]: axis,
      }))
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
      setSyncStatus(
        response.mode === 'api'
          ? 'Chat request sent to `/api/chat`.'
          : 'Chat API missing, so the answer was generated from the visible demo context.',
      )
    } finally {
      setIsBusy(false)
    }
  }

  const handleSync = async () => {
    setIsBusy(true)

    try {
      const result = await syncOuraData()
      setApiMode(result.mode)
      setSyncStatus(result.message ?? 'Sync request completed.')
      const liveRecords = await loadDashboardRecords(selectedWindow)
      if (liveRecords && liveRecords.length > 0) {
        setRecords(liveRecords)
      }
    } finally {
      setIsBusy(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setIsBusy(true)

    try {
      const result = await importOuraFile(file)
      setApiMode(result.mode)
      setSyncStatus(result.message ?? `Imported ${file.name}.`)
      const liveRecords = await loadDashboardRecords(selectedWindow)
      if (liveRecords && liveRecords.length > 0) {
        setRecords(liveRecords)
      }
    } finally {
      setIsBusy(false)
    }
  }

  const leftCount = visibleMetricIds.filter((metricId) => metricAxisMap[metricId] === 'left').length
  const rightCount = visibleMetricIds.filter((metricId) => metricAxisMap[metricId] === 'right').length
  const latestRelationship = relationships[0]

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="sr-only"
        onChange={handleImportFile}
      />

      <header className="topbar">
        <div className="topbar__intro">
          <span className="topbar__eyebrow">Oura Local</span>
          <h1>Compose the view, keep the data central.</h1>
          <p>
            Browse metrics, assign axes, and switch between raw values, normalized overlays, and relative movement
            without leaving the chart.
          </p>
        </div>

        <SyncControls
          onSync={handleSync}
          onImportClick={handleImportClick}
          onConnectOura={startOuraOAuth}
          showConnectOura={Boolean(!ouraAuth?.connected && !ouraAuth?.hasPersonalAccessToken && ouraAuth?.hasClientCredentials)}
          apiMode={apiMode}
          statusText={syncStatus}
          busy={isBusy}
        />
      </header>

      <main className="workspace">
        <aside className="controls-pane">
          <section className="control-block">
            <div className="control-block__header">
              <span className="control-label">X-axis</span>
              <span className="control-hint">Change the horizontal read.</span>
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
              <span className="control-hint">Switch between absolute and comparative views.</span>
            </div>
            <div className="segmented-control segmented-control--stacked">
              {(['raw', 'normalized', 'relative'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`segment ${displayMode === mode ? 'segment--active' : ''}`}
                  onClick={() => setDisplayMode(mode)}
                >
                  {mode === 'raw' ? 'Raw' : mode === 'normalized' ? 'Relative units' : 'Percent from baseline'}
                </button>
              ))}
            </div>
          </section>

          <section className="control-block">
            <div className="control-block__header">
              <span className="control-label">Window</span>
              <span className="control-hint">{activeRecords.length} samples loaded.</span>
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

          <section className="control-block control-block--metrics">
            <div className="control-block__header">
              <span className="control-label">Metric browser</span>
              <span className="control-hint">{visibleMetricIds.length} in chart</span>
            </div>

            <label className="search-input">
              <Search size={15} />
              <input
                value={metricQuery}
                onChange={(event) => setMetricQuery(event.target.value)}
                placeholder="Search metrics, units, categories"
              />
            </label>

            <div className="metric-list">
              {filteredMetrics.map((metric) => {
                const axis = metricAxisMap[metric.id]
                return (
                  <article className="metric-row" key={metric.id}>
                    <div className="metric-row__meta">
                      <span className="metric-dot" style={{ backgroundColor: metric.color }} />
                      <div>
                        <div className="metric-row__topline">
                          <strong>{metric.label}</strong>
                          <span>{metric.unit}</span>
                        </div>
                        <p>{metric.description}</p>
                        <small>{metric.category}</small>
                      </div>
                    </div>
                    <div className="metric-axis-picker">
                      {(['off', 'left', 'right'] as const).map((side) => (
                        <button
                          key={side}
                          type="button"
                          className={`axis-chip ${axis === side ? 'axis-chip--active' : ''}`}
                          onClick={() => handleMetricAxisChange(metric.id, side)}
                          disabled={isPending}
                        >
                          {side === 'off' ? 'Off' : side === 'left' ? 'Left' : 'Right'}
                        </button>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
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

          <OverlayChart
            chartData={chartData}
            visibleMetricIds={visibleMetricIds}
            axisByMetric={metricAxisMap}
            displayMode={displayMode}
            xAxisMode={xAxisMode}
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
