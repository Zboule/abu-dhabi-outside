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

/// The bad-air palette, graphic: a dark back cloud, a bright front cloud, a light rim, fumes.
struct AirInk {
    let back, front, rim, fume: Color
    static let smog = AirInk(back: Color(hex: "#3b1785"), front: Color(hex: "#8c5cff"), rim: Color(hex: "#d4bcff"), fume: Color(hex: "#e6d9ff"))
    static let dust = AirInk(back: Color(hex: "#6b4520"), front: Color(hex: "#c8955a"), rim: Color(hex: "#f0d3a2"), fume: Color(hex: "#fbe8c6"))
}

/// A cartoon cloud: a flat base along the bottom of `rect`, round bumps across its top.
func cloudPath(in rect: CGRect, rng: inout Scatter) -> Path {
    var p = Path()
    let h = rect.height
    p.addRoundedRect(in: CGRect(x: rect.minX, y: rect.maxY - h * 0.42, width: rect.width, height: h * 0.42),
                     cornerSize: CGSize(width: h * 0.2, height: h * 0.2))
    let n = max(2, Int((rect.width / (h * 0.55)).rounded()))
    for i in 0..<n {
        let r = h * (0.3 + 0.16 * rng.next())
        let x = rect.minX + rect.width * (CGFloat(i) + 0.5) / CGFloat(n)
        p.addEllipse(in: CGRect(x: x - r, y: rect.maxY - h * 0.38 - r, width: 2 * r, height: 2 * r))
    }
    return p
}

/// Lung-wrecking air, drawn graphic: a dark cloud behind, a bright one in front with a light rim,
/// fume streaks across it (smog) or wind and grit (dust), fine particles rising over it.
struct AirFill: View {
    let dust: Bool
    let seed: Int

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            let ink = dust ? AirInk.dust : AirInk.smog
            var rng = Scatter(seed + (dust ? 100 : 0))
            let back = cloudPath(in: CGRect(x: -1, y: h * 0.12, width: w + 2, height: h * 0.88), rng: &rng)
            ctx.fill(back, with: .color(ink.back))
            let front = cloudPath(in: CGRect(x: w * 0.04, y: h * 0.38, width: w * 0.92, height: h * 0.62), rng: &rng)
            ctx.fill(front.offsetBy(dx: 0, dy: -1.5), with: .color(ink.rim))
            ctx.fill(front, with: .color(ink.front))
            // fumes (smog) or wind (dust): wavy streaks across the front cloud
            for k in 0..<2 {
                var line = Path()
                let y = h * (0.62 + 0.17 * CGFloat(k))
                line.move(to: CGPoint(x: w * 0.1, y: y))
                var x = w * 0.1
                var up = k == 0
                while x < w * 0.9 {
                    let step = min(5, w * 0.8 - (x - w * 0.1))
                    guard step > 0.5 else { break }
                    line.addQuadCurve(to: CGPoint(x: x + step, y: y), control: CGPoint(x: x + step / 2, y: y + (up ? -1.8 : 1.8)))
                    x += step
                    up.toggle()
                }
                ctx.stroke(line, with: .color(ink.fume.opacity(dust ? 0.65 : 0.85)), style: StrokeStyle(lineWidth: 1.1, lineCap: .round))
            }
            // particles rising over the cloud, grit inside it for dust
            for _ in 0..<max(4, Int(w / 3)) {
                let d = 1.0 + rng.next() * 1.4
                let y = dust ? h * (0.15 + 0.8 * rng.next()) : h * (0.02 + 0.3 * rng.next())
                ctx.fill(Path(ellipseIn: CGRect(x: rng.next() * w, y: y, width: d, height: d)),
                         with: .color(dust && rng.next() > 0.5 ? ink.back : ink.front))
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
    var id: String { hours[0].time }
    var first: Int { hours[0].hour }
}

func stripRuns(_ hours: [FeedHour]) -> [StripRun] {
    var runs: [StripRun] = []
    for h in hours {
        let z = Hazard(h)
        if let z, let last = runs.last, last.hazard == z, last.hours.last!.hour + 1 == h.hour {
            runs[runs.count - 1] = StripRun(hours: last.hours + [h], hazard: z)
        } else {
            runs.append(StripRun(hours: [h], hazard: z))
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

/// Today's day hours as a strip, the clock unrolled: the going-out line on top, the hours
/// coloured by heat, or by their hazard, the pool line under, now outlined. Past hours
/// keep their colour, as on the clock (faded, a red hour reads as a cooler pink one).
struct DayStrip: View {
    let s: Snapshot
    private let gap: CGFloat = 2

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: gap) {
                ForEach(s.today, id: \.time) { h in
                    Capsule().fill(s.outLevel(h)?.color ?? .clear).frame(height: 4)
                }
            }
            GeometryReader { g in
                let n = CGFloat(max(s.today.count, 1))
                let col = (g.size.width - gap * (n - 1)) / n
                let width = { (k: Int) in col * CGFloat(k) + gap * CGFloat(k - 1) }
                ZStack(alignment: .topLeading) {
                    HStack(spacing: gap) {
                        ForEach(stripRuns(s.today)) { run in
                            if let z = run.hazard {
                                // no block: the fire or the gas is the hour
                                HazardBlock(hazard: z, seed: run.first).frame(width: width(run.hours.count))
                            } else {
                                Palette.heat(run.hours[0]).frame(width: width(run.hours.count))
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
            HStack(spacing: gap) {
                ForEach(s.today, id: \.time) { h in
                    VStack(spacing: 2) {
                        Capsule()
                            .fill(s.poolLevel(h) == .good ? Palette.pool.good : s.poolLevel(h) == .ok ? Palette.pool.ok : .clear)
                            .frame(height: 3)
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

/// Today as a ring, like the page's clock: midnight at the top, noon at the bottom; the
/// going-out arc outside, the pool arc inside, hazard hours striped or tinted, a dot on now.
struct DayRing: View {
    let s: Snapshot

    var body: some View {
        GeometryReader { g in
            let d = min(g.size.width, g.size.height)
            let outW = d * 0.035, t = d * 0.13, poolW = d * 0.03, gap = d * 0.025
            let rOut = d / 2 - outW / 2
            let rRing = d / 2 - outW - gap - t / 2
            let rPool = rRing - t / 2 - gap - poolW / 2
            ZStack {
                ForEach(s.wholeDay, id: \.time) { h in
                    let fade = s.inDay(h) ? 1.0 : 0.15
                    ringHour(h, rRing, t).frame(width: d, height: d).opacity(fade)
                    if let o = s.outLevel(h) {
                        arc(h.hour, rOut, outW, gap: 0).stroke(o.color, style: StrokeStyle(lineWidth: outW, lineCap: .round))
                            .frame(width: 2 * rOut, height: 2 * rOut).opacity(fade)
                    }
                    if let p = s.poolLevel(h) {
                        arc(h.hour, rPool, poolW, gap: 0).stroke(p == .good ? Palette.pool.good : Palette.pool.ok, lineWidth: poolW)
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
                .frame(width: 2 * rPool * 0.9)
            }
            .frame(width: d, height: d)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    /// One hour of the ring, as the clock draws it: its heat colour, or, where the sun burns skin
    /// or the air hurts lungs, no ring at all: fire burning through the band and out, or gas
    /// filling it.
    @ViewBuilder
    private func ringHour(_ h: FeedHour, _ r: CGFloat, _ t: CGFloat) -> some View {
        if let z = Hazard(h) {
            ZStack {
                Canvas { ctx, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    let pt = { (rad: CGFloat, a: Double) in CGPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a)) }
                    let a0 = Double(h.hour) / 24 * 2 * .pi - .pi / 2
                    let span = 2 * Double.pi / 24
                    if let air = z.air {
                        // graphic cloud bubbles strung along the hour: dark ones behind, bright in front, a rim
                        let ink = air == .dust ? AirInk.dust : AirInk.smog
                        let bubbles = { (radius: CGFloat, rad: CGFloat, n: Int, shift: Double) -> Path in
                            var p = Path()
                            for k in 0..<n {
                                let a = a0 + span * (Double(k) + shift) / Double(n)
                                let q = pt(rad, a)
                                p.addEllipse(in: CGRect(x: q.x - radius, y: q.y - radius, width: 2 * radius, height: 2 * radius))
                            }
                            return p
                        }
                        ctx.fill(bubbles(t * 0.5, r + t * 0.12, 3, 0.5), with: .color(ink.back))
                        let front = bubbles(t * 0.36, r - t * 0.12, 3, 0.25)
                        ctx.fill(front.offsetBy(dx: 0, dy: -1.2), with: .color(ink.rim))
                        ctx.fill(front, with: .color(ink.front))
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
        } else {
            arc(h.hour, r, t, gap: 0.004).stroke(Palette.heat(h), lineWidth: t).frame(width: 2 * r, height: 2 * r)
        }
    }

    private func arc(_ hour: Int, _ r: CGFloat, _ w: CGFloat, gap: Double) -> some Shape {
        Circle().trim(from: Double(hour) / 24 + gap, to: Double(hour + 1) / 24 - gap).rotation(.degrees(-90))
    }

    private func at(_ hour: Int, _ r: CGFloat) -> CGSize {
        let a = ((Double(hour) + 0.5) / 24 * 360 - 90) * .pi / 180
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
