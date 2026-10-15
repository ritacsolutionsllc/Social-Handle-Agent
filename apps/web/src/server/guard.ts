import 'server-only';
import { redirect } from 'next/navigation';
import { readSession } from './session';

export async function requireSession() {
  const s = await readSession();
  if (!s) redirect('/login');
  return s;
}
