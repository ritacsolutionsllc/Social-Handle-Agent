'use client';
import { useCallback, useEffect, useState } from 'react';
import type { JobRecord, JobStatus } from '@sha/core';
import { api, isApiError } from '@/lib/api';
import { Alert, Badge, Button, Card } from '@/components/ui';

const TONE: Record<JobStatus, 'slate' | 'indigo' | 'amber' | 'green' | 'red'> = {
  queued: 'slate',
  running: 'indigo',
  awaiting_verification: 'amber',
  succeeded: 'green',
  failed: 'red',
  cancelled: 'slate',
};
const ACTIVE: JobStatus[] = ['queued', 'running'];

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs hover:bg-slate-200"
      onClick={() => void navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      title={`Copy ${label}`}
    >
      {done ? 'Copied' : value}
    </button>
  );
}

export function JobsView() {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<{ jobs: JobRecord[] }>('/api/creation-jobs').then((r) => setJobs(r.jobs)).catch((e) => setError(isApiError(e) ? e.message : 'Could not load jobs.')), []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is still moving.
  useEffect(() => {
    if (!jobs?.some((j) => ACTIVE.includes(j.status))) return;
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [jobs, load]);

  async function act(job: JobRecord, action: 'cancel' | 'retry' | 'confirm') {
    setBusy(`${job.id}:${action}`);
    setError(null);
    try {
      await api(`/api/creation-jobs/${job.id}/${action}`, { method: 'POST', body: {} });
      await load();
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!jobs) return error ? <Alert tone="error">{error}</Alert> : <p className="text-sm text-slate-500">Loading jobs…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registration jobs</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every platform uses guided manual registration: open the registration page, complete signup and verification yourself, then confirm here. We re-check the handle before marking a job succeeded.
        </p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {jobs.length === 0 && <Card className="p-6 text-sm text-slate-600">No jobs yet. Run a check, choose a handle and confirm a creation plan.</Card>}
      {jobs.map((job) => (
        <Card key={job.id} className="p-5" data-testid={`job-${job.platform}`}>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-semibold capitalize">{job.platform}</h2>
            <span className="font-mono text-sm">@{job.handle}</span>
            <Badge tone={TONE[job.status]}>{job.status.replace('_', ' ')}</Badge>
            {job.providerMode === 'mock' && <Badge tone="violet">mock provider</Badge>}
            <span className="ml-auto text-xs text-slate-500">attempts {job.attempts} · updated {new Date(job.updatedAt).toLocaleTimeString()}</span>
          </div>

          {job.lastError && <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-900">{job.lastError}</p>}

          {job.status === 'awaiting_verification' && job.nextAction && (
            <div className="mt-3 rounded-lg bg-amber-50 p-4 text-sm ring-1 ring-amber-200">
              <p className="font-medium">Action needed: register on the platform</p>
              <p className="text-xs text-amber-900">{job.nextAction.entityDescription}</p>
              {job.nextAction.warning && <p className="mt-1 text-xs font-medium text-amber-900">{job.nextAction.warning}</p>}
              <ol className="mt-2 list-decimal pl-5">{job.nextAction.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                Handle <Copy value={job.nextAction.prefill.handle} label="handle" /> Email <Copy value={job.nextAction.prefill.email} label="email" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="inline-flex items-center rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500" href={job.nextAction.registrationUrl} target="_blank" rel="noopener noreferrer">
                  Open registration page ↗
                </a>
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act(job, 'confirm')}>I’ve completed signup</Button>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {['queued', 'running', 'awaiting_verification'].includes(job.status) && (
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => act(job, 'cancel')}>Cancel</Button>
            )}
            {['failed', 'cancelled'].includes(job.status) && (
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act(job, 'retry')}>Retry</Button>
            )}
          </div>

          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer select-none">Audit trail ({job.events.length})</summary>
            <ol className="mt-2 space-y-1 border-l border-slate-200 pl-3">
              {job.events.map((e, i) => (
                <li key={i}>
                  <span className="text-slate-400">{new Date(e.createdAt).toLocaleString()}</span> {e.fromStatus ?? '∅'} → <strong>{e.toStatus}</strong> — {e.message}
                </li>
              ))}
            </ol>
          </details>
        </Card>
      ))}
    </div>
  );
}
