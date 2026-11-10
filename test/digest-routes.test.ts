import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';

// Temp runs dir only; runs/ is read-only fixtures and is never touched here.
let runsDir: string;

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

const GOOD = '2026-11-01';
const EMPTY = '2026-11-02';
const BAD = '2026-11-03';
const MISSING = '2026-01-01';

// Jobs written out of order on purpose: both routes must sort them the same way.
const GOOD_JOBS = ['digest/render', 'lane/sync', 'notes/backup'];

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  config.runsDir = runsDir;

  writeFileSync(
    join(runsDir, `${GOOD}.jsonl`),
    [
      '{"at":"2026-11-01T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      '{"at":"2026-11-01T02:00:00+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
      '{"at":"2026-11-01T03:00:00+01:00","job":"digest/render","status":"retry","owner":null}',
      '{"at":"2026-11-01T03:05:00+01:00","job":"digest/render","status":"ok","owner":null}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${BAD}.jsonl`),
    [
      '{"at":"2026-11-03T01:00:00+01:00","job":"notes/backup","status":"ok","owner":"lane-07"}',
      'this is not json',
      '{"at":"2026-11-03T02:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
      '{"at":"2026-11-03T03:00:00+01:00","job":"digest/render","status":"ok","owner":null}',
      '',
    ].join('\n'),
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night (HTML)', () => {
  it('200 with a row per job for a night with a file', async () => {
    const res = await createApp(config).request(`/digest/${GOOD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<table');
    for (const job of GOOD_JOBS) expect(html).toContain(job);
    expect(html).toContain('quota exceeded');
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night renders "nothing ran"', async () => {
    const res = await createApp(config).request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('bad line: still 200 and lists the good jobs', async () => {
    const res = await createApp(config).request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of GOOD_JOBS) expect(html).toContain(job);
  });

  it('lists the same jobs in the same order as the JSON route', async () => {
    const app = createApp(config);
    const htmlRes = await app.request(`/digest/${GOOD}`);
    const html = await htmlRes.text();
    const jsonRes = await app.request(`/api/digest/${GOOD}`);
    expect(htmlRes.status).toBe(200);
    expect(jsonRes.status).toBe(200);
    const json = (await jsonRes.json()) as { rows: { job: string }[] };

    const positions = json.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(json.rows.map((r) => r.job)).toEqual(GOOD_JOBS);
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 with { night, rows, badLines } for a night with a file', async () => {
    const res = await createApp(config).request(`/api/digest/${GOOD}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      night: GOOD,
      rows: readNight(runsDir, GOOD)!.rows,
      badLines: 0,
    });
  });

  it('404 for a night with no file', async () => {
    const res = await createApp(config).request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night: rows [] and badLines 0', async () => {
    const res = await createApp(config).request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('bad line: badLines 1 and the good rows', async () => {
    const res = await createApp(config).request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { night: string; rows: { job: string }[]; badLines: number };
    expect(body.badLines).toBe(1);
    expect(body.night).toBe(BAD);
    expect(body.rows.map((r) => r.job)).toEqual(GOOD_JOBS);
  });
});
