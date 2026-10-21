// Copied into a disposable source snapshot only, never imported by production.
import { library } from './storage/useLibrary'
import { getEditor } from './editor/session'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import { invoke } from '@tauri-apps/api/core'
const base='http://127.0.0.1:__PORT__'
let fixture: any, editor: any, before='', baseline='', prepareMs=0, caretStartX=0
let inputWallTimes:number[]=[]
let scrollStartY=0,scrollMaxY=0
document.addEventListener('input',e=>{if((e.target as HTMLElement)?.closest('.tiptap'))inputWallTimes.push(Date.now()/1000)},true)
document.addEventListener('scroll',e=>{if((e.target as HTMLElement)?.classList.contains('note-scroll'))scrollMaxY=Math.max(scrollMaxY,(e.target as HTMLElement).scrollTop)},true)
const wait = (ms:number)=>new Promise(r=>setTimeout(r,ms))
async function execute(c:any) {
  if (c.action==='init') {
    fixture=await (await fetch(base+'/fixture')).json()
    while (!library.getSnapshot().ready) await wait(100)
    library.setAppearance(fixture.appearance)
    library.setNotes([{id:fixture.id,title:fixture.title,text:fixture.text,content:fixture.content,notebookIds:[],tags:[],pinned:false,trashed:false,quickAccess:false,updated:Date.now()}])
    await library.flush()
    await library.activate(fixture.id)
    await wait(200)
    const slot=document.querySelector(`[data-note-slot-id="${fixture.id}"]`) as HTMLElement
    if (!slot) throw Error('Fixture row not mounted')
    const row=slot.querySelector('[role="button"],button') as HTMLElement
    ;(row??slot.firstElementChild as HTMLElement).click()
    while (!document.querySelector('.tiptap')) await wait(100)
    editor=getEditor(fixture.id,fixture.content)
    baseline=editor.getText()
    return {ready:true,characters:baseline.length}
  }
  if (!editor) throw Error('Initialize before issuing commands')
  if(c.action==='processes')return {pids:await invoke<number[]>('processes')}
  if(c.action==='register-input')return {registered:await invoke('register_input',{path:c.path})}
  if(c.action==='resize'){
    const window=getCurrentWindow(),outer=await window.outerSize(),inner=await window.innerSize(),scale=await window.scaleFactor()
    await window.setSize(new LogicalSize(c.width-(outer.width-inner.width)/scale,c.height-(outer.height-inner.height)/scale))
    await window.setPosition(new LogicalPosition(0,40))
    await wait(200)
    return {resized:true}
  }
  if (c.action==='prepare') {
    await library.flush()
    ;(globalThis as any).__benchmarkSavingPaused=!!c.paused
    const started=performance.now()
    const doc=c.control?{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Control paragraph'}]},{type:'paragraph',content:[{type:'text',text:'Second paragraph'}]}]}:structuredClone(fixture.content)
    const i=c.position==='top'?0:c.position==='middle'?Math.floor(doc.content.length/2):doc.content.length
    doc.content.splice(i,0,{type:'paragraph',attrs:{textAlign:null},content:[{type:'text',text:'BENCH '}]})
    const node=editor.schema.nodeFromJSON(doc)
    const importMs=performance.now()-started
    let pos=1
    for(let k=0;k<i;k++)pos+=node.child(k).nodeSize
    editor.view.updateState(EditorState.create({schema:editor.schema,plugins:editor.state.plugins,doc:node,selection:TextSelection.create(node,pos+6)}))
    library.patchNote(fixture.id,{content:doc,text:editor.getText()})
    await library.flush()
    editor.view.focus()
    editor.commands.scrollIntoView()
    await wait(150)
    before=editor.getText()
    inputWallTimes=[]
    scrollStartY=(document.querySelector('.note-scroll') as HTMLElement).scrollTop;scrollMaxY=scrollStartY
    prepareMs=performance.now()-started-150
    const rect=editor.view.coordsAtPos(pos+6)
    caretStartX=rect.left
    const lineHeight=parseFloat(getComputedStyle(editor.view.dom).lineHeight)
    const pane=document.querySelector('.note-scroll')!.getBoundingClientRect()
    const documentRect=editor.view.dom.getBoundingClientRect()
    return {roi:{x:rect.left+3,y:rect.top-2,width:Math.min(550,documentRect.right-rect.left-4),height:Math.max(rect.bottom-rect.top,lineHeight)+4},viewport:{x:pane.x,y:pane.y,width:pane.width,height:pane.height,textWidth:documentRect.width,topPadding:documentRect.top-pane.top+(document.querySelector('.note-scroll') as HTMLElement).scrollTop},colors:{ink:getComputedStyle(editor.view.dom).color,background:getComputedStyle(document.querySelector('.app')??document.body).backgroundColor},prepareMs,importMs,chars:before.length,baselineChars:baseline.length}
  }
  if(c.action==='check'){
    const text=editor.getText()
    const expected=before.replace('BENCH ','BENCH '+(c.text??''))
    if(text!==expected)throw Error(`Input verification failed: actual ${text.length}, expected ${expected.length}, selection ${editor.state.selection.from}`)
    const advance=c.text?.length?(editor.view.coordsAtPos(editor.state.selection.from).left-caretStartX)/c.text.length:0
    if(c.undo){
      editor.commands.undo()
      if(editor.getText()!==before)throw Error('Undo did not restore prepared text')
      editor.commands.redo()
      if(editor.getText()!==expected)throw Error('Redo did not restore typed text')
    }
    const t=performance.now();await library.flush()
    return {verified:true,saveFlushMs:performance.now()-t,status:library.getSnapshot().status,advance,inputWallTimes:inputWallTimes.slice(0,c.text?.length??0)}
  }
  if(c.action==='scroll-check'){
    if(scrollMaxY-scrollStartY<=100)throw Error('Stash scrolling did not move the viewport')
    return {verified:true,distance:scrollMaxY-scrollStartY,endY:(document.querySelector('.note-scroll') as HTMLElement).scrollTop}
  }
  if(c.action==='geometry'){
    const pane=document.querySelector('.note-scroll')!.getBoundingClientRect()
    const body=editor.view.dom.getBoundingClientRect()
    return {viewport:{width:pane.width,height:pane.height,textWidth:body.width},font:getComputedStyle(editor.view.dom).fontFamily,fontSize:getComputedStyle(editor.view.dom).fontSize,lineHeight:getComputedStyle(editor.view.dom).lineHeight}
  }
  if(c.action==='paste'){
    editor.commands.insertContent(c.text);return {inserted:true}
  }
  if(c.action==='status')return {ready:true,status:library.getSnapshot().status}
  throw Error('Unknown benchmark action '+c.action)
}
void (async()=>{
  for(;;){
    try{
      const c=await(await fetch(base+'/command?client=stash')).json()
      let result:any
      try{result=await execute(c)}catch(e){result={error:String(e)}}
      await fetch(base+'/response',{method:'POST',body:JSON.stringify({client:'stash',id:c.id,result})})
    }catch{await wait(500)}
  }
})()
