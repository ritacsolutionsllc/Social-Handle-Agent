'use client';
import { api } from '@/lib/api';
import { Button } from './ui';

export function LogoutButton() {
  return (
    <Button variant="ghost" size="sm" onClick={async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); window.location.href = '/login'; }}>
      Sign out
    </Button>
  );
}
