import { useState, useEffect, useCallback } from 'react'
import { callGo, onEvent, offEvent } from '../App'
import './Dashboard.css'

const EMPTY_STATUS = {
  active: false,
  paths: [],
  data_used_mb: 0,
  data_limit_mb: 50000,
  dev_route_all: true,
  mode: 'normal',
  starlink: {
    detected: false,
    latency_ms: 0,
    checked_at: 0
  }
}

const MODES = {
  normal: {
    label: 'Normal',
    summary: 'Starlink first. Mobile data ready for satellite handoff.',
    detail: 'Best for downloads, updates, browsing, and leaving AntiJitter on.'
  },
  gaming: {
    label: 'Gaming',
    summary: 'Every packet is sent over Starlink and Mobile data.',
    detail: 'Best for gaming and real-time voice and video calls. Uses more Mobile data.'
  }
}

function formatMB(value = 0) {
  if (value < 1) return `${(value * 1024).toFixed(0)} KB`
  if (value >= 1024) return `${(value / 1024).toFixed(2)} GB`
  return `${value.toFixed(1)} MB`
}

function pathKind(path, index) {
  const name = (path?.name ?? '').toLowerCase()
  if (name.includes('starlink') || name.includes('ethernet')) return 'starlink'
  if (name.includes('mobile') || name.includes('4g') || name.includes('5g') || name.includes('wi-fi 2')) return 'mobile'
  return index === 0 ? 'starlink' : 'mobile'
}

function latencyClass(ms) {
  if (typeof ms !== 'number' || ms <= 0) return 'unknown'
  if (ms < 50) return 'good'
  if (ms < 100) return 'ok'
  if (ms < 200) return 'warn'
  return 'bad'
}

function appendLatencyHistory(history, paths = []) {
  if (!Array.isArray(paths)) return history
  const next = { ...history }
  paths.forEach((path, index) => {
    const key = `${path.name}-${index}`
    const value = typeof path.latency_ms === 'number' && path.latency_ms > 0 ? path.latency_ms : null
    next[key] = [...(next[key] ?? []), value].slice(-42)
  })
  return next
}

function LatencyChart({ paths, history }) {
  const max = 240
  const unplayable = 200
  const series = (paths ?? []).map((path, index) => ({
    key: `${path.name}-${index}`,
    name: path.name,
    kind: pathKind(path, index),
    latency: path.latency_ms,
    jitter: path.jitter_ms,
    values: history[`${path.name}-${index}`] ?? []
  })).filter(item => item.values.some(v => typeof v === 'number'))

  const width = 320
  const height = 96
  const pad = 10

  const pointsFor = (values) => {
    if (values.length < 2) return ''
    return values.map((value, index) => {
      const x = pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2)
      const yValue = typeof value === 'number' ? value : max
      const y = height - pad - (Math.min(max, yValue) / max) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }

  return (
    <section className="latency-card">
      <div className="section-label-row">
        <span className="section-label">Latency trend</span>
      </div>
      <svg className="latency-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Per-path latency trend">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} />
        <line className="latency-threshold" x1={pad} y1={height - pad - (unplayable / max) * (height - pad * 2)} x2={width - pad} y2={height - pad - (unplayable / max) * (height - pad * 2)} />
        {series.map(item => (
          <polyline
            key={item.key}
            className={`latency-line ${item.kind}`}
            points={pointsFor(item.values)}
          />
        ))}
      </svg>
      <div className="latency-legend">
        {series.length === 0 && <span>Waiting for path probes</span>}
        {series.map(item => (
          <span key={item.key} className={`legend-item ${item.kind}`}>
            {item.kind === 'starlink' ? 'Starlink' : 'Mobile data'}
            {typeof item.latency === 'number' && item.latency > 0 ? ` ${item.latency.toFixed(0)} ms` : ''}
            {typeof item.jitter === 'number' && item.jitter > 0 ? ` +/-${item.jitter.toFixed(0)}` : ''}
          </span>
        ))}
      </div>
    </section>
  )
}

export default function Dashboard({ onLogout }) {
  const [status, setStatus] = useState(EMPTY_STATUS)
  const [latencyHistory, setLatencyHistory] = useState({})
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    callGo('GetStatus').then(s => {
      if (!s) return
      setStatus({ ...EMPTY_STATUS, ...s, paths: Array.isArray(s.paths) ? s.paths : [] })
      setLatencyHistory(h => appendLatencyHistory(h, s.paths))
    }).catch(() => {})

    onEvent('status', s => {
      setStatus(prev => ({ ...prev, ...s, paths: Array.isArray(s.paths) ? s.paths : [] }))
      setLatencyHistory(h => appendLatencyHistory(h, s.paths))
    })
    onEvent('connecting', v => setConnecting(v))
    onEvent('state-changed', active => {
      if (!active) {
        setStatus(s => ({
          ...EMPTY_STATUS,
          dev_route_all: s.dev_route_all ?? true,
          mode: s.mode ?? 'normal'
        }))
        setLatencyHistory({})
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
      setError(typeof err === 'string' ? err : 'Failed to change connection state')
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

  const setMode = useCallback(async (mode) => {
    if (status.active || connecting || toggling) return
    const previousMode = status.mode ?? 'normal'
    setError('')
    setStatus(s => ({ ...s, mode }))
    try {
      await callGo('SetMode', mode)
    } catch (err) {
      setStatus(s => ({ ...s, mode: previousMode }))
      setError(typeof err === 'string' ? err : 'Failed to change mode')
    }
  }, [status.active, status.mode, connecting, toggling])

  const isOn = status.active
  const isBusy = toggling || connecting
  const mode = status.mode ?? 'normal'
  const modeInfo = MODES[mode] ?? MODES.normal
  const pathCount = status.paths?.length ?? 0
  const dataUsed = status.data_used_mb ?? 0
  const dataLimit = status.data_limit_mb ?? 50000
  const dataPct = dataLimit > 0 ? Math.min(100, (dataUsed / dataLimit) * 100) : 0
  const dataBarColor = dataPct > 90 ? 'var(--orange)' : 'var(--mobile)'
  const devRouteAll = status.dev_route_all ?? true
  const totalDown = status.paths?.reduce((sum, p) => sum + (p.rx_bytes_mb ?? 0), 0) ?? 0
  const totalDownPackets = status.paths?.reduce((sum, p) => sum + (p.rx_packets ?? 0), 0) ?? 0
  const starlink = status.starlink ?? EMPTY_STATUS.starlink
  const latencyValues = (status.paths ?? [])
    .map(p => p.latency_ms)
    .filter(v => typeof v === 'number' && v > 0)
  const bestLatency = latencyValues.length > 0 ? Math.min(...latencyValues) : null
  const statusLabel = connecting ? 'Connecting' : isOn ? 'Connected' : 'Idle'
  const connectionTitle = connecting
    ? 'Connecting'
    : isOn
      ? 'AntiJitter Active'
      : 'AntiJitter Off'
  const progressTitle = connecting
    ? 'Starting bonded tunnel'
    : toggling && isOn
      ? 'Stopping tunnel'
      : toggling
        ? 'Preparing connection'
        : ''
  const progressDetail = connecting
    ? 'Detecting adapters, pinning routes, opening bonding paths, and starting WireGuard. This can take a little while on Windows.'
    : toggling && isOn
      ? 'Removing tunnel routes and closing bonding sockets.'
      : toggling
        ? 'Preparing AntiJitter connection state.'
        : ''

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="brand-lockup">
          <div className="brand-title">
            <span>Anti</span><span>Jitter</span>
          </div>
          <div className="brand-subtitle">Windows gateway</div>
        </div>
        <div className="header-actions">
          <div className={`connection-pill ${isOn ? 'connected' : ''} ${connecting ? 'connecting' : ''}`}>
            <span />
            {statusLabel}
          </div>
          <button className="btn-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="dashboard-scroll">
        <section className={`connection-card ${isOn ? 'active' : ''}`}>
          <div className="connection-top">
            <div>
              <div className="connection-title">{connectionTitle}</div>
            </div>
            <div className={`status-dot ${isOn ? 'on' : ''} ${isBusy ? 'busy' : ''}`} />
          </div>

          {isOn && (
            <div className="compact-latency">
              <span>{mode === 'gaming' ? 'Bonded latency' : 'Best path latency'}</span>
              <strong className={`latency-value ${latencyClass(bestLatency)}`}>{bestLatency === null ? '--' : bestLatency.toFixed(0)}<em>ms</em></strong>
            </div>
          )}

          <div className={`mode-toggle in-connection ${isOn || isBusy ? 'locked' : ''}`}>
            {Object.entries(MODES).map(([key, item]) => (
              <button
                key={key}
                className={`mode-option ${mode === key ? 'selected' : ''}`}
                onClick={() => setMode(key)}
                disabled={isOn || isBusy}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            className={`btn-toggle ${isOn ? 'active' : ''}`}
            onClick={toggle}
            disabled={isBusy}
          >
            {isBusy ? <span className="btn-spinner" /> : isOn ? 'Disconnect' : 'Connect'}
          </button>

          {progressTitle && (
            <div className="connect-progress">
              <strong>{progressTitle}</strong>
              <span>{progressDetail}</span>
            </div>
          )}

          {error && <div className="panel-error">{error}</div>}

          <div className="connection-sub">
            {isOn ? `${pathCount} path${pathCount !== 1 ? 's' : ''} bonded in ${modeInfo.label} mode` : modeInfo.summary}
          </div>
          <div className={`mode-copy ${isOn ? 'active-chart' : ''}`}>
            {isOn && status.paths?.length > 0 ? (
              <LatencyChart paths={status.paths} history={latencyHistory} />
            ) : (
              <>
            <strong>{modeInfo.summary}</strong>
            <span>{modeInfo.detail}</span>
              </>
            )}
          </div>
        </section>

        {(isOn && status.paths?.length > 0) && (
          <>
            <section className="section">
              <div className="section-label-row">
                <span className="section-label">Active paths</span>
                <span className="section-meta">{pathCount} online</span>
              </div>
              <div className="paths-list">
                {status.paths.map((p, index) => {
                  const kind = pathKind(p, index)
                  return (
                    <div key={`${p.name}-${index}`} className={`path-card ${kind} ${p.active ? 'active' : 'inactive'}`}>
                      <div className="path-main">
                        <div className="path-top">
                          <div className={`path-dot ${p.active ? 'on' : 'off'}`} />
                          <div>
                            <span className={`path-kind ${kind}`}>{kind === 'starlink' ? 'Starlink' : 'Mobile data'}</span>
                            <span className="path-name">{p.name}</span>
                          </div>
                        </div>
                        <div className="path-metrics">
                          <span>{formatMB(p.rx_bytes_mb)} down</span>
                          <span>{(p.rx_packets ?? 0).toLocaleString()} packets</span>
                          {p.send_errors > 0 && <span className="path-errors">{p.send_errors.toLocaleString()} send errors</span>}
                        </div>
                      </div>
                      <div className={`path-latency ${kind} ${latencyClass(p.latency_ms)}`}>
                        {typeof p.latency_ms === 'number' && p.latency_ms > 0 ? (
                          <>
                            <strong>{p.latency_ms.toFixed(0)} ms</strong>
                            <span>jitter +/-{(p.jitter_ms ?? 0).toFixed(0)}</span>
                          </>
                        ) : (
                          <>
                            <strong>--</strong>
                            <span>measuring</span>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {isOn && (
          <section className="stats-grid">
            <div className="stat-card">
              <div className="section-label">Path traffic</div>
              <div className="stat-pair">
                <span>Down</span>
                <strong>{formatMB(totalDown)}</strong>
              </div>
              <div className="stat-pair">
                <span>Packets</span>
                <strong>{totalDownPackets.toLocaleString()}</strong>
              </div>
            </div>

            <div className="stat-card mobile-data">
              <div className="section-label">Mobile data</div>
              <div className="data-head">
                <strong>{formatMB(dataUsed)}</strong>
                <span>{(dataLimit / 1024).toFixed(0)} GB cap</span>
              </div>
              <div className="data-bar-bg">
                <div
                  className="data-bar-fill"
                  style={{ width: `${dataPct}%`, background: dataBarColor }}
                />
              </div>
            </div>
          </section>
        )}

        <section className="starlink-card">
          <div>
            <div className="section-label">Starlink</div>
            <div className="starlink-title">Dish statistics</div>
          </div>
          <div className={`starlink-state ${starlink.detected ? 'online' : ''}`}>
            {starlink.detected ? `${(starlink.latency_ms ?? 0).toFixed(0)} ms dish` : 'Not reachable'}
          </div>
        </section>

        <section className="dev-route-row">
          <div>
            <div className="dev-route-title">DEV: route all traffic</div>
            <div className="dev-route-copy">PC and shared devices use AntiJitter while connected.</div>
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
      </main>
    </div>
  )
}
