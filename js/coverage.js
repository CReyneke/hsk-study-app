/* ============================ KNOWN-WORD COVERAGE ============================
   "You know 214 of the 340 HSK words in this story."

   The point of learning vocabulary is being able to read things, and until now nothing
   in the app connected the two: you could master hundreds of words without the Reading
   tab ever acknowledging it. This turns the word list into a visible key -- progress
   measured in the thing you actually wanted, rather than in points.

   ---- What is counted, and why ----

   The denominator is the story's tokens that are VOCAB words, i.e. the vocabulary this
   app teaches. That choice is deliberate. Segmenting all 24 stories shows only 73% of
   their tokens are VOCAB words at all: another 23% are single characters outside every
   word list -- surnames (王, 陈, 林, 李) and fragments of words the app doesn't cover.
   Counting those would cap coverage at 73% no matter how much you learned, and would be
   measuring vocabulary the app never claimed to teach.

   So the figure is reported as "N of M HSK words", never as a bare "you can read X% of
   this story" -- the latter would overstate real readability, since the uncounted 23%
   is genuinely still unreadable. Honest framing matters more here than a flattering
   number.

   ---- Cost ----

   Segmenting every story is ~92k tokens of longest-match lookup, so it happens once,
   lazily, on first use and is then cached. What's cached per story is a map of
   vocabIdx -> occurrence count; recomputing coverage as cards change is then just a walk
   over that map, which is cheap enough to do on every render.
*/

// A story is worth surfacing as "ready" once you know most of its taught vocabulary.
// Below this it tends to be more decoding than reading.
const STORY_READY_COVERAGE = 0.8;

let _wordToVocabIdx = null;
// First index wins: VOCAB holds a few homographs (还 hái / 还 huán) under one written
// form, and a story token carries no pronunciation to disambiguate with. Coverage is
// about "have you met this written word", so collapsing them is the right resolution.
function wordToVocabIdx(){
  if(_wordToVocabIdx) return _wordToVocabIdx;
  _wordToVocabIdx = new Map();
  for(let i = 0; i < VOCAB.length; i++){
    if(!_wordToVocabIdx.has(VOCAB[i][0])) _wordToVocabIdx.set(VOCAB[i][0], i);
  }
  return _wordToVocabIdx;
}

// storyId -> {counts: Map(vocabIdx -> occurrences), total, perChapter: [Map, ...]}
const _storyIndex = new Map();

function indexText(text, map){
  const idxOf = wordToVocabIdx();
  let total = 0;
  // Mirrors tokenizeWords()'s longest-match walk; kept local so coverage can count
  // without building the intermediate token array for ~92k tokens.
  let i = 0;
  while(i < text.length){
    const ch = text[i];
    if(!CJK_RE.test(ch)){ i++; continue; }
    let matched = false;
    for(let len = Math.min(DICT_MAXLEN, text.length - i); len >= 1; len--){
      const seg = text.slice(i, i + len);
      if(DICT[seg]){
        const vi = idxOf.get(seg);
        if(vi !== undefined){
          map.set(vi, (map.get(vi) || 0) + 1);
          total++;
        }
        i += len; matched = true; break;
      }
    }
    if(!matched) i++;
  }
  return total;
}

function storyIndex(story){
  if(_storyIndex.has(story.id)) return _storyIndex.get(story.id);
  const counts = new Map();
  const perChapter = [];
  let total = 0;
  (story.chapters || []).forEach(ch=>{
    const chMap = new Map();
    const chTotal = indexText(ch.zh || "", chMap);
    perChapter.push({counts: chMap, total: chTotal});
    chMap.forEach((n, vi)=> counts.set(vi, (counts.get(vi) || 0) + n));
    total += chTotal;
  });
  const entry = {counts, total, perChapter};
  _storyIndex.set(story.id, entry);
  return entry;
}

// Coverage over a prepared {counts,total} index. `distinct` counts each word once;
// `tokens` weights by how often it appears, which is closer to reading experience --
// knowing 的 is worth more than knowing a word used once.
function coverageOf(entry){
  let knownDistinct = 0, distinct = 0, knownTokens = 0;
  entry.counts.forEach((n, vi)=>{
    distinct++;
    if(knowsWord(vi)){ knownDistinct++; knownTokens += n; }
  });
  const tokenPct = entry.total ? knownTokens / entry.total : 0;
  return {
    knownDistinct, distinct,
    knownTokens, totalTokens: entry.total,
    pct: distinct ? knownDistinct / distinct : 0,
    tokenPct,
    ready: tokenPct >= STORY_READY_COVERAGE
  };
}

/* Indexing all 24 stories costs ~180ms on a desktop, and several times that on a phone.
   Doing it on first Reading-tab render would show up as a stall, so it's warmed one
   story at a time during idle slices after load instead -- by the time the tab is
   opened the work is usually already done, and if it isn't, storyIndex() just computes
   the missing one on demand exactly as before. Never blocks a frame either way. */
let _warmStarted = false;
function warmStoryIndexes(){
  if(_warmStarted) return;
  if(typeof STORIES === "undefined") return;
  _warmStarted = true;
  const queue = STORIES.slice();
  // The `timeout` option is essential, not decorative: a plain requestIdleCallback can be
  // starved indefinitely on a page that never goes idle, and the warm-up then never runs
  // at all -- observed happening in testing. With a timeout the browser is obliged to
  // call back, so this degrades to "slightly later" rather than "never".
  /* Deliberately plain setTimeout rather than requestIdleCallback. Two things went wrong
     with the idle approach in testing:
       - a bare requestIdleCallback never fired at all on a page that stays busy, and
       - even with {timeout}, one scheduled during initial load didn't run, so the
         warm-up silently never happened -- the exact failure it was meant to prevent.
     Draining by deadline.timeRemaining() was also unusable: the browser reported
     almost no budget and it managed ~1 story per 300ms (~7s for the set).

     Fixed batches on a timer are predictable everywhere. Indexing all 24 stories costs
     ~178ms measured, so four per slice is ~30ms -- under the 50ms responsiveness
     threshold -- and the set completes in six slices a moment after load. */
  const BATCH = 4;
  const step = ()=>{
    for(let i = 0; i < BATCH && queue.length; i++) storyIndex(queue.shift());
    if(queue.length) setTimeout(step, 0);
  };
  setTimeout(step, 600);   // let first paint and the initial render settle first
}

function storyCoverage(story){ return coverageOf(storyIndex(story)); }
function chapterCoverage(story, chapterIdx){
  const idx = storyIndex(story);
  const ch = idx.perChapter[chapterIdx];
  return ch ? coverageOf(ch) : null;
}

// Small reusable bar + label. Kept here so the dashboard and chapter list can't drift
// into describing the same number two different ways.
function coverageBarHtml(cov, opts){
  opts = opts || {};
  const pct = Math.round(cov.tokenPct * 100);
  const cls = cov.ready ? "cov-ready" : pct >= 50 ? "cov-mid" : "cov-low";
  return `
    <div class="cov-wrap">
      <div class="cov-bar"><div class="cov-fill ${cls}" style="width:${pct}%"></div></div>
      <div class="cov-label">
        <b>${cov.knownDistinct}</b> of <b>${cov.distinct}</b> HSK words known
        ${opts.short ? "" : `<span class="muted">· ${pct}% of the text</span>`}
        ${cov.ready ? `<span class="cov-badge">Ready to read</span>` : ""}
      </div>
    </div>`;
}
