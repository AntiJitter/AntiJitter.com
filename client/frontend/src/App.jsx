import { Component, useState, useEffect } from 'react'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

// Thin wrapper around Wails Go bindings
const go = () => window?.go?.main?.App

export function callGo(method, ...args) {
  return go()?.[method]?.(...args) ?? Promise.reject('Wails not ready')
}

export function onEvent(event, cb) {
  window?.runtime?.EventsOn(event, cb)
}

export function offEvent(event) {
  window?.runtime?.EventsOff(event)
}

const loadingStyle = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  padding: 28,
  textAlign: 'center',
  background: '#0a0a0a',
  color: '#f5f5f7'
}

const spinnerStyle = {
  width: 28,
  height: 28,
  border: '3px solid rgba(255, 255, 255, 0.12)',
  borderTopColor: '#00c8d7',
  borderRadius: '50%',
  animation: 'app-spin 0.8s linear infinite'
}

const errorStyle = {
  maxWidth: 320,
  color: '#ff453a',
  fontSize: 13,
  lineHeight: 1.4
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={loadingStyle}>
          <div style={{ fontWeight: 800 }}>AntiJitter UI failed to render</div>
          <div style={errorStyle}>{String(this.state.error?.message ?? this.state.error)}</div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [screen, setScreen] = useState('loading') // 'loading' | 'login' | 'dashboard'
  const [startupError, setStartupError] = useState('')

  useEffect(() => {
    // Give Wails runtime a moment to inject window.go
    let attempts = 0
    let cancelled = false
    const check = () => {
      attempts += 1
      callGo('IsLoggedIn')
        .then(loggedIn => {
          if (!cancelled) setScreen(loggedIn ? 'dashboard' : 'login')
        })
        .catch(() => {
          if (cancelled) return
          if (attempts > 50) {
            setStartupError('AntiJitter runtime did not start. Close the app and run antijitter.exe again as Administrator.')
            setScreen('login')
            return
          }
          setTimeout(check, 100)
        })
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (screen === 'loading') {
    return (
      <div style={loadingStyle}>
        <style>{'@keyframes app-spin { to { transform: rotate(360deg); } }'}</style>
        <div style={spinnerStyle} />
        <div style={{ fontWeight: 800 }}>Starting AntiJitter</div>
        {startupError && <div style={errorStyle}>{startupError}</div>}
      </div>
    )
  }

  return (
    <ErrorBoundary>
      {startupError && (
        <div style={{ ...errorStyle, padding: '10px 14px' }}>
          {startupError}
        </div>
      )}
      {screen === 'dashboard'
        ? <Dashboard onLogout={() => setScreen('login')} />
        : <Login onSuccess={() => setScreen('dashboard')} />}
    </ErrorBoundary>
  )
}
