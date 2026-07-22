/* ============================ ROUTING / RENDER ============================ */
const NAV_ARROW_SVG = `<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M7.17418 1.66471L0.574525 1.66471L0.589256 6.74452e-05L10.0173 6.90346e-05L10.0173 9.42815L8.3527 9.44288L8.3527 2.84322L1.17851 10.0174L3.1533e-06 8.8389L7.17418 1.66471Z" fill="black"/></svg>`;
const TABS = [
  {tab:"today", label:"Today"},
  {tab:"flash", label:"Flashcards"},
  {tab:"library", label:"Library"},
  {tab:"reading", label:"Reading"},
  {tab:"grammar", label:"Grammar"},
  {tab:"practice", label:"Practice"},
  {tab:"progress", label:"Progress"}
];
let currentTab = "today";
const tabsEl = document.getElementById("tabs");
tabsEl.innerHTML = TABS.map((t,i)=>`
  <button data-tab="${t.tab}" class="${t.tab==='today'?'active':''}">
    <span class="nav-idx">${String(i+1).padStart(2,'0')}</span>
    <span class="nav-label">${t.label}</span>
    <span class="nav-arrow">${NAV_ARROW_SVG}</span>
  </button>
`).join("");
tabsEl.addEventListener("click", e=>{
  const btn = e.target.closest("button");
  if(!btn) return;
  currentTab = btn.dataset.tab;
  [...tabsEl.children].forEach(b=>b.classList.toggle("active", b===btn));
  render();
});

document.getElementById("dateLine").textContent = new Date().toDateString() + " — day " + dayOfYear() + " of the year";

function render(){
  const app = document.getElementById("app");
  app.innerHTML = "";
  // Defensive: if currentTab somehow holds a value that's no longer a valid nav
  // tab (e.g. the removed "listening" tab, from a stale in-memory value), fall
  // back to Today instead of rendering a blank page.
  if(!TABS.some(t=>t.tab===currentTab)){
    currentTab = "today";
    setActiveTab("today");
  }
  // Marquee ticker only shows on the Today/home tab.
  const ticker = document.getElementById("homeTicker");
  if(ticker) ticker.hidden = currentTab !== "today";
  // The story-reader audiobook playback bar is fixed/global (appended to <body>,
  // not inside #app), so switching tabs away from the reader must stop it
  // explicitly here -- otherwise TTS keeps talking and the bar keeps floating
  // over an unrelated tab. renderReading() itself calls stopPlayback() too (for
  // in-tab navigation between dashboard/chapters/reader), so this is the "leaving
  // Reading entirely" case.
  if(!(currentTab === "reading" && typeof readingView !== "undefined" && readingView === "reader")) stopPlayback();
  if(currentTab === "today") renderToday(app);
  else if(currentTab === "flash") renderFlash(app);
  else if(currentTab === "library") renderLibrary(app);
  else if(currentTab === "reading") renderReading(app);
  else if(currentTab === "listening") renderListening(app);
  else if(currentTab === "grammar") renderGrammar(app);
  else if(currentTab === "practice") renderPractice(app);
  else if(currentTab === "progress") renderProgress(app);
}

/* ---- Study time tracking ----
   Lightweight active-time accumulator: every few seconds, if the user is on a
   "studying" tab (Flashcards/Practice/Reading/Grammar -- not Today/
   Library/Progress) and the document is visible, add the elapsed time since the
   last tick into today's bucket of state.studyTime ({"YYYY-M-D": ms}). Not
   second-perfect (ticks are batched, and a tick that spans a tab-switch or a
   hidden period is simply dropped rather than pro-rated), but robust: it never
   throws, never double-counts a huge idle/sleep gap (delta is capped), and
   resets its clock on every visibility change so time spent on a hidden tab
   is never retroactively credited once the tab becomes visible again. */
const STUDY_TABS = new Set(["flash","practice","reading","grammar"]);
let lastStudyTick = Date.now();
function studyTimeTick(){
  const now = Date.now();
  const delta = now - lastStudyTick;
  lastStudyTick = now;
  // Ignore non-positive deltas (clock weirdness) and huge gaps (sleep/backgrounded
  // for a long time) so a single tick can never inflate the total unreasonably.
  if(delta <= 0 || delta > 60000) return;
  if(!STUDY_TABS.has(currentTab)) return;
  if(typeof document !== "undefined" && document.visibilityState && document.visibilityState !== "visible") return;
  const t = todayStr();
  state.studyTime = state.studyTime || {};
  state.studyTime[t] = (state.studyTime[t] || 0) + delta;
}
if(typeof setInterval === "function"){
  setInterval(()=>{ studyTimeTick(); saveState(); }, 5000);
}
if(typeof document !== "undefined" && document.addEventListener){
  document.addEventListener("visibilitychange", ()=>{ lastStudyTick = Date.now(); });
}
// Sums state.studyTime across every recorded day (all-time total, ms).
function totalStudyTimeMs(){
  return Object.values(state.studyTime || {}).reduce((a,b)=>a+b, 0);
}
// Formats a millisecond duration as a compact "Xh Ym" / "Xm" string for widgets.
function formatStudyTime(ms){
  const totalMin = Math.round(ms / 60000);
  if(totalMin < 1) return "< 1m";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? (h + "h " + m + "m") : (m + "m");
}

/* ============================ INIT ============================ */
checkAchievements();
render();
