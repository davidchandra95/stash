import { execFileSync } from 'node:child_process'
export function processes(){
  return execFileSync('ps',['-axo','pid=,ppid=,rss=,time=,command=']).toString().split('\n').flatMap(line=>{
    const match=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d:.]+)\s+(.*)$/)
    if(!match)return[]
    const [,pid,ppid,rss,time,cmd]=match
    const parts=time.split(':').map(Number)
    const seconds=parts.reduce((sum,value)=>sum*60+value,0)
    return [{pid:+pid,ppid:+ppid,rssKiB:+rss,cpuSeconds:seconds,command:cmd}]
  })
}
export function totals(members){
  const rows=processes().filter(p=>members.includes(p.pid))
  return {rssMiB:rows.reduce((sum,p)=>sum+p.rssKiB/1024,0),cpuSeconds:rows.reduce((sum,p)=>sum+p.cpuSeconds,0),processes:rows}
}
