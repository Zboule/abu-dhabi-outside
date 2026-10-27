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

/// Why an hour is to avoid whatever the heat: strong UV, bad air, or both. Those hours drop the
/// heat colour (it no longer matters) for a drawing of the harm itself.
enum Hazard: Equatable {
    case uv, smog, dust, uvSmog, uvDust

    init?(_ h: FeedHour) {
        switch (h.strongSun == true, h.badAir) {
        case (true, "smog"): self = .uvSmog
        case (true, "dust"): self = .uvDust
        case (true, _): self = .uv
        case (false, "smog"): self = .smog
        case (false, "dust"): self = .dust
        default: return nil
        }
    }

    var sun: Bool { [.uv, .uvSmog, .uvDust].contains(self) }
    var air: Hazard? { self == .uvSmog || self == .smog ? .smog : self == .uvDust || self == .dust ? .dust : nil }
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
        .init(color: Color(red: 1, green: 236 / 255, blue: 170 / 255).opacity(0.85 * q), location: 0),
        .init(color: Color(red: 1, green: 170 / 255, blue: 50 / 255).opacity(0.7 * q), location: 0.3),
        .init(color: Color(red: 1, green: 80 / 255, blue: 10 / 255).opacity(0.4 * q), location: 0.7),
        .init(color: Color(red: 200 / 255, green: 20 / 255, blue: 0).opacity(0), location: 1),
    ]), startPoint: mid, endPoint: tip))
}

/// Skin-burning sun, the clock's flames frozen: tongues rising from a glowing ember base, sparks over them.
struct BurnFill: View {
    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(
                Gradient(colors: [Color(hex: "#1c0400"), Color(hex: "#5c1000"), Color(hex: "#a32200")]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
            ctx.blendMode = .plusLighter
            // heat glow at the root
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .radialGradient(
                Gradient(colors: [Color(red: 1, green: 0.47, blue: 0.08).opacity(0.55), .clear]),
                center: CGPoint(x: w / 2, y: h * 1.05), startRadius: 0, endRadius: max(w, h) * 0.9))
            var x = -2.0
            var i = 0.0
            while x < w + 2 {
                let n = flicker(i * 0.9), n2 = flicker(i * 0.37 + 10, 1.2)
                let hgt = h * (0.45 + 0.5 * n)
                let half = 2.6 + 1.2 * n2
                let sway = (n2 - 0.5) * 6
                let tip = CGPoint(x: x + sway, y: h - hgt)
                flameTongue(&ctx, base: CGPoint(x: x - half, y: h + 1), CGPoint(x: x + half, y: h + 1), tip: tip,
                            c1: CGPoint(x: x - half * 0.9 + sway * 0.3, y: h - hgt * 0.45),
                            c2: CGPoint(x: x + half * 0.9 + sway * 0.3, y: h - hgt * 0.45), q: 1)
                x += 2.4
                i += 1
            }
            // sparks rising out of the flames
            var rng = Scatter(Int(w * 7 + h))
            for _ in 0..<max(3, Int(w / 6)) {
                let sx = rng.next() * w, sy = rng.next() * h * 0.45
                ctx.fill(Path(ellipseIn: CGRect(x: sx, y: sy, width: 1.6, height: 1.6)),
                         with: .color(Color(red: 1, green: 210 / 255, blue: 120 / 255).opacity(0.5 + 0.5 * Double(rng.next()))))
            }
        }
    }
}

/// The clock's gas colours: violet smog (never green, green is comfort), sandy dust.
func gasColor(dust: Bool, light: Bool) -> Color {
    dust ? (light ? Color(red: 230 / 255, green: 190 / 255, blue: 125 / 255) : Color(red: 190 / 255, green: 140 / 255, blue: 80 / 255))
        : (light ? Color(red: 200 / 255, green: 140 / 255, blue: 1) : Color(red: 150 / 255, green: 90 / 255, blue: 1))
}

/// One soft puff of gas, a radial gradient fading out, as the clock's particles.
func gasPuff(_ ctx: inout GraphicsContext, at c: CGPoint, radius r: CGFloat, color: Color, alpha: Double) {
    ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)), with: .radialGradient(
        Gradient(stops: [.init(color: color.opacity(alpha), location: 0), .init(color: color.opacity(alpha * 0.45), location: 0.5),
                         .init(color: color.opacity(0), location: 1)]),
        center: c, startRadius: 0, endRadius: r))
}

/// Lung-wrecking air, the clock's gas frozen: violet smog or sandy haze billowing over a dark base.
struct AirFill: View {
    let dust: Bool
    let seed: Int

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(
                Gradient(colors: dust ? [Color(hex: "#2e1d0c"), Color(hex: "#160d04")] : [Color(hex: "#24104a"), Color(hex: "#0e0520")]),
                startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
            ctx.blendMode = .plusLighter
            var rng = Scatter(seed + (dust ? 100 : 0))
            // big slow haze, then smaller brighter wisps over it
            for layer in 0..<2 {
                let count = layer == 0 ? max(4, Int(w * h / 90)) : max(6, Int(w * h / 45))
                for _ in 0..<count {
                    let r = (layer == 0 ? 0.5 + rng.next() * 0.4 : 0.22 + rng.next() * 0.3) * min(w, h * 0.8) + 3
                    gasPuff(&ctx, at: CGPoint(x: rng.next() * w, y: rng.next() * h), radius: r,
                            color: gasColor(dust: dust, light: rng.next() > 0.5), alpha: layer == 0 ? 0.35 : 0.55)
                }
            }
        }
    }
}

struct HazardMark: View {
    let symbol: String
    let size: CGFloat

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .bold))
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.7), radius: 1.5)
    }

    static let burn = "sun.max.trianglebadge.exclamationmark.fill"
    static let lungs = "lungs.fill"
}

/// A run of hazard hours as one block: the harm drawn across it, its symbol once in the middle.
struct HazardBlock: View {
    let hazard: Hazard
    let seed: Int

    var body: some View {
        GeometryReader { g in
            let mark = min(g.size.width * 0.6, g.size.height * 0.34, 17)
            switch (hazard.sun, hazard.air) {
            case (true, nil):
                BurnFill().overlay(HazardMark(symbol: HazardMark.burn, size: mark))
            case (false, let a?):
                AirFill(dust: a == .dust, seed: seed).overlay(HazardMark(symbol: HazardMark.lungs, size: mark))
            case (true, let a?):
                VStack(spacing: 0) {
                    BurnFill().overlay(HazardMark(symbol: HazardMark.burn, size: mark * 0.8))
                    AirFill(dust: a == .dust, seed: seed).overlay(HazardMark(symbol: HazardMark.lungs, size: mark * 0.8))
                }
            default:
                Color.clear
            }
        }
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
                            Group {
                                if let z = run.hazard { HazardBlock(hazard: z, seed: run.first) } else { Palette.heat(run.hours[0]) }
                            }
                            .frame(width: width(run.hours.count))
                            .clipShape(RoundedRectangle(cornerRadius: 3))
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

    /// One hour of the ring, as the clock draws it: its heat colour, flames licking out of the
    /// ring where the sun burns, violet gas or sandy haze spilling over it where the air is bad.
    @ViewBuilder
    private func ringHour(_ h: FeedHour, _ r: CGFloat, _ t: CGFloat) -> some View {
        let seg = arc(h.hour, r, t, gap: 0.004)
        let z = Hazard(h)
        ZStack {
            seg.stroke(z?.air == .smog ? Color(hex: "#3a1a78") : z?.air == .dust ? Color(hex: "#5a3c1c") : Palette.heat(h), lineWidth: t)
                .frame(width: 2 * r, height: 2 * r)
            if let z {
                Canvas { ctx, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    let pt = { (rad: CGFloat, a: Double) in CGPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a)) }
                    let a0 = Double(h.hour) / 24 * 2 * .pi - .pi / 2
                    let span = 2 * Double.pi / 24
                    ctx.blendMode = .plusLighter
                    if z.sun {
                        for k in 0..<5 {
                            let a = a0 + span * (Double(k) + 0.5) / 5
                            let n = flicker(Double(h.hour * 5 + k) * 0.6)
                            let hgt = t * (0.35 + 0.55 * n), half = span / 12
                            let b0 = r + t / 2 - 2
                            flameTongue(&ctx, base: pt(b0, a - half), pt(b0, a + half), tip: pt(r + t / 2 + hgt, a + (n - 0.5) * 0.04),
                                        c1: pt(r + t / 2 + hgt * 0.45, a - half * 0.9), c2: pt(r + t / 2 + hgt * 0.45, a + half * 0.9), q: 1)
                        }
                    }
                    if let air = z.air {
                        var rng = Scatter(h.hour)
                        for _ in 0..<7 {
                            let a = a0 + span * Double(rng.next())
                            let rad = r - t * 0.2 - rng.next() * t * 0.9
                            gasPuff(&ctx, at: pt(rad, a), radius: t * (0.35 + rng.next() * 0.35),
                                    color: gasColor(dust: air == .dust, light: rng.next() > 0.5), alpha: 0.6)
                        }
                    }
                }
                HazardMark(symbol: z.air == nil ? HazardMark.burn : HazardMark.lungs, size: t * 0.45)
                    .offset(at(h.hour, r))
            }
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
