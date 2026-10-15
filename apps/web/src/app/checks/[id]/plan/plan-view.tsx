'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CreationPlan } from '@sha/services';
import { api, isApiError, type ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card } from '@/components/ui';
import { ENTITY_LABEL, SimulatedBanner, StatusBadge } from '@/components/status';

export const ACK_TEXT = 'I understand that account creation may require email/phone verification and must comply with each platform’s terms.';

export function PlanView({ checkId, handle, platforms }: { checkId: string; handle: string; platforms: string[] }) {
  const router = useRouter();
  const [plan, setPlan] = useState<CreationPlan | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // New inputs invalidate the previous plan and every confirmation made against it.
    setPlan(null);
    setConfirmed([]);
    setAck(false);
    setError(null);
    if (!handle || platforms.length === 0) {
      setError({ code: 'validation_error', message: 'Select a handle and at least one platform on the report first.', status: 400 });
      return;
    }
    let current = true; // ignore responses for superseded inputs
    api<CreationPlan>('/api/creation-plans', { body: { checkId, handle, platforms } })
      .then((p) => current && setPlan(p))
      .catch((e) => current && setError(isApiError(e) ? e : { code: 'internal_error', message: 'Could not build the plan.', status: 500 }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkId, handle, platforms.join(',')]);

  if (error && !plan) return <Alert tone="error">{error.message}</Alert>;
  if (!plan) return <p className="text-sm text-slate-500">Building creation plan…</p>;

  const actionable = plan.items.filter((i) => !i.blocked);
  const allConfirmed = actionable.length > 0 && actionable.every((i) => confirmed.includes(i.platform.slug));
  const canCreate = plan.creationEnabled && allConfirmed && ack && !busy;

  async function create() {
    setBusy(true);
    setError(null);
    const slugs = actionable.map((i) => i.platform.slug);
    try {
      await api('/api/creation-jobs', { body: { checkId, handle: plan!.handle, platforms: slugs, confirmedPlatforms: confirmed.filter((c) => slugs.includes(c)), acknowledgedTerms: ack } });
      router.push('/jobs');
    } catch (e) {
      setError(isApiError(e) ? e : { code: 'internal_error', message: 'Job creation failed.', status: 500 });
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">Creation plan</p>
          <h1 className="font-mono text-2xl font-semibold">@{plan.handle}</h1>
        </div>
        <Link href={`/checks/${checkId}`} className="text-sm text-indigo-700 hover:underline">← Back to report</Link>
      </div>

      {plan.simulated && <SimulatedBanner />}
      {!plan.creationEnabled && (
        <Alert tone="warn" title="Preview only — account creation is disabled on this server">
          ACCOUNT_CREATION_ENABLED=false. You can review exactly what would be created, but the server will reject job creation.
        </Alert>
      )}

      <Card className="p-5">
        <h2 className="font-semibold">Summary</h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-slate-500">Handle</dt><dd className="font-mono">@{plan.handle}</dd></div>
          <div><dt className="text-slate-500">Email to be used</dt><dd>{plan.email}</dd></div>
          <div><dt className="text-slate-500">Credentials stored</dt><dd>No — passwords and verification codes are never requested or stored</dd></div>
        </dl>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {plan.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </Card>

      <div className="space-y-3">
        {plan.items.map((item) => (
          <Card key={item.platform.slug} className="p-5" data-testid={`plan-${item.platform.slug}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{item.platform.name} <span className="font-mono font-normal">@{item.handle}</span></h3>
                <p className="text-xs text-slate-500">{ENTITY_LABEL[item.platform.entityType]} — {item.platform.entityDescription}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="indigo">Guided manual registration</Badge>
                <StatusBadge status={item.latestResult ? (item.latestResult.valid ? item.latestResult.status : 'invalid') : 'unchecked'} simulated={item.latestResult?.simulated} />
              </div>
            </div>
            <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Steps you will complete on {item.platform.name}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-700">{item.manualSteps.map((s) => <li key={s}>{s}</li>)}</ol>
                <p className="mt-2 text-xs text-slate-500">{item.verificationExpected}</p>
              </div>
              <div className="space-y-1">
                {item.warnings.map((w) => <p key={w} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{w}</p>)}
                {item.blocked && <p className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-900">Blocked: {item.blockedReason}</p>}
              </div>
            </div>
            {!item.blocked && (
              <label className="mt-4 flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  data-testid={`confirm-${item.platform.slug}`}
                  checked={confirmed.includes(item.platform.slug)}
                  onChange={() => setConfirmed((c) => (c.includes(item.platform.slug) ? c.filter((x) => x !== item.platform.slug) : [...c, item.platform.slug]))}
                  className="h-4 w-4 accent-indigo-600"
                />
                Confirm: prepare {item.platform.name} registration for @{item.handle} using {item.email}
              </label>
            )}
          </Card>
        ))}
      </div>

      <Card className="space-y-4 p-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" data-testid="ack" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>{ACK_TEXT}</span>
        </label>
        {error && <Alert tone="error" title={error.code === 'feature_disabled' ? 'Rejected by server' : undefined}>{error.message}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="create" disabled={!canCreate} onClick={create}>{busy ? 'Creating jobs…' : `Create ${actionable.length} registration job(s)`}</Button>
          {!plan.creationEnabled && <span className="text-xs text-slate-500">Disabled: ACCOUNT_CREATION_ENABLED=false</span>}
          {plan.creationEnabled && !allConfirmed && <span className="text-xs text-slate-500">Confirm each platform to continue.</span>}
        </div>
      </Card>
    </div>
  );
}
