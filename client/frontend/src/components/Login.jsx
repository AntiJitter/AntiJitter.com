import { useState } from 'react'
import { callGo } from '../App'
import './Login.css'

export default function Login({ onSuccess }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await callGo('Login', email, password)
      onSuccess()
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="login-icon">◈</div>
        <h1>AntiJitter</h1>
        <p>Bonded Gaming Network</p>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <p className="login-footer">
        app.antijitter.com
      </p>
    </div>
  )
}
