/* ============================ TTS ============================ */
// Voice quality varies a lot by OS/browser. Chrome ships high-quality Google
// network voices ("Google 普通话（中国大陆）"); Edge/Windows ship Microsoft
// neural voices (Xiaoxiao, Yunxi, Yaoyao...); Safari/macOS ship Meijia/Tingting.
// We rank whatever is actually installed and default to the best match, but
// also expose a picker since the "best" voice differs per machine.
const VOICE_RANK = [
  "Google 普通话（中国大陆）", "Google Chinese (Mandarin)", "Google 國語（臺灣）",
  "Microsoft Xiaoxiao Online", "Microsoft Yunxi Online", "Microsoft Xiaoyi Online",
  "Xiaoxiao", "Yunxi", "Yunjian", "Xiaoyi",
  "Tingting", "Ting-Ting", "Mei-Jia", "Meijia", "Sin-ji",
  "Microsoft Yaoyao", "Microsoft Kangkang", "Microsoft Huihui"
];
let zhVoices = [];
let zhVoice = null;
const VOICE_PREF_KEY = "hsk3_voice_pref";

function scoreVoice(v){
  const idx = VOICE_RANK.findIndex(name => v.name.includes(name));
  if(idx !== -1) return 1000 - idx;
  if(v.lang === "zh-CN") return 10;
  if(v.lang && v.lang.startsWith("zh")) return 5;
  return 0;
}
function pickVoice(){
  const voices = speechSynthesis.getVoices();
  zhVoices = voices.filter(v=>v.lang && v.lang.toLowerCase().startsWith("zh"));
  zhVoices.sort((a,b)=>scoreVoice(b)-scoreVoice(a));
  const saved = localStorage.getItem(VOICE_PREF_KEY);
  const savedVoice = saved ? zhVoices.find(v=>v.name===saved) : null;
  zhVoice = savedVoice || zhVoices[0] || null;
  refreshVoiceSelect();
}
if("speechSynthesis" in window){
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
  // Mobile Safari/Chrome-on-iOS (WebKit under the hood either way) sometimes never
  // fires voiceschanged and just populates getVoices() lazily a moment after the
  // page loads, or only after the first tap -- a few delayed retries and one retry
  // on first touch cost nothing and catch both cases without needing user action.
  [300, 1000, 2500].forEach(ms=> setTimeout(pickVoice, ms));
  document.addEventListener("touchend", pickVoice, {once:true, passive:true});
  // iOS blocks the very first speechSynthesis.speak() call of a page's lifetime
  // unless it's inside a real user-gesture handler; a silent one-word "unlock"
  // utterance fired on the first tap anywhere satisfies that for the rest of the
  // session, so later auto-play (e.g. a new flashcard appearing after grading)
  // isn't silently dropped just because that particular call wasn't itself a tap.
  const unlockSpeech = ()=>{
    document.removeEventListener("touchend", unlockSpeech);
    document.removeEventListener("click", unlockSpeech);
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    speechSynthesis.speak(u);
  };
  document.addEventListener("touchend", unlockSpeech, {once:true, passive:true});
  document.addEventListener("click", unlockSpeech, {once:true});
}
function refreshVoiceSelect(){
  const sel = document.getElementById("voiceSelect");
  if(!sel) return;
  sel.innerHTML = zhVoices.map(v=>`<option value="${encodeURIComponent(v.name)}" ${zhVoice && v.name===zhVoice.name?"selected":""}>${v.name} (${v.lang})</option>`).join("")
    || `<option>No Chinese voice found on this device</option>`;
}
function setVoiceByName(name){
  const v = zhVoices.find(v=>v.name===name);
  if(v){ zhVoice = v; localStorage.setItem(VOICE_PREF_KEY, name); }
}
function speak(text, opts){
  if(!("speechSynthesis" in window)) { alert("Your browser doesn't support speech synthesis."); return; }
  // opts is additive/optional: {onstart, onend, cancelFirst}. Existing call sites that
  // pass no second argument keep behaving exactly as before (cancel-then-speak, no
  // callbacks). Used by the story-reader audiobook playback bar to chain sentences
  // and track elapsed time via real utterance events instead of only a timer estimate.
  opts = opts || {};
  if(opts.cancelFirst !== false) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = zhVoice ? zhVoice.lang : "zh-CN";
  if(zhVoice) u.voice = zhVoice;
  u.rate = 0.9;
  if(typeof opts.onstart === "function") u.onstart = opts.onstart;
  if(typeof opts.onend === "function") u.onend = opts.onend;
  speechSynthesis.speak(u);
  return u;
}
// Renders a compact voice-picker widget; call from any tab that plays audio.
function renderVoicePicker(container){
  const el = document.createElement("div");
  el.className = "voice-picker";
  el.innerHTML = `
    <span class="muted">Voice:</span>
    <select id="voiceSelect"></select>
    <button class="toggle-link" id="voiceTest">🔊 test</button>
  `;
  container.appendChild(el);
  refreshVoiceSelect();
  document.getElementById("voiceSelect").onchange = (e)=> setVoiceByName(decodeURIComponent(e.target.value));
  document.getElementById("voiceTest").onclick = ()=> speak("你好，欢迎学习汉语。");
  // On iOS every browser (Chrome included) is required to use Apple's own speech
  // engine, so Google's voices are never reachable there -- if no Chinese voice is
  // installed at all yet, point at where to add one instead of just failing silently.
  if(zhVoices.length === 0 && /iPad|iPhone|iPod/.test(navigator.userAgent)){
    const hint = document.createElement("p");
    hint.className = "muted";
    hint.style.cssText = "font-size:12px;margin:4px 0 0;";
    hint.textContent = "No Chinese voice installed. On iPhone: Settings → Accessibility → Spoken Content → Voices → Chinese, then download one (Enhanced/Premium quality sounds best).";
    container.appendChild(hint);
  }
}

/* ============================ SFX (synthesized, no audio files needed) ============================ */
let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    audioCtx = new AC();
  }
  if(audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playTone(freq, startTime, duration, type, gainVal){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || "sine";
  osc.frequency.value = freq;
  gain.gain.value = gainVal===undefined ? 0.15 : gainVal;
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.stop(startTime + duration + 0.02);
}
function sfxCorrect(intensity){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const now = ctx.currentTime;
  const notes = intensity >= 2 ? [523.25, 659.25, 783.99, 1046.5] : [523.25, 659.25, 783.99];
  notes.forEach((f,i)=> playTone(f, now + i*0.09, 0.22, "triangle", 0.13));
}
function sfxWrong(){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const now = ctx.currentTime;
  playTone(196.0, now, 0.22, "sawtooth", 0.11);
  playTone(174.61, now + 0.14, 0.28, "sawtooth", 0.11);
}
function sfxNeutral(){
  const ctx = getAudioCtx();
  if(!ctx) return;
  playTone(392.0, ctx.currentTime, 0.16, "sine", 0.1);
}
function sfxLevelUp(){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f,i)=> playTone(f, now + i*0.11, 0.28, "triangle", 0.14));
}
function sfxAchievement(){
  const ctx = getAudioCtx();
  if(!ctx) return;
  const now = ctx.currentTime;
  [659.25, 783.99, 987.77].forEach((f,i)=> playTone(f, now + i*0.1, 0.3, "square", 0.09));
}

/* ============================ Visual feedback FX ============================ */
function spawnFloatText(anchorEl, text, color){
  let rect = {left: window.innerWidth/2, top: window.innerHeight/2, width:0};
  if(anchorEl && anchorEl.getBoundingClientRect) rect = anchorEl.getBoundingClientRect();
  const span = document.createElement("div");
  span.className = "float-text";
  span.textContent = text;
  span.style.left = (rect.left + rect.width/2) + "px";
  span.style.top = Math.max(rect.top - 6, 8) + "px";
  span.style.color = color;
  document.body.appendChild(span);
  setTimeout(()=> span.remove(), 1000);
}
function screenPulse(color){
  const div = document.createElement("div");
  div.className = "screen-flash";
  div.style.background = `radial-gradient(circle, ${color}, transparent 70%)`;
  document.body.appendChild(div);
  setTimeout(()=> div.remove(), 450);
}
// Pops a mascot in the corner to react to what just happened.
// Each reaction shows ONE fitting illustration, animated with a lively bounce/wiggle
// (no crossfading to a different, unrelated picture).
const REACTION_MASCOTS = {
  correct: "happy-pixel-celebrating.png",
  wrong: "crying-sad-reaction.png",
  neutral: "thinking-pixel-bubble.png"
};
// Accepts either a boolean (legacy true/false) or the string "neutral".
function showMascotReaction(kind){
  const file = kind === true ? REACTION_MASCOTS.correct
    : kind === false ? REACTION_MASCOTS.wrong
    : (REACTION_MASCOTS[kind] || REACTION_MASCOTS.correct);
  const pop = document.createElement("div");
  pop.className = "mascot-pop";
  pop.innerHTML = mascotBounceImg(file, "");
  document.body.appendChild(pop);
  setTimeout(()=> pop.remove(), 1350);
}
// Generic correct/incorrect feedback: sound + glow/shake + floating text + mascot.
// `el` is the button/element the feedback should visually anchor to.
function feedbackFX(el, correct, label){
  if(correct){
    sfxCorrect(1);
    if(el) el.classList.add("fx-correct");
    spawnFloatText(el, label || "✓ Correct!", "#2f6f4d");
    screenPulse("rgba(47,111,77,.18)");
  } else {
    sfxWrong();
    if(el) el.classList.add("fx-wrong");
    spawnFloatText(el, label || "✗ Miss!", "#d97757");
    screenPulse("rgba(217,119,87,.2)");
  }
  showMascotReaction(correct);
  if(el) setTimeout(()=>{ el.classList.remove("fx-correct","fx-wrong"); }, 700);
}
// "Hard" feedback: a distinct yellow/neutral flash for flashcard grading's
// middle options, so all four grade buttons get a satisfying visual response.
function feedbackFXNeutral(el, label){
  sfxNeutral();
  if(el) el.classList.add("fx-neutral");
  spawnFloatText(el, label || "~ Noted", "#b8860b");
  screenPulse("rgba(230,181,53,.22)");
  showMascotReaction("neutral");
  if(el) setTimeout(()=>{ el.classList.remove("fx-neutral"); }, 700);
}
// Shows the word's knowledge-percent change right after a grading action, e.g.
// "62% \u2192 74% (+12%)" in green, or "74% \u2192 58% (\u221216%)" in red for a drop. Reuses
// the same floating-text animation as feedbackFX/feedbackFXNeutral, staggered
// slightly after the main correct/wrong/neutral pop so the two don't overlap.
function showKnowledgeDelta(anchorEl, beforePct, afterPct){
  const before = Math.round(beforePct);
  const after = Math.round(afterPct);
  const delta = after - before;
  const color = delta > 0 ? "#2f6f4d" : delta < 0 ? "#d97757" : "#b8860b";
  const deltaText = delta > 0 ? `+${delta}%` : delta < 0 ? `\u2212${Math.abs(delta)}%` : "\u00b10%";
  setTimeout(()=> spawnFloatText(anchorEl, `${before}% \u2192 ${after}% (${deltaText})`, color), 300);
}


/* ---- Library ---- */
function wordCategory(idx){
  const c = getCard(idx);
  if(!c || c.state === "new") return "new";
  if(c.state === "review" && c.interval >= 21) return "mastered";
  if(c.state === "review" && c.interval >= 4) return "familiar";
  return "learning";
}
const CAT_LABEL = { new:"New", learning:"Learning", familiar:"Familiar", mastered:"Mastered" };
// Word's HSK difficulty tier (1/2/3), stored as VOCAB[i][3]/EXTRA_WORDS[i][3].
// Defaults to 3 (this app's core list is HSK 3.0 Level 3 vocabulary) if missing.
function vocabLevel(idx){ const v = VOCAB[idx]; return (v && v[3]) || 3; }
// Optional per-word extra info (example sentence / related phrase), VOCAB[i][4].
function vocabExtra(idx){ const v = VOCAB[idx]; return (v && v[4]) || {}; }
const LEVEL_LABEL = { 1:"HSK 1", 2:"HSK 2", 3:"HSK 3", 4:"HSK 4" };
let libFilter = "all";
let libLevelFilter = "all";
let libSort = "default";
let libSearch = "";

function renderLibrary(app){
  const wrap = document.createElement("div");
  wrap.className = "card";
  const counts = { all: VOCAB.length, new:0, learning:0, familiar:0, mastered:0 };
  const lvlCounts = { all: VOCAB.length, 1:0, 2:0, 3:0 };
  VOCAB.forEach((v,i)=>{ counts[wordCategory(i)]++; lvlCounts[vocabLevel(i)]++; });
  wrap.innerHTML = `
    <div class="tab-hero">${mascotBounceImg("examining-green-globe.png","")}<h3>Vocabulary library</h3></div>
    <p class="muted">All ${VOCAB.length} official HSK 1-3 words, sorted into categories based on how well you know them so far.</p>
    ${wordsProgressHeader(VOCAB.map((_,i)=>i))}
    <input type="text" id="libSearch" placeholder="Search by hanzi, pinyin, or English…" value="${libSearch}">
    <div class="lib-filters" id="libFilters">
      <button data-f="all" class="${libFilter==='all'?'active':''}">All (${counts.all})</button>
      <button data-f="new" class="${libFilter==='new'?'active':''}">New (${counts.new})</button>
      <button data-f="learning" class="${libFilter==='learning'?'active':''}">Learning (${counts.learning})</button>
      <button data-f="familiar" class="${libFilter==='familiar'?'active':''}">Familiar (${counts.familiar})</button>
      <button data-f="mastered" class="${libFilter==='mastered'?'active':''}">Mastered (${counts.mastered})</button>
    </div>
    <div class="lib-filters" id="libLevelFilters">
      <button data-lv="all" class="${libLevelFilter==='all'?'active':''}">All levels (${lvlCounts.all})</button>
      <button data-lv="1" class="${libLevelFilter==='1'?'active':''}">HSK 1 (${lvlCounts[1]})</button>
      <button data-lv="2" class="${libLevelFilter==='2'?'active':''}">HSK 2 (${lvlCounts[2]})</button>
      <button data-lv="3" class="${libLevelFilter==='3'?'active':''}">HSK 3 (${lvlCounts[3]})</button>
      <select id="libSort">
        <option value="default" ${libSort==='default'?'selected':''}>Sort: default order</option>
        <option value="level-asc" ${libSort==='level-asc'?'selected':''}>Sort: level (1 → 3)</option>
        <option value="level-desc" ${libSort==='level-desc'?'selected':''}>Sort: level (3 → 1)</option>
      </select>
    </div>
    <div class="lib-count" id="libCount"></div>
    <div id="libList"></div>
  `;
  app.appendChild(wrap);

  document.getElementById("libSearch").oninput = (e)=>{
    libSearch = e.target.value;
    renderLibList();
  };
  document.getElementById("libFilters").addEventListener("click", e=>{
    if(e.target.tagName !== "BUTTON") return;
    libFilter = e.target.dataset.f;
    render();
  });
  document.getElementById("libLevelFilters").addEventListener("click", e=>{
    if(e.target.tagName !== "BUTTON") return;
    libLevelFilter = e.target.dataset.lv;
    render();
  });
  document.getElementById("libSort").onchange = (e)=>{
    libSort = e.target.value;
    renderLibList();
  };

  let libExpanded = null;
  function renderLibList(){
    const listEl = document.getElementById("libList");
    const q = libSearch.trim().toLowerCase();
    let rows = VOCAB.map((v,i)=>({i, hanzi:v[0], py:v[1], en:v[2], lvl:vocabLevel(i), cat:wordCategory(i), know:knowledgePercent(i)}));
    if(libFilter !== "all") rows = rows.filter(r=>r.cat===libFilter);
    if(libLevelFilter !== "all") rows = rows.filter(r=>String(r.lvl)===libLevelFilter);
    if(q) rows = rows.filter(r=> r.hanzi.includes(q) || r.py.toLowerCase().includes(q) || r.en.toLowerCase().includes(q));
    if(libSort === "level-asc") rows.sort((a,b)=> a.lvl - b.lvl);
    else if(libSort === "level-desc") rows.sort((a,b)=> b.lvl - a.lvl);
    document.getElementById("libCount").textContent = `Showing ${rows.length} word(s)`;
    listEl.innerHTML = "";
    rows.forEach(r=>{
      const wrap = document.createElement("div");
      wrap.className = "lib-row-wrap";
      const row = document.createElement("div");
      row.className = "lib-row lib-row-clickable";
      const knowColor = r.know >= 70 ? "var(--green-bright)" : r.know >= 35 ? "var(--yellow-warm)" : "var(--red)";
      const extra = vocabExtra(r.i);
      const hasSentence = extra && extra.sentence;
      const hasPhrase = extra && extra.phrase;
      const hasDetail = hasSentence || hasPhrase;
      row.innerHTML = `
        <span class="lib-hanzi" data-say="${encodeURIComponent(r.hanzi)}">${r.hanzi}</span>
        <span class="lib-py">${r.py}</span>
        <span class="lib-en">${r.en}</span>
        <span class="lvl-badge lvl-${r.lvl}">${LEVEL_LABEL[r.lvl]}</span>
        <span class="cat-badge cat-${r.cat}">${CAT_LABEL[r.cat]}</span>
        <span class="know-badge" style="border-color:${knowColor};color:${knowColor};">${r.know}%</span>
        ${hasDetail ? `<span class="lib-expand-arrow">${libExpanded===r.i ? "▲" : "▼"}</span>` : ""}
      `;
      row.querySelector(".lib-hanzi").onclick = (e)=>{ e.stopPropagation(); speak(r.hanzi); };
      if(hasDetail){
        row.onclick = ()=>{
          libExpanded = (libExpanded === r.i) ? null : r.i;
          renderLibList();
        };
      }
      wrap.appendChild(row);
      if(hasDetail && libExpanded === r.i){
        const detail = document.createElement("div");
        detail.className = "flash-detail lib-word-detail";
        detail.innerHTML = `
          ${hasSentence ? `
            <div class="flash-detail-block">
              <div class="flash-detail-label">Example sentence</div>
              <div class="passage small" id="libSentZh${r.i}">${tokenizeHanzi(extra.sentence.zh)}</div>
              <div class="muted" style="font-size:13px;">${extra.sentence.py}</div>
              <div class="muted" style="font-size:13px;">${extra.sentence.en}</div>
              <button class="toggle-link" id="libSentPlay${r.i}">🔊 Listen to sentence</button>
            </div>` : ""}
          ${hasPhrase ? `
            <div class="flash-detail-block">
              <div class="flash-detail-label">Related phrase</div>
              <div class="passage small" id="libPhraseZh${r.i}">${tokenizeHanzi(extra.phrase.zh)}</div>
              <div class="muted" style="font-size:13px;">${extra.phrase.py} — ${extra.phrase.en}</div>
              <button class="toggle-link" id="libPhrasePlay${r.i}">🔊 Listen to phrase</button>
            </div>` : ""}
          <div class="transbar" id="libDetailBar${r.i}">Tap a word to translate it here.</div>
          <div class="flash-detail-block" id="libStrokes${r.i}"></div>
          <div class="flash-detail-block" id="libStruct${r.i}"></div>
        `;
        wrap.appendChild(detail);
        if(hasSentence){
          detail.querySelector(`#libSentPlay${r.i}`).onclick = (e)=>{ e.stopPropagation(); speak(extra.sentence.zh); };
          wireTokClicks(detail.querySelector(`#libSentZh${r.i}`), `libDetailBar${r.i}`);
        }
        if(hasPhrase){
          detail.querySelector(`#libPhrasePlay${r.i}`).onclick = (e)=>{ e.stopPropagation(); speak(extra.phrase.zh); };
          wireTokClicks(detail.querySelector(`#libPhraseZh${r.i}`), `libDetailBar${r.i}`);
        }
        // Stroke order + character breakdown, rendered inline here (the Library row is
        // already an explicit "tell me more" expansion, so unlike the flashcard there's
        // no need to hide these behind further toggles). Clicks are stopped from
        // bubbling because the row itself is a collapse-toggle.
        detail.onclick = (e)=>{ if(e.target.closest(".stroke-controls, .comp-chip")) e.stopPropagation(); };
        if(charsWithStrokes(r.hanzi).length){
          const sEl = detail.querySelector(`#libStrokes${r.i}`);
          sEl.innerHTML = `<div class="flash-detail-label">Stroke order</div>`;
          const holder = document.createElement("div");
          sEl.appendChild(holder);
          renderStrokePanel(holder, r.hanzi, {size: 78});
        }
        if(Array.from(r.hanzi).some(c => charInfo(c))){
          const cEl = detail.querySelector(`#libStruct${r.i}`);
          cEl.innerHTML = `<div class="flash-detail-label">Character breakdown</div>`;
          const holder2 = document.createElement("div");
          cEl.appendChild(holder2);
          renderWordStructure(holder2, r.hanzi);
        }
      }
      listEl.appendChild(wrap);
    });
  }
  renderLibList();
}

// ---- Today-tab dashboard widget builders (inline SVG/CSS only, real state data) ----
// 1) Donut of vocab library breakdown by category, via wordCategory()/CAT_LABEL.
function buildVocabDonutWidget(){
  const counts = { new:0, learning:0, familiar:0, mastered:0 };
  VOCAB.forEach((v,i)=> counts[wordCategory(i)]++);
  const total = VOCAB.length;
  const colors = { new:"#ffffff", learning:"var(--yellow-warm)", familiar:"var(--blue)", mastered:"var(--green-bright)" };
  const order = ["mastered","familiar","learning","new"];
  let acc = 0;
  const stops = order.map(k=>{
    const from = acc;
    acc += total ? (counts[k]/total*360) : 0;
    return `${colors[k]} ${from}deg ${acc}deg`;
  }).join(", ");
  const started = total - counts.new;
  return `
    <div class="widget-card">
      <h4>Vocabulary library</h4>
      <div class="widget-body">
        <div class="donut-wrap">
          <div class="donut" style="background:conic-gradient(${stops});"></div>
          <div class="donut-hole"><span class="dh-num">${started}</span><span class="dh-lbl">/ ${total}</span></div>
        </div>
        <div class="donut-legend">
          ${order.map(k=>`<span class="lg-item"><span class="lg-dot" style="background:${colors[k]};"></span>${CAT_LABEL[k]} (${counts[k]})</span>`).join("")}
        </div>
      </div>
    </div>`;
}
// 2) Weekly activity bar chart from the additive state.xpLog rolling daily record.
function buildWeeklyXpWidget(){
  const days = [];
  const now = new Date();
  for(let i=6;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate()-i);
    const key = d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
    days.push({ label: d.toLocaleDateString(undefined,{weekday:"narrow"}), xp: (state.xpLog && state.xpLog[key]) || 0 });
  }
  const max = Math.max(1, ...days.map(d=>d.xp));
  return `
    <div class="widget-card wc-blue">
      <h4>Last 7 days · XP earned</h4>
      <div class="widget-body">
        <div class="week-chart">
          ${days.map(d=>`
            <div class="wc-col">
              <div class="wc-bar" style="height:${Math.max(4, Math.round(d.xp/max*80))}px;" title="${d.xp} XP"></div>
              <div class="wc-day">${d.label}</div>
            </div>`).join("")}
        </div>
      </div>
    </div>`;
}
// 3) Achievement progress ring: unlocked count out of ACHIEVEMENTS.length.
function buildAchievementRingWidget(){
  const unlocked = Object.keys(state.unlockedAchievements).length;
  const total = ACHIEVEMENTS.length;
  const pct = total ? Math.round(unlocked/total*100) : 0;
  const deg = total ? (unlocked/total*360) : 0;
  return `
    <div class="widget-card wc-yellow">
      <h4>Achievements</h4>
      <div class="widget-body">
        <div class="donut-wrap">
          <div class="donut" style="background:conic-gradient(var(--red) 0deg ${deg}deg, #ffffff ${deg}deg 360deg);"></div>
          <div class="donut-hole"><span class="dh-num">${unlocked}</span><span class="dh-lbl">/ ${total}</span></div>
        </div>
        <div class="donut-legend">
          <span class="lg-item">${pct}% unlocked</span>
          <span class="lg-item">Keep studying to earn more</span>
        </div>
      </div>
    </div>`;
}
// 4) All-time totals card: streak + total SRS reviews (summed from every card's
// own correct/wrong tallies) + words started. Distinct from the Progress tab's
// rpg-stats (which track quiz-style state.correctAnswers/picCorrect separately).
function buildStudyStatsWidget(){
  const started = Object.keys(state.cards).length;
  let totalCorrect = 0, totalWrong = 0;
  Object.values(state.cards).forEach(c=>{ totalCorrect += c.correct||0; totalWrong += c.wrong||0; });
  return `
    <div class="widget-card wc-orange">
      <h4>All-time totals</h4>
      <div class="widget-body">
        <div class="stat-row" style="width:100%;">
          <div class="stat"><div class="num">${state.streak||1}</div><div class="lbl">day streak</div></div>
          <div class="stat"><div class="num">${totalCorrect+totalWrong}</div><div class="lbl">reviews done</div></div>
          <div class="stat"><div class="num">${started}</div><div class="lbl">words started</div></div>
        </div>
      </div>
    </div>`;
}

// 5) Time-studied widget: today's active study time plus the all-time total,
// both sourced from state.studyTime (populated by studyTimeTick()).
function buildTimeStudiedWidget(){
  const todayMs = (state.studyTime && state.studyTime[todayStr()]) || 0;
  const allMs = totalStudyTimeMs();
  return `
    <div class="widget-card wc-purple">
      <h4>Time studied</h4>
      <div class="widget-body">
        <div class="stat-row" style="width:100%;">
          <div class="stat"><div class="num">${formatStudyTime(todayMs)}</div><div class="lbl">studied today</div></div>
          <div class="stat"><div class="num">${formatStudyTime(allMs)}</div><div class="lbl">all-time studied</div></div>
        </div>
      </div>
    </div>`;
}
// 6) Today's activity widget: XP earned today (from the existing xpLog), flashcard
// reviews done today and their accuracy (from state.reviewLog), and current streak
// vs the longest streak ever reached -- all cheap reads of already-tracked state.
function buildTodayActivityWidget(){
  const t = todayStr();
  const xpToday = (state.xpLog && state.xpLog[t]) || 0;
  const rl = (state.reviewLog && state.reviewLog[t]) || {n:0, ok:0};
  const acc = rl.n ? Math.round((rl.ok / rl.n) * 100) : 0;
  const longest = Math.max(state.longestStreak||0, state.streak||0);
  return `
    <div class="widget-card">
      <h4>Today's activity</h4>
      <div class="widget-body">
        <div class="stat-row" style="width:100%;">
          <div class="stat"><div class="num">${xpToday}</div><div class="lbl">XP today</div></div>
          <div class="stat"><div class="num">${rl.n}</div><div class="lbl">reviews today</div></div>
          <div class="stat"><div class="num">${rl.n ? acc+"%" : "—"}</div><div class="lbl">today's accuracy</div></div>
          <div class="stat"><div class="num">${state.streak||1}/${longest}</div><div class="lbl">streak / longest</div></div>
        </div>
      </div>
    </div>`;
}

function renderToday(app){
  const due = getDueCardIndices();
  const introducedTodayCount = Object.values(state.cards).filter(c=>c.introducedOn===todayStr()).length;
  const reading = READINGS[dayOfYear() % READINGS.length];
  const lv = levelFromXp(state.xp);
  const t = titleForLevel(lv.level);
  const pct = Math.round((lv.into / lv.need) * 100);
  const phrase = DAILY_PHRASES[dayOfYear() % DAILY_PHRASES.length];

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card">
      <div class="char-sheet">
        <div class="avatar" style="width:96px;height:96px;">${mascotBounceImg(t.mascot, t.title)}</div>
        <div class="char-info">
          <div class="char-title">${t.title} · Level ${lv.level}</div>
          <div class="xp-bar"><div style="width:${pct}%"></div></div>
          <div class="xp-label"><img src="ui-assets/icon-star.png" class="icon-inline" alt="">${lv.into} / ${lv.need} XP to next level</div>
        </div>
        <button class="secondary" id="goProgress">View character sheet</button>
      </div>
    </div>
    <div class="stat-row">
      <div class="stat"><div class="num">${due.length}</div><div class="lbl">cards due now</div></div>
      <div class="stat"><div class="num">${introducedTodayCount}</div><div class="lbl">new words today</div></div>
      <div class="stat"><div class="num">${state.streak||1}</div><div class="lbl">day streak</div></div>
      <div class="stat"><div class="num">${Object.keys(state.cards).length}</div><div class="lbl">/ ${VOCAB.length} words started</div></div>
    </div>
    <div class="daily-phrase">
      <div class="dp-label">Phrase of the day</div>
      <div class="dp-zh" id="dpZh">${tokenizeHanzi(phrase[0])}</div>
      <div class="dp-py">${phrase[1]}</div>
      <div class="dp-en">${phrase[2]}</div>
      <button class="toggle-link" id="dpPlay" style="margin-top:4px;">🔊 Play</button>
    </div>
    <div class="widget-grid">
      ${buildVocabDonutWidget()}
      ${buildWeeklyXpWidget()}
      ${buildAchievementRingWidget()}
      ${buildStudyStatsWidget()}
      ${buildTimeStudiedWidget()}
      ${buildTodayActivityWidget()}
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Today's plan</h3>
      <p class="muted">A fresh mix is generated every day: new flashcards, everything due for review, and one reading passage — rotated by the date so you don't see the same thing twice in a row.</p>
      <div class="flash-controls">
        <button class="primary" id="goFlash">Start flashcards (${due.length} due)</button>
        <button class="secondary" id="goReading">Today's reading: "${reading.title}"</button>
      </div>
    </div>
  `;
  app.appendChild(wrap);
  document.getElementById("goFlash").onclick=()=>{currentTab="flash"; setActiveTab("flash"); render();};
  document.getElementById("goReading").onclick=()=>{currentTab="reading"; setActiveTab("reading"); render();};
  document.getElementById("goProgress").onclick=()=>{currentTab="progress"; setActiveTab("progress"); render();};
  document.getElementById("dpPlay").onclick=()=>speak(phrase[0]);
}
function setActiveTab(tab){
  [...tabsEl.children].forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
}

/* ---- Flashcards ---- */
let flashQueue = [];
let flashPos = 0;
let flashRevealed = false;
let lastAutoplayedIdx = null;
let flashSentPyShown = false;
// Which flip-back detail pane is open on the current card: null | "sent" | "strokes" |
// "struct". Accordion (one at a time) and closed by default, so the extra detail doesn't
// add height until asked for -- that's what keeps a card's full review fitting on one
// mobile screen without scrolling, above the fixed-to-bottom grade buttons.
let flashDetailPane = null;

function renderFlash(app){
  flashQueue = getDueCardIndices();
  flashPos = 0;
  flashRevealed = false; flashSentPyShown = false; flashDetailPane = null;
  lastAutoplayedIdx = null;
  renderFlashCard(app);
}

// Pull extra un-introduced words right now, ignoring the daily cap.
// Only draws from levels currently selected in the flashcard set picker.
function introduceExtraCards(n){
  const introduced = new Set(getIntroducedIndices());
  const t = todayStr();
  let added = 0;
  let idx = 0;
  const newIdx = [];
  while(added < n && idx < VOCAB.length){
    if(!introduced.has(idx) && isLevelEligible(idx)){
      ensureCard(idx);
      introduced.add(idx);
      newIdx.push(idx);
      added++;
    }
    idx++;
  }
  saveState();
  return newIdx;
}

// Pull a random sample of already-introduced words for optional bonus practice.
// Only draws from levels currently selected in the flashcard set picker.
function extraPracticeSample(n){
  const all = getIntroducedIndices().filter(isLevelEligible);
  const shuffled = all.sort(()=>Math.random()-0.5);
  return shuffled.slice(0, n);
}

// Segmented-pill control (reusing the .lib-filters look) letting the user choose
// which HSK level set(s) flashcard sessions are drawn from. Multi-select, at
// least one level must stay active. Persists via saveState() into state.flashLevels.
function renderFlashLevelPicker(app){
  const wrap = document.createElement("div");
  wrap.className = "card flash-level-picker";
  const active = activeFlashLevels();
  wrap.innerHTML = `
    <div class="muted" style="font-weight:800;margin-bottom:6px;">Study which HSK set(s)?</div>
    <div class="lib-filters" id="flashLevelFilters">
      <button data-lv="1" class="${active.includes(1)?'active':''}">HSK 1</button>
      <button data-lv="2" class="${active.includes(2)?'active':''}">HSK 2</button>
      <button data-lv="3" class="${active.includes(3)?'active':''}">HSK 3</button>
    </div>
  `;
  app.appendChild(wrap);
  document.getElementById("flashLevelFilters").addEventListener("click", e=>{
    if(e.target.tagName !== "BUTTON") return;
    const lv = Number(e.target.dataset.lv);
    let cur = activeFlashLevels().slice();
    if(cur.includes(lv)){
      if(cur.length === 1) return; // keep at least one level selected
      cur = cur.filter(x=>x!==lv);
    } else {
      cur.push(lv);
    }
    state.flashLevels = cur;
    saveState();
    renderFlash(app);
  });
}

function renderFlashCard(app){
  app.innerHTML = "";
  renderVoicePicker(app);
  renderFlashLevelPicker(app);
  const headerWrap = document.createElement("div");
  headerWrap.className = "card flash-progress-card";
  headerWrap.innerHTML = `<div class="muted" style="font-weight:800;margin-bottom:2px;">Flashcard progress</div>${wordsProgressHeader(VOCAB.map((_,i)=>i))}`;
  app.appendChild(headerWrap);
  if(flashQueue.length === 0){
    const remaining = VOCAB.length - Object.keys(state.cards).length;
    const empty = document.createElement("div");
    empty.className = "card center";
    empty.innerHTML = `
      ${mascotBounceImg("sleeping-soundly.png","", "empty-mascot")}
      <p>No cards due right now. New cards unlock daily, and reviews come back on their own schedule.</p>
      <p class="muted">Total words started: ${Object.keys(state.cards).length} / ${VOCAB.length}</p>
      <div class="flash-controls">
        ${remaining > 0 ? `<button class="primary" id="moreNew">Learn 10 more new words now</button>` : ""}
        <button class="secondary" id="morePractice">Practice random words for extra reps</button>
      </div>
    `;
    app.appendChild(empty);
    if(remaining > 0){
      document.getElementById("moreNew").onclick = ()=>{
        flashQueue = introduceExtraCards(10);
        flashPos = 0; flashRevealed = false; flashSentPyShown = false; flashDetailPane = null; lastAutoplayedIdx = null;
        renderFlashCard(app);
      };
    }
    document.getElementById("morePractice").onclick = ()=>{
      flashQueue = extraPracticeSample(15);
      flashPos = 0; flashRevealed = false; flashSentPyShown = false; flashDetailPane = null; lastAutoplayedIdx = null;
      renderFlashCard(app);
    };
    return;
  }
  if(flashPos >= flashQueue.length){
    const remaining = VOCAB.length - Object.keys(state.cards).length;
    const done = document.createElement("div");
    done.className = "card center";
    done.innerHTML = `
      ${mascotBounceImg("happy-pixel-celebrating.png","", "empty-mascot")}
      <p>Nice — you cleared this set of ${flashQueue.length} card(s).</p>
      <div class="flash-controls">
        <button class="secondary" id="restart">Review due cards again</button>
        ${remaining > 0 ? `<button class="primary" id="moreNew">Learn 10 more new words now</button>` : ""}
        <button class="secondary" id="morePractice">Practice random words for extra reps</button>
      </div>
    `;
    app.appendChild(done);
    document.getElementById("restart").onclick = ()=>renderFlash(app);
    if(remaining > 0){
      document.getElementById("moreNew").onclick = ()=>{
        flashQueue = introduceExtraCards(10);
        flashPos = 0; flashRevealed = false; flashSentPyShown = false; flashDetailPane = null; lastAutoplayedIdx = null;
        renderFlashCard(app);
      };
    }
    document.getElementById("morePractice").onclick = ()=>{
      flashQueue = extraPracticeSample(15);
      flashPos = 0; flashRevealed = false; flashSentPyShown = false; flashDetailPane = null; lastAutoplayedIdx = null;
      renderFlashCard(app);
    };
    return;
  }
  const idx = flashQueue[flashPos];
  const [hanzi, pinyin, eng] = VOCAB[idx];
  const lvl = vocabLevel(idx);
  const know = knowledgePercent(idx);
  const knowColor = know >= 70 ? "var(--green-bright)" : know >= 35 ? "var(--yellow-warm)" : "var(--red)";
  const extra = vocabExtra(idx);
  const hasSentence = extra && extra.sentence;
  const hasPhrase = extra && extra.phrase;
  // Both guard against the stroke feature being absent entirely (library failed to
  // load, or this word's characters aren't in the generated data) -- the toggles simply
  // don't render in that case rather than opening an empty pane.
  const hasStrokeChars = charsWithStrokes(hanzi).length > 0;
  const hasStructure = Array.from(hanzi).some(c => charInfo(c));
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="flash-top-row">
      <span class="lvl-badge lvl-${lvl}">${LEVEL_LABEL[lvl]}</span>
      <span class="muted center" style="flex:1;">Card ${flashPos+1} of ${flashQueue.length}</span>
      <span class="know-badge" style="border-color:${knowColor};color:${knowColor};" title="How well you know this word">${know}%</span>
    </div>
    <div class="hanzi">${hanzi}</div>
    <div class="pinyin" id="pyLine">${flashRevealed ? pinyin : ""}</div>
    <div class="meaning" id="enLine">${flashRevealed ? eng : ""}</div>
    <div class="flash-controls">
      <button class="secondary icon-btn" id="playBtn" title="Play sound again">🔊</button>
      <button class="secondary" id="revealBtn">${flashRevealed? "Hide" : "Show pinyin + meaning"}</button>
    </div>
    ${flashRevealed ? `
      <div class="flash-detail-tabs">
        ${(hasSentence || hasPhrase) ? `<button class="flash-detail-toggle ${flashDetailPane==='sent'?'open':''}" data-pane="sent">${flashDetailPane==='sent' ? "▴" : "▾"} Sentences</button>` : ""}
        ${hasStrokeChars ? `<button class="flash-detail-toggle ${flashDetailPane==='strokes'?'open':''}" data-pane="strokes">${flashDetailPane==='strokes' ? "▴" : "▾"} Strokes</button>` : ""}
        ${hasStructure ? `<button class="flash-detail-toggle ${flashDetailPane==='struct'?'open':''}" data-pane="struct">${flashDetailPane==='struct' ? "▴" : "▾"} Breakdown</button>` : ""}
      </div>` : ""}
    <div id="flashDetail"></div>
    <div class="grade-btns" id="gradeBtns" style="visibility:${flashRevealed?'visible':'hidden'}">
      <button class="g-again" data-g="0">Again</button>
      <button class="g-hard" data-g="1">Hard</button>
      <button class="g-good" data-g="2">Good</button>
      <button class="g-easy" data-g="3">Easy</button>
    </div>
  `;
  app.appendChild(card);
  // Autoplay the pronunciation the moment a *new* card appears, but not when
  // this same card just re-renders because the user toggled the reveal.
  if(idx !== lastAutoplayedIdx){
    lastAutoplayedIdx = idx;
    speak(hanzi);
  }
  document.getElementById("playBtn").onclick=()=>speak(hanzi);
  document.getElementById("revealBtn").onclick=()=>{ flashRevealed = !flashRevealed; renderFlashCard(app); };
  // Flip-back detail panes: example sentences, stroke order, and character breakdown.
  // Only ONE pane is open at a time (accordion, all closed by default) so a revealed
  // card still fits on one mobile screen without scrolling -- see the fixed-bottom
  // grade bar, which assumes the card above it stays short.
  if(flashRevealed){
    card.querySelectorAll(".flash-detail-toggle").forEach(btn=>{
      btn.onclick = ()=>{
        const pane = btn.dataset.pane;
        flashDetailPane = (flashDetailPane === pane) ? null : pane;
        renderFlashCard(app);
      };
    });
  }
  if(flashRevealed && flashDetailPane === "strokes" && hasStrokeChars){
    const strokeWrap = document.createElement("div");
    strokeWrap.className = "flash-detail";
    document.getElementById("flashDetail").appendChild(strokeWrap);
    renderStrokePanel(strokeWrap, hanzi);
  }
  if(flashRevealed && flashDetailPane === "struct" && hasStructure){
    const structWrap = document.createElement("div");
    structWrap.className = "flash-detail";
    document.getElementById("flashDetail").appendChild(structWrap);
    renderWordStructure(structWrap, hanzi);
  }
  if(flashRevealed && flashDetailPane === "sent" && (hasSentence || hasPhrase)){
    const detailEl = document.getElementById("flashDetail");
    detailEl.innerHTML = `
      <div class="flash-detail">
        ${hasSentence ? `
          <div class="flash-detail-block">
            <div class="flash-detail-label">Example sentence</div>
            <div class="passage small" id="flashSentZh">${tokenizeHanziWithBold(extra.sentence.zh, hanzi)}</div>
            <div class="muted" style="font-size:13px;display:${flashSentPyShown ? "block" : "none"};" id="flashSentPy">${extra.sentence.py}</div>
            <div class="muted" style="font-size:13px;">${extra.sentence.en}</div>
            <div style="display:flex;gap:14px;align-items:center;">
              <button class="toggle-link" id="flashSentPlay">🔊 Listen to sentence</button>
              <button class="toggle-link" id="flashSentPyToggle">${flashSentPyShown ? "Hide pinyin" : "Show pinyin"}</button>
            </div>
          </div>` : ""}
        ${hasPhrase ? `
          <div class="flash-detail-block">
            <div class="flash-detail-label">Related phrase</div>
            <div class="passage small" id="flashPhraseZh">${tokenizeHanzi(extra.phrase.zh)}</div>
            <div class="muted" style="font-size:13px;">${extra.phrase.py} — ${extra.phrase.en}</div>
            <button class="toggle-link" id="flashPhrasePlay">🔊 Listen to phrase</button>
          </div>` : ""}
        <div class="transbar" id="flashDetailBar">Tap a word to translate it here.</div>
      </div>
    `;
    if(hasSentence){
      document.getElementById("flashSentPlay").onclick = ()=> speak(extra.sentence.zh);
      document.getElementById("flashSentPyToggle").onclick = ()=>{
        flashSentPyShown = !flashSentPyShown;
        renderFlashCard(app);
      };
      wireTokClicks(document.getElementById("flashSentZh"), "flashDetailBar");
    }
    if(hasPhrase){
      document.getElementById("flashPhrasePlay").onclick = ()=> speak(extra.phrase.zh);
      wireTokClicks(document.getElementById("flashPhraseZh"), "flashDetailBar");
    }
  }
  card.querySelectorAll("[data-g]").forEach(b=>{
    b.onclick = ()=>{
      if(!flashRevealed) return;
      const grade = Number(b.dataset.g);
      card.querySelectorAll("[data-g]").forEach(x=>x.disabled=true);
      const beforePct = knowledgePercent(idx);
      if(grade === 0){ feedbackFX(b, false, "Again"); card.classList.add("flash-fx-bad"); }
      else if(grade === 1){ feedbackFXNeutral(b, "Hard"); card.classList.add("flash-fx-neutral"); }
      else if(grade === 2){ feedbackFX(b, true, "Good!"); card.classList.add("flash-fx-good"); }
      else { feedbackFX(b, true, "Easy!"); card.classList.add("flash-fx-good"); }
      gradeCard(idx, grade);
      const afterPct = knowledgePercent(idx);
      showKnowledgeDelta(card.querySelector(".know-badge") || b, beforePct, afterPct);
      flashPos++;
      flashRevealed = false; flashSentPyShown = false; flashDetailPane = null;
      setTimeout(()=> renderFlashCard(app), 320);
    };
  });
}

/* ---- Reading ---- */
let readingIndex = null;
let picReadingIndex = null;

/* ---- Reading: story library (dashboard / chapter list / reader) ---- */
// readingView drives which sub-screen the Reading tab shows; storyFilterLevel is the
// active HSK-level filter pill on the dashboard ("all" | 1 | 2 | 3 | 4).
let readingView = "dashboard";
let storyFilterLevel = "all";
let currentStoryId = null;
let currentChapterIdx = 0;

// Splits chapter text into sentences on 。！？ (kept at the end of each sentence).
function splitSentences(text){
  if(!text) return [];
  return text.split(/(?<=[。！？])/).map(s=>s.trim()).filter(Boolean);
}

function getStory(id){ return STORIES.find(s=>s.id===id); }

function storyProgressFor(id){
  const p = state.storyProgress[id] = state.storyProgress[id] || { chaptersRead: [], lastPosition: 0 };
  if(p.quizCompleted === undefined) p.quizCompleted = false;
  if(p.quizScore === undefined) p.quizScore = null;
  if(p.quizTotal === undefined) p.quizTotal = null;
  return p;
}

function markChapterRead(storyId, chapterIdx){
  const p = storyProgressFor(storyId);
  if(!p.chaptersRead.includes(chapterIdx)) p.chaptersRead.push(chapterIdx);
  p.lastPosition = chapterIdx;
  saveState();
}

// Marks every chapter of a story as read in one go -- used by the "Mark story
// as read" button on the chapter-list view, alongside the existing per-chapter
// auto-mark-on-open and the explicit per-chapter "Mark as read" button.
function markStoryRead(storyId){
  const story = getStory(storyId);
  if(!story) return;
  const p = storyProgressFor(storyId);
  for(let i=0;i<story.chapters.length;i++){
    if(!p.chaptersRead.includes(i)) p.chaptersRead.push(i);
  }
  p.lastPosition = story.chapters.length-1;
  saveState();
}

function firstUnreadChapter(story){
  const p = storyProgressFor(story.id);
  for(let i=0;i<story.chapters.length;i++){
    if(!p.chaptersRead.includes(i)) return i;
  }
  return 0;
}

/* ---- Dashboard ---- */
function renderReading(app){
  stopPlayback();
  if(readingView === "chapters" && currentStoryId) return renderStoryChapters(app);
  if(readingView === "reader" && currentStoryId) return renderStoryReader(app);
  if(readingView === "classic") return renderReadingClassicView(app);
  renderStoryDashboard(app);
}

function renderReadingClassicView(app){
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.innerHTML = `<button class="toggle-link" id="backToDashboard">&larr; Back to story library</button>`;
  app.appendChild(wrap);
  document.getElementById("backToDashboard").onclick = ()=>{ readingView = "dashboard"; render(); };
  renderReadingClassic(app);
}

const STORY_LEVELS = [1,2,3,4];
function renderStoryDashboard(app){
  const wrap = document.createElement("div");
  const filtered = STORIES.filter(s=> storyFilterLevel==="all" || s.level===storyFilterLevel);
  wrap.innerHTML = `
    <div class="card">
      <div class="tab-hero">${mascotBounceImg("idea-lightbulb-pixel.png","")}<h3>Story library <span class="badge">${STORIES.length} stories</span></h3></div>
      <p class="muted">Read HSK-graded stories chapter by chapter. Tap any word for its pinyin, meaning, and audio.</p>
      <div class="lib-filters" id="storyLevelFilters">
        <button data-lvl="all" class="${storyFilterLevel==='all'?'active':''}">All</button>
        ${STORY_LEVELS.map(l=>`<button data-lvl="${l}" class="${storyFilterLevel===l?'active':''}">HSK ${l}</button>`).join("")}
      </div>
      <div class="story-grid" id="storyGrid"></div>
      <p class="muted" style="margin-top:10px;">Prefer the original single-passage practice? <button class="toggle-link" id="goClassic">Open classic reading passages</button></p>
    </div>
  `;
  app.appendChild(wrap);
  const grid = document.getElementById("storyGrid");
  grid.innerHTML = filtered.map(s=>{
    const p = storyProgressFor(s.id);
    const total = s.chapters.length;
    const done = p.chaptersRead.length;
    const pct = total ? Math.round((done/total)*100) : 0;
    const quizBadge = (s.quiz && s.quiz.length && p.quizCompleted)
      ? `<span class="badge">Quiz: ${p.quizScore}/${p.quizTotal}</span>`
      : "";
    return `
      <button class="story-card" data-story="${s.id}">
        <div class="story-meta"><span class="lvl-badge lvl-${s.level}">${LEVEL_LABEL[s.level]}</span>${s.tags.map(t=>`<span class="story-tag">${t}</span>`).join("")}${quizBadge}</div>
        <div class="story-zh">${s.titleZh}</div>
        <h4>${s.titleEn}</h4>
        <div class="story-desc">${s.description}</div>
        <div class="muted" style="font-size:12px;">${total} chapter${total===1?"":"s"} &middot; ${done}/${total} read</div>
        <div class="story-progress-bar"><div style="width:${pct}%"></div></div>
      </button>
    `;
  }).join("") || `<p class="muted">No stories at this level yet.</p>`;
  grid.querySelectorAll("[data-story]").forEach(card=>{
    card.onclick = ()=>{
      currentStoryId = card.dataset.story;
      readingView = "chapters";
      render();
    };
  });
  document.getElementById("storyLevelFilters").querySelectorAll("button").forEach(b=>{
    b.onclick = ()=>{
      const v = b.dataset.lvl;
      storyFilterLevel = v==="all" ? "all" : parseInt(v,10);
      render();
    };
  });
  document.getElementById("goClassic").onclick = ()=>{ readingView = "classic"; render(); };
}

/* ---- Chapter list ---- */
function renderStoryChapters(app){
  const story = getStory(currentStoryId);
  if(!story){ readingView = "dashboard"; return renderStoryDashboard(app); }
  const p = storyProgressFor(story.id);
  const allRead = p.chaptersRead.length >= story.chapters.length;
  const hasQuiz = !!(story.quiz && story.quiz.length);
  const quizStatus = hasQuiz
    ? (p.quizCompleted ? `<span class="badge">Quiz: ${p.quizScore}/${p.quizTotal}</span>` : `<span class="badge">Quiz not taken</span>`)
    : "";
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.innerHTML = `
    <button class="toggle-link" id="backToDashboard">&larr; Back to story library</button>
    <div class="tab-hero" style="margin-top:8px;">${mascotBounceImg("holding-ancient-scroll.png","")}<h3>${story.titleZh} <span class="lvl-badge lvl-${story.level}">${LEVEL_LABEL[story.level]}</span>${quizStatus}</h3></div>
    <p class="muted">${story.titleEn} &mdash; ${story.description}</p>
    <div class="flash-controls" style="margin:6px 0 12px;">
      <button class="secondary" id="markStoryReadBtn">${allRead ? "✓ Whole story marked as read" : "Mark whole story as read"}</button>
      ${hasQuiz ? `<button class="secondary" id="goToQuizBtn">📝 Comprehension quiz</button>` : ""}
    </div>
    <div id="chapterRows"></div>
  `;
  app.appendChild(wrap);
  document.getElementById("backToDashboard").onclick = ()=>{ readingView = "dashboard"; render(); };
  const markStoryBtn = document.getElementById("markStoryReadBtn");
  markStoryBtn.onclick = ()=>{
    markStoryRead(story.id);
    feedbackFX(markStoryBtn, true, "✓ Story marked as read");
    render();
  };
  const goToQuizBtn = document.getElementById("goToQuizBtn");
  if(goToQuizBtn) goToQuizBtn.onclick = ()=>{
    currentChapterIdx = story.chapters.length-1;
    readingView = "reader";
    render();
  };
  const rows = document.getElementById("chapterRows");
  rows.innerHTML = story.chapters.map((c,i)=>{
    const read = p.chaptersRead.includes(i);
    return `<button class="chapter-row ${read?'read':''}" data-ch="${i}">
      <span>${i+1}. ${c.title}</span>
      <span class="badge">${read ? "Read" : "Unread"}</span>
    </button>`;
  }).join("");
  rows.querySelectorAll("[data-ch]").forEach(b=>{
    b.onclick = ()=>{
      currentChapterIdx = parseInt(b.dataset.ch,10);
      readingView = "reader";
      render();
    };
  });
}

/* ---- Chapter reader + click-to-translate + playback bar ---- */
function renderStoryReader(app){
  const story = getStory(currentStoryId);
  if(!story){ readingView = "dashboard"; return renderStoryDashboard(app); }
  const ch = story.chapters[currentChapterIdx];
  const sentZh = splitSentences(ch.zh);
  const sentEn = ch.en ? splitSentences(ch.en) : [];
  const isLastChapter = currentChapterIdx === story.chapters.length-1;
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.innerHTML = `
    <div class="reader-chapter-nav">
      <button class="toggle-link" id="backToChapters">&larr; ${story.titleZh}</button>
      <select class="chapter-nav-select" id="chapterJump">
        ${story.chapters.map((c,i)=>`<option value="${i}" ${i===currentChapterIdx?"selected":""}>HSK ${story.level} &middot; ${c.title}</option>`).join("")}
      </select>
    </div>
    <div class="reader-chapter-nav">
      <button class="secondary" id="prevChapter" ${currentChapterIdx===0?"disabled":""}>&larr; Prev</button>
      <h3 style="margin:0;">${ch.title}</h3>
      <button class="secondary" id="nextChapter" ${currentChapterIdx===story.chapters.length-1?"disabled":""}>Next &rarr;</button>
    </div>
    <div class="reader-text" id="readerText"></div>
    <div class="flash-controls" style="margin-top:14px;">
      <button class="secondary" id="markChapterReadBtn">✓ Mark this chapter as read</button>
    </div>
  `;
  app.appendChild(wrap);
  const readerText = document.getElementById("readerText");
  readerText.innerHTML = sentZh.map((sent,i)=>`<span class="sent" data-sidx="${i}">${tokenizeHanzi(sent)}</span>`).join(" ");
  wireStoryTokClicks(readerText, sentZh, sentEn);

  document.getElementById("backToChapters").onclick = ()=>{ stopPlayback(); readingView = "chapters"; render(); };
  document.getElementById("chapterJump").onchange = (e)=>{ stopPlayback(); currentChapterIdx = parseInt(e.target.value,10); render(); };
  const prevBtn = document.getElementById("prevChapter");
  const nextBtn = document.getElementById("nextChapter");
  if(prevBtn) prevBtn.onclick = ()=>{ stopPlayback(); currentChapterIdx--; render(); };
  if(nextBtn) nextBtn.onclick = ()=>{ stopPlayback(); currentChapterIdx++; render(); };

  // Completion trigger: simplest consistent rule is "opened" -- mark read as soon as
  // the reader for this chapter renders. The explicit button below reinforces this
  // with a visible confirmation and lets the user re-affirm it manually.
  markChapterRead(story.id, currentChapterIdx);

  const markBtn = document.getElementById("markChapterReadBtn");
  markBtn.onclick = ()=>{
    markChapterRead(story.id, currentChapterIdx);
    feedbackFX(markBtn, true, "✓ Marked as read");
    markBtn.textContent = "✓ Chapter marked as read";
  };

  initPlayBar(sentZh);

  // After the last chapter of a story has been read, show its comprehension quiz.
  if(isLastChapter && story.quiz && story.quiz.length){
    const quizWrap = document.createElement("div");
    quizWrap.className = "card";
    quizWrap.id = "storyQuizCard";
    app.appendChild(quizWrap);
    renderStoryQuiz(quizWrap, story);
  }
}

// Comprehension quiz shown at the end of a story, adapted from the READINGS
// classic-passage qs render/grading pattern (same {q, opts, ans} shape, same
// .opt/.opt.correct/.opt.wrong classes, feedbackFX + awardXP for scoring).
function renderStoryQuiz(container, story){
  const p = storyProgressFor(story.id);
  const total = story.quiz.length;
  if(p.quizCompleted){
    container.innerHTML = `
      <h3 style="margin-top:0;">Comprehension quiz <span class="badge">Score: ${p.quizScore}/${p.quizTotal}</span></h3>
      <p class="muted">You've already completed this story's quiz.</p>
      <button class="secondary" id="retakeQuizBtn">Retake quiz</button>
      <div id="quizQuestions"></div>
    `;
    document.getElementById("retakeQuizBtn").onclick = ()=>{
      p.quizCompleted = false;
      p.quizScore = null;
      p.quizTotal = null;
      saveState();
      renderStoryQuiz(container, story);
    };
    return;
  }
  container.innerHTML = `
    <h3 style="margin-top:0;">Comprehension quiz <span class="badge">${total} question${total===1?"":"s"}</span></h3>
    <p class="muted">Answer these questions about the whole story to check your understanding.</p>
    <div id="quizQuestions"></div>
  `;
  const qsEl = document.getElementById("quizQuestions");
  let answered = 0;
  let correctCount = 0;
  story.quiz.forEach((qq, qi)=>{
    const block = document.createElement("div");
    block.className = "qblock";
    block.innerHTML = `<div>${qi+1}. ${qq.q}</div>`;
    qq.opts.forEach((opt, oi)=>{
      const b = document.createElement("button");
      b.className = "opt";
      b.textContent = opt;
      b.onclick = ()=>{
        [...block.querySelectorAll(".opt")].forEach(x=>x.disabled=true);
        answered++;
        if(oi === qq.ans){
          b.classList.add("correct");
          correctCount++;
          state.correctAnswers = (state.correctAnswers||0)+1;
          saveState();
          feedbackFX(b, true, "+5 XP");
          awardXP(5);
        } else {
          b.classList.add("wrong");
          block.querySelectorAll(".opt")[qq.ans].classList.add("correct");
          state.wrongAnswers = (state.wrongAnswers||0)+1;
          saveState();
          feedbackFX(b, false);
        }
        if(answered === total){
          p.quizCompleted = true;
          p.quizScore = correctCount;
          p.quizTotal = total;
          saveState();
        }
      };
      block.appendChild(b);
    });
    qsEl.appendChild(block);
  });
}

// Wires click-to-translate on tokenized spans inside the reader, opening the popup
// with word info plus the containing sentence (for "Translate sentence").
function wireStoryTokClicks(container, sentZh, sentEn){
  container.querySelectorAll(".tok").forEach(span=>{
    span.onclick = ()=>{
      container.querySelectorAll(".tok.picked").forEach(s=>s.classList.remove("picked"));
      span.classList.add("picked");
      const word = decodeURIComponent(span.dataset.word);
      const sentSpan = span.closest(".sent");
      const sidx = sentSpan ? parseInt(sentSpan.dataset.sidx,10) : 0;
      openWordPopup(word, sentZh[sidx] || "", sentEn[sidx] || "");
    };
  });
}

/* ---- Translation popup ---- */
function closeWordPopup(){
  const el = document.getElementById("wordPopOverlay");
  if(el) el.remove();
}

function openWordPopup(word, sentenceZh, sentenceEn){
  closeWordPopup();
  const info = wordInfo(word);
  const overlay = document.createElement("div");
  overlay.className = "word-pop-overlay";
  overlay.id = "wordPopOverlay";
  const saved = !!state.savedWords[word];
  const lvlBadge = info && info.level ? `<span class="lvl-badge lvl-${info.level}">${LEVEL_LABEL[info.level]}</span>` : `<span class="lvl-badge">&mdash;</span>`;
  const defsHtml = info
    ? info.defs.map((d,i)=>`<div>${i+1}. ${d}</div>`).join("")
    : `<div class="muted">No definition found.</div>`;
  overlay.innerHTML = `
    <div class="word-pop">
      <div class="word-pop-head">
        <div>
          <div class="word-pop-zh">${word}</div>
          <div class="word-pop-py">${info ? info.pinyin : "&mdash;"}</div>
        </div>
        ${lvlBadge}
        <div class="word-pop-icons">
          <button id="wpSave" class="${saved?"saved":""}" title="Save word">${saved?"★":"☆"}</button>
          <button id="wpListen" title="Listen">🔊</button>
        </div>
      </div>
      <div class="word-pop-defs">${defsHtml}</div>
      <button class="word-pop-sentence-toggle" id="wpSentToggle">Translate sentence &#9662;</button>
      <div class="word-pop-sentence" id="wpSentBody" style="display:none;">
        <div class="passage small">${tokenizeHanzi(sentenceZh)}</div>
        <p class="muted">${sentenceEn || "No translation available for this sentence."}</p>
        <button class="secondary" id="wpSentPlay">▶️ Play sentence</button>
      </div>
      <button class="word-pop-close" id="wpClose">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e)=>{ if(e.target === overlay) closeWordPopup(); });
  document.getElementById("wpClose").onclick = closeWordPopup;
  document.getElementById("wpListen").onclick = ()=> speak(word, {cancelFirst:true});
  document.getElementById("wpSave").onclick = (e)=>{
    if(state.savedWords[word]) delete state.savedWords[word];
    else state.savedWords[word] = true;
    saveState();
    openWordPopup(word, sentenceZh, sentenceEn);
  };
  document.getElementById("wpSentToggle").onclick = ()=>{
    const body = document.getElementById("wpSentBody");
    const showing = body.style.display !== "none";
    body.style.display = showing ? "none" : "block";
  };
  document.getElementById("wpSentPlay").onclick = ()=> speak(sentenceZh, {cancelFirst:true});
}

/* ---- Audiobook-style playback bar ----
   No real audio files: driven off speak()/SpeechSynthesisUtterance events, chaining
   through the chapter's sentences. Duration is estimated per sentence from character
   count, and elapsed time is corrected against real onstart/onend events rather than
   only a timer, so the progress bar stays reasonably accurate. */
let playerState = null; // {sentences, durations, cumulative, total, idx, playing, elapsedBase, segStart, tickId}

function estimateDurationMs(sentence){
  return Math.max(600, sentence.length * 280);
}

function stopPlayback(){
  if(typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  if(playerState && playerState.tickId) clearInterval(playerState.tickId);
  playerState = null;
  const bar = document.getElementById("storyPlayBar");
  if(bar) bar.remove();
  document.querySelectorAll(".sent.speaking").forEach(s=>s.classList.remove("speaking"));
}

function fmtTime(ms){
  const totalSec = Math.max(0, Math.round(ms/1000));
  const m = Math.floor(totalSec/60);
  const sec = totalSec % 60;
  return m + ":" + String(sec).padStart(2,"0");
}

function initPlayBar(sentences){
  if(playerState) stopPlayback();
  const durations = sentences.map(estimateDurationMs);
  const cumulative = [];
  let acc = 0;
  durations.forEach(d=>{ cumulative.push(acc); acc += d; });
  const total = acc;
  playerState = { sentences, durations, cumulative, total, idx: 0, playing: false, elapsedBase: 0, segStart: 0, tickId: null };

  const bar = document.createElement("div");
  bar.className = "play-bar";
  bar.id = "storyPlayBar";
  bar.innerHTML = `
    <button class="pb-play" id="pbPlay">▶️</button>
    <button class="pb-mini" id="pbRestart" title="Restart">↺</button>
    <span class="pb-time" id="pbTime">0:00 / ${fmtTime(total)}</span>
    <input type="range" id="pbScrub" min="0" max="${Math.max(total,1)}" value="0">
  `;
  document.body.appendChild(bar);
  document.getElementById("pbPlay").onclick = ()=> togglePlay();
  document.getElementById("pbRestart").onclick = ()=> restartPlayback();
  const scrub = document.getElementById("pbScrub");
  scrub.oninput = (e)=>{ updatePlayBarTime(parseInt(e.target.value,10)); };
  scrub.onchange = (e)=>{ seekPlayback(parseInt(e.target.value,10)); };
}

function updatePlayBarTime(elapsedMs){
  const timeEl = document.getElementById("pbTime");
  const scrub = document.getElementById("pbScrub");
  if(!playerState) return;
  if(timeEl) timeEl.textContent = fmtTime(elapsedMs) + " / " + fmtTime(playerState.total);
  if(scrub && document.activeElement !== scrub) scrub.value = String(Math.round(elapsedMs));
}

function highlightSentence(idx){
  document.querySelectorAll(".sent.speaking").forEach(s=>s.classList.remove("speaking"));
  const el = document.querySelector(`.sent[data-sidx="${idx}"]`);
  if(el) el.classList.add("speaking");
}

function tickPlayback(){
  if(!playerState || !playerState.playing) return;
  const elapsed = playerState.elapsedBase + (Date.now() - playerState.segStart);
  updatePlayBarTime(Math.min(elapsed, playerState.total));
}

function speakSentenceAt(idx){
  if(!playerState) return;
  if(idx >= playerState.sentences.length){
    playerState.playing = false;
    const btn = document.getElementById("pbPlay");
    if(btn) btn.textContent = "▶️";
    updatePlayBarTime(playerState.total);
    document.querySelectorAll(".sent.speaking").forEach(s=>s.classList.remove("speaking"));
    return;
  }
  playerState.idx = idx;
  playerState.elapsedBase = playerState.cumulative[idx];
  highlightSentence(idx);
  speak(playerState.sentences[idx], {
    cancelFirst: true,
    onstart: ()=>{ playerState.segStart = Date.now(); },
    onend: ()=>{
      if(!playerState || !playerState.playing) return;
      speakSentenceAt(idx+1);
    }
  });
}

function togglePlay(){
  if(!playerState) return;
  const btn = document.getElementById("pbPlay");
  if(playerState.playing){
    playerState.playing = false;
    speechSynthesis.cancel();
    if(btn) btn.textContent = "▶️";
  } else {
    playerState.playing = true;
    if(btn) btn.textContent = "⏸️";
    const startIdx = playerState.idx < playerState.sentences.length ? playerState.idx : 0;
    speakSentenceAt(startIdx);
    if(playerState.tickId) clearInterval(playerState.tickId);
    playerState.tickId = setInterval(tickPlayback, 250);
  }
}

function restartPlayback(){
  if(!playerState) return;
  speechSynthesis.cancel();
  playerState.idx = 0;
  playerState.elapsedBase = 0;
  updatePlayBarTime(0);
  if(!playerState.playing){ togglePlay(); }
  else { speakSentenceAt(0); }
}

function seekPlayback(targetMs){
  if(!playerState) return;
  let idx = 0;
  for(let i=0;i<playerState.cumulative.length;i++){
    if(playerState.cumulative[i] <= targetMs) idx = i; else break;
  }
  speechSynthesis.cancel();
  playerState.idx = idx;
  playerState.elapsedBase = playerState.cumulative[idx];
  updatePlayBarTime(playerState.elapsedBase);
  highlightSentence(idx);
  if(playerState.playing) speakSentenceAt(idx);
}


function renderReadingClassic(app){
  if(readingIndex === null) readingIndex = dayOfYear() % READINGS.length;
  if(picReadingIndex === null) picReadingIndex = Math.floor(Math.random()*PIC_READING.length);
  const r = READINGS[readingIndex];
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card">
      <div class="tab-hero">${mascotBounceImg("idea-lightbulb-pixel.png","")}<h3>${r.title} <span class="badge">passage ${readingIndex+1} of ${READINGS.length}</span></h3></div>
      <p class="muted">Tap any word in the passage to see its pinyin and meaning.</p>
      <div class="passage" id="passageText">${tokenizeHanzi(r.zh)}</div>
      <div class="transbar" id="transBar">Tap a word to translate it here.</div>
      <div class="flash-controls" style="margin-top:14px;">
        <button class="toggle-link" id="toggleEn">Show English translation</button>
        <button class="secondary" id="nextPassage">Next passage →</button>
      </div>
      <p id="enBlock" style="display:none;" class="muted">${r.en}</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Comprehension</h3>
      <div id="qs"></div>
    </div>
    <div class="card" id="picReadingCard"></div>
  `;
  app.appendChild(wrap);
  wireTokClicks(document.getElementById("passageText"), "transBar");
  document.getElementById("toggleEn").onclick = (e)=>{
    const b = document.getElementById("enBlock");
    const showing = b.style.display !== "none";
    b.style.display = showing ? "none" : "block";
    e.target.textContent = showing ? "Show English translation" : "Hide English translation";
  };
  document.getElementById("nextPassage").onclick = ()=>{
    readingIndex = (readingIndex+1) % READINGS.length;
    render();
  };
  const qsEl = document.getElementById("qs");
  r.qs.forEach((qq, qi)=>{
    const block = document.createElement("div");
    block.className = "qblock";
    block.innerHTML = `<div>${qi+1}. ${qq.q}</div>`;
    qq.opts.forEach((opt, oi)=>{
      const b = document.createElement("button");
      b.className = "opt";
      b.textContent = opt;
      b.onclick = ()=>{
        [...block.querySelectorAll(".opt")].forEach(x=>x.disabled=true);
        if(oi === qq.ans){
          b.classList.add("correct");
          state.correctAnswers = (state.correctAnswers||0)+1;
          saveState();
          feedbackFX(b, true, "+5 XP");
          awardXP(5);
        } else {
          b.classList.add("wrong");
          block.querySelectorAll(".opt")[qq.ans].classList.add("correct");
          state.wrongAnswers = (state.wrongAnswers||0)+1;
          saveState();
          feedbackFX(b, false);
        }
      };
      block.appendChild(b);
    });
    qsEl.appendChild(block);
  });
  renderPicReading(document.getElementById("picReadingCard"));
}

function renderPicReading(container){
  const p = PIC_READING[picReadingIndex];
  container.innerHTML = `
    <h3 style="margin-top:0;">Picture reading <span class="badge">HSK-style true/false</span></h3>
    <p class="muted">Does the sentence correctly describe the picture?</p>
    <div class="pic-emoji">${p.emoji}</div>
    <div class="passage small" id="picSentence" style="text-align:center;">${tokenizeHanzi(p.zh)}</div>
    <div class="transbar" id="picTransBar">Tap a word to translate it here.</div>
    <div class="tf-btns">
      <button class="secondary" data-ans="true">✅ Correct</button>
      <button class="secondary" data-ans="false">❌ Incorrect</button>
    </div>
    <div class="flash-controls" style="margin-top:12px;">
      <button class="secondary" id="nextPicReading">Next picture →</button>
    </div>
  `;
  wireTokClicks(document.getElementById("picSentence"), "picTransBar");
  container.querySelectorAll("[data-ans]").forEach(b=>{
    b.onclick = ()=>{
      const guess = b.dataset.ans === "true";
      container.querySelectorAll("[data-ans]").forEach(x=>x.disabled=true);
      if(guess === p.correct){
        b.classList.add("g-good");
        state.picCorrect = (state.picCorrect||0)+1;
        state.correctAnswers = (state.correctAnswers||0)+1;
        saveState();
        feedbackFX(b, true, "+4 XP");
        awardXP(4);
      } else {
        b.classList.add("wrong");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
      }
      const correctBtn = [...container.querySelectorAll("[data-ans]")].find(x=>(x.dataset.ans==="true")===p.correct);
      correctBtn.classList.add("g-good");
    };
  });
  document.getElementById("nextPicReading").onclick = ()=>{
    picReadingIndex = (picReadingIndex+1) % PIC_READING.length;
    renderPicReading(container);
  };
}

/* ---- Listening ---- */
let listeningIndex = null;
let picListening = null;

function renderListening(app){
  if(listeningIndex === null) listeningIndex = dayOfYear() % LISTENING.length;
  const l = LISTENING[listeningIndex];
  renderVoicePicker(app);
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card center">
      <div class="tab-hero" style="justify-content:center;">${mascotBounceImg("in-glowing-aura.png","")}<h3>Listening practice <span class="badge">clip ${listeningIndex+1} of ${LISTENING.length}</span></h3></div>
      <p class="muted">Press play, listen, then answer. Transcript is hidden until you check — tap any word in it to translate.</p>
      <button class="primary" id="playL">▶️ Play</button>
    </div>
    <div class="card">
      <div>${l.q}</div>
      <div id="opts"></div>
    </div>
    <div class="card" id="transcriptCard" style="display:none;">
      <div class="passage small" id="transcriptText">${tokenizeHanzi(l.zh)}</div>
      <div class="transbar" id="listenTransBar">Tap a word to translate it here.</div>
      <p class="muted">${l.en}</p>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="nextClip">Next clip →</button>
    </div>
    <div class="card" id="picListeningCard"></div>
  `;
  app.appendChild(wrap);
  document.getElementById("playL").onclick=()=>speak(l.zh);
  document.getElementById("nextClip").onclick=()=>{
    listeningIndex = (listeningIndex+1) % LISTENING.length;
    render();
  };
  const optsEl = document.getElementById("opts");
  l.opts.forEach((opt, oi)=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt;
    b.onclick=()=>{
      [...optsEl.querySelectorAll(".opt")].forEach(x=>x.disabled=true);
      if(oi===l.ans){
        b.classList.add("correct");
        saveState();
        feedbackFX(b, true, "+5 XP");
        awardXP(5);
      } else {
        b.classList.add("wrong");
        [...optsEl.querySelectorAll(".opt")][l.ans].classList.add("correct");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
      }
    };
    optsEl.appendChild(b);
  });
  document.getElementById("transcriptCard").style.display = "none";
  const showTranscript = document.createElement("button");
  showTranscript.className = "toggle-link";
  showTranscript.textContent = "Show transcript";
  showTranscript.style.marginTop = "8px";
  showTranscript.onclick = ()=>{
    const card = document.getElementById("transcriptCard");
    const showing = card.style.display !== "none";
    card.style.display = showing ? "none" : "block";
    showTranscript.textContent = showing ? "Show transcript" : "Hide transcript";
  };
  optsEl.parentElement.appendChild(showTranscript);
  wireTokClicks(document.getElementById("transcriptText"), "listenTransBar");
  state.listeningCompleted = (state.listeningCompleted||0)+1;
  renderPicListening(document.getElementById("picListeningCard"));
}

let picListeningIndex = null;
function renderPicListening(container){
  if(picListeningIndex === null) picListeningIndex = Math.floor(Math.random()*PIC_READING.length);
  const p = PIC_READING[picListeningIndex];
  container.innerHTML = `
    <h3 style="margin-top:0;">Picture listening <span class="badge">listen &amp; judge</span></h3>
    <p class="muted">Press play, then decide if the sentence matches the picture.</p>
    <div class="pic-emoji">${p.emoji}</div>
    <button class="primary" id="playPicL">▶️ Play</button>
    <div class="tf-btns">
      <button class="secondary" data-ans="true">✅ Correct</button>
      <button class="secondary" data-ans="false">❌ Incorrect</button>
    </div>
    <div class="flash-controls" style="margin-top:12px;">
      <button class="secondary" id="nextPicListening">Next clip →</button>
    </div>
  `;
  document.getElementById("playPicL").onclick = ()=>speak(p.zh);
  container.querySelectorAll("[data-ans]").forEach(b=>{
    b.onclick = ()=>{
      const guess = b.dataset.ans === "true";
      container.querySelectorAll("[data-ans]").forEach(x=>x.disabled=true);
      if(guess === p.correct){
        b.classList.add("g-good");
        state.picCorrect = (state.picCorrect||0)+1;
        state.correctAnswers = (state.correctAnswers||0)+1;
        saveState();
        feedbackFX(b, true, "+4 XP");
        awardXP(4);
      } else {
        b.classList.add("wrong");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
      }
      const correctBtn = [...container.querySelectorAll("[data-ans]")].find(x=>(x.dataset.ans==="true")===p.correct);
      correctBtn.classList.add("g-good");
    };
  });
  document.getElementById("nextPicListening").onclick = ()=>{
    picListeningIndex = (picListeningIndex+1) % PIC_READING.length;
    renderPicListening(container);
  };
}

/* ---- Practice ---- */
// Three sub-modes sharing one Practice tab: fill-in-the-blank multiple choice
// (original mode), word-order sentence arrangement, and true/false translation
// judgment. All three draw on VOCAB/EXTRA_WORDS entries enriched with an
// authored example sentence (extra.sentence = {zh, py, en}).
let practiceMode = "fill";

// ---- Fill-in-the-blank pool (unchanged from the original round) ----
// Builds the question pool once: any VOCAB/EXTRA_WORDS entry that has an authored
// example sentence (added in an earlier round) containing the headword itself, so we
// can reliably blank out the headword from real, natural sentences rather than
// generating awkward templates. Falls back gracefully if a sentence doesn't actually
// contain the exact headword substring (skipped, since we can't blank it cleanly).
let practiceOrder = null;
let practiceIndex = 0;
let practiceOrderKey = null;
let practiceScore = null;
// Set to {mode, answered, correct, xp, wordCount, words} the moment a session's
// last question is advanced past; renderPractice() shows the recap card instead
// of the next mode-question until the user dismisses it.
let practiceRecap = null;

// Shared "has the learner started this word" predicate, reused verbatim by every
// Practice pool builder (fill-in-blank, word-order, true/false, word match) so all
// four modes draw from exactly the same word set. A word counts as started once its
// SRS card exists and has left the "new" state (i.e. graded at least once as a
// flashcard) -- the exact same definition used by wordsProgressHeader()'s "N / M
// words started" readout. Note EXTRA_WORDS entries have no SRS card of their own
// (only VOCAB words are ever introduced into state.cards), so they never qualify --
// practice questions are drawn only from VOCAB words the learner has started.
function isStartedWord(idx){
  const c = getCard(idx);
  return c && c.state !== "new";
}
// Same "started" requirement as above, plus the user's chosen HSK level and
// knowledge-tier (wordCategory()) filters for the Practice tab. Used by every
// Practice pool builder (fill-in-blank, word-order, true/false, word match) so
// the level/knowledge picker applies consistently across all four modes.
function isPracticeEligible(idx){
  return isStartedWord(idx)
    && activePracticeLevels().includes(vocabLevel(idx))
    && activePracticeCategories().includes(wordCategory(idx));
}

// Recomputed fresh on every call (cheap: a few hundred words at most) rather than
// memoized, since "started" status changes live as the learner studies flashcards.
function buildPracticePool(){
  const pool = [];
  VOCAB.forEach((w, idx)=>{
    if(!isPracticeEligible(idx)) return;
    const extra = w[4];
    if(extra && extra.sentence && extra.sentence.zh && extra.sentence.zh.indexOf(w[0]) !== -1){
      pool.push({hanzi: w[0], py: w[1], en: w[2], sentence: extra.sentence});
    }
  });
  return pool;
}

// ---- Shared sentence pool for word-order + true/false modes ----
// Every started VOCAB entry with a complete authored example sentence, deduped by
// the Chinese sentence text (several headwords can share one sentence).
function buildSentencePool(){
  const seen = new Set();
  const pool = [];
  VOCAB.forEach((w, idx)=>{
    if(!isPracticeEligible(idx)) return;
    const extra = w[4];
    if(extra && extra.sentence && extra.sentence.zh && extra.sentence.py && extra.sentence.en){
      if(seen.has(extra.sentence.zh)) return;
      seen.add(extra.sentence.zh);
      pool.push({zh: extra.sentence.zh, py: extra.sentence.py, en: extra.sentence.en});
    }
  });
  return pool;
}

// Fisher-Yates shuffle, used for question order and multiple-choice option order.
function shufflePractice(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Builds a session's question order from `pool`, preferring items whose stable
// identity (from idFn) was NOT part of the mode's immediately-prior session
// (state.lastPracticeSet[mode]) so consecutive sessions feel fresh instead of
// risking an immediate repeat of the same words. Falls back to allowing repeats
// (drawn from the previously-used set) only when the never-used remainder is
// smaller than the requested session size, so a session is never short.
function buildRotatedOrder(pool, idFn, excludeIds, size){
  const exclude = new Set(excludeIds || []);
  const idxs = pool.map((_, i) => i);
  const fresh = idxs.filter(i => !exclude.has(idFn(pool[i])));
  const stale = idxs.filter(i => exclude.has(idFn(pool[i])));
  const combined = shufflePractice(fresh).concat(shufflePractice(stale));
  return combined.slice(0, size);
}
// Called when the user advances past a session's final question. Records this
// session's word/sentence identities as the mode's "just used" set (consulted by
// buildRotatedOrder() next time), builds the recap summary shown in place of the
// next question, and clears the mode's session so a fresh (rotated) one is built
// next time the user starts this mode again.
function finishPracticeSession(mode, pool, order, score, idFn){
  const usedIds = [...new Set(order.map(i => idFn(pool[i])))];
  state.lastPracticeSet[mode] = usedIds;
  saveState();
  const words = (mode === "match" || mode === "write") ? usedIds.map(idx => VOCAB[idx][0]) : usedIds;
  practiceRecap = { mode, answered: score.answered, correct: score.correct, xp: score.xp, wordCount: words.length, words };
  resetModeSession(mode);
  render();
}
// Clears a single mode's in-memory session state (order/index/key) so its next
// render rebuilds a fresh session from scratch.
function resetModeSession(mode){
  if(mode === "fill"){ practiceOrder = null; practiceIndex = 0; practiceOrderKey = null; }
  else if(mode === "order"){ woOrder = null; woIndex = 0; woOrderKey = null; }
  else if(mode === "tf"){ tfOrder = null; tfIndex = 0; tfOrderKey = null; }
  else if(mode === "match"){ wmOrder = null; wmIndex = 0; wmOrderKey = null; }
  else if(mode === "write"){ hwOrder = null; hwIndex = 0; hwOrderKey = null; }
}
// Renders the end-of-session recap card in place of the next mode-question. Both
// buttons simply clear the recap and re-render -- the mode's session was already
// cleared by finishPracticeSession(), so the next render naturally builds a fresh
// (rotated) session, and the mode picker itself is always visible above
// #practiceBody, so "back to modes" doubles as returning to the picker.
function renderPracticeRecap(container){
  const r = practiceRecap;
  const modeLabel = {fill:"Fill in the Blank", order:"Word Order", tf:"True or False", match:"Word Match", write:"Write It"}[r.mode] || "Practice";
  const acc = r.answered ? Math.round((r.correct / r.answered) * 100) : 0;
  const shown = r.words.slice(0, 12).map(w => w.length > 16 ? w.slice(0, 16) + "…" : w);
  const wordsLine = shown.length ? shown.join("、") + (r.words.length > 12 ? "…" : "") : "";
  container.innerHTML = `
    <div class="card center">
      <div class="tab-hero" style="justify-content:center;">${mascotBounceImg("success-achievement-milestone.png","")}<h3>Session complete! <span class="badge">${modeLabel}</span></h3></div>
      <p class="muted">Nice work — here's how that session went.</p>
      <div class="stat-row">
        <div class="stat"><div class="num">${r.answered}</div><div class="lbl">questions answered</div></div>
        <div class="stat"><div class="num">${r.correct}</div><div class="lbl">correct</div></div>
        <div class="stat"><div class="num">${acc}%</div><div class="lbl">accuracy</div></div>
        <div class="stat"><div class="num">${r.xp}</div><div class="lbl">XP earned</div></div>
      </div>
      <p class="muted" style="margin-top:10px;">${r.wordCount} word${r.wordCount===1?"":"s"} practiced this session${wordsLine ? ": "+wordsLine : ""}.</p>
    </div>
    <div class="flash-controls">
      <button class="primary" id="recapAgain">Practice again</button>
      <button class="secondary" id="recapBack">Back to modes</button>
    </div>
  `;
  const dismiss = ()=>{ practiceRecap = null; render(); };
  container.querySelector("#recapAgain").onclick = dismiss;
  container.querySelector("#recapBack").onclick = dismiss;
}
// Splits a Chinese sentence into tappable word/phrase chunks using the same
// DICT-based longest-match segmentation as tokenizeHanzi(), but returns a plain
// array of chunk strings (instead of tokenized HTML) for the word-order game.
// Non-Chinese characters (punctuation, spaces) are merged onto the previous chunk
// so a chunk never ends up as a lone comma or period.
function tokenizeWords(text){
  const out = [];
  let i = 0;
  while(i < text.length){
    const ch = text[i];
    if(!CJK_RE.test(ch)){
      if(out.length){ out[out.length-1] += ch; } else { out.push(ch); }
      i++; continue;
    }
    let matched = false;
    for(let len = Math.min(DICT_MAXLEN, text.length - i); len >= 1; len--){
      const seg = text.slice(i, i+len);
      if(DICT[seg]){ out.push(seg); i += len; matched = true; break; }
    }
    if(!matched){ out.push(ch); i++; }
  }
  return out;
}
// Picks 3 wrong-answer options for a question. Prefers other pool words of the same
// character length (a rough proxy for similar part-of-speech/difficulty so distractors
// feel plausible rather than obviously wrong at a glance), then falls back to any other
// pool word, then finally to any word in the full vocab list if the pool is small.
function practiceDistractors(q, pool, allWords){
  const result = [];
  const sameLen = shufflePractice([...new Set(
    pool.filter(p => p.hanzi !== q.hanzi && p.hanzi.length === q.hanzi.length).map(p => p.hanzi)
  )]);
  for(const c of sameLen){ if(result.length >= 3) break; result.push(c); }
  if(result.length < 3){
    const morePool = shufflePractice([...new Set(
      pool.filter(p => p.hanzi !== q.hanzi && !result.includes(p.hanzi)).map(p => p.hanzi)
    )]);
    for(const c of morePool){ if(result.length >= 3) break; result.push(c); }
  }
  if(result.length < 3){
    const moreAll = shufflePractice([...new Set(
      allWords.filter(w => w[0] !== q.hanzi && !result.includes(w[0])).map(w => w[0])
    )]);
    for(const c of moreAll){ if(result.length >= 3) break; result.push(c); }
  }
  return result;
}

// Top-level Practice tab: shared header + mode switcher, then delegates to
// whichever sub-mode is currently selected.
// How many questions a session should draw from a (started-words-filtered) pool
// of the given size, honoring the user's persisted state.practiceCount choice.
// "all" (the default) uses the whole pool; otherwise capped at the pool size so
// picking a count larger than what's available just uses everything (no error).
function sessionSize(poolLen){
  if(state.practiceCount === "all") return poolLen;
  const n = parseInt(state.practiceCount, 10);
  return Number.isFinite(n) ? Math.min(poolLen, n) : poolLen;
}
// Resets every mode's session order so the next render draws a fresh random
// sample at the newly-chosen count (called whenever the count picker changes).
function resetPracticeSessions(){
  practiceOrder = null; practiceIndex = 0; practiceScore = null;
  woOrder = null; woIndex = 0; woScore = null;
  tfOrder = null; tfIndex = 0; tfScore = null;
  wmOrder = null; wmIndex = 0; wmScore = null;
  hwOrder = null; hwIndex = 0; hwScore = null;
  practiceRecap = null;
}
function renderPractice(app){
  const fillPool = buildPracticePool();
  const sentPool = buildSentencePool();
  const matchPool = buildWordMatchPool();
  const writePool = buildHandwritingPool();
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card">
      <div class="tab-hero">${mascotBounceImg("success-achievement-milestone.png","")}<h3>Practice</h3></div>
      <p class="muted">${fillPool.length + sentPool.length * 2 + matchPool.length + writePool.length} practice questions available across five exercise types, HSK-exam style, drawn only from words you've started -- filter by HSK level and how well you know them below.</p>
      <div class="lib-filters" id="practiceModeFilters">
        <button data-m="fill" class="${practiceMode==='fill'?'active':''}">Fill in the Blank (${fillPool.length})</button>
        <button data-m="order" class="${practiceMode==='order'?'active':''}">Word Order (${sentPool.length})</button>
        <button data-m="tf" class="${practiceMode==='tf'?'active':''}">True or False (${sentPool.length})</button>
        <button data-m="match" class="${practiceMode==='match'?'active':''}">Word Match (${matchPool.length})</button>
        ${writePool.length || strokesAvailable() ? `<button data-m="write" class="${practiceMode==='write'?'active':''}">Write It (${writePool.length})</button>` : ""}
      </div>
      <div class="muted" style="font-weight:800;margin:8px 0 4px;">HSK level</div>
      <div class="lib-filters" id="practiceLevelFilters">
        <button data-lv="1" class="${activePracticeLevels().includes(1)?'active':''}">HSK 1</button>
        <button data-lv="2" class="${activePracticeLevels().includes(2)?'active':''}">HSK 2</button>
        <button data-lv="3" class="${activePracticeLevels().includes(3)?'active':''}">HSK 3</button>
      </div>
      <div class="muted" style="font-weight:800;margin:8px 0 4px;">Knowledge level</div>
      <div class="lib-filters" id="practiceCatFilters">
        <button data-cat="learning" class="${activePracticeCategories().includes('learning')?'active':''}">Learning</button>
        <button data-cat="familiar" class="${activePracticeCategories().includes('familiar')?'active':''}">Familiar</button>
        <button data-cat="mastered" class="${activePracticeCategories().includes('mastered')?'active':''}">Mastered</button>
      </div>
      <div class="muted" style="font-weight:800;margin:8px 0 4px;">Questions per session</div>
      <div class="lib-filters" id="practiceCountFilters">
        <button data-c="5" class="${state.practiceCount==='5'?'active':''}">5</button>
        <button data-c="10" class="${state.practiceCount==='10'?'active':''}">10</button>
        <button data-c="20" class="${state.practiceCount==='20'?'active':''}">20</button>
        <button data-c="all" class="${state.practiceCount==='all'?'active':''}">All</button>
      </div>
    </div>
    <div id="practiceBody"></div>
  `;
  app.appendChild(wrap);
  document.getElementById("practiceModeFilters").addEventListener("click", e=>{
    const b = e.target.closest("button[data-m]");
    if(!b) return;
    practiceMode = b.dataset.m;
    practiceRecap = null;
    render();
  });
  document.getElementById("practiceLevelFilters").addEventListener("click", e=>{
    const b = e.target.closest("button[data-lv]");
    if(!b) return;
    const lv = Number(b.dataset.lv);
    let cur = activePracticeLevels().slice();
    if(cur.includes(lv)){
      if(cur.length === 1) return; // keep at least one level selected
      cur = cur.filter(x=>x!==lv);
    } else {
      cur = [...cur, lv].sort();
    }
    state.practiceLevels = cur;
    saveState();
    resetPracticeSessions();
    render();
  });
  document.getElementById("practiceCatFilters").addEventListener("click", e=>{
    const b = e.target.closest("button[data-cat]");
    if(!b) return;
    const cat = b.dataset.cat;
    let cur = activePracticeCategories().slice();
    if(cur.includes(cat)){
      if(cur.length === 1) return; // keep at least one tier selected
      cur = cur.filter(x=>x!==cat);
    } else {
      cur = [...cur, cat];
    }
    state.practiceCategories = cur;
    saveState();
    resetPracticeSessions();
    render();
  });
  document.getElementById("practiceCountFilters").addEventListener("click", e=>{
    const b = e.target.closest("button[data-c]");
    if(!b) return;
    state.practiceCount = b.dataset.c;
    saveState();
    resetPracticeSessions();
    render();
  });
  const body = document.getElementById("practiceBody");
  if(practiceRecap && practiceRecap.mode === practiceMode) renderPracticeRecap(body);
  else if(practiceMode === "order") renderPracticeOrder(body);
  else if(practiceMode === "tf") renderPracticeTF(body);
  else if(practiceMode === "match") renderPracticeWordMatch(body);
  else if(practiceMode === "write") renderPracticeWrite(body);
  else renderPracticeFill(body);
}

// ---- Mode 1: Fill in the blank (multiple choice) ----
function renderPracticeFill(container){
  const pool = buildPracticePool();
  const allWords = VOCAB.concat(EXTRA_WORDS);
  if(!pool.length){
    container.innerHTML = `
      <div class="card">
        <p class="muted">No started words match the current HSK level / knowledge level filters. Study a few more flashcards, or broaden the filters above, then come back here to practice fill-in-the-blank questions.</p>
      </div>`;
    return;
  }
  const practiceOrderKeyNow = pool.length + "|" + state.practiceCount;
  if(!practiceOrder || practiceOrderKey !== practiceOrderKeyNow){
    practiceOrder = buildRotatedOrder(pool, p => p.hanzi, state.lastPracticeSet.fill, sessionSize(pool.length));
    practiceOrderKey = practiceOrderKeyNow;
    practiceIndex = 0;
    practiceScore = {correct:0, answered:0, xp:0};
  }
  const qNum = (practiceIndex % practiceOrder.length);
  const q = pool[practiceOrder[qNum]];
  const blankSentence = q.sentence.zh.replace(q.hanzi, '<span class="practice-blank">____</span>');
  const distractors = practiceDistractors(q, pool, allWords);
  const options = shufflePractice([q.hanzi].concat(distractors));
  const correctIdx = options.indexOf(q.hanzi);
  const pct = Math.round(((qNum + 1) / practiceOrder.length) * 100);

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Fill in the blank <span class="badge">question ${qNum+1} of ${practiceOrder.length}</span></h3>
      <p class="muted">Pick the word that correctly fills the blank in the sentence.</p>
      <div class="progress-header">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        <div class="muted center" style="margin-top:4px;font-size:12px;">Question ${qNum+1} / ${practiceOrder.length} · ${pct}%</div>
      </div>
    </div>
    <div class="card center">
      <div class="passage" id="practiceSentence" style="font-size:22px;">${blankSentence}</div>
      <div id="opts"></div>
      <div class="card" id="practiceAnswerCard" style="display:none;margin-top:10px;">
        <div class="pinyin">${q.sentence.py}</div>
        <div class="meaning">${q.sentence.en}</div>
      </div>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="nextPractice">Next question →</button>
    </div>
  `;
  const optsEl = container.querySelector("#opts");
  options.forEach((opt, oi)=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt;
    b.onclick = ()=>{
      [...optsEl.querySelectorAll(".opt")].forEach(x=>x.disabled=true);
      container.querySelector("#practiceAnswerCard").style.display = "block";
      const xpBefore = state.xp;
      if(oi === correctIdx){
        b.classList.add("correct");
        state.correctAnswers = (state.correctAnswers||0)+1;
        saveState();
        feedbackFX(b, true, "+5 XP");
        awardXP(5);
      } else {
        b.classList.add("wrong");
        [...optsEl.querySelectorAll(".opt")][correctIdx].classList.add("correct");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
      }
      practiceScore.answered++;
      if(oi === correctIdx) practiceScore.correct++;
      practiceScore.xp += state.xp - xpBefore;
    };
    optsEl.appendChild(b);
  });
  container.querySelector("#nextPractice").onclick = ()=>{
    if(qNum === practiceOrder.length - 1){
      finishPracticeSession("fill", pool, practiceOrder, practiceScore, p => p.hanzi);
    } else {
      practiceIndex = practiceIndex + 1;
      render();
    }
  };
}

// ---- Mode 2: Word-order sentence arrangement ----
// Given a sentence from the shared sentence pool, split it into tappable word
// chunks with tokenizeWords(), shuffle them, and let the user tap them in order
// to rebuild the original sentence. Validates against the exact original string.
let woOrder = null;
let woIndex = 0;
let woOrderKey = null;
let woScore = null;
function renderPracticeOrder(container){
  const pool = buildSentencePool();
  if(!pool.length){
    container.innerHTML = `<div class="card"><p class="muted">No started words match the current HSK level / knowledge level filters. Study a few more flashcards, or broaden the filters above, then come back here to practice word-order sentences.</p></div>`;
    return;
  }
  const woOrderKeyNow = pool.length + "|" + state.practiceCount;
  if(!woOrder || woOrderKey !== woOrderKeyNow){
    woOrder = buildRotatedOrder(pool, p => p.zh, state.lastPracticeSet.order, sessionSize(pool.length));
    woOrderKey = woOrderKeyNow;
    woIndex = 0;
    woScore = {correct:0, answered:0, xp:0};
  }
  const qNum = woIndex % woOrder.length;
  const q = pool[woOrder[qNum]];
  const chunks = tokenizeWords(q.zh);
  const shuffledIdx = shufflePractice(chunks.map((_, i) => i));
  let selected = [];
  let answered = false;
  const pct = Math.round(((qNum + 1) / woOrder.length) * 100);

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Word order <span class="badge">question ${qNum+1} of ${woOrder.length}</span></h3>
      <p class="muted">Tap the chunks in the correct order to rebuild the sentence.</p>
      <div class="progress-header">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        <div class="muted center" style="margin-top:4px;font-size:12px;">Question ${qNum+1} / ${woOrder.length} · ${pct}%</div>
      </div>
    </div>
    <div class="card center">
      <div class="answer-row" id="woAnswerRow"></div>
      <div class="chunk-tray" id="woTray"></div>
      <div class="card" id="woAnswerCard" style="display:none;margin-top:10px;">
        <div class="pinyin">${q.py}</div>
        <div class="meaning">${q.en}</div>
      </div>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="woReset">Reset</button>
      <button class="secondary" id="woNext">Next question →</button>
    </div>
  `;
  const trayEl = container.querySelector("#woTray");
  const answerRow = container.querySelector("#woAnswerRow");

  function renderAnswerRow(){
    answerRow.innerHTML = selected.length
      ? selected.map(ci=>`<span>${chunks[ci]}</span>`).join("")
      : `<span class="muted" style="font-size:15px;">Tap the chunks below in order…</span>`;
  }
  function renderTray(){
    trayEl.innerHTML = "";
    shuffledIdx.forEach(ci=>{
      const b = document.createElement("button");
      b.className = "chunk";
      b.textContent = chunks[ci];
      b.disabled = selected.includes(ci) || answered;
      b.onclick = ()=>{
        if(answered || selected.includes(ci)) return;
        selected.push(ci);
        renderAnswerRow();
        renderTray();
        if(selected.length === chunks.length) checkAnswer();
      };
      trayEl.appendChild(b);
    });
  }
  function checkAnswer(){
    answered = true;
    container.querySelector("#woAnswerCard").style.display = "block";
    const built = selected.map(ci=>chunks[ci]).join("");
    const correct = built === q.zh;
    const xpBefore = state.xp;
    if(correct){
      state.correctAnswers = (state.correctAnswers||0)+1;
      state.orderCorrect = (state.orderCorrect||0)+1;
      saveState();
      feedbackFX(answerRow, true, "+5 XP");
      awardXP(5);
    } else {
      state.wrongAnswers = (state.wrongAnswers||0)+1;
      saveState();
      feedbackFX(answerRow, false);
      answerRow.innerHTML = `<span style="color:var(--red);">${built}</span><br><span class="muted" style="font-size:14px;">Correct: </span><span style="color:var(--green-bright);">${q.zh}</span>`;
    }
    woScore.answered++;
    if(correct) woScore.correct++;
    woScore.xp += state.xp - xpBefore;
    renderTray();
  }
  renderAnswerRow();
  renderTray();
  container.querySelector("#woReset").onclick = ()=>{
    if(answered) return;
    selected = [];
    renderAnswerRow();
    renderTray();
  };
  container.querySelector("#woNext").onclick = ()=>{
    if(qNum === woOrder.length - 1){
      finishPracticeSession("order", pool, woOrder, woScore, p => p.zh);
    } else {
      woIndex = woIndex + 1;
      render();
    }
  };
}

// ---- Mode 3: True/false sentence-translation judgment ----
// Shows a Chinese sentence with an English translation that is either correct
// (~50% of the time, decided fresh per question) or swapped for a mismatched
// translation borrowed from a different sentence in the pool.
let tfOrder = null;
let tfIndex = 0;
let tfOrderKey = null;
let tfScore = null;
function renderPracticeTF(container){
  const pool = buildSentencePool();
  if(pool.length < 2){
    container.innerHTML = `<div class="card"><p class="muted">Not enough started words match the current HSK level / knowledge level filters yet. Study a few more flashcards, or broaden the filters above, then come back here for true/false practice.</p></div>`;
    return;
  }
  const tfOrderKeyNow = pool.length + "|" + state.practiceCount;
  if(!tfOrder || tfOrderKey !== tfOrderKeyNow){
    tfOrder = buildRotatedOrder(pool, p => p.zh, state.lastPracticeSet.tf, sessionSize(pool.length));
    tfOrderKey = tfOrderKeyNow;
    tfIndex = 0;
    tfScore = {correct:0, answered:0, xp:0};
  }
  const qNum = tfIndex % tfOrder.length;
  const q = pool[tfOrder[qNum]];
  const isTrue = Math.random() < 0.5;
  let shownEn = q.en;
  if(!isTrue){
    const others = pool.filter(p=>p.en !== q.en);
    shownEn = others[Math.floor(Math.random() * others.length)].en;
  }
  const pct = Math.round(((qNum + 1) / tfOrder.length) * 100);

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">True or false <span class="badge">question ${qNum+1} of ${tfOrder.length}</span></h3>
      <p class="muted">Does the English translation correctly match the Chinese sentence?</p>
      <div class="progress-header">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        <div class="muted center" style="margin-top:4px;font-size:12px;">Question ${qNum+1} / ${tfOrder.length} · ${pct}%</div>
      </div>
    </div>
    <div class="card center">
      <div class="passage small" id="tfZh">${tokenizeHanzi(q.zh)}</div>
      <div class="muted" style="font-size:13px;">${q.py}</div>
      <div class="meaning" style="margin-top:8px;font-weight:700;">"${shownEn}"</div>
      <div class="transbar" id="tfTransBar">Tap a word to translate it here.</div>
      <div class="tf-btns">
        <button class="secondary" data-ans="true">✅ Matches</button>
        <button class="secondary" data-ans="false">❌ Doesn't match</button>
      </div>
      <div class="card" id="tfAnswerCard" style="display:none;margin-top:10px;">
        <div class="meaning">Correct English: ${q.en}</div>
      </div>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="tfNext">Next question →</button>
    </div>
  `;
  wireTokClicks(container.querySelector("#tfZh"), "tfTransBar");
  const btns = [...container.querySelectorAll("[data-ans]")];
  btns.forEach(b=>{
    b.onclick = ()=>{
      btns.forEach(x=>x.disabled=true);
      container.querySelector("#tfAnswerCard").style.display = "block";
      const guess = b.dataset.ans === "true";
      const xpBefore = state.xp;
      if(guess === isTrue){
        b.classList.add("g-good");
        state.correctAnswers = (state.correctAnswers||0)+1;
        state.tfCorrect = (state.tfCorrect||0)+1;
        saveState();
        feedbackFX(b, true, "+4 XP");
        awardXP(4);
      } else {
        b.classList.add("wrong");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
      }
      const correctBtn = btns.find(x=>(x.dataset.ans==="true")===isTrue);
      correctBtn.classList.add("g-good");
      tfScore.answered++;
      if(guess === isTrue) tfScore.correct++;
      tfScore.xp += state.xp - xpBefore;
    };
  });
  container.querySelector("#tfNext").onclick = ()=>{
    if(qNum === tfOrder.length - 1){
      finishPracticeSession("tf", pool, tfOrder, tfScore, p => p.zh);
    } else {
      tfIndex = tfIndex + 1;
      render();
    }
  };
}

// ---- Mode 4: Word match (multiple-choice English definition) ----
// Unlike the three modes above (which track their own correct/wrong tallies
// but never touch SRS state), this mode is scoped to words the learner has
// actually *started* (state.cards[idx].state !== "new" — the exact same
// definition used by wordsProgressHeader()'s "N / M words started" readout),
// shows the hanzi + autoplays its audio, and a correct/incorrect answer here
// calls the real gradeCard() SM-2 grading function, so this mode's answers
// genuinely move the needle on the word's mastery percentage rather than
// just contributing to a separate practice-only counter.
function buildWordMatchPool(){
  return Object.keys(state.cards)
    .map(Number)
    .filter(idx => isPracticeEligible(idx) && VOCAB[idx]);
}
// Picks 3 wrong English-definition options for a word, preferring other pool
// words that share the same HSK level (kept non-trivial), falling back to any
// other VOCAB word if the pool/level doesn't have enough candidates.
function wordMatchDistractors(qIdx, pool){
  const qEn = VOCAB[qIdx][2];
  const qLevel = vocabLevel(qIdx);
  const result = [];
  const sameLevel = shufflePractice([...new Set(
    pool.filter(i => i !== qIdx && vocabLevel(i) === qLevel && VOCAB[i][2] !== qEn).map(i => VOCAB[i][2])
  )]);
  for(const en of sameLevel){ if(result.length >= 3) break; result.push(en); }
  if(result.length < 3){
    const morePool = shufflePractice([...new Set(
      pool.filter(i => i !== qIdx && VOCAB[i][2] !== qEn && !result.includes(VOCAB[i][2])).map(i => VOCAB[i][2])
    )]);
    for(const en of morePool){ if(result.length >= 3) break; result.push(en); }
  }
  if(result.length < 3){
    const allIdx = shufflePractice(VOCAB.map((_, i) => i).filter(i => i !== qIdx && VOCAB[i][2] !== qEn && !result.includes(VOCAB[i][2])));
    for(const i of allIdx){ if(result.length >= 3) break; result.push(VOCAB[i][2]); }
  }
  return result;
}
let wmOrder = null;
let wmIndex = 0;
let wmOrderKey = null;
let wmLastAutoplayIdx = null;
let wmAnswered = false;
let wmScore = null;
function renderPracticeWordMatch(container){
  const pool = buildWordMatchPool();
  if(!pool.length){
    container.innerHTML = `
      <div class="card">
        <p class="muted">No started words match the current HSK level / knowledge level filters. Study a few more flashcards, or broaden the filters above, then come back here to test your recall against multiple-choice definitions.</p>
      </div>`;
    return;
  }
  const wmOrderKeyNow = pool.length + "|" + state.practiceCount;
  if(!wmOrder || wmOrderKey !== wmOrderKeyNow){
    wmOrder = buildRotatedOrder(pool, p => p, state.lastPracticeSet.match, sessionSize(pool.length));
    wmOrderKey = wmOrderKeyNow;
    wmIndex = 0;
    wmScore = {correct:0, answered:0, xp:0};
  }
  const qNum = wmIndex % wmOrder.length;
  const idx = pool[wmOrder[qNum]];
  const [hanzi, pinyin, eng] = VOCAB[idx];
  const lvl = vocabLevel(idx);
  const know = knowledgePercent(idx);
  const knowColor = know >= 70 ? "var(--green-bright)" : know >= 35 ? "var(--yellow-warm)" : "var(--red)";
  const distractors = wordMatchDistractors(idx, pool);
  const options = shufflePractice([eng].concat(distractors));
  const correctIdx = options.indexOf(eng);
  const pct = Math.round(((qNum + 1) / wmOrder.length) * 100);
  wmAnswered = false;

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Word match <span class="badge">question ${qNum+1} of ${wmOrder.length}</span></h3>
      <p class="muted">Listen to the word and pick its correct English meaning. Only words you've already started are used here — your answer counts toward mastery.</p>
      <div class="progress-header">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        <div class="muted center" style="margin-top:4px;font-size:12px;">Question ${qNum+1} / ${wmOrder.length} · ${pct}%</div>
      </div>
    </div>
    <div class="card center">
      <div class="flash-top-row">
        <span class="lvl-badge lvl-${lvl}">${LEVEL_LABEL[lvl]}</span>
        <span class="muted center" style="flex:1;">Match the meaning</span>
        <span class="know-badge" style="border-color:${knowColor};color:${knowColor};" title="How well you know this word">${know}%</span>
      </div>
      <div class="hanzi">${hanzi}</div>
      <div class="pinyin" id="wmPinyin" style="visibility:hidden;">${pinyin}</div>
      <div class="flash-controls">
        <button class="secondary" id="wmPlay">🔊 Play sound again</button>
        <button class="secondary" id="wmShowPinyin">Show pinyin</button>
      </div>
      <div id="opts"></div>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="wmNext">Next question →</button>
    </div>
  `;
  if(idx !== wmLastAutoplayIdx){
    wmLastAutoplayIdx = idx;
    speak(hanzi);
  }
  container.querySelector("#wmPlay").onclick = ()=> speak(hanzi);
  container.querySelector("#wmShowPinyin").onclick = ()=>{
    container.querySelector("#wmPinyin").style.visibility = "visible";
    container.querySelector("#wmShowPinyin").disabled = true;
  };
  const optsEl = container.querySelector("#opts");
  options.forEach((opt, oi)=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt;
    b.onclick = ()=>{
      if(wmAnswered) return;
      wmAnswered = true;
      [...optsEl.querySelectorAll(".opt")].forEach(x=>x.disabled=true);
      const beforePct = knowledgePercent(idx);
      const xpBefore = state.xp;
      // Binary correct/incorrect maps onto Anki's 4-button scale as: correct -> Good
      // (a safe, moderate positive outcome -- this mode has no way for the user to
      // signal special confidence, so we don't use Easy), incorrect -> Again.
      if(oi === correctIdx){
        b.classList.add("correct");
        state.correctAnswers = (state.correctAnswers||0)+1;
        saveState();
        feedbackFX(b, true, "Good!");
        gradeCard(idx, 2);
      } else {
        b.classList.add("wrong");
        [...optsEl.querySelectorAll(".opt")][correctIdx].classList.add("correct");
        state.wrongAnswers = (state.wrongAnswers||0)+1;
        saveState();
        feedbackFX(b, false);
        gradeCard(idx, 0);
      }
      const afterPct = knowledgePercent(idx);
      showKnowledgeDelta(container.querySelector(".know-badge") || b, beforePct, afterPct);
      wmScore.answered++;
      if(oi === correctIdx) wmScore.correct++;
      wmScore.xp += state.xp - xpBefore;
    };
    optsEl.appendChild(b);
  });
  container.querySelector("#wmNext").onclick = ()=>{
    if(qNum === wmOrder.length - 1){
      finishPracticeSession("match", pool, wmOrder, wmScore, p => p);
    } else {
      wmIndex = wmIndex + 1;
      render();
    }
  };
}
/* ---- Mode 5: Write the character (handwriting quiz) ----
   Prompted with the meaning + pinyin, the learner draws the word one character at a
   time; Hanzi Writer validates each stroke, so this is genuine recall-and-produce
   rather than recognition. Only words whose characters ALL have stroke data are
   eligible, so a word can never strand the learner halfway through. */
function buildHandwritingPool(){
  if(!strokesAvailable()) return [];
  return Object.keys(state.cards)
    .map(Number)
    .filter(idx => isPracticeEligible(idx) && VOCAB[idx]
      && Array.from(VOCAB[idx][0]).every(hasStrokeData));
}
let hwOrder = null;
let hwIndex = 0;
let hwOrderKey = null;
let hwScore = null;
// Per-question progress: which character of the word we're on, and how many strokes
// were drawn wrong across the whole word (drives the SRS grade at the end).
let hwCharPos = 0;
let hwMistakes = 0;
let hwDone = false;
function renderPracticeWrite(container){
  const pool = buildHandwritingPool();
  if(!pool.length){
    container.innerHTML = `
      <div class="card">
        <p class="muted">${strokesAvailable()
          ? "No started words match the current HSK level / knowledge level filters. Study a few more flashcards, or broaden the filters above, then come back here to practise writing them."
          : "Stroke data isn't available, so handwriting practice can't run."}</p>
      </div>`;
    return;
  }
  const hwOrderKeyNow = pool.length + "|" + state.practiceCount;
  if(!hwOrder || hwOrderKey !== hwOrderKeyNow){
    hwOrder = buildRotatedOrder(pool, p => p, state.lastPracticeSet.write, sessionSize(pool.length));
    hwOrderKey = hwOrderKeyNow;
    hwIndex = 0;
    hwScore = {correct:0, answered:0, xp:0};
  }
  const qNum = hwIndex % hwOrder.length;
  const idx = pool[hwOrder[qNum]];
  const [hanzi, pinyin, eng] = VOCAB[idx];
  const chars = Array.from(hanzi);
  const lvl = vocabLevel(idx);
  const pct = Math.round(((qNum + 1) / hwOrder.length) * 100);
  hwCharPos = 0; hwMistakes = 0; hwDone = false;

  container.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">Write the character <span class="badge">question ${qNum+1} of ${hwOrder.length}</span></h3>
      <p class="muted">Draw the word from its meaning and pinyin. Each stroke is checked in order — a hint appears if you miss the same stroke twice.</p>
      <div class="progress-header">
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
        <div class="muted center" style="margin-top:4px;font-size:12px;">Question ${qNum+1} / ${hwOrder.length} · ${pct}%</div>
      </div>
      <div class="lib-filters" id="hwOutlineToggle">
        <button data-o="1" class="${state.writeShowOutline?'active':''}">Show outline</button>
        <button data-o="0" class="${!state.writeShowOutline?'active':''}">From memory</button>
      </div>
    </div>
    <div class="card center">
      <div class="flash-top-row">
        <span class="lvl-badge lvl-${lvl}">${LEVEL_LABEL[lvl]}</span>
        <span class="muted center" style="flex:1;">Character ${hwCharPos+1} of ${chars.length}</span>
      </div>
      <div class="hw-prompt">${eng}</div>
      <div class="hw-pinyin">${pinyin}</div>
      <div class="hw-stage" id="hwStage"></div>
      <div class="flash-controls">
        <button class="secondary" id="hwHint">Show me</button>
        <button class="secondary" id="hwSkip">Skip word</button>
      </div>
      <div id="hwResult"></div>
    </div>
    <div class="flash-controls">
      <button class="secondary" id="hwNext" disabled>Next question →</button>
    </div>
  `;

  const stage = container.querySelector("#hwStage");
  const resultEl = container.querySelector("#hwResult");
  const nextBtn = container.querySelector("#hwNext");
  const posLabel = container.querySelector(".flash-top-row .muted");
  let writer = null;

  container.querySelector("#hwOutlineToggle").addEventListener("click", e=>{
    const b = e.target.closest("button[data-o]");
    if(!b) return;
    state.writeShowOutline = b.dataset.o === "1";
    saveState();
    render();
  });

  // Renders the quiz for the character at hwCharPos, chaining to the next one (or
  // finishing the word) as each completes.
  function startChar(){
    stage.innerHTML = "";
    posLabel.textContent = `Character ${hwCharPos+1} of ${chars.length}`;
    const target = document.createElement("div");
    stage.appendChild(target);
    writer = HanziWriter.create(target, chars[hwCharPos], writerOptions(220, {
      showCharacter: false,
      showOutline: !!state.writeShowOutline,
      showHintAfterMisses: 2,
      highlightOnComplete: true
    }));
    makeWriterResponsive(target, 220);
    writer.quiz({
      onMistake: ()=>{ hwMistakes++; },
      onComplete: ()=>{
        hwCharPos++;
        if(hwCharPos < chars.length) setTimeout(startChar, 550);
        else setTimeout(finishWord, 550);
      }
    });
  }

  function finishWord(skipped){
    if(hwDone) return;
    hwDone = true;
    nextBtn.disabled = false;
    const beforePct = knowledgePercent(idx);
    const xpBefore = state.xp;
    // Map handwriting accuracy onto Anki's 4-button scale: a clean write is real
    // recall (Good), a couple of wrong strokes is shaky (Hard), and lots of misses or
    // a skip means it wasn't recalled at all (Again).
    let grade, label, good;
    if(skipped){ grade = 0; label = "Skipped"; good = false; }
    else if(hwMistakes === 0){ grade = 2; label = "Perfect — no mistakes!"; good = true; }
    else if(hwMistakes <= 2){ grade = 1; label = `Close — ${hwMistakes} wrong stroke${hwMistakes===1?"":"s"}`; good = true; }
    else { grade = 0; label = `${hwMistakes} wrong strokes — worth another look`; good = false; }
    if(good){ state.correctAnswers = (state.correctAnswers||0)+1; }
    else { state.wrongAnswers = (state.wrongAnswers||0)+1; }
    saveState();
    gradeCard(idx, grade);
    const afterPct = knowledgePercent(idx);
    resultEl.innerHTML = `
      <div class="hw-result ${good?"ok":"bad"}">
        <div class="hw-result-word">${hanzi}</div>
        <div>${label}</div>
      </div>`;
    showKnowledgeDelta(resultEl.querySelector(".hw-result") || nextBtn, beforePct, afterPct);
    if(good) feedbackFX(nextBtn, true, grade === 2 ? "Perfect!" : "Good");
    else feedbackFX(nextBtn, false);
    hwScore.answered++;
    if(good) hwScore.correct++;
    hwScore.xp += state.xp - xpBefore;
    speak(hanzi);
  }

  container.querySelector("#hwHint").onclick = ()=>{
    // Animating the current character counts as needing help, so it costs a "mistake" --
    // otherwise the grade wouldn't reflect that the word wasn't actually recalled.
    if(hwDone || !writer) return;
    hwMistakes++;
    writer.animateCharacter();
  };
  container.querySelector("#hwSkip").onclick = ()=>{
    if(hwDone) return;
    if(writer) writer.cancelQuiz();
    finishWord(true);
  };
  nextBtn.onclick = ()=>{
    if(qNum === hwOrder.length - 1){
      finishPracticeSession("write", pool, hwOrder, hwScore, p => p);
    } else {
      hwIndex = hwIndex + 1;
      render();
    }
  };
  startChar();
}

/* ---- Grammar ---- */
let grammarSearch = "";
// "all" | 1 | 2 | 3 | 4 -- filters GRAMMAR by lvl, reusing the .lib-filters pill pattern.
let grammarLevelFilter = "all";
function renderGrammar(app){
  const wrap = document.createElement("div");
  wrap.className = "card";
  const filtered = GRAMMAR.filter(g=>{
    if(grammarLevelFilter !== "all" && g.lvl !== grammarLevelFilter) return false;
    if(!grammarSearch) return true;
    const q = grammarSearch.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.expl.toLowerCase().includes(q) || g.cat.toLowerCase().includes(q) || g.zh.includes(grammarSearch);
  });
  // Group filtered points by level then category, preserving GRAMMAR's authored order.
  const groups = [];
  filtered.forEach(g=>{
    let lvlGroup = groups.find(x=>x.lvl===g.lvl);
    if(!lvlGroup){ lvlGroup = {lvl:g.lvl, cats:[]}; groups.push(lvlGroup); }
    let catGroup = lvlGroup.cats.find(x=>x.cat===g.cat);
    if(!catGroup){ catGroup = {cat:g.cat, items:[]}; lvlGroup.cats.push(catGroup); }
    catGroup.items.push(g);
  });
  wrap.innerHTML = `
    <div class="tab-hero">${mascotBounceImg("holding-ancient-scroll.png","")}<h3>Grammar points <span class="badge">${GRAMMAR.length} total</span></h3></div>
    <p class="muted">Official HSK 3.0 grammar syllabus, levels 1-4, organized by category. Tap a word in any example to translate it.</p>
    <div class="lib-filters" id="gramLevelFilters">
      <button data-lvl="all" class="${grammarLevelFilter==='all'?'active':''}">All</button>
      <button data-lvl="1" class="${grammarLevelFilter===1?'active':''}">HSK 1</button>
      <button data-lvl="2" class="${grammarLevelFilter===2?'active':''}">HSK 2</button>
      <button data-lvl="3" class="${grammarLevelFilter===3?'active':''}">HSK 3</button>
      <button data-lvl="4" class="${grammarLevelFilter===4?'active':''}">HSK 4</button>
    </div>
    <input type="text" id="gramSearch" placeholder="Search grammar points…" value="${grammarSearch}">
    <div id="gramList"></div>
  `;
  app.appendChild(wrap);
  wrap.querySelector("#gramLevelFilters").querySelectorAll("button").forEach(b=>{
    b.onclick = ()=>{
      grammarLevelFilter = b.dataset.lvl === "all" ? "all" : parseInt(b.dataset.lvl,10);
      render();
    };
  });
  const listEl = wrap.querySelector("#gramList");
  let counter = 0;
  function renderGramList(){
    listEl.innerHTML = groups.map(lvlGroup=>`
      <h3 style="margin:14px 0 2px;">HSK ${lvlGroup.lvl} <span class="lvl-badge lvl-${lvlGroup.lvl}">${LEVEL_LABEL[lvlGroup.lvl]}</span></h3>
      ${lvlGroup.cats.map(catGroup=>`
        <div class="muted" style="font-weight:800;text-transform:uppercase;font-size:11px;margin:10px 0 2px;letter-spacing:.04em;">${catGroup.cat}</div>
        ${catGroup.items.map(g=>{
          const i = counter++;
          return `
            <div class="grammar-item">
              <h3>${g.name}</h3>
              <p class="muted">${g.expl}</p>
              <div class="zh" id="gramZh${i}">${tokenizeHanzi(g.zh)}</div>
              <div class="transbar" id="gramBar${i}">${g.pyen}</div>
            </div>
          `;
        }).join("")}
      `).join("")}
    `).join("") || `<p class="muted">No grammar points match "${grammarSearch}".</p>`;
    let wireI = 0;
    groups.forEach(lvlGroup=>lvlGroup.cats.forEach(catGroup=>catGroup.items.forEach(()=>{
      wireTokClicks(document.getElementById("gramZh"+wireI), "gramBar"+wireI);
      wireI++;
    })));
  }
  renderGramList();
  wrap.querySelector("#gramSearch").oninput = (e)=>{
    grammarSearch = e.target.value;
    render();
  };
}

/* ---- Progress ---- */
function renderProgress(app){
  const lv = levelFromXp(state.xp);
  const t = titleForLevel(lv.level);
  const pct = Math.round((lv.into / lv.need) * 100);
  const d = computeDerivedStats();
  // If the player has selected an unlocked companion avatar, show it in the character
  // sheet instead of the default level-tier mascot; otherwise fall back unchanged.
  const activeAv = state.activeAvatar ? AVATARS.find(a=>a.id===state.activeAvatar) : null;
  const avatarUnlockedIds = unlockedAvatars(lv.level).map(a=>a.id);
  const sheetAvatar = (activeAv && avatarUnlockedIds.includes(activeAv.id)) ? activeAv : null;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="card">
      <div class="char-sheet">
        <div class="avatar">${sheetAvatar ? mascotAltImg(sheetAvatar.mascot, sheetAvatar.name) : mascotAltImg(t.mascot, t.title)}</div>
        <div class="char-info">
          <div class="char-title">${t.title}</div>
          <div class="char-level">Level ${lv.level}</div>
          <div class="xp-bar"><div style="width:${pct}%"></div></div>
          <div class="xp-label"><img src="ui-assets/icon-star.png" class="icon-inline" alt="">${lv.into} / ${lv.need} XP to next level (${state.xp} total XP)</div>
        </div>
      </div>
      <div class="rpg-stats">
        <div class="rpg-stat"><div class="icon">🔥</div><div class="val">${state.streak||1}</div><div class="lbl">Day streak</div></div>
        <div class="rpg-stat"><div class="icon">📖</div><div class="val">${d.started}</div><div class="lbl">Words started</div></div>
        <div class="rpg-stat"><div class="icon">🌳</div><div class="val">${d.mature}</div><div class="lbl">Mastered</div></div>
        <div class="rpg-stat"><div class="icon">⚔️</div><div class="val">${state.totalReviews||0}</div><div class="lbl">Reviews</div></div>
        <div class="rpg-stat"><div class="icon">🎯</div><div class="val">${state.correctAnswers||0}</div><div class="lbl">Correct answers</div></div>
        <div class="rpg-stat"><div class="icon">🖼️</div><div class="val">${state.picCorrect||0}</div><div class="lbl">Picture correct</div></div>
        <div class="rpg-stat"><div class="icon">🧩</div><div class="val">${state.orderCorrect||0}</div><div class="lbl">Word-order correct</div></div>
        <div class="rpg-stat"><div class="icon">✅</div><div class="val">${state.tfCorrect||0}</div><div class="lbl">True/false correct</div></div>
      </div>
    </div>
    <div class="card progress-texture">
      <h3 style="margin-top:0;">Achievements <span class="badge">${Object.keys(state.unlockedAchievements).length} / ${ACHIEVEMENTS.length}</span></h3>
      <div class="ach-grid">
        ${ACHIEVEMENTS.map(a=>{
          const unlocked = !!state.unlockedAchievements[a.id];
          return `
            <div class="ach ${unlocked ? '' : 'locked'}">
              <div class="ach-icon">${a.icon}</div>
              <div class="ach-name">${a.name}</div>
              <div class="ach-desc">${a.desc}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
    <div class="card progress-texture">
      <h3 style="margin-top:0;">Companion avatars <span class="badge">${avatarUnlockedIds.length} / ${AVATARS.length}</span></h3>
      <p class="muted">Level up to unlock new companions. Tap an unlocked one to make it your active companion above.</p>
      <div class="ach-grid" id="avatarGrid">
        ${AVATARS.map(a=>{
          const unlocked = avatarUnlockedIds.includes(a.id);
          const active = state.activeAvatar === a.id && unlocked;
          return `
            <div class="ach avatar-tile ${unlocked ? '' : 'locked'} ${active ? 'active' : ''}" data-avatar="${a.id}" data-unlocked="${unlocked}">
              <div class="ach-icon">${mascotImg(a.mascot, a.name)}</div>
              <div class="ach-name">${a.name}</div>
              <div class="ach-desc">${unlocked ? (active ? "Active" : "Tap to select") : "Reach level "+a.level}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
  app.appendChild(wrap);
  const avatarGrid = wrap.querySelector("#avatarGrid");
  if(avatarGrid){
    avatarGrid.querySelectorAll("[data-avatar]").forEach(tile=>{
      tile.onclick = ()=>{
        if(tile.dataset.unlocked !== "true") return;
        const id = tile.dataset.avatar;
        state.activeAvatar = (state.activeAvatar === id) ? null : id;
        saveState();
        render();
      };
    });
  }
}

