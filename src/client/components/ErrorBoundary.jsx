/** Catches one crashed slot occupant so a chart bug cannot blank the panel. */

import * as React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  reset() {
    this.setState({ error: null })
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // The Harness logs slot crashes; keep the technical detail discoverable in
    // the console while the UI shows a calm, translated fallback.
    console.error('[session-stats] dashboard crashed', error, info)
  }

  render() {
    if (this.state.error) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error, this.reset)
        : null
    }
    return this.props.children
  }
}
