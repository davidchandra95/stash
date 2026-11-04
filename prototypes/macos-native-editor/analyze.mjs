export const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
// Each trial uses repeated X glyphs on one line. Use measured caret advance,
// not ink area: the disappearing initial caret otherwise biases the first glyph.
export function analyze(capture,advance,count=54){
  const finalRight=Math.max(...capture.frames.slice(-10).map(f=>f.rightmostInk))
  if(!(advance>0) || finalRight<(count-0.5)*advance)throw Error('Benchmark line wrapped, ROI clipped, or glyph too narrow to detect')
  const responses=capture.events.map(e=>{
    // Midpoint between adjacent glyph endpoints tolerates subpixel rounding.
    // Benchmark captures must suppress the caret so it cannot set finalRight.
    const threshold=finalRight-(count-e.index+0.5)*advance
    const frame=capture.frames.find(f=>f.time>=e.time && f.rightmostInk>=threshold)
    if(!frame)throw Error('Glyph not observed')
    return (frame.time-e.time)*1000
  })
  const positive=capture.frames.filter(f=>f.time>=capture.events[0].time)
  const observed=positive.map(f=>Math.max(0,Math.min(count,Math.floor((f.rightmostInk-finalRight)/advance+count+0.12))))
  return {...capture,responseMs:responses,medianMs:percentile(responses,.5),p95Ms:percentile(responses,.95),detectedCharacters:responses.length,distinctGlyphSteps:new Set(observed).size,detector:'rightmost ink, midpoint between glyph endpoints; caret suppressed',advance}
}
