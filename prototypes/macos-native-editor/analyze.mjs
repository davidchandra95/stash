export const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
// Each trial uses repeated X glyphs on one line. Use measured caret advance,
// not ink area: the disappearing initial caret otherwise biases the first glyph.
export function analyze(capture,advance,count=54){
  const finalRight=Math.max(...capture.frames.slice(-10).map(f=>f.rightmostInk))
  if(!(advance>0) || finalRight<(count-1)*advance)throw Error('Benchmark line wrapped or ROI clipped')
  const responses=capture.events.map(e=>{
    const threshold=finalRight-(count-e.index)*advance-1
    const frame=capture.frames.find(f=>f.time>=e.time && f.rightmostInk>=threshold)
    if(!frame)throw Error('Glyph not observed')
    return (frame.time-e.time)*1000
  })
  const positive=capture.frames.filter(f=>f.time>=capture.events[0].time)
  const observed=positive.map(f=>Math.max(0,Math.min(count,Math.floor((f.rightmostInk-finalRight)/advance+count+0.12))))
  return {...capture,responseMs:responses,medianMs:percentile(responses,.5),p95Ms:percentile(responses,.95),detectedCharacters:responses.length,distinctGlyphSteps:new Set(observed).size,detector:'rightmost glyph ink with measured advance; thin caret runs excluded',advance}
}
