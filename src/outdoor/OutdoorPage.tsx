import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, PopProvider, usePop } from './Pop';
import { CLOCK_HTML, mountClock, type ClockHour } from './clock';
import { heatGradient, heatRGB, rgb, type RGB } from '../lib/heat';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AIR_FIRST_DAY,
  addDays,
  daysBetween,
  dubaiNowHour,
  dubaiToday,
  fetchOutdoorMeasured,
  fetchTypicalYears,
  WEATHER_MAX_AHEAD,
  type HourRaw,
} from '../lib/api';
import {
  BAND,
  DAY_FROM,
  DAY_TO,
  DRIVER_LABEL,
  DUST_FINE_FRACTION,
  FACTORS,
  burnMinutes,
  dewPoint,
  dewWord,
  factorLevel,
  NORMAL,
  pm10At,
  SENSITIVE,
  bandOf,
  chartPoints,
  enrich,
  enrichTypical,
  mergeTypical,
  hh,
  reasons,
  summarizeDays,
  type ChartPoint,
  type DaySummary,
  type Driver,
  type Factor,
  type Hour,
  type Level,
  type Thresholds,
} from '../lib/index';

// Outdoor conditions in Abu Dhabi: heat, UV and a sand-tolerant air index, past and
// forecast, with a per-day "when can we go out" verdict on top. Data: Open-Meteo
// (see lib/outdoor/api.ts), fetched straight from the browser.

type Preset = 'today' | '3d' | '16d' | 'week' | 'next1m' | 'next3m' | 'year' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '3d', label: '3 days' },
  { id: '16d', label: '16 days' },
  { id: 'week', label: 'Last week' },
  { id: 'next1m', label: 'Next month' },
  { id: 'next3m', label: 'Next 3 months' },
  { id: 'year', label: 'Year average' },
  { id: 'custom', label: 'Custom' },
];
const MAX_CUSTOM_DAYS = 92;
/** Past this many days the good-time rows drop their text and shrink to strips. */
const COMPACT_AFTER = 16;

function readUrl(): { preset: Preset; from: string; to: string; day: number } {
  const today = dubaiToday();
  const q = new URLSearchParams(window.location.search);
  const p = q.get('range') as Preset;
  return {
    preset: PRESETS.some((x) => x.id === p) ? p : 'today',
    from: q.get('from') ?? addDays(today, -30),
    to: q.get('to') ?? today,
    day: Number(q.get('day')) || 0, // Today view: days from today (-1 yesterday, 1 tomorrow)
  };
}

function writeUrl(preset: Preset, from: string, to: string, day: number) {
  const url = new URL(window.location.href);
  url.searchParams.set('range', preset);
  if (preset === 'custom') {
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
  } else {
    url.searchParams.delete('from');
    url.searchParams.delete('to');
  }
  url.searchParams.delete('sens'); // kids mode lives in localStorage now
  if (preset === 'today' && day) url.searchParams.set('day', String(day));
  else url.searchParams.delete('day');
  window.history.replaceState(null, '', url);
}

function rangeOf(preset: Preset, from: string, to: string, day = 0): [string, string] {
  const today = dubaiToday();
  switch (preset) {
    case 'today':
      return [addDays(today, day), addDays(today, day)];
    case '3d':
      return [today, addDays(today, 2)];
    case '16d':
      return [today, addDays(today, 15)];
    case 'week':
      return [addDays(today, -6), today];
    case 'next1m': {
      // the whole next calendar month
      const [y, m] = today.split('-').map(Number);
      const first = new Date(Date.UTC(y, m, 1)); // month index m = next month
      const last = new Date(Date.UTC(y, m + 1, 0));
      return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
    }
    case 'next3m': {
      // from today, three months out
      const [y, m, d] = today.split('-').map(Number);
      const last = new Date(Date.UTC(y, m - 1 + 3, d - 1));
      return [today, last.toISOString().slice(0, 10)];
    }
    case 'year':
      return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    case 'custom':
      return [from, to];
  }
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat 27 Sep" from "2026-09-27", without going through the browser timezone. */
function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
}
function relDay(day: string): string {
  const today = dubaiToday();
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return dayLabel(day);
}
/** Row label for the squares: short enough for a phone, "Today" then "Mon 28". */
function rowDay(day: string): string {
  return day === dubaiToday() ? 'Today' : dayLabel(day).split(' ').slice(0, 2).join(' ');
}

const LEVEL_LABEL: Record<Level, string> = { good: 'Good', ok: 'OK', bad: 'Avoid', na: 'n/a' };
const LEVEL_ICON: Record<Level, string> = { good: '●', ok: '◐', bad: '✕', na: '·' };

export function OutdoorPage() {
  const init = useMemo(readUrl, []);
  const [preset, setPreset] = useState<Preset>(init.preset);
  const [dayOff, setDayOff] = useState(init.day);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [draft, setDraft] = useState({ from: init.from, to: init.to });
  const [sensitive, setSensitiveState] = useState(readSensitive);
  const setSensitive = (v: boolean) => {
    setSensitiveState(v);
    try {
      localStorage.setItem(SENSITIVE_KEY, v ? '1' : '0');
    } catch {
      /* private mode: the choice just doesn't persist */
    }
  };
  const [day, setDay] = useState(readDayHours);
  const chooseDay = (d: DayHours) => {
    setDay(d);
    try {
      localStorage.setItem(DAY_HOURS_KEY, JSON.stringify(d));
    } catch {
      /* private mode: the choice just doesn't persist */
    }
  };
  // page actions live in the app header's slot, next to the page title
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  useEffect(() => setHeaderEl(document.getElementById('header-actions')), []);
  // plain: forecast / measured rows; years: the past years behind the typical (averaged) hours
  // the loaded range (plain: forecast / measured rows; years: the past years behind typical hours).
  // It keeps showing the previous range until the next one lands, so changing day never blanks the page.
  const [raw, setRaw] = useState<Loaded | null>(null);
  const slideDir = useRef<'next' | 'prev' | null>(null);
  const firstClock = useRef(true);
  const [error, setError] = useState<string | null>(null);

  const [start, end] = rangeOf(preset, from, to, dayOff);
  const th: Thresholds = sensitive ? SENSITIVE : NORMAL;
  // beyond the 16-day forecast: the last 3 years' average for the same dates
  const typical = preset === 'next1m' || preset === 'next3m' || preset === 'year';
  // the real forecast covers the first 16 days; the average fills in after it, and fills
  // the air of forecast days past the ~5-day air forecast (the year average is all average)
  const forecastEnd =
    preset === 'year' ? addDays(start, -1) : typical ? [end, addDays(dubaiToday(), WEATHER_MAX_AHEAD)].sort()[0] : end;

  useEffect(() => writeUrl(preset, from, to, dayOff), [preset, from, to, dayOff]);
  // Today goes dark (the clock's flames and gas only glow on black). Tied to the period, not
  // to the clock, so the page doesn't flash back to light while another day loads.
  useEffect(() => {
    document.body.classList.add('od-night');
    return () => document.body.classList.remove('od-night');
  }, []);

  useEffect(() => {
    let live = true;
    setError(null);
    loadRange(start, end, forecastEnd, typical)
      .then((d) => {
        if (!live) return;
        setRaw({ ...d, start, end, dayOff });
        // a single day: have yesterday and tomorrow ready, so the arrows feel instant
        if (preset === 'today') {
          for (const n of [dayOff - 1, dayOff + 1]) {
            if (n > WEATHER_MAX_AHEAD) continue;
            const [s1, e1] = rangeOf('today', from, to, n);
            loadRange(s1, e1, e1, false).catch(() => {});
          }
        }
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [start, end, forecastEnd, typical]); // eslint-disable-line react-hooks/exhaustive-deps

  const hours = useMemo(() => {
    if (!raw) return null;
    const plain = enrich(raw.plain, th);
    const all = raw.years ? mergeTypical(plain, enrichTypical(raw.years, th)) : plain;
    return all.filter((h) => h.day >= raw.start && h.day <= raw.end);
  }, [raw, th]);
  const pending = !!raw && (raw.start !== start || raw.end !== end);
  // rows always carry the whole day (hours outside the day setting are darkened, not dropped);
  // a day's summary (its popup) only talks about the day setting
  const days = useMemo(() => (hours ? summarizeDays(hours, 0, 23) : []), [hours]);
  const windowed = useMemo(
    () => new Map((hours ? summarizeDays(hours, day.from, day.to) : []).map((d) => [d.day, d])),
    [hours, day],
  );
  const span = daysBetween(start, end) + 1;
  const points = useMemo(() => (hours ? chartPoints(hours) : []), [hours]);
  const nowKey = dubaiNowHour();
  const byTime = useMemo(() => new Map((hours ?? []).map((h) => [h.time, h])), [hours]);

  const applyCustom = () => {
    const today = dubaiToday();
    let f = draft.from < AIR_FIRST_DAY ? AIR_FIRST_DAY : draft.from;
    let t = draft.to > today ? today : draft.to;
    if (f > t) [f, t] = [t, f];
    if (daysBetween(f, t) + 1 > MAX_CUSTOM_DAYS) f = addDays(t, -(MAX_CUSTOM_DAYS - 1));
    setDraft({ from: f, to: t });
    setFrom(f);
    setTo(t);
    setPreset('custom');
    setCustomOpen(false);
  };
  const [customOpen, setCustomOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openCustom = () => {
    setDraft({ from, to });
    setCustomOpen(true);
  };
  const periodLabel =
    preset === 'custom' ? (
      rangeLabel(from, to)
    ) : preset === 'today' ? (
      // the date lives here, not in the page: "Today · Sat 26 Sep"
      <>
        {dayOff === 0 ? 'Today' : dayOff === -1 ? 'Yesterday' : dayOff === 1 ? 'Tomorrow' : dayLabel(start).split(' ')[0]}{' '}
        <span className="od-period-date">
          ·{' '}
          {dayOff === 0 || Math.abs(dayOff) === 1 ? <span className="od-period-wd">{dayLabel(start).split(' ')[0]} </span> : null}
          {dayLabel(start).split(' ').slice(1).join(' ')}
        </span>
      </>
    ) : (
      PRESETS.find((p) => p.id === preset)!.label
    );


  return (
    <PopProvider>
      <div className="od">
        {headerEl &&
          createPortal(
            <div className="od-bar od-head-actions">
              {preset === 'today' && (
                <button
                  type="button"
                  className="od-daynav"
                  aria-label="Previous day"
                  disabled={addDays(dubaiToday(), dayOff - 1) < AIR_FIRST_DAY}
                  onClick={() => {
                    slideDir.current = 'prev';
                    setDayOff(dayOff - 1);
                  }}
                >
                  ‹
                </button>
              )}
              <Dropdown
                ariaLabel="Period"
                // on another day (yesterday, tomorrow...) no option is checked: "Today" takes you back
                value={preset === 'today' && dayOff !== 0 ? ('another-day' as Preset) : preset}
                label={periodLabel}
                options={PRESETS.map((p) =>
                  p.id === 'custom' ? { value: p.id, label: 'Custom range…', sep: true } : { value: p.id, label: p.label },
                )}
                onPick={(p) => {
                  if (p === 'custom') return openCustom();
                  slideDir.current = dayOff > 0 ? 'prev' : dayOff < 0 ? 'next' : null;
                  setPreset(p);
                  setDayOff(0);
                }}
              />
              {preset === 'today' && (
                <button
                  type="button"
                  className="od-daynav"
                  aria-label="Next day"
                  disabled={dayOff >= WEATHER_MAX_AHEAD}
                  onClick={() => {
                    slideDir.current = 'next';
                    setDayOff(dayOff + 1);
                  }}
                >
                  ›
                </button>
              )}
              <button className="od-ico" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                ⚙️
              </button>
              <Info>{() => <RatingInfo th={th} sensitive={sensitive} day={day} />}</Info>
            </div>,
            headerEl,
          )}
        {settingsOpen &&
          createPortal(
            <>
              <div className="od-modal-backdrop" onClick={() => setSettingsOpen(false)} />
              <div className="od-modal" role="dialog" aria-modal="true" aria-label="Settings">
                <h3>Settings</h3>
                <div className="od-modal-fields">
                  <div className="od-setting">
                    <span>
                      Kids limits
                      <small>Stricter on heat, UV and pollution</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sensitive}
                      aria-label="Kids limits"
                      className={`od-switch${sensitive ? ' on' : ''}`}
                      onClick={() => setSensitive(!sensitive)}
                    >
                      <i />
                    </button>
                  </div>
                  <label>
                    <span>Day starts at</span>
                    <Dropdown
                      value={day.from}
                      label={hh(day.from)}
                      options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hh(h) }))}
                      onPick={(h) => chooseDay({ from: h, to: Math.max(day.to, h) })}
                    />
                  </label>
                  <label>
                    <span>Day ends at</span>
                    <Dropdown
                      value={day.to}
                      label={endLabel(day.to)}
                      options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: endLabel(h) }))}
                      onPick={(h) => chooseDay({ from: Math.min(day.from, h), to: h })}
                    />
                  </label>
                </div>
                <p className="od-muted">Hours outside this window are left off the tiles and the day summaries.</p>
                <div className="od-modal-actions">
                  <button type="button" onClick={() => chooseDay({ from: DAY_FROM, to: DAY_TO })}>
                    Reset
                  </button>
                  <button type="button" className="primary" onClick={() => setSettingsOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )}
        {customOpen &&
          createPortal(
            <>
              <div className="od-modal-backdrop" onClick={() => setCustomOpen(false)} />
              <div className="od-modal" role="dialog" aria-modal="true" aria-label="Custom range">
                <h3>Custom range</h3>
                <div className="od-modal-fields">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={draft.from}
                      min={AIR_FIRST_DAY}
                      max={dubaiToday()}
                      onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={draft.to}
                      min={AIR_FIRST_DAY}
                      max={dubaiToday()}
                      onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                    />
                  </label>
                </div>
                <p className="od-muted">Back to Sep 2022, up to {MAX_CUSTOM_DAYS} days.</p>
                <div className="od-modal-actions">
                  <button type="button" onClick={() => setCustomOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="primary" onClick={applyCustom} disabled={!draft.from || !draft.to}>
                    Show
                  </button>
                </div>
              </div>
            </>,
            document.body,
          )}

        {error && <div className="page-error">Could not load Open-Meteo data: {error}</div>}
        {!error && !hours && <div className="od-loading">Loading Abu Dhabi conditions…</div>}

        {hours && (
          <>
            {preset === 'today' ? (
              // a single day: the clock (heat colour, flames for sun, gas for air); tiles for longer ranges.
              // Keyed by the day, so a new day slides in from the side of the arrow that was tapped.
              <div
                key={raw!.start}
                className={`od-dayslide${slideDir.current ? ` from-${slideDir.current}` : ''}${pending ? ' pending' : ''}`}
              >
                <TodayClock
                  hours={hours}
                  nowKey={nowKey}
                  live={raw!.dayOff === 0}
                  dayWord={
                    raw!.dayOff === 0 ? 'today' : raw!.dayOff === 1 ? 'tomorrow' : raw!.dayOff === -1 ? 'yesterday' : `on ${dayLabel(raw!.start).split(' ')[0]}`
                  }
                  date={raw!.start}
                  dayFrom={day.from}
                  dayTo={day.to}
                  intro={firstClock.current}
                  onMounted={() => (firstClock.current = false)}
                />
              </div>
            ) : (
              <>
                <Tiles
                  days={days}
                  windowed={windowed}
                  dayFrom={day.from}
                  dayTo={day.to}
                  th={th}
                  compact={span > COMPACT_AFTER}
                  nowKey={nowKey}
                  dateOnly={preset === 'year'}
                />
              </>
            )}
            <ChartsToggle>
              <Charts points={points} byTime={byTime} span={span} nowKey={nowKey} th={th} />
            </ChartsToggle>
          </>
        )}
      </div>
    </PopProvider>
  );
}

// ---------------------------------------------------------------- shared bits

function Badge({ level }: { level: Level }) {
  return (
    <span className={`od-badge lv-${level}`}>
      {LEVEL_ICON[level]} {LEVEL_LABEL[level]}
    </span>
  );
}

function uvWord(uv: number): string {
  return uv < 3 ? 'low' : uv < 6 ? 'moderate' : uv < 8 ? 'high' : uv < 11 ? 'very high' : 'extreme';
}

const fmt = (v: number | null | undefined, d = 0, unit = '') => (v == null ? 'n/a' : `${v.toFixed(d)}${unit}`);

/** Everything behind one hour's rating: a card per factor, then the air breakdown. */
function HourDetail({ h, compact = false }: { h: Hour; th: Thresholds; compact?: boolean }) {
  const subs = (Object.keys(h.sub) as Driver[])
    .filter((k) => h.sub[k] != null)
    .sort((a, b) => h.sub[b]! - h.sub[a]!);
  const top = Math.max(200, ...subs.map((k) => h.sub[k]!));
  const dew = dewPoint(h.temp, h.humidity);
  const burnFair = burnMinutes(h.uv, 250);
  const burnOlive = burnMinutes(h.uv, 450);
  const why =
    h.verdict === 'na'
      ? 'No weather data for this hour.'
      : h.verdict === 'good'
        ? 'All three are fine.'
        : reasons(h).replace(/^./, (c) => c.toUpperCase());
  const cards: { f: 0 | 1 | 2; level: Level | 'night'; value: ReactNode; detail: ReactNode }[] = [
    {
      f: 0,
      level: h.heat,
      value: `Feels ${fmt(h.feels, 0, '°')}`,
      detail: (
        <>
          {fmt(h.temp, 0, '°')} air · {fmt(h.humidity, 0, '%')} humidity · wind {fmt(h.wind, 0, ' km/h')}
          {dew != null && (
            <>
              <br />
              Dew point {Math.round(dew)}°, {dewWord(dew)}
            </>
          )}
        </>
      ),
    },
    h.night
      ? { f: 1, level: 'night', value: 'Night', detail: 'Sun is down, no UV' }
      : {
          f: 1,
          level: h.uvLevel,
          value: `UV ${fmt(h.uv, 1)}${h.uv != null ? `, ${uvWord(h.uv)}` : ''}`,
          detail: burnFair != null ? `Unprotected skin burns in ${burnFair} to ${burnOlive} min` : 'No burn risk',
        },
    {
      f: 2,
      level: h.air,
      value:
        h.adai == null ? (
          'No air data'
        ) : (
          <span className="od-hd-air-rows">
            <span className={`lv-${h.chemLevel}`}>
              <span>Pollution</span>
              <b>{h.chem ?? 'n/a'}</b>
              <em>{LEVEL_LABEL[h.chemLevel]}</em>
              {!compact && h.chemDriver && <small>{DRIVER_LABEL[h.chemDriver]}</small>}
            </span>
            <span className={`lv-${h.dustLevel}`}>
              <span>Dust</span>
              <b>{h.dustIdx ?? 'n/a'}</b>
              <em>{LEVEL_LABEL[h.dustLevel]}</em>
              {!compact && h.pm10 != null && <small>PM10 {Math.round(h.pm10)} µg/m³</small>}
            </span>
          </span>
        ),
      detail:
        h.adai == null
          ? 'Air forecast reaches about 5 days ahead'
          : h.airSrc === 'station'
            ? 'Measured at 5 EAD stations'
            : h.airSrc === 'typical'
              ? '3-year average'
              : 'Model forecast',
    },
  ];
  return (
    <div className={`od-hd${compact ? ' compact' : ''}`}>
      <div className={`od-hd-head lv-${h.verdict}`}>
        <div>
          <b>
            {relDay(h.day)}, {hh(h.hour)}
          </b>
          {!compact && <small>{why}</small>}
        </div>
        <span className="od-hd-verdict">
          {LEVEL_ICON[h.verdict]} {LEVEL_LABEL[h.verdict]}
        </span>
      </div>
      <div className="od-hd-cards">
        {cards.map((c) => (
          <div key={c.f} className={`od-hd-card lv-${c.level}`}>
            <div className="od-hd-card-top">
              <span>
                {FACTORS[c.f].icon} {FACTORS[c.f].label}
              </span>
              <em>{c.level === 'night' ? '🌙' : LEVEL_LABEL[c.level]}</em>
            </div>
            {typeof c.value === 'string' ? <b>{c.value}</b> : c.value}
            {!compact && c.detail && <small>{c.detail}</small>}
          </div>
        ))}
      </div>

      {!compact && subs.length > 0 && (
        <div className="od-hd-air">
          <div className="od-hd-sub">Air index by pollutant</div>
          {subs.map((k) => (
            <div className="od-hd-bar" key={k}>
              <span>{DRIVER_LABEL[k]}</span>
              <i>
                <i style={{ width: `${(h.sub[k]! / top) * 100}%` }} className={k === h.driver ? 'on' : ''} />
              </i>
              <b>{Math.round(h.sub[k]!)}</b>
            </div>
          ))}
          <div className="od-hd-raw">
            {h.airSrc === 'typical'
              ? `3-year average (the median year): PM2.5 ${fmt(h.pm25)} · PM10 ${fmt(h.pm10)} µg/m³`
              : h.airSrc === 'station'
              ? `Measured, median of 5 EAD stations: PM2.5 ${fmt(h.pm25)} · PM10 ${fmt(h.pm10)} · NO₂ ${fmt(h.no2)} µg/m³`
              : `Model: PM2.5 ${fmt(h.pm25)} · dust ${fmt(h.dust)} · PM10 ${fmt(h.pm10)} µg/m³ · US AQI ${fmt(h.usAqi)}`}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- info texts

function RatingInfo({ th, sensitive, day }: { th: Thresholds; sensitive: boolean; day: DayHours }) {
  return (
    <>
      <h4>How an hour is rated</h4>
      <p>Each tile is one hour, coloured by the worst of three ratings:</p>
      <table className="od-pop-table">
        <thead>
          <tr>
            <th />
            <th>
              <i className="od-sw lv-good" /> Good
            </th>
            <th>
              <i className="od-sw lv-ok" /> OK
            </th>
            <th>
              <i className="od-sw lv-bad" /> Avoid
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>🌡️ Comfort (feels like)</td>
            <td>≤ {th.feelsGood}°</td>
            <td>≤ {th.feelsOk}°</td>
            <td>above</td>
          </tr>
          <tr>
            <td>☀️ Skin (UV index)</td>
            <td>≤ {th.uvGood}</td>
            <td>≤ {th.uvOk}</td>
            <td>above</td>
          </tr>
          <tr>
            <td>🫁 Pollution (index)</td>
            <td>≤ {th.airGood}</td>
            <td>≤ {th.airOk}</td>
            <td>above</td>
          </tr>
          <tr>
            <td>🫁 Dust (PM10 µg/m³)</td>
            <td>≤ {pm10At(th.dustGood)}</td>
            <td>≤ {pm10At(th.dustOk)}</td>
            <td>above</td>
          </tr>
        </tbody>
      </table>
      <p>
        Hours {hh(day.from)} to {hh(day.to + 1)} (change in ⚙️ settings). Air: measured at EAD stations for past hours, the CAMS model about 5 days ahead, the 3-year average after that in the month views. With no air data an hour can be OK at best, never good.
      </p>
      <p>
        Tile colour is the feels-like temperature. Hatching marks an hour where UV (☀️) or air (🫁) is in the avoid
        zone; tap a tile for all three ratings.
      </p>
      <p>
        Kids limits (⚙️ settings) are stricter, for children or asthma{sensitive ? '; they are on' : '; they are off'}.
      </p>
      <SensitiveInfo />
      <p className="od-pop-hint">Tap a tile for its full breakdown, a day name for the day. Faded tiles are past hours. Custom ranges go back to Sep 2022, up to {MAX_CUSTOM_DAYS} days.</p>
    </>
  );
}

function SensitiveInfo() {
  return (
    <>
      <h4>Kids / sensitive</h4>
      <p>Stricter limits for children, asthma or a long outing:</p>
      <table className="od-pop-table">
        <thead>
          <tr>
            <th />
            <th>Normal</th>
            <th>Sensitive</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Feels like, OK up to</td>
            <td>{NORMAL.feelsOk}°</td>
            <td>{SENSITIVE.feelsOk}°</td>
          </tr>
          <tr>
            <td>UV, OK up to</td>
            <td>{NORMAL.uvOk}</td>
            <td>{SENSITIVE.uvOk}</td>
          </tr>
          <tr>
            <td>Pollution, good up to</td>
            <td>{NORMAL.airGood}</td>
            <td>{SENSITIVE.airGood}</td>
          </tr>
          <tr>
            <td>Pollution, OK up to</td>
            <td>{NORMAL.airOk}</td>
            <td>{SENSITIVE.airOk}</td>
          </tr>
          <tr>
            <td>Dust (PM10), OK up to</td>
            <td>{pm10At(NORMAL.dustOk)} µg/m³</td>
            <td>{pm10At(SENSITIVE.dustOk)} µg/m³</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

function AirIndexInfo({ th }: { th: Thresholds }) {
  return (
    <>
      <h4>The Abu Dhabi air index</h4>
      <p>
        US AQI treats every particle the same, so ordinary sand makes Abu Dhabi look &ldquo;unhealthy&rdquo; most of the
        year. Per microgram, combustion and industrial particles are the more consistently harmful; desert dust still
        counts, just less. This index keeps the 0 to 500 scale, discounts only the dust, then takes the highest:
      </p>
      <ul>
        <li>
          <b>Pollution</b>: the non-dust fine particles (combustion, refinery and shipping sulfates, some sea salt) and
          ozone, NO₂, SO₂, CO, each on its EPA scale. Strict: good ≤ {th.airGood}, OK ≤ {th.airOk}. In Abu Dhabi PM2.5
          is usually 35 to 50% of PM10 (2025 stations), not far from desert dust&apos;s ~30%: a good part of it is dust,
          and it&apos;s estimated hour by hour.
        </li>
        <li>
          <b>Dust / sand</b>: all the dust in PM10, rated on its own and leniently. A sandy day is fine for a couple
          of hours outside; avoid only above {pm10At(th.dustOk)} µg/m³ (a thick haze or a storm).
        </li>
      </ul>
      <p>
        The hour takes the worse of the two. Dust share: on measured hours, from the coarse fraction (fine dust ≈ 0.43 ×
        (PM10 − PM2.5)); on model hours, {DUST_FINE_FRACTION * 100}% of the CAMS dust load.
      </p>
      <p>
        Bands:{' '}
        {BAND.map((b, i) => `${i === 0 ? 0 : BAND[i - 1].max + 1} to ${b.max === Infinity ? 500 : b.max} ${b.label.toLowerCase()}`).join(', ')}.
        For going out, pollution: good ≤ {th.airGood}, OK ≤ {th.airOk}; dust as above.
      </p>
      <p className="od-pop-hint">
        Particles use the EPA NowCast (weighted 12 hour average), ozone and CO 8 hour means. US AQI here is a 24 hour
        average, so it reacts more slowly.
      </p>
    </>
  );
}

function UvInfo({ th }: { th: Thresholds }) {
  return (
    <>
      <h4>UV index</h4>
      <p>
        WHO scale: 0 to 2 low, 3 to 5 moderate, 6 to 7 high, 8 to 10 very high, 11+ extreme. In Abu Dhabi midday UV
        sits around 7 in winter and 11+ in summer; it drops below 3 roughly 2 hours after sunrise and before sunset.
      </p>
      <p>
        Rated assuming sunscreen is on: good ≤ {th.uvGood}, OK ≤ {th.uvOk} (reapply, seek shade), avoid above.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- good outdoor time

function windowText(d: DaySummary): string {
  if (d.windows.length) {
    return d.windows
      .map((w) => `${w.level === 'good' ? 'Good' : 'OK'} ${hh(w.from)} to ${hh(w.to)}`)
      .join(' · ');
  }
  if (!d.best) return 'no data';
  return `No comfortable hour. Least bad ${hh(d.best.hour)}: ${reasons(d.best)}`;
}

/** Short enough for the phone header: "1–5 Sep", "28 Aug–3 Sep". */
function rangeLabel(from: string, to: string): string {
  const [, fd, fm] = dayLabel(from).split(' ');
  const [, td, tm] = dayLabel(to).split(' ');
  if (from === to) return `${fd} ${fm}`;
  return fm === tm ? `${fd}–${td} ${tm}` : `${fd} ${fm}–${td} ${tm}`;
}

/**
 * A small custom dropdown: pill trigger, menu fixed-positioned under it (the header strip
 * scrolls horizontally, so an absolute child would be clipped).
 */
function Dropdown<T extends string | number>(props: {
  value: T;
  label: ReactNode;
  options: { value: T; label: string; sep?: boolean }[];
  onPick: (v: T) => void;
  ariaLabel?: string;
}) {
  const { value, label, options, onPick, ariaLabel } = props;
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const close = () => setPos(null);
  const toggle = () => {
    if (pos) return close();
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  };
  useEffect(() => {
    if (!pos) return;
    menu.current?.querySelector('.on')?.scrollIntoView({ block: 'center' });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`od-period${pos ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={ariaLabel}
        onClick={toggle}
      >
        {label}
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {pos &&
        createPortal(
          <>
            <div className="od-menu-backdrop" onClick={close} />
            <div ref={menu} className="od-menu" role="menu" style={{ top: pos.top, right: pos.right }}>
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === o.value}
                  className={`${value === o.value ? 'on' : ''}${o.sep ? ' sep' : ''}`}
                  onClick={() => {
                    close();
                    onPick(o.value);
                  }}
                >
                  {o.label}
                  {value === o.value && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** The end of the day is the hour after the last shown one; the last hour of the day ends at 24:00, not 00:00. */
const endLabel = (h: number) => (h === 23 ? '24:00' : hh(h + 1));

type Loaded = { plain: HourRaw[]; years: HourRaw[][] | null; start: string; end: string; dayOff: number };

/** One range's rows, cached for 10 minutes so flipping between days (and prefetching) is free. */
const rangeCache = new Map<string, { at: number; p: Promise<{ plain: HourRaw[]; years: HourRaw[][] | null }> }>();
function loadRange(start: string, end: string, forecastEnd: string, typical: boolean) {
  const key = `${start}|${end}|${forecastEnd}|${typical}`;
  const hit = rangeCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  // one extra day before so the 12h NowCast / 8h means are warm at the first shown hour
  const from0 = addDays(start, -1);
  const p = Promise.all([
    forecastEnd >= start ? fetchOutdoorMeasured(from0, forecastEnd) : Promise.resolve([] as HourRaw[]),
    typical ? fetchTypicalYears(from0, end) : Promise.resolve(null),
  ]).then(([plain, years]) => ({ plain, years }));
  rangeCache.set(key, { at: Date.now(), p });
  p.catch(() => rangeCache.delete(key)); // don't keep a failure
  return p;
}

/** Kids (stricter) limits: on unless this device turned them off; per device, in localStorage. */
const SENSITIVE_KEY = 'od-kids';
function readSensitive(): boolean {
  try {
    return localStorage.getItem(SENSITIVE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The hours a day shows, first and last inclusive; per device, in localStorage. */
type DayHours = { from: number; to: number };
const DAY_HOURS_KEY = 'od-day-hours';
function readDayHours(): DayHours {
  try {
    const d = JSON.parse(localStorage.getItem(DAY_HOURS_KEY) ?? 'null');
    if (d && Number.isInteger(d.from) && Number.isInteger(d.to) && 0 <= d.from && d.from <= d.to && d.to <= 23) return d;
  } catch {
    /* fall through to the default */
  }
  return { from: DAY_FROM, to: DAY_TO };
}

/** What the tiles show, like the clock: colour for heat, flames for strong sun, gas for bad air. */
function TilesKey() {
  return (
    <div className="od-key2">
      <span className="od-key2-heat">
        <span>feels</span>
        <i style={{ background: heatGradient(18, 47) }} />
        <span className="od-key2-ends">
          <span>18°</span>
          <span>47°</span>
        </span>
      </span>
      <span className="od-key2-fx">
        <span className="od-key2-item">
          <i className="fx-sun" /> strong sun
        </span>
        <span className="od-key2-item">
          <i className="fx-air" /> polluted air
        </span>
        <span className="od-key2-item">
          <i className="fx-dust" /> dust
        </span>
      </span>
    </div>
  );
}

const ZOOM_KEY = 'od-zoom';
const ZOOM_MAX = 5;
function readZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z >= 1 && z <= ZOOM_MAX ? z : 1;
  } catch {
    return 1;
  }
}

/**
 * Several days: one row per day, the 24 hours always on that one row, coloured like the
 * clock (feels-like spectrum; hours outside the day darkened; a flame glow for strong sun,
 * a violet haze for polluted air, sand for dust). Zoom (buttons, pinch, ctrl + wheel)
 * widens the hours; the rows then scroll sideways together, day labels pinned on the left.
 * Tap an hour for all three ratings, a day name for the day.
 */
function Tiles(props: {
  days: DaySummary[];
  /** the same days, restricted to the day setting: what a day's summary talks about */
  windowed: Map<string, DaySummary>;
  th: Thresholds;
  compact: boolean;
  nowKey: string;
  dayFrom: number;
  dayTo: number;
  /** "1 Jan" rows, for the year average where weekdays mean nothing */
  dateOnly?: boolean;
}) {
  const { days, windowed, th, compact, nowKey, dayFrom, dayTo, dateOnly } = props;
  const today = dubaiToday();
  const pop = usePop();
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(readZoom);
  const [fitW, setFitW] = useState(0);
  const CAP = compact ? 50 : 50;

  // the hour width that fits all 24 in the screen; zoom multiplies it
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFitW(Math.max(6, (el.clientWidth - 24 - 8 - CAP) / (dayTo - dayFrom + 1))) // the side padding (24) and the day name's own (8);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [CAP, dayFrom, dayTo]);
  const hw = fitW * zoom;

  // zoom around a point (x within the scroller), keeping the hour under it in place
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const setZoom = (z: number, x?: number) => {
    const el = scroller.current;
    const nz = Math.min(ZOOM_MAX, Math.max(1, z));
    if (el && fitW) {
      const px = (x ?? el.clientWidth / 2) - CAP;
      const at = (el.scrollLeft + px) / (fitW * zoomRef.current);
      requestAnimationFrame(() => (el.scrollLeft = at * fitW * nz - px));
    }
    setZoomState(nz);
    try {
      localStorage.setItem(ZOOM_KEY, String(nz));
    } catch {
      /* private mode */
    }
  };

  // pinch (two fingers) and ctrl + wheel (trackpad pinch on a laptop)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let start: { d: number; z: number } | null = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) start = { d: dist(), z: zoomRef.current };
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && start) {
        const [a, b] = [...pts.values()];
        const r = el.getBoundingClientRect();
        setZoom((start.z * dist()) / start.d, (a.x + b.x) / 2 - r.left);
      }
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) start = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setZoom(zoomRef.current * Math.exp(-e.deltaY / 200), e.clientX - r.left);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [fitW]); // eslint-disable-line react-hooks/exhaustive-deps

  const showNum = !compact && hw >= 20;
  const showIcons = !compact && hw >= 34;
  const every = hw >= 44 ? 1 : hw >= 26 ? 3 : 6; // axis labels
  // only the hours of the day (settings): the night is left out, not just darkened
  const shown = Array.from({ length: dayTo - dayFrom + 1 }, (_, k) => dayFrom + k);

  return (
    <div className="od-tl">
      <div className="od-tl-bar">
        <TilesKey />
        <div className="od-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(zoom / 1.6)}>
            −
          </button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom * 1.6)}>
            +
          </button>
        </div>
      </div>
      <div
        className={`od-tl-scroll${compact ? ' compact' : ''}${dateOnly ? ' year' : ''}`}
        ref={scroller}
        style={{ '--hw': `${hw}px`, '--cap': `${CAP}px` } as React.CSSProperties}
      >
        <div className="od-tl-axis">
          <span className="od-tl-cap" />
          {shown.map((i) => (
            <span key={i} className="od-tl-tick">
              {i % every === 0 || i === dayFrom ? (i === 0 ? '0' : i === 12 ? 'Noon' : hh(i).slice(0, 2).replace(/^0/, '')) : ''}
            </span>
          ))}
        </div>
        {days.map((d, n) => {
          // long ranges: the weekday means little there, the month does. Its name is shown once,
          // on its first row, with a gap above it; the rows below only carry the date.
          const newMonth = n === 0 || d.day.slice(0, 7) !== days[n - 1].day.slice(0, 7);
          return (
          <div className={`od-tl-row${compact && newMonth && n > 0 ? ' mstart' : ''}`} key={d.day}>
            <button
              type="button"
              className={`od-tl-cap${compact ? ' dated' : ''}${d.day === today ? ' today' : ''}`}
              {...pop(() => <DayDetail d={windowed.get(d.day) ?? d} />)}
            >
              {compact ? (
                <>
                  <span className="od-tl-mon">{newMonth ? MONTH[Number(d.day.slice(5, 7)) - 1] : ''}</span>
                  <span className="od-tl-dn">
                    {(() => {
                      // the year's 9px rows: every date would be a wall of numbers, so a few landmarks
                      const dn = Number(d.day.slice(8, 10));
                      return !dateOnly || d.day === today || dn === 1 || dn % 5 === 0 ? dn : '';
                    })()}
                  </span>
                </>
              ) : dateOnly ? (
                dayLabel(d.day).split(' ').slice(1).join(' ')
              ) : (
                rowDay(d.day)
              )}
            </button>
            <TileStrip row={tileRow(d, shown)} hw={hw} past={(c) => c.h!.day === today && c.h!.time < nowKey}>
              {(c) => {
                const h = c.h!;
                const { sun, air } = c;
                return (
                  <button
                    type="button"
                    key={c.i}
                    className={`od-tl-cell${h.time === nowKey ? ' now' : ''}${sun ? ' sun' : ''}${air}`}
                    aria-label={`${hh(h.hour)}, feels ${fmt(h.feels, 0, '°')}${sun ? ', strong sun' : ''}${air ? `, ${air.trim() === 'dust' ? 'dust' : 'polluted air'}` : ''}`}
                    {...pop(() => <HourCard h={h} />)}
                  >
                    {showNum && <span>{h.hour}</span>}
                    {showIcons && (sun || air) && (
                      <span className="od-mk-ic" aria-hidden="true">
                        {sun && <Glyph k="sun" color="#fff" />}
                        {air && <Glyph k="air" color="#fff" />}
                      </span>
                    )}
                  </button>
                );
              }}
            </TileStrip>
          </div>
          );
        })}
      </div>
    </div>
  );
}
const RANK_OF: Record<Level, number> = { good: 0, na: 0, ok: 1, bad: 2 };

type TileCell = { i: number; h?: DaySummary['hours'][number]; col: RGB; sun: boolean; air: '' | ' air' | ' dust' };
/** One day's shown hours with what the tiles draw: heat colour, strong sun, and the air effect. */
function tileRow(d: DaySummary, shown: number[]): TileCell[] {
  return shown.map((i) => {
    const h = d.hours.find((x) => x.hour === i);
    if (!h) return { i, col: [60, 60, 67] as RGB, sun: false, air: '' as const };
    const dusty = h.dustLevel === 'bad' && RANK_OF[h.dustLevel] >= RANK_OF[h.chemLevel];
    return {
      i,
      h,
      col: h.feels == null ? ([60, 60, 67] as RGB) : heatRGB(h.feels),
      sun: !h.night && h.uvLevel === 'bad',
      air: h.air === 'bad' ? (dusty ? ' dust' : ' air') : '',
    };
  });
}
const EMPTY_RGB: RGB = [40, 40, 44];

/**
 * One day's hours painted as a whole, not as boxes: the heat is one gradient through every
 * hour's colour, each run of strong sun / bad air is one shape with soft ends that melt into
 * the neighbours, and the past is dimmed by one veil. The hour buttons sit on top, transparent.
 */
function TileStrip({ row, hw, past, children }: { row: TileCell[]; hw: number; past: (c: TileCell) => boolean; children: (c: TileCell) => React.ReactNode }) {
  const n = row.length;
  const heat = `linear-gradient(to right, ${row.map((c, k) => `${rgb(c.h ? c.col : EMPTY_RGB)} ${(((k + 0.5) / n) * 100).toFixed(2)}%`).join(', ')})`;
  const spill = hw * 0.35;
  const runs: { kind: string; from: number; to: number }[] = [];
  for (const kindOf of [(c: TileCell) => (c.sun ? 'sun' : ''), (c: TileCell) => c.air.trim()]) {
    row.forEach((c, k) => {
      const kind = c.h ? kindOf(c) : '';
      const last = runs[runs.length - 1];
      if (kind && last && last.kind === kind && last.to === k - 1) last.to = k;
      else if (kind) runs.push({ kind, from: k, to: k });
    });
  }
  const pastN = row.filter((c) => c.h && past(c)).length;
  return (
    <div className="od-tl-strip" style={{ background: heat }}>
      {runs.map((r) => {
        const fl = r.from > 0 ? spill : 0;
        const fr = r.to < n - 1 ? spill : 0;
        const left = r.from * hw - fl;
        const mask = `linear-gradient(to right, ${fl ? 'transparent' : '#000'}, #000 ${2 * fl}px, #000 calc(100% - ${2 * fr}px), ${fr ? 'transparent' : '#000'})`;
        return (
          <i
            key={`${r.kind}${r.from}`}
            className={`od-tl-run fx-${r.kind}`}
            style={{ left, width: (r.to - r.from + 1) * hw + fl + fr, backgroundPositionX: -left, WebkitMaskImage: mask, maskImage: mask }}
          />
        );
      })}
      {pastN > 0 && <i className="od-tl-past" style={{ width: pastN * hw }} />}
      {row.map((c) => (c.h ? children(c) : <span key={c.i} className="od-tl-cell empty" />))}
    </div>
  );
}

/** An hour, the way the clock explains it: verdict and reason, then heat / sun / air rows. */
const LV_COLOR: Record<Level, string> = { good: '#30d158', ok: '#ffb340', bad: '#ff453a', na: 'rgba(235,235,245,.45)' };
const GLYPH_PATHS = {
  heat: '<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0Z"/><path d="M12 9v6.5"/><circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
  air: '<path d="M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12.5h15a2.8 2.8 0 1 1-2.8 2.8"/><path d="M3 16.5h7"/>',
};
function Glyph({ k, color }: { k: keyof typeof GLYPH_PATHS; color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke={color}
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color, filter: `drop-shadow(0 0 5px ${color}55)` }}
      dangerouslySetInnerHTML={{ __html: GLYPH_PATHS[k] }}
    />
  );
}
function HourCard({ h }: { h: Hour }) {
  const dusty = RANK_OF[h.dustLevel] >= RANK_OF[h.chemLevel] && RANK_OF[h.dustLevel] > 0;
  const airWord =
    h.air === 'good' ? 'Clean air' : dusty ? (h.air === 'bad' ? 'Dusty air' : 'Some dust') : h.air === 'bad' ? 'Smoggy air' : 'Hazy air';
  const rows = [
    { k: 'heat' as const, lv: h.heat, t: h.heat === 'bad' ? 'Too hot' : h.heat === 'ok' ? 'Warm' : 'Comfortable', v: `feels ${fmt(h.feels, 0, '°')}` },
    h.night
      ? { k: 'moon' as const, lv: 'na' as Level, t: 'Sun is down', v: '' }
      : { k: 'sun' as const, lv: h.uvLevel, t: h.uvLevel === 'bad' ? 'Strong sun' : h.uvLevel === 'ok' ? 'Sunny, hats on' : 'Gentle sun', v: `UV ${fmt(h.uv, 0)}` },
    { k: 'air' as const, lv: h.air, t: airWord, v: h.adai == null ? 'no data' : dusty ? `dust ${h.dustIdx}` : `AQI ${h.chem}` },
  ];
  // like the clock's centre: what holds the hour back, at its worst level ("Too hot, strong sun")
  const worst = rows.filter((r) => r.lv === h.verdict && r.lv !== 'na').map((r) => r.t);
  const why =
    h.verdict === 'good' || !worst.length
      ? `Feels ${fmt(h.feels, 0, '°')}`
      : worst.map((w, i) => (i ? w.toLowerCase() : w)).join(', ');
  return (
    <div className="od-hc">
      <div className="od-hc-head">
        <span>
          {relDay(h.day)}, {hh(h.hour)}
        </span>
        <b style={{ color: LV_COLOR[h.verdict] }}>{LEVEL_LABEL[h.verdict]}</b>
      </div>
      <div className="od-hc-why">{why}</div>
      {rows.map((r) => (
        <div className="od-hc-row" key={r.k}>
          <Glyph k={r.k} color={LV_COLOR[r.lv]} />
          <span>{r.t}</span>
          <b style={{ color: r.lv === 'na' ? undefined : LV_COLOR[r.lv] }}>{r.v}</b>
        </div>
      ))}
      <div className="od-hc-src">
        {fmt(h.temp, 0, '°')} air · {fmt(h.humidity, 0, '%')} humidity ·{' '}
        {h.airSrc === 'station' ? 'air measured at 5 EAD stations' : h.airSrc === 'typical' ? '3-year average' : 'forecast'}
      </div>
    </div>
  );
}

/** Today as the clock (see clock.ts), fed with the live hours. */
function TodayClock(props: {
  hours: Hour[];
  nowKey: string;
  live: boolean;
  dayWord: string;
  date: string;
  dayFrom: number;
  dayTo: number;
  /** play the ring's sweep-in (first load only; day changes slide instead) */
  intro: boolean;
  onMounted: () => void;
}) {
  const { hours, nowKey, live, dayWord, date, dayFrom, dayTo, intro, onMounted } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const byHour = new Map(hours.map((h) => [h.hour, h]));
    const clock: ClockHour[] = Array.from({ length: 24 }, (_, i) => {
      const h = byHour.get(i);
      return {
        hour: i,
        feels: Math.round(h?.feels ?? 0),
        heat: h?.heat ?? 'na',
        uv: h?.uv ?? 0,
        uvLevel: h?.uvLevel ?? 'na',
        night: h?.night ?? (i < 6 || i >= 19),
        pollution: h?.chem ?? null,
        pollutionLevel: h?.chemLevel ?? 'na',
        pollutant: h?.chemDriver ?? null,
        dust: h?.dustIdx ?? null,
        dustLevel: h?.dustLevel ?? 'na',
        air: h?.air ?? 'na',
        verdict: h?.verdict ?? 'na',
      };
    });
    // re-render from scratch; the cleanup stops the animation loop and its listeners
    root.innerHTML = CLOCK_HTML;
    const stop = mountClock(root, { date, nowHour: Number(nowKey.slice(11, 13)), hours: clock, live, dayWord, intro, dayFrom, dayTo });
    onMounted();
    return stop;
  }, [hours, nowKey, live, dayWord, date, dayFrom, dayTo]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="od-clock" ref={ref} />;
}

/** A day at a glance: its windows, plus how many waking hours each factor rules out. */
function DayDetail({ d }: { d: DaySummary }) {
  return (
    <>
      <h4>{dayLabel(d.day)}</h4>
      <p>
        {windowText(d)}
        {!d.airKnown && ' (no air data, rated on heat and UV only)'}
      </p>
      <table className="od-pop-table">
        <thead>
          <tr>
            <th />
            <th>Good</th>
            <th>OK</th>
            <th>Avoid</th>
          </tr>
        </thead>
        <tbody>
          {FACTORS.map((f) => {
            const n = (l: Level) => d.hours.filter((h) => factorLevel(h, f.id) === l).length;
            return (
              <tr key={f.id}>
                <td>
                  {f.icon} {f.label}
                </td>
                <td>{n('good')}h</td>
                <td>{n('ok')}h</td>
                <td>{n('bad')}h</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="od-pop-hint">
        Hours {hh(d.hours[0]?.hour ?? DAY_FROM)} to {hh((d.hours.at(-1)?.hour ?? DAY_TO) + 1)}. Tap an hour for its details.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- charts

/** The charts are the evidence, not the answer: folded away until asked for (remembered per browser). */
function ChartsToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('outdoor.charts') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem('outdoor.charts', open ? '0' : '1');
    } catch {
      /* storage blocked */
    }
  };
  return (
    <>
      <button type="button" className="od-more" aria-expanded={open} onClick={toggle}>
        {open ? 'Hide charts' : 'Show charts'} <span className={open ? 'od-chev open' : 'od-chev'}>▾</span>
      </button>
      {open && children}
    </>
  );
}

interface SeriesDef {
  key: keyof ChartPoint;
  label: string;
  color: string;
  dash?: string;
}

function xTicks(points: ChartPoint[], span: number): string[] {
  const step = span <= 1 ? 3 : span <= 3 ? 12 : 24;
  return points.filter((p) => Number(p.key.slice(11, 13)) % step === 0).map((p) => p.key);
}

function fmtX(key: string, span: number): string {
  if (span > COMPACT_AFTER) return `${Number(key.slice(8, 10))} ${MONTH[Number(key.slice(5, 7)) - 1]}`;
  const h = Number(key.slice(11, 13));
  if (span <= 1) return hh(h);
  if (h === 0) return dayLabel(key.slice(0, 10)).split(' ').slice(0, 2).join(' ');
  return hh(h);
}

function OdChart(props: {
  title: string;
  info: () => ReactNode;
  unit: string;
  series: SeriesDef[];
  points: ChartPoint[];
  byTime: Map<string, Hour>;
  th: Thresholds;
  span: number;
  nowKey: string;
  refs?: { y: number; label: string }[];
  domain?: [number | string, number | string];
  digits?: number;
}) {
  const { points, span, series, unit, byTime, th } = props;
  const ticks = useMemo(() => xTicks(points, span), [points, span]);
  const hasNow = points.some((p) => p.key === props.nowKey);
  // look the hour up by its key: Recharts sends an empty payload when every series is null
  const byKey = useMemo(() => new Map(points.map((p) => [p.key, p])), [points]);
  const digits = props.digits ?? 0;
  return (
    <section className="od-panel od-chart">
      <div className="od-panel-head">
        <h3>
          {props.title} <span className="od-unit">{unit}</span> <Info>{props.info}</Info>
        </h3>
        {series.length > 1 && (
          <div className="od-legend">
            {series.map((s) => (
              <span key={s.key}>
                <i className="od-line" style={{ background: s.color, opacity: s.dash ? 0.7 : 1 }} /> {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="key"
            ticks={ticks}
            tickFormatter={(k) => fmtX(k, span)}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            stroke="var(--border)"
            interval="preserveStart"
            minTickGap={10}
          />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} stroke="var(--border)" domain={props.domain ?? ['auto', 'auto']} />
          {props.refs?.map((r) => (
            <ReferenceLine
              key={r.label}
              y={r.y}
              stroke="var(--muted)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{ value: r.label, position: 'insideTopRight', fontSize: 10, fill: 'var(--muted)' }}
            />
          ))}
          {hasNow && (
            <ReferenceLine x={props.nowKey} stroke="var(--text)" strokeOpacity={0.5} label={{ value: 'now', position: 'insideTopLeft', fontSize: 10, fill: 'var(--muted)' }} />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
            wrapperStyle={{ zIndex: 5 }}
            content={({ active, label }) => {
              const pt = byKey.get(String(label));
              if (!active || !pt) return null;
              const h = byTime.get(pt.key);
              return (
                <div className="od-tip">
                  <div className="od-tip-series">
                    {series.map((s) => {
                      const v = pt[s.key] as number | null | undefined;
                      return (
                        <div key={s.key} className="od-tip-row">
                          <i className="od-line" style={{ background: s.color }} />
                          <span>{s.label}</span>
                          <b>{v == null ? 'n/a' : `${v.toFixed(digits)}${unit === '°C' ? '°' : ''}`}</b>
                        </div>
                      );
                    })}
                  </div>
                  {h && <HourDetail h={h} th={th} compact />}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--panel)' }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

const C = (n: number) => `var(--od-s${n})`;

function Charts(props: { points: ChartPoint[]; byTime: Map<string, Hour>; span: number; nowKey: string; th: Thresholds }) {
  const { th } = props;
  const common = { points: props.points, byTime: props.byTime, th, span: props.span, nowKey: props.nowKey };
  return (
    <div className="od-charts">
      <OdChart
        {...common}
        title="Temperature"
        unit="°C"
        info={() => (
          <>
            <h4>Temperature</h4>
            <p>
              <b>Air</b> is the thermometer reading. <b>Feels like</b> adds humidity and wind: that is what the rating
              uses, because coastal humidity makes a 32° night feel like 40°.
            </p>
            <p>
              The dashed line is the OK limit ({th.feelsOk}°). Good is ≤ {th.feelsGood}°.
            </p>
          </>
        )}
        series={[
          { key: 'feels', label: 'Feels like', color: C(2) },
          { key: 'temp', label: 'Air', color: C(1) },
        ]}
        refs={[{ y: th.feelsOk, label: `${th.feelsOk}° limit` }]}
      />
      <OdChart
        {...common}
        title="Humidity"
        unit="%"
        info={() => (
          <>
            <h4>Relative humidity</h4>
            <p>
              Not rated on its own: it enters the rating through feels-like. Near the Gulf it peaks at night and early
              morning (often 80 to 95%), which is why cool-looking dawns can still feel oppressive.
            </p>
          </>
        )}
        series={[{ key: 'humidity', label: 'Relative humidity', color: C(1) }]}
        domain={[0, 100]}
      />
      <OdChart
        {...common}
        title="UV index"
        unit=""
        digits={1}
        info={() => <UvInfo th={th} />}
        series={[{ key: 'uv', label: 'UV index', color: C(4) }]}
        refs={[{ y: th.uvOk, label: `UV ${th.uvOk}` }]}
        domain={[0, 'auto']}
      />
      <OdChart
        {...common}
        title="Air quality"
        unit="index"
        info={() => <AirIndexInfo th={th} />}
        series={[
          { key: 'adai', label: 'Abu Dhabi index', color: C(1) },
          { key: 'usAqi', label: 'US AQI', color: C(3), dash: '4 3' },
        ]}
        refs={[
          { y: th.airGood, label: `${th.airGood} good` },
          { y: th.airOk, label: `${th.airOk} limit` },
        ]}
        domain={[0, 'auto']}
      />
      <OdChart
        {...common}
        title="What drives the air index"
        unit="sub-index"
        info={() => (
          <>
            <h4>What drives the air index</h4>
            <p>
              Each pollutant converted to the same 0 to 500 scale. The Abu Dhabi index is simply the highest line at
              each hour, so this shows what to blame.
            </p>
            <ul>
              <li>
                <b>Non-dust PM2.5</b> high: smoke, traffic, refinery or shipping haze. The one to take seriously.
              </li>
              <li>
                <b>Sand / dust</b> high: desert dust, scored at half weight.
              </li>
              <li>
                <b>Ozone</b> high: sunny afternoons, formed from traffic and industry fumes.
              </li>
              <li>
                <b>NO₂, SO₂, CO</b>: traffic and industry gases, rarely the driver here.
              </li>
            </ul>
          </>
        )}
        series={[
          { key: 'subPm25', label: 'Non-dust fine particles', color: C(1) },
          { key: 'subDust', label: 'Dust', color: C(2) },
          { key: 'subO3', label: 'Ozone', color: C(3) },
          { key: 'subNo2', label: 'NO₂', color: C(4) },
          { key: 'subSo2', label: 'SO₂', color: C(5) },
          { key: 'subCo', label: 'CO', color: C(7) },
        ]}
        domain={[0, 'auto']}
      />
      <OdChart
        {...common}
        title="Particles"
        unit="µg/m³"
        info={() => (
          <>
            <h4>Particles</h4>
            <ul>
              <li>
                <b>PM10</b>: all particles under 10 µm, mostly sand here.
              </li>
              <li>
                <b>PM2.5</b>: fine particles under 2.5 µm, the ones that reach deep into the lungs.
              </li>
              <li>
                <b>Dust</b>: desert dust as modelled by CAMS (can exceed PM10, it includes coarser grains).
              </li>
              <li>
                <b>Non-dust PM2.5</b>: PM2.5 minus the estimated sand share: combustion, refinery and shipping
                sulfates, plus some sea salt.
              </li>
            </ul>
            <p className="od-pop-hint">
              Source: hours already measured use the median of 5 Environment Agency Abu Dhabi stations (Hamdan St,
              Khadija School, Khalifa School, Mussafah, Al Maqta). The forecast is the CAMS model via Open-Meteo, about 5
              days ahead.
            </p>
          </>
        )}
        series={[
          { key: 'pm10', label: 'PM10', color: C(1) },
          { key: 'dust', label: 'Dust', color: C(2) },
          { key: 'pm25', label: 'PM2.5', color: C(3) },
          { key: 'nonDustPm25', label: 'Non-dust PM2.5', color: C(8) },
        ]}
        domain={[0, 'auto']}
      />
    </div>
  );
}
