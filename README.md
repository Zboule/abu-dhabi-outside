# Outside, Abu Dhabi

**When can the kids go outside today?** One page that answers it, then shows why: a 24-hour
clock where the colour is how hot it feels (green comfortable, orange hot, red too hot),
flames mark hours with strong sun, a violet gas marks polluted air and a sandy haze marks
dust. Tap any hour for its heat, sun and air. Arrows move to yesterday and tomorrow;
longer ranges (3 days, 16 days, a week, the next months, a year average) are hour tiles.

**Live:** https://zboule.github.io/abu-dhabi-outside/

## Where the numbers come from

- **Weather and UV:** [Open-Meteo](https://open-meteo.com) (forecast up to 16 days, history).
- **Air, past hours:** measured, the median of 5 [Environment Agency Abu Dhabi](https://www.adairquality.ae)
  stations (Hamdan St, Khadija School, Khalifa School, Mussafah, Al Maqta). The model below misses most
  dust storms and halves traffic NO2, so anything already measured uses the stations.
- **Air, forecast:** the CAMS model via Open-Meteo, about 5 days ahead, rough.
- **Next months, year average:** the same dates over the last 3 years, each year rated on its own.

## How it rates an hour

- **Heat:** feels-like temperature.
- **Sun:** UV index, assuming sunscreen.
- **Air, two parts:** pollution (non-dust fine particles, ozone, NO2, SO2, CO on US EPA scales) is rated
  strictly; dust is rated on its own and only turns "avoid" when it's thick. An hour is the worst of
  heat, sun and air.
- **Kids limits** (on by default, in settings) are stricter on all three. Nothing is recommended outside
  07:00 to 21:00.

Not medical advice: a guide for planning a day out.

## How it runs

A static Vite + React app on GitHub Pages. `.github/workflows/pages.yml` runs on every push and every
20 minutes: it catches the EAD station mirror up (`scripts/ead_sync.py`, kept on the `data` branch as one
amended commit), builds the site and publishes the mirror next to it at `data/air/YYYY-MM.json`.

```sh
npm install
npm run dev   # station data is only there in the deployed site (or copy it to public/data/air)
```
