/* ============================ VILLAGE ============================
   Guild mapping layer + stats for the incremental-village view (renderVillage).
   Maps existing content onto the four skill-type "guilds" from the game spec and
   reads population/growth directly off `state` -- no separate mock data. Vocab and
   Grammar are wired up first (both have real progress signals already); Listening
   and Speaking are left as locked placeholders until their guilds have a real hook. */
function guildForVocabIndex(idx){ return {guild:"vocab", level: vocabLevel(idx)}; }
function guildForGrammarIndex(idx){
  const g = GRAMMAR[idx];
  return {guild:"grammar", level: (g && g.lvl) || 3};
}
// One-directional self-report: marks a grammar point as learned (small XP reward,
// once). No un-marking -- mirrors how SRS mastery only moves forward on the vocab
// side, so the tower can't be farmed by toggling a point on and off.
function markGrammarLearned(idx){
  state.grammarLearned = state.grammarLearned || {};
  if(state.grammarLearned[idx]) return;
  state.grammarLearned[idx] = true;
  awardXP(3);
  saveState();
  checkAchievements();
}
// Cosmetic-only "has today's studying happened yet" flag -- used to mute the village
// scene (paused animations, lower opacity) when true. Never touches XP or SRS state.
function villageIsQuietToday(){ return state.lastActiveDay !== todayStr(); }
function getVillageStats(){
  const d = computeDerivedStats();
  const dueIdx = getDueCardIndices();
  const learnedIdx = GRAMMAR.map((g,i)=>i).filter(i=> state.grammarLearned && state.grammarLearned[i]);
  return {
    level: d.level,
    quiet: villageIsQuietToday(),
    vocab: {
      total: VOCAB.length,
      started: d.started,
      mastered: d.mature,
      byLevel: {1:d.mastered1, 2:d.mastered2, 3:d.mastered3},
      due: dueIdx.length,
      dueSample: dueIdx.slice(0, 8)
    },
    grammar: {
      total: GRAMMAR.length,
      learned: learnedIdx.length,
      learnedIdx
    }
  };
}

/* ---- Village ----
   Renders the four skill-type "guilds" as a small village scene, reading directly
   from getVillageStats() (real state, no mock data). Vocab Guild and Grammar Tower
   are fully wired; Listening Dock and Speaking Stage are locked placeholders until
   those guilds have their own progress hooks (see hsk_village_game_spec.md). */
/* ---- Village pixel-art sprite helpers ----
   All village art is cropped from the "Sprout Lands" asset pack (by Cup Nooble,
   village-assets/) via CSS background-position slicing -- see credit in <footer>.
   Sprite coordinates come from SPRITE_MANIFEST (js/sprite-manifest.js), generated
   from map_tilesheet.py-labeled sheets under village-assets/manifests/ -- not
   hand-eyeballed pixel math. Look sprites up by name, never hardcode tile math. */
const VA = "village-assets/";
const BUILDING_SCALE = 2.2;
const CHAR_SCALE = 2.5;   // must match the pixel values hardcoded into the
                          // villagerFrames keyframes in CSS (48*2.5=120 per cell)
const SIGN_SCALE = 2;
const ICON_SCALE = 1.6;
// Looks up a named sprite in SPRITE_MANIFEST[sheetKey].sprites[name] and returns
// the CSS (background-image/size/position) to crop + scale it.
function sprite(sheetKey, name, scale){
  const sheet = SPRITE_MANIFEST[sheetKey];
  const s = sheet && sheet.sprites[name];
  if(!s){ console.warn(`Unknown sprite: ${sheetKey}.${name}`); return ""; }
  return `background-image:url('${VA}${sheet.file}');width:${Math.round(s.w*scale)}px;height:${Math.round(s.h*scale)}px;`+
    `background-size:${Math.round(sheet.sheetW*scale)}px ${Math.round(sheet.sheetH*scale)}px;`+
    `background-position:-${Math.round(s.x*scale)}px -${Math.round(s.y*scale)}px;`;
}
// tier: 1=hut, 2=house, 3=brick manor. variant picks a color column (0/1/2) so the
// two active guilds (vocab/grammar) don't render as literally the same building.
const BUILDING_VARIANTS = ["variant_a","variant_b","variant_c"];
function buildingStyle(tier, variant){
  const name = BUILDING_VARIANTS[variant];
  if(tier===1) return sprite("buildingHut", name, BUILDING_SCALE);
  if(tier===2) return sprite("buildingHouse", name, BUILDING_SCALE);
  return sprite("buildingBrick", name, BUILDING_SCALE);
}
function signStyle(name){ return sprite("signs", name, SIGN_SCALE); }
function iconStyle(name){ return sprite("icons", name, ICON_SCALE); }
// Only width/height/background-image/background-size -- background-position (the
// walk frame) is driven entirely by the villagerFrames CSS keyframe animation.
function villagerBaseStyle(){
  const sheet = SPRITE_MANIFEST.character;
  return `background-image:url('${VA}${sheet.file}');width:${48*CHAR_SCALE}px;height:${48*CHAR_SCALE}px;`+
    `background-size:${Math.round(sheet.sheetW*CHAR_SCALE)}px ${Math.round(sheet.sheetH*CHAR_SCALE)}px;`;
}
function treeStyle(scale){ return sprite("trees", "tree_round", scale); }
// Ambient ground decoration, coordinates verified against a map_tilesheet.py-labeled
// grid (16px cells) rather than eyeballed -- see village-assets/manifests/.
const DECO_SPRITES = {
  flowerYellow: (s)=>sprite("flowersStones","flower_yellow",s),
  flowerPink:   (s)=>sprite("flowersStones","flower_pink",s),
  flowerBlue:   (s)=>sprite("flowersStones","flower_blue",s),
  bush:         (s)=>sprite("flowersStones","bush",s),
  rock:         (s)=>sprite("flowersStones","rock",s),
  chest:        (s)=>sprite("chest","chest_closed",s)
};

// Guild building tiers grow off real, guild-specific progress (not the overall
// player level) so each district's look tracks the study activity that built it.
function vocabTier(masteredCount){ return masteredCount>=150 ? 3 : masteredCount>=25 ? 2 : 1; }
function grammarTier(learnedCount){ return learnedCount>=35 ? 3 : learnedCount>=10 ? 2 : 1; }

function villagersHtml(count, dueCount){
  let html = "";
  for(let i=0;i<count;i++){
    const isDue = i < dueCount;
    html += `<div class="villager-wrap" style="animation-delay:-${(i*0.37).toFixed(2)}s;">
      <div class="villager" style="${villagerBaseStyle()}"></div>
      ${isDue ? `<div class="due-badge sprite" style="${iconStyle("exclamation")}" title="Due for review"></div>` : ""}
    </div>`;
  }
  return html;
}

// left/top are percentages within .village-island; the plot anchors at its own
// bottom-center to that point (see .plot{transform:translate(-50%,-100%)}), so
// (left,top) is effectively "where this building's front door touches the ground."
function renderVillagePlot(opts){
  const {label, badgeText, signHtml, buildingHtml, workersHtml, locked, goto, left, top} = opts;
  return `
    <div class="plot${locked?' locked':''}" style="left:${left}%;top:${top}%;" ${goto?`data-goto="${goto}"`:""}>
      <div class="plot-sign sprite" style="${signHtml}"></div>
      <div class="plot-building-wrap">
        <div class="plot-building sprite" style="${buildingHtml}"></div>
        ${locked ? `<div class="locked-badge sprite" style="${iconStyle("no_entry")}" title="Not built yet"></div>` : ""}
        <div class="plot-workers">${workersHtml||""}</div>
      </div>
      <div class="plot-tag">
        <span class="plot-label pixel-font">${label}</span>
        <span class="plot-badge">${badgeText}</span>
      </div>
    </div>
  `;
}
function deco(cls, left, top, styleStr){
  return `<div class="deco ${cls} sprite" style="left:${left}%;top:${top}%;${styleStr}"></div>`;
}

function renderVillage(app){
  const v = getVillageStats();
  const wrap = document.createElement("div");
  wrap.className = "village-scene-wrap" + (v.quiet ? " village-quiet" : "");

  const vTier = vocabTier(v.vocab.mastered);
  const gTier = grammarTier(v.grammar.learned);
  const vocabWorkers = v.vocab.started>0 ? Math.min(6, Math.max(1, Math.ceil(v.vocab.started/40))) : 0;
  const vocabDueShown = Math.min(vocabWorkers, v.vocab.due, 4);
  const grammarWorkers = v.grammar.learned>0 ? Math.min(6, Math.max(1, Math.ceil(v.grammar.learned/8))) : 0;

  // Village-wide dressing (trees) grows with overall player level -- the one piece
  // of evolution that isn't tied to a single guild's progress. Fixed scatter spots
  // so the scene reads as one hand-placed island rather than a repeating pattern.
  const treeSpots = [[10,38],[91,34],[15,90],[88,92],[50,14]];
  const treeCount = v.level>=20 ? 5 : v.level>=10 ? 3 : v.level>=5 ? 2 : 1;
  const treesHtml = treeSpots.slice(0,treeCount).map(([l,t],i)=>
    deco("deco-tree", l, t, treeStyle(1.6 + (i%2)*0.3))
  ).join("");

  // Small ambient ground clutter -- a couple always present, more unlocked
  // alongside the trees so the island keeps filling in as the player levels up.
  // Anchored just beside each building's own ground line (not out in open space)
  // so they can't end up buried under a different, larger building footprint.
  const clutterSpots = [
    ["bush",15,63], ["rock",73,42], ["flowerYellow",32,89],
    ["flowerBlue",91,79], ["chest",37,63], ["flowerPink",50,96]
  ];
  const clutterCount = v.level>=20 ? 6 : v.level>=10 ? 4 : v.level>=5 ? 3 : 2;
  const clutterHtml = clutterSpots.slice(0,clutterCount).map(([kind,l,t])=>
    deco("deco-tuft", l, t, DECO_SPRITES[kind](2.2))
  ).join("");

  const plotsHtml = [
    renderVillagePlot({
      label:"Vocab Guild",
      badgeText:`${v.vocab.mastered} / ${v.vocab.total}`,
      signHtml:signStyle("star"),
      buildingHtml:buildingStyle(vTier,0),
      workersHtml:villagersHtml(vocabWorkers, vocabDueShown),
      goto:"flash", left:26, top:62
    }),
    renderVillagePlot({
      label:"Grammar Tower",
      badgeText:`${v.grammar.learned} / ${v.grammar.total}`,
      signHtml:signStyle("gem"),
      buildingHtml:buildingStyle(gTier,1),
      workersHtml:villagersHtml(grammarWorkers, 0),
      goto:"grammar", left:63, top:40
    }),
    renderVillagePlot({
      label:"Listening Dock",
      badgeText:"Coming soon",
      signHtml:signStyle("blank"),
      buildingHtml:buildingStyle(1,2),
      locked:true, left:42, top:88
    }),
    renderVillagePlot({
      label:"Speaking Stage",
      badgeText:"Coming soon",
      signHtml:signStyle("blank"),
      buildingHtml:buildingStyle(1,2),
      locked:true, left:80, top:78
    })
  ].join("");

  wrap.innerHTML = `
    <div class="village-scene-header pixel-font">Your village · Level ${v.level}</div>
    <p class="muted">${v.quiet ? "The village looks a little quiet today — study something to wake it back up." : "Busy today — villagers are out and about."}</p>
    <div class="village-scene">
      <div class="village-island">
        ${treesHtml}
        ${plotsHtml}
        ${clutterHtml}
      </div>
    </div>
  `;
  app.appendChild(wrap);
  wrap.querySelectorAll(".plot[data-goto]").forEach(el=>{
    el.onclick = ()=>{
      currentTab = el.dataset.goto;
      setActiveTab(currentTab);
      render();
    };
  });
}

