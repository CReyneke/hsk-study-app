/* ============================ STATE ============================ */
const STORAGE_KEY = "hsk3_srs_v1";

/* Brings any save up to the shape the current code expects, filling in every field
   added since that save was written.

   This MUST be applied to every state object entering the app, not just the one read
   from localStorage -- cross-device sync adopts a state written by whatever version the
   other device was running, and skipping this step leaves newer fields undefined. That
   was a real crash: a device syncing from an older one arrived with no
   state.lastPracticeSet, and the Practice tab died on `state.lastPracticeSet.fill`. */
function normalizeState(s){
  if(!s || typeof s !== "object") s = {};
  if(!s.cards || typeof s.cards !== "object") s.cards = {};
  if(!Array.isArray(s.order)) s.order = [];
  s.streak = s.streak || 0;
  if(s.lastActiveDay === undefined) s.lastActiveDay = null;
  s.totalReviews = s.totalReviews || 0;
  // backfill fields for saves created before the gamification update
  s.xp = s.xp || 0;
  s.correctAnswers = s.correctAnswers || 0;
  s.wrongAnswers = s.wrongAnswers || 0;
  s.picCorrect = s.picCorrect || 0;
  s.readingCompleted = s.readingCompleted || 0;
  s.listeningCompleted = s.listeningCompleted || 0;
  s.orderCorrect = s.orderCorrect || 0;
  s.tfCorrect = s.tfCorrect || 0;
  s.unlockedAchievements = s.unlockedAchievements || {};
  s.activeAvatar = s.activeAvatar || null;
  // additive: rolling daily XP log for the Today-tab weekly activity chart.
  // shape: { "YYYY-M-D": xpEarnedThatDay }. Old saves simply start with {}.
  s.xpLog = s.xpLog || {};
  // additive: which HSK level sets the user wants flashcard sessions drawn from.
  // shape: array of ints among [1,2,3]. Defaults to all three (unchanged behavior).
  if(!Array.isArray(s.flashLevels) || s.flashLevels.length === 0) s.flashLevels = [1,2,3];
  // additive: how many questions the user wants per Practice-tab session, applied
  // per-mode. "all" means use the whole (started-words-filtered) pool. Persisted
  // the same way state.flashLevels is.
  if(s.practiceCount === undefined || s.practiceCount === null) s.practiceCount = "all";
  // additive: per-day accumulated active study time in ms, shape {"YYYY-M-D": ms},
  // mirrors state.xpLog's rolling-daily-record shape. Populated by studyTimeTick().
  s.studyTime = s.studyTime || {};
  // additive: per-day flashcard review tally, shape {"YYYY-M-D": {n, ok}} where n is
  // reviews graded that day and ok is how many were graded Good/Easy. Populated
  // alongside the existing state.totalReviews bump at the end of gradeCard() --
  // purely a bookkeeping increment, the SM-2 scheduling logic itself is untouched.
  s.reviewLog = s.reviewLog || {};
  // additive: longest streak ever reached (state.streak is the *current* run and
  // can reset to 1; this tracks the high-water mark for Today-tab display).
  s.longestStreak = s.longestStreak || 0;
  // additive: story-library progress, shape {storyId: {chaptersRead:[chapterIdx,...],
  // lastPosition: chapterIdx}}. Populated by markChapterRead()/the chapter reader.
  s.storyProgress = s.storyProgress || {};
  // additive: lightweight "saved for later" word flags from the story-reader
  // translation popup's bookmark icon, shape {word: true}. Not integrated with the
  // SRS system -- purely a save-for-later flag the Library/reader can show.
  s.savedWords = s.savedWords || {};
  // additive: identities of the words/sentences used in each Practice-tab mode's
  // most-recently-completed session, keyed by mode ("fill"/"order"/"tf"/"match").
  // Consulted by buildRotatedOrder() so the next session in that mode prefers
  // drawing from whatever wasn't just used, instead of risking an immediate repeat.
  s.lastPracticeSet = s.lastPracticeSet || {fill:[], order:[], tf:[], match:[]};
  // additive: "write" joined the practice modes after lastPracticeSet already existed in
  // saved games, so backfill the key rather than assuming the whole object is fresh.
  if(!Array.isArray(s.lastPracticeSet.write)) s.lastPracticeSet.write = [];
  // additive: handwriting-quiz difficulty -- true traces a greyed outline, false makes
  // the learner produce the character from memory. Defaults to the gentler setting.
  if(s.writeShowOutline === undefined || s.writeShowOutline === null) s.writeShowOutline = true;
  // additive: which HSK level sets Practice-tab sessions are drawn from, same
  // shape/default as state.flashLevels but kept as its own independent choice.
  if(!Array.isArray(s.practiceLevels) || s.practiceLevels.length === 0) s.practiceLevels = [1,2,3];
  // additive: which knowledge tiers (wordCategory()) Practice-tab sessions are drawn
  // from. "new" is deliberately not an option here -- every practice pool already
  // requires isStartedWord() (a real example sentence you've seen before), so a word
  // still in "new" can never appear regardless of this filter.
  if(!Array.isArray(s.practiceCategories) || s.practiceCategories.length === 0) s.practiceCategories = ["learning","familiar","mastered"];
  // additive: how many graded reviews the learner is aiming for per day. Deliberately
  // user-chosen rather than imposed -- a self-set target supports autonomy, whereas one
  // the app dictates tends to feel like an obligation and erode the motivation it's
  // meant to build. Also gives the day a defined end, so finishing feels like finishing.
  if(!Number.isFinite(s.dailyGoal) || s.dailyGoal <= 0) s.dailyGoal = 20;
  return s;
}

// Graded reviews completed today, and whether that meets the learner's chosen target.
function reviewsToday(){
  const rl = (state.reviewLog || {})[todayStr()];
  return (rl && rl.n) || 0;
}
function dailyGoalTarget(){ return state.dailyGoal || 20; }
function dailyGoalMet(){ return reviewsToday() >= dailyGoalTarget(); }

function loadState(){
  let s = null;
  try{ s = JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch(e){}
  return normalizeState(s);
}

// Persistence can genuinely fail -- Safari in private mode throws on setItem, and so
// does exceeding the storage quota. saveState() is called from gradeCard() and every
// practice mode, so letting it throw would break grading outright. Fail soft instead,
// and tell the user once rather than silently losing their progress.
let _storageWarned = false;
function warnStorageUnavailable(){
  if(_storageWarned) return;
  _storageWarned = true;
  try{
    const bar = document.createElement("div");
    bar.className = "storage-warning";
    bar.textContent = "Progress can't be saved on this device — check that your browser allows site storage (private mode blocks it).";
    document.body.appendChild(bar);
    setTimeout(()=> bar.remove(), 12000);
  }catch(e){ /* pre-DOM or hostile environment: the console message below still stands */ }
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error("Could not save progress to localStorage", e);
    warnStorageUnavailable();
  }
}

let state = loadState();

/* ============================ RPG / GAMIFICATION ============================ */
// Each tier has one canonical mascot image, rendered as a single static illustration
// via mascotAltImg/mascotBounceImg — no animation or alternation.
const TITLES = [
  {min:1, max:4, title:"Wandering Apprentice", mascot:"thinking-pixel-bubble.png"},
  {min:5, max:9, title:"Diligent Student", mascot:"reading-data-document.png"},
  {min:10, max:14, title:"Character Hunter", mascot:"examining-green-globe.png"},
  {min:15, max:19, title:"Tone Warrior", mascot:"lifting-heavy-barbell.png"},
  {min:20, max:24, title:"Grammar Knight", mascot:"holding-ancient-scroll.png"},
  {min:25, max:29, title:"Chengyu Ranger", mascot:"fast-performance-trail.png"},
  {min:30, max:39, title:"HSK Adventurer", mascot:"tracking-multiple-locations.png"},
  {min:40, max:49, title:"Mandarin Sage", mascot:"idea-lightbulb-pixel.png"},
  {min:50, max:9999, title:"Legendary Scholar", mascot:"rocket-launch-success.png"}
];
// Unlockable companion avatars: one canonical mascot filename per avatar, rendered as a
// single static image via mascotAltImg. Unlocked progressively as the player's level rises
// through the existing TITLES tiers.
const AVATARS = [
  {id:"avatar_apprentice", level:1, name:"Apprentice Companion", mascot:"artboard-2cla.png"},
  {id:"avatar_hunter", level:10, name:"Character Hunter Companion", mascot:"artboard-3cla.png"},
  {id:"avatar_knight", level:20, name:"Grammar Knight Companion", mascot:"artboard-4cla.png"},
  {id:"avatar_adventurer", level:30, name:"HSK Adventurer Companion", mascot:"artboard-24cla.png"},
  {id:"avatar_sage", level:40, name:"Mandarin Sage Companion", mascot:"artboard-25cla.png"}
];
function unlockedAvatars(level){ return AVATARS.filter(a=>level>=a.level); }
function mascotImg(file, alt, cls){
  return `<img src="${file}" alt="${alt||''}" class="${cls||''}" onerror="this.style.display='none'">`;
}
// Alias kept so every existing call site (toast icon, corner reaction popup, tab-hero
// icons, the character-sheet avatar, empty-state mascots) keeps working unchanged.
function mascotBounceImg(file, alt, cls){
  return mascotAltImg(file, alt, cls);
}
// Renders a single static mascot image (no crossfade/alternation) at whatever size the
// surrounding per-context CSS (.mascot-alt inside .tab-hero/.avatar/.toast-icon/etc) gives it.
function mascotAltImg(file, alt, cls){
  return `<span class="mascot-alt ${cls||''}">
    <img src="${file}" alt="${alt||''}" onerror="this.style.display='none'">
  </span>`;
}
function titleForLevel(level){
  return TITLES.find(t=>level>=t.min && level<=t.max) || TITLES[TITLES.length-1];
}
// XP required to go from `level` to `level+1`
function xpNeededForLevel(level){ return Math.round(80 + (level-1)*30); }
function levelFromXp(xp){
  let level = 1, remaining = xp, need = xpNeededForLevel(1);
  while(remaining >= need){
    remaining -= need;
    level++;
    need = xpNeededForLevel(level);
  }
  return { level, into: remaining, need };
}
function awardXP(n){
  const before = levelFromXp(state.xp).level;
  state.xp += n;
  // additive/defensive: tally today's XP into the rolling log for the Today-tab chart.
  // Does not affect scheduling/XP-earning logic itself, just a display-side record.
  const t = todayStr();
  state.xpLog = state.xpLog || {};
  state.xpLog[t] = (state.xpLog[t] || 0) + n;
  const after = levelFromXp(state.xp);
  saveState();
  if(after.level > before) showLevelUpToast(after.level);
  checkAchievements();
  return after;
}
function showLevelUpToast(level){
  const t = titleForLevel(level);
  sfxLevelUp();
  const toast = document.createElement("div");
  toast.className = "levelup-toast";
  toast.innerHTML = `<span class="toast-icon">${mascotBounceImg(t.mascot, t.title)}</span><span>Level up! You're now Level ${level} — ${t.title}</span>`;
  document.body.appendChild(toast);
  screenPulse("rgba(217,119,87,.25)");
  setTimeout(()=>toast.remove(), 3200);
}
function showAchievementToast(a){
  sfxAchievement();
  const toast = document.createElement("div");
  toast.className = "ach-toast";
  toast.innerHTML = `<span class="toast-icon" style="font-size:18px;">${a.icon}</span><span>Achievement unlocked: ${a.name}</span>`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(), 3200);
}

// ACHIEVEMENTS: id, icon, name, desc, check(derived) -> boolean
const ACHIEVEMENTS = [
  {id:"first_word", icon:"🌱", name:"First Steps", desc:"Start your first word", check:d=>d.started>=1},
  {id:"novice_25", icon:"📗", name:"Vocabulary Novice", desc:"Start 25 words", check:d=>d.started>=25},
  {id:"adept_100", icon:"📘", name:"Vocabulary Adept", desc:"Start 100 words", check:d=>d.started>=100},
  {id:"master_250", icon:"📙", name:"Vocabulary Master", desc:"Start 250 words", check:d=>d.started>=250},
  {id:"full_scholar", icon:"📚", name:"Full Scholar", desc:"Start every HSK3 word", check:d=>d.started>=VOCAB.length},
  {id:"mature_20", icon:"🌳", name:"Deep Roots", desc:"Reach 20 mastered words", check:d=>d.mature>=20},
  {id:"mature_75", icon:"🏛️", name:"Word Whisperer", desc:"Reach 75 mastered words", check:d=>d.mature>=75},
  {id:"streak_3", icon:"🔥", name:"On a Roll", desc:"3-day study streak", check:d=>d.streak>=3},
  {id:"streak_7", icon:"🔥", name:"Dedicated", desc:"7-day study streak", check:d=>d.streak>=7},
  {id:"streak_30", icon:"🔥", name:"Unstoppable", desc:"30-day study streak", check:d=>d.streak>=30},
  {id:"reviews_100", icon:"⚔️", name:"Century Club", desc:"100 flashcard reviews", check:d=>d.totalReviews>=100},
  {id:"reviews_500", icon:"🗡️", name:"Grinder", desc:"500 flashcard reviews", check:d=>d.totalReviews>=500},
  {id:"correct_50", icon:"🎯", name:"Sharp Mind", desc:"50 correct quiz answers", check:d=>d.correctAnswers>=50},
  {id:"pic_20", icon:"🖼️", name:"Picture Perfect", desc:"20 correct picture answers", check:d=>d.picCorrect>=20},
  {id:"level_10", icon:"⭐", name:"Rising Star", desc:"Reach level 10", check:d=>d.level>=10},
  {id:"level_25", icon:"🌟", name:"Champion", desc:"Reach level 25", check:d=>d.level>=25},
  {id:"level_50", icon:"👑", name:"Legend", desc:"Reach level 50", check:d=>d.level>=50},
  // Additive: HSK-level-specific vocabulary mastery milestones (real official counts:
  // HSK1 = 300 words, HSK2 = 200 words, HSK3 = 500 words, per VOCAB[i][3]).
  {id:"hsk1_grad", icon:"🥉", name:"HSK1 Graduate", desc:"Master all 300 HSK Level 1 words", check:d=>d.mastered1>=300},
  {id:"hsk2_grad", icon:"🥈", name:"HSK2 Graduate", desc:"Master all 200 HSK Level 2 words", check:d=>d.mastered2>=200},
  {id:"hsk3_grad", icon:"🥇", name:"HSK3 Graduate", desc:"Master all 500 HSK Level 3 words", check:d=>d.mastered3>=500},
  // Additive: dedicated counters for the word-order and true/false practice modes.
  {id:"order_20", icon:"🧩", name:"Sentence Builder", desc:"20 correct word-order answers", check:d=>d.orderCorrect>=20},
  {id:"order_75", icon:"🏗️", name:"Syntax Master", desc:"75 correct word-order answers", check:d=>d.orderCorrect>=75},
  {id:"tf_20", icon:"✅", name:"Fact Checker", desc:"20 correct true/false answers", check:d=>d.tfCorrect>=20},
  {id:"tf_75", icon:"🔍", name:"Truth Seeker", desc:"75 correct true/false answers", check:d=>d.tfCorrect>=75},
  {id:"avatar_collector", icon:"🎭", name:"Companion Collector", desc:"Unlock every companion avatar", check:d=>d.level>=40}
];
function computeDerivedStats(){
  const started = Object.keys(state.cards).length;
  const masteredKeys = Object.keys(state.cards).filter(k=>wordCategory(Number(k))==="mastered");
  const mature = masteredKeys.length;
  const mastered1 = masteredKeys.filter(k=>vocabLevel(Number(k))===1).length;
  const mastered2 = masteredKeys.filter(k=>vocabLevel(Number(k))===2).length;
  const mastered3 = masteredKeys.filter(k=>vocabLevel(Number(k))===3).length;
  return {
    started, mature,
    mastered1, mastered2, mastered3,
    streak: state.streak||0,
    totalReviews: state.totalReviews||0,
    correctAnswers: state.correctAnswers||0,
    picCorrect: state.picCorrect||0,
    orderCorrect: state.orderCorrect||0,
    tfCorrect: state.tfCorrect||0,
    level: levelFromXp(state.xp).level
  };
}
function checkAchievements(){
  const d = computeDerivedStats();
  let changed = false;
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach(a=>{
    if(!state.unlockedAchievements[a.id] && a.check(d)){
      state.unlockedAchievements[a.id] = true;
      newlyUnlocked.push(a);
      changed = true;
    }
  });
  if(changed) saveState();
  // Stagger toasts slightly if multiple unlock at once so they don't overlap.
  newlyUnlocked.forEach((a,i)=> setTimeout(()=> showAchievementToast(a), i*3400));
}


function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate();
}
function dayOfYear(){
  const now = new Date();
  const start = new Date(now.getFullYear(),0,0);
  const diff = now - start;
  return Math.floor(diff / 86400000);
}
/* ---- Streak ----
   Previously this ran on page load and did `state.streak += 1` with no gap check at all,
   so (a) returning after months away *continued* the streak instead of resetting it, and
   (b) merely opening the app counted as a day studied. Both are fixed below: the streak
   only advances when a card is actually graded (see markStudiedToday, called from
   gradeCard), and a missed day resets it. */

// Parses a todayStr()-format key ("YYYY-M-D", not zero-padded) into a local-midnight
// Date. Deliberately explicit rather than `new Date(str)`, whose handling of
// non-padded, non-ISO strings varies by browser.
function parseDayKey(key){
  if(typeof key !== "string") return null;
  const p = key.split("-").map(Number);
  if(p.length !== 3 || p.some(n => !Number.isFinite(n))) return null;
  const d = new Date(p[0], p[1] - 1, p[2]);
  return isNaN(d.getTime()) ? null : d;
}
// Whole days from day key `a` to day key `b`, or null if either is unparseable.
function daysBetweenKeys(a, b){
  const da = parseDayKey(a), db = parseDayKey(b);
  if(!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

// Records that the learner studied today, advancing or resetting the streak. Safe to
// call on every graded review -- it no-ops once today is already counted. Returns true
// only when today was newly counted, so callers can react to a streak change.
function markStudiedToday(){
  const t = todayStr();
  if(state.lastActiveDay === t) return false;
  const gap = daysBetweenKeys(state.lastActiveDay, t);
  // gap === 1 continues the run; anything else (first ever study, a missed day, or a
  // clock moving backwards) starts a fresh one.
  state.streak = (gap === 1) ? (state.streak || 0) + 1 : 1;
  state.lastActiveDay = t;
  state.longestStreak = Math.max(state.longestStreak || 0, state.streak);
  return true;
}

const NEW_PER_DAY = 12;
const DUE_MS = 24*3600*1000;

/* ============================ SRS (Anki's real SM-2-based algorithm) ============================
   Matches Anki's documented default scheduler (faqs.ankiweb.net/what-spaced-repetition-algorithm):
   - New cards go through short "learning steps" (in minutes) before graduating to
     the long-term review queue.
   - Review cards have an interval (in days) and an ease factor (starts at 2.5 / 250%).
   - Grading uses Anki's real 4 buttons: Again / Hard / Good / Easy.
   Learning & relearning cards (grade indices 0-3):
       0 = Again : back to the FIRST learning step. Ease is NOT touched (learning/relearning
                   cards have no established ease being adjusted by Again/Hard).
       1 = Hard  : repeats the CURRENT step (roughly — uses the average of the current and
                   next step's minutes as a "between repeat and advance" timing approximation).
                   Ease is NOT touched.
       2 = Good  : advances to the NEXT learning step; if this was the FINAL step, the card
                   graduates into a review card with the graduating interval (1 day) and
                   whatever ease it already has (2.5 by default — graduating itself does not
                   touch ease).
       3 = Easy  : immediately graduates the card into a review card (skipping remaining
                   steps) with the larger "easy interval" (4 days). Ease untouched.
   Review cards (already graduated), grade indices 0-3:
       0 = Again : ease -= 0.20 (floored at 1.3), drops into relearning (restarts the
                   learning steps), and the interval is treated as reset (0% of previous) —
                   it re-graduates back into review using the graduating/easy interval above,
                   exactly like a card graduating from "new" for the first time.
       1 = Hard  : ease -= 0.15 (floored at 1.3), interval *= 1.2.
       2 = Good  : interval *= ease; ease unchanged.
       3 = Easy  : interval *= ease * 1.3 (the "easy bonus"); ease += 0.15.
   Limitations enforced everywhere: ease never drops below 1.3 (130%); any new interval from
   Hard/Good/Easy must be at least 1 day longer than the previous interval (bumped up if not);
   intervals are capped at MAX_INTERVAL_DAYS as a defensive ceiling.
*/
const LEARNING_STEPS_MIN = [1, 10]; // Anki's classic default new-card steps (unchanged from before)
const GRADUATING_INTERVAL_DAYS = 1;
const EASY_INTERVAL_DAYS = 4; // Anki's default "easy interval" for immediate graduation
const MAX_INTERVAL_DAYS = 1825; // defensive cap (~5 years) so intervals can't grow unboundedly

// Read-only accessor: returns the card if it's been introduced, migrating old
// (pre-SM-2-states) save shapes in place. Never creates a new card — use ensureCard() for that.
function getCard(idx){
  const c = state.cards[String(idx)];
  if(c) normalizeCard(c);
  return c;
}
function normalizeCard(c){
  if(c.state === undefined){
    c.state = c.reps > 0 ? "review" : "new";
    c.step = 0;
    c.lapses = c.lapses || 0;
  }
  c.correct = c.correct || 0;
  c.wrong = c.wrong || 0;
  return c;
}
// Creates the card (with fresh SM-2 state fields) if it doesn't exist yet, and
// migrates it if it does. Use this whenever a word is being introduced/graded.
function ensureCard(idx){
  const key = String(idx);
  if(!state.cards[key]){
    state.cards[key] = {
      state: "new",     // new | learning | review | relearning
      step: 0,          // index into LEARNING_STEPS_MIN while learning/relearning
      ef: 2.5,          // ease factor (like Anki's 250% starting ease)
      interval: 0,      // days, once in "review" state
      due: 0,
      reps: 0,
      lapses: 0,
      introducedOn: todayStr(),
      correct: 0,
      wrong: 0
    };
  }
  return normalizeCard(state.cards[key]);
}

function getIntroducedIndices(){
  return Object.keys(state.cards).map(Number);
}

/* ============================ NEW-WORD SELECTION ============================
   Which words get introduced next, and in what order. This used to just walk VOCAB
   from index 0, which is alphabetical-by-pinyin within each HSK level -- so day one
   handed you 爱/八/爸爸/吧/白天/百/半 (love, eight, dad, a particle, daytime, hundred,
   half): sorted by sound, useful for nothing. Two signals replace that:

     1. Frequency  -- how often the word actually occurs in this app's own corpus
                      (WORD_FREQ, see js/word-freq.js). Learning 的/了/一/不/是 before
                      包子/杯子 means you can build real sentences almost immediately.
     2. Unlocking  -- words assembled from characters you've already studied. This
                      matters far more in Chinese than in European languages: 电话 is
                      nearly free once you know 电 and 话. Words get a rank bonus in
                      proportion to how many of their characters you've already met,
                      so the queue keeps surfacing "you already have the parts" words.

   The two combine into one ordering rather than alternating, so a word that is both
   common and already-unlocked comes first, and a rare word made of known characters
   still has to wait behind genuinely common ones. */

// Rank of each word by corpus frequency, 0 = most frequent. Computed once, lazily,
// since it's a 1000-item sort that most page loads never need.
let _freqRankCache = null;
function freqRank(idx){
  if(!_freqRankCache){
    const freq = (typeof WORD_FREQ !== "undefined") ? WORD_FREQ : [];
    const order = VOCAB.map((_, i) => i)
      .sort((a, b) => (freq[b] || 0) - (freq[a] || 0) || a - b);
    _freqRankCache = new Array(VOCAB.length);
    order.forEach((vocabIdx, rank) => { _freqRankCache[vocabIdx] = rank; });
  }
  return _freqRankCache[idx] || 0;
}

// Characters the learner has actually studied, i.e. drawn from words whose card exists
// and has left the "new" state. A card introduced but not yet graded doesn't count --
// being shown a word once isn't the same as knowing its characters.
function seenCharacters(){
  const set = new Set();
  Object.keys(state.cards).forEach(key=>{
    const c = state.cards[key];
    if(!c || c.state === "new") return;
    const w = VOCAB[Number(key)];
    if(w) for(const ch of w[0]) set.add(ch);
  });
  return set;
}

// How many rank positions a fully-unlocked word may jump. Deliberately finite: at ~200
// it pulls unlocked words forward strongly without letting an obscure word leapfrog the
// high-frequency core, which is what you actually need first.
const UNLOCK_RANK_BONUS = 200;
function introductionScore(idx, seen){
  const chars = Array.from(VOCAB[idx][0]);
  const known = chars.filter(c => seen.has(c)).length;
  const fraction = chars.length ? known / chars.length : 0;
  return freqRank(idx) - UNLOCK_RANK_BONUS * fraction;
}

// The next `n` words to introduce: un-introduced, eligible for the learner's current
// HSK-level selection, best-scoring first. Ties break on index so the order is stable.
//
// Homographs are deliberately spread out. VOCAB holds several written forms more than
// once as genuinely different words (还 hái "still" vs 还 huán "to return"; 得 de/dé/děi;
// 地 de vs dì), and because frequency is counted per written form they score identically
// and would otherwise land in the same batch -- the worst possible case of the
// interference that hurts learning similar items together. So a form is held back while
// another entry sharing it is still unsettled (not yet in stable review), and never
// appears twice in one batch.
function pickNextWords(n){
  const introduced = new Set(getIntroducedIndices());
  const seen = seenCharacters();
  const unsettled = new Set();
  Object.keys(state.cards).forEach(key=>{
    const c = state.cards[key];
    const w = VOCAB[Number(key)];
    if(w && c && c.state !== "review") unsettled.add(w[0]);
  });

  const candidates = [];
  for(let i = 0; i < VOCAB.length; i++){
    if(introduced.has(i)) continue;
    if(!isLevelEligible(i)) continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => introductionScore(a, seen) - introductionScore(b, seen) || a - b);

  const pick = (respectUnsettled)=>{
    const out = [];
    const forms = new Set();
    for(const idx of candidates){
      const form = VOCAB[idx][0];
      if(forms.has(form)) continue;
      if(respectUnsettled && unsettled.has(form)) continue;
      out.push(idx);
      forms.add(form);
      if(out.length >= n) break;
    }
    return out;
  };
  // Fall back to ignoring the "unsettled" hold if it would otherwise starve the queue
  // entirely (e.g. only homographs of in-progress words remain); never relax the
  // no-duplicate-form-in-one-batch rule.
  const picked = pick(true);
  return picked.length ? picked : pick(false);
}

function introduceNewCardsForToday(){
  const t = todayStr();
  let introducedToday = 0;
  Object.values(state.cards).forEach(c=>{ if(c.introducedOn === t) introducedToday++; });
  const remaining = NEW_PER_DAY - introducedToday;
  if(remaining <= 0) return;
  // Previously this ignored the HSK-level filter (unlike introduceExtraCards, which
  // honoured it), so setting flashcards to e.g. HSK 3 only still created HSK 1 cards
  // that could never come up as due -- they just accumulated invisibly.
  pickNextWords(remaining).forEach(idx => ensureCard(idx));
  saveState();
}
introduceNewCardsForToday();

// Which HSK level sets are currently eligible for flashcard sessions.
function activeFlashLevels(){
  return (Array.isArray(state.flashLevels) && state.flashLevels.length) ? state.flashLevels : [1,2,3];
}
// Word's HSK difficulty tier (1/2/3), stored as VOCAB[i][3]. Defaults to 3 (this app's
// core list is HSK 3.0 Level 3 vocabulary) if missing. Defined here rather than in ui.js
// because isLevelEligible() below is reached from the load-time card introduction, which
// runs while this file executes -- i.e. before ui.js exists.
function vocabLevel(idx){ const v = VOCAB[idx]; return (v && v[3]) || 3; }
function isLevelEligible(idx){
  return activeFlashLevels().includes(vocabLevel(idx));
}

// Which HSK level sets / knowledge tiers are currently eligible for Practice-tab
// sessions (independent of the flashcard-tab equivalents above).
function activePracticeLevels(){
  return (Array.isArray(state.practiceLevels) && state.practiceLevels.length) ? state.practiceLevels : [1,2,3];
}
function activePracticeCategories(){
  return (Array.isArray(state.practiceCategories) && state.practiceCategories.length) ? state.practiceCategories : ["learning","familiar","mastered"];
}
function getDueCardIndices(){
  const now = Date.now();
  return Object.keys(state.cards)
    .filter(k => state.cards[k].due <= now && isLevelEligible(Number(k)))
    .map(Number)
    .sort((a,b)=> state.cards[a].due - state.cards[b].due);
}

// Rough 0-100 "how well you know this" estimate derived from SRS state.
function knowledgePercent(idx){
  const c = getCard(idx);
  if(!c || c.state === "new") return 0;
  if(c.state === "relearning") return 8;
  if(c.state === "learning") return 12 + c.step*18;
  const intervalScore = Math.min(75, Math.log2(c.interval+1)*15);
  const efScore = Math.min(25, Math.max(0, (c.ef-1.3))/(2.5-1.3)*25);
  return Math.round(Math.min(100, 20 + intervalScore + efScore));
}

// grade: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy (Anki's real 4-button scale)
// Bumps a computed new interval up so it's always at least 1 day longer than the
// previous interval (Anki's "minimum interval increase" rule), and applies the
// defensive MAX_INTERVAL_DAYS ceiling. Not used for "Again" (which resets instead).
function bumpInterval(newInterval, prevInterval){
  let ni = Math.min(MAX_INTERVAL_DAYS, Math.round(newInterval));
  if(ni <= prevInterval) ni = Math.min(MAX_INTERVAL_DAYS, prevInterval + 1);
  return ni;
}
/* PURE scheduler: given a card's current scheduling fields and a grade, returns what its
   new fields would be, without mutating anything or reading the clock.

   Extracted from gradeCard() so that grading and the interval PREVIEW shown on the
   Again/Hard/Good/Easy buttons are computed by the same code. Duplicating this logic for
   display would guarantee the two eventually disagree, and a preview that lies about the
   schedule is worse than no preview -- it miscalibrates exactly the judgement the SRS
   depends on. The scheduling rules themselves are unchanged; see the SRS block comment
   above for what each grade does and why.

   Returns the resulting {state, step, ef, interval} plus `dueInMs` (relative to now) and
   the counter deltas the caller should apply. */
const MIN_MS = 60 * 1000;
function scheduleAfterGrade(card, grade){
  let cState = (card.state === "new" || card.state === undefined) ? "learning" : card.state;
  let step = card.step || 0;
  let ef = (card.ef === undefined) ? 2.5 : card.ef;
  let interval = card.interval || 0;
  let dueInMs = 0;
  let correctDelta = 0, wrongDelta = 0, repsDelta = 0, lapsesDelta = 0;

  if(cState === "learning" || cState === "relearning"){
    if(grade === 0){
      // Again: back to the first learning step. Ease is untouched for learning/relearning cards.
      step = 0;
      dueInMs = LEARNING_STEPS_MIN[0] * MIN_MS;
      wrongDelta = 1;
      if(cState === "relearning") lapsesDelta = 1;
    } else if(grade === 1){
      // Hard: repeats the current step, timed at the midpoint between this step's delay
      // and the next one's (Anki describes Hard as "the average of Again and Good").
      const curMin = LEARNING_STEPS_MIN[step] ?? LEARNING_STEPS_MIN[LEARNING_STEPS_MIN.length-1];
      const nextMin = LEARNING_STEPS_MIN[step+1];
      const mins = nextMin !== undefined ? Math.round((curMin+nextMin)/2) : curMin;
      dueInMs = mins * MIN_MS;
      correctDelta = 1;
    } else if(grade === 2){
      // Good: advance to the next step, or graduate if this was the final step.
      const next = step + 1;
      if(next < LEARNING_STEPS_MIN.length){
        step = next;
        dueInMs = LEARNING_STEPS_MIN[next] * MIN_MS;
      } else {
        cState = "review"; step = 0;
        interval = GRADUATING_INTERVAL_DAYS;
        dueInMs = interval * DUE_MS;
      }
      correctDelta = 1; repsDelta = 1;
    } else {
      // Easy: graduate immediately with the larger "easy interval".
      cState = "review"; step = 0;
      interval = EASY_INTERVAL_DAYS;
      dueInMs = interval * DUE_MS;
      correctDelta = 1; repsDelta = 1;
    }
  } else {
    // state === "review"
    const prevInterval = interval;
    if(grade === 0){
      // Again: ease -0.20 (floored 1.3), drops into relearning, interval reset.
      lapsesDelta = 1;
      ef = Math.max(1.3, ef - 0.20);
      cState = "relearning"; step = 0;
      dueInMs = LEARNING_STEPS_MIN[0] * MIN_MS;
      wrongDelta = 1;
      interval = 0;
    } else if(grade === 1){
      // Hard: ease -0.15 (floored 1.3), interval *= 1.2.
      ef = Math.max(1.3, ef - 0.15);
      interval = bumpInterval(prevInterval * 1.2, prevInterval);
      dueInMs = interval * DUE_MS;
      correctDelta = 1; repsDelta = 1;
    } else if(grade === 2){
      // Good: interval *= ease; ease unchanged.
      interval = bumpInterval(prevInterval * ef, prevInterval);
      dueInMs = interval * DUE_MS;
      correctDelta = 1; repsDelta = 1;
    } else {
      // Easy: interval *= ease * 1.3 (easy bonus), THEN ease += 0.15 -- the interval
      // deliberately uses the pre-bonus ease, matching the original implementation.
      interval = bumpInterval(prevInterval * ef * 1.3, prevInterval);
      ef = ef + 0.15;
      dueInMs = interval * DUE_MS;
      correctDelta = 1; repsDelta = 1;
    }
  }
  return {state:cState, step, ef, interval, dueInMs, correctDelta, wrongDelta, repsDelta, lapsesDelta};
}

// Compact human interval, e.g. "10m" / "1d" / "3mo". Used on the grade buttons so the
// learner can see what each answer costs them before committing to it.
function formatInterval(ms){
  const mins = ms / MIN_MS;
  if(mins < 60) return Math.max(1, Math.round(mins)) + "m";
  const hours = mins / 60;
  if(hours < 24) return Math.round(hours) + "h";
  const days = hours / 24;
  if(days < 31) return Math.round(days) + "d";
  const months = days / 30.44;
  if(months < 12) return Math.round(months) + "mo";
  const years = days / 365;
  return (years < 10 ? years.toFixed(1) : Math.round(years)) + "y";
}
// What the learner would be scheduled for if they pressed `grade` on this card now.
function previewInterval(idx, grade){
  const c = getCard(idx) || {state:"new", step:0, ef:2.5, interval:0};
  return formatInterval(scheduleAfterGrade(c, grade).dueInMs);
}

function gradeCard(idx, grade){
  const c = ensureCard(idx);
  const now = Date.now();
  const originalState = c.state;
  const r = scheduleAfterGrade(c, grade);
  c.state = r.state;
  c.step = r.step;
  c.ef = r.ef;
  c.interval = r.interval;
  c.due = now + r.dueInMs;
  if(r.correctDelta) c.correct = (c.correct||0) + r.correctDelta;
  if(r.wrongDelta)   c.wrong   = (c.wrong||0)   + r.wrongDelta;
  if(r.repsDelta)    c.reps    = (c.reps||0)    + r.repsDelta;
  if(r.lapsesDelta)  c.lapses  = (c.lapses||0)  + r.lapsesDelta;

  state.totalReviews = (state.totalReviews||0) + 1;
  // A graded review is what counts as "studied today" for the streak -- this is the one
  // path every flashcard AND practice mode funnels through, so hooking it here covers
  // them all without the streak advancing merely because the app was opened.
  markStudiedToday();
  // Bookkeeping only (does not affect scheduling): tally today's review count and
  // how many were graded Good/Easy, for the Today-tab "reviews today" / "today's
  // accuracy" stats.
  const reviewLogT = todayStr();
  state.reviewLog = state.reviewLog || {};
  const rl = state.reviewLog[reviewLogT] || {n:0, ok:0};
  rl.n += 1;
  if(grade >= 2) rl.ok += 1;
  state.reviewLog[reviewLogT] = rl;
  saveState();
  // XP: a little for effort even on Again, more for Hard/Good/Easy, plus a bonus
  // the moment a card first graduates into the long-term review queue.
  let xp = grade === 0 ? 1 : grade === 1 ? 3 : grade === 2 ? 6 : 8;
  if(originalState !== "review" && c.state === "review") xp += 4;
  awardXP(xp);
}

// Small progress header ("N / M words started · X%") shown above the Flashcards
// session and the Library tab, for a given pool of vocab indices.
function wordsProgressHeader(pool){
  const total = pool.length;
  const done = pool.filter(id=>{ const c = getCard(id); return c && c.state !== "new"; }).length;
  const pct = total ? Math.round(done/total*100) : 0;
  return `
    <div class="progress-header">
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
      <div class="muted center" style="margin-top:4px;font-size:12px;">${done} / ${total} words started · ${pct}%</div>
    </div>`;
}

