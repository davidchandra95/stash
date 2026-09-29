import fixtureIcon from '../../src-tauri/icons/32x32.png?inline'
// Original writing samples, authored for this prototype. No personal UpNote content.
export const richWritingFixture = `
<p>Use this note to explore combinations. Try the rich writing features here.</p>
<section data-type="collapsible" data-collapsed="false">
 <div data-type="collapsibleHeader" style="background-color:#64ae7040">
  <h2><span data-type="inlineCheckbox" data-checked="false">☐</span> Garden journal <em>for autumn</em><br><a href="https://example.com/garden">A second header line</a> <img src="${fixtureIcon}" width="24" height="24" alt="Notebook icon"></h2>
 </div>
 <div data-type="collapsibleBody" style="background-color:#5b9cd420">
  <blockquote style="background-color:#a885cc30"><p>A small experiment can hold many ideas.</p>
   <table><tbody><tr><th><p>Plant</p></th><th><p>Next step</p></th></tr>
   <tr><td style="background-color:#64ae7040"><h3><strong>Basil</strong> <span data-type="inlineCheckbox" data-checked="true">☑</span></h3><p><span style="color:#387342">Morning light</span> <img src="${fixtureIcon}" width="24" height="24" alt="Notebook icon in a cell"></p></td>
   <td><ul data-type="mixedList"><li data-kind="number"><p>Water</p></li><li data-kind="task" data-checked="false"><p>Check soil</p></li><li data-kind="number"><p>Record growth</p><ul><li><p>Use the same ruler</p></li></ul></li></ul></td></tr>
   <tr><td colspan="2"><p style="text-align:center"><mark data-color="#e3d84a45" style="background-color:#e3d84a45">One shared observation</mark></p></td></tr></tbody></table>
  </blockquote>
  <section data-type="collapsible" data-collapsed="false"><div data-type="collapsibleHeader"><blockquote><p>A quote inside a nested header</p></blockquote><ul><li><p>And a header list</p></li></ul></div><div data-type="collapsibleBody"><p>The inner body ends here.</p></div></section>
  <p>This line follows the inner section and remains visible when that section closes.</p>
 </div>
</section>
<p>This paragraph is outside both sections. Closing them never hides it.</p>
<h2>Combined formatting</h2><p><a href="https://example.com"><strong><em><span style="color:#7655ae">A colored, bold, italic link</span></em></strong></a>, H<sub>2</sub>O, x<sup>2</sup>, and <code>inline code</code>.</p>
<pre><code class="language-typescript">const observation = { day: 1, leaves: 4 }\n\n// Enter stays inside this block. Cmd+Enter exits.</code></pre><p></p>`
