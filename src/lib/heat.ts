// The feels-like colour spectrum shared by the clock and the tiles, tied to the heat limits so
// the colour agrees with the rating: green while good, yellow to orange while OK, red from the
// first degree to avoid, deepening to crimson when far too hot. Continuous inside each zone, so
// 38° and 45° never look the same, with a step at each limit.
export type RGB = [number, number, number];

/** The heat limits the spectrum follows (Thresholds.feelsGood / feelsOk). */
export type HeatLimits = { feelsGood: number; feelsOk: number };
const NORMAL_HEAT: HeatLimits = { feelsGood: 32, feelsOk: 36 };

function zones({ feelsGood: g, feelsOk: o }: HeatLimits): [number, RGB][][] {
  return [
    [[g - 14, [48, 209, 150]], [g - 6, [48, 209, 88]], [g, [140, 222, 60]]],
    [[g, [255, 200, 40]], [o, [255, 140, 20]]],
    [[o, [255, 69, 58]], [o + 6, [226, 28, 52]], [o + 11, [150, 8, 40]]],
  ];
}

export function heatRGB(f: number, lim: HeatLimits = NORMAL_HEAT): RGB {
  const [good, ok, bad] = zones(lim);
  return lerp(f <= lim.feelsGood ? good : f <= lim.feelsOk ? ok : bad, f);
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
  const stops = zones(lim)
    .flat()
    .map(([t, c]) => `${rgb(c)} ${(((t - from) / (to - from)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
