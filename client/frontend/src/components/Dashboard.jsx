import { useState, useEffect, useCallback } from 'react'
import { callGo, onEvent, offEvent } from '../App'
import './Dashboard.css'

const EMPTY_STATUS = {
  active: false,
  paths: [],
  data_used_mb: 0,
  data_limit_mb: 50000,
  dev_route_all: true
}

export default function Dashboard({ onLogout }) {
  const [status, setStatus] = useState(EMPTY_STATUS)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState(false)

  // Load initial state and subscribe to live updates
  useEffect(() => {
    callGo('GetStatus').then(s => s && setStatus(s)).catch(() => {})

    onEvent('status', s => setStatus(s))
    onEvent('connecting', v => setConnecting(v))
    onEvent('state-changed', active => {
      if (!active) {
        setStatus(s => ({ ...EMPTY_STATUS, dev_route_all: s.dev_route_all ?? true }))
      }
    })

    return () => {
      offEvent('status')
      offEvent('connecting')
      offEvent('state-changed')
    }
  }, [])

  const toggle = useCallback(async () => {
    setError('')
    setToggling(true)
    try {
      await callGo('Toggle')
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Failed to toggle Game Mode')
    } finally {
      setToggling(false)
    }
  }, [])

  const logout = useCallback(async () => {
    await callGo('Logout').catch(() => {})
    onLogout()
  }, [onLogout])

  const setRouteAll = useCallback(async (enabled) => {
    setError('')
    setStatus(s => ({ ...s, dev_route_all: enabled }))
    try {
      await callGo('SetDevRouteAll', enabled)
    } catch (err) {
      setStatus(s => ({ ...s, dev_route_all: !enabled }))
      setError(typeof err === 'string' ? err : 'Failed to change route-all mode')
    }
  }, [])

  const isOn = status.active
  const isBusy = toggling || connecting
  const pathCount = status.paths?.length ?? 0
  const dataUsed = status.data_used_mb ?? 0
  const dataLimit = status.data_limit_mb ?? 50000
  const dataPct = dataLimit > 0 ? Math.min(100, (dataUsed / dataLimit) * 100) : 0
  const dataBarColor = dataPct > 90 ? 'var(--orange)' : 'var(--teal)'
  const devRouteAll = status.dev_route_all ?? true

  return (
    <div className="dashboard">

      {/* Header */}
      <header className="dash-header">
        <div className="dash-logo">
          <span className="dash-logo-icon">AJ</span>
          <span className="dash-logo-text">AntiJitter</span>
        </div>
        <button className="btn-logout" onClick={logout}>Logout</button>
      </header>

      {/* Game Mode card */}
      <section className="gamemode-card">
        <div className="gamemode-indicator">
          <div className={`status-dot ${isOn ? 'on' : ''} ${isBusy ? 'busy' : ''}`} />
          <div className="gamemode-labels">
            <span className="gamemode-label">GAME MODE</span>
            <span className={`gamemode-state ${isOn ? 'on' : ''}`}>
              {connecting ? 'CONNECTING...' : isOn ? 'ACTIVE' : 'OFF'}
            </span>
          </div>
        </div>

        <button
          className={`btn-toggle ${isOn ? 'active' : ''}`}
          onClick={toggle}
          disabled={isBusy}
        >
          {isBusy ? (
            <span className="btn-spinner" />
          ) : isOn ? (
            'DEACTIVATE'
          ) : (
            'ACTIVATE'
          )}
        </button>

        {error && <div className="gamemode-error">{error}</div>}

        {isOn && pathCount > 0 && (
          <div className="gamemode-sub">
            {pathCount} path{pathCount !== 1 ? 's' : ''} bonded
          </div>
        )}
      </section>

      {/* Connections */}
      {(isOn && status.paths?.length > 0) && (
        <section className="section">
          <div className="section-label">CONNECTIONS</div>
          <div className="paths-grid">
            {status.paths.map(p => (
              <div key={p.name} className={`path-card ${p.active ? 'active' : 'inactive'}`}>
                <div className="path-top">
                  <div className={`path-dot ${p.active ? 'on' : 'off'}`} />
                  <span className="path-name">{p.name}</span>
                </div>
                <div className="path-bytes">
                  {p.bytes_mb < 1
                    ? `${(p.bytes_mb * 1024).toFixed(0)} KB`
                    : `${p.bytes_mb.toFixed(1)} MB`
                  } up
                  {typeof p.packets === 'number' && (
                    <span className="path-packets">{p.packets.toLocaleString()} pkts</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4G Data protection */}
      {isOn && (
        <section className="section">
          <div className="section-label-row">
            <span className="section-label">4G DATA PROTECTION</span>
            <span className="data-numbers">
              {dataUsed.toFixed(1)} / {(dataLimit / 1024).toFixed(0)} GB
            </span>
          </div>
          <div className="data-bar-bg">
            <div
              className="data-bar-fill"
              style={{ width: `${dataPct}%`, background: dataBarColor }}
            />
          </div>
          {dataPct > 90 && (
            <div className="data-warn">Approaching 4G data limit</div>
          )}
        </section>
      )}

      <section className="dev-route-row">
        <div>
          <div className="dev-route-title">DEV: route all traffic</div>
          <div className="dev-route-copy">PC traffic uses the bonded route while Game Mode starts.</div>
        </div>
        <label className={`switch ${devRouteAll ? 'on' : ''} ${isBusy || isOn ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={devRouteAll}
            disabled={isBusy || isOn}
            onChange={e => setRouteAll(e.target.checked)}
          />
          <span />
        </label>
      </section>

      {/* Footer */}
      <footer className="dash-footer">
        {isOn
          ? 'Traffic bonded across all connections'
          : 'Activate Game Mode to start bonding'}
      </footer>

    </div>
  )
}
