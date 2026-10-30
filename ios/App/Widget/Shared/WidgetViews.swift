import SwiftUI

// The widget faces, shared with the snapshot tests (WidgetSnapshots). They speak the page's clock:
// colour is how hot it feels, except on hours to avoid whatever the heat, which show the harm as
// a still frame of the clock's animation: flames rising where the sun burns skin (with a sun and
// a warning badge), violet gas or sandy haze where the air hurts lungs (with lungs); a line outside marks the good time to go out (green good, yellow OK), a blue line inside
// pool time. Colours: contract/tokens.json and src/outdoor/clock.ts.

extension Color {
    init(hex: String) {
        let v = UInt64(hex.dropFirst(), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

enum Palette {
    static let pool = (good: Color(hex: "#40c4ff"), ok: Color(hex: "#9bdcff"))
    static let smog = Color(hex: "#8f5cff")
    static let dust = Color(hex: "#a7794a")
    static let sun = Color.white
    static let noData = Color(hex: "#3c3c43")

    static func heat(_ h: FeedHour) -> Color { h.heatColor.map(Color.init(hex:)) ?? noData }

    /// The heat colour sunk toward the night: the clock's slate in dark mode, a soft grey on a
    /// light widget (a dark slate would weigh on it). `sink` 0 is the colour, 1 the night.
    static func heat(_ h: FeedHour, sink: Double, dark: Bool) -> Color {
        guard sink > 0, let hex = h.heatColor, let v = UInt64(hex.dropFirst(), radix: 16) else { return heat(h) }
        let c = [Double((v >> 16) & 0xff), Double((v >> 8) & 0xff), Double(v & 0xff)]
        let night: [Double] = dark ? [34, 37, 50] : [222, 223, 228]
        // on a light widget a half-sunk red reads as a cooler pink: sink further, toward grey
        let k = dark ? sink : min(1, sink * 1.35)
        let m = zip(c, night).map { ($0 + ($1 - $0) * k) / 255 }
        return Color(red: m[0], green: m[1], blue: m[2])
    }

    /// How far an hour sinks: outside the day hours like the night, today's past a little less.
    static let sinkNight = 0.74, sinkPast = 0.55
    /// Effects (fire, particles) and lines of sunk hours
    static let fadeNight = 0.3, fadePast = 0.35
    static func air(_ kind: String?) -> Color? { kind == "dust" ? dust : kind == "smog" ? smog : nil }
}

extension Level {
    var color: Color {
        switch self {
        case .good: return Color(hex: "#30d158")
        case .ok: return Color(hex: "#ffb340")
        case .bad: return Color(hex: "#ff453a")
        case .na: return Color.secondary.opacity(0.5)
        }
    }

    var symbol: String {
        switch self {
        case .good: return "checkmark"
        case .ok: return "exclamationmark"
        case .bad: return "xmark"
        case .na: return "minus"
        }
    }
}

/// Why an hour is to avoid whatever the heat: bad air, or strong UV. Bad air wins when both:
/// it is what the hour shows (as on the clock).
enum Hazard: Equatable {
    case uv, smog, dust

    init?(_ h: FeedHour) {
        switch h.badAir {
        case "smog": self = .smog
        case "dust": self = .dust
        default:
            guard h.strongSun == true else { return nil }
            self = .uv
        }
    }

    var sun: Bool { self == .uv }
    var air: Hazard? { self == .uv ? nil : self }
}

/// Deterministic scatter (the same picture on every render).
struct Scatter {
    private var x: UInt64
    init(_ seed: Int) { x = UInt64(truncatingIfNeeded: seed) &* 0x9E3779B97F4A7C15 | 1 }
    mutating func next() -> CGFloat {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17
        return CGFloat(x % 10_000) / 10_000
    }
}

/// The clock's flicker noise (src/outdoor/clock.ts), frozen at one moment.
func flicker(_ x: Double, _ t: Double = 1.7) -> Double {
    0.5 + 0.28 * sin(x * 1.7 + t * 5.3) + 0.14 * sin(x * 3.9 - t * 8.1 + 1.3) + 0.08 * sin(x * 9.1 + t * 13.7 + 4)
}

/// One flame tongue, as the clock draws them: a curved spike from its base to its tip, white-hot
/// at the root, orange, red, fading out at the tip.
func flameTongue(_ ctx: inout GraphicsContext, base l: CGPoint, _ r: CGPoint, tip: CGPoint, c1: CGPoint, c2: CGPoint, q: Double) {
    var p = Path()
    p.move(to: l)
    p.addQuadCurve(to: tip, control: c1)
    p.addQuadCurve(to: r, control: c2)
    p.closeSubpath()
    let mid = CGPoint(x: (l.x + r.x) / 2, y: (l.y + r.y) / 2)
    ctx.fill(p, with: .linearGradient(Gradient(stops: [
        .init(color: Color(red: 1, green: 200 / 255, blue: 60 / 255).opacity(min(1, 0.95 * q)), location: 0),
        .init(color: Color(red: 1, green: 130 / 255, blue: 20 / 255).opacity(min(1, 0.85 * q)), location: 0.3),
        .init(color: Color(red: 230 / 255, green: 50 / 255, blue: 0).opacity(min(1, 0.55 * q)), location: 0.7),
        .init(color: Color(red: 200 / 255, green: 20 / 255, blue: 0).opacity(0), location: 1),
    ]), startPoint: mid, endPoint: tip))
}

/// Skin-burning sun, the clock's flames frozen: no block, just fire rising from the baseline
/// (normal blending, so it burns on a light widget too), sparks over it.
struct BurnFill: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            // embers along the root
            ctx.fill(Path(CGRect(x: 0, y: h * 0.55, width: w, height: h * 0.45)), with: .linearGradient(
                Gradient(colors: [Color(red: 1, green: 0.35, blue: 0).opacity(0), Color(red: 1, green: 0.3, blue: 0).opacity(0.55)]),
                startPoint: CGPoint(x: 0, y: h * 0.55), endPoint: CGPoint(x: 0, y: h)))
            for layer in 0..<2 {
                var x = layer == 0 ? -1.0 : 0.2
                var i = Double(layer) * 50
                while x < w + 1 {
                    let n = flicker(i * 0.9), n2 = flicker(i * 0.37 + 10, 1.2)
                    let hgt = h * (layer == 0 ? 0.55 + 0.45 * n : 0.3 + 0.35 * n)
                    let half = layer == 0 ? 2.4 + 1.2 * n2 : 1.5 + 0.8 * n2
                    let sway = (n2 - 0.5) * 5
                    flameTongue(&ctx, base: CGPoint(x: x - half, y: h + 1), CGPoint(x: x + half, y: h + 1), tip: CGPoint(x: x + sway, y: h - hgt),
                                c1: CGPoint(x: x - half * 0.9 + sway * 0.3, y: h - hgt * 0.45),
                                c2: CGPoint(x: x + half * 0.9 + sway * 0.3, y: h - hgt * 0.45), q: layer == 0 ? 1 : 1.15)
                    x += layer == 0 ? 3.2 : 4.1
                    i += 1
                }
            }
            var rng = Scatter(Int(w * 7 + h))
            for _ in 0..<max(3, Int(w / 5)) {
                let sx = rng.next() * w, sy = rng.next() * h * 0.5
                ctx.fill(Path(ellipseIn: CGRect(x: sx, y: sy, width: 1.7, height: 1.7)),
                         with: .color(Color(red: 1, green: 0.55, blue: 0.1).opacity(0.6 + 0.4 * Double(rng.next()))))
            }
        }
    }
}

/// The bad-air palette: dark, bright and light particles.
struct AirInk {
    let back, front, rim: Color
    static let smog = AirInk(back: Color(hex: "#3b1785"), front: Color(hex: "#8c5cff"), rim: Color(hex: "#d4bcff"))
    static let dust = AirInk(back: Color(hex: "#6b4520"), front: Color(hex: "#c8955a"), rim: Color(hex: "#f0d3a2"))
    var all: [Color] { [back, front, rim] }
}

/// Lung-wrecking air: a mass of crisp particles, dense at the bottom and thinning out upward,
/// violet for smog, sand for dust. What the air is full of.
struct AirFill: View {
    let dust: Bool
    let seed: Int

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let ink = dust ? AirInk.dust : AirInk.smog
            var rng = Scatter(seed + (dust ? 100 : 0))
            for _ in 0..<Int(w * h / 5) {
                let y = h * (1 - pow(rng.next(), 1.6))
                let d = (1.2 + rng.next() * 3.2) * (0.5 + y / h)
                let c = ink.all[Int(rng.next() * 2.99)]
                ctx.fill(Path(ellipseIn: CGRect(x: rng.next() * w - d / 2, y: y - d / 2, width: d, height: d)), with: .color(c))
            }
        }
    }
}

/// A run of hazard hours: only the harm, fire or gas, no block and no symbol.
struct HazardBlock: View {
    let hazard: Hazard
    let seed: Int

    var body: some View {
        if let a = hazard.air { AirFill(dust: a == .dust, seed: seed) } else { BurnFill() }
    }
}

/// Today's day hours grouped for the strip: a hazard's consecutive hours make one run.
struct StripRun: Identifiable {
    let hours: [FeedHour]
    let hazard: Hazard?
    var past = false
    var id: String { hours[0].time }
    var first: Int { hours[0].hour }
}

/// A run breaks where the hazard changes, and at now (the past sinks, the rest doesn't).
func stripRuns(_ hours: [FeedHour], now: Int) -> [StripRun] {
    var runs: [StripRun] = []
    for h in hours {
        let z = Hazard(h), past = h.hour < now
        if let z, let last = runs.last, last.hazard == z, last.past == past, last.hours.last!.hour + 1 == h.hour {
            runs[runs.count - 1] = StripRun(hours: last.hours + [h], hazard: z, past: past)
        } else {
            runs.append(StripRun(hours: [h], hazard: z, past: past))
        }
    }
    return runs
}

struct Stale: View {
    let s: Snapshot

    var body: some View {
        if s.stale {
            Text(s.updated.map { "as of \($0.formatted(.dateTime.hour().minute()))" } ?? "no data yet")
                .font(.caption2)
                .foregroundStyle(.orange)
        }
    }
}

/// A bare footprint pointing along +x (the clock's footPath): forefoot, heel, five toes.
func footprint(_ sc: CGFloat, left: Bool) -> Path {
    var p = Path()
    let m: CGFloat = left ? 1 : -1
    p.addEllipse(in: CGRect(x: (0.6 - 1.9) * sc, y: -1.25 * sc, width: 3.8 * sc, height: 2.5 * sc))
    p.addEllipse(in: CGRect(x: (-2.3 - 1.25) * sc, y: (0.15 * m - 0.95) * sc, width: 2.5 * sc, height: 1.9 * sc))
    p.addRect(CGRect(x: -2.3 * sc, y: (-0.8 + 0.15 * m) * sc, width: 2.9 * sc, height: 1.6 * sc))
    for (tx, ty, tr) in [(2.95, -0.85, 0.5), (3.2, -0.15, 0.42), (3.15, 0.5, 0.37), (2.95, 1.05, 0.32), (2.6, 1.5, 0.27)] as [(CGFloat, CGFloat, CGFloat)] {
        p.addEllipse(in: CGRect(x: (tx - tr) * sc, y: (ty * m - tr) * sc, width: 2 * tr * sc, height: 2 * tr * sc))
    }
    return p
}

/// Water light (the clock's pool lane, still): deep blue to aqua, and a net of fine bright
/// caustic lines across it.
func drawWater(_ ctx: inout GraphicsContext, lane: Path, in rect: CGRect, ok: Bool, seed: Int) {
    let deep = ok ? Color(hex: "#3d7fb0") : Color(hex: "#0d4f9a"), light = ok ? Color(hex: "#9bdcff") : Color(hex: "#40c4ff")
    ctx.fill(lane, with: .linearGradient(Gradient(colors: [light, deep]), startPoint: CGPoint(x: rect.midX, y: rect.minY), endPoint: CGPoint(x: rect.midX, y: rect.maxY)))
    var c = ctx
    c.clip(to: lane)
    var rng = Scatter(seed)
    for k in 0..<3 {
        var w = Path()
        let amp = rect.height * 0.28, len = 6 + rng.next() * 5, ph = rng.next() * 6
        var x = rect.minX
        w.move(to: CGPoint(x: x, y: rect.midY + amp * sin(ph)))
        while x < rect.maxX {
            x += 1.5
            w.addLine(to: CGPoint(x: x, y: rect.midY + (CGFloat(k) - 1) * rect.height * 0.22 + amp * sin(ph + x / len)))
        }
        c.stroke(w, with: .color(.white.opacity(0.55)), lineWidth: 0.7)
    }
}

/// Today's day hours as a strip, the clock unrolled: footprints on top where you can go out, the
/// hours coloured by heat, or by their hazard, a lane of water under the pool hours, now outlined. Hours already gone
/// sink toward the night, as on the clock (sunk, not faded: a faded red reads as a cooler pink).
struct DayStrip: View {
    let s: Snapshot
    @Environment(\.colorScheme) private var scheme
    private let gap: CGFloat = 2

    var body: some View {
        VStack(spacing: 2) {
            // going out: footprints walking left to right through the window, two steps an hour
            Canvas { ctx, size in
                let n = CGFloat(max(s.today.count, 1)), col = (size.width - gap * (n - 1)) / n
                var k = 0
                for (i, h) in s.today.enumerated() {
                    guard let lv = s.outLevel(h) else { continue }
                    for half in 0..<2 {
                        let left = k % 2 == 0
                        k += 1
                        let x = CGFloat(i) * (col + gap) + col * (half == 0 ? 0.28 : 0.74)
                        let y = size.height / 2 + (left ? -1.6 : 1.6)
                        var c = ctx
                        c.opacity = h.hour < s.nowHour ? Palette.fadePast : 1
                        c.translateBy(x: x, y: y)
                        c.fill(footprint(1.3, left: left), with: .color(lv.color))
                    }
                }
            }
            .frame(height: 10)
            GeometryReader { g in
                let n = CGFloat(max(s.today.count, 1))
                let col = (g.size.width - gap * (n - 1)) / n
                let width = { (k: Int) in col * CGFloat(k) + gap * CGFloat(k - 1) }
                ZStack(alignment: .topLeading) {
                    HStack(spacing: gap) {
                        ForEach(stripRuns(s.today, now: s.nowHour)) { run in
                            if let z = run.hazard {
                                // no block: the fire or the gas is the hour
                                HazardBlock(hazard: z, seed: run.first).frame(width: width(run.hours.count))
                                    .opacity(run.past ? Palette.fadePast : 1)
                            } else {
                                Palette.heat(run.hours[0], sink: run.past ? Palette.sinkPast : 0, dark: scheme == .dark)
                                    .frame(width: width(run.hours.count))
                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                            }
                        }
                    }
                    if let i = s.today.firstIndex(where: { $0.hour == s.nowHour }) {
                        RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(Color.primary, lineWidth: 2)
                            .frame(width: col, height: g.size.height)
                            .offset(x: (col + gap) * CGFloat(i))
                    }
                }
            }
            .frame(minHeight: 26, maxHeight: .infinity) // the bar takes what the card has left
            // pool time: a lane of water light under its hours
            Canvas { ctx, size in
                let n = CGFloat(max(s.today.count, 1)), col = (size.width - gap * (n - 1)) / n
                var i = 0
                while i < s.today.count {
                    guard let lv = s.poolLevel(s.today[i]) else { i += 1; continue }
                    let past = s.today[i].hour < s.nowHour
                    var j = i
                    while j + 1 < s.today.count, s.poolLevel(s.today[j + 1]) == lv, (s.today[j + 1].hour < s.nowHour) == past { j += 1 }
                    let r = CGRect(x: CGFloat(i) * (col + gap), y: 0, width: CGFloat(j - i + 1) * (col + gap) - gap, height: size.height)
                    var c = ctx
                    c.opacity = past ? Palette.fadePast : 1
                    drawWater(&c, lane: Path(roundedRect: r, cornerRadius: size.height / 2), in: r, ok: lv == .ok, seed: i)
                    i = j + 1
                }
            }
            .frame(height: 6)
            HStack(spacing: gap) {
                ForEach(s.today, id: \.time) { h in
                    VStack(spacing: 2) {
                        Text(h.hour % 3 == 0 ? String(format: "%02d", h.hour) : " ")
                            .font(.system(size: 10, weight: .medium).monospacedDigit())
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }
}

/// Today as a ring, like the page's clock: noon at the top, midnight at the bottom (the day reads
/// left to right across the top, as the strip); the going-out and pool arcs outside, hazard hours as fire or particles, a dot on now.
/// Hours outside the day sink like the night, today's past a little less.
struct DayRing: View {
    let s: Snapshot
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { g in
            let d = min(g.size.width, g.size.height)
            // outside in, as on the clock: the pool line, the going-out line, the ring
            let outW = d * 0.03, t = d * 0.12, poolW = d * 0.026, gap = d * 0.02
            let rPool = d / 2 - poolW / 2
            // the footsteps hug the ring, with a clear gap before the pool lane
            let rOut = rPool - poolW / 2 - gap - outW / 2
            let rRing = rOut - outW / 2 - gap * 0.6 - t / 2
            ZStack {
                ForEach(s.wholeDay, id: \.time) { h in
                    let past = h.hour < s.nowHour
                    let sink = !s.inDay(h) ? Palette.sinkNight : past ? Palette.sinkPast : 0
                    let fade = !s.inDay(h) ? Palette.fadeNight : past ? Palette.fadePast : 1
                    ringHour(h, rRing, t, sink: sink, fade: fade).frame(width: d, height: d)
                    if let o = s.outLevel(h) {
                        // going out: two footprints walking round the hour, forward in time
                        Canvas { ctx, size in
                            for half in 0..<2 {
                                let left = (h.hour * 2 + half) % 2 == 0
                                let a = ((Double(h.hour) + (half == 0 ? 0.3 : 0.75)) / 24 * 360 + 90) * .pi / 180
                                let r = rOut + (left ? -1.2 : 1.2)
                                var c = ctx
                                c.translateBy(x: size.width / 2 + r * cos(a), y: size.height / 2 + r * sin(a))
                                c.rotate(by: .radians(a + .pi / 2))
                                c.fill(footprint(d * 0.0062, left: left), with: .color(o.color))
                            }
                        }
                        .frame(width: d, height: d).opacity(fade)
                    }
                    if let p = s.poolLevel(h) {
                        // pool time: water, a blue lane with fine light ripples on it
                        let col = p == .good ? Palette.pool.good : Palette.pool.ok
                        ZStack {
                            arc(h.hour, rPool, poolW, gap: 0).stroke(col.opacity(0.85), lineWidth: poolW * 1.3)
                            arc(h.hour, rPool, poolW, gap: 0).stroke(Color.white.opacity(0.6), style: StrokeStyle(lineWidth: 0.6, dash: [2.2, 1.6, 0.8, 2]))
                        }
                        .frame(width: 2 * rPool, height: 2 * rPool).opacity(fade)
                    }
                }
                if s.wholeDay.contains(where: { $0.hour == s.nowHour }) {
                    Circle()
                        .fill(Color.white)
                        .overlay(Circle().stroke(Color.black.opacity(0.6), lineWidth: 1.5))
                        .frame(width: t * 0.6, height: t * 0.6)
                        .offset(at(s.nowHour, rRing))
                }
                VStack(spacing: 1) {
                    Text(s.status)
                        .font(.system(size: d * 0.16, weight: .bold, design: .rounded))
                        .foregroundStyle(s.statusLevel == .na ? Color.primary : s.statusLevel.color)
                        .minimumScaleFactor(0.4)
                        .lineLimit(1)
                    if !s.ringLine.isEmpty {
                        Text(s.ringLine).font(.system(size: d * 0.085, weight: .medium)).foregroundStyle(.secondary)
                            .lineLimit(1).minimumScaleFactor(0.6)
                    }
                }
                .frame(width: (2 * rRing - t) * 0.86)
            }
            .frame(width: d, height: d)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// One hour of the ring, as the clock draws it: its heat colour, or, where the sun burns skin
    /// or the air hurts lungs, no ring at all: fire burning through the band and out, or gas
    /// filling it.
    @ViewBuilder
    private func ringHour(_ h: FeedHour, _ r: CGFloat, _ t: CGFloat, sink: Double, fade: Double) -> some View {
        // outside the day hours the hazard still shows, faded into the darkened part (`fade`)
        if let z = Hazard(h) {
            ZStack {
                Canvas { ctx, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    let pt = { (rad: CGFloat, a: Double) in CGPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a)) }
                    let a0 = Double(h.hour) / 24 * 2 * .pi + .pi / 2
                    let span = 2 * Double.pi / 24
                    if let air = z.air {
                        // the same particle mass across the band
                        let ink = air == .dust ? AirInk.dust : AirInk.smog
                        var rng = Scatter(h.hour + (air == .dust ? 100 : 0))
                        for _ in 0..<70 {
                            let a = a0 + span * Double(rng.next())
                            let off = (rng.next() + rng.next() - 1) * t * 0.7
                            let d = (1.0 + rng.next() * 2.6) * (1.15 - abs(off) / t)
                            let q = pt(r + off, a)
                            ctx.fill(Path(ellipseIn: CGRect(x: q.x - d / 2, y: q.y - d / 2, width: d, height: d)),
                                     with: .color(ink.all[Int(rng.next() * 2.99)]))
                        }
                    }
                    if z.sun {
                        for k in 0..<7 {
                            let a = a0 + span * (Double(k) + 0.5) / 7
                            let n = flicker(Double(h.hour * 7 + k) * 0.6)
                            let hgt = t * (1.1 + 1.1 * n), half = span / 11
                            let b0 = r - t / 2
                            flameTongue(&ctx, base: pt(b0, a - half), pt(b0, a + half), tip: pt(b0 + hgt, a + (n - 0.5) * 0.05),
                                        c1: pt(b0 + hgt * 0.45, a - half * 0.9), c2: pt(b0 + hgt * 0.45, a + half * 0.9), q: 1)
                        }
                    }
                }
            }
            .opacity(fade)
        } else {
            arc(h.hour, r, t, gap: 0.004).stroke(Palette.heat(h, sink: sink, dark: scheme == .dark), lineWidth: t)
                .frame(width: 2 * r, height: 2 * r)
        }
    }

    private func arc(_ hour: Int, _ r: CGFloat, _ w: CGFloat, gap: Double) -> some Shape {
        Circle().trim(from: Double(hour) / 24 + gap, to: Double(hour + 1) / 24 - gap).rotation(.degrees(90))
    }

    private func at(_ hour: Int, _ r: CGFloat) -> CGSize {
        let a = ((Double(hour) + 0.5) / 24 * 360 + 90) * .pi / 180
        return CGSize(width: r * cos(a), height: r * sin(a))
    }
}

struct SmallFace: View {
    let s: Snapshot

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            DayRing(s: s)
            Stale(s: s)
        }
    }
}

struct MediumFace: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                Circle().fill(s.statusLevel.color).frame(width: 12, height: 12)
                VStack(alignment: .leading, spacing: 0) {
                    Text(s.status).font(.system(size: 26, weight: .bold, design: .rounded)).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(s.subline).font(.footnote.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
                        Stale(s: s)
                    }
                }
                Spacer(minLength: 4)
                if let f = s.now?.feels, s.phase == .inDay {
                    VStack(alignment: .trailing, spacing: -2) {
                        Text("\(Int(f.rounded()))°").font(.system(size: 30, weight: .semibold, design: .rounded))
                        Text("feels").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            DayStrip(s: s).frame(maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Lock screen, rectangular: the verdict, and the one line under it.
struct RectangularFace: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: s.statusLevel.symbol).font(.caption.weight(.bold))
                Text(s.status).font(.headline).lineLimit(1)
            }
            Text(s.subline).font(.caption).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Lock screen, round: the verdict as a symbol, the hour it changes under it.
struct CircularFace: View {
    let s: Snapshot

    var body: some View {
        ZStack {
            Circle().strokeBorder(lineWidth: 3)
            VStack(spacing: 0) {
                Image(systemName: s.statusLevel.symbol).font(.system(size: 16, weight: .bold))
                if let w = s.window { Text(String(format: "%02d", s.inWindow ? w.to % 24 : w.from)).font(.system(size: 11, weight: .semibold)) }
            }
        }
    }
}

/// Lock screen, the line above the clock.
struct InlineFace: View {
    let s: Snapshot

    var body: some View {
        if s.inWindow, let w = s.window { Text("\(s.status) outside until \(until(w.to))") }
        else if let w = s.window {
            Text("\(s.status). \(w.level == .good ? "Good" : "OK") \(s.windowDay.isEmpty ? "from" : s.windowDay.lowercased()) \(hh(w.from))")
        } else { Text("Outside: \(s.status)") }
    }
}
