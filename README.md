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
- **Air, forecast:** the CAMS model via Open-Meteo, about 5 days ahead, rough.
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
amended commit), builds the site and publishes the mirror next to it at `data/air/YYYY-MM.json`.

It also writes the phone widgets' feed, `data/widget/v1.json` (`scripts/widget_feed.mts`): every hour
from today to the end of the day after tomorrow, rated by the same code under both kids and adult
limits. Its shape is `contract/widget-feed.v1.schema.json`, and the level colours shared with the
native code are in `contract/tokens.json`.

```sh
npm install
npm run dev   # station data is only there in the deployed site (or copy it to public/data/air)
```
