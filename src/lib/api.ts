// Outdoor conditions for Abu Dhabi, straight from Open-Meteo (free, no key, CORS-open,
// so the static SPA calls it directly; no backend of ours in the loop).
//
//  - Weather: the historical-forecast API serves ONE continuous hourly series from the
//    archived model runs up to today+15 days, UV index included (the plain forecast
//    API has holes in its past UV). Both edges are enforced server-side with a 400.
//  - Air: the CAMS air-quality API (dust split out from PM, plus SO2/NO2/O3/CO),
//    from 2022-09 to about today+6 days.
//
// All times are Asia/Dubai wall-clock strings ("2026-09-26T14:00"), used as join keys
// and never parsed into a Date: a phone in another zone must still see Dubai hours.

export const LAT = 24.45;
export const LON = 54.38;
export const TZ = 'Asia/Dubai';
/** First day CAMS has non-null air data for this point. */
export const AIR_FIRST_DAY = '2022-09-01';
export const WEATHER_MAX_AHEAD = 15;
export const AIR_MAX_AHEAD = 6;

export interface HourRaw {
  time: string; // Dubai wall clock, "YYYY-MM-DDTHH:00"
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  uv: number | null;
  night: boolean; // sun below the horizon (Open-Meteo is_day = 0)
  wind: number | null;
  pm10: number | null;
  pm25: number | null;
  dust: number | null;
  no2: number | null;
  so2: number | null;
  o3: number | null;
  co: number | null;
  usAqi: number | null;
  /** Where pm/gases come from: EAD ground stations (measured) or the CAMS model. */
  airSrc?: 'station' | 'model' | 'typical';
  /** Dust share of PM2.5 when known from measurements (µg/m³); otherwise derived from CAMS dust. */
  fineDust?: number | null;
  /** On measured hours: what the model said for that hour (to measure its current bias). */
  model?: { pm25: number | null; pm10: number | null; no2: number | null };
  /** On forecast hours: pulled toward the latest measurements (see anchorForecast). */
  anchored?: boolean;
}

/** Today's date in Dubai as YYYY-MM-DD (en-CA formats as ISO). */
export function dubaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** The current Dubai hour as a join key, "YYYY-MM-DDTHH:00". */
export function dubaiNowHour(): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(
    new Date(),
  );
  return `${dubaiToday()}T${parts.padStart(2, '0')}:00`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

type Series = Record<string, (number | null)[]> & { time: string[] };

async function fetchHourly(base: string, vars: string[], start: string, end: string): Promise<Series | null> {
  if (start > end) return null;
  const q = new URLSearchParams({
    latitude: String(LAT),
    longitude: String(LON),
    hourly: vars.join(','),
    timezone: TZ,
    start_date: start,
    end_date: end,
  });
  let r = await fetch(`${base}?${q}`);
  let body = await r.json();
  // The allowed window moves daily; if our clamp is off by one, the error names the real edge.
  if (!r.ok && typeof body?.reason === 'string') {
    const m = /to (\d{4}-\d{2}-\d{2})/.exec(body.reason);
    if (m && m[1] < end && m[1] >= start) {
      q.set('end_date', m[1]);
      r = await fetch(`${base}?${q}`);
      body = await r.json();
    }
  }
  if (!r.ok) throw new Error(body?.reason ?? `Open-Meteo HTTP ${r.status}`);
  return body.hourly as Series;
}

/** Hourly weather + air for [start, end] (Dubai dates, inclusive), joined on the hour. */
export async function fetchOutdoor(start: string, end: string): Promise<HourRaw[]> {
  const today = dubaiToday();
  const wEnd = end < addDays(today, WEATHER_MAX_AHEAD) ? end : addDays(today, WEATHER_MAX_AHEAD);
  const aStart = start > AIR_FIRST_DAY ? start : AIR_FIRST_DAY;
  const aEnd = end < addDays(today, AIR_MAX_AHEAD) ? end : addDays(today, AIR_MAX_AHEAD);

  const [w, a] = await Promise.all([
    fetchHourly(
      'https://historical-forecast-api.open-meteo.com/v1/forecast',
      ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'uv_index', 'wind_speed_10m', 'is_day'],
      start,
      wEnd,
    ),
    fetchHourly(
      'https://air-quality-api.open-meteo.com/v1/air-quality',
      ['pm10', 'pm2_5', 'dust', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone', 'carbon_monoxide', 'us_aqi'],
      aStart,
      aEnd,
    ),
  ]);

  const air = new Map<string, number>();
  a?.time.forEach((t, i) => air.set(t, i));
  const av = (k: string, t: string) => {
    const i = air.get(t);
    return i == null || !a ? null : (a[k][i] ?? null);
  };

  return (w?.time ?? []).map((t, i) => ({
    time: t,
    temp: w!.temperature_2m[i] ?? null,
    feels: w!.apparent_temperature[i] ?? null,
    humidity: w!.relative_humidity_2m[i] ?? null,
    uv: w!.uv_index[i] ?? null,
    night: w!.is_day[i] === 0,
    wind: w!.wind_speed_10m[i] ?? null,
    pm10: av('pm10', t),
    pm25: av('pm2_5', t),
    dust: av('dust', t),
    no2: av('nitrogen_dioxide', t),
    so2: av('sulphur_dioxide', t),
    o3: av('ozone', t),
    co: av('carbon_monoxide', t),
    usAqi: av('us_aqi', t),
  }));
}

// ---- measured air: Environment Agency Abu Dhabi stations ----
//
// CAMS (40 km) misses most dust storms, reads traffic NO2 at about half and ozone
// 20-60% high (validated against 3.7 years of EAD data). So every hour that has
// already been measured uses the median of the city's EAD stations instead.
// A scheduled GitHub Action (scripts/ead_sync.py) mirrors EAD into monthly files published
// with the site at data/air/YYYY-MM.json (EAD's own API has no CORS and returns 3 days per call).

/** City stations near the CAMS grid point; Khalifa City is left out (reads far above the others). */
export const EAD_STATIONS = ['EAD_HamdanStreet', 'EAD_KhadijaSchool', 'EAD_KhalifaSchool', 'EAD_Mussafah', 'EAD_AlMaqta'];
/**
 * Stations measure PM2.5 and PM10 but not what they're made of. Desert dust is about
 * 30% PM2.5 by mass, so its fine share is ~0.43x the coarse (PM10 - PM2.5) part.
 */
export const DUST_FINE_OF_COARSE = 0.43;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Measured = Pick<HourRaw, 'pm25' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co' | 'fineDust'>;

/** One stored month: raw per-station readings, zeros included (0 = missing at EAD). */
interface AirMonth {
  stations: string[];
  fields: string[]; // ["pM25", "pM10", "o3", "nO2", "sO2", "co"]
  hours: Record<string, Record<string, (number | null)[]>>;
}

const monthCache = new Map<string, Promise<AirMonth | null>>();
function airMonth(m: string): Promise<AirMonth | null> {
  // past months never change; the current one is re-read every time
  const current = m === dubaiToday().slice(0, 7);
  if (!current && monthCache.has(m)) return monthCache.get(m)!;
  // published next to the site by the GitHub Action (a snapshot of EAD, refreshed every ~20 min)
  // (outside Vite, e.g. a Node script, there is no BASE_URL: the caller maps /data/air/ itself)
  const p = fetch(`${import.meta.env?.BASE_URL ?? '/'}data/air/${m}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<AirMonth>) : null))
    .catch(() => null);
  if (!current) monthCache.set(m, p);
  return p;
}

/**
 * Hours where a station's sensor looks stuck: its last 24 readings (this one included) stay
 * within 6 µg/m³. Real PM never holds that still for a day; a frozen sensor does (Mussafah's
 * PM2.5 sat at ~51 for weeks in Sept 2026).
 */
function stuckHours(rows: [string, (number | null)[]][], i: number): Set<string> {
  const out = new Set<string>();
  if (i < 0) return out;
  const vals = rows.map(([, v]) => (v[i] != null && v[i]! > 0 ? v[i]! : null));
  for (let n = 0; n < rows.length; n++) {
    const win = vals.slice(Math.max(0, n - 23), n + 1).filter((x): x is number => x != null);
    if (win.length >= 18 && Math.max(...win) - Math.min(...win) <= 6) out.add(rows[n][0]);
  }
  return out;
}

/**
 * Hourly station medians for [start, end] (Dubai dates), keyed like HourRaw.time.
 * Never throws: a missing month (before 2023, a stale mirror) just leaves those hours to the model.
 */
export async function fetchStations(start: string, end: string): Promise<Map<string, Measured>> {
  const months: string[] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const docs = await Promise.all(months.map(airMonth));
  const out = new Map<string, Measured>();
  const lo = `${start}T00:00`;
  const hi = `${end}T23:00`;
  for (const doc of docs) {
    if (!doc) continue;
    const f = (name: string) => doc.fields.indexOf(name);
    const [iPm25, iPm10, iO3, iNo2, iSo2, iCo] = ['pM25', 'pM10', 'o3', 'nO2', 'sO2', 'co'].map(f);
    const by = new Map<string, { pm25: number[]; pm10: number[]; o3: number[]; no2: number[]; so2: number[]; co: number[] }>();
    for (const s of EAD_STATIONS) {
      const rows = Object.entries(doc.hours[s] ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
      const stuck25 = stuckHours(rows, iPm25);
      const stuck10 = stuckHours(rows, iPm10);
      for (const [k, v] of rows) {
        if (k < lo || k > hi) continue;
        const b = by.get(k) ?? by.set(k, { pm25: [], pm10: [], o3: [], no2: [], so2: [], co: [] }).get(k)!;
        // EAD logs a missing reading as 0 (Hamdan St and Mussafah have no ozone sensor, outages are 0 too)
        const x = (i: number) => (i >= 0 && v[i] != null && v[i]! > 0 ? v[i]! : null);
        // a sensor that has barely moved for a day is stuck, not reading the air
        const pm25 = stuck25.has(k) ? null : x(iPm25);
        const pm10 = stuck10.has(k) ? null : x(iPm10);
        // PM2.5 above PM10 is a broken instrument, not air
        if (pm25 != null && (pm10 == null || pm25 <= 1.2 * pm10 + 10)) b.pm25.push(pm25);
        if (pm10 != null) b.pm10.push(pm10);
        if (x(iO3) != null) b.o3.push(x(iO3)!);
        if (x(iNo2) != null) b.no2.push(x(iNo2)!);
        if (x(iSo2) != null) b.so2.push(x(iSo2)!);
        if (x(iCo) != null) b.co.push(x(iCo)! * 1000); // mg/m³ -> µg/m³
      }
    }
    for (const [k, b] of by) {
      // PM needs 2+ stations so one station's spike can't set the hour
      const pm = (v: number[]) => (v.length >= 2 ? median(v) : null);
      const gas = (v: number[]) => (v.length ? median(v) : null);
      const pm25 = pm(b.pm25);
      const pm10 = pm(b.pm10);
      if (pm25 == null && pm10 == null) continue;
      out.set(k, {
        pm25,
        pm10,
        o3: gas(b.o3),
        no2: gas(b.no2),
        so2: gas(b.so2),
        co: gas(b.co),
        fineDust: pm25 != null && pm10 != null ? DUST_FINE_OF_COARSE * Math.max(0, pm10 - pm25) : null,
      });
    }
  }
  return out;
}

/** fetchOutdoor, with every already-measured hour's air replaced by the EAD station median. */
export async function fetchOutdoorMeasured(start: string, end: string): Promise<HourRaw[]> {
  const [hours, measured] = await Promise.all([
    fetchOutdoor(start, end),
    start <= dubaiToday() ? fetchStations(start, end) : Promise.resolve(new Map<string, Measured>()),
  ]);
  return anchorForecast(
    hours.map((h) => {
      const m = measured.get(h.time);
      return m
        ? { ...h, ...m, airSrc: 'station' as const, model: { pm25: h.pm25, pm10: h.pm10, no2: h.no2 } }
        : { ...h, airSrc: 'model' as const };
    }),
  );
}

/**
 * How many hours the measured-vs-model gap takes to fade to about a third (e-folding).
 * Backtested on 5 weeks of Sept 2026 (forecast every 6h, next 48h, kids limits): a gap over
 * the last 3 measured hours fading over 12h cut the 1-6h pollution error from 21.0 to 18.3
 * and caught more real avoid hours (1498 vs 1453 of 2249); longer fades or a ratio did worse.
 */
export const ANCHOR_TAU = 12;
const ANCHORED = ['pm25', 'pm10', 'no2'] as const;

/**
 * The model (CAMS, 40 km) is often off by a steady amount for days: it missed the late-Sept
 * 2026 humid episodes by ~30 points and overshot quiet days. So the forecast is anchored to
 * what the stations just measured: the mean gap (measured - model) over the last 3 measured
 * hours is added to the forecast hours, fading with lead time (exp(-lead / tau)), so the
 * next hours follow the air as it really is and later days drift back to the plain model.
 * Ozone is left alone (the model and the stations agree on it).
 */
export function anchorForecast(rows: HourRaw[], tau = ANCHOR_TAU): HourRaw[] {
  let last = -1;
  rows.forEach((h, i) => {
    if (h.airSrc === 'station') last = i;
  });
  if (last < 0 || tau <= 0) return rows;
  const gap: Partial<Record<(typeof ANCHORED)[number], number>> = {};
  for (const k of ANCHORED) {
    const d: number[] = [];
    for (let i = last; i >= 0 && i > last - 6 && d.length < 3; i--) {
      const h = rows[i];
      const mv = h.model?.[k];
      if (h.airSrc === 'station' && h[k] != null && mv != null) d.push(h[k]! - mv);
    }
    if (d.length >= 2) gap[k] = d.reduce((a, b) => a + b, 0) / d.length;
  }
  return rows.map((h, i) => {
    if (i <= last || h.airSrc !== 'model') return h;
    const w = Math.exp(-(i - last) / tau);
    const out: HourRaw = { ...h, anchored: true };
    for (const k of ANCHORED) {
      if (gap[k] != null && h[k] != null) out[k] = Math.max(0, h[k]! + gap[k]! * w);
    }
    return out;
  });
}

/** Same day n years earlier/later; Feb 29 falls back to Feb 28. */
function shiftYear(day: string, n: number): string {
  const y = Number(day.slice(0, 4)) + n;
  const md = day.slice(5) === '02-29' ? '02-28' : day.slice(5);
  return `${y}-${md}`;
}
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * The same calendar dates in each of the last `years` years, re-keyed onto the target
 * dates: one array per year, to be rated separately (see enrichTypical). Air is measured
 * where the station mirror has it (2023 on), the CAMS model otherwise.
 */
export async function fetchTypicalYears(start: string, end: string, years = 3): Promise<HourRaw[][]> {
  return Promise.all(
    Array.from({ length: years }, (_, i) => i + 1).map(async (k) => {
      const hours = await fetchOutdoorMeasured(shiftYear(start, -k), shiftYear(end, -k));
      return hours
        .filter((h) => h.time.slice(5, 10) !== '02-29' || isLeap(Number(h.time.slice(0, 4)) + k))
        .map((h) => ({ ...h, time: `${shiftYear(h.time.slice(0, 10), k)}${h.time.slice(10)}` }));
    }),
  );
}
