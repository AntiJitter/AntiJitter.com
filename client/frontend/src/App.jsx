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

  useEffect(() => {
    // Give Wails runtime a moment to inject window.go
    const check = () => {
      callGo('IsLoggedIn')
        .then(loggedIn => setScreen(loggedIn ? 'dashboard' : 'login'))
        .catch(() => setTimeout(check, 100))
    }
    check()
  }, [])

  if (screen === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" />
      </div>
    )
  }

  return screen === 'dashboard'
    ? <Dashboard onLogout={() => setScreen('login')} />
    : <Login onSuccess={() => setScreen('dashboard')} />
}
