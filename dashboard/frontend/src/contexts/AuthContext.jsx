import { createContext, useCallback, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const API = "";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading
  const [token, setToken] = useState(() => localStorage.getItem("aj_token"));

  // Validate stored token on mount
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((u) => setUser(u))
      .catch((status) => {
        if (status === 401) logout();
        else setUser(null);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Login failed");
    }
    const { token: t, user: u } = await res.json();
    localStorage.setItem("aj_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (email, password) => {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Registration failed");
    }
    const { token: t, user: u } = await res.json();
    localStorage.setItem("aj_token", t);
    setToken(t);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("aj_token");
    setToken(null);
    setUser(null);
  }, []);

  // Expose token for WebSocket usage
  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, loading: user === undefined }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

/** Fetch helper that injects Bearer token and auto-logouts on 401. */
export function useApiFetch() {
  const { token, logout } = useAuth();
  return useCallback(
    async (path, options = {}) => {
      const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
      if (res.status === 401) {
        logout();
        throw new Error("Session expired");
      }
      return res;
    },
    [token, logout]
  );
}
