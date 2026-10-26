// The feed the phone widgets read: data/widget/v1.json, published with the site.
//
// Widgets can't run src/lib, so the Action rates the hours here, with the same code as the
// page, and the widgets only draw what they're given. The feed is a timeline (today 00:00 to
// the end of the day after tomorrow, both limit sets), not a "now" snapshot: a widget picks the
// current hour from the phone's clock, so a feed a few hours old still shows the right hour.
// The shape is contract/widget-feed.v1.schema.json; a breaking change is a new v2.json next to it.
//
//   node scripts/widget_feed.mts dist/data/widget/v1.json
//
// Station data is read from disk (AIR_DATA, default station-data/air): the mirror the job just
// synced, not the copy published by the previous run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays, dubaiNowHour, dubaiToday, fetchOutdoorMeasured } from '../src/lib/api.ts';
import { NORMAL, SENSITIVE, enrich, reasons, summarizeDays, type Hour, type Thresholds } from '../src/lib/index.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: widget_feed.mts <output.json>');
const AIR = process.env.AIR_DATA ?? 'station-data/air';
const DAYS = 3;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (typeof input === 'string' && input.startsWith('/data/air/')) {
    try {
      return new Response(readFileSync(join(AIR, input.slice('/data/air/'.length))), { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return realFetch(input, init);
}) as typeof fetch;

// Dubai has no daylight saving: every wall-clock hour is +04:00
const at = (time: string) => `${time}+04:00`;
const r = (v: number | null | undefined, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

const today = dubaiToday();
const last = addDays(today, DAYS - 1);
// from yesterday, so the NowCast, 8h means and forecast anchoring have history for the first hours
const raw = await fetchOutdoorMeasured(addDays(today, -1), last);
if (!raw.some((h) => h.time.startsWith(today))) throw new Error('no weather for today');

function profile(th: Thresholds) {
  const hours = enrich(raw, th).filter((h) => h.day >= today && h.day <= last);
  return {
    limits: th,
    hours: hours.map((h: Hour) => ({
      time: at(h.time),
      night: h.night,
      verdict: h.verdict,
      heat: h.heat,
      uv: h.uvLevel,
      air: h.air,
      pool: h.pool,
      temp: r(h.temp),
      feels: r(h.feels),
      uvIndex: r(h.uv, 1),
      airIndex: h.adai,
      pollution: h.chem,
      dust: h.dustIdx,
      airSource: h.airSrc === 'station' ? 'measured' : h.adai == null ? 'none' : 'forecast',
      reason: reasons(h),
    })),
    days: summarizeDays(hours).map((d) => ({
      day: d.day,
      windows: d.windows,
      best: d.best ? at(d.best.time) : null,
      airKnown: d.airKnown,
    })),
  };
}

const measured = raw.filter((h) => h.airSrc === 'station').at(-1);
const feed = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  nowHour: at(dubaiNowHour()),
  lastMeasuredAir: measured ? at(measured.time) : null,
  site: 'https://zboule.github.io/abu-dhabi-outside/',
  profiles: { kids: profile(SENSITIVE), adults: profile(NORMAL) },
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(feed));
console.log(`${out}: ${feed.profiles.kids.hours.length} hours, last measured air ${feed.lastMeasuredAir}`);
