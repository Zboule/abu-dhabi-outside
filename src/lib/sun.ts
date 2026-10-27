// Sunrise and sunset for a day in Abu Dhabi, computed (NOAA's solar equations), no API: the
// clock splits its face into day and night along them.
import { LAT, LON } from './api.ts';

const rad = Math.PI / 180;

/** Sunrise and sunset as decimal Dubai hours (UTC+4, no daylight saving) for "YYYY-MM-DD". */
export function sunTimes(day: string, lat = LAT, lon = LON, tz = 4): { rise: number; set: number } {
  const [y, m, d] = day.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  // the sun's centre 0.833° below the horizon: refraction and the half disc
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const at = (minutes: number) => minutes / 60 + tz;
  return { rise: at(720 - 4 * (lon + ha) - eq), set: at(720 - 4 * (lon - ha) - eq) };
}
