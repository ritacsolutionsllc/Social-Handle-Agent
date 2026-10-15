'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { CandidateReport, CellResult, CheckReport } from '@sha/services';
import { api, isApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, cn } from '@/components/ui';
import { ConfidencePill, ENTITY_LABEL, PlatformMark, SimulatedBanner, StatusBadge } from '@/components/status';

const RECHECKABLE = new Set(['unknown', 'error', 'rate_limited']);

function cellStatus(c: CellResult | null) {
  if (!c) return 'unchecked' as const;
  if (!c.valid) return 'invalid' as const;
  return c.status;
}

const DOT: Record<string, string> = {
  available: 'bg-emerald-500',
  taken: 'bg-rose-500',
  unknown: 'bg-amber-400',
  rate_limited: 'bg-orange-400',
  error: 'bg-slate-400',
  unchecked: 'bg-white ring-1 ring-slate-300',
  invalid: 'bg-slate-200',
};

export function ReportView({ id }: { id: string }) {
  const router = useRouter();
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState<string | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  useEffect(() => {
    api<CheckReport>(`/api/checks/${id}`)
      .then((r) => {
        setReport(r);
        selectHandle(r, r.recommendation?.handle ?? r.primary.handle);
      })
      .catch((e) => setError(isApiError(e) ? e.message : 'Could not load the report.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function selectHandle(r: CheckReport, handle: string) {
    setSelectedHandle(handle);
    const cand = r.candidates.find((c) => c.handle === handle);
    // Default to platforms where the handle is valid and not known to be taken.
    setSelectedPlatforms(r.platforms.filter((p) => { const c = cand?.cells[p.slug]; return c?.valid !== false && c?.status !== 'taken'; }).map((p) => p.slug));
  }

  async function recheck(platform: string, handle: string) {
    setRechecking(`${platform}:${handle}`);
    try {
      setReport(await api<CheckReport>(`/api/checks/${id}/recheck`, { body: { platform, handle } }));
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Recheck failed.');
    } finally {
      setRechecking(null);
    }
  }

  const selected = useMemo(() => report?.candidates.find((c) => c.handle === selectedHandle) ?? null, [report, selectedHandle]);

  if (error && !report) return <Alert tone="error">{error}</Alert>;
  if (!report) return <p className="text-sm text-slate-500">Loading report…</p>;

  const goToPlan = () => router.push(`/checks/${id}/plan?handle=${encodeURIComponent(selectedHandle!)}&platforms=${selectedPlatforms.join(',')}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm text-slate-500">Availability report for “{report.originalInput}”</p>
          <h1 className="font-mono text-2xl font-semibold">@{report.primaryHandle}</h1>
        </div>
        <Link href="/" className="text-sm text-indigo-700 hover:underline">New check</Link>
      </div>

      {report.simulated && <SimulatedBanner />}
      <Alert tone="info">{report.disclaimer} “Unknown” is never treated as available.</Alert>
      {error && <Alert tone="error">{error}</Alert>}

      <Card className="p-5" data-testid="recommendation">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Best available handle</h2>
        {report.recommendation ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="font-mono text-xl font-semibold">@{report.recommendation.handle}</span>
            {report.simulated && <Badge tone="violet">simulated</Badge>}
            <span className="text-sm text-slate-600">{report.recommendation.reason}</span>
            <Button size="sm" variant="secondary" onClick={() => selectHandle(report, report.recommendation!.handle)}>Select</Button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-600">No candidate was confirmed available on any platform. Unknown results need a manual check on the platform.</p>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Requested handle across platforms</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Platform</th>
                <th className="px-4 py-2">Handle</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Confidence</th>
                <th className="px-4 py-2">Method & evidence</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.platforms.map((p, i) => {
                const c = report.primary.cells[p.slug] ?? null;
                const st = cellStatus(c);
                const busy = rechecking === `${p.slug}:${c?.handle}`;
                return (
                  <tr key={p.slug} data-testid={`row-${p.slug}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <PlatformMark name={p.name} index={i} />
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-[11px] text-slate-500" title={p.entityDescription}>{ENTITY_LABEL[p.entityType]}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {c?.handle ?? '—'}
                      {c && c.issues.length > 0 && <div className="font-sans text-[11px] text-slate-500">{c.issues.join('; ')}</div>}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={st} simulated={c?.simulated} /></td>
                    <td className="px-4 py-3">{c && c.valid ? <ConfidencePill confidence={c.confidence} /> : '—'}</td>
                    <td className="max-w-xs px-4 py-3 text-xs text-slate-600">
                      {c ? (
                        <>
                          <span className="font-mono text-slate-500">{c.source}</span>
                          {c.evidence && <p className="mt-0.5">{c.evidence}</p>}
                          {c.error && <p className="mt-0.5 text-rose-700">{c.error}</p>}
                          {c.valid && <p className="mt-0.5 text-slate-400">{new Date(c.checkedAt).toLocaleString()}</p>}
                        </>
                      ) : (
                        'Not checked'
                      )}
                    </td>
                    <td className="space-y-1 px-4 py-3 text-right">
                      {c?.profileUrl && st === 'taken' && (
                        <a className="block text-xs text-indigo-700 hover:underline" href={c.profileUrl} target="_blank" rel="noopener noreferrer">View profile ↗</a>
                      )}
                      {c?.valid && st !== 'taken' && (
                        <a className="block text-xs text-indigo-700 hover:underline" href={p.profileUrlTemplate.replace('{handle}', encodeURIComponent(c.handle))} target="_blank" rel="noopener noreferrer">Check manually ↗</a>
                      )}
                      {c?.valid && RECHECKABLE.has(st) && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => recheck(p.slug, c.handle)}>{busy ? 'Rechecking…' : 'Recheck'}</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold">Ranked alternatives</h2>
          <p className="text-xs text-slate-500">Ranked by platforms available → shortest → fewest numbers/symbols → brand relevance. Alternatives are recommendations only; nothing is reserved or created.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Handle</th>
                {report.platforms.map((p) => (
                  <th key={p.slug} className="px-1 py-2 text-center font-normal normal-case" title={p.name}>{p.name.split(' ')[0]!.slice(0, 4)}</th>
                ))}
                <th className="px-4 py-2">Available</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.candidates.map((c: CandidateReport) => (
                <tr key={c.handle} data-testid={`candidate-${c.handle}`} className={cn(selectedHandle === c.handle && 'bg-indigo-50/60')}>
                  <td className="px-4 py-2 text-slate-500">{c.rank}</td>
                  <td className="px-4 py-2 font-mono">
                    @{c.handle} {c.kind === 'primary' && <Badge tone="slate" className="ml-1">requested</Badge>}
                  </td>
                  {report.platforms.map((p) => {
                    const st = cellStatus(c.cells[p.slug] ?? null);
                    return (
                      <td key={p.slug} className="px-1 py-2 text-center">
                        <span className={cn('inline-block h-3 w-3 rounded-full', DOT[st])} title={`${p.name}: ${st}`} aria-label={`${p.name}: ${st}`} />
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {c.availableCount}/{report.platforms.length}
                    {c.uncheckedCount > 0 && <span className="text-slate-400"> · {c.uncheckedCount} not checked</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant={selectedHandle === c.handle ? 'primary' : 'secondary'} onClick={() => selectHandle(report, c.handle)}>
                      {selectedHandle === c.handle ? 'Selected' : 'Select'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-slate-200 px-5 py-2 text-[11px] text-slate-500">
          {(['available', 'taken', 'unknown', 'rate_limited', 'error', 'invalid', 'unchecked'] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-full', DOT[k])} />{k.replace('_', ' ')}</span>
          ))}
        </div>
      </Card>

      {selected && (
        <Card className="p-5" data-testid="selection">
          <h2 className="font-semibold">Continue with <span className="font-mono">@{selected.handle}</span></h2>
          <p className="text-sm text-slate-600">Choose platforms for the creation plan. Platforms where this handle is taken or invalid are excluded.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {report.platforms.map((p) => {
              const cell = selected.cells[p.slug] ?? null;
              const blocked = cell?.valid === false || cell?.status === 'taken';
              return (
                <label key={p.slug} className={cn('flex items-center gap-2 rounded-lg p-2 text-sm ring-1 ring-slate-200', blocked && 'opacity-50')}>
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={selectedPlatforms.includes(p.slug)}
                    onChange={() => setSelectedPlatforms((s) => (s.includes(p.slug) ? s.filter((x) => x !== p.slug) : [...s, p.slug]))}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span className="truncate">{p.name}</span>
                  <span className="ml-auto"><StatusBadge status={cellStatus(cell)} /></span>
                </label>
              );
            })}
          </div>
          <Button className="mt-4" disabled={selectedPlatforms.length === 0} onClick={goToPlan}>Review creation plan →</Button>
        </Card>
      )}
    </div>
  );
}
