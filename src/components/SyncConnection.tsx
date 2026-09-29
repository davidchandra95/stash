import { platform } from '../platform'
import { useState } from 'react'
import { library } from '../storage/useLibrary'
import type { LibraryState } from '../storage/library'

export default function SyncConnection({ state }: { state: LibraryState }) {
  const [url, setUrl] = useState(state.syncStatus?.url || 'https://stash.slowtyper.cloud')
  const [token, setToken] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const disabled = saving || state.syncing || state.converting || state.quitting || state.preview
  return (
    <form
      className="sync-connection"
      onSubmit={(event) => {
        event.preventDefault()
        setSaving(true)
        setError('')
        setMessage('')
        void library
          .configureSync(url, token)
          .then(() => {
            setToken('')
            setMessage('Connection saved. Use Sync to sync your notes.')
          })
          .catch((error) => setError(String(error)))
          .finally(() => setSaving(false))
      }}
    >
      <p>
        Connect your private library. Notes sync only when you press Sync. Folder-linked notes and
        device settings stay on their original device.
      </p>
      {state.preview && <p>Open the Stash app to set up sync.</p>}
      <label htmlFor="sync-server-url">Server URL</label>
      <input
        id="sync-server-url"
        className="text-field"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
        disabled={disabled}
      />
      <label htmlFor="sync-device-token">Device token</label>
      <input
        id="sync-device-token"
        className="text-field"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        required
        disabled={disabled}
        aria-describedby="sync-token-help"
      />
      <p id="sync-token-help">
        {platform.mobile ? (
          'The device token is encrypted with Android Keystore. Enter a new token to update the connection.'
        ) : (
          <>
            {state.syncStatus?.configured
              ? 'A device token is saved in macOS Keychain. Enter a new token to update the connection.'
              : 'The device token is stored in macOS Keychain.'}
          </>
        )}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="sync-connection-actions">
        <button className="primary-button" type="submit" disabled={disabled || !token.trim()}>
          {saving ? 'Connecting…' : 'Save connection'}
        </button>
      </div>
    </form>
  )
}
