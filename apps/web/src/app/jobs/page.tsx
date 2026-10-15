import { requireSession } from '@/server/guard';
import { JobsView } from './jobs-view';

export default async function JobsPage() {
  await requireSession();
  return <JobsView />;
}
