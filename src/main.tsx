import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MobileApp from './mobile/MobileApp'
import { AppTooltipProvider } from './components/AppTooltip'
import { initializePlatform, platform } from './platform'
import './styles.css'
import './mobile/mobile.css'
import { useDesktopWindowAppearance } from './useDesktopWindowAppearance'

function StartupFailure() {
  const surface = React.useRef<HTMLDivElement>(null)
  useDesktopWindowAppearance(surface, true, true, 'startup-error')
  return (
    <div ref={surface} className="storage-startup" data-theme="dark">
      <h2>Could not start Stash</h2>
      <p>Your library has not been changed.</p>
      <button onClick={() => location.reload()}>Retry</button>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
void initializePlatform()
  .then(() =>
    root.render(
      <React.StrictMode>
        <AppTooltipProvider>{platform.mobile ? <MobileApp /> : <App />}</AppTooltipProvider>
      </React.StrictMode>,
    ),
  )
  .catch(() => root.render(<StartupFailure />))
