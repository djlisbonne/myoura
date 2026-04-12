import { Bot, Sparkles, Send } from 'lucide-react'
import type { ChatContextSnapshot } from '../lib/analytics'
import type { ChatMessage } from '../lib/api'

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  context: ChatContextSnapshot
  apiMode: 'api' | 'demo'
}

export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSubmit,
  busy,
  context,
  apiMode,
}: ChatPanelProps) {
  return (
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div>
          <p className="chat-panel__eyebrow">AI assistant</p>
          <h3>Chat with your visible Oura context</h3>
        </div>
        <span className={`status-chip status-chip--${apiMode === 'api' ? 'positive' : 'warning'}`}>
          <Sparkles size={14} />
          {apiMode === 'api' ? 'API connected' : 'Demo context active'}
        </span>
      </div>

      <div className="chat-panel__context">
        <div className="chat-panel__context-title">
          <Bot size={14} />
          <span>Injected context</span>
        </div>
        <p>{context.headline}</p>
        <div className="chat-panel__context-metrics">
          {context.selectedMetrics.map((metric) => (
            <span key={metric.metricId} className="context-chip">
              {metric.label}: {metric.latest}
            </span>
          ))}
        </div>
      </div>

      <div className="chat-panel__history" aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}-${message.content.slice(0, 12)}`}
            className={`chat-bubble chat-bubble--${message.role}`}
          >
            {message.content}
          </div>
        ))}
      </div>

      <div className="chat-panel__composer">
        <label className="sr-only" htmlFor="chat-prompt">
          Chat prompt
        </label>
        <textarea
          id="chat-prompt"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Ask about recovery, sleep quality, correlations, or what to do next."
          rows={4}
        />
        <button type="button" className="primary-button" onClick={onSubmit} disabled={busy || !input.trim()}>
          <Send size={15} />
          {busy ? 'Thinking' : 'Send to GPT'}
        </button>
      </div>
    </div>
  )
}
