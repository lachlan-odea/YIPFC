import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PoolProvider, captureJoinLink } from './lib/store'
import './styles.css'

registerSW({ immediate: true })
captureJoinLink()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PoolProvider>
        <App />
      </PoolProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
