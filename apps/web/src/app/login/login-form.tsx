'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { api, isApiError } from '@/lib/api';
import { Alert, Button, Card } from '@/components/ui';

export function LoginForm({ mode, supabaseUrl, supabaseAnonKey }: { mode: 'dev' | 'supabase'; supabaseUrl: string | null; supabaseAnonKey: string | null }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const supabase = mode === 'supabase' && supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

  // Supabase magic-link return: exchange the verified access token for an app session.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!data.session) return;
        await api('/api/auth/session', { body: { accessToken: data.session.access_token } });
        await supabase.auth.signOut({ scope: 'local' });
        window.location.href = '/';
      })
      .catch((err: unknown) => setMsg({ tone: 'error', text: isApiError(err) ? err.message : 'Could not complete sign-in. Request a new link.' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'dev') {
        await api('/api/auth/dev-login', { body: { email } });
        window.location.href = '/';
      } else if (supabase) {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/login` } });
        if (error) throw new Error(error.message);
        setMsg({ tone: 'info', text: 'Check your email for a sign-in link.' });
      } else {
        setMsg({ tone: 'error', text: 'Supabase auth is selected but SUPABASE_URL / SUPABASE_ANON_KEY are not configured.' });
      }
    } catch (err) {
      setMsg({ tone: 'error', text: isApiError(err) ? err.message : err instanceof Error ? err.message : 'Sign-in failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <form onSubmit={submit} className="space-y-4">
        {mode === 'dev' && <Alert tone="warn" title="Development login">Email-only sign-in with no password. This mode is refused when APP_ENV=production.</Alert>}
        <label className="block text-sm font-medium">
          Work email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="you@company.com"
          />
        </label>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : mode === 'dev' ? 'Continue' : 'Email me a sign-in link'}
        </Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </form>
    </Card>
  );
}
