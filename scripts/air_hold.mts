// The air levels shown for each forecast hour, remembered between hourly runs: data/forecast/held.json.
//
// A forecast hour right at a limit would otherwise flip between ok and avoid as each run nudges it,
// and again once the stations measure it. So the page, the widgets and the morning post rate an
// hour against the levels the last run published, and only move it once a new forecast (or the
// stations) put it clearly past the limit (holdLevel in src/lib/index.ts). This writes the levels
// this run ends up with, for the next one: the hours to come, and the past HELD_DAYS of hours that
// were rated as a forecast.
//
//   node scripts/air_hold.mts station-data/forecast/held.json
//
// The levels it starts from are the published ones (the site's data/forecast/held.json, from the
// previous run): they aren't kept on the data branch, and a missed hour only means one run starts
// from the plain limits. Station data and the blend are read from disk as in widget_feed.mts; the
// output goes next to the blend, where widget_feed.mts then reads it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HELD_DAYS, addDays, dubaiNowHour, dubaiToday, fetchOutdoorMeasured, type HeldDoc } from '../src/lib/api.ts';
import { HOLD_MARGIN, NORMAL, SENSITIVE, enrich, profileOf, type Thresholds } from '../src/lib/index.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: air_hold.mts <output.json>');
const AIR = process.env.AIR_DATA ?? 'station-data/air';
const FORECAST = process.env.FORECAST_DATA ?? join(dirname(AIR), 'forecast');
const SITE = process.env.SITE ?? 'https://zboule.github.io/abu-dhabi-outside/';
const DAYS = 4; // today and the 3 days the blend reaches

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (input === '/data/forecast/held.json') return realFetch(`${SITE}data/forecast/held.json`, init);
  const local = typeof input === 'string' ? [['/data/air/', AIR], ['/data/forecast/', FORECAST]].find(([p]) => input.startsWith(p)) : null;
  if (local && typeof input === 'string') {
    try {
      return new Response(readFileSync(join(local[1], input.slice(local[0].length))), { headers: { 'content-type': 'application/json' } });
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return realFetch(input, init);
}) as typeof fetch;

const today = dubaiToday();
const now = dubaiNowHour();
const since = `${addDays(today, -HELD_DAYS)}T00:00`;
// a day before the oldest hour kept, so the NowCast and the forecast anchoring have history
const raw = await fetchOutdoorMeasured(addDays(today, -HELD_DAYS - 1), addDays(today, DAYS - 1));
const doc: HeldDoc = { generated: new Date().toISOString(), margin: HOLD_MARGIN, hours: {} };
let kept = 0;
for (const th of [SENSITIVE, NORMAL] as Thresholds[]) {
  const prof = profileOf(th)!;
  for (const h of enrich(raw, th)) {
    // every forecast hour to come, and the hours gone by that were rated as a forecast: once
    // measured they keep that call too (unless the stations put them clearly past the limit)
    const future = h.airSrc === 'model' && h.time >= now;
    if (!(future || (h.held?.[prof] && h.time >= since)) || (h.chemLevel === 'na' && h.dustLevel === 'na')) continue;
    (doc.hours[h.time] ??= {})[prof] = [h.chemLevel, h.dustLevel];
    if (h.held?.[prof]) kept++;
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
console.log(`${out}: ${Object.keys(doc.hours).length} hours (to come, and past ones rated as a forecast), ${kept ? `${kept} profile-hours rated against the previous run` : 'no previous run to start from'}`);
