/* ============================ STROKES & CHARACTER STRUCTURE ============================
   Two related features, both driven by data generated from Make Me a Hanzi (see
   licenses/NOTICE.md for licensing and attribution):

     1. Stroke order   -- animated writing demos + a "draw it yourself" quiz, rendered
                          by the vendored Hanzi Writer library (vendor/hanzi-writer.min.js).
     2. Decomposition  -- what a character is built from: its radical, its components,
                          and (where known) whether it's an ideographic or pictophonetic
                          compound. This is the part that makes 请/清/情/晴 legible as one
                          phonetic series instead of four unrelated shapes.

   Stroke geometry is NOT bundled into the main JS payload -- there are 655 characters at
   ~2.4KB each (1.4MB total), so shipping it all up front would triple the app's download
   for data most sessions never touch. Instead each character's JSON is fetched on first
   use from stroke-data/<codepoint>.json and then cached: in memory for this session, and
   on disk by the service worker's existing stale-while-revalidate handler (which is why
   these files are deliberately NOT in the worker's CORE_ASSETS precache list).

   Everything here degrades gracefully: if the library failed to load, or a character has
   no stroke file, the caller just gets nothing rendered rather than a thrown error. The
   app must stay fully usable with this whole feature missing.
*/

const STROKE_DATA_PATH = "stroke-data/";
// char -> Promise of that character's {strokes, medians}, so N writers for the same
// character on one screen still only produce one network request.
const strokeDataCache = new Map();

function strokesAvailable(){
  return typeof HanziWriter !== "undefined";
}
// Is there stroke data for this character? CHAR_DATA covers exactly the characters we
// generated stroke files for (plus their components, which may not have files) -- so
// this is a cheap pre-check to avoid rendering a panel that will come up empty.
function hasStrokeData(ch){
  return strokesAvailable() && !!(typeof CHAR_DATA !== "undefined" && CHAR_DATA[ch]);
}
function charsWithStrokes(word){
  return Array.from(word || "").filter(hasStrokeData);
}

function loadCharData(ch){
  if(strokeDataCache.has(ch)) return strokeDataCache.get(ch);
  const url = STROKE_DATA_PATH + ch.codePointAt(0).toString(16) + ".json";
  const p = fetch(url).then(res=>{
    if(!res.ok) throw new Error("no stroke data for " + ch);
    return res.json();
  });
  // Cache the promise (not the result) so concurrent callers share one request, but drop
  // it on failure so a transient network error doesn't poison the character forever.
  p.catch(()=> strokeDataCache.delete(ch));
  strokeDataCache.set(ch, p);
  return p;
}

// Hanzi Writer renders an SVG with hard-coded width/height attributes and NO viewBox,
// which means CSS can't scale it -- it would overflow a narrow phone and refuse to grow
// on a wide screen. Retrofitting a viewBox (and dropping the fixed attributes) makes the
// same drawing scale to whatever box CSS gives it, at no cost to stroke accuracy since
// the library's internal transforms stay in the original coordinate space.
function makeWriterResponsive(targetEl, size){
  const svg = targetEl.querySelector("svg");
  if(!svg) return;
  svg.setAttribute("viewBox", "0 0 " + size + " " + size);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.display = "block";
}

// Shared Hanzi Writer options: flat bold palette matching the rest of the app, with the
// radical picked out in red so the semantic component is visible at a glance.
function writerOptions(size, extra){
  return Object.assign({
    width: size,
    height: size,
    padding: 4,
    strokeColor: "#1D1D1B",
    radicalColor: "#E6313A",
    outlineColor: "#d8d5d0",
    drawingColor: "#0072E3",
    highlightColor: "#FFDB08",
    strokeAnimationSpeed: 1.1,
    delayBetweenStrokes: 180,
    charDataLoader: (ch, onComplete, onError)=>{
      loadCharData(ch).then(onComplete).catch(err=> onError && onError(err));
    }
  }, extra || {});
}

/* ---------------------------- Stroke-order demo panel ---------------------------- */
// Renders one animated writer per character of `word` into `container`, plus a single
// replay control that re-animates all of them in sequence. Returns the writer list.
function renderStrokePanel(container, word, opts){
  opts = opts || {};
  const size = opts.size || 92;
  const chars = charsWithStrokes(word);
  if(!chars.length){
    container.innerHTML = `<p class="muted" style="font-size:12.5px;">No stroke data available for this word.</p>`;
    return [];
  }
  container.innerHTML = `
    <div class="stroke-row" id="strokeRow"></div>
    <div class="stroke-controls">
      <button class="toggle-link" id="strokeReplay">▶ Replay stroke order</button>
      <button class="toggle-link" id="strokeOutline">Hide character</button>
    </div>
  `;
  const row = container.querySelector("#strokeRow");
  const writers = [];
  chars.forEach(ch=>{
    const cell = document.createElement("div");
    cell.className = "stroke-cell";
    const target = document.createElement("div");
    cell.appendChild(target);
    const cap = document.createElement("div");
    cap.className = "stroke-cell-cap";
    // Stroke count is genuinely useful (it's how characters are looked up in paper
    // dictionaries) and we get it free once the data resolves.
    cap.textContent = "";
    cell.appendChild(cap);
    row.appendChild(cell);
    const w = HanziWriter.create(target, ch, writerOptions(size));
    makeWriterResponsive(target, size);
    writers.push(w);
    loadCharData(ch).then(d=>{ cap.textContent = d.strokes.length + " strokes"; }).catch(()=>{});
  });

  // Animate each character in turn rather than all at once, so a 2-character word reads
  // left-to-right the way you'd actually write it.
  function animateAll(){
    let i = 0;
    const next = ()=>{
      if(i >= writers.length) return;
      const w = writers[i++];
      w.animateCharacter({ onComplete: ()=> setTimeout(next, 220) });
    };
    next();
  }
  container.querySelector("#strokeReplay").onclick = animateAll;
  let showing = true;
  container.querySelector("#strokeOutline").onclick = (e)=>{
    showing = !showing;
    writers.forEach(w=> showing ? w.showCharacter() : w.hideCharacter());
    e.target.textContent = showing ? "Hide character" : "Show character";
  };
  animateAll();
  return writers;
}

/* ---------------------------- Decomposition panel ---------------------------- */
// Ideographic Description Characters -- the layout operators in a decomposition string
// like "⿰讠青" (left-right). Stripped out to recover the component characters.
const IDC_CHARS = "⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻";
const IDC_LABEL = {
  "⿰":"left + right", "⿱":"top + bottom", "⿲":"left + middle + right",
  "⿳":"top + middle + bottom", "⿴":"surround", "⿵":"surround from above",
  "⿶":"surround from below", "⿷":"surround from left", "⿸":"surround upper-left",
  "⿹":"surround upper-right", "⿺":"surround lower-left", "⿻":"overlaid"
};
function charInfo(ch){
  return (typeof CHAR_DATA !== "undefined" && CHAR_DATA[ch]) || null;
}
function decompositionComponents(ch){
  const info = charInfo(ch);
  if(!info || !info.c) return [];
  return Array.from(info.c).filter(c => IDC_CHARS.indexOf(c) === -1 && c !== "？");
}
// One-line gloss for a component: "青 qīng — nature's color, blue, green".
function componentGloss(ch){
  const info = charInfo(ch);
  if(!info) return ch;
  const py = info.p ? " " + info.p : "";
  const def = info.d ? " — " + info.d : "";
  return ch + py + def;
}

// Renders radical / components / etymology for a single character. Returns false (and
// renders nothing) when we have no structural information worth showing.
function renderCharStructure(container, ch){
  const info = charInfo(ch);
  if(!info || (!info.c && !info.e && !info.r)) return false;
  const comps = decompositionComponents(ch);
  const layout = info.c ? Array.from(info.c).find(c => IDC_CHARS.indexOf(c) !== -1) : null;
  const et = info.e;

  let etymHtml = "";
  if(et && et.t === "pictophonetic" && (et.s || et.f)){
    // The single most useful thing to teach: which half carries meaning, which carries sound.
    etymHtml = `
      <div class="char-etym">
        <span class="etym-tag etym-semantic">meaning</span>
        <b>${et.s || "?"}</b>${et.h ? ` <span class="muted">(${et.h})</span>` : ""}
        <span class="etym-plus">+</span>
        <span class="etym-tag etym-phonetic">sound</span>
        <b>${et.f || "?"}</b>${et.f && charInfo(et.f) && charInfo(et.f).p ? ` <span class="muted">(${charInfo(et.f).p})</span>` : ""}
      </div>`;
  } else if(et && et.h){
    etymHtml = `<div class="char-etym"><span class="etym-tag">${et.t === "ideographic" ? "ideographic" : "origin"}</span> ${et.h}</div>`;
  }

  container.innerHTML = `
    <div class="char-struct">
      <div class="char-struct-head">
        <span class="char-struct-hanzi">${ch}</span>
        <span class="char-struct-meta">
          ${info.p ? `<span class="char-struct-py">${info.p}</span>` : ""}
          ${info.d ? `<span class="muted">${info.d}</span>` : ""}
        </span>
      </div>
      ${info.r ? `<div class="char-struct-row"><span class="cs-label">Radical</span> <b>${info.r}</b>${charInfo(info.r) && charInfo(info.r).d ? ` <span class="muted">— ${charInfo(info.r).d}</span>` : ""}</div>` : ""}
      ${comps.length ? `<div class="char-struct-row"><span class="cs-label">Parts</span> ${comps.map(c=>`<span class="comp-chip" data-comp="${c}" title="${componentGloss(c)}">${c}</span>`).join("")}${layout ? ` <span class="muted">(${IDC_LABEL[layout]||""})</span>` : ""}</div>` : ""}
      ${etymHtml}
      ${comps.length ? `<div class="comp-glosses">${comps.map(c=>`<div class="muted">${componentGloss(c)}</div>`).join("")}</div>` : ""}
    </div>
  `;
  return true;
}

// Renders structure for every character of a word (multi-char words get one block each).
function renderWordStructure(container, word){
  container.innerHTML = "";
  let any = false;
  Array.from(word || "").forEach(ch=>{
    if(!charInfo(ch)) return;
    const block = document.createElement("div");
    if(renderCharStructure(block, ch)){ container.appendChild(block); any = true; }
  });
  if(!any) container.innerHTML = `<p class="muted" style="font-size:12.5px;">No breakdown available for this word.</p>`;
  return any;
}

/* ---------------------------- Component index ----------------------------
   Reverse map component -> headword characters built from it, computed once on first
   use rather than stored, since it's derivable from CHAR_DATA in a few milliseconds.
   Powers "show me every word sharing this part", which is how phonetic series
   (请/清/情/晴) become visible. */
let _componentIndex = null;
function componentIndex(){
  if(_componentIndex) return _componentIndex;
  _componentIndex = {};
  if(typeof CHAR_DATA === "undefined") return _componentIndex;
  Object.keys(CHAR_DATA).forEach(ch=>{
    decompositionComponents(ch).forEach(comp=>{
      (_componentIndex[comp] = _componentIndex[comp] || []).push(ch);
    });
  });
  return _componentIndex;
}
// VOCAB indices whose headword contains any character built from `comp`.
function wordsWithComponent(comp){
  const chars = new Set(componentIndex()[comp] || []);
  chars.add(comp);
  const out = [];
  VOCAB.forEach((w, idx)=>{
    if(Array.from(w[0]).some(c => chars.has(c))) out.push(idx);
  });
  return out;
}
