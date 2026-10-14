import { redirect } from 'next/navigation';
import { readSession } from '@/server/session';
import { runtime } from '@/server/runtime';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  if (await readSession()) redirect('/');
  const s = runtime().settings;
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Each user gets an isolated workspace. Checks and jobs are only visible inside your workspace.</p>
      <LoginForm mode={s.AUTH_MODE} supabaseUrl={s.SUPABASE_URL ?? null} supabaseAnonKey={s.SUPABASE_ANON_KEY ?? null} />
    </div>
  );
}
