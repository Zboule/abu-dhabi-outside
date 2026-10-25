// The feels-like colour spectrum shared by the clock and the tiles: blue when too cold for the
// pool, green when comfortable,
// through yellow and orange, to red and deep crimson when far too hot. Continuous, so 38°
// and 45° never look the same and neighbouring hours blend, but placed on the heat limits
// (kids or not) so the colour agrees with the rating: orange just under the avoid limit,
// red just over it.
export type RGB = [number, number, number];

/** The limits the spectrum follows (Thresholds.feelsGood / feelsOk, and poolOk for the cold end). */
export type HeatLimits = { feelsGood: number; feelsOk: number; poolOk: number };
const NORMAL_HEAT: HeatLimits = { feelsGood: 32, feelsOk: 36, poolOk: 23 };

function heatStops({ feelsGood: g, feelsOk: o, poolOk: c }: HeatLimits): [number, RGB][] {
  return [
    // too cold for the pool: blue, deepening with the cold
    [c - 6, [10, 110, 255]], [c - 0.3, [90, 200, 250]], [c + 0.3, [48, 209, 150]],
    [g - 6, [48, 209, 88]], [g - 1, [140, 222, 60]], [g + 1, [255, 200, 40]],
    [o - 1, [255, 140, 20]], [o + 0.3, [255, 69, 58]], [o + 6, [226, 28, 52]], [o + 11, [150, 8, 40]],
  ];
}

export function heatRGB(f: number, lim: HeatLimits = NORMAL_HEAT): RGB {
  return lerp(heatStops(lim), f);
}

function lerp(S: [number, RGB][], f: number): RGB {
  if (f <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) {
    const [x1, c1] = S[i];
    const [x0, c0] = S[i - 1];
    if (f <= x1) {
      const t = (f - x0) / (x1 - x0);
      return c0.map((v, k) => v + (c1[k] - v) * t) as RGB;
    }
  }
  return S[S.length - 1][1];
}

/** Hours outside the day (settings) sink into a cool slate, as on the clock. */
export const nightRGB = (c: RGB, amount = 0.74): RGB =>
  c.map((v, k) => v + ([34, 37, 50][k] - v) * amount) as RGB;

export const rgb = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** The spectrum as a CSS gradient over [from, to] °C, for a key. */
export function heatGradient(from = 18, to = 47, lim: HeatLimits = NORMAL_HEAT): string {
  const stops = heatStops(lim).map(([t, c]) => `${rgb(c)} ${(((t - from) / (to - from)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
