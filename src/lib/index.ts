// The Abu Dhabi Air Index and the "good outdoor time" verdicts.
//
// Why a tailored index: US AQI treats every microgram of PM the same, so a sandy day
// in Abu Dhabi reads "unhealthy" much like a smog day would. Per microgram, combustion
// and industrial particles (refinery sulfates, soot, traffic) are the more consistently
// harmful; desert dust still counts (dust days raise mortality and child asthma
// admissions), just less per microgram. So the index:
//
//  1. estimates the dust share of PM2.5: from the measured coarse fraction on station
//     and model hours alike (DUST_FINE_OF_COARSE in api.ts; CAMS dust, DUST_FINE_FRACTION, only without PM10)
//     on model hours.
//  2. rates POLLUTION: the non-dust PM2.5 (EPA PM2.5 breakpoints, 2024 revision) and
//     O3, NO2, SO2, CO on their EPA scales, max of them. Strict limits (airGood/airOk).
//  3. rates DUST on its own: all the dust in PM10 (fine + coarse) on the EPA PM10
//     breakpoints. Lenient limits (dustGood/dustOk): a sandy day is fine for a couple of
//     hours outside, only a thick haze or a storm is "avoid".
//  4. the hour's air rating is the worse of the two; the index shown is the max.
//
// PM uses the EPA NowCast (weighted 12h average, as AirNow does for hourly values);
// O3 and CO use 8h means (their breakpoints are 8h); NO2 and SO2 are hourly.

import { DUST_FINE_OF_COARSE, type HourRaw } from './api.ts';

/**
 * Dust share of PM2.5 per unit of CAMS "dust" (model hours). A regression of CAMS PM2.5 on
 * dust over 2025 gives 0.11, so 0.1 is a central estimate (CAMS dust includes super-coarse
 * grains, which is why this is lower than the ~0.3 PM2.5/PM10 ratio of desert dust).
 */
export const DUST_FINE_FRACTION = 0.1;

type Bp = [cLo: number, cHi: number, iLo: number, iHi: number];
const PM25: Bp[] = [[0, 9, 0, 50], [9, 35.4, 50, 100], [35.4, 55.4, 100, 150], [55.4, 125.4, 150, 200], [125.4, 225.4, 200, 300], [225.4, 500, 300, 500]];
const PM10: Bp[] = [[0, 54, 0, 50], [54, 154, 50, 100], [154, 254, 100, 150], [254, 354, 150, 200], [354, 424, 200, 300], [424, 604, 300, 500]];
const O3_8H_PPB: Bp[] = [[0, 54, 0, 50], [54, 70, 50, 100], [70, 85, 100, 150], [85, 105, 150, 200], [105, 200, 200, 300]];
const NO2_PPB: Bp[] = [[0, 53, 0, 50], [53, 100, 50, 100], [100, 360, 100, 150], [360, 649, 150, 200], [649, 1249, 200, 300]];
const SO2_PPB: Bp[] = [[0, 35, 0, 50], [35, 75, 50, 100], [75, 185, 100, 150], [185, 304, 150, 200], [304, 604, 200, 300]];
const CO_8H_PPM: Bp[] = [[0, 4.4, 0, 50], [4.4, 9.4, 50, 100], [9.4, 12.4, 100, 150], [12.4, 15.4, 150, 200], [15.4, 30.4, 200, 300]];

/** The PM10 concentration (µg/m³) at a given index, to show dust limits in real units. */
export function pm10At(index: number): number {
  for (const [cl, ch, il, ih] of PM10) if (index <= ih) return Math.round(cl + ((ch - cl) * (index - il)) / (ih - il));
  return 604;
}

function scale(c: number, bps: Bp[]): number {
  for (const [cl, ch, il, ih] of bps) if (c <= ch) return il + ((ih - il) * (Math.max(c, cl) - cl)) / (ch - cl);
  return 500;
}

/** EPA NowCast over values newest-first (up to 12h). */
function nowcast(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  if (!v.length) return null;
  const max = Math.max(...v);
  const w = Math.max(max > 0 ? Math.min(...v) / max : 1, 0.5);
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    if (x == null) return;
    num += x * w ** i;
    den += w ** i;
  });
  return num / den;
}

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export type Driver = 'pm25' | 'dust' | 'o3' | 'no2' | 'so2' | 'co';
export const DRIVER_LABEL: Record<Driver, string> = {
  pm25: 'non-dust fine particles',
  dust: 'dust / sand',
  o3: 'ozone',
  no2: 'NO₂',
  so2: 'SO₂',
  co: 'CO',
};

export type Level = 'good' | 'ok' | 'bad' | 'na';

/** The three ways the outdoors hurts, each rated on its own. The hour takes the worst. */
export type Factor = 'comfort' | 'skin' | 'lungs';
export const FACTORS: { id: Factor; label: string; icon: string; what: string }[] = [
  { id: 'comfort', label: 'Comfort', icon: '🌡️', what: 'too hot or humid' },
  { id: 'skin', label: 'Skin', icon: '☀️', what: 'sunburn (UV)' },
  { id: 'lungs', label: 'Lungs', icon: '🫁', what: 'air pollution' },
];
export const factorLevel = (h: Hour, f: Factor): Level => (f === 'comfort' ? h.heat : f === 'skin' ? h.uvLevel : h.air);

/** Dew point (Magnus formula): the honest humidity number. Above ~24° feels oppressive whatever the air temp. */
export function dewPoint(t: number | null, rh: number | null): number | null {
  if (t == null || rh == null || rh <= 0) return null;
  const g = Math.log(rh / 100) + (17.62 * t) / (243.12 + t);
  return (243.12 * g) / (17.62 - g);
}
export function dewWord(d: number): string {
  return d < 16 ? 'dry, comfortable' : d < 20 ? 'slightly humid' : d < 24 ? 'sticky' : d < 26 ? 'oppressive' : 'miserable';
}

/**
 * Minutes until unprotected skin burns. UV index 1 = 0.025 W/m² erythemal = 1.5 J/m² per minute;
 * a burn takes ~1 MED: about 250 J/m² for fair skin (type II), 450 J/m² for olive/brown (type IV).
 */
export function burnMinutes(uv: number | null, med: 250 | 450): number | null {
  if (uv == null || uv < 1) return null;
  return Math.round(med / (1.5 * uv));
}

export interface Hour extends HourRaw {
  day: string;
  hour: number;
  /** PM2.5 minus its estimated dust share */
  nonDustPm25: number | null;
  /** estimated dust in PM10 (fine + coarse) */
  dustPm10: number | null;
  sub: Record<Driver, number | null>;
  adai: number | null; // Abu Dhabi Air Index: the max of every sub-index
  driver: Driver | null;
  /** pollution index (everything but dust) and what drives it */
  chem: number | null;
  chemDriver: Driver | null;
  /** dust index (EPA PM10 scale) */
  dustIdx: number | null;
  chemLevel: Level;
  dustLevel: Level;
  heat: Level;
  uvLevel: Level;
  air: Level;
  verdict: Level;
}

export interface Thresholds {
  feelsGood: number;
  feelsOk: number;
  uvGood: number;
  uvOk: number;
  /** pollution (non-dust particles and gases) index limits */
  airGood: number;
  airOk: number;
  /** dust index limits (EPA PM10 scale: 100 = 154, 150 = 254, 200 = 354, 300 = 424 µg/m³) */
  dustGood: number;
  dustOk: number;
}

// UV limits assume sunscreen is on: avoid only from "very high" (8+).
export const NORMAL: Thresholds = { feelsGood: 32, feelsOk: 36, uvGood: 5, uvOk: 7, airGood: 100, airOk: 150, dustGood: 150, dustOk: 300 };
// Kids and asthma: strict on pollution (avoid above the EPA "sensitive groups" line),
// dust only "avoid" when it's thick (over ~350 µg/m³ of PM10).
export const SENSITIVE: Thresholds = { feelsGood: 31, feelsOk: 35, uvGood: 4, uvOk: 6, airGood: 75, airOk: 100, dustGood: 100, dustOk: 200 };

function level(v: number | null, good: number, ok: number): Level {
  if (v == null) return 'na';
  return v <= good ? 'good' : v <= ok ? 'ok' : 'bad';
}

const RANK: Record<Level, number> = { good: 0, na: 0, ok: 1, bad: 2 };

/**
 * The overall rating: the worst of the three. Unknown air (no forecast that far, a gap)
 * can't vouch for the hour, so it caps the verdict at OK rather than letting it read good.
 */
function verdictOf(heat: Level, uvLevel: Level, air: Level): Level {
  if (heat === 'na' || uvLevel === 'na') return 'na';
  const worst = [heat, uvLevel, air === 'na' ? 'ok' : air].reduce((a, b) => (RANK[b as Level] > RANK[a as Level] ? b : a), 'good');
  return worst as Level;
}

export function enrich(raw: HourRaw[], th: Thresholds): Hour[] {
  // dust share of PM2.5: measured hours know it from their coarse fraction, model hours from CAMS dust
  // dust share of PM2.5, the same rule for measured and model hours: a share of the coarse
  // fraction (PM10 - PM2.5). The old model-hour rule (a tenth of CAMS dust) counted ~7x less
  // dust and overstated the forecast by 10-20 points; it's only the fallback without PM10.
  const fineDust = raw.map((h) =>
    h.fineDust != null
      ? h.fineDust
      : h.pm10 != null && h.pm25 != null
        ? DUST_FINE_OF_COARSE * Math.max(0, h.pm10 - h.pm25)
        : h.dust != null
          ? DUST_FINE_FRACTION * h.dust
          : null,
  );
  const nonDust = raw.map((h, i) => (h.pm25 == null || fineDust[i] == null ? null : Math.max(0, h.pm25 - fineDust[i]!)));
  const dust10 = raw.map((h, i) => (h.pm10 == null || nonDust[i] == null ? null : Math.max(0, h.pm10 - nonDust[i]!)));
  const o3s = raw.map((r) => r.o3);
  const cos = raw.map((r) => r.co);
  const back = <T,>(arr: T[], i: number, n: number) => arr.slice(Math.max(0, i - n + 1), i + 1).reverse();

  return raw.map((h, i) => {
    const p25 = nowcast(back(nonDust, i, 12));
    const pd = nowcast(back(dust10, i, 12));
    const o3 = mean(back(o3s, i, 8));
    const co = mean(back(cos, i, 8));
    const sub: Record<Driver, number | null> = {
      pm25: nonDust[i] == null || p25 == null ? null : scale(p25, PM25),
      dust: dust10[i] == null || pd == null ? null : scale(pd, PM10),
      o3: h.o3 == null || o3 == null ? null : scale(o3 / 1.96, O3_8H_PPB), // µg/m³ → ppb
      no2: h.no2 == null ? null : scale(h.no2 / 1.88, NO2_PPB),
      so2: h.so2 == null ? null : scale(h.so2 / 2.62, SO2_PPB),
      co: h.co == null || co == null ? null : scale(co / 1145, CO_8H_PPM), // µg/m³ → ppm
    };
    let driver: Driver | null = null;
    for (const k of Object.keys(sub) as Driver[]) {
      if (sub[k] != null && (driver == null || sub[k]! > sub[driver]!)) driver = k;
    }
    const adai = driver ? Math.round(sub[driver]!) : null;
    let chemDriver: Driver | null = null;
    for (const k of Object.keys(sub) as Driver[]) {
      if (k !== 'dust' && sub[k] != null && (chemDriver == null || sub[k]! > sub[chemDriver]!)) chemDriver = k;
    }
    const chem = chemDriver ? Math.round(sub[chemDriver]!) : null;
    const dustIdx = sub.dust == null ? null : Math.round(sub.dust);
    const chemLevel = level(chem, th.airGood, th.airOk);
    const dustLevel = level(dustIdx, th.dustGood, th.dustOk);

    const heat = level(h.feels, th.feelsGood, th.feelsOk);
    const uvLevel = level(h.uv, th.uvGood, th.uvOk);
    // worse of pollution and dust; unknown only when both are
    const air: Level =
      chemLevel === 'na' && dustLevel === 'na'
        ? 'na'
        : ([chemLevel, dustLevel].filter((l) => l !== 'na').reduce((a, b) => (RANK[b] > RANK[a] ? b : a)) as Level);

    return {
      ...h,
      day: h.time.slice(0, 10),
      hour: Number(h.time.slice(11, 13)),
      nonDustPm25: nonDust[i],
      dustPm10: dust10[i],
      sub,
      adai,
      driver,
      chem,
      chemDriver,
      dustIdx,
      chemLevel,
      dustLevel,
      heat,
      uvLevel,
      air,
      verdict: verdictOf(heat, uvLevel, air),
    };
  });
}

/** Everything about an hour's air, as one unit that can move between hours. */
const AIR_FIELDS = [
  'pm25', 'pm10', 'dust', 'no2', 'so2', 'o3', 'co', 'usAqi', 'airSrc', 'fineDust',
  'nonDustPm25', 'dustPm10', 'sub', 'adai', 'driver', 'air',
  'chem', 'chemDriver', 'dustIdx', 'chemLevel', 'dustLevel',
] as const;
function withAirOf(h: Hour, from: Hour, src: HourRaw['airSrc']): Hour {
  const out = { ...h } as Record<string, unknown>;
  for (const k of AIR_FIELDS) out[k] = from[k];
  out.airSrc = src;
  const o = out as unknown as Hour;
  o.verdict = verdictOf(o.heat, o.uvLevel, o.air);
  return o;
}

/**
 * Typical hours from several past years (each re-keyed onto the target dates). Each
 * year is rated on its own first, because the index is non-linear (NowCast, max of
 * sub-indices, thresholds): averaging concentrations first would flatten every dust
 * storm and ozone peak away. Heat and UV use the plain mean; air takes the year with
 * the median index, with that year's pollutants and driver.
 */
export function enrichTypical(years: HourRaw[][], th: Thresholds): Hour[] {
  const perYear = years.map((y) => new Map(enrich(y, th).map((h) => [h.time, h])));
  const times = [...new Set(years.flatMap((y) => y.map((h) => h.time)))].sort();
  const NUM = ['temp', 'feels', 'humidity', 'uv', 'wind'] as const;
  const avg: HourRaw[] = times.map((time) => {
    const hs = years.map((_, k) => perYear[k].get(time)).filter((h): h is Hour => !!h);
    const out = { time, night: hs.filter((h) => h.night).length * 2 > hs.length } as HourRaw;
    for (const k of NUM) {
      const v = hs.map((h) => h[k]).filter((x): x is number => x != null);
      out[k] = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }
    return out;
  });
  return enrich(avg, th).map((h) => {
    const hs = perYear
      .map((m) => m.get(h.time))
      .filter((x): x is Hour => !!x && x.adai != null)
      .sort((a, b) => a.adai! - b.adai!);
    return hs.length ? withAirOf(h, hs[(hs.length - 1) >> 1], 'typical') : h;
  });
}

/**
 * Forecast / measured hours first; where they have no air (the air forecast stops ~5
 * days out, the weather one at 16) or no hour at all, the typical hour fills in.
 */
export function mergeTypical(plain: Hour[], typical: Hour[]): Hour[] {
  const typ = new Map(typical.map((h) => [h.time, h]));
  const seen = new Set(plain.map((h) => h.time));
  const merged = plain.map((h) => {
    const t = typ.get(h.time);
    return h.adai == null && t && t.adai != null ? withAirOf(h, t, 'typical') : h;
  });
  return [...merged, ...typical.filter((h) => !seen.has(h.time))].sort((a, b) => (a.time < b.time ? -1 : 1));
}

export const BAND: { max: number; label: string }[] = [
  { max: 50, label: 'Clean' },
  { max: 100, label: 'Typical' },
  { max: 150, label: 'Elevated' },
  { max: 200, label: 'Poor' },
  { max: Infinity, label: 'Hazardous' },
];
export const bandOf = (v: number) => BAND.find((b) => v <= b.max)!.label;

/** Waking hours the day verdict looks at. */
export const DAY_FROM = 0;
export const DAY_TO = 23;

export interface Window {
  from: number;
  to: number; // exclusive end hour
  level: 'good' | 'ok';
}

export interface DaySummary {
  day: string;
  hours: Hour[]; // the chosen day hours, DAY_FROM..DAY_TO by default
  windows: Window[]; // runs of hours that are ok or better, labelled good if all good
  best: Hour | null; // the least-bad hour when there's no window
  airKnown: boolean;
}

/** `from`/`to`: the first and last hour of the day to keep (the day-hours setting). */
export function summarizeDays(hours: Hour[], from = DAY_FROM, to = DAY_TO): DaySummary[] {
  const byDay = new Map<string, Hour[]>();
  for (const h of hours) {
    if (h.hour < from || h.hour > to) continue;
    (byDay.get(h.day) ?? byDay.set(h.day, []).get(h.day)!).push(h);
  }
  return [...byDay].map(([day, hs]) => {
    const windows: Window[] = [];
    let cur: Window | null = null;
    for (const h of hs) {
      const okish = h.verdict === 'good' || h.verdict === 'ok';
      if (okish && cur && cur.to === h.hour) {
        cur.to = h.hour + 1;
        if (h.verdict === 'ok') cur.level = 'ok';
      } else if (okish) {
        cur = { from: h.hour, to: h.hour + 1, level: h.verdict as 'good' | 'ok' };
        windows.push(cur);
      } else cur = null;
    }
    // least-bad hour: fewest failing factors, then coolest
    const score = (h: Hour) =>
      [h.heat, h.uvLevel, h.air].reduce((s, l) => s + RANK[l] * 10, 0) + (h.feels ?? 99) / 10;
    const best = windows.length ? null : hs.filter((h) => h.verdict !== 'na').sort((a, b) => score(a) - score(b))[0] ?? null;
    return { day, hours: hs, windows, best, airKnown: hs.some((h) => h.adai != null) };
  });
}

export const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** Why an hour isn't good, in a few words. */
export function reasons(h: Hour): string {
  const r: string[] = [];
  if (h.heat === 'bad' || h.heat === 'ok') r.push(`hot, feels ${Math.round(h.feels!)}°`);
  if (h.uvLevel === 'bad' || h.uvLevel === 'ok') r.push(`UV ${h.uv!.toFixed(1)}`);
  if ((h.chemLevel === 'bad' || h.chemLevel === 'ok') && h.chemDriver)
    r.push(`pollution ${h.chem} (${DRIVER_LABEL[h.chemDriver]})`);
  if (h.dustLevel === 'bad' || h.dustLevel === 'ok') r.push(`dust ${h.dustIdx}`);
  return r.join(', ');
}

// ---- chart points ----

export interface ChartPoint {
  key: string; // Dubai wall-clock hour
  temp?: number | null;
  feels?: number | null;
  humidity?: number | null;
  uv?: number | null;
  adai?: number | null;
  usAqi?: number | null;
  pm10?: number | null;
  pm25?: number | null;
  dust?: number | null;
  nonDustPm25?: number | null;
  subPm25?: number | null;
  subDust?: number | null;
  subO3?: number | null;
  subNo2?: number | null;
  subSo2?: number | null;
  subCo?: number | null;
}

const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);

function point(h: Hour): ChartPoint {
  return {
    key: h.time,
    temp: h.temp,
    feels: h.feels,
    humidity: h.humidity,
    uv: h.uv,
    adai: h.adai,
    usAqi: h.usAqi,
    pm10: h.pm10,
    pm25: h.pm25,
    dust: h.dust,
    nonDustPm25: r1(h.nonDustPm25),
    subPm25: r1(h.sub.pm25),
    subDust: r1(h.sub.dust),
    subO3: r1(h.sub.o3),
    subNo2: r1(h.sub.no2),
    subSo2: r1(h.sub.so2),
    subCo: r1(h.sub.co),
  };
}

export function chartPoints(hours: Hour[]): ChartPoint[] {
  return hours.map(point);
}
