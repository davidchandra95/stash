import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { setup, snapshot, refreshBridge, sleep, command, here, root, runningCommands } from './common.mjs'
import { analyze } from './analyze.mjs'
import { totals } from './resources.mjs'

const value=flag=>{const i=process.argv.indexOf(flag);return i<0?undefined:process.argv[i+1]}
const dir=await setup(value('--run-dir'))
const stage=value('--stage')??'full'
let baselineConfig
try{baselineConfig=JSON.parse(await readFile(join(dir,'baseline-config.json'),'utf8'))}catch{}
let sequence=0
const waiting=new Map(), queued=new Map(), replies=new Map()
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*')
  if(req.method==='OPTIONS'){res.end();return}
  const url=new URL(req.url,'http://localhost')
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','application/json');res.end(await readFile(join(dir,'fixture.json')));return}
  if(url.pathname==='/command'){
    const client=url.searchParams.get('client')
    const next=queued.get(client)?.shift()
    if(next){res.end(JSON.stringify(next));return}
    waiting.set(client,res)
    res.on('close',()=>{if(waiting.get(client)===res)waiting.delete(client)})
    return
  }
  if(url.pathname==='/response'){
    let body='';for await(const part of req)body+=part
    const message=JSON.parse(body),reply=replies.get(message.id)
    if(reply){replies.delete(message.id);clearTimeout(reply.timer);message.result.error?reply.reject(Error(message.result.error)):reply.resolve(message.result)}
    res.end('ok');return
  }
  res.statusCode=404;res.end()
})
await new Promise(resolve=>server.listen(baselineConfig?.port??0,'127.0.0.1',resolve))
const port=server.address().port
async function send(client,body){
  const id=++sequence,c={...body,id}
  const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{replies.delete(id);reject(Error(`Control timeout: ${client} ${body.action}`))},60000);replies.set(id,{resolve,reject,timer})})
  const res=waiting.get(client)
  if(res){waiting.delete(client);res.end(JSON.stringify(c))}else{const list=queued.get(client)??[];list.push(c);queued.set(client,list)}
  return promise
}
const apps={}
let awake
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  for(const child of Object.values(apps))child.kill('SIGTERM')
  for(const child of runningCommands)child.kill('SIGTERM')
  awake?.kill('SIGTERM')
  for(const res of waiting.values())res.end('{}')
  server.close();process.exit(130)
})
async function drive(client,body,name){
  const config=join(dir,`${name}.input.json`),output=join(dir,`${name}.json`)
  await writeFile(config,JSON.stringify({pid:apps[client].pid,...body}))
  await command(join(dir,'CaptureDriver'),[config,output],{stdio:['ignore','ignore','inherit']})
  return JSON.parse(await readFile(output,'utf8'))
}
let appPath=join(dir,'target/release/bundle/macos/Stash Editor Benchmark.app/Contents/MacOS/upnote2')
try{
  try{await access(appPath)}catch{appPath=await snapshot(dir,port)}
  await refreshBridge(dir,port)
  const buildFiles={}
  for(const name of ['Importer.swift','main.swift','OwnedInput.swift','Driver.swift','stash-bridge.ts','benchmark_processes.rs','benchmark.mjs','common.mjs','analyze.mjs','resources.mjs','freeze.py'])buildFiles[name]=createHash('sha256').update(await readFile(join(here,name))).digest('hex')
  for(const [name,path]of [['native',join(dir,'NativeEditor')],['inputReceiver',join(dir,'libStashNativeBenchInput.dylib')],['captureDriver',join(dir,'CaptureDriver')],['stash',appPath]])buildFiles[name]=createHash('sha256').update(await readFile(path)).digest('hex')
  const buildManifest={startedAt:new Date().toISOString(),finishedAt:null,sourceSnapshot:JSON.parse(await readFile(join(dir,'source-manifest.json'),'utf8')).sha256,buildFiles,native:'swiftc -swift-version 5 -O',stash:'tauri build --bundles app; Cargo release optimized; frozen current working-tree files (tracked and untracked, gitignore respected)',stage}
  await writeFile(join(dir,'build-manifest.json'),JSON.stringify(buildManifest,null,2))
  console.log(`Benchmark directory: ${dir}`)
  if(stage==='prepare'){server.close();process.exit(0)}
  awake=spawn('caffeinate',['-d','-i'],{stdio:'ignore'})
  await writeFile(join(dir,'screen-status.input.json'),JSON.stringify({pid:0,mode:'screen-status'}))
  await command(join(dir,'CaptureDriver'),[join(dir,'screen-status.input.json'),join(dir,'screen-status.json')],{stdio:'ignore'})
  const screen=JSON.parse(await readFile(join(dir,'screen-status.json'),'utf8'))
  if(screen.screenLocked && stage!=='input-checks')throw Error('The Mac is locked. Unlock it before running the benchmark.')
  if(!screen.captureAllowed)throw Error('Screen capture permission is required for the benchmark driver.')
  const nativeLaunch=spawn('open',['-n','-W',join(dir,'Stash Native Editor.app'),'--args','--fixture',join(dir,'fixture.json'),'--port',String(port)],{stdio:['ignore','ignore','inherit']})
  apps.stash=spawn(appPath,[],{stdio:['ignore','ignore','inherit']})
  const nativeInfo=await send('native',{action:'init'})
  apps.native={pid:nativeInfo.pid,kill:signal=>{try{process.kill(nativeInfo.pid,signal)}catch{}}}
  const stashInfo=await send('stash',{action:'init'})
  await send('stash',{action:'register-input',path:join(dir,'libStashNativeBenchInput.dylib')})
  const environment={nativeInfo,stashInfo,macOS:execFileSync('sw_vers').toString(),hardware:execFileSync('system_profiler',['SPHardwareDataType','SPDisplaysDataType','-detailLevel','mini']).toString(),swift:execFileSync('xcrun',['swift','--version']).toString()}
  environment.hardware=environment.hardware.split('\n').filter(line=>!/Serial Number|UUID|UDID/.test(line)).join('\n')
  environment.appearance=JSON.parse(await readFile(join(dir,'fixture.json'),'utf8')).appearance
  environment.backgroundProcesses=execFileSync('ps',['-axo','pcpu=,comm=']).toString().split('\n').map(line=>line.trim()).filter(Boolean).sort((a,b)=>parseFloat(b)-parseFloat(a)).slice(0,12)
  await writeFile(join(dir,'environment.json'),JSON.stringify(environment,null,2))
  console.log('Both editors ready',JSON.stringify({engine:nativeInfo.engine,nodes:nativeInfo.counts,marks:nativeInfo.marks,warnings:nativeInfo.warnings}))
  const helperPIDs=(await send('stash',{action:'processes'})).pids
  if(helperPIDs.length<2)throw Error('WebKit renderer/GPU process attribution missing')
  const cohorts={native:{members:[apps.native.pid]},stash:{members:[apps.stash.pid,...helperPIDs],evidence:'Read-only WKWebView and website data store diagnostic process identifiers'}}
  await writeFile(join(dir,'process-cohorts.json'),JSON.stringify(cohorts,null,2))
  await command(join(dir,'NativeEditor'),['--fixture',join(dir,'fixture.json'),'--validate'],{stdio:'inherit'})
  await writeFile(join(dir,'editing-validation.json'),JSON.stringify(await send('native',{action:'editing-check'}),null,2))
  const conditions=['native','stash-paused','stash-autosave']
  const rows=[]
  const sizes=stage==='full'?[[1320,880],[1800,1129]]:[[1320,880]]
  const positions=['checks','input-checks'].includes(stage)?[]:stage==='smoke'?['top']:stage==='probe'?['middle','bottom']:['top','middle','bottom']
  const repetitions=stage==='full'?5:1
  const calibration=[]
  for(const client of ['checks','input-checks'].includes(stage)?[]:['native','stash']){
    const reference=await send('stash',{action:'prepare',position:'top',paused:true,control:true})
    const prepared=client==='native'?await send('native',{action:'prepare',position:'top',control:true,viewport:reference.viewport,textWidth:reference.viewport.textWidth}):reference
    const idle=await drive(client,{mode:'idle',roi:prepared.roi,count:0},`calibration-idle-${client}`)
    if(idle.frames.length<10)throw Error('Idle capture calibration missing complete frames')
    if(idle.frames.some(f=>f.rightmostInk>0))throw Error('Caret-only frame detector fired')
    const captured=await drive(client,{mode:'type',roi:prepared.roi,count:54,delayMs:100},`calibration-${client}`)
    const verified=await send(client,{action:'check',text:'x'.repeat(54),undo:true})
    const analyzed=analyze(captured,verified.advance)
    analyzed.inputUpdateTimes=verified.inputTimes??verified.inputWallTimes?.map(t=>t-analyzed.wallClockOffset)
    if(analyzed.inputUpdateTimes?.length!==54)throw Error('Input callback calibration count differs')
    for(let i=0;i<54;i++)if(analyzed.events[i].time+analyzed.responseMs[i]/1000<analyzed.inputUpdateTimes[i]-.004)throw Error('Capture detector reported a glyph before its input update')
    await writeFile(join(dir,`calibration-${client}.json`),JSON.stringify(analyzed,null,2))
    calibration.push({client,medianMs:analyzed.medianMs,p95Ms:analyzed.p95Ms,steps:analyzed.distinctGlyphSteps,frameIntervalMs:analyzed.captureIntervalMedianMs})
  }
  await writeFile(join(dir,'calibration.json'),JSON.stringify(calibration,null,2))
  for(const client of ['checks','input-checks'].includes(stage)?[]:['stash','native']){
    const reference=await send('stash',{action:'prepare',position:'top',paused:true})
    const prepared=client==='native'?await send('native',{action:'prepare',position:'top',viewport:reference.viewport,textWidth:reference.viewport.textWidth}):reference
    await drive(client,{mode:'idle',roi:{x:0,y:0,width:1320,height:880},count:0,debug:true},`visual-${client}`)
  }
  for(const [width,height]of sizes){
    const resizeResults={}
    for(const client of ['stash','native']){
      await send(client,{action:'resize',width,height})
      if(stage==='input-checks')continue
      resizeResults[client]=await drive(client,{mode:'window-info'},`resize-${width}-${client}`)
      const b=resizeResults[client].kCGWindowBounds
      if(b.Width!==width || b.Height!==height)throw Error(`Window size differs: ${client} ${JSON.stringify(b)}`)
    }
    for(let trial=0;trial<repetitions;trial++){
      for(const position of positions){
        for(const delayMs of (stage==='smoke'?[100]:stage==='probe'?[30]:[100,30])){
          // Native goes first on even trials; Stash goes first on odd trials.
          for(const condition of (trial%2?[...conditions].reverse():conditions)){
            const client=condition==='native'?'native':'stash',paused=condition!=='stash-autosave'
            const reference=await send('stash',{action:'prepare',position,paused:true})
            let prepared=reference
            if(client==='native')prepared=await send('native',{action:'prepare',position,viewport:reference.viewport,textWidth:reference.viewport.textWidth,viewportHeight:reference.viewport.height})
            else if(!paused)prepared=await send('stash',{action:'prepare',position,paused:false})
            await sleep(300)
            if(client==='native')prepared.roi=(await send('native',{action:'geometry'})).roi
            const name=`typing-${width}-${position}-${delayMs}-${trial}-${condition}`
            const resourcesBefore=totals(cohorts[client].members),captureStart=performance.now()
            let capture=await drive(client,{mode:'type',roi:prepared.roi,count:54,delayMs,debug:stage==='smoke'},name)
            const resourcesAfter=totals(cohorts[client].members),captureElapsedSeconds=(performance.now()-captureStart)/1000
            const check=await send(client,{action:'check',text:'x'.repeat(54),undo:true})
            if(client==='native' && Math.abs(check.caretY-prepared.roi.y)>2)throw Error(`Native caret moved during typing: ${prepared.roi.y} to ${check.caretY}`)
            capture=analyze(capture,check.advance)
            capture.inputUpdateTimes=check.inputTimes??check.inputWallTimes?.map(t=>t-capture.wallClockOffset)
            if(capture.inputUpdateTimes?.length!==54)throw Error('Long-note input callback count differs: '+name)
            for(let i=0;i<54;i++)if(capture.events[i].time+capture.responseMs[i]/1000<capture.inputUpdateTimes[i]-.004)throw Error('Long-note detector reported a glyph before its input update: '+name)
            await writeFile(join(dir,name+'.json'),JSON.stringify(capture,null,2))
            const row={condition,width,height,position,delayMs,trial,prepared,check,medianMs:capture.medianMs,p95Ms:capture.p95Ms,detectedCharacters:capture.detectedCharacters,captureIntervalMedianMs:capture.captureIntervalMedianMs,captureIntervalP95Ms:capture.captureIntervalP95Ms,distinctInkSteps:capture.distinctInkSteps,captureAppCPUPercent:(resourcesAfter.cpuSeconds-resourcesBefore.cpuSeconds)/captureElapsedSeconds*100,driverResources:capture.driverResources,raw:`${name}.json`}
            if(capture.detectedCharacters!==54)throw Error('Missing captured character responses: '+name)
            rows.push(row);await writeFile(join(dir,'typing-summary.json'),JSON.stringify(rows,null,2))
            console.log(JSON.stringify({condition,width,position,delayMs,trial,medianMs:row.medianMs,p95Ms:row.p95Ms,steps:row.distinctInkSteps}))
          }
        }
      }
    }
    if(stage!=='smoke'){
      for(let trial=0;trial<repetitions;trial++)for(const condition of (trial%2?[...conditions].reverse():conditions)){
        const client=condition==='native'?'native':'stash'
        const reference=await send('stash',{action:'prepare',position:'top',paused:condition!=='stash-autosave'})
        const prepared=client==='native'?await send('native',{action:'prepare',position:'top',viewport:reference.viewport,textWidth:reference.viewport.textWidth,viewportHeight:reference.viewport.height}):reference
        const paste=('paste sample text ').repeat(610).slice(0,10240)
        const pasted=await drive(client,{mode:'paste',roi:prepared.roi,count:1,delayMs:100,text:paste,capture:stage!=='input-checks'},`paste-${width}-${trial}-${condition}`)
        const check=await send(client,{action:'check',text:paste})
        const reference2=await send('stash',{action:'prepare',position:'top',paused:condition!=='stash-autosave'})
        const prepared2=client==='native'?await send('native',{action:'prepare',position:'top',viewport:reference2.viewport,textWidth:reference2.viewport.textWidth,viewportHeight:reference2.viewport.height}):reference2
        const scrolling=await drive(client,{mode:'scroll',roi:{...prepared2.roi,width:Math.max(prepared2.roi.width,300),height:150},count:160,delayMs:16.67,capture:stage!=='input-checks'},`scroll-${width}-${trial}-${condition}`)
        const scrollCheck=await send(client,{action:'scroll-check'})
        rows.push({condition,width,trial,kind:'paste-scroll',pasteFirstChangeMs:pasted.firstChangeMs,check,scrollCheck,scrollMedianMs:scrolling.frameGapMedianMs,scrollP95Ms:scrolling.frameGapP95Ms,maxScrollGapMs:scrolling.maxFrameGapMs})
        await writeFile(join(dir,'summary.json'),JSON.stringify(rows,null,2))
        if(trial>=3)continue
        const reference3=await send('stash',{action:'prepare',position:'top',paused:condition!=='stash-autosave'})
        const prepared3=client==='native'?await send('native',{action:'prepare',position:'top',viewport:reference3.viewport,textWidth:reference3.viewport.textWidth}):reference3
        const before=totals(cohorts[client].members),start=performance.now()
        await drive(client,{mode:'type',roi:prepared3.roi,count:54,delayMs:100,capture:false},`resources-${width}-${trial}-${condition}`)
        const verified=await send(client,{action:'check',text:'x'.repeat(54)})
        const after=totals(cohorts[client].members),elapsedSeconds=(performance.now()-start)/1000
        rows.push({condition,width,trial,kind:'resources',verified,before,after,elapsedSeconds,cpuPercent:(after.cpuSeconds-before.cpuSeconds)/elapsedSeconds*100})
        await writeFile(join(dir,'summary.json'),JSON.stringify(rows,null,2))
      }
    }
  }
  await writeFile(join(dir,'summary.json'),JSON.stringify(rows,null,2))
  buildManifest.finishedAt=new Date().toISOString()
  await writeFile(join(dir,'build-manifest.json'),JSON.stringify(buildManifest,null,2))
  console.log(`Completed ${rows.length} comparisons. Results: ${dir}`)
  if(stage==='full')await command(process.execPath,[join(here,'report.mjs'),dir,join(dir,'report')])
}finally{
  awake?.kill('SIGTERM')
  for(const child of Object.values(apps))child.kill('SIGTERM')
  for(const res of waiting.values())res.end('{}')
  server.close()
}
