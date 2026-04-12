import { FileDown, Link2, RefreshCw, ShieldCheck } from 'lucide-react'

interface SyncControlsProps {
  onSync: () => void
  onImportClick: () => void
  onConnectOura?: () => void
  showConnectOura?: boolean
  syncDisabled?: boolean
  apiMode: 'api' | 'demo'
  statusText: string
  busy?: boolean
}

export function SyncControls({
  onSync,
  onImportClick,
  onConnectOura,
  showConnectOura,
  syncDisabled,
  apiMode,
  statusText,
  busy,
}: SyncControlsProps) {
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
        {showConnectOura ? (
          <button type="button" className="secondary-button" onClick={onConnectOura} disabled={busy}>
            <Link2 size={15} />
            Authorize Oura
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={onImportClick} disabled={busy}>
          <FileDown size={15} />
          Import export
        </button>
        <button type="button" className="primary-button" onClick={onSync} disabled={busy || syncDisabled}>
          <RefreshCw size={15} />
          Sync now
        </button>
      </div>
    </div>
  )
}
