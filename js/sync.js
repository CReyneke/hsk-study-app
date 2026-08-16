/* ============================ CROSS-DEVICE SYNC (GitHub Gist) ============================
   Lets the same progress follow you between your phone and computer without a real backend:
   the same `state` object js/state.js already reads/writes to localStorage is also mirrored
   into a private GitHub Gist you own, keyed by one personal access token you paste into each
   device (no accounts, no passwords collected by this app). Both devices use the same token,
   so we auto-discover the one gist that stores hsk3-study-progress.json instead of asking you
   to copy a gist ID around.

   Conflict handling is intentionally simple: whichever side has the newer state.updatedAt wins
   outright (last-write-wins on the whole blob), same tradeoff Anki's own sync makes. Fine for
   one person alternating devices; not meant for two devices being actively used at once.

   Loaded last (after app.js) so every other global (state, saveState, render, checkAchievements,
   introduceNewCardsForToday) already exists -- see the load-order comment in index.html.
*/
const SYNC_TOKEN_KEY = "hsk3_sync_token";
const SYNC_GIST_KEY = "hsk3_sync_gist_id";
const SYNC_LAST_KEY = "hsk3_sync_last";
const SYNC_GIST_FILENAME = "hsk3-study-progress.json";
const SYNC_PUSH_DEBOUNCE_MS = 5000;

function syncToken(){ return localStorage.getItem(SYNC_TOKEN_KEY) || ""; }
function syncGistId(){ return localStorage.getItem(SYNC_GIST_KEY) || ""; }
function syncConfigured(){ return !!(syncToken() && syncGistId()); }

async function ghFetch(url, opts){
  opts = opts || {};
  opts.headers = Object.assign({
    "Authorization": "Bearer " + syncToken(),
    "Accept": "application/vnd.github+json"
  }, opts.headers || {});
  const res = await fetch(url, opts);
  if(!res.ok){
    const body = await res.text().catch(()=>"");
    throw new Error("GitHub API " + res.status + (body ? ": " + body.slice(0,200) : ""));
  }
  return res.status === 204 ? null : res.json();
}

async function createSyncGist(){
  const data = await ghFetch("https://api.github.com/gists", {
    method: "POST",
    body: JSON.stringify({
      description: "HSK 3.0 Study App progress (auto-synced by the app -- editing this manually can break sync)",
      public: false,
      files: { [SYNC_GIST_FILENAME]: { content: JSON.stringify(state) } }
    })
  });
  localStorage.setItem(SYNC_GIST_KEY, data.id);
  return data.id;
}

// Finds the gist this app already created (by filename) among the token owner's own
// gists, so a second device only needs the same token pasted in -- no gist ID to copy.
// Returns {id, existed} so callers can tell "this is the first device ever" apart from
// "someone already set up sync" -- that distinction matters for connectSync (see below).
async function findOrCreateGist(){
  const gists = await ghFetch("https://api.github.com/gists?per_page=100");
  const existing = gists.find(g => g.files && g.files[SYNC_GIST_FILENAME]);
  if(existing){ localStorage.setItem(SYNC_GIST_KEY, existing.id); return {id: existing.id, existed: true}; }
  const id = await createSyncGist();
  return {id, existed: false};
}

async function pushState(){
  if(!syncConfigured()) return;
  await ghFetch("https://api.github.com/gists/" + syncGistId(), {
    method: "PATCH",
    body: JSON.stringify({ files: { [SYNC_GIST_FILENAME]: { content: JSON.stringify(state) } } })
  });
  localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
}

async function pullState(){
  if(!syncConfigured()) return null;
  const data = await ghFetch("https://api.github.com/gists/" + syncGistId());
  const file = data.files && data.files[SYNC_GIST_FILENAME];
  if(!file || !file.content) return null;
  try{ return JSON.parse(file.content); }catch(e){ return null; }
}

// Snapshot of state's real content, excluding the updatedAt stamp itself (which would
// otherwise make every snapshot "different" trivially). Used to tell a genuine progress
// change apart from the studyTimeTick interval's saveState() call, which fires every 5
// seconds regardless of whether anything actually changed -- see the saveState wrapper
// below for why that distinction matters.
function stateContentSnapshot(){
  const clone = Object.assign({}, state);
  delete clone.updatedAt;
  return JSON.stringify(clone);
}
let _lastContentSnapshot = stateContentSnapshot();

/* ---- Guarding against a bad pull ----
   Adopting a remote state overwrites everything local, so it's the one operation here
   that can destroy real work. Two safeguards: keep a copy of what was replaced, and
   refuse to do it silently when the incoming state looks like it has lost most of the
   learner's progress (a half-written gist, a hand-edited one, or a device that was
   somehow reset). In that case the user is asked rather than obeyed. */
const SYNC_BACKUP_KEY = "hsk3_srs_v1_backup";

function backupLocalState(){
  try{
    localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), state: state }));
  }catch(e){ console.error("Could not back up local state before sync", e); }
}
function hasLocalBackup(){
  try{ return !!localStorage.getItem(SYNC_BACKUP_KEY); }catch(e){ return false; }
}
function restoreLocalBackup(){
  try{
    const raw = JSON.parse(localStorage.getItem(SYNC_BACKUP_KEY));
    if(!raw || !raw.state) return false;
    // Adopt without the safety check -- the user explicitly asked for this copy.
    applyState(raw.state);
    return true;
  }catch(e){ console.error("Could not restore backup", e); return false; }
}

// Would adopting `remote` throw away a meaningful amount of local progress? Only
// meaningful once there's something to lose, hence the floor on local card count.
function remoteLosesProgress(remote){
  const localCards = Object.keys((state && state.cards) || {}).length;
  const remoteCards = Object.keys((remote && remote.cards) || {}).length;
  if(localCards < 20) return false;
  return remoteCards < localCards * 0.5;
}

// Swaps in a new state object and re-runs the load-time steps that depend on it, without
// re-running anything that would double-count. normalizeState() is essential here: the
// incoming state was written by whatever app version the other device runs, so fields
// added since then would otherwise arrive undefined (this previously crashed the
// Practice tab on `state.lastPracticeSet.fill`).
function applyState(next){
  state = normalizeState(next);
  _lastContentSnapshot = stateContentSnapshot(); // don't immediately echo this pull back as a push
  _originalSaveState();
  introduceNewCardsForToday();
  checkAchievements();
  render();
}

// A remote state pending the user's decision, when auto-adopting looked unsafe.
let pendingRemote = null;

function adoptRemoteState(remote){
  backupLocalState();
  applyState(remote);
}
// Adopt unless it would silently destroy local progress; returns true if it was applied.
function adoptRemoteStateGuarded(remote){
  if(remoteLosesProgress(remote)){
    pendingRemote = remote;
    setSyncStatus("conflict");
    renderSyncPanel();
    return false;
  }
  adoptRemoteState(remote);
  return true;
}

let pushTimer = null;
function scheduleSyncPush(){
  if(!syncConfigured()) return;
  setSyncStatus("pending");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(()=>{
    pushState().then(()=> setSyncStatus("synced")).catch(e=>{
      console.error("Sync push failed", e);
      setSyncStatus("error", e.message);
    });
  }, SYNC_PUSH_DEBOUNCE_MS);
}

// Wrap the existing saveState (defined in state.js) so every save also stamps
// updatedAt and schedules a debounced cloud push, without editing state.js itself.
// updatedAt is ONLY advanced when the actual content changed (see stateContentSnapshot) --
// otherwise the unconditional 5-second studyTimeTick save would keep bumping "last
// updated" on every device that merely has the app open, even with zero new progress,
// which made whichever device you opened most recently always "win" a sync regardless
// of which one actually had more real progress. That was the sync bug.
const _originalSaveState = saveState;
saveState = function(){
  const snap = stateContentSnapshot();
  const changed = snap !== _lastContentSnapshot;
  if(changed){
    _lastContentSnapshot = snap;
    state.updatedAt = Date.now();
  }
  _originalSaveState();
  if(changed) scheduleSyncPush();
};

async function connectSync(token){
  localStorage.setItem(SYNC_TOKEN_KEY, token);
  setSyncStatus("checking");
  try{
    const {existed} = await findOrCreateGist();
    if(existed){
      // Someone (this token) already set up sync before -- treat that as authoritative
      // rather than risking this device's local state winning an updatedAt tie-break
      // just because it's undefined/0 on both sides for a brand-new device.
      const remote = await pullState();
      if(remote){ if(!adoptRemoteStateGuarded(remote)) return; }
      else await pushState();
    } else {
      // First device to ever connect this token: its current progress becomes the
      // shared baseline.
      state.updatedAt = Date.now();
      _lastContentSnapshot = stateContentSnapshot();
      await pushState();
    }
    setSyncStatus("synced");
  }catch(e){
    console.error("Sync connect failed", e);
    localStorage.removeItem(SYNC_TOKEN_KEY);
    localStorage.removeItem(SYNC_GIST_KEY);
    setSyncStatus("error", e.message);
  }
  renderSyncPanel();
}

function disconnectSync(){
  clearTimeout(pushTimer);
  localStorage.removeItem(SYNC_TOKEN_KEY);
  localStorage.removeItem(SYNC_GIST_KEY);
  localStorage.removeItem(SYNC_LAST_KEY);
  setSyncStatus("idle");
  renderSyncPanel();
}

async function syncNow(){
  if(!syncConfigured()){ renderSyncPanel(); return; }
  setSyncStatus("checking");
  try{
    const remote = await pullState();
    if(remote && (remote.updatedAt||0) > (state.updatedAt||0)){
      if(!adoptRemoteStateGuarded(remote)) return;
    } else if((state.updatedAt||0) > (remote && remote.updatedAt||0)){
      await pushState();
    }
    setSyncStatus("synced");
  }catch(e){
    console.error("Sync now failed", e);
    setSyncStatus("error", e.message);
  }
  renderSyncPanel();
}

async function initialSyncPull(){
  if(!syncConfigured()) return;
  setSyncStatus("checking");
  try{
    const remote = await pullState();
    if(remote && (remote.updatedAt||0) > (state.updatedAt||0)){
      if(!adoptRemoteStateGuarded(remote)) return;
    }
    setSyncStatus("synced");
  }catch(e){
    console.error("Initial sync pull failed", e);
    setSyncStatus("error", e.message);
  }
  renderSyncPanel();
}

// Best-effort final push when the tab is backgrounded/closed, so switching devices
// right after closing the app doesn't lose the last few seconds of progress.
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden" && syncConfigured()) pushState().catch(()=>{});
});

/* ---------------------------- UI: floating button + bottom-sheet panel ---------------------------- */
let syncStatus = "idle"; // idle | checking | pending | synced | error
let syncStatusDetail = "";
function setSyncStatus(s, detail){
  syncStatus = s;
  syncStatusDetail = detail || "";
  const dot = document.querySelector(".sync-fab .dot");
  // A conflict shares the error colour: both mean "this needs you to look at it".
  if(dot) dot.className = "dot " + (s==="synced"?"ok":s==="pending"||s==="checking"?"pending":(s==="error"||s==="conflict")?"error":"");
}

function lastSyncedText(){
  const t = Number(localStorage.getItem(SYNC_LAST_KEY) || 0);
  if(!t) return "Never";
  const secs = Math.round((Date.now()-t)/1000);
  if(secs < 60) return "Just now";
  if(secs < 3600) return Math.round(secs/60) + "m ago";
  if(secs < 86400) return Math.round(secs/3600) + "h ago";
  return new Date(t).toLocaleDateString();
}

function buildSyncFab(){
  const btn = document.createElement("button");
  btn.className = "sync-fab pixel-font";
  btn.innerHTML = `<span class="dot"></span><span>Sync</span>`;
  btn.onclick = toggleSyncPanel;
  document.body.appendChild(btn);
  return btn;
}

let syncPanelOpen = false;
function toggleSyncPanel(){
  syncPanelOpen = !syncPanelOpen;
  if(syncPanelOpen) renderSyncPanel();
  else{
    const el = document.getElementById("syncPanelOverlay");
    if(el) el.remove();
  }
}

function renderSyncPanel(){
  let overlay = document.getElementById("syncPanelOverlay");
  if(!syncPanelOpen){ if(overlay) overlay.remove(); return; }
  if(!overlay){
    overlay = document.createElement("div");
    overlay.id = "syncPanelOverlay";
    overlay.className = "word-pop-overlay";
    overlay.onclick = (e)=>{ if(e.target === overlay) toggleSyncPanel(); };
    document.body.appendChild(overlay);
  }
  const connected = syncConfigured();
  overlay.innerHTML = `
    <div class="word-pop">
      <div class="word-pop-head">
        <h3 style="margin:0;">Sync across devices</h3>
      </div>
      <div class="card" style="margin-top:12px;">
        ${connected ? `
          ${pendingRemote ? `
            <div class="sync-conflict">
              <b>The cloud copy has much less progress than this device.</b>
              <p class="muted" style="margin:6px 0;">
                This device has ${Object.keys(state.cards||{}).length} words started; the cloud copy has
                ${Object.keys((pendingRemote&&pendingRemote.cards)||{}).length}.
                Nothing has been changed. Pick which one to keep.
              </p>
              <div class="flash-controls">
                <button class="secondary" id="syncKeepLocal">Keep this device</button>
                <button class="secondary" id="syncUseRemote">Use the cloud copy</button>
              </div>
            </div>
          ` : ""}
          <div class="stat-row">
            <div class="stat"><div class="num" style="font-size:16px;">${syncStatus==="error"?"⚠️":syncStatus==="conflict"?"⚠️":"✅"}</div><div class="lbl">${syncStatus}</div></div>
            <div class="stat"><div class="num" style="font-size:16px;">${lastSyncedText()}</div><div class="lbl">Last synced</div></div>
          </div>
          ${syncStatus==="error" ? `<p class="muted" style="color:var(--red);">${syncStatusDetail}</p>` : ""}
          <div class="flash-controls">
            <button class="secondary" id="syncNowBtn">Sync now</button>
            <button class="secondary" id="syncDisconnectBtn">Disconnect</button>
            ${hasLocalBackup() ? `<button class="secondary" id="syncRestoreBtn">Restore backup</button>` : ""}
          </div>
        ` : `
          <p class="muted">Paste a GitHub personal access token (scope: <b>gist</b> only) to sync progress between your phone and computer. Use the <b>same token on every device</b> -- the app finds your progress automatically, no codes to copy.</p>
          <input type="text" id="syncTokenInput" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" style="width:100%;margin:8px 0;" autocomplete="off" autocapitalize="off" spellcheck="false">
          ${syncStatus==="error" ? `<p class="muted" style="color:var(--red);">${syncStatusDetail}</p>` : ""}
          <button class="primary" id="syncConnectBtn" style="width:100%;">${syncStatus==="checking"?"Connecting…":"Connect"}</button>
        `}
      </div>
      <button class="word-pop-close" id="syncPanelClose">Close</button>
    </div>
  `;
  document.getElementById("syncPanelClose").onclick = toggleSyncPanel;
  if(connected){
    document.getElementById("syncNowBtn").onclick = syncNow;
    document.getElementById("syncDisconnectBtn").onclick = ()=>{
      if(confirm("Disconnect sync on this device? Your local progress stays, but it will stop mirroring to the cloud.")) disconnectSync();
    };
    const restoreBtn = document.getElementById("syncRestoreBtn");
    if(restoreBtn) restoreBtn.onclick = ()=>{
      if(!confirm("Replace this device's progress with the backup taken before the last sync?")) return;
      if(restoreLocalBackup()){ pendingRemote = null; setSyncStatus("synced"); }
      renderSyncPanel();
    };
    if(pendingRemote){
      // Keeping this device wins the conflict by pushing local up, which also stops the
      // same smaller remote from being offered again on the next pull.
      document.getElementById("syncKeepLocal").onclick = ()=>{
        pendingRemote = null;
        state.updatedAt = Date.now();
        _originalSaveState();
        setSyncStatus("pending");
        pushState().then(()=> setSyncStatus("synced")).catch(e=> setSyncStatus("error", e.message))
          .finally(()=> renderSyncPanel());
        renderSyncPanel();
      };
      document.getElementById("syncUseRemote").onclick = ()=>{
        const remote = pendingRemote;
        pendingRemote = null;
        adoptRemoteState(remote);   // backs up local first
        setSyncStatus("synced");
        renderSyncPanel();
      };
    }
  } else {
    document.getElementById("syncConnectBtn").onclick = ()=>{
      const val = document.getElementById("syncTokenInput").value.trim();
      if(!val) return;
      connectSync(val);
    };
  }
}

buildSyncFab();
setSyncStatus(syncConfigured() ? "checking" : "idle");
initialSyncPull();

/* ---------------------------- PWA service worker ---------------------------- */
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("service-worker.js").catch(e=> console.error("SW register failed", e));
  });
}
