import SwiftUI

// The widget faces, shared with the snapshot tests (WidgetSnapshots). Colours: contract/tokens.json.

extension Level {
    var color: Color {
        switch self {
        case .good: return Color(red: 0x30 / 255, green: 0xd1 / 255, blue: 0x58 / 255)
        case .ok: return Color(red: 1, green: 0xb3 / 255, blue: 0x40 / 255)
        case .bad: return Color(red: 1, green: 0x45 / 255, blue: 0x3a / 255)
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

/// The status block both home-screen sizes start with.
struct StatusBlock: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Outside")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            HStack(spacing: 6) {
                Circle().fill(s.statusLevel.color).frame(width: 12, height: 12)
                Text(s.status)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            if !s.detail.isEmpty {
                Text(s.detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
        }
    }
}

struct WindowLine: View {
    let s: Snapshot

    var body: some View {
        if let line = s.windowLine, let w = s.window {
            HStack(spacing: 5) {
                Circle().fill(w.level.color).frame(width: 7, height: 7)
                Text(line).font(.caption.weight(.medium)).lineLimit(1).minimumScaleFactor(0.8)
            }
        } else if s.noWindow {
            Text("No good time in the next days").font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
    }
}

struct Footer: View {
    let s: Snapshot

    var body: some View {
        HStack(spacing: 4) {
            if let f = s.feels { Text(f) }
            Spacer(minLength: 0)
            if s.stale, let u = s.updated {
                Text("as of \(u.formatted(.dateTime.hour().minute()))").foregroundStyle(.orange)
            } else if s.stale {
                Text("no data yet").foregroundStyle(.orange)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
}

/// Today's hours as a strip of colours, like the page's clock unrolled; past hours fade.
struct DayBar: View {
    let s: Snapshot

    var body: some View {
        VStack(spacing: 3) {
            GeometryReader { g in
                let n = max(s.today.count, 1)
                let w = g.size.width / CGFloat(n)
                ZStack(alignment: .topLeading) {
                    HStack(spacing: 1) {
                        ForEach(s.today, id: \.time) { h in
                            VStack(spacing: 1) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(h.verdict.color)
                                if s.settings.pool {
                                    RoundedRectangle(cornerRadius: 1)
                                        .fill(h.pool == .good ? Color(red: 0x40 / 255, green: 0xc4 / 255, blue: 1) :
                                              h.pool == .ok ? Color(red: 0x9b / 255, green: 0xdc / 255, blue: 1) : .clear)
                                        .frame(height: 3)
                                }
                            }
                            .opacity(h.hour < s.nowHour ? 0.35 : 1)
                        }
                    }
                    if let i = s.today.firstIndex(where: { $0.hour == s.nowHour }) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color.primary)
                            .frame(width: 2, height: g.size.height + 4)
                            .offset(x: w * CGFloat(i) + w / 2 - 1, y: -2)
                    }
                }
            }
            .frame(height: 22)
            HStack {
                ForEach(ticks, id: \.self) { h in
                    Text(String(format: "%02d", h)).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .font(.system(size: 9).monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }

    private var ticks: [Int] {
        guard let first = s.today.first?.hour, let last = s.today.last?.hour else { return [] }
        let step = max(1, (last - first + 1) / 4)
        return Array(stride(from: first, through: last, by: step)).prefix(5).map { $0 }
    }
}

struct SmallFace: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            StatusBlock(s: s)
            Spacer(minLength: 0)
            WindowLine(s: s)
            Footer(s: s)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumFace: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                StatusBlock(s: s)
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    if let n = s.now {
                        if let t = n.temp { Text("\(Int(t.rounded()))°").font(.title3.weight(.semibold)) }
                        Text(facts(n)).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    }
                }
            }
            DayBar(s: s)
            HStack {
                WindowLine(s: s)
                Spacer(minLength: 4)
                if s.stale { Footer(s: s).fixedSize() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func facts(_ n: FeedHour) -> String {
        var f: [String] = []
        if let v = n.feels { f.append("feels \(Int(v.rounded()))°") }
        if !n.night, let uv = n.uvIndex { f.append("UV \(Int(uv.rounded()))") }
        if let a = n.airIndex { f.append("air \(Int(a.rounded()))") }
        return f.joined(separator: " · ")
    }
}

/// Lock screen, rectangular: two lines.
struct RectangularFace: View {
    let s: Snapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Image(systemName: s.statusLevel.symbol).font(.caption.weight(.bold))
                Text(s.detail.isEmpty ? s.status : "\(s.status), \(s.detail)").font(.headline).lineLimit(1)
            }
            if let line = s.windowLine { Text(line).font(.caption).lineLimit(1) }
            else if let f = s.feels { Text(f).font(.caption) }
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
