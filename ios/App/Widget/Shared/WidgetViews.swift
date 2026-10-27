import SwiftUI

// The widget faces, shared with the snapshot tests (WidgetSnapshots). They speak the page's clock:
// colour is how hot it feels, a sun marks strong UV (the clock's flames: on a widget a flame reads
// as "hot", which the colour already says), a violet cloud smoggy air and a sandy one
// dust, a line outside marks the good time to go out (green good, yellow OK), a blue line inside
// pool time. Colours: contract/tokens.json and src/outdoor/clock.ts.

extension Color {
    init(hex: String) {
        let v = UInt64(hex.dropFirst(), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

enum Palette {
    static let pool = (good: Color(hex: "#40c4ff"), ok: Color(hex: "#9bdcff"))
    static let smog = Color(hex: "#b98cff")
    static let dust = Color(hex: "#e2b872")
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

/// Sun and cloud marks for one hour, as the clock's flames and gas.
struct HourMarks: View {
    let h: FeedHour
    let size: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            if h.strongSun == true {
                Image(systemName: "sun.max.fill").foregroundStyle(Palette.sun)
            }
            if let c = Palette.air(h.badAir) {
                Image(systemName: "cloud.fill").foregroundStyle(c)
            }
        }
        .font(.system(size: size, weight: .bold))
        .shadow(color: .black.opacity(0.5), radius: 1.2)
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
/// coloured by heat with their suns and clouds, the pool line under, now outlined. Past hours
/// keep their colour, as on the clock (faded, a red hour reads as a cooler pink one).
struct DayStrip: View {
    let s: Snapshot

    var body: some View {
        HStack(alignment: .top, spacing: 2) {
            ForEach(s.today, id: \.time) { h in
                VStack(spacing: 2) {
                    Capsule().fill(s.outLevel(h)?.color ?? .clear).frame(height: 4)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Palette.heat(h))
                        .overlay(HourMarks(h: h, size: 12))
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
/// going-out arc outside, the pool arc inside, suns and clouds on the hours, a dot on now.
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
                    arc(h.hour, rRing, t, gap: 0.004).stroke(Palette.heat(h), lineWidth: t)
                        .frame(width: 2 * rRing, height: 2 * rRing).opacity(fade)
                    if let o = s.outLevel(h) {
                        arc(h.hour, rOut, outW, gap: 0).stroke(o.color, style: StrokeStyle(lineWidth: outW, lineCap: .round))
                            .frame(width: 2 * rOut, height: 2 * rOut).opacity(fade)
                    }
                    if let p = s.poolLevel(h) {
                        arc(h.hour, rPool, poolW, gap: 0).stroke(p == .good ? Palette.pool.good : Palette.pool.ok, lineWidth: poolW)
                            .frame(width: 2 * rPool, height: 2 * rPool).opacity(fade)
                    }
                    if s.inDay(h), h.strongSun == true || h.badAir != nil {
                        HourMarks(h: h, size: t * 0.42).offset(at(h.hour, rRing)).opacity(fade)
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
