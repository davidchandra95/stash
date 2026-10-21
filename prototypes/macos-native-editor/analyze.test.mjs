import test from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze.mjs'

test('maps each input to the first captured glyph, including a coalesced frame',()=>{
  const capture={events:[{index:1,time:10},{index:2,time:10.1},{index:3,time:10.2}],frames:[
    {time:9.99,rightmostInk:0},{time:10.016,rightmostInk:5},
    {time:10.12,rightmostInk:25},{time:10.22,rightmostInk:35},
  ]}
  // The first early frame is not wide enough for even one expected glyph.
  const result=analyze(capture,10,3)
  assert.deepEqual(result.responseMs.map(x=>Math.round(x)),[120,20,20])
  assert.equal(Math.round(result.p95Ms),120)
  assert.equal(result.detectedCharacters,3)
})
test('rejects a wrapped or clipped line rather than publishing false timing',()=>{
  assert.throws(()=>analyze({events:[{index:1,time:10}],frames:[{time:10.02,rightmostInk:10}]},10,54),/wrapped or ROI clipped/)
})
test('rejects missing glyphs rather than silently omitting slow inputs',()=>{
  const capture={events:[{index:1,time:10},{index:2,time:11},{index:3,time:12}],frames:[{time:10.1,rightmostInk:30}]}
  assert.throws(()=>analyze(capture,10,3),/Glyph not observed/)
})
