import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { AuthPage, ErrorMsg, Field, SubmitBtn } from "./Login";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await register(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPage title="Create your account">
      <form onSubmit={handleSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitBtn loading={loading}>Create account</SubmitBtn>
      </form>
      <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--dim)" }}>
        Already have an account?{" "}
        <Link to="/login" style={{ color: "var(--teal)" }}>
          Sign in
        </Link>
      </p>
    </AuthPage>
  );
}
