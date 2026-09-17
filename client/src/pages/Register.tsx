import { FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";

export default function Register() {
  const [, setLocation] = useLocation();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token")?.trim() || "", []);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!token) return setError("This invitation link is missing its token.");
    if (password.length < 12) return setError("Password must be at least 12 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setSubmitting(true);
    try {
      const response = await fetch("/api/local/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ token, name, password }) });
      const result = await response.json() as { error?: string; success?: boolean };
      if (!response.ok) throw new Error(result.error || "Unable to accept invitation");
      setLocation("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to accept invitation");
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><span className="auth-orbit" /><span><strong>MYSTIC</strong> HOST</span></div><div className="auth-heading"><div className="auth-icon"><KeyRound size={19} /></div><span className="auth-eyebrow">Invitation registration</span><h1>Join your workspace</h1><p>Set up your local MYSTIC HOST account using the invitation you received.</p></div>{error && <div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit} className="auth-form"><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" maxLength={120} autoComplete="name" /></label><label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="At least 12 characters" minLength={12} maxLength={256} autoComplete="new-password" required /></label><label>Confirm password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" placeholder="Repeat your password" minLength={12} maxLength={256} autoComplete="new-password" required /></label><button className="auth-submit" disabled={submitting}>{submitting ? "Creating account…" : "Create account"}<ArrowRight size={15} /></button></form><div className="auth-security"><ShieldCheck size={14} /><span>Your invitation is single-use and your password is stored securely.</span></div><p className="auth-footer-link">Already have an account? <Link href="/">Return to sign in</Link></p></section></main>;
}
