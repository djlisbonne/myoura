import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent } from 'react'
import { Activity, BrainCircuit, ChevronRight, Clock3, Layers3, LoaderCircle, MoonStar, Radar, HeartPulse } from 'lucide-react'
import './App.css'
import { ChatPanel } from './components/ChatPanel'
import { MetricComposer } from './components/MetricComposer'
import { OverlayChart } from './components/OverlayChart'
import { Panel } from './components/Panel'
import { RelationshipPanel } from './components/RelationshipPanel'
import { SummaryCards } from './components/SummaryCards'
import { SyncControls } from './components/SyncControls'
import {
  demoOuraSeries,
  defaultSelectedMetricIds,
  formatMetricValue,
  getMetricDefinition,
  metricCatalog,
  rangeOptions,
  type MetricId,
} from './data/oura'
import {
  buildChatContext,
  computeMetricDeltas,
  computePairwiseRelationships,
} from './lib/analytics'
import { importOuraFile, loadDashboardRecords, probeHealth, sendChat, startOuraOAuth, syncOuraData, type OuraAuthStatus } from './lib/api'
import type { ChatMessage } from './lib/api'
import { buildOverlayChartData } from './lib/chart'

const daysLabel = (days: number) => `${days}d`

function sliceWindow(days: number) {
  return demoOuraSeries.slice(-days)
}

function App() {
  const [selectedMetricIds, setSelectedMetricIds] = useState<MetricId[]>(
    defaultSelectedMetricIds,
  )
  const [selectedWindow, setSelectedWindow] = useState(30)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Ask me to compare recovery, sleep, and activity. I will receive the dashboard context automatically.',
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

      const authResult = new URLSearchParams(window.location.search).get('oura')
      const authReason = new URLSearchParams(window.location.search).get('reason')
      if (authResult === 'connected') {
        setSyncStatus('Oura account connected locally. You can sync your ring data now.')
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
            ? 'Local API reachable. Stored Oura data is ready for the dashboard.'
            : result.ouraAuth?.connected || result.ouraAuth?.hasPersonalAccessToken
              ? 'Local API reachable. Connect complete; sync when you are ready.'
              : result.ouraAuth?.hasClientCredentials
                ? 'Local API reachable. Connect your Oura account to enable live sync.'
                : 'Local API reachable. Seeding demo data until you sync or import your own history.'
          : 'Local API unavailable. The dashboard is running on demo data.',
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
        setSyncStatus('Dashboard is rendering from the local API store.')
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
  const selectedMetrics = useMemo(
    () => selectedMetricIds.map((metricId) => getMetricDefinition(metricId)),
    [selectedMetricIds],
  )
  const chartData = useMemo(
    () => buildOverlayChartData(activeRecords, selectedMetricIds),
    [activeRecords, selectedMetricIds],
  )
  const metricDeltas = useMemo(
    () => computeMetricDeltas(activeRecords, ['readiness', 'sleepScore', 'hrv', 'restingHeartRate']),
    [activeRecords],
  )
  const relationships = useMemo(
    () => computePairwiseRelationships(activeRecords, selectedMetricIds),
    [activeRecords, selectedMetricIds],
  )
  const chatContext = useMemo(
    () => buildChatContext(activeRecords, selectedMetricIds, relationships, daysLabel(selectedWindow)),
    [activeRecords, relationships, selectedMetricIds, selectedWindow],
  )

  const currentRecord = activeRecords.at(-1)
  const recoveryHeadline = currentRecord
    ? `${formatMetricValue('readiness', currentRecord.readiness)} readiness, ${formatMetricValue(
        'sleepScore',
        currentRecord.sleepScore,
      )} sleep, ${formatMetricValue('hrv', currentRecord.hrv)} HRV`
    : 'No data loaded'

  const topRelationship = relationships[0]

  const handleToggleMetric = (metricId: MetricId) => {
    startTransition(() => {
      setSelectedMetricIds((current) => {
        if (current.includes(metricId)) {
          if (current.length === 1) {
            return current
          }

          return current.filter((entry) => entry !== metricId)
        }

        return [...current, metricId]
      })
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
          : 'Chat API missing, so the assistant answered from the local demo context.',
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

  return (
    <div className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="sr-only"
        onChange={handleImportFile}
      />

      <header className="hero">
        <div className="hero__copy">
          <div className="eyebrow-row">
            <span className="eyebrow">Local Oura intelligence</span>
            <span className="eyebrow eyebrow--subtle">Demo-first, API-ready</span>
          </div>
          <h1>View your Oura data as a living model, not a single metric page.</h1>
          <p className="hero__lede">
            Compose any overlay, inspect the relationships, and chat directly with GPT using the data that is
            visible on screen.
          </p>

          <div className="hero__highlights">
            <article className="mini-stat">
              <Clock3 size={16} />
              <div>
                <span>Window</span>
                <strong>{daysLabel(selectedWindow)}</strong>
              </div>
            </article>
            <article className="mini-stat">
              <Radar size={16} />
              <div>
                <span>Overlay series</span>
                <strong>{selectedMetricIds.length}</strong>
              </div>
            </article>
            <article className="mini-stat">
              <BrainCircuit size={16} />
              <div>
                <span>Chat context</span>
                <strong>{chatContext.selectedMetrics.length} fields</strong>
              </div>
            </article>
          </div>
        </div>

        <div className="hero__status">
          <SyncControls
            onSync={handleSync}
            onImportClick={handleImportClick}
            onConnectOura={startOuraOAuth}
            showConnectOura={Boolean(!ouraAuth?.connected && !ouraAuth?.hasPersonalAccessToken && ouraAuth?.hasClientCredentials)}
            apiMode={apiMode}
            statusText={syncStatus}
            busy={isBusy}
          />

          <div className="hero__stack">
            <div className="hero__stack-item">
              <MoonStar size={16} />
              <div>
                <span>Recovery signal</span>
                <strong>{recoveryHeadline}</strong>
              </div>
            </div>
            <div className="hero__stack-item">
              <Activity size={16} />
              <div>
                <span>Activity load</span>
                <strong>{currentRecord ? formatMetricValue('strain', currentRecord.strain) : '—'}</strong>
              </div>
            </div>
            <div className="hero__stack-item">
              <HeartPulse size={16} />
              <div>
                <span>Sleep efficiency</span>
                <strong>
                  {currentRecord ? formatMetricValue('sleepEfficiency', currentRecord.sleepEfficiency) : '—'}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="dashboard">
        <Panel
          eyebrow="Dashboard"
          title="Compose the view you actually want"
          description="Select any combination of metrics, then compare them on a shared time axis."
          action={
            <div className="range-picker" role="tablist" aria-label="Time window">
              {rangeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`range-button ${selectedWindow === option ? 'range-button--active' : ''}`}
                  onClick={() => {
                    startTransition(() => setSelectedWindow(option))
                  }}
                >
                  {daysLabel(option)}
                </button>
              ))}
            </div>
          }
        >
          <div className="dashboard__controls">
            <MetricComposer
              metrics={metricCatalog}
              selectedMetricIds={selectedMetricIds}
              onToggleMetric={handleToggleMetric}
              onReset={() => setSelectedMetricIds(defaultSelectedMetricIds)}
              busy={isPending}
            />
          </div>

          <SummaryCards deltas={metricDeltas} />
        </Panel>

        <div className="dashboard__grid">
          <Panel
            eyebrow="Overlay"
            title="Multi-metric trend map"
            description="The chart automatically normalizes each series so you can judge co-movement across unlike units."
            action={
              <span className="chart-note">
                {selectedMetrics.map((metric) => metric.label).join(' · ')}
              </span>
            }
            className="dashboard__chart-panel"
          >
            <OverlayChart
              records={activeRecords}
              selectedMetricIds={selectedMetricIds}
              chartData={chartData}
            />
          </Panel>

          <Panel
            eyebrow="Relationships"
            title="What moves together"
            description="This panel surfaces the strongest pairwise relationships in the active window."
            className="dashboard__insights-panel"
          >
            <RelationshipPanel relationships={relationships} />
            {topRelationship ? (
              <div className="insight-callout">
                <p className="insight-callout__eyebrow">Primary relationship</p>
                <strong>{topRelationship.label}</strong>
                <p>{topRelationship.interpretation}</p>
              </div>
            ) : null}
          </Panel>
        </div>

        <section className="dashboard__lower">
          <Panel
            eyebrow="AI"
            title="Ask directly about the dashboard"
            description="Every message includes the visible context so the model can answer against what you are seeing."
            className="dashboard__chat-panel"
          >
            <ChatPanel
              messages={messages}
              input={chatInput}
              onInputChange={setChatInput}
              onSubmit={handleSendChat}
              busy={isBusy}
              context={chatContext}
              apiMode={apiMode}
            />
          </Panel>

          <Panel
            eyebrow="Why it works"
            title="Interpretability first"
            description="A clean dashboard is only useful if it explains itself."
            className="dashboard__notes-panel"
          >
            <div className="notes-stack">
              <div className="notes-card">
                <Layers3 size={16} />
                <div>
                  <strong>Shared overlay</strong>
                  <p>Selected metrics are normalized together so relationships are visible without unit friction.</p>
                </div>
              </div>
              <div className="notes-card">
                <ChevronRight size={16} />
                <div>
                  <strong>Composable views</strong>
                  <p>Pick any subset of Oura data sources and compare them in one chart and one context packet.</p>
                </div>
              </div>
              <div className="notes-card">
                <LoaderCircle size={16} />
                <div>
                  <strong>Demo-first</strong>
                  <p>The UI starts with local synthetic data, then switches to live endpoints when they are available.</p>
                </div>
              </div>
            </div>
          </Panel>
        </section>
      </main>
    </div>
  )
}

export default App
