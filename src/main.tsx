import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MobileApp from './mobile/MobileApp'
import { AppTooltipProvider } from './components/AppTooltip'
import { initializePlatform, platform } from './platform'
import { useDesktopWindowAppearance } from './useDesktopWindowAppearance'

function StartupFailure() {
  const surface = React.useRef<HTMLDivElement>(null)
  useDesktopWindowAppearance(surface, true, true, 'startup-error')
  return (
    <div ref={surface} className="startup storage-startup">
      <h2>Couldn’t start Stash</h2>
      <p>Your library has not been changed.</p>
      <button className="btn" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
// Both platforms use the v2 design system; mobile adds touch geometry on top of it.
const loadStyles = async () => {
  if (platform.mobile) await import('./mobile/index.css')
  else await import('./styles/index.css')
}

void initializePlatform()
  .then(loadStyles)
  .then(() =>
    root.render(
      <React.StrictMode>
        <AppTooltipProvider>{platform.mobile ? <MobileApp /> : <App />}</AppTooltipProvider>
      </React.StrictMode>,
    ),
  )
  .catch(async () => {
    // Platform detection failed before styles loaded; show the error with desktop styles.
    await import('./styles/index.css').catch(() => {})
    root.render(<StartupFailure />)
  })
