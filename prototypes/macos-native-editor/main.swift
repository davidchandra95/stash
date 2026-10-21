import AppKit
import QuartzCore

let options=CommandLine.arguments
guard let index=options.firstIndex(of:"--fixture"), options.count>index+1 else { fatalError("Pass --fixture /path/to/fixture.json") }
let fixturePath=options[index+1]
let fixture=try JSONDecoder().decode(Fixture.self,from:Data(contentsOf:URL(fileURLWithPath:fixturePath)))
let portIndex=options.firstIndex(of:"--port")
let controlPort=portIndex.map{options[$0+1]}

if options.contains("--validate") {
    _ = NSApplication.shared
    let importer=RichImporter(fixture)
    let imported=try importer.load()
    var expected:[String:Int]=[:], marks:[String:Int]=[:]
    func count(_ n:RichNode){expected[n.type,default:0] += 1;for m in n.marks ?? []{marks[m.type,default:0] += 1};for child in n.content ?? []{count(child)}}
    count(fixture.content)
    precondition(expected==importer.counts && marks==importer.markCounts,"Import omitted document structure")
    for(range,text)in importer.sourceRanges{precondition((imported.string as NSString).substring(with:range)==text,"Source text changed")}
    var textIndex=0
    func verifyMarks(_ n:RichNode){
        if n.type == "text" {
            let range=importer.sourceRanges[textIndex].0;textIndex += 1
            let attributes=imported.attributes(at:range.location,effectiveRange:nil)
            for mark in n.marks ?? [] {
                if mark.type == "link" {precondition((attributes[.link] as? String)==mark.attrs?["href"]?.string,"Link address changed")}
                if mark.type == "underline" {precondition((attributes[.underlineStyle] as? Int)==NSUnderlineStyle.single.rawValue,"Underline lost")}
                if mark.type == "code" {precondition((attributes[.font] as? NSFont)?.familyName==importer.font(fixture.appearance.codeFont,size:fixture.appearance.size).familyName,"Code font lost")}
            }
        }
        for child in n.content ?? []{verifyMarks(child)}
    }
    verifyMarks(fixture.content)
    let markers=importer.blocks.filter{$0<imported.length && ((imported.attribute(.paragraphStyle,at:$0,effectiveRange:nil) as? NSParagraphStyle)?.textLists.count ?? 0)>0}.count
    precondition(markers==expected["mixedListItem"],"List marker count differs from item count")
    let nested=imported.attributes(at:importer.sourceRanges.first!.0.location,effectiveRange:nil)
    precondition(nested[.font] != nil && nested[.paragraphStyle] != nil)
    let unknown=Fixture(id:"invalid",title:"invalid",content:RichNode(type:"doc",content:[RichNode(type:"table")]),text:"",appearance:fixture.appearance)
    do{_ = try RichImporter(unknown).load();fatalError("Unsupported block was accepted")}catch{}
    let result:[String:Any]=["passed":true,"nodes":expected,"marks":marks,"verifiedTextRanges":importer.sourceRanges.count,"verifiedListMarkers":markers,"warnings":importer.warnings]
    print(String(data:try JSONSerialization.data(withJSONObject:result,options:.sortedKeys),encoding:.utf8)!)
    exit(0)
}

final class NativeEditor: NSObject, NSApplicationDelegate, NSTextViewDelegate {
    var window: NSWindow!
    var textView: NSTextView!
    var scroll: NSScrollView!
    var importer: RichImporter!
    var original: NSAttributedString!
    var before=""
    var engineSwitches=0
    var status: NSTextField!
    var observations:[NSObjectProtocol]=[]
    var importMs=0.0
    var caretStartX=0.0
    var inputTimes:[Double]=[]
    var scrollStartY=0.0
    var scrollMaxY=0.0
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let t=CACurrentMediaTime()
            importer=RichImporter(fixture)
            original=try importer.load()
            importMs=(CACurrentMediaTime()-t)*1000
            window=NSWindow(contentRect:NSRect(x:40,y:50,width:1320,height:852),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
            window.title="Stash native editor prototype - edits stay in memory"
            window.appearance=NSAppearance(named:fixture.appearance.dark ? .darkAqua : .aqua)
            let root=window.contentView!
            status=NSTextField(labelWithString:"")
            status.frame=NSRect(x:20,y:root.bounds.height-40,width:750,height:25)
            status.autoresizingMask=[.width,.minYMargin]
            root.addSubview(status)
            let title=NSTextField(labelWithString:fixture.title)
            title.font=importer.font(fixture.appearance.titleFont,size:fixture.appearance.size*1.75)
            title.textColor=importer.ink
            title.frame=NSRect(x:20,y:root.bounds.height-76,width:800,height:34)
            title.autoresizingMask=[.width,.minYMargin];root.addSubview(title)
            let buttons:[(String,Selector)]=[("Reset",#selector(reset)),("Bold",#selector(bold)),("Italic",#selector(italic)),("Underline",#selector(underline)),("Undo",#selector(undo)),("Redo",#selector(redo))]
            for (i,item) in buttons.enumerated(){
                let b=NSButton(title:item.0,target:self,action:item.1)
                b.frame=NSRect(x:20+i*85,y:8,width:80,height:30)
                root.addSubview(b)
            }
            scroll=NSScrollView(frame:NSRect(x:0,y:48,width:root.bounds.width,height:root.bounds.height-98))
            scroll.autoresizingMask=[.width,.height]
            scroll.hasVerticalScroller=true; scroll.drawsBackground=true;scroll.backgroundColor=importer.background
            scroll.scrollerStyle = .overlay
            textView=NSTextView(usingTextLayoutManager:true)
            textView.frame=NSRect(x:0,y:0,width:scroll.contentSize.width,height:scroll.contentSize.height)
            textView.isRichText=true;textView.isEditable=true;textView.isSelectable=true;textView.allowsUndo=true
            textView.isVerticallyResizable=true;textView.isHorizontallyResizable=false
            textView.autoresizingMask=[.width]
            textView.textContainer?.widthTracksTextView=true
            textView.textContainer?.lineFragmentPadding=0
            textView.textContainer?.containerSize=NSSize(width:scroll.contentSize.width,height:CGFloat.greatestFiniteMagnitude)
            textView.minSize=NSSize(width:0,height:scroll.contentSize.height)
            textView.maxSize=NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude)
            textView.backgroundColor=importer.background;textView.textColor=importer.ink
            textView.insertionPointColor=importer.ink
            if fixture.appearance.theme == "zen" {
                textView.linkTextAttributes=[.foregroundColor:NSColor(srgbRed:209/255,green:207/255,blue:192/255,alpha:1),.underlineStyle:NSUnderlineStyle.single.rawValue]
                textView.selectedTextAttributes=[.backgroundColor:NSColor(srgbRed:54/255,green:54/255,blue:54/255,alpha:1),.foregroundColor:importer.ink]
            }
            textView.isContinuousSpellCheckingEnabled=true
            textView.delegate=self
            scroll.documentView=textView;root.addSubview(scroll)
            scroll.contentView.postsBoundsChangedNotifications=true
            observations.append(NotificationCenter.default.addObserver(forName:NSView.boundsDidChangeNotification,object:scroll.contentView,queue:.main){[weak self] _ in
                guard let self else{return};self.scrollMaxY=max(self.scrollMaxY,self.scroll.contentView.bounds.minY)
            })
            reset()
            window.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
            observations.append(NotificationCenter.default.addObserver(forName:NSWindow.didResizeNotification,object:window,queue:.main){[weak self] _ in self?.setWritingWidth()})
            observations.append(NotificationCenter.default.addObserver(forName:NSTextView.didSwitchToNSLayoutManagerNotification,object:textView,queue:.main){[weak self] _ in self?.engineSwitches += 1; self?.updateStatus()})
            if controlPort != nil { OwnedInput.start(window,textView);poll() }
        } catch {
            fputs("Native import failed: \(error)\n",stderr);NSApp.terminate(nil)
        }
    }
    func setWritingWidth(_ textWidth: Double? = nil, height: Double? = nil) {
        let width=textWidth ?? Double(scroll.contentSize.width)*fixture.appearance.width/100
        textView.textContainerInset=NSSize(width:max(12,(Double(scroll.contentSize.width)-width)/2),height:16)
        if let height { scroll.setFrameSize(NSSize(width:scroll.frame.width,height:min(height,window.contentView!.bounds.height-98))) }
    }
    func updateStatus(){
        status.stringValue="TextKit \(textView.textLayoutManager == nil ? "1" : "2") | \(fixture.text.count) source characters | \(importer.counts["mixedListItem"] ?? 0) list items | in memory"+(importer.warnings.isEmpty ? "" : " | "+importer.warnings.joined(separator:", "))
    }
    @objc func reset(){textView.textStorage!.setAttributedString(original);textView.setSelectedRange(NSRange(location:0,length:0));scroll.contentView.scroll(to:.zero);textView.undoManager?.removeAllActions();textView.typingAttributes=importer.normalAttributes();setWritingWidth();updateStatus()}
    func trait(_ value:NSFontTraitMask){
        let manager=NSFontManager.shared
        manager.target=textView
        manager.setSelectedFont(textView.typingAttributes[.font] as? NSFont ?? importer.font(fixture.appearance.noteFont,size:fixture.appearance.size),isMultiple:false)
        let item=NSMenuItem();item.tag=Int(value.rawValue)
        if manager.traits(of:manager.selectedFont!).contains(value){manager.removeFontTrait(item)}else{manager.addFontTrait(item)}
        window.makeFirstResponder(textView)
    }
    @objc func bold(){trait(.boldFontMask)}
    @objc func italic(){trait(.italicFontMask)}
    @objc func underline(){textView.underline(nil)}
    @objc func undo(){textView.undoManager?.undo()}
    @objc func redo(){textView.undoManager?.redo()}
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication)->Bool{true}
    func textDidChange(_ notification: Notification){if controlPort != nil{inputTimes.append(CACurrentMediaTime())}; if textView.textLayoutManager == nil { updateStatus() } }
    func execute(_ c:[String:Any]) throws -> [String:Any] {
        guard textView.textLayoutManager != nil, engineSwitches == 0 else {throw ImportFailure(description:"TextKit 2 fell back to TextKit 1")}
        switch c["action"] as? String {
        case "init", "status":return ["ready":true,"pid":ProcessInfo.processInfo.processIdentifier,"engine":"TextKit2","importMs":importMs,"counts":importer.counts,"marks":importer.markCounts,"warnings":importer.warnings,"sourceTextCharacters":importer.sourceText.count]
        case "resize":
            let height=c["height"] as! Double
            window.setFrame(NSRect(x:0,y:Double(NSScreen.screens.first?.frame.maxY ?? CGFloat(height))-height-40,width:c["width"] as! Double,height:height),display:true)
            return ["resized":true]
        case "editing-check":
            textView.textStorage!.setAttributedString(NSAttributedString(string:"Formatting sample",attributes:importer.normalAttributes()))
            textView.setSelectedRange(NSRange(location:0,length:10))
            window.makeFirstResponder(textView)
            bold();italic();underline()
            let a=textView.textStorage!.attributes(at:0,effectiveRange:nil)
            let traits=NSFontManager.shared.traits(of:a[.font] as! NSFont)
            guard traits.contains(.boldFontMask),traits.contains(.italicFontMask),a[.underlineStyle] as? Int == NSUnderlineStyle.single.rawValue else{throw ImportFailure(description:"Native basic formatting check failed")}
            // Use a private pasteboard for copy validation so the user's clipboard stays intact.
            let board=NSPasteboard.withUniqueName()
            board.declareTypes([.string],owner:nil)
            let copyType=NSPasteboard.PasteboardType("NSStringPboardType")
            let copied=textView.writeSelection(to:board,types:[copyType])
            guard copied,board.string(forType:copyType)=="Formatting" else{throw ImportFailure(description:"Native selection/copy failed: selected \(textView.selectedRange()), copied \(copied), selectable \(textView.isSelectable), value \(board.string(forType:copyType) ?? "nil"), writable \(textView.writablePasteboardTypes)")}
            reset()
            guard textView.string==original.string else{throw ImportFailure(description:"Native reset failed")}
            return ["passed":true,"bold":true,"italic":true,"underline":true,"selectionCopy":true,"reset":true,"engine":"TextKit2"]
        case "scroll-check":
            guard scrollMaxY-scrollStartY>100 else{throw ImportFailure(description:"Native scrolling did not move the viewport: start \(scrollStartY), max \(scrollMaxY), end \(scroll.contentView.bounds.minY)")}
            return ["verified":true,"distance":scrollMaxY-scrollStartY,"endY":scroll.contentView.bounds.minY,"engine":"TextKit2"]
        case "geometry":
            textView.layoutSubtreeIfNeeded();textView.displayIfNeeded()
            var actual=NSRange()
            let r=textView.firstRect(forCharacterRange:textView.selectedRange(),actualRange:&actual)
            caretStartX=r.minX
            return ["roi":["x":r.minX-window.frame.minX+3,"y":window.frame.maxY-r.maxY-2,"width":533,"height":max(r.height,fixture.appearance.size*fixture.appearance.lineSpacing)+4]]
        case "prepare":
            let t=CACurrentMediaTime()
            importer=RichImporter(fixture);original=try importer.load()
            importMs=(CACurrentMediaTime()-t)*1000
            reset()
            let position=c["position"] as? String ?? "bottom"
            let control=c["control"] as? Bool == true
            let base=control ? NSAttributedString(string:"Control paragraph\nSecond paragraph\n",attributes:importer.normalAttributes()) : original!
            let offset=position == "top" ? 0 : (position == "middle" ? importer.topBlocks[importer.topBlocks.count/2] : base.length)
            let prefix=position == "bottom" ? "\nBENCH " : "BENCH \n"
            let m=NSMutableAttributedString(attributedString:base)
            m.insert(NSAttributedString(string:prefix,attributes:importer.normalAttributes()),at:offset)
            textView.textStorage!.setAttributedString(m)
            let caret=offset+(position == "bottom" ? 7 : 6)
            textView.setSelectedRange(NSRange(location:caret,length:0))
            textView.typingAttributes=importer.normalAttributes()
            if let v=c["viewport"] as? [String:Double]{
                scroll.frame=NSRect(x:v["x"]!,y:window.frame.height-v["y"]!-v["height"]!,width:v["width"]!,height:v["height"]!)
                textView.frame.size.width=scroll.contentSize.width
            }
            setWritingWidth(c["textWidth"] as? Double,height:c["viewportHeight"] as? Double)
            if let v=c["viewport"] as? [String:Double],let padding=v["topPadding"]{textView.textContainerInset.height=padding}
            textView.scrollRangeToVisible(textView.selectedRange())
            window.makeFirstResponder(textView)
            textView.undoManager?.removeAllActions();before=textView.string
            inputTimes=[]
            scrollStartY=scroll.contentView.bounds.minY;scrollMaxY=scrollStartY
            var actual=NSRange()
            let r=textView.firstRect(forCharacterRange:textView.selectedRange(),actualRange:&actual)
            caretStartX=r.minX
            let x=r.minX-window.frame.minX
            let y=window.frame.maxY-r.maxY
            return ["roi":["x":x+3,"y":y-2,"width":min(550,Double(scroll.contentSize.width-textView.textContainerInset.width)+scroll.frame.minX-x-4),"height":max(r.height,fixture.appearance.size*fixture.appearance.lineSpacing)+4],"prepareMs":(CACurrentMediaTime()-t)*1000,"importMs":importMs,"engine":"TextKit2","viewport":["width":scroll.contentSize.width,"height":scroll.contentSize.height,"textWidth":textView.textContainer!.size.width]]
        case "check":
            let typed=c["text"] as? String ?? ""
            let expected=before.replacingOccurrences(of:"BENCH ",with:"BENCH "+typed)
            guard textView.string==expected else {throw ImportFailure(description:"Native input verification failed: actual \(textView.string.count), expected \(expected.count), callbacks \(inputTimes.count), text responder \(window.firstResponder === textView)")}
            var actual=NSRange()
            let end=textView.firstRect(forCharacterRange:textView.selectedRange(),actualRange:&actual)
            let advance=typed.isEmpty ? 0 : (end.minX-caretStartX)/Double(typed.count)
            if c["undo"] as? Bool == true {
                textView.undoManager?.undo()
                guard textView.string==before else {throw ImportFailure(description:"Native undo verification failed")}
                textView.undoManager?.redo()
                guard textView.string==expected else {throw ImportFailure(description:"Native redo verification failed")}
            }
            return ["verified":true,"engine":"TextKit2","switches":engineSwitches,"advance":advance,"caretY":window.frame.maxY-end.maxY-2,"inputTimes":Array(inputTimes.prefix(typed.count))]
        default:throw ImportFailure(description:"Unknown control action")
        }
    }
    func poll(){
        let base="http://127.0.0.1:\(controlPort!)"
        URLSession.shared.dataTask(with:URL(string:base+"/command?client=native")!){data,_,error in
            guard let data, let c=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else {DispatchQueue.main.asyncAfter(deadline:.now()+0.5){self.poll()};return}
            DispatchQueue.main.async {
                var result:[String:Any]
                do{result=try self.execute(c)}catch{result=["error":String(describing:error)]}
                var request=URLRequest(url:URL(string:base+"/response")!);request.httpMethod="POST"
                request.httpBody=try? JSONSerialization.data(withJSONObject:["client":"native","id":c["id"]!,"result":result])
                URLSession.shared.dataTask(with:request){_,_,_ in self.poll()}.resume()
            }
        }.resume()
    }
}
let app=NSApplication.shared
app.setActivationPolicy(.regular)
let delegate=NativeEditor()
app.delegate=delegate
let menu=NSMenu();let appItem=NSMenuItem();menu.addItem(appItem)
let appMenu=NSMenu();appMenu.addItem(withTitle:"Quit prototype",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q");appItem.submenu=appMenu
let editItem=NSMenuItem();menu.addItem(editItem);let editMenu=NSMenu(title:"Edit")
for (title,action,key) in [("Copy",#selector(NSText.copy(_:)),"c"),("Paste",#selector(NSText.paste(_:)),"v"),("Select all",#selector(NSText.selectAll(_:)),"a")] {editMenu.addItem(withTitle:title,action:action,keyEquivalent:key)}
let undoItem=editMenu.addItem(withTitle:"Undo",action:#selector(NativeEditor.undo),keyEquivalent:"z");undoItem.target=delegate
let redoItem=editMenu.addItem(withTitle:"Redo",action:#selector(NativeEditor.redo),keyEquivalent:"z");redoItem.target=delegate;redoItem.keyEquivalentModifierMask=[.command,.shift]
for(title,action,key)in [("Bold",#selector(NativeEditor.bold),"b"),("Italic",#selector(NativeEditor.italic),"i"),("Underline",#selector(NativeEditor.underline),"u")]{let item=editMenu.addItem(withTitle:title,action:action,keyEquivalent:key);item.target=delegate}
editItem.submenu=editMenu;app.mainMenu=menu
app.run()
