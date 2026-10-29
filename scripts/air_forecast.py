#!/usr/bin/env python3
"""Archive point forecasts of PM2.5 / PM10 for Abu Dhabi and blend them into forecast/latest.json.

Scored against the EAD stations over Sep 30 - Oct 29 2026 (next-day avoid/ok call), CAMS alone
got 64% of hours right, SILAM 70-75%, GEFS-Aerosols 73% and their mean 74% (PM10 error 50 -> 29
µg/m³, PM2.5 14 -> 9.5). So the page's particle forecast is the mean of SILAM and GEFS where both
reach, one of them where only one does, and CAMS beyond that. Gases stay with CAMS.

Sources (all public, read at one grid point only):
  - SILAM (Finnish Meteorological Institute, CC BY 4.0): one run a day on S3, hourly means, 0.2°,
    NetCDF-4 files of ~35 MB each (PM25 / PM10 x day 0..4). Only the HDF5 chunks that hold
    our point are fetched (HTTP ranges, about 2/3 of a file), once per run.
  - GEFS-Aerosols (NOAA, public domain): runs at 00/06/12/18 UTC, 3-hourly out to 120 h, 0.25°,
    GRIB2 on S3 with .idx files; the two PM messages (PMTF = PM2.5, PMTC = PM10, both µg/m³) of
    each step are fetched by byte range. NOAA may replace it with GCAFS: that just fails soft.
  - CAMS (Copernicus) through Open-Meteo, hourly, 5 days.

Layout on the `data` branch (FORECAST_DATA, default station-data/forecast):
  YYYY-MM/<source>-<run>.json   the point forecast of one run, as issued (never rewritten)
    {"source", "run_time", "lat", "lon", "tz": "Asia/Dubai", "hourly": [{"time", "pm25", "pm10"}]}
  latest.json                   the blend for the page, rewritten every run (see blend())

Times are Dubai wall clock "YYYY-MM-DDTHH:00", the hour starting then (the page's join key).
Each source fails soft: a run that can't be read is skipped and the blend uses what is there.
Needs numpy, h5py (SILAM) and eccodes (GEFS): see scripts/requirements-forecast.txt.

  air_forecast.py                   fetch what's new, archive it, write latest.json
  air_forecast.py --check-fresh 12  exit 1 if latest.json is older than 12 hours (no fetch)
"""
import argparse, datetime as dt, io, json, os, sys, time, urllib.error, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

DATA = os.environ.get("FORECAST_DATA", "station-data/forecast")
LAT, LON = 24.45, 54.38  # the page's point (src/lib/api.ts)
DUBAI = ZoneInfo("Asia/Dubai")
UTC = dt.timezone.utc
HOURS_AHEAD = 72
SILAM_DAYS = ("d0", "d1", "d2")
SILAM_URL = "https://fmi-opendata-silam-surface-netcdf.s3.amazonaws.com/global/%s/silam_glob_v6_1_%s_%s_%s.nc"
GEFS_URL = "https://noaa-gefs-pds.s3.amazonaws.com/gefs.%s/%s/chem/pgrb2ap25/gefs.chem.t%sz.a2d_0p25.f%03d.grib2"
GEFS_STEPS = range(0, HOURS_AHEAD + 1, 3)
CAMS_URL = (
    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=%s&longitude=%s"
    "&hourly=pm2_5,pm10&timezone=Asia/Dubai&past_days=1&forecast_days=5"
)


def log(*a):
    print(*a, flush=True)


def warn(*a):
    print(*a, file=sys.stderr, flush=True)


def http(url, rng=None, timeout=60, tries=4):
    """GET (a byte range of) a URL with retries; raises after the last try."""
    err = None
    for attempt in range(tries):
        try:
            rq = urllib.request.Request(url, headers={"Range": "bytes=%d-%s" % rng} if rng else {})
            with urllib.request.urlopen(rq, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise
            err = e
        except Exception as e:  # noqa: BLE001 - retried
            err = e
        time.sleep(2 * (attempt + 1))
    raise err


def dubai_key(t: dt.datetime) -> str:
    """A UTC instant -> the page's hour key (Dubai has no daylight saving)."""
    return t.astimezone(DUBAI).strftime("%Y-%m-%dT%H:00")


def r1(x):
    return None if x is None else round(float(x), 1)


# ---- archive ----------------------------------------------------------------------------


def archive_path(source: str, run: str) -> str:
    return os.path.join(DATA, f"{run[:4]}-{run[4:6]}", f"{source}-{run}.json")


def load(source: str, run: str):
    p = archive_path(source, run)
    return json.load(open(p)) if os.path.exists(p) else None


def save(source: str, run: str, run_time: dt.datetime, hourly: list, grid: dict):
    p = archive_path(source, run)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    doc = {
        "source": source,
        "run": run,
        "run_time": run_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fetched": dt.datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lat": LAT,
        "lon": LON,
        "tz": "Asia/Dubai",
        **grid,
        "hourly": hourly,
    }
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(tmp, p)
    log(f"wrote {p} ({len(hourly)} hours)")
    return doc


# ---- SILAM: one HDF5 point read over HTTP ranges ---------------------------------------------


class RangeFile(io.RawIOBase):
    """A read-only, seekable file over HTTP byte ranges (blocks cached), for h5py's metadata reads."""

    def __init__(self, url, block=1 << 18):
        self.url, self.pos, self.block, self.cache = url, 0, block, {}
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
            self.size = int(r.headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def _block(self, b):
        if b not in self.cache:
            lo = b * self.block
            self.cache[b] = http(self.url, (lo, min(self.size, lo + self.block) - 1))
        return self.cache[b]

    def readinto(self, buf):
        n = min(len(buf), self.size - self.pos)
        if n <= 0:
            return 0
        out = bytearray()
        while len(out) < n:
            b, off = divmod(self.pos + len(out), self.block)
            out += self._block(b)[off : off + n - len(out)]
        buf[:n] = out
        self.pos += n
        return n


def silam_point(url: str, var: str):
    """(times UTC, values) of `var` at the nearest grid point, reading only the chunks that hold it."""
    import h5py, numpy as np

    f = RangeFile(url)
    h = h5py.File(io.BufferedReader(f), "r")
    lat, lon = h["lat"][:], h["lon"][:]
    i, j = int(np.argmin(abs(lat - LAT))), int(np.argmin(abs(lon - LON)))
    tv = h["time"]
    units = tv.attrs["units"]
    units = units.decode() if isinstance(units, bytes) else str(units)
    unit, _, base = units.partition(" since ")
    base = dt.datetime.strptime(base.strip()[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    secs = {"seconds": 1, "minutes": 60, "hours": 3600, "days": 86400}[unit.strip()]
    times = [base + dt.timedelta(seconds=int(t) * secs) for t in tv[:]]
    ds = h[var]
    fill = float(ds.attrs.get("_FillValue", [-9e14])[0])
    pl = ds.id.get_create_plist()
    filters = [pl.get_filter(k)[0] for k in range(pl.get_nfilters())]  # 2 = shuffle, 1 = deflate
    if ds.chunks and ds.chunks[0] == 1 and filters in ([1], [2, 1]):
        # the chunk table is small; the chunks holding the point are fetched in parallel and one
        # value is picked out of each (inflate, then undo the byte shuffle for that element)
        want = {}
        for c in range(ds.id.get_num_chunks()):
            ci = ds.id.get_chunk_info(c)
            o = ci.chunk_offset
            if o[1] <= i < o[1] + ds.chunks[1] and o[2] <= j < o[2] + ds.chunks[2]:
                want[o[0]] = (ci.byte_offset, ci.size, (i - o[1]) * ds.chunks[2] + (j - o[2]))
        with ThreadPoolExecutor(8) as ex:
            raw = list(ex.map(lambda w: http(url, (w[0], w[0] + w[1] - 1)), want.values()))
        size = ds.dtype.itemsize
        count = ds.chunks[1] * ds.chunks[2]
        vals = []
        for (t, (_, _, k)), b in zip(want.items(), raw):
            flat = zlib.decompress(b)
            elem = bytes(flat[k + m * count] for m in range(size)) if filters == [2, 1] else flat[k * size : (k + 1) * size]
            vals.append((t, float(np.frombuffer(elem, dtype=ds.dtype)[0])))
        vals = [v for _, v in sorted(vals)]
        if len(vals) != len(times):
            raise ValueError(f"{len(vals)} chunks for {len(times)} times")
    else:
        vals = [float(x) for x in ds[:, i, j]]
    h.close()
    v = [None if x is None or x < 0 or x == fill or x > 1e9 else x for x in vals]
    return times, v, {"grid_lat": round(float(lat[i]), 3), "grid_lon": round(float(lon[j]), 3)}


def silam_run(day: dt.date):
    """Archive the SILAM run of `day` (today or yesterday UTC) if it is out; the stored doc or None."""
    run = day.strftime("%Y%m%d")
    doc = load("silam", run)
    if doc:
        return doc
    import h5py, numpy  # noqa: F401 - reported once, by the caller, when missing

    by = {}
    grid = {}
    for d in SILAM_DAYS:
        for var in ("PM25", "PM10"):
            url = SILAM_URL % (run, run, var, d)
            try:
                times, vals, grid = silam_point(url, var)
            except urllib.error.HTTPError as e:
                if e.code == 404 and d == "d0":
                    log(f"silam {run}: not out yet")
                    return None
                warn(f"silam {run} {d} {var}: {e}")
                continue
            except Exception as e:  # noqa: BLE001 - this day/var is left empty
                warn(f"silam {run} {d} {var}: {type(e).__name__} {e}")
                continue
            # "time: mean" stamped at the end of each hour: label it by the hour it covers
            for t, x in zip(times, vals):
                by.setdefault(dubai_key(t - dt.timedelta(hours=1)), {})[var] = x
    if not by:
        return None
    hourly = [{"time": k, "pm25": r1(v.get("PM25")), "pm10": r1(v.get("PM10"))} for k, v in sorted(by.items())]
    return save("silam", run, dt.datetime.combine(day, dt.time(), UTC), hourly, grid)


# ---- GEFS-Aerosols: two GRIB2 messages per step over HTTP ranges -----------------------------


def gefs_fetch_step(day: str, cyc: str, fh: int):
    """The two PM GRIB messages (bytes) of one forecast step: {pm25: PMTF, pm10: PMTC}, by byte range."""
    url = GEFS_URL % (day, cyc, cyc, fh)
    idx = http(url + ".idx").decode().strip().split("\n")
    offs = [int(line.split(":")[1]) for line in idx]
    out = {}
    for n, line in enumerate(idx):
        p = line.split(":")
        key = {"PMTF": "pm25", "PMTC": "pm10"}.get(p[3])
        if key and p[4] == "surface" and "Total aerosol" in p[6]:
            out[key] = http(url, (offs[n], offs[n + 1] - 1 if n + 1 < len(offs) else ""))
    return out


def gefs_decode(msgs: dict):
    """{pm25, pm10} at the nearest grid point (µg/m³) and the point used, from the raw messages."""
    import eccodes

    out, grid = {}, {}
    for key, b in msgs.items():
        g = eccodes.codes_new_from_message(b)
        try:
            units = eccodes.codes_get(g, "units")
            if "10**-6 g" not in units and "ug" not in units:
                raise ValueError(f"unexpected {key} units {units}")
            near = eccodes.codes_grib_find_nearest(g, LAT, LON)[0]
            out[key] = float(near.value)
            grid = {"grid_lat": round(near.lat, 3), "grid_lon": round(near.lon, 3)}
        finally:
            eccodes.codes_release(g)
    return out, grid


def gefs_run(run_time: dt.datetime):
    """Archive the GEFS-Aerosols run at `run_time` (a 00/06/12/18 UTC cycle); the doc, or None if not complete."""
    day, cyc = run_time.strftime("%Y%m%d"), run_time.strftime("%H")
    run = day + cyc
    doc = load("gefs", run)
    if doc:
        return doc
    import eccodes  # noqa: F401 - reported once, by the caller, when missing

    try:  # the last step's index is there once the run is complete
        http((GEFS_URL % (day, cyc, cyc, GEFS_STEPS[-1])) + ".idx")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            log(f"gefs {run}: not out yet")
            return None
        raise

    def one(fh):
        try:
            return fh, gefs_fetch_step(day, cyc, fh)
        except Exception as e:  # noqa: BLE001 - this step is left empty
            warn(f"gefs {run} f{fh:03d}: {type(e).__name__} {e}")
            return fh, {}

    with ThreadPoolExecutor(8) as ex:
        steps = list(ex.map(one, GEFS_STEPS))
    hourly, grid = [], {}
    for fh, msgs in steps:  # decoded here, not in the threads (eccodes isn't thread-safe)
        try:
            v, g = gefs_decode(msgs) if msgs else ({}, {})
        except Exception as e:  # noqa: BLE001
            warn(f"gefs {run} f{fh:03d}: {type(e).__name__} {e}")
            continue
        grid = g or grid
        if v:
            hourly.append({"time": dubai_key(run_time + dt.timedelta(hours=fh)), "pm25": r1(v.get("pm25")), "pm10": r1(v.get("pm10"))})
    if len(hourly) < len(GEFS_STEPS) // 2:
        warn(f"gefs {run}: only {len(hourly)} of {len(GEFS_STEPS)} steps, not kept")
        return None
    return save("gefs", run, run_time, hourly, grid)


# ---- CAMS through Open-Meteo --------------------------------------------------------------


def cams_run(bucket: dt.datetime, fetch=True):
    """Archive the CAMS forecast as Open-Meteo serves it now, keyed by 6-hour fetch bucket (its run time isn't exposed)."""
    run = bucket.strftime("%Y%m%d%H")
    doc = load("cams", run)
    if doc or not fetch:
        return doc
    body = json.loads(http(CAMS_URL % (LAT, LON)))
    h = body["hourly"]
    hourly = [{"time": t, "pm25": r1(a), "pm10": r1(b)} for t, a, b in zip(h["time"], h["pm2_5"], h["pm10"]) if a is not None or b is not None]
    if not hourly:
        return None
    grid = {"grid_lat": body.get("latitude"), "grid_lon": body.get("longitude")}
    return save("cams", run, bucket, hourly, grid)


# ---- the blend --------------------------------------------------------------------------


def layer(docs):
    """{time: {pm25, pm10}} from older to newer runs, the newest winning where they overlap."""
    out = {}
    for d in docs:
        for h in d["hourly"]:
            out[h["time"]] = {"pm25": h.get("pm25"), "pm10": h.get("pm10")}
    return out


def hour_keys(start: dt.datetime, hours: int):
    return [dubai_key(start + dt.timedelta(hours=k)) for k in range(hours)]


def interpolate(series: dict, keys, max_gap=6):
    """Hourly values from a sparse {time: {pm25, pm10}} (GEFS is 3-hourly), linear across gaps up to max_gap hours."""
    out = {}
    for var in ("pm25", "pm10"):
        known = [(k, series[k][var]) for k in keys if k in series and series[k][var] is not None]
        pos = {k: n for n, k in enumerate(keys)}
        for (ka, va), (kb, vb) in zip(known, known[1:]):
            a, b = pos[ka], pos[kb]
            if b - a > max_gap:
                out.setdefault(ka, {})[var] = va
                continue
            for n in range(a, b + 1):
                out.setdefault(keys[n], {})[var] = va + (vb - va) * (n - a) / (b - a)
        if known:
            out.setdefault(known[-1][0], {})[var] = known[-1][1]
    return out


def blend(keys, silam: dict, gefs: dict, cams: dict):
    """One row per key: the mean of SILAM and GEFS where available, CAMS where neither is."""
    rows = []
    for k in keys:
        row = {"time": k}
        used = []
        for var in ("pm25", "pm10"):
            vals = [(s, src[k][var]) for s, src in (("silam", silam), ("gefs", gefs)) if k in src and src[k].get(var) is not None]
            if vals:
                row[var] = r1(sum(v for _, v in vals) / len(vals))
                used.append("+".join(s for s, _ in vals))
            elif k in cams and cams[k].get(var) is not None:
                row[var] = r1(cams[k][var])
                used.append("cams")
            else:
                row[var] = None
        row["src"] = used[0] if used and all(u == used[0] for u in used) else "+".join(dict.fromkeys(used)) or None
        for s, src in (("silam", silam), ("gefs", gefs), ("cams", cams)):
            row[s] = [r1(src[k].get("pm25")), r1(src[k].get("pm10"))] if k in src else None
        rows.append(row)
    return rows


def write_latest(silam_docs, gefs_docs, cams_docs, now: dt.datetime):
    start = now.astimezone(DUBAI).replace(hour=0, minute=0, second=0, microsecond=0) - dt.timedelta(days=1)
    keys = hour_keys(start, 24 + HOURS_AHEAD + (now.astimezone(DUBAI).hour + 1))
    silam = layer(silam_docs)
    gefs = interpolate(layer(gefs_docs), keys)
    cams = layer(cams_docs)
    rows = blend(keys, silam, gefs, cams)
    while rows and rows[-1]["pm25"] is None and rows[-1]["pm10"] is None:
        rows.pop()
    doc = {
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lat": LAT,
        "lon": LON,
        "tz": "Asia/Dubai",
        "runs": {"silam": [d["run"] for d in silam_docs], "gefs": [d["run"] for d in gefs_docs], "cams": [d["run"] for d in cams_docs]},
        "hourly": rows,
    }
    os.makedirs(DATA, exist_ok=True)
    p = os.path.join(DATA, "latest.json")
    with open(p + ".tmp", "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(p + ".tmp", p)
    n = {}
    for r in rows:
        n[r["src"]] = n.get(r["src"], 0) + 1
    log(f"wrote {p}: {len(rows)} hours, " + ", ".join(f"{k}: {v}" for k, v in n.items()))
    return doc


def check_fresh(hours: float) -> int:
    p = os.path.join(DATA, "latest.json")
    if not os.path.exists(p):
        log("no latest.json")
        return 1
    gen = dt.datetime.strptime(json.load(open(p))["generated"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    age = (dt.datetime.now(UTC) - gen).total_seconds() / 3600
    log(f"latest.json generated {gen:%Y-%m-%dT%H:%MZ}, {age:.1f} h old (limit {hours:g} h)")
    return 0 if age <= hours else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-fresh", type=float, metavar="HOURS", help="only check latest.json's age")
    a = ap.parse_args()
    if a.check_fresh is not None:
        sys.exit(check_fresh(a.check_fresh))
    now = dt.datetime.now(UTC).replace(microsecond=0)
    sources = {}

    def attempt(name, fn, candidates, keep=2):
        """The newest `keep` runs among candidates (newest first), each fetched or read from the archive."""
        docs = []
        for c in candidates:
            try:
                d = fn(c)
            except ImportError as e:
                warn(f"{name}: {e} (pip install -r scripts/requirements-forecast.txt)")
                break
            except Exception as e:  # noqa: BLE001 - a source failing never stops the others
                warn(f"{name} {c}: {type(e).__name__} {e}")
                d = None
            if d:
                docs.append(d)
            if len(docs) == keep:
                break
        if not docs:
            warn(f"{name}: nothing available")
        sources[name] = docs[::-1]  # older first, for layering

    today = now.date()
    attempt("silam", silam_run, [today - dt.timedelta(days=k) for k in range(3)])
    cycle = now.replace(hour=now.hour // 6 * 6, minute=0, second=0)
    attempt("gefs", gefs_run, [cycle - dt.timedelta(hours=6 * k) for k in range(6)])
    # CAMS: fetched now; if Open-Meteo is down, the newest archived copy (up to a day old)
    attempt("cams", lambda b: cams_run(b, fetch=b == cycle), [cycle - dt.timedelta(hours=6 * k) for k in range(5)], keep=1)
    write_latest(sources["silam"], sources["gefs"], sources["cams"], now)


if __name__ == "__main__":
    main()
