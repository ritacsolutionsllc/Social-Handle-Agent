import { requireSession } from '@/server/guard';
import { PlanView } from './plan-view';

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ handle?: string; platforms?: string }> }) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const platforms = (sp.platforms ?? '').split(',').filter((s) => /^[a-z0-9_]{1,32}$/.test(s));
  return <PlanView checkId={id} handle={sp.handle ?? ''} platforms={platforms} />;
}
