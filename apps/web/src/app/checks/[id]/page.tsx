import { requireSession } from '@/server/guard';
import { ReportView } from './report-view';

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  return <ReportView id={id} />;
}
