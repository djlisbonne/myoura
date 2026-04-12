import { RefreshCw, ShieldCheck } from 'lucide-react'
import type { OuraAuthStatus } from '../lib/api'

interface SyncControlsProps {
  onSync: () => void
  onAuthorize: () => void
  syncDisabled?: boolean
  apiMode: 'api' | 'demo'
  statusText: string
  auth?: OuraAuthStatus
  busy?: boolean
}

export function SyncControls({
  onSync,
  onAuthorize,
  syncDisabled,
  apiMode,
  statusText,
  auth,
  busy,
}: SyncControlsProps) {
  const needsAuth = auth?.hasClientCredentials && !auth?.connected

  return (
    <div className="sync-controls">
      <div className="sync-controls__status">
        <span className={`status-chip status-chip--${apiMode === 'api' ? 'positive' : 'neutral'}`}>
          <ShieldCheck size={14} />
          {apiMode === 'api' ? 'API live' : 'Demo fallback'}
        </span>
        <p>{statusText}</p>
      </div>

      <div className="sync-controls__actions">
        {needsAuth ? (
          <button type="button" className="secondary-button" onClick={onAuthorize} disabled={busy}>
            Authorize Oura
          </button>
        ) : null}
        <button type="button" className="primary-button" onClick={onSync} disabled={busy || syncDisabled}>
          <RefreshCw size={15} />
          Sync now
        </button>
      </div>
    </div>
  )
}
