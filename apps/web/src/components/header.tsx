import Link from 'next/link';
import { readSession } from '@/server/session';
import { runtime } from '@/server/runtime';
import { Badge } from './ui';
import { LogoutButton } from './logout-button';

export async function Header() {
  const session = await readSession();
  const s = runtime().settings;
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Social Handle Agent
        </Link>
        <nav className="flex gap-1 text-sm">
          <Link className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100" href="/">
            New check
          </Link>
          <Link className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100" href="/jobs">
            Jobs
          </Link>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {s.AVAILABILITY_PROVIDER_MODE === 'mock' ? (
            <Badge tone="violet" title="Availability results are simulated">Mock provider · simulated</Badge>
          ) : (
            <Badge tone="indigo">Live provider</Badge>
          )}
          {!s.ACCOUNT_CREATION_ENABLED && <Badge tone="amber" title="ACCOUNT_CREATION_ENABLED=false">Account creation disabled</Badge>}
          {session && (
            <>
              <span className="hidden text-xs text-slate-500 sm:inline">{session.email}</span>
              <LogoutButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
