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
/** The forecast's last ~2 days fall back to GFS, the least accurate model here (1.7° too cold). */
export const WEATHER_MAX_AHEAD = 13;
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
  model?: { pm25: number | null; pm10: number | null; no2: number | null; o3: number | null };
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

/**
 * The UV index of each row (the hour from its "HH:00"): the higher of the UV at the hour's start
 * and at its end, not their mean, so an hour is never rated gentler than its strongest minutes
 * (a 13:00 row averaging 5.3 starts at 6.3, over the kids limit).
 *
 * The UV at each hour: CAMS first, which weights the spectrum by what burns skin and gives the
 * instant at the hour. Past the ~5-day CAMS window, the forecast API's UV, which comes from GFS
 * by a simplified approximation: right in total over a day but too flat, too low under a high
 * sun (8.4 against 11.3 on a clear June noon) and too high under a low one. It is the mean of
 * the hour ending at its label, scaled by UV_FIX. Scored on 206 GFS runs as issued (Apr-Oct
 * 2026), 6+ days out it has no skill over the usual CAMS UV for that date and hour, so it gets a
 * quarter of the weight (hours rated wrong 6.0% -> 5.1%, kids limits). Those are hour means; the
 * instant at an hour is taken as the mean of the two hours around it.
 */
function uvSeries(w: Series, cams: (k: string, t: string) => number | null): (number | null)[] {
  const n = w.time.length;
  // modelled mean of row i (GFS labels the hour mean at its end, so row i is label i + 1)
  const mean = (i: number): number | null => {
    const t = w.time[i];
    const gfs = w.uv_index[i + 1];
    const clim = uvClimate(t);
    return gfs == null ? clim : 0.25 * gfs * uvFix(t) + 0.75 * clim;
  };
  // the UV at the start of row i (i = n: the end of the last row)
  const at = (i: number): number | null => {
    const c = i < n ? cams('uv_index', w.time[i]) : null;
    if (c != null) return c;
    const before = i > 0 ? mean(i - 1) : null;
    const after = i < n ? mean(i) : null;
    return before == null ? after : after == null ? before : (before + after) / 2;
  };
  return w.time.map((_, i) => {
    if (i === n - 1 && w.is_day[i] === 0) return 0; // the range's last hour is at night
    const a = at(i);
    const b = at(i + 1);
    return a == null ? b : b == null ? a : Math.max(a, b);
  });
}

/**
 * CAMS / GFS UV for each month (rows) and hour 06-18 (columns), fitted on Oct 2023 - Oct 2026 at
 * this point. On a held-out year it cut the hourly error from 0.64 to 0.42 and matched CAMS on the
 * hours over 7 (2.04 a day against 2.03; GFS alone 1.70).
 */
const UV_FIX: number[][] = [
  [0.50, 0.80, 0.68, 0.81, 0.92, 0.99, 1.00, 0.93, 0.82, 0.66, 0.50, 0.47, 0.50],
  [0.50, 0.72, 0.71, 0.83, 0.98, 1.05, 1.06, 0.99, 0.88, 0.73, 0.56, 0.42, 0.50],
  [0.50, 0.64, 0.75, 0.90, 1.04, 1.08, 1.11, 1.07, 0.92, 0.77, 0.60, 0.44, 0.55],
  [0.74, 0.68, 0.80, 0.96, 1.10, 1.15, 1.18, 1.10, 0.95, 0.78, 0.60, 0.44, 0.48],
  [0.65, 0.71, 0.87, 1.04, 1.17, 1.23, 1.23, 1.15, 1.01, 0.84, 0.65, 0.48, 0.44],
  [0.62, 0.69, 0.85, 1.00, 1.12, 1.19, 1.19, 1.12, 0.99, 0.83, 0.65, 0.48, 0.37],
  [0.55, 0.59, 0.73, 0.88, 0.99, 1.06, 1.05, 0.99, 0.87, 0.72, 0.58, 0.43, 0.33],
  [0.60, 0.58, 0.71, 0.87, 1.00, 1.07, 1.07, 0.99, 0.86, 0.69, 0.53, 0.40, 0.38],
  [0.79, 0.65, 0.79, 0.95, 1.08, 1.15, 1.13, 1.04, 0.89, 0.71, 0.53, 0.40, 0.50],
  [1.06, 0.69, 0.80, 0.95, 1.07, 1.11, 1.08, 0.98, 0.83, 0.66, 0.49, 0.45, 0.50],
  [0.50, 0.68, 0.74, 0.88, 0.98, 1.03, 1.01, 0.92, 0.78, 0.61, 0.47, 0.66, 0.50],
  [0.50, 0.74, 0.69, 0.81, 0.91, 0.97, 0.95, 0.86, 0.74, 0.58, 0.45, 0.61, 0.50],
];
/**
 * The usual CAMS UV of each week of the year (rows, from 1 Jan) and hour 06-18 (columns): the
 * mean over 2022-2026 of the same hour within 7 days either side.
 */
const UV_CLIMATE: number[][] = [
  [0.0, 0.2, 0.7, 1.9, 3.3, 4.3, 4.7, 4.0, 2.8, 1.5, 0.5, 0.1, 0.0],
  [0.0, 0.1, 0.7, 1.9, 3.4, 4.5, 4.9, 4.3, 3.0, 1.6, 0.6, 0.1, 0.0],
  [0.0, 0.2, 0.8, 2.0, 3.5, 4.7, 5.1, 4.5, 3.2, 1.7, 0.6, 0.1, 0.0],
  [0.0, 0.2, 0.8, 2.0, 3.5, 4.7, 5.1, 4.6, 3.3, 1.8, 0.7, 0.1, 0.0],
  [0.0, 0.2, 0.8, 2.1, 3.6, 4.9, 5.3, 4.8, 3.6, 2.0, 0.8, 0.2, 0.0],
  [0.0, 0.2, 0.9, 2.3, 4.1, 5.5, 6.0, 5.4, 4.0, 2.3, 0.9, 0.2, 0.0],
  [0.0, 0.2, 1.1, 2.6, 4.5, 6.1, 6.6, 6.0, 4.4, 2.5, 1.0, 0.2, 0.0],
  [0.0, 0.3, 1.1, 2.8, 4.7, 6.3, 6.9, 6.2, 4.6, 2.7, 1.1, 0.3, 0.0],
  [0.0, 0.3, 1.3, 3.0, 5.0, 6.6, 7.2, 6.5, 4.8, 2.8, 1.2, 0.3, 0.0],
  [0.0, 0.4, 1.3, 3.0, 5.1, 6.7, 7.3, 6.6, 4.9, 2.9, 1.3, 0.3, 0.0],
  [0.1, 0.5, 1.5, 3.4, 5.6, 7.2, 7.8, 7.0, 5.2, 3.1, 1.4, 0.3, 0.0],
  [0.1, 0.5, 1.8, 3.7, 6.0, 7.6, 8.1, 7.2, 5.3, 3.2, 1.4, 0.4, 0.0],
  [0.1, 0.7, 2.0, 4.0, 6.3, 8.0, 8.4, 7.5, 5.5, 3.3, 1.5, 0.4, 0.0],
  [0.1, 0.8, 2.2, 4.3, 6.5, 8.2, 8.6, 7.6, 5.6, 3.3, 1.5, 0.4, 0.0],
  [0.2, 0.9, 2.3, 4.5, 6.6, 8.2, 8.5, 7.5, 5.5, 3.3, 1.5, 0.4, 0.1],
  [0.2, 1.0, 2.5, 4.8, 7.1, 8.6, 8.8, 7.7, 5.6, 3.4, 1.5, 0.4, 0.1],
  [0.2, 1.1, 2.8, 5.1, 7.5, 9.1, 9.4, 8.1, 5.9, 3.6, 1.7, 0.5, 0.1],
  [0.3, 1.2, 3.0, 5.5, 8.0, 9.7, 9.9, 8.7, 6.4, 3.9, 1.9, 0.6, 0.1],
  [0.3, 1.3, 3.2, 5.7, 8.2, 9.9, 10.2, 9.0, 6.7, 4.1, 2.0, 0.6, 0.1],
  [0.4, 1.3, 3.2, 5.7, 8.2, 9.8, 10.1, 8.9, 6.6, 4.0, 1.9, 0.6, 0.1],
  [0.4, 1.4, 3.2, 5.7, 8.1, 9.8, 10.1, 8.9, 6.6, 4.1, 2.0, 0.7, 0.1],
  [0.4, 1.4, 3.3, 5.9, 8.4, 10.0, 10.3, 9.2, 6.9, 4.3, 2.1, 0.7, 0.1],
  [0.4, 1.4, 3.3, 5.9, 8.4, 10.1, 10.4, 9.2, 7.0, 4.4, 2.2, 0.8, 0.1],
  [0.4, 1.4, 3.2, 5.7, 8.1, 9.8, 10.1, 9.0, 6.8, 4.3, 2.2, 0.8, 0.2],
  [0.4, 1.3, 3.0, 5.3, 7.6, 9.3, 9.6, 8.6, 6.5, 4.2, 2.1, 0.8, 0.2],
  [0.3, 1.2, 2.8, 5.1, 7.4, 9.0, 9.4, 8.4, 6.4, 4.1, 2.1, 0.8, 0.1],
  [0.3, 1.1, 2.7, 4.9, 7.1, 8.7, 9.1, 8.2, 6.2, 4.0, 2.0, 0.7, 0.1],
  [0.3, 1.0, 2.5, 4.7, 6.9, 8.5, 8.9, 8.0, 6.1, 3.9, 2.0, 0.7, 0.1],
  [0.2, 1.0, 2.5, 4.6, 6.9, 8.5, 8.8, 7.9, 6.0, 3.8, 1.9, 0.7, 0.1],
  [0.2, 0.9, 2.4, 4.5, 6.7, 8.3, 8.6, 7.7, 5.8, 3.7, 1.8, 0.6, 0.1],
  [0.2, 0.9, 2.3, 4.3, 6.5, 8.1, 8.5, 7.6, 5.7, 3.6, 1.7, 0.6, 0.1],
  [0.2, 0.9, 2.3, 4.4, 6.6, 8.3, 8.7, 7.7, 5.8, 3.6, 1.7, 0.6, 0.1],
  [0.2, 0.9, 2.3, 4.5, 6.8, 8.4, 8.8, 7.8, 5.8, 3.5, 1.7, 0.5, 0.1],
  [0.2, 0.8, 2.3, 4.5, 6.8, 8.5, 8.8, 7.7, 5.6, 3.4, 1.5, 0.5, 0.1],
  [0.2, 0.8, 2.3, 4.6, 6.9, 8.5, 8.9, 7.7, 5.5, 3.2, 1.5, 0.4, 0.1],
  [0.2, 0.8, 2.3, 4.6, 6.9, 8.5, 8.8, 7.6, 5.4, 3.1, 1.3, 0.4, 0.0],
  [0.2, 0.8, 2.3, 4.5, 6.8, 8.4, 8.6, 7.3, 5.2, 2.9, 1.2, 0.3, 0.0],
  [0.1, 0.8, 2.3, 4.5, 6.7, 8.2, 8.4, 7.1, 5.0, 2.7, 1.1, 0.2, 0.0],
  [0.1, 0.8, 2.2, 4.4, 6.6, 8.1, 8.2, 6.9, 4.7, 2.5, 1.0, 0.2, 0.0],
  [0.1, 0.7, 2.2, 4.3, 6.4, 7.8, 7.8, 6.5, 4.4, 2.3, 0.9, 0.2, 0.0],
  [0.1, 0.7, 2.1, 4.1, 6.1, 7.4, 7.3, 6.0, 4.0, 2.1, 0.7, 0.1, 0.0],
  [0.1, 0.6, 1.9, 3.9, 5.8, 6.9, 6.7, 5.5, 3.6, 1.8, 0.6, 0.1, 0.0],
  [0.1, 0.6, 1.8, 3.6, 5.5, 6.5, 6.3, 5.1, 3.4, 1.6, 0.5, 0.1, 0.0],
  [0.1, 0.5, 1.6, 3.3, 5.0, 6.0, 5.9, 4.8, 3.1, 1.5, 0.5, 0.1, 0.0],
  [0.1, 0.5, 1.5, 3.1, 4.7, 5.7, 5.6, 4.5, 2.9, 1.4, 0.4, 0.1, 0.0],
  [0.0, 0.4, 1.3, 2.8, 4.3, 5.3, 5.3, 4.3, 2.8, 1.3, 0.4, 0.0, 0.0],
  [0.0, 0.3, 1.2, 2.6, 4.1, 5.0, 5.1, 4.1, 2.6, 1.2, 0.4, 0.0, 0.0],
  [0.0, 0.3, 1.1, 2.4, 3.8, 4.8, 4.8, 3.9, 2.5, 1.2, 0.3, 0.0, 0.0],
  [0.0, 0.2, 1.0, 2.2, 3.6, 4.6, 4.7, 3.9, 2.5, 1.2, 0.4, 0.1, 0.0],
  [0.1, 0.3, 0.9, 2.1, 3.4, 4.3, 4.4, 3.7, 2.5, 1.3, 0.5, 0.2, 0.1],
  [0.1, 0.2, 0.8, 1.9, 3.1, 4.0, 4.2, 3.5, 2.4, 1.2, 0.5, 0.2, 0.1],
  [0.0, 0.2, 0.7, 1.8, 3.1, 4.1, 4.3, 3.7, 2.5, 1.3, 0.4, 0.1, 0.0],
  [0.0, 0.1, 0.7, 1.8, 3.2, 4.2, 4.5, 3.9, 2.7, 1.4, 0.5, 0.1, 0.0],
];
function uvClimate(t: string): number {
  const h = Number(t.slice(11, 13));
  if (h < 6 || h > 18) return 0;
  const doy = (Date.parse(`${t.slice(0, 10)}T00:00:00Z`) - Date.parse(`${t.slice(0, 4)}-01-01T00:00:00Z`)) / 86400000;
  const x = Math.max(0, (doy - 3) / 7);
  const w0 = Math.min(Math.floor(x), UV_CLIMATE.length - 1);
  const w1 = (w0 + 1) % UV_CLIMATE.length;
  const f = Math.min(1, x - w0);
  return UV_CLIMATE[w0][h - 6] * (1 - f) + UV_CLIMATE[w1][h - 6] * f;
}

function uvFix(t: string): number {
  const h = Number(t.slice(11, 13));
  return h < 6 || h > 18 ? 1 : UV_FIX[Number(t.slice(5, 7)) - 1][h - 6];
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
      ['pm10', 'pm2_5', 'dust', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone', 'carbon_monoxide', 'us_aqi', 'uv_index'],
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

  const uvs = w ? uvSeries(w, av) : [];
  return (w?.time ?? []).map((t, i) => ({
    time: t,
    temp: w!.temperature_2m[i] ?? null,
    feels: w!.apparent_temperature[i] ?? null,
    humidity: w!.relative_humidity_2m[i] ?? null,
    uv: uvs[i],
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
 * Stations measure PM2.5 and PM10 but not what they're made of; the dust share of PM2.5 is
 * taken as this times the coarse (PM10 - PM2.5) part. In storms, when nearly all PM is dust,
 * the stations read PM2.5/PM10 of 0.21-0.27 (2023-2026), a fine/coarse ratio of about 0.3
 * (regression on PM10 >= 300: 0.30). 0.43 counted most ordinary PM2.5 as dust.
 */
export const DUST_FINE_OF_COARSE = 0.3;

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
/**
 * EAD labels each hourly mean with the hour it ends ("10 AM" is online by 10:43, and gases lag
 * CAMS by 0-1h), while our "10:00" row is 10:00-11:00: a reading belongs one row earlier.
 */
function rowOfLabel(label: string): string {
  const h = Number(label.slice(11, 13));
  return h ? `${label.slice(0, 11)}${String(h - 1).padStart(2, '0')}:00` : `${addDays(label.slice(0, 10), -1)}T23:00`;
}

export async function fetchStations(start: string, end: string): Promise<Map<string, Measured>> {
  const months: string[] = [];
  // the last row of a month is labelled 00:00 the next day
  for (let m = start.slice(0, 7); m <= addDays(end, 1).slice(0, 7); ) {
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
      for (const [label, v] of rows) {
        const k = rowOfLabel(label);
        if (k < lo || k > hi) continue;
        const b = by.get(k) ?? by.set(k, { pm25: [], pm10: [], o3: [], no2: [], so2: [], co: [] }).get(k)!;
        // EAD logs a missing reading as 0 (Hamdan St and Mussafah have no ozone sensor, outages are 0 too)
        const x = (i: number) => (i >= 0 && v[i] != null && v[i]! > 0 ? v[i]! : null);
        // a sensor that has barely moved for a day is stuck, not reading the air
        const pm25 = stuck25.has(label) ? null : x(iPm25);
        const pm10 = stuck10.has(label) ? null : x(iPm10);
        // PM2.5 near or above PM10 is a broken or wet sensor, not air (seen in up to a third of a
        // month's hours at Mussafah and Hamdan St)
        if (pm25 != null && (pm10 == null || pm10 < 20 || pm25 <= 0.9 * pm10)) b.pm25.push(pm25);
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
  const today = dubaiToday();
  const [hours, measured, bias] = await Promise.all([
    fetchOutdoor(start, end),
    start <= today ? fetchStations(start, end) : Promise.resolve(new Map<string, Measured>()),
    end >= addDays(today, -1) ? ozoneBias(today) : Promise.resolve(null),
  ]);
  const o3 = (h: HourRaw) => (bias && h.o3 != null ? Math.max(0, h.o3 + bias[Number(h.time.slice(11, 13))]) : h.o3);
  return anchorForecast(
    hours.map((h) => {
      const m = measured.get(h.time);
      return m
        ? { ...h, ...m, airSrc: 'station' as const, model: { pm25: h.pm25, pm10: h.pm10, no2: h.no2, o3: o3(h) } }
        : { ...h, o3: o3(h), airSrc: 'model' as const };
    }),
  );
}

/**
 * CAMS ozone runs high here (13 µg/m³ above the stations over the past year), by an amount that
 * changes with the hour and the season. So recent forecast hours get the last 7 days' mean gap
 * (station - model) at the same hour of the day. Replayed over Oct 2025 - Oct 2026 it cut the
 * ozone error from 24.6 to about 20.5 µg/m³ at every lead up to 3 days. Null when the stations
 * have too little (then the model stays as it is).
 */
const O3_BIAS_DAYS = 7;
const o3BiasCache = new Map<string, Promise<number[] | null>>();
function ozoneBias(today: string): Promise<number[] | null> {
  const hit = o3BiasCache.get(today);
  if (hit) return hit;
  const from = addDays(today, -O3_BIAS_DAYS);
  const p = Promise.all([fetchOutdoor(from, today), fetchStations(from, today)])
    .then(([rows, measured]) => {
      const gaps: number[][] = Array.from({ length: 24 }, () => []);
      for (const h of rows) {
        const m = measured.get(h.time)?.o3;
        if (m != null && h.o3 != null) gaps[Number(h.time.slice(11, 13))].push(m - h.o3);
      }
      if (gaps.filter((g) => g.length >= 4).length < 20) return null;
      return gaps.map((g) => (g.length >= 4 ? g.reduce((a, b) => a + b, 0) / g.length : 0));
    })
    .catch(() => null);
  o3BiasCache.set(today, p);
  return p;
}

/**
 * How many hours the measured-vs-model gap takes to fade to about a third (e-folding).
 * Backtested on 5 weeks of Sept 2026 (forecast every 6h, next 48h, kids limits): a gap over
 * the last 3 measured hours fading over 12h cut the 1-6h pollution error from 21.0 to 18.3
 * and caught more real avoid hours (1498 vs 1453 of 2249); longer fades or a ratio did worse.
 */
export const ANCHOR_TAU = 12;
/** Ozone's gap fades faster: replayed over a year, 6h beat 3h and 12h (1h error 24.6 -> 14.5 µg/m³). */
export const O3_TAU = 6;
const ANCHORED = ['pm25', 'pm10', 'no2', 'o3'] as const;

/**
 * The model (CAMS, 40 km) is often off by a steady amount for days: it missed the late-Sept
 * 2026 humid episodes by ~30 points and overshot quiet days. So the forecast is anchored to
 * what the stations just measured: the mean gap (measured - model) over the last 3 measured
 * hours is added to the forecast hours, fading with lead time (exp(-lead / tau)), so the
 * next hours follow the air as it really is and later days drift back to the plain model.
 * Ozone too, on top of its 7-day bias correction (see ozoneBias), with its own shorter fade.
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
    const out: HourRaw = { ...h, anchored: true };
    for (const k of ANCHORED) {
      const w = Math.exp(-(i - last) / (k === 'o3' ? O3_TAU : tau));
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
