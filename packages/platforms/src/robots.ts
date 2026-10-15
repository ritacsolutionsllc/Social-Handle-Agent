import type { FetchLike } from './types';
import { readCapped, withTimeout } from './util';

interface Rule {
  allow: boolean;
  pattern: string;
}
interface Group {
  agents: string[];
  rules: Rule[];
}

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false;
      if (field === 'disallow' && value === '') continue; // empty disallow = allow all
      current.rules.push({ allow: field === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** RFC 9309 matching: most specific group for our product token, longest rule wins, ties allow. */
export function isPathAllowed(groups: Group[], userAgentToken: string, path: string): boolean {
  const token = userAgentToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const applicable = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  const rules = applicable.flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!patternToRegex(r.pattern).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Caches robots.txt per origin. Unreachable robots (5xx/network) is treated as disallow-all. */
export class RobotsPolicy {
  private readonly cache = new Map<string, { groups: Group[] | 'disallow_all' | 'allow_all'; expires: number }>();

  constructor(
    private readonly fetchFn: FetchLike,
    private readonly userAgentToken: string,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  async isAllowed(url: string, signal: AbortSignal): Promise<boolean> {
    const u = new URL(url);
    let entry = this.cache.get(u.origin);
    if (!entry || entry.expires < this.now()) {
      entry = { groups: await this.load(u.origin, signal), expires: this.now() + this.ttlMs };
      this.cache.set(u.origin, entry);
    }
    if (entry.groups === 'disallow_all') return false;
    if (entry.groups === 'allow_all') return true;
    return isPathAllowed(entry.groups, this.userAgentToken, u.pathname + u.search);
  }

  private async load(origin: string, signal: AbortSignal): Promise<Group[] | 'disallow_all' | 'allow_all'> {
    try {
      const res = await this.fetchFn(`${origin}/robots.txt`, { signal: withTimeout(signal, 5000), headers: { 'user-agent': this.userAgentToken } });
      if (res.status >= 400 && res.status < 500) return 'allow_all';
      if (!res.ok) return 'disallow_all';
      // RFC 9309 asks crawlers to parse at least 500 KiB; anything beyond is ignored.
      return parseRobots(await readCapped(res, 500 * 1024));
    } catch (err) {
      // A caller cancellation says nothing about the site's policy: propagate it uncached.
      if (signal.aborted) throw err;
      return 'disallow_all';
    }
  }
}
