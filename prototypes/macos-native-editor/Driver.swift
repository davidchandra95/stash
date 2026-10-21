import AppKit
import ScreenCaptureKit
import CoreMedia
import QuartzCore
import ApplicationServices
import CoreFoundation

final class Frames: NSObject, SCStreamOutput, SCStreamDelegate {
    let roi: CGRect
    let lock=NSLock()
    var baseline:[UInt8]?
    var samples:[[String:Double]]=[]
    var incomplete=0
    var statuses:[Int:Int]=[:]
    var failure: String?
    var baselineWidth=0
    var lastPixels:[UInt8]=[]
    var lastHeight=0
    init(roi:CGRect){self.roi=roi}
    func snapshot()->[[String:Double]]{lock.lock();defer{lock.unlock()};return samples}
    func stream(_ stream:SCStream,didStopWithError error:Error){failure=String(describing:error)}
    func stream(_ stream:SCStream,didOutputSampleBuffer sampleBuffer:CMSampleBuffer,of type:SCStreamOutputType){
        guard type == .screen, let attachments=CMSampleBufferGetSampleAttachmentsArray(sampleBuffer,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]], let a=attachments.first else {return}
        let status=a[.status] as? Int ?? -1
        statuses[status,default:0] += 1
        guard status == SCFrameStatus.complete.rawValue, let pixel=CMSampleBufferGetImageBuffer(sampleBuffer) else {incomplete += 1;return}
        CVPixelBufferLockBaseAddress(pixel,.readOnly);defer{CVPixelBufferUnlockBaseAddress(pixel,.readOnly)}
        guard let base=CVPixelBufferGetBaseAddress(pixel) else{return}
        let width=CVPixelBufferGetWidth(pixel),height=CVPixelBufferGetHeight(pixel),stride=CVPixelBufferGetBytesPerRow(pixel)
        // Stream dimensions are the window's logical point dimensions.
        let x=max(0,Int(roi.minX)),y=max(0,Int(roi.minY)),w=min(Int(roi.width),width-x),h=min(Int(roi.height),height-y)
        guard w>0,h>0 else{return}
        let ptr=base.assumingMemoryBound(to:UInt8.self)
        var pixels=[UInt8]();pixels.reserveCapacity(w*h*3)
        for row in y..<y+h{for column in x..<x+w{let offset=row*stride+column*4;pixels.append(ptr[offset]);pixels.append(ptr[offset+1]);pixels.append(ptr[offset+2])}}
        lock.lock();defer{lock.unlock()}
        if baseline == nil{baseline=pixels;baselineWidth=w}
        guard let initial=baseline,initial.count==pixels.count else{return}
        lastPixels=pixels;lastHeight=h
        var columns=[Int](repeating:0,count:w)
        for row in 0..<h{for column in 0..<w{
            let i=(row*w+column)*3
            let change=max(abs(Int(pixels[i])-Int(initial[i])),max(abs(Int(pixels[i+1])-Int(initial[i+1])),abs(Int(pixels[i+2])-Int(initial[i+2]))))
            if change>32{columns[column] += 1}
        }}
        // Remove tall caret columns even when the caret touches the glyph run.
        // X glyphs have short diagonal strokes; carets occupy most of the line.
        for column in 0..<w{if columns[column]>=max(10,Int(Double(h)*0.40)){columns[column]=0}}
        // A caret is a thin vertical run. Keep only ink runs at least 3 points wide.
        var ink=0,runs=0,rightmost=0,begin=0
        while begin<w{
            if columns[begin]<2{begin += 1;continue}
            var end=begin+1
            while end<w && columns[end]>=2{end += 1}
            if end-begin>=3{ink += columns[begin..<end].reduce(0,+);runs += 1;rightmost=end}
            begin=end
        }
        let pts=CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        let now=CACurrentMediaTime()
        // CMSampleBuffer timestamps should use host time; reject another timebase.
        let time=abs(pts-now)<5 ? pts : now
        samples.append(["time":time,"ink":Double(ink),"rightmostInk":Double(rightmost),"glyphRuns":Double(runs),"callbackTime":now])
    }
}
func post(_ port:CFMessagePort,_ id:Int32,_ packet:[String:Double]) throws{
    let data=try JSONSerialization.data(withJSONObject:packet) as CFData
    let result=CFMessagePortSendRequest(port,id,data,0.1,0,nil,nil)
    guard result==kCFMessagePortSuccess else{throw ImportFailure(description:"Owned input port failed: \(result)")}
}
func rectangle(_ value:[String:Any])->CGRect {CGRect(x:value["x"] as! Double,y:value["y"] as! Double,width:value["width"] as! Double,height:value["height"] as! Double)}
func percentile(_ a:[Double],_ p:Double)->Double?{if a.isEmpty{return nil};let s=a.sorted();return s[min(s.count-1,Int(ceil(Double(s.count)*p))-1)]}
func windowInfo(_ pid:pid_t)->[String:Any]?{
    let list=CGWindowListCopyWindowInfo(.optionOnScreenOnly,kCGNullWindowID) as? [[String:Any]] ?? []
    return list.filter{($0[kCGWindowOwnerPID as String] as? Int)==Int(pid) && ($0[kCGWindowLayer as String] as? Int)==0}.max{a,b in
        let ar=CGRect(dictionaryRepresentation:a[kCGWindowBounds as String] as! CFDictionary)!,br=CGRect(dictionaryRepresentation:b[kCGWindowBounds as String] as! CFDictionary)!
        return ar.width*ar.height<br.width*br.height
    }
}
@main struct Driver {
    static func main() async {
        do{try await run()}catch{fputs("Capture driver: \(error)\n",stderr);exit(1)}
    }
    static func run() async throws {
        let processStart=CACurrentMediaTime()
        let args=CommandLine.arguments
        let c=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[1]))) as! [String:Any]
        let pid=pid_t(c["pid"] as! Int),mode=c["mode"] as? String ?? "type"
        let session=CGSessionCopyCurrentDictionary() as? [String:Any]
        let screenLocked=session?["CGSSessionScreenIsLocked"] as? Bool == true
        if mode=="screen-status"{
            try JSONSerialization.data(withJSONObject:["screenLocked":screenLocked,"captureAllowed":CGPreflightScreenCaptureAccess()]).write(to:URL(fileURLWithPath:args[2]));return
        }
        guard !screenLocked || c["capture"] as? Bool == false else{throw ImportFailure(description:"Screen is locked; unlock the Mac before capturing benchmark frames")}
        let foreground=NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
        if mode=="window-info"{
            guard let info=windowInfo(pid) else{throw ImportFailure(description:"Owned window missing")}
            try JSONSerialization.data(withJSONObject:info,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:args[2]));return
        }
        if mode=="resize"{
            let app=AXUIElementCreateApplication(pid);var value:CFTypeRef?
            let error=AXUIElementCopyAttributeValue(app,kAXWindowsAttribute as CFString,&value)
            guard error == .success, let windows=value as? [AXUIElement], let window=windows.first else{throw ImportFailure(description:"Cannot access benchmark window")}
            var size=CGSize(width:c["width"] as! Double,height:c["height"] as! Double),position=CGPoint(x:0,y:40)
            guard AXUIElementSetAttributeValue(window,kAXSizeAttribute as CFString,AXValueCreate(.cgSize,&size)!) == .success,
                  AXUIElementSetAttributeValue(window,kAXPositionAttribute as CFString,AXValueCreate(.cgPoint,&position)!) == .success else{throw ImportFailure(description:"Cannot resize benchmark window")}
            try await Task.sleep(nanoseconds:200_000_000)
            let info=windowInfo(pid)!
            try JSONSerialization.data(withJSONObject:info,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:args[2]));return
        }
        guard let info=windowInfo(pid),let bounds=CGRect(dictionaryRepresentation:info[kCGWindowBounds as String] as! CFDictionary) else{throw ImportFailure(description:"Benchmark window missing")}
        guard let inputPort=CFMessagePortCreateRemote(nil,"local.stash.native-bench.input.\(pid)" as CFString) else{throw ImportFailure(description:"Owned benchmark input port missing")}
        let captured=c["capture"] as? Bool ?? true
        let roi=rectangle(c["roi"] as! [String:Any])
        let frames=Frames(roi:roi)
        var stream:SCStream?
        if captured{
            guard CGPreflightScreenCaptureAccess() else{throw ImportFailure(description:"Screen capture permission required")}
            let content=try await SCShareableContent.excludingDesktopWindows(true,onScreenWindowsOnly:true)
            guard let window=content.windows.first(where:{$0.windowID==(info[kCGWindowNumber as String] as! UInt32)}) else{throw ImportFailure(description:"Capture window missing")}
            let filter=SCContentFilter(desktopIndependentWindow:window)
            let config=SCStreamConfiguration();config.width=Int(bounds.width);config.height=Int(bounds.height)
            config.minimumFrameInterval=CMTime(value:1,timescale:120);config.queueDepth=5;config.showsCursor=false
            config.pixelFormat=kCVPixelFormatType_32BGRA;config.capturesAudio=false
            config.ignoreShadowsSingleWindow=true
            stream=SCStream(filter:filter,configuration:config,delegate:frames)
            try stream!.addStreamOutput(frames,type:.screen,sampleHandlerQueue:DispatchQueue(label:"benchmark.frames"))
            try await stream!.startCapture();try await Task.sleep(nanoseconds:300_000_000)
        }
        var events:[[String:Double]]=[]
        let count=c["count"] as? Int ?? 54,delay=c["delayMs"] as? Double ?? 100
        var clipboard:[[NSPasteboard.PasteboardType:Data]]=[]
        var restoreClipboard=false
        defer{
            if restoreClipboard{
                NSPasteboard.general.clearContents()
                let items=clipboard.map{data -> NSPasteboardItem in let item=NSPasteboardItem();for(type,bytes)in data{item.setData(bytes,forType:type)};return item}
                NSPasteboard.general.writeObjects(items)
            }
        }
        if mode=="paste"{
            clipboard=NSPasteboard.general.pasteboardItems?.map{item in Dictionary(uniqueKeysWithValues:item.types.compactMap{type in item.data(forType:type).map{(type,$0)}})} ?? []
            NSPasteboard.general.clearContents();NSPasteboard.general.setString(c["text"] as! String,forType:.string)
            restoreClipboard=true
        }
        let start=CACurrentMediaTime()
        for i in 0..<count{
            let target=start+Double(i)*delay/1000
            let remaining=target-CACurrentMediaTime()
            if remaining>0{try await Task.sleep(nanoseconds:UInt64(remaining*1e9))}
            let t=CACurrentMediaTime()
            if mode=="paste"{try post(inputPort,1,["time":t,"command":1])}
            else if mode=="scroll"{
                try post(inputPort,3,["time":t,"x":roi.midX,"y":bounds.minY+roi.midY,"delta":i<count/2 ? -40 : 40])
            }else{try post(inputPort,1,["time":t]);try post(inputPort,2,["time":t])}
            events.append(["index":Double(i+1),"time":t])
        }
        try await Task.sleep(nanoseconds:delay<50 ? 2_000_000_000 : 1_000_000_000)
        if let stream{try await stream.stopCapture()}
        let samples=frames.snapshot()
        if captured && samples.isEmpty{throw ImportFailure(description:"No complete captured frames; check that the screen is unlocked")}
        if captured && c["debug"] as? Bool == true && frames.baselineWidth>0 && frames.lastHeight>0{
            let image=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:frames.baselineWidth,pixelsHigh:frames.lastHeight,bitsPerSample:8,samplesPerPixel:3,hasAlpha:false,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:frames.baselineWidth*3,bitsPerPixel:24)!
            frames.lastPixels.withUnsafeBytes{bytes in image.bitmapData!.update(from:bytes.baseAddress!.assumingMemoryBound(to:UInt8.self),count:bytes.count)}
            try image.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:args[2]+".png"))
        }
        var result:[String:Any]=["events":events,"frames":samples,"incompleteFrames":frames.incomplete,"captured":captured,"foregroundPID":foreground,"inputDriver":"shared native NSEvent receiver targeted to owned window via CFMessagePort", "wallClockOffset":Date().timeIntervalSince1970-CACurrentMediaTime(),"windowBounds":["x":bounds.minX,"y":bounds.minY,"width":bounds.width,"height":bounds.height],"durationMs":(CACurrentMediaTime()-start)*1000]
        var usage=rusage()
        getrusage(RUSAGE_SELF,&usage)
        let cpuSeconds=Double(usage.ru_utime.tv_sec+usage.ru_stime.tv_sec)+Double(usage.ru_utime.tv_usec+usage.ru_stime.tv_usec)/1e6
        result["driverResources"]=["cpuSeconds":cpuSeconds,"cpuPercent":cpuSeconds/(CACurrentMediaTime()-processStart)*100,"peakRSSMiB":Double(usage.ru_maxrss)/1048576]
        result["captureStatusCounts"]=Dictionary(uniqueKeysWithValues:frames.statuses.map{(String($0.key),$0.value)})
        if let failure=frames.failure{result["captureError"]=failure}
        if captured && mode=="type"{
            let finalInk=samples.suffix(10).map{$0["ink"]!}.max() ?? 0
            let perCharacter=max(1,finalInk/Double(count))
            var responses:[Double]=[]
            for event in events{
                if let frame=samples.first(where:{ $0["time"]!>=event["time"]! && floor($0["ink"]!/perCharacter+0.10)>=event["index"]! }){
                    responses.append((frame["time"]!-event["time"]!)*1000)
                }
            }
            let intervals=zip(samples.dropFirst(),samples).map{($0["time"]!-$1["time"]!)*1000}.filter{$0>0 && $0<200}
            result["responseMs"]=responses;result["medianMs"]=percentile(responses,0.5);result["p95Ms"]=percentile(responses,0.95)
            result["captureIntervalMedianMs"]=percentile(intervals,0.5);result["captureIntervalP95Ms"]=percentile(intervals,0.95)
            result["finalInk"]=finalInk;result["detectedCharacters"]=responses.count
            result["distinctInkSteps"]=Set(samples.map{Int(floor($0["ink"]!/perCharacter+0.10))}).count
        }
        if captured && mode=="paste"{
            if let changed=samples.first(where:{$0["time"]!>=start && $0["ink"]!>20}){result["firstChangeMs"]=(changed["time"]!-start)*1000}
        }
        if captured && mode=="scroll"{
            let active=samples.filter{$0["time"]!>=start && $0["time"]!<events.last!["time"]!}
            let gaps=zip(active.dropFirst(),active).map{($0["time"]!-$1["time"]!)*1000}
            result["frameGapMedianMs"]=percentile(gaps,0.5);result["frameGapP95Ms"]=percentile(gaps,0.95);result["maxFrameGapMs"]=gaps.max()
        }
        try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:args[2]))
    }
}
struct ImportFailure:Error,CustomStringConvertible{let description:String}
