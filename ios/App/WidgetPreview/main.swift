// Quick widget previews on the Mac, no Xcode, no simulator: renders the shared widget faces
// (Widget/Shared) for a few moments of the sample feed, light and dark, into one PNG.
//   ios/App/WidgetPreview/preview.sh [out.png]
// The sizes and backgrounds are set here (ImageRenderer is not a widget host): close, not exact.
import AppKit
import SwiftUI

let args = CommandLine.arguments
let out = URL(fileURLWithPath: args.count > 1 ? args[1] : "/tmp/widget-preview.png")
let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let sample = here.deletingLastPathComponent().appendingPathComponent("WidgetSnapshots/sample-feed.json")

/// The sample feed, optionally with made-up bad air: smog 11 and 15-16, dust 17-18.
func feed(hazards: Bool) -> Feed {
    let data = try! Data(contentsOf: sample)
    guard hazards else { return Feed.decode(data)! }
    var json = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
    var profiles = json["profiles"] as! [String: Any]
    for name in ["kids", "adults"] {
        var p = profiles[name] as! [String: Any]
        var hours = p["hours"] as! [[String: Any]]
        for i in 0..<24 {
            if [11, 15, 16].contains(i) { hours[i]["badAir"] = "smog"; hours[i]["air"] = "bad"; hours[i]["verdict"] = "bad" }
            if [17, 18].contains(i) { hours[i]["badAir"] = "dust"; hours[i]["air"] = "bad"; hours[i]["verdict"] = "bad" }
        }
        p["hours"] = hours
        profiles[name] = p
    }
    json["profiles"] = profiles
    return Feed.decode(try! JSONSerialization.data(withJSONObject: json))!
}

func snapshot(_ f: Feed, hour: Int, settings: WidgetSettings = WidgetSettings()) -> Snapshot {
    let day = f.profiles["kids"]!.hours[0].day
    let at = Dubai.date(of: "\(day)T\(String(format: "%02d", hour)):20+04:00")!
    let s = Snapshot.make(feed: f, settings: settings, at: at)
    return Snapshot(now: s.now, phase: s.phase, today: s.today, wholeDay: s.wholeDay, nowHour: s.nowHour, window: s.window,
                    inWindow: s.inWindow, windowDay: s.windowDay, settings: s.settings, stale: false, updated: s.updated)
}

struct Tile<V: View>: View {
    let size: CGSize
    let dark: Bool
    let content: V
    var body: some View {
        content
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(dark ? Color.black : Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, dark ? .dark : .light)
            .foregroundStyle(dark ? Color.white : Color.black)
    }
}

let cases: [(String, Snapshot)] = [
    ("made-up bad air, 14:00", snapshot(feed(hazards: true), hour: 14)),
    ("today, 11:00", snapshot(feed(hazards: false), hour: 11)),
]

/// One labelled row: small and medium, light and dark.
func row(_ name: String, _ s: Snapshot) -> some View {
    VStack(alignment: .leading, spacing: 8) {
        Text(name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
        HStack(spacing: 12) {
            Tile(size: CGSize(width: 170, height: 170), dark: false, content: SmallFace(s: s))
            Tile(size: CGSize(width: 364, height: 170), dark: false, content: MediumFace(s: s))
            Tile(size: CGSize(width: 170, height: 170), dark: true, content: SmallFace(s: s))
            Tile(size: CGSize(width: 364, height: 170), dark: true, content: MediumFace(s: s))
        }
    }
    .padding(10)
    .background(Color(white: 0.45))
}

MainActor.assumeIsolated {
    // each row rendered on its own, stacked
    let images: [CGImage] = cases.map { name, s in
        let r = ImageRenderer(content: row(name, s))
        r.scale = 2
        return r.cgImage!
    }
    let width = images.map(\.width).max()!, height = images.map(\.height).reduce(0, +)
    let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    var y = height
    for im in images {
        y -= im.height
        ctx.draw(im, in: CGRect(x: 0, y: y, width: im.width, height: im.height))
    }
    let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: out)
    print(out.path)
}
