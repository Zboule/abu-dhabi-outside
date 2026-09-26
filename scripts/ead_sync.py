#!/usr/bin/env python3
"""Keep a local copy of Environment Agency Abu Dhabi (EAD) hourly station readings.

The page rates past hours on measured air rather than the CAMS model. EAD's public
API returns 3 days per call per station and has no CORS, so this script (run by the
GitHub Action every 20 minutes) mirrors it into monthly JSON files that are published
with the site at data/air/YYYY-MM.json.

File shape: {"stations": [...], "fields": [...], "hours": {station: {"YYYY-MM-DDTHH:00": [v...]}}}
Values are stored raw, zeros included (EAD logs a missing reading as 0); the
client does the QC and the median, so those rules can change without re-fetching.

  ead_sync.py                  catch up from the last stored hour to now (the timer)
  ead_sync.py --since 2023-01-01   re-fetch every window with a hole (backfill)
  ead_sync.py --seed raw.json  import a bulk download {station: [rows]}
"""
import argparse, datetime as dt, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

DATA = os.environ.get("EAD_DATA", "station-data/air")
API = "https://ead-airquality.azurewebsites.net/AQAPI/GetSelectedDateStationChart?selectedDate=%s&stationName=%s"
STATIONS = ["EAD_HamdanStreet", "EAD_KhadijaSchool", "EAD_KhalifaSchool", "EAD_Mussafah", "EAD_AlMaqta"]
FIELDS = ["pM25", "pM10", "o3", "nO2", "sO2", "co"]
DUBAI = ZoneInfo("Asia/Dubai")


def today() -> dt.date:
    return dt.datetime.now(DUBAI).date()


def key(row):
    d = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", row.get("recordedDate", ""))
    h = re.match(r"^(\d{1,2}) (AM|PM)$", row.get("hour", ""))
    if not d or not h:
        return None
    hour = int(h.group(1)) % 12 + (12 if h.group(2) == "PM" else 0)
    return f"{d.group(3)}-{d.group(1)}-{d.group(2)}T{hour:02d}:00"


class Store:
    def __init__(self):
        self.months, self.dirty = {}, set()

    def month(self, m):
        if m not in self.months:
            p = os.path.join(DATA, f"{m}.json")
            self.months[m] = json.load(open(p)) if os.path.exists(p) else {"stations": STATIONS, "fields": FIELDS, "hours": {}}
        return self.months[m]

    def add(self, station, rows):
        for r in rows:
            k = key(r)
            if not k:
                continue
            m = self.month(k[:7])
            m["hours"].setdefault(station, {})[k] = [r.get(f) for f in FIELDS]
            self.dirty.add(k[:7])

    def hours_on(self, station, day: dt.date) -> int:
        k = day.isoformat()
        return sum(1 for t in self.month(k[:7])["hours"].get(station, {}) if t.startswith(k))

    def save(self):
        os.makedirs(DATA, exist_ok=True)
        for m in sorted(self.dirty):
            p = os.path.join(DATA, f"{m}.json")
            tmp = p + ".tmp"
            with open(tmp, "w") as f:
                json.dump(self.months[m], f, separators=(",", ":"))
            os.replace(tmp, p)  # atomic: Caddy may be serving it
        print("wrote", ", ".join(sorted(self.dirty)) or "nothing")
        self.dirty.clear()


def fetch(day: dt.date, station: str):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(API % (day.isoformat(), station), timeout=60) as r:
                rows = json.load(r)
                return station, rows if isinstance(rows, list) else []
        except Exception as e:  # noqa: BLE001 - retried, then reported
            err = e
            time.sleep(2 * (attempt + 1))
    print(f"fail {day} {station}: {err}", file=sys.stderr)
    return station, None


def run(store: Store, windows):
    """windows: list of (day, station); each call returns day-2..day."""
    with ThreadPoolExecutor(6) as ex:
        for station, rows in ex.map(lambda w: fetch(*w), windows):
            if rows:
                store.add(station, rows)


def last_stored_day(store: Store) -> dt.date:
    t = today()
    for back in range(0, 400):
        d = t - dt.timedelta(days=back)
        if any(store.hours_on(s, d) for s in STATIONS):
            return d
    return t - dt.timedelta(days=3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="re-fetch every 3-day window from this date that has a hole")
    ap.add_argument("--seed", help="import a bulk {station: [rows]} JSON first")
    a = ap.parse_args()
    store = Store()
    if a.seed:
        raw = json.load(open(a.seed))
        for s in STATIONS:
            store.add(s, raw.get(s, []))
        store.save()
    t = today()
    if a.since:
        start = dt.date.fromisoformat(a.since)
        windows, d = [], t
        while d >= start:
            days = [d - dt.timedelta(days=i) for i in range(3)]
            for s in STATIONS:
                if any(store.hours_on(s, x) < 24 and x < t for x in days) or d == t:
                    windows.append((d, s))
            d -= dt.timedelta(days=3)
        print(f"backfill: {len(windows)} calls")
    else:
        # catch up from the last stored day (a frozen box can miss more than one window)
        start = last_stored_day(store) - dt.timedelta(days=1)
        windows, d = [], t
        while d >= start:
            windows += [(d, s) for s in STATIONS]
            d -= dt.timedelta(days=3)
    run(store, windows)
    store.save()


if __name__ == "__main__":
    main()
