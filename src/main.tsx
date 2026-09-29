import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MobileApp from './mobile/MobileApp'
import { initializePlatform, platform } from './platform'
import { initializeSymbols } from './icons'
import './styles.css'
import './mobile/mobile.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
void initializePlatform()
  .then(() =>
    initializeSymbols().catch((error) => {
      console.error('Could not load macOS symbols', error)
    }),
  )
  .then(() =>
    root.render(<React.StrictMode>{platform.mobile ? <MobileApp /> : <App />}</React.StrictMode>),
  )
  .catch(() =>
    root.render(
      <main className="storage-startup">
        <h2>Could not start Stash</h2>
        <p>Your library has not been changed.</p>
        <button onClick={() => location.reload()}>Retry</button>
      </main>,
    ),
  )
