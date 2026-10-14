'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CheckReport, PlatformSummary } from '@sha/services';
import { api, isApiError } from '@/lib/api';
import { Alert, Button, Card } from '@/components/ui';
import { ENTITY_LABEL, PlatformMark } from '@/components/status';

export function CheckForm({ platforms }: { platforms: PlatformSummary[] }) {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [requestedHandle, setRequestedHandle] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<string[]>(platforms.map((p) => p.slug));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (slug: string) => setSelected((s) => (s.includes(slug) ? s.filter((x) => x !== slug) : [...s, slug]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const report = await api<CheckReport>('/api/check', {
        body: { input, ...(requestedHandle.trim() ? { requestedHandle: requestedHandle.trim() } : {}), platforms: selected },
      });
      router.push(`/checks/${report.id}`);
    } catch (err) {
      setError(isApiError(err) ? err.message : 'The check failed.');
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-sm font-medium">
          Company, brand or handle
          <input
            name="input"
            required
            maxLength={100}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Acme Robotics or @acmerobotics"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base"
          />
        </label>

        <div>
          <button type="button" className="text-sm text-indigo-700 hover:underline" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {advanced ? '− Hide' : '+ Exact desired handle (optional)'}
          </button>
          {advanced && (
            <label className="mt-2 block text-sm font-medium">
              Exact handle
              <input
                name="requestedHandle"
                maxLength={64}
                pattern="@?[A-Za-z0-9_.\-]+"
                value={requestedHandle}
                onChange={(e) => setRequestedHandle(e.target.value)}
                placeholder="acmerobotics"
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">Used as the primary candidate when valid; letters, numbers, _ . - only.</span>
            </label>
          )}
        </div>

        <fieldset>
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium">Platforms ({selected.length}/{platforms.length})</legend>
            <div className="flex gap-2 text-xs">
              <button type="button" className="text-indigo-700 hover:underline" onClick={() => setSelected(platforms.map((p) => p.slug))}>All</button>
              <button type="button" className="text-indigo-700 hover:underline" onClick={() => setSelected([])}>None</button>
            </div>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {platforms.map((p, i) => (
              <label key={p.slug} className="flex cursor-pointer items-center gap-2 rounded-lg p-2 ring-1 ring-slate-200 has-[:checked]:bg-indigo-50 has-[:checked]:ring-indigo-300">
                <input type="checkbox" checked={selected.includes(p.slug)} onChange={() => toggle(p.slug)} className="h-4 w-4 accent-indigo-600" />
                <PlatformMark name={p.name} index={i} />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{p.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{ENTITY_LABEL[p.entityType]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={busy || selected.length === 0 || !input.trim()}>
          {busy ? 'Checking platforms…' : 'Check availability'}
        </Button>
      </form>
    </Card>
  );
}
