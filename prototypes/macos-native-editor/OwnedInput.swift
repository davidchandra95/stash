import AppKit
import CoreFoundation

// Benchmark-only native event receiver, shared by both applications. Its port is
// owned by one process and dispatches to that process's editor window only.
// No DOM events or global keyboard events are generated.
final class OwnedInput {
    static var receivers:[OwnedInput]=[]
    let window:NSWindow
    let view:NSView
    var port:CFMessagePort?
    init(_ window:NSWindow,_ view:NSView){self.window=window;self.view=view}
    static func start(_ window:NSWindow,_ view:NSView){
        let receiver=OwnedInput(window,view)
        var context=CFMessagePortContext(version:0,info:Unmanaged.passUnretained(receiver).toOpaque(),retain:nil,release:nil,copyDescription:nil)
        var freeContext=DarwinBoolean(false)
        let name="local.stash.native-bench.input.\(ProcessInfo.processInfo.processIdentifier)" as CFString
        receiver.port=CFMessagePortCreateLocal(nil,name,{_,id,data,info in
            guard let info,let data,let packet=(try? JSONSerialization.jsonObject(with:data as Data)) as? [String:Double] else{return nil}
            let receiver=Unmanaged<OwnedInput>.fromOpaque(info).takeUnretainedValue()
            receiver.receive(id,packet)
            return nil
        },&context,&freeContext)
        guard let port=receiver.port else{fatalError("Cannot register owned benchmark input port")}
        let source=CFMessagePortCreateRunLoopSource(nil,port,0)
        CFRunLoopAddSource(CFRunLoopGetMain(),source,.commonModes)
        receivers.append(receiver)
    }
    func receive(_ id:Int32,_ packet:[String:Double]){
        guard let target=window.firstResponder else{return}
        let time=packet["time"] ?? ProcessInfo.processInfo.systemUptime
        if id==3{
            let cg=CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:1,wheel1:Int32(packet["delta"]!),wheel2:0,wheel3:0)!
            cg.location=CGPoint(x:window.frame.minX+packet["x"]!,y:packet["y"]!)
            // A discrete pixel wheel, with no gesture or momentum phase.
            let screenPoint=NSPoint(x:cg.location.x,y:(NSScreen.screens.first?.frame.maxY ?? 0)-cg.location.y)
            let windowPoint=window.convertPoint(fromScreen:screenPoint)
            let content=window.contentView!
            let hit=content.hitTest(content.convert(windowPoint,from:nil)) ?? view
            if let event=NSEvent(cgEvent:cg){hit.scrollWheel(with:event)}
            return
        }
        let command=packet["command"]==1
        if id==1 && command{
            _=target.tryToPerform(#selector(NSText.paste(_:)),with:nil)
            return
        }
        let characters=command ? "v" : "x"
        guard let event=NSEvent.keyEvent(with:id==1 ? .keyDown : .keyUp,location:.zero,modifierFlags:command ? .command : [],timestamp:time,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:false,keyCode:command ? 9 : 7) else{return}
        if id==1{target.keyDown(with:event)}else{target.keyUp(with:event)}
    }
}

@_cdecl("stash_benchmark_register_input")
public func stashBenchmarkRegisterInput(_ windowPointer:UnsafeMutableRawPointer,_ viewPointer:UnsafeMutableRawPointer){
    let window=Unmanaged<NSWindow>.fromOpaque(windowPointer).takeUnretainedValue()
    let view=Unmanaged<NSView>.fromOpaque(viewPointer).takeUnretainedValue()
    window.makeFirstResponder(view)
    OwnedInput.start(window,view)
}
