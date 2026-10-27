import SwiftUI

// The widget faces, shared with the snapshot tests (WidgetSnapshots). They speak the page's clock:
// colour is how hot it feels, except on hours to avoid whatever the heat: strong UV turns to
// yellow and black caution stripes with a sun (the clock's flames), smoggy air to violet and dust
// to sand-brown with a cloud (the clock's gas and haze); a line outside marks the good time to go out (green good, yellow OK), a blue line inside
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
    static let uv = (stripe: Color(hex: "#ffd60a"), gap: Color(hex: "#1c1c1e"))
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
/// heat colour (it no longer matters) for a fill nothing else uses.
enum Hazard {
    case uv, air(Color), both(Color)

    init?(_ h: FeedHour) {
        let air = Palette.air(h.badAir)
        switch (h.strongSun == true, air) {
        case (true, let a?): self = .both(a)
        case (true, nil): self = .uv
        case (false, let a?): self = .air(a)
        default: return nil
        }
    }
}

/// Caution stripes for strong UV: diagonal yellow bands on near-black.
struct UVStripes: View {
    var body: some View {
        Canvas { ctx, size in
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Palette.uv.gap))
            let w: CGFloat = 4
            var x = -size.height
            while x < size.width {
                var p = Path()
                p.move(to: CGPoint(x: x, y: size.height))
                p.addLine(to: CGPoint(x: x + w, y: size.height))
                p.addLine(to: CGPoint(x: x + w + size.height, y: 0))
                p.addLine(to: CGPoint(x: x + size.height, y: 0))
                p.closeSubpath()
                ctx.fill(p, with: .color(Palette.uv.stripe))
                x += w * 2
            }
        }
    }
}

/// One hour of the strip: its heat colour, or its hazard fill with the hazard's mark.
struct HourFill: View {
    let h: FeedHour

    var body: some View {
        switch Hazard(h) {
        case .uv?:
            UVStripes().overlay(mark("sun.max.fill"))
        case .air(let c)?:
            c.overlay(mark("cloud.fill"))
        case .both(let c)?:
            VStack(spacing: 0) {
                UVStripes().overlay(mark("sun.max.fill"))
                c.overlay(mark("cloud.fill"))
            }
        case nil:
            Palette.heat(h)
        }
    }

    private func mark(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.6), radius: 1.5)
    }
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

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            ForEach(s.today, id: \.time) { h in
                VStack(spacing: 2) {
                    Capsule().fill(s.outLevel(h)?.color ?? .clear).frame(height: 4)
                    HourFill(h: h)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                        .overlay {
                            if h.hour == s.nowHour {
                                RoundedRectangle(cornerRadius: 3).strokeBorder(Color.primary, lineWidth: 2)
                            }
                        }
                        .frame(minHeight: 26, maxHeight: .infinity) // the bar takes what the card has left
                    Capsule()
                        .fill(s.poolLevel(h) == .good ? Palette.pool.good : s.poolLevel(h) == .ok ? Palette.pool.ok : .clear)
                        .frame(height: 3)
                    Text(h.hour % 3 == 0 ? String(format: "%02d", h.hour) : " ")
                        .font(.system(size: 10, weight: .medium).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .fixedSize()
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
                    ringHour(h, rRing, t).opacity(fade)
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

    /// One hour of the ring: its heat colour, or, for a hazard, caution bands (strong UV: yellow
    /// and black across the ring) and the air colour (both: UV on the outer half, air inside).
    @ViewBuilder
    private func ringHour(_ h: FeedHour, _ r: CGFloat, _ t: CGFloat) -> some View {
        let seg = arc(h.hour, r, t, gap: 0.004)
        let uv = ZStack {
            seg.stroke(Palette.uv.stripe, lineWidth: t)
            seg.stroke(Palette.uv.gap, style: StrokeStyle(lineWidth: t, dash: [2.5, 2.5]))
        }
        Group {
            switch Hazard(h) {
            case .uv?: uv.frame(width: 2 * r, height: 2 * r)
            case .air(let c)?: seg.stroke(c, lineWidth: t).frame(width: 2 * r, height: 2 * r)
            case .both(let c)?:
                ZStack {
                    ZStack {
                        seg.stroke(Palette.uv.stripe, lineWidth: t / 2)
                        seg.stroke(Palette.uv.gap, style: StrokeStyle(lineWidth: t / 2, dash: [2.5, 2.5]))
                    }
                    .frame(width: 2 * (r + t / 4), height: 2 * (r + t / 4))
                    seg.stroke(c, lineWidth: t / 2).frame(width: 2 * (r - t / 4), height: 2 * (r - t / 4))
                }
            case nil: seg.stroke(Palette.heat(h), lineWidth: t).frame(width: 2 * r, height: 2 * r)
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
