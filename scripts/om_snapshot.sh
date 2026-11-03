#!/usr/bin/env bash
# The recent window of the page's two Open-Meteo calls, published at data/om/ so a browser that
# can't reach Open-Meteo itself (rate-limited shared exits, iCloud Private Relay) still has data.
# Same points and variables as fetchOutdoor in src/lib/api.ts; keep them in step.
#   scripts/om_snapshot.sh dist/data/om
set -euo pipefail
out=${1:?output dir}
mkdir -p "$out"
day() { python3 -c 'import datetime as d,sys; print(d.datetime.now(d.timezone(d.timedelta(hours=4))).date()+d.timedelta(days=int(sys.argv[1])))' "$1"; }
q="latitude=24.45&longitude=54.38&timezone=Asia%2FDubai"
gen=$(date -u +%FT%TZ)
get() { # name url
  curl -fsS --max-time 30 --retry 3 --retry-delay 5 --retry-all-errors "$2" -o "$out/$1.raw"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); d["generated"]=sys.argv[2]; json.dump(d,open(sys.argv[3],"w"),separators=(",",":"))' \
    "$out/$1.raw" "$gen" "$out/$1.json"
  rm "$out/$1.raw"
}
get weather "https://historical-forecast-api.open-meteo.com/v1/forecast?$q&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,uv_index,wind_speed_10m,is_day&start_date=$(day -35)&end_date=$(day 13)"
get air "https://air-quality-api.open-meteo.com/v1/air-quality?$q&hourly=pm10,pm2_5,dust,nitrogen_dioxide,sulphur_dioxide,ozone,carbon_monoxide,us_aqi,uv_index&past_days=35&forecast_days=7"
