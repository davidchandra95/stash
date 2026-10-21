import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { mkdir, mkdtemp, readFile, writeFile, copyFile, symlink, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { statSync } from 'node:fs'
export const here = dirname(fileURLToPath(import.meta.url))
export const root = join(here, '../..')
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export const runningCommands=new Set()
export async function command(cmd, args, options = {}) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...options })
  runningCommands.add(child)
  try{await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })}finally{runningCommands.delete(child)}
}
export async function setup(existing) {
  const dir = existing ?? await mkdtemp(join(tmpdir(), 'stash-native-editor-'))
  await mkdir(dir,{recursive:true})
  try { await access(join(dir,'fixture.json')) }
  catch { await command('python3',[join(here,'freeze.py'),dir]) }
  await command('xcrun',['swiftc','-swift-version','5','-O',join(here,'Importer.swift'),join(here,'OwnedInput.swift'),join(here,'main.swift'),'-o',join(dir,'NativeEditor')])
  await command('xcrun',['swiftc','-swift-version','5','-O','-emit-library',join(here,'OwnedInput.swift'),'-o',join(dir,'libStashNativeBenchInput.dylib')])
  await command('xcrun',['swiftc','-swift-version','5','-O','-parse-as-library',join(here,'Driver.swift'),'-o',join(dir,'CaptureDriver')])
  const app=join(dir,'Stash Native Editor.app/Contents')
  await mkdir(join(app,'MacOS'),{recursive:true})
  await copyFile(join(dir,'NativeEditor'),join(app,'MacOS/NativeEditor'))
  await writeFile(join(app,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>NativeEditor</string><key>CFBundleIdentifier</key><string>local.stash.native-editor.benchmark</string><key>CFBundleName</key><string>Stash Native Editor</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>NSHighResolutionCapable</key><true/><key>LSMinimumSystemVersion</key><string>15.0</string></dict></plist>`)
  return dir
}
export async function snapshot(dir, port) {
  const source = join(dir,'source')
  await mkdir(source,{recursive:true})
  // Mirror the working tree: include untracked sources, skip tracked files deleted locally.
  const files = execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root}).toString().split('\0').filter(Boolean)
    .filter(path => { try { return statSync(join(root,path)).isFile() } catch { return false } })
  const hash = createHash('sha256'); const records = []
  for (const path of files) {
    const data = await readFile(join(root,path))
    const digest = createHash('sha256').update(data).digest('hex')
    hash.update(`${path}\0${digest}\n`); records.push({path,sha256:digest})
    await mkdir(dirname(join(source,path)),{recursive:true}); await copyFile(join(root,path),join(source,path))
  }
  await symlink(join(root,'node_modules'),join(source,'node_modules'))
  await writeFile(join(dir,'source-manifest.json'),JSON.stringify({sha256:hash.digest('hex'),files:records},null,2))
  // All instrumentation lives in this disposable source snapshot.
  const bridge = (await readFile(join(here,'stash-bridge.ts'),'utf8')).replaceAll('__PORT__',String(port))
  await writeFile(join(source,'src/native-editor-benchmark.ts'),bridge)
  await writeFile(join(source,'src/main.tsx'),`import './native-editor-benchmark'\n`+await readFile(join(source,'src/main.tsx'),'utf8'))
  const libraryPath=join(source,'src/storage/library.ts')
  const library=await readFile(libraryPath,'utf8')
  const target='private enqueueNote(note: Note, hadSource: boolean) {'
  if (!library.includes(target)) throw Error('Save boundary changed; benchmark patch needs review')
  await writeFile(libraryPath,library.replace(target,`${target}\n    if ((globalThis as any).__benchmarkSavingPaused) return`))
  const config=JSON.parse(await readFile(join(source,'src-tauri/tauri.conf.json'),'utf8'))
  config.productName='Stash Editor Benchmark'
  config.identifier='local.upnote2.native-editor-benchmark.'+dir.split('-').at(-1).toLowerCase()
  config.bundle.active=true
  config.app.security.csp+=`;` // The generated bridge needs only its local control server.
  config.app.security.csp=config.app.security.csp.replace("connect-src 'self'",`connect-src http://127.0.0.1:${port} 'self'`)
  await writeFile(join(source,'src-tauri/tauri.conf.json'),JSON.stringify(config,null,2))
  await writeFile(join(dir,'baseline-config.json'),JSON.stringify({identifier:config.identifier,source,port},null,2))
  // APFS copy-on-write keeps compiler caches separate without copying gigabytes.
  await mkdir(join(dir,'target'),{recursive:true})
  await command('/bin/cp',['-cR',join(root,'src-tauri/target/release'),join(dir,'target/release')])
  await command(join(root,'node_modules/.bin/tauri'),['build','--bundles','app'],{cwd:source,env:{...process.env,CARGO_TARGET_DIR:join(dir,'target')}})
  return join(dir,'target/release/bundle/macos/Stash Editor Benchmark.app/Contents/MacOS/upnote2')
}
export async function refreshBridge(dir,port){
  const path=join(dir,'source/src/native-editor-benchmark.ts')
  const bridge=(await readFile(join(here,'stash-bridge.ts'),'utf8')).replaceAll('__PORT__',String(port))
  let changed=await readFile(path,'utf8')!==bridge
  await writeFile(path,bridge)
  const capabilities=join(dir,'source/src-tauri/capabilities')
  for(const name of await readdir(capabilities)){
    if(!name.endsWith('.json'))continue
    const file=join(capabilities,name),cap=JSON.parse(await readFile(file,'utf8'))
    if(cap.windows?.includes('main')){
      const needed=['core:window:allow-set-focus','core:window:allow-set-size','core:window:allow-set-position']
      const missing=needed.filter(p=>!cap.permissions.includes(p))
      if(missing.length){cap.permissions.push(...missing);await writeFile(file,JSON.stringify(cap,null,2));changed=true}
    }
  }
  const rustFile=join(dir,'source/src-tauri/src/benchmark_processes.rs')
  const rust=await readFile(join(here,'benchmark_processes.rs'),'utf8')
  try{if(await readFile(rustFile,'utf8')!==rust)changed=true}catch{changed=true}
  await writeFile(rustFile,rust)
  const libPath=join(dir,'source/src-tauri/src/lib.rs')
  let lib=await readFile(libPath,'utf8')
  if(!lib.includes('mod benchmark_processes;')){
    lib='mod benchmark_processes;\n'+lib.replace('tauri::generate_handler![','tauri::generate_handler![\n            benchmark_processes::processes,')
    await writeFile(libPath,lib);changed=true
  }
  if(!lib.includes('benchmark_processes::register_input,')){
    lib=lib.replace('benchmark_processes::processes,','benchmark_processes::processes,\n            benchmark_processes::register_input,')
    await writeFile(libPath,lib);changed=true
  }
  if(!changed)return
  await command(join(root,'node_modules/.bin/tauri'),['build','--bundles','app'],{cwd:join(dir,'source'),env:{...process.env,CARGO_TARGET_DIR:join(dir,'target')}})
}
