import type { AvailabilityStatus, Confidence } from '@sha/core';
import { Badge, cn } from './ui';

const STATUS: Record<AvailabilityStatus, { label: string; tone: 'green' | 'red' | 'amber' | 'orange' | 'slate' }> = {
  available: { label: 'Available', tone: 'green' },
  taken: { label: 'Taken', tone: 'red' },
  unknown: { label: 'Unknown', tone: 'amber' },
  rate_limited: { label: 'Rate limited', tone: 'orange' },
  error: { label: 'Error', tone: 'slate' },
};

export function StatusBadge({ status, simulated }: { status: AvailabilityStatus | 'unchecked' | 'invalid'; simulated?: boolean }) {
  if (status === 'unchecked') return <Badge tone="slate">Not checked</Badge>;
  if (status === 'invalid') return <Badge tone="slate">Invalid here</Badge>;
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} title={simulated ? 'Simulated result — no platform was contacted' : undefined}>
      {s.label}
      {simulated && <span className="font-semibold opacity-70">· sim</span>}
    </Badge>
  );
}

export function ConfidencePill({ confidence }: { confidence: Confidence }) {
  const bars = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600" title={`${confidence} confidence`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-2.5 w-1 rounded-sm', i <= bars ? 'bg-slate-600' : 'bg-slate-200')} />
        ))}
      </span>
      {confidence}
    </span>
  );
}

const MARK_COLORS = ['bg-slate-800', 'bg-pink-600', 'bg-blue-600', 'bg-zinc-900', 'bg-red-600', 'bg-sky-700', 'bg-rose-600', 'bg-orange-600', 'bg-yellow-400 text-slate-900', 'bg-neutral-800'];

/** Neutral monogram (we deliberately don't ship platform logos/trademarks). */
export function PlatformMark({ name, index }: { name: string; index: number }) {
  return (
    <span aria-hidden className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white', MARK_COLORS[index % MARK_COLORS.length])}>
      {name.replace(/[^A-Za-z]/g, '').slice(0, 2)}
    </span>
  );
}

export function SimulatedBanner() {
  return (
    <div role="status" data-testid="simulated-banner" className="rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-900 ring-1 ring-violet-300">
      <p className="font-semibold">Simulated data — mock availability provider</p>
      <p className="mt-0.5">
        These results come from deterministic fixtures. <strong>No social platform was contacted</strong>, and they say nothing about real
        availability. Set <code className="font-mono">AVAILABILITY_PROVIDER_MODE=live</code> on the server for real checks.
      </p>
    </div>
  );
}

export const ENTITY_LABEL: Record<string, string> = {
  user_account: 'Account username',
  business_page: 'Business page URL',
  channel_handle: 'Channel handle',
  linked_profile: 'Linked profile',
};
