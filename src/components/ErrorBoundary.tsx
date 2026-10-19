import { Component, type ErrorInfo, type ReactNode } from 'react'

type State = { error: Error | null }

/**
 * Last line of defence: without this, a throw during render unmounts the
 * whole tree and the user sees a blank page with no hint of what went wrong.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[knowledgepool] render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="app">
        <div className="empty">
          <strong>KnowledgePool hit a snag</strong>
          <p style={{ wordBreak: 'break-word' }}>{this.state.error.message}</p>
          <button className="btn" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    )
  }
}
