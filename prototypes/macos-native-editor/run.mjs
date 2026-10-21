import { setup } from './common.mjs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
const dir=await setup(process.argv[2])
console.log(`Private fixture and executable: ${dir}`)
const app=spawn('open',['-n','-W',join(dir,'Stash Native Editor.app'),'--args','--fixture',join(dir,'fixture.json')],{stdio:'inherit'})
await new Promise(resolve=>app.on('exit',resolve))
