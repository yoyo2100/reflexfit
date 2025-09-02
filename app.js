// ReflexFit v1.0 — No frameworks, no backend.
// All data stored locally. Works offline with service worker.

const STORE_KEY = "reflexfit_v1";
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const defaultData = {
  createdAt: Date.now(),
  settings: { weeklyGoal: 200, sound: false },
  trials: [], // {ts, ms, mode:'visual'|'audio', tooSoon:boolean}
  logs: [],   // {ts, type, title, minutes, rpe, notes}
  dayNotes: [] // {date:'YYYY-MM-DD', sleepHrs, caffeine, mood}
};

let state = load();

function load(){
  try{
    const txt = localStorage.getItem(STORE_KEY);
    if(!txt) return structuredClone(defaultData);
    const obj = JSON.parse(txt);
    // simple migrations
    if(!obj.settings) obj.settings = { weeklyGoal: 200, sound: false };
    if(!Array.isArray(obj.trials)) obj.trials = [];
    if(!Array.isArray(obj.logs)) obj.logs = [];
    if(!Array.isArray(obj.dayNotes)) obj.dayNotes = [];
    return obj;
  }catch(e){
    console.warn("resetting store due to parse error", e);
    return structuredClone(defaultData);
  }
}
function save(){
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  updateHeader();
}

function formatMs(ms){
  if(ms == null) return "—";
  return ms.toFixed(0) + " ms";
}
function ymd(ts){ const d = new Date(ts); return d.toISOString().slice(0,10); }
function todayYMD(){ return ymd(Date.now()); }

// ---- UI tabs ----
$$(".tabs .tab, .actions .primary, .actions .ghost").forEach(btn=>{
  btn.addEventListener("click", (e)=>{
    const target = btn.dataset.target;
    if(!target) return;
    showView(target);
  });
});
function showView(id){
  $$(".view").forEach(v=>v.classList.remove("active"));
  $$(".tab").forEach(t=>t.classList.remove("active"));
  $("#"+id).classList.add("active");
  $(`.tab[data-target="${id}"]`)?.classList.add("active");
  if(id==="stats") drawCharts();
  if(id==="home") refreshHome();
  if(id==="log") refreshLogs();
}

// ---- Header XP & streak ----
function calcXP(){
  // +5 XP per reaction test, +10 XP per log. Cap counted in current week.
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay()); // Sun start
  weekStart.setHours(0,0,0,0);
  const ws = weekStart.getTime();
  let xp = 0;
  for(const t of state.trials) if(t.ts >= ws && !t.tooSoon) xp += 5;
  for(const l of state.logs) if(l.ts >= ws) xp += 10;
  return xp;
}
function calcStreak(){
  // streak = consecutive days with ANY activity (trial or log).
  let d=0, streak=0;
  while(true){
    const dayStart = new Date(); dayStart.setDate(dayStart.getDate()-d); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate()+1);
    const s = dayStart.getTime(), e = dayEnd.getTime();
    const active = state.trials.some(t=>t.ts>=s && t.ts<e && !t.tooSoon) ||
                   state.logs.some(l=>l.ts>=s && l.ts<e);
    if(active){ streak++; d++; } else break;
  }
  return streak;
}
function updateHeader(){
  const goal = state.settings.weeklyGoal || 200;
  const xp = calcXP();
  $("#xpText").textContent = `${xp} / ${goal}`;
  $("#xpFill").style.width = Math.min(100, Math.round(100*xp/goal)) + "%";
  $("#streakBadge").textContent = `🔥 x${calcStreak()}`;
}

// ---- Home metrics ----
function refreshHome(){
  const last = [...state.trials].reverse().find(t=>!t.tooSoon);
  $("#lastReaction").textContent = last ? formatMs(last.ms) : "—";
  $("#avg7d").textContent = formatMs(avgReactionDays(7));
  $("#weekSessions").textContent = String(sessionsThisWeek());
}
function sessionsThisWeek(){
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0,0,0,0);
  const ws = weekStart.getTime();
  const days = new Set();
  for(const l of state.logs) if(l.ts >= ws) days.add(ymd(l.ts));
  return days.size;
}
function avgReactionDays(nDays){
  const cutoff = Date.now() - nDays*86400000;
  const arr = state.trials.filter(t=>t.ts>=cutoff && !t.tooSoon).map(t=>t.ms);
  if(arr.length===0) return null;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}

// ---- Reaction test ----
let waitingTimeout = null;
let reactStart = 0;
let reactReady = false;
let soundOn = state.settings.sound;

function setPad(stateClass, text){
  const pad = $("#reactPad");
  pad.classList.remove("idle","ready","go");
  pad.classList.add(stateClass);
  $("#reactText").textContent = text;
}
function startReaction(){
  clearTimeout(waitingTimeout);
  reactReady = false;
  setPad("ready","WAIT...");
  $("#reactResult").textContent = "—";
  // random delay 1000–3000ms
  const delay = 1000 + Math.random()*2000;
  waitingTimeout = setTimeout(()=>{
    setPad("go","GO!");
    reactReady = true;
    reactStart = performance.now();
    if(soundOn) beep();
  }, delay);
}
function padTap(){
  if(!reactReady){
    // Too soon
    setPad("idle","Too soon! Tap START");
    state.trials.push({ ts: Date.now(), tooSoon: true, mode: "visual" });
    save();
    return;
  }
  const ms = performance.now() - reactStart;
  setPad("idle","Tap START");
  $("#reactResult").textContent = formatMs(ms);
  state.trials.push({ ts: Date.now(), ms, tooSoon: false, mode: "visual" });
  save();
  refreshHome();
  drawCharts();
  reactReady = false;
}
function beep(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type="sine"; o.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.1, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.08);
  }catch(e){}
}

// ---- Logs ----
function addLog(e){
  e.preventDefault();
  const type = $("#logType").value;
  const title = $("#logTitle").value.trim();
  const minutes = parseInt($("#logMins").value || "0", 10);
  const rpe = parseInt($("#logRpe").value || "0", 10);
  const notes = $("#logNotes").value.trim();
  if(!title || minutes <=0){
    alert("Please enter a title and minutes.");
    return;
  }
  state.logs.push({ ts: Date.now(), type, title, minutes, rpe, notes });
  save();
  $("#logForm").reset();
  $("#logMins").value = 30;
  $("#logRpe").value = 7;
  refreshLogs();
  refreshHome();
}
function refreshLogs(){
  const ul = $("#recentLogs");
  ul.innerHTML = "";
  for(const l of [...state.logs].reverse().slice(0,10)){
    const li = document.createElement("li");
    li.textContent = `${new Date(l.ts).toLocaleString()} — ${l.type} — ${l.title} (${l.minutes}m)`;
    ul.appendChild(li);
  }
}

// Day notes
function saveNotes(){
  const date = todayYMD();
  let obj = state.dayNotes.find(d=>d.date===date);
  if(!obj){ obj = { date, sleepHrs:null, caffeine:null, mood:null }; state.dayNotes.push(obj); }
  obj.sleepHrs = parseFloat($("#sleepHrs").value || "0");
  obj.caffeine = parseInt($("#caffCups").value || "0", 10);
  obj.mood = parseInt($("#mood").value || "0", 10);
  save();
  alert("Saved today’s notes.");
}

// ---- Charts (tiny no-lib canvas) ----
function drawCharts(){
  drawReactionChart();
  drawSessionsChart();
  drawScatterChart();
}
function drawReactionChart(){
  const c = $("#chartReaction");
  if(!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  // last 14 days
  const days = [];
  for(let i=13;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    days.push(d);
  }
  const avgs = days.map(d=>{
    const s=d.getTime(), e=s+86400000;
    const arr = state.trials.filter(t=>t.ts>=s&&t.ts<e&&!t.tooSoon).map(t=>t.ms);
    return arr.length? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  });
  // axes
  const pad=30, H=c.height, W=c.width;
  ctx.strokeStyle="#334155"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad,10); ctx.lineTo(pad,H-pad); ctx.lineTo(W-10,H-pad); ctx.stroke();
  // scale
  const vals = avgs.filter(v=>v!=null);
  const max = Math.max(300, ...vals, 0);
  const min = Math.min(120, ...vals, 999);
  const yscale = (H-pad-10)/(max-min||1);
  // grid + labels
  ctx.fillStyle="#94a3b8"; ctx.font="12px system-ui";
  ctx.fillText(`${Math.round(max)} ms`, 6, 12);
  ctx.fillText(`${Math.round(min)} ms`, 6, H-pad-2);
  // line
  ctx.strokeStyle="#22d3ee"; ctx.lineWidth=2; ctx.beginPath();
  days.forEach((d, i)=>{
    const x = pad + i*((W-pad-10)/ (days.length-1));
    const v = avgs[i];
    const y = v==null? null : (H-pad - (v-min)*yscale);
    if(i===0){ if(y!=null) ctx.moveTo(x,y); }
    else { if(y!=null) ctx.lineTo(x,y); }
  });
  ctx.stroke();
  // points
  ctx.fillStyle="#2563eb";
  days.forEach((d,i)=>{
    const v=avgs[i]; if(v==null) return;
    const x= pad + i*((W-pad-10)/ (days.length-1));
    const y= (H-pad - (v-min)*yscale);
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  });
}
function drawSessionsChart(){
  const c = $("#chartSessions");
  if(!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  // last 8 weeks
  const weeks=[];
  const now = new Date();
  const currentWeekStart = new Date(now); currentWeekStart.setDate(now.getDate()-now.getDay()); currentWeekStart.setHours(0,0,0,0);
  for(let i=7;i>=0;i--){
    const ws = new Date(currentWeekStart); ws.setDate(ws.getDate()-7*i);
    weeks.push(ws);
  }
  const counts = weeks.map(ws=>{
    const s=ws.getTime(), e=s+7*86400000;
    const days = new Set();
    for(const l of state.logs) if(l.ts>=s&&l.ts<e) days.add(ymd(l.ts));
    return days.size;
  });
  // axes
  const pad=30, H=c.height, W=c.width;
  ctx.strokeStyle="#334155"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad,10); ctx.lineTo(pad,H-pad); ctx.lineTo(W-10,H-pad); ctx.stroke();
  // bars
  const max = Math.max(4, ...counts);
  const yscale = (H-pad-10)/(max||1);
  const barW = (W-pad-10)/counts.length - 6;
  ctx.fillStyle="#22d3ee";
  counts.forEach((v,i)=>{
    const x = pad + i*(barW+6) + 3;
    const h = v*yscale;
    const y = H-pad-h;
    ctx.fillRect(x,y,barW,h);
  });
}
function drawScatterChart(){
  const c = $("#chartScatter");
  if(!c) return;
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  // last 4 weeks: per day -> x = had session? (count), y = avg ms
  const days=[];
  for(let i=27;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i); d.setHours(0,0,0,0);
    days.push(d);
  }
  const data = days.map(d=>{
    const s=d.getTime(), e=s+86400000;
    const sessions = state.logs.filter(l=>l.ts>=s&&l.ts<e).length;
    const r = state.trials.filter(t=>t.ts>=s&&t.ts<e&&!t.tooSoon).map(t=>t.ms);
    const avg = r.length? r.reduce((a,b)=>a+b,0)/r.length : null;
    return { sessions, avg };
  }).filter(d=>d.avg!=null);
  // axes
  const pad=30, H=c.height, W=c.width;
  ctx.strokeStyle="#334155"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad,10); ctx.lineTo(pad,H-pad); ctx.lineTo(W-10,H-pad); ctx.stroke();
  // scales
  const maxX = Math.max(5, ...data.map(d=>d.sessions), 0);
  const minY = Math.min(120, ...data.map(d=>d.avg), 999);
  const maxY = Math.max(300, ...data.map(d=>d.avg), 0);
  const xscale = (W-pad-10)/(maxX||1);
  const yscale = (H-pad-10)/(maxY-minY||1);
  // labels
  const lbl = (t,x,y)=>{ ctx.fillStyle="#94a3b8"; ctx.font="12px system-ui"; ctx.fillText(t,x,y); };
  lbl(`${maxY.toFixed(0)}ms`, 6, 12);
  lbl(`${minY.toFixed(0)}ms`, 6, H-pad-2);
  lbl(`sessions/day →`, W-110, H-8);
  // points
  ctx.fillStyle="#2563eb";
  data.forEach(d=>{
    const x = pad + d.sessions*xscale;
    const y = H-pad - (d.avg-minY)*yscale;
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  });
}

// ---- Export / Import ----
function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "reflexfit-data.json"; a.click();
  URL.revokeObjectURL(url);
}
function exportCSV(){
  // Two CSVs concatenated with headers
  let out = [];
  out.push("TRIALS");
  out.push("ts,ymd,ms,mode,tooSoon");
  for(const t of state.trials){
    out.push([t.ts, ymd(t.ts), t.ms??"", t.mode??"visual", t.tooSoon?"1":"0"].join(","));
  }
  out.push("");
  out.push("LOGS");
  out.push("ts,ymd,type,title,minutes,rpe,notes");
  for(const l of state.logs){
    const safeNotes = (l.notes||"").replace(/[\n\r,]+/g," ");
    out.push([l.ts, ymd(l.ts), l.type, `"${(l.title||'').replace(/\"/g,'\"')}"`, l.minutes, l.rpe, `"${safeNotes.replace(/\"/g,'\"')}"`].join(","));
  }
  const blob = new Blob([out.join("\n")], {type:"text/csv"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "reflexfit-data.csv"; a.click();
  URL.revokeObjectURL(url);
}
function importJSON(){
  try{
    const txt = $("#importArea").value.trim();
    if(!txt) return alert("Paste JSON first.");
    const obj = JSON.parse(txt);
    state = Object.assign(structuredClone(defaultData), obj);
    save();
    alert("Imported OK.");
    refreshHome(); refreshLogs(); drawCharts();
  }catch(e){
    alert("Invalid JSON.");
  }
}

// ---- Settings ----
function initSettings(){
  $("#weeklyGoal").value = state.settings.weeklyGoal ?? 200;
  $("#weeklyGoal").addEventListener("change", ()=>{
    state.settings.weeklyGoal = parseInt($("#weeklyGoal").value||"200",10);
    save();
  });
  $("#resetData").addEventListener("click", ()=>{
    if(confirm("Reset ALL data? This cannot be undone.")){
      state = structuredClone(defaultData);
      save();
      refreshHome(); refreshLogs(); drawCharts();
    }
  });
}

// ---- Wiring UI ----
$("#startReact").addEventListener("click", startReaction);
$("#reactPad").addEventListener("click", padTap);
$("#soundToggle").addEventListener("click", ()=>{
  soundOn = !soundOn; state.settings.sound = soundOn; save();
  $("#soundToggle").textContent = "Sound: " + (soundOn? "On":"Off");
});
$("#logForm").addEventListener("submit", addLog);
$("#saveDayNotes").addEventListener("click", saveNotes);
$("#exportJson").addEventListener("click", exportJSON);
$("#exportCsv").addEventListener("click", exportCSV);
$("#importJson").addEventListener("click", importJSON);

window.addEventListener("load", ()=>{
  updateHeader();
  refreshHome();
  refreshLogs();
  drawCharts();
  initSettings();
  // SW register
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }
});
