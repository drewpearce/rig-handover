import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunStatus } from './types.js';

export type Counts = Record<RunStatus, number>;

const STATUSES: readonly string[] = ['ok', 'retry', 'fail'];

// Same line rules as read.ts parseLine (not exported there): a line that does not parse is not counted.
// ponytail: duplicated parse rules because read.ts is off-limits; export parseLine from read.ts when allowed.
function statusOf(text: string): RunStatus | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || typeof o.job !== 'string') return null;
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status)) return null;
  if (o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  return o.status as RunStatus;
}

// Returns null when runs/<night>.jsonl does not exist or cannot be read.
export function countNight(runsDir: string, night: string): Counts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }
  const counts: Counts = { ok: 0, retry: 0, fail: 0 };
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const s = statusOf(raw);
    if (s) counts[s]++;
  }
  return counts;
}
