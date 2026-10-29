# Outside, Abu Dhabi

**When can the kids go outside today?** One page that answers it, then shows why: a 24-hour
clock where the colour is how hot it feels (green comfortable, orange hot, red too hot),
flames mark hours with strong sun, a violet gas marks polluted air and a sandy haze marks
dust. Tap any hour for its heat, sun and air. Arrows move to yesterday and tomorrow;
longer ranges (last week, 3 days, 2 weeks, 1 or 3 months, a year average) are hour tiles.

**Live:** https://zboule.github.io/abu-dhabi-outside/

## Where the numbers come from

- **Weather:** [Open-Meteo](https://open-meteo.com) (forecast up to 16 days, history).
- **UV:** the CAMS UV index via Open-Meteo (history, about 5 days ahead). Further out, Open-Meteo's
  forecast UV, which comes from GFS by a simplified approximation that flattens the day (too low under a
  high sun, too high under a low one), corrected by a CAMS/GFS factor per month and hour.
- **Air, past hours:** measured, the median of 5 [Environment Agency Abu Dhabi](https://www.adairquality.ae)
  stations (Hamdan St, Khadija School, Khalifa School, Mussafah, Al Maqta). The model below misses most
  dust storms and halves traffic NO2, so anything already measured uses the stations.
- **Air, forecast:** particles (PM2.5, PM10) for the next 3 days are the mean of two models, read at this
  point by the hourly Action (`scripts/air_forecast.py`): [SILAM](https://silam.fmi.fi) by the Finnish
  Meteorological Institute (open data, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and
  [GEFS-Aerosols](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gefs/aerosol.php) by NOAA
  (public domain), both from their AWS open-data buckets. Scored against the stations over Oct 2026
  (next-day avoid/ok call), CAMS alone got 64% of hours right, each of the two 70-72%, their mean 72-75%
  (PM10 error 50 -> 28 µg/m³). Gases, dust and days 4-5 stay with the CAMS model via Open-Meteo, which is
  also the fallback when the blend is missing or over 12 hours old. The forecast hours are then nudged by
  the gap between the stations and the model over the last 3 measured hours, fading over ~12 hours.
- **1 and 3 months, year average:** the same dates over the last 3 years, each year rated on its own.

## How it rates an hour

- **Heat:** feels-like temperature.
- **Sun:** UV index, assuming sunscreen.
- **Air, two parts:** pollution (non-dust fine particles, ozone, NO2, SO2, CO on US EPA scales) is rated
  strictly; dust is rated on its own and only turns "avoid" when it's thick. An hour is the worst of
  heat, sun and air.
- **Kids limits** (on by default, in settings) are stricter on all three.
- **Day start / end** (settings, default the full day): hours outside it are darkened on the clock and
  never recommended.

Not medical advice: a guide for planning a day out.

## How it runs

A static Vite + React app on GitHub Pages. `.github/workflows/pages.yml` runs on every push and every
hour: it catches the EAD station mirror up (`scripts/ead_sync.py`, kept on the `data` branch as one
amended commit), archives the day's SILAM and GEFS-Aerosols point forecasts next to it and blends them
(`scripts/air_forecast.py`: `forecast/YYYY-MM/<source>-<run>.json` as issued, `forecast/latest.json` for
the page; needs numpy, h5py and eccodes, `scripts/requirements-forecast.txt`), builds the site and
publishes the mirror and the blend next to it at `data/air/YYYY-MM.json` and `data/forecast/latest.json`.

It also writes the phone widgets' feed, `data/widget/v1.json` (`scripts/widget_feed.mts`): every hour
from today to the end of the day after tomorrow, rated by the same code under both kids and adult
limits. Its shape is `contract/widget-feed.v1.schema.json`, and the level colours shared with the
native code are in `contract/tokens.json`.

```sh
npm install
npm run dev   # station data and the blend are only there in the deployed site (or copy them to public/data/)
```
