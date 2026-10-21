import AppKit

struct Fixture: Decodable {
    let id: String
    let title: String
    let content: RichNode
    let text: String
    let appearance: Appearance
}
struct Appearance: Decodable {
    let noteFont, titleFont, codeFont: String
    let theme: String
    let size, width, lineSpacing, paragraphSpacing, listItemSpacing: Double
    let dark: Bool
}
struct RichNode: Decodable {
    let type: String
    var text: String?
    var content: [RichNode]?
    var marks: [RichMark]?
    var attrs: [String: JSONValue]?
}
struct RichMark: Decodable {
    let type: String
    var attrs: [String: JSONValue]?
}
enum JSONValue: Decodable {
    case string(String), number(Double), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }
    var string: String? { if case .string(let s) = self { return s }; return nil }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
}
struct ImportFailure: Error, CustomStringConvertible {
    let description: String
}
final class RichImporter {
    let fixture: Fixture
    let output = NSMutableAttributedString(string: "")
    var blocks: [Int] = []
    var topBlocks: [Int] = []
    var sourceRanges: [(NSRange,String)] = []
    var counts: [String:Int] = [:]
    var markCounts: [String:Int] = [:]
    var sourceText = ""
    var warnings: [String] = []
    var ink = NSColor(calibratedWhite: 0.87, alpha: 1)
    var background = NSColor(calibratedRed:0.10, green:0.12, blue:0.14, alpha:1)
    init(_ fixture: Fixture) {
        self.fixture = fixture
        if !fixture.appearance.dark { ink = .textColor; background = .textBackgroundColor }
        if fixture.appearance.theme == "zen" {
            if fixture.appearance.dark {
                ink=NSColor(srgbRed:232/255,green:227/255,blue:218/255,alpha:1)
                background=NSColor(srgbRed:24/255,green:24/255,blue:23/255,alpha:1)
            } else {
                ink=NSColor(srgbRed:30/255,green:30/255,blue:30/255,alpha:1)
                background=NSColor(srgbRed:244/255,green:239/255,blue:228/255,alpha:1)
            }
        }else{warnings.append("Prototype palette match currently covers Zen only")}
    }
    func font(_ setting: String, size: Double) -> NSFont {
        let presets = ["system":"", "helvetica":"Helvetica Neue", "avenir":"Avenir Next", "georgia":"Georgia", "palatino":"Palatino", "menlo":"Menlo", "monaco":"Monaco", "courier":"Courier New"]
        let family = setting.hasPrefix("font:") ? String(setting.dropFirst(5)) : (presets[setting] ?? "")
        if family.isEmpty { return NSFont.systemFont(ofSize:size) }
        if let f = NSFont(name:family, size:size) { return f }
        if let f = NSFontManager.shared.font(withFamily:family, traits:[], weight:5, size:size) { return f }
        let message = "Font unavailable: \(family)"
        if !warnings.contains(message) { warnings.append(message) }
        return NSFont.systemFont(ofSize:size)
    }
    func paragraph(depth: Int = 0, heading: Bool = false, marker: Bool = true) -> NSMutableParagraphStyle {
        let p = NSMutableParagraphStyle()
        let a = fixture.appearance
        p.minimumLineHeight = a.size * a.lineSpacing
        p.maximumLineHeight = a.size * a.lineSpacing
        p.paragraphSpacing = heading ? 8 : a.paragraphSpacing
        if depth > 0 {
            p.headIndent = Double(depth) * max(24,a.size+8)
            p.firstLineHeadIndent = p.headIndent
            // CSS's negative sibling margin reduces the baseline distance.
            p.paragraphSpacingBefore = marker ? a.listItemSpacing : a.paragraphSpacing
            if marker {p.textLists = (1...depth).map { level in NSTextList(markerFormat:level%3 == 1 ? .disc : (level%3 == 2 ? .circle : .square), options:0) }}
        }
        return p
    }
    func normalAttributes() -> [NSAttributedString.Key:Any] {
        [.font:font(fixture.appearance.noteFont,size:fixture.appearance.size), .foregroundColor:ink, .paragraphStyle:paragraph()]
    }
    func load() throws -> NSAttributedString {
        try block(fixture.content, depth:0)
        if output.length > 0 { output.deleteCharacters(in:NSRange(location:output.length-1,length:1)) }
        return output
    }
    func block(_ n: RichNode, depth: Int, marker:Bool = true) throws {
        counts[n.type,default:0] += 1
        switch n.type {
        case "doc":
            for child in n.content ?? [] { topBlocks.append(output.length); try block(child,depth:depth) }
        case "mixedList":
            for child in n.content ?? [] { try block(child,depth:depth+1) }
        case "mixedListItem":
            guard n.attrs?["kind"]?.string == "bullet" else { throw ImportFailure(description:"Prototype supports bullet list items only; found a different list kind") }
            var firstParagraph=true
            for child in n.content ?? [] {
                try block(child,depth:depth,marker:firstParagraph)
                if child.type == "paragraph" || child.type == "heading" {firstParagraph=false}
            }
        case "paragraph", "heading":
            blocks.append(output.length)
            var a = normalAttributes()
            let heading = n.type == "heading"
            let p = paragraph(depth:depth,heading:heading,marker:marker)
            if let alignment = n.attrs?["textAlign"]?.string {
                p.alignment = alignment == "center" ? .center : (alignment == "right" ? .right : (alignment == "justify" ? .justified : .left))
            }
            a[.paragraphStyle] = p
            if heading {
                let level = Int(n.attrs?["level"]?.number ?? 3)
                let factors = [1:1.75,2:1.23,3:1.1,4:1.0,5:1.0,6:1.0]
                a[.font] = NSFontManager.shared.convert(font(fixture.appearance.noteFont,size:fixture.appearance.size*(factors[level] ?? 1)), toHaveTrait:.boldFontMask)
                p.minimumLineHeight = fixture.appearance.size*(factors[level] ?? 1)*1.4
                p.maximumLineHeight = p.minimumLineHeight
                p.paragraphSpacingBefore = 29
                p.paragraphSpacing = 13
            }
            for child in n.content ?? [] { try inline(child, attributes:a) }
            output.append(NSAttributedString(string:"\n",attributes:a))
        case "horizontalRule":
            let image = NSImage(size:NSSize(width:200,height:1),flipped:false) { rect in
                NSColor.gray.setFill(); rect.fill(); return true
            }
            let attachment = NSTextAttachment()
            attachment.attachmentCell = NSTextAttachmentCell(imageCell:image)
            output.append(NSAttributedString(attachment:attachment))
            output.append(NSAttributedString(string:"\n",attributes:normalAttributes()))
        default: throw ImportFailure(description:"Unsupported block: \(n.type)")
        }
    }
    func inline(_ n: RichNode, attributes: [NSAttributedString.Key:Any]) throws {
        counts[n.type,default:0] += 1
        if n.type == "hardBreak" { output.append(NSAttributedString(string:"\u{2028}",attributes:attributes)); return }
        guard n.type == "text", let text = n.text else { throw ImportFailure(description:"Unsupported inline node: \(n.type)") }
        var a = attributes
        for mark in n.marks ?? [] {
            markCounts[mark.type,default:0] += 1
            switch mark.type {
            case "underline": a[.underlineStyle] = NSUnderlineStyle.single.rawValue
            case "link":
                guard let href = mark.attrs?["href"]?.string else { throw ImportFailure(description:"Link has no address") }
                a[.link] = href; a[.underlineStyle] = NSUnderlineStyle.single.rawValue
            case "code":
                a[.font] = font(fixture.appearance.codeFont,size:fixture.appearance.size*0.85)
                if fixture.appearance.theme == "zen" {
                    a[.backgroundColor] = fixture.appearance.dark ? NSColor(srgbRed:34/255,green:34/255,blue:34/255,alpha:1) : NSColor(srgbRed:216/255,green:210/255,blue:196/255,alpha:1)
                }
            case "bold": a[.font] = NSFontManager.shared.convert(a[.font] as! NSFont,toHaveTrait:.boldFontMask)
            case "italic": a[.font] = NSFontManager.shared.convert(a[.font] as! NSFont,toHaveTrait:.italicFontMask)
            default: throw ImportFailure(description:"Unsupported mark: \(mark.type)")
            }
        }
        sourceText += text
        sourceRanges.append((NSRange(location:output.length,length:(text as NSString).length),text))
        output.append(NSAttributedString(string:text,attributes:a))
    }
}
