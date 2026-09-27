// The feels-like colour spectrum shared by the clock and the tiles: green when comfortable,
// through yellow and orange, to red and deep crimson when far too hot. Continuous, so 38°
// and 45° never look the same.
export type RGB = [number, number, number];

export const HEAT_STOPS: [number, RGB][] = [
  [18, [48, 209, 150]], [26, [48, 209, 88]], [31, [140, 222, 60]], [33, [255, 200, 40]],
  [35, [255, 140, 20]], [37.5, [255, 69, 58]], [42, [226, 28, 52]], [47, [150, 8, 40]],
];

export function heatRGB(f: number): RGB {
  const S = HEAT_STOPS;
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
export function heatGradient(from = 18, to = 47): string {
  const stops = HEAT_STOPS.map(([t, c]) => `${rgb(c)} ${(((t - from) / (to - from)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
