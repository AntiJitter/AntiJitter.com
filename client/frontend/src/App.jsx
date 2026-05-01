import { useState, useEffect } from 'react'
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
      <div className="app-loading">
        <div className="spinner" />
        {startupError && <div className="startup-error">{startupError}</div>}
      </div>
    )
  }

  return screen === 'dashboard'
    ? <Dashboard onLogout={() => setScreen('login')} />
    : <Login onSuccess={() => setScreen('dashboard')} />
}
