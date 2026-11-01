import { html } from '../ui.js';
import { useState } from '../../vendor/hooks.mjs';
import { api } from '../api.js';

export function Login({ onDone }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    setBusy(true); setErr('');
    try { await api('login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return html`<div class="auth">
    <div class="auth__art"><p class="auth__quote">Every enquiry, scored and ready <em>before you pick up the phone.</em></p></div>
    <div class="auth__form"><form onSubmit=${submit}>
      <p class="eyebrow">Aurelle · Sales desk</p>
      <h1>Welcome back</h1>
      <label>Email<input class="input" name="email" type="email" autocomplete="username" required autofocus /></label>
      <label>Password<input class="input" name="password" type="password" autocomplete="current-password" required /></label>
      ${err ? html`<p class="err" role="alert">${err}</p>` : ''}
      <button class="btn btn--primary" disabled=${busy}>${busy ? 'Signing in…' : 'Sign in'}</button>
      <p class="muted" style=${{ fontSize: '12px' }}>Access is by invitation. Ask your sales manager for an invite.</p>
    </form></div></div>`;
}

export function AcceptInvite({ onDone }) {
  const token = new URLSearchParams(location.search).get('token');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('password') !== f.get('confirm')) { setErr('The passwords don’t match.'); return; }
    setBusy(true); setErr('');
    try { await api('accept-invite', { method: 'POST', body: { token, name: f.get('name'), password: f.get('password') } }); onDone(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return html`<div class="auth">
    <div class="auth__art"><p class="auth__quote">Join the team. <em>Hot leads arrive here first.</em></p></div>
    <div class="auth__form"><form onSubmit=${submit}>
      <p class="eyebrow">Aurelle · Sales desk</p>
      <h1>Set up your account</h1>
      <label>Your name<input class="input" name="name" autocomplete="name" required /></label>
      <label>Password (10+ characters)<input class="input" name="password" type="password" minlength="10" autocomplete="new-password" required /></label>
      <label>Confirm password<input class="input" name="confirm" type="password" minlength="10" autocomplete="new-password" required /></label>
      ${err ? html`<p class="err" role="alert">${err}</p>` : ''}
      <button class="btn btn--primary" disabled=${busy || !token}>${busy ? 'Creating…' : 'Create account'}</button>
    </form></div></div>`;
}
