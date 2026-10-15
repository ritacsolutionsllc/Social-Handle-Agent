import { summarizePlatform } from '@sha/services';
import { requireSession } from '@/server/guard';
import { runtime } from '@/server/runtime';
import { SimulatedBanner } from '@/components/status';
import { CheckForm } from './check-form';

export default async function HomePage() {
  await requireSession();
  const rt = runtime();
  const platforms = (await rt.deps.catalog.listEnabled()).map(summarizePlatform);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Find a consistent social handle</h1>
        <p className="mt-1 text-sm text-slate-600">
          Enter a company, brand or desired @handle. We normalize it for each platform, check availability, and suggest ranked alternatives.
        </p>
      </div>
      {rt.settings.AVAILABILITY_PROVIDER_MODE === 'mock' && <SimulatedBanner />}
      <CheckForm platforms={platforms} />
    </div>
  );
}
