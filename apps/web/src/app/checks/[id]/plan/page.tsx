import { requireSession } from '@/server/guard';
import { PlanView } from './plan-view';

type Param = string | string[] | undefined;
const joined = (v: Param) => (Array.isArray(v) ? v.join(',') : (v ?? ''));
const first = (v: Param) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ handle?: Param; platforms?: Param }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  // Repeated query params arrive as arrays (?platforms=x&platforms=reddit); accept both forms.
  const platforms = [...new Set(joined(sp.platforms).split(',').filter((s) => /^[a-z0-9_]{1,32}$/.test(s)))];
  return <PlanView checkId={id} handle={first(sp.handle)} platforms={platforms} />;
}
