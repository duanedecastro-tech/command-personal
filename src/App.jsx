import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Mic, Square, CalendarDays, ListChecks, Mail, DollarSign, Sparkles, ChevronLeft, ChevronRight, Check } from "lucide-react";

/* ── CONSTANTS ── */
const ACCENT      = "#E53935";
const DARK        = "#12192b";
const NAVY        = "#1A2744";
const FONT        = "'Inter','Helvetica Neue',Arial,sans-serif";
const FONT_SORA   = "'Sora',sans-serif";
const CLIENT_ID   = "32624962382-rte923b8bm122u5pqv3592f0q73bai0q.apps.googleusercontent.com";
const SCOPES      = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/gmail.readonly";
const DRIVE_RHYTHM_FILE = "personal_rhythm_planner.json";

/* ── QUOTES ── */
const QUOTES = [
  "You have power over your mind, not outside events. Realize this, and you will find strength.",
  "The impediment to action advances action. What stands in the way becomes the way.",
  "Waste no more time arguing about what a good man should be. Be one.",
  "Accept the things to which fate binds you, and love the people with whom fate brings you together.",
  "Confine yourself to the present.",
  "If it is not right, do not do it; if it is not true, do not say it.",
  "The soul becomes dyed with the color of its thoughts.",
  "Perfection of character: to live each day as if it were your last, without frenzy, without apathy.",
  "Our life is what our thoughts make it.",
  "He who lives in harmony with himself lives in harmony with the universe.",
];

/* ── UTILITIES ── */
let _driveRhythmFileId = null;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function plannerTodayKey() {
  const d = new Date();
  return `day_${d.getFullYear()}_${d.getMonth()+1}_${d.getDate()}`;
}
function plannerWeekKey() {
  const d = new Date();
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return `week_${mon.getFullYear()}_${mon.getMonth()+1}_${mon.getDate()}`;
}
function fmtTime(iso) {
  if (!iso || iso.length === 10) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
}
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso + (iso.includes("T") ? "" : "T00:00:00")).toLocaleDateString("en-US", { month:"short", day:"numeric" });
}
function getMonthDays(y, m) {
  const f = new Date(y, m, 1), l = new Date(y, m+1, 0), a = [];
  for (let i = 0; i < f.getDay(); i++) a.push(null);
  for (let d = 1; d <= l.getDate(); d++) a.push(d);
  return a;
}
function isoDate(y, m, d) {
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_S  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* ── DRIVE SYNC ── */
async function driveReadRhythm(token) {
  try {
    const r = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)", { headers:{ Authorization:`Bearer ${token}` } });
    if (r.status === 403) return null;
    const d = await r.json();
    const f = (d.files||[]).find(f => f.name === DRIVE_RHYTHM_FILE);
    if (!f) return null;
    _driveRhythmFileId = f.id;
    const r2 = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers:{ Authorization:`Bearer ${token}` } });
    return await r2.json();
  } catch { return null; }
}
async function driveWriteRhythm(token, data) {
  try {
    const body = JSON.stringify({ ...data, savedAt: new Date().toISOString() });
    if (!_driveRhythmFileId) {
      const r = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)", { headers:{ Authorization:`Bearer ${token}` } });
      const d = await r.json();
      const f = (d.files||[]).find(f => f.name === DRIVE_RHYTHM_FILE);
      if (f) _driveRhythmFileId = f.id;
    }
    if (_driveRhythmFileId) {
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${_driveRhythmFileId}?uploadType=media`, { method:"PATCH", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body });
    } else {
      const bnd = "cbp_rbnd";
      const meta = JSON.stringify({ name:DRIVE_RHYTHM_FILE, parents:["appDataFolder"] });
      const mp = `--${bnd}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bnd}--`;
      const r2 = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":`multipart/related; boundary=${bnd}` }, body:mp });
      const d = await r2.json(); _driveRhythmFileId = d.id;
    }
  } catch(e) { console.warn("Drive write failed:", e); }
}

/* ── BEAN MARK ── */
function BeanMark({ size = 32, showWordmark = false }) {
  const h = showWordmark ? Math.round(size * 185/120) : Math.round(size * 140/120);
  return (
    <svg width={size} height={h} viewBox={showWordmark ? "0 0 120 185" : "0 0 120 140"} fill="none">
      <defs>
        <mask id="cbpBM"><rect width="120" height="140" fill="white"/><rect x="0" y="0" width="38" height="140" fill="black"/></mask>
        <mask id="cbpWM"><rect width="120" height="140" fill="white"/><circle cx="72" cy="96" r="22" fill="black"/></mask>
      </defs>
      <rect x="18" y="10" width="16" height="114" rx="8" fill="#F59E0B"/>
      <circle cx="34" cy="34" r="22" fill="#3B5BDB" mask="url(#cbpBM)"/>
      <circle cx="72" cy="96" r="40" fill="#F59E0B" mask="url(#cbpWM)"/>
      <text x="10" y="40" fontFamily="Sora,sans-serif" fontWeight="700" fontSize="18" textAnchor="middle" fill="#3B5BDB">c</text>
      {showWordmark && <text x="60" y="170" fontFamily="Sora,sans-serif" fontWeight="800" fontSize="42" letterSpacing="-1.5" textAnchor="middle" fill="#F59E0B">bean</text>}
    </svg>
  );
}

/* ── MY RHYTHM ── */
const DEFAULT_HOURS = Array.from({length:19},(_,i)=>({time:`${String(i+5).padStart(2,"0")}:00`,label:""}));
const DEFAULT_INTENTIONS = ["Health","Personal Dev","Family","Romance","Finance","Fun","Spiritual","Career"].map(l=>({label:l,note:""}));
const DEFAULT_HABITS = ["Gym","Read","Meditate","Journal","Walk","Water"].map(n=>({name:n,days:[false,false,false,false,false,false,false]}));
const RHYTHM_SK = "cbp_rhythm_v1";

function MyRhythmCard({ authToken }) {
  const today = new Date();
  const [open, setOpen]   = useState(false);
  const [tab,  setTab]    = useState("today");
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  const load = (key, def) => { try { const s=localStorage.getItem(RHYTHM_SK); if(s){const d=JSON.parse(s);return d[key]??def;} } catch{} return def; };
  const [priorities, setPriorities] = useState(() => load(plannerTodayKey()+".priorities", ["","",""]));
  const [schedule,   setSchedule]   = useState(() => load(plannerTodayKey()+".schedule",   DEFAULT_HOURS));
  const [intentions, setIntentions] = useState(() => load(plannerWeekKey()+".intentions",  DEFAULT_INTENTIONS));
  const [habits,     setHabits]     = useState(() => load(plannerWeekKey()+".habits",      DEFAULT_HABITS));

  const saveLocal = (p,sc,int,hab) => {
    try {
      const ex = JSON.parse(localStorage.getItem(RHYTHM_SK)||"{}");
      ex[plannerTodayKey()+".priorities"] = p;
      ex[plannerTodayKey()+".schedule"]   = sc;
      ex[plannerWeekKey()+".intentions"]  = int;
      ex[plannerWeekKey()+".habits"]      = hab;
      localStorage.setItem(RHYTHM_SK, JSON.stringify(ex));
    } catch {}
  };

  const writeTimer = useRef(null);
  const debouncedWrite = (p,sc,int,hab) => {
    if (!authToken) return;
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      const data = {};
      data[plannerTodayKey()+".priorities"] = p;
      data[plannerTodayKey()+".schedule"]   = sc;
      data[plannerWeekKey()+".intentions"]  = int;
      data[plannerWeekKey()+".habits"]      = hab;
      driveWriteRhythm(authToken, data);
    }, 3000);
  };

  useEffect(() => {
    if (!authToken) return;
    driveReadRhythm(authToken).then(remote => {
      if (!remote) {
        const local = JSON.parse(localStorage.getItem(RHYTHM_SK)||"{}");
        if (Object.keys(local).length > 0) driveWriteRhythm(authToken, local);
        return;
      }
      if (remote[plannerTodayKey()+".priorities"]) setPriorities(remote[plannerTodayKey()+".priorities"]);
      if (remote[plannerTodayKey()+".schedule"])   setSchedule(remote[plannerTodayKey()+".schedule"]);
      if (remote[plannerWeekKey()+".intentions"])  setIntentions(remote[plannerWeekKey()+".intentions"]);
      if (remote[plannerWeekKey()+".habits"])      setHabits(remote[plannerWeekKey()+".habits"]);
    });
  }, [authToken]);

  const updP  = (i,v) => { const p=[...priorities];p[i]=v;setPriorities(p);saveLocal(p,schedule,intentions,habits);debouncedWrite(p,schedule,intentions,habits); };
  const updSL = (i,v) => { const sc=schedule.map((h,j)=>j===i?{...h,label:v}:h);setSchedule(sc);saveLocal(priorities,sc,intentions,habits);debouncedWrite(priorities,sc,intentions,habits); };
  const updST = (i,v) => { const sc=schedule.map((h,j)=>j===i?{...h,time:v}:h);setSchedule(sc);saveLocal(priorities,sc,intentions,habits);debouncedWrite(priorities,sc,intentions,habits); };
  const updI  = (i,v) => { const int=intentions.map((x,j)=>j===i?{...x,note:v}:x);setIntentions(int);saveLocal(priorities,schedule,int,habits);debouncedWrite(priorities,schedule,int,habits); };
  const updHN = (i,v) => { const h=habits.map((x,j)=>j===i?{...x,name:v}:x);setHabits(h);saveLocal(priorities,schedule,intentions,h);debouncedWrite(priorities,schedule,intentions,h); };
  const togHD = (hi,di) => { const h=habits.map((x,j)=>j===hi?{...x,days:x.days.map((d,k)=>k===di?!d:d)}:x);setHabits(h);saveLocal(priorities,schedule,intentions,h);debouncedWrite(priorities,schedule,intentions,h); };
  const curHr = today.getHours();

  return (
    <>
      <div onClick={()=>setOpen(true)} style={{cursor:"pointer",borderRadius:20,background:`linear-gradient(135deg,${NAVY} 0%,#0f1520 100%)`,border:`1px solid rgba(229,57,53,0.2)`,padding:"20px 22px",position:"relative",overflow:"hidden",userSelect:"none",minHeight:100}}>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:80,display:"flex",alignItems:"flex-end",gap:3,padding:"0 16px",opacity:0.08,pointerEvents:"none"}}>
          {Array.from({length:24},(_,i)=><div key={i} style={{flex:1,background:`linear-gradient(to top,${ACCENT},#ff8a80)`,borderRadius:"2px 2px 0 0",height:`${30+Math.sin(i*0.7)*20+Math.cos(i*1.3)*15}%`}}/>)}
        </div>
        <div style={{position:"relative",zIndex:1,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:ACCENT,fontFamily:FONT_SORA,marginBottom:6}}>My Rhythm</div>
            <div style={{fontSize:13,color:"rgba(240,240,245,0.55)",lineHeight:1.5,fontStyle:"italic",height:36,overflow:"hidden"}}>"{quote}"</div>
          </div>
          <div style={{textAlign:"right",flexShrink:0,marginLeft:16}}>
            <div style={{fontSize:11,color:"rgba(240,240,245,0.4)",marginBottom:2}}>{DAYS_S[today.getDay()]}</div>
            <div style={{fontSize:28,fontWeight:700,color:"rgba(240,240,245,0.7)",lineHeight:1,fontFamily:FONT_SORA}}>{today.getDate()}</div>
            <div style={{fontSize:10,color:"rgba(240,240,245,0.35)"}}>{MONTHS[today.getMonth()].slice(0,3)}</div>
          </div>
        </div>
      </div>

      {open && createPortal(
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:DARK,border:"1px solid rgba(255,255,255,0.1)",borderRadius:24,width:"100%",maxWidth:520,height:"min(92vh,780px)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 0",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{fontSize:16,fontWeight:700,color:"#fff",fontFamily:FONT_SORA}}>My Rhythm</div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{display:"flex",background:"rgba(255,255,255,0.06)",borderRadius:10,padding:3}}>
                  {["today","week"].map(t=>(
                    <button key={t} onClick={()=>setTab(t)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,background:tab===t?ACCENT:"transparent",color:tab===t?"#fff":"rgba(240,240,245,0.5)",transition:"all 0.15s"}}>
                      {t==="today"?"TODAY":"THIS WEEK"}
                    </button>
                  ))}
                </div>
                <button onClick={()=>setOpen(false)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",color:"rgba(240,240,245,0.6)"}}>✕</button>
              </div>
            </div>
            <div style={{overflowY:"auto",padding:"16px 24px 24px",flex:1}}>
              {tab==="today" ? (
                <>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:ACCENT,marginBottom:10}}>Top 3 Priorities</div>
                    {priorities.map((p,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                        <div style={{width:22,height:22,borderRadius:6,background:"rgba(229,57,53,0.15)",border:"1px solid rgba(229,57,53,0.3)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:11,fontWeight:700,color:ACCENT}}>{i+1}</div>
                        <input value={p} onChange={e=>updP(i,e.target.value)} placeholder={`Priority ${i+1}`} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 12px",fontSize:13,color:"#fff",fontFamily:FONT,outline:"none"}}/>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"rgba(240,240,245,0.35)",marginBottom:10}}>Hourly Schedule</div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {schedule.map((h,i)=>{
                      const hr=parseInt(h.time.split(":")[0]);
                      const isCur=hr===curHr;
                      return (
                        <div key={i} style={{display:"flex",gap:8,alignItems:"center",borderLeft:`2px solid ${isCur?ACCENT:"transparent"}`,paddingLeft:8}}>
                          <input value={h.time} onChange={e=>updST(i,e.target.value)} style={{width:52,background:"transparent",border:"none",fontSize:11,color:isCur?ACCENT:"rgba(240,240,245,0.3)",fontFamily:"'JetBrains Mono',monospace",outline:"none",fontWeight:isCur?700:400}}/>
                          <input value={h.label} onChange={e=>updSL(i,e.target.value)} placeholder="—" style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:6,padding:"5px 10px",fontSize:12,color:"rgba(240,240,245,0.8)",fontFamily:FONT,outline:"none",marginBottom:3}}/>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:ACCENT,marginBottom:10}}>Life Intentions</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {intentions.map((int,i)=>(
                        <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 12px"}}>
                          <div style={{fontSize:10,fontWeight:700,color:"rgba(240,240,245,0.45)",marginBottom:6,letterSpacing:1}}>{int.label.toUpperCase()}</div>
                          <input value={int.note} onChange={e=>updI(i,e.target.value)} placeholder="This week…" style={{width:"100%",background:"transparent",border:"none",fontSize:12,color:"rgba(240,240,245,0.8)",fontFamily:FONT,outline:"none"}}/>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"rgba(240,240,245,0.35)",marginBottom:10}}>Habit Tracker</div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",minWidth:300}}>
                      <thead>
                        <tr>
                          <th style={{textAlign:"left",fontSize:10,color:"rgba(240,240,245,0.3)",fontWeight:600,paddingBottom:8,width:"38%"}}></th>
                          {["M","T","W","T","F","S","S"].map((d,i)=><th key={i} style={{fontSize:10,color:"rgba(240,240,245,0.3)",fontWeight:600,paddingBottom:8,textAlign:"center"}}>{d}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {habits.map((h,hi)=>(
                          <tr key={hi}>
                            <td style={{paddingBottom:8}}>
                              <input value={h.name} onChange={e=>updHN(hi,e.target.value)} style={{background:"transparent",border:"none",fontSize:12,color:"rgba(240,240,245,0.7)",fontFamily:FONT,outline:"none",width:"100%"}}/>
                            </td>
                            {h.days.map((checked,di)=>(
                              <td key={di} style={{textAlign:"center",paddingBottom:8}}>
                                <div onClick={()=>togHD(hi,di)} style={{width:20,height:20,borderRadius:5,border:`1.5px solid ${checked?ACCENT:"rgba(255,255,255,0.15)"}`,background:checked?ACCENT:"transparent",cursor:"pointer",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                                  {checked&&<Check size={11} color="#fff"/>}
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ── PERSONAL BRIEF ── */
function PersonalBriefCard({ events, tasks }) {
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const todayEvs  = (events||[]).filter(e=>(e.start?.dateTime||e.start?.date||"").startsWith(today)).sort((a,b)=>(a.start?.dateTime||"").localeCompare(b.start?.dateTime||""));
  const openTasks = (tasks||[]).filter(t=>!t.completed);
  const urgentCt  = openTasks.filter(t=>t.due&&t.due<=today).length;

  return (
    <>
      <div onClick={()=>setOpen(true)} style={{cursor:"pointer",borderRadius:16,background:"rgba(229,57,53,0.07)",border:`1px solid rgba(229,57,53,0.25)`,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:ACCENT,marginBottom:4}}>My Personal Brief</div>
          <div style={{fontSize:13,color:"rgba(240,240,245,0.65)"}}>
            {todayEvs.length} event{todayEvs.length!==1?"s":""} today
            {urgentCt>0&&<span style={{color:ACCENT,marginLeft:8}}>· {urgentCt} urgent</span>}
          </div>
        </div>
        <div style={{fontSize:12,color:"rgba(240,240,245,0.3)"}}>Tap →</div>
      </div>
      {open && createPortal(
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:DARK,border:"1px solid rgba(255,255,255,0.1)",borderRadius:24,width:"100%",maxWidth:480,maxHeight:"85vh",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"20px 24px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.07)",flexShrink:0}}>
              <div style={{fontFamily:FONT_SORA,fontWeight:800,fontSize:16,color:"#fff"}}>My Personal Brief</div>
              <button onClick={()=>setOpen(false)} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"rgba(240,240,245,0.6)"}}>✕</button>
            </div>
            <div style={{overflowY:"auto",padding:"20px 24px 24px"}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:ACCENT,textTransform:"uppercase",marginBottom:10}}>Today's Events</div>
              {todayEvs.length===0
                ? <div style={{color:"rgba(240,240,245,0.35)",fontSize:13,marginBottom:20}}>No events today.</div>
                : todayEvs.map((e,i)=>(
                  <div key={i} style={{display:"flex",gap:10,marginBottom:8,padding:"8px 12px",background:"rgba(255,255,255,0.04)",borderRadius:10}}>
                    <div style={{fontSize:11,color:ACCENT,fontWeight:600,minWidth:52}}>{fmtTime(e.start?.dateTime)||"All day"}</div>
                    <div style={{fontSize:13,color:"rgba(240,240,245,0.8)"}}>{e.summary}</div>
                  </div>
                ))
              }
              {openTasks.length>0&&<>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:2,color:"rgba(240,240,245,0.4)",textTransform:"uppercase",margin:"16px 0 10px"}}>Open Tasks</div>
                {openTasks.slice(0,10).map((t,i)=>(
                  <div key={i} style={{display:"flex",gap:10,marginBottom:6,padding:"7px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8}}>
                    <div style={{width:14,height:14,borderRadius:4,border:"1.5px solid rgba(255,255,255,0.2)",marginTop:2,flexShrink:0}}/>
                    <div style={{fontSize:13,color:"rgba(240,240,245,0.7)"}}>{t.title}</div>
                  </div>
                ))}
              </>}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* ── STAT CARDS ── */
function StatCards({ tasks, events, mailCount }) {
  const today = todayStr();
  const sevenDays = new Date(); sevenDays.setDate(sevenDays.getDate()+7);
  const open     = (tasks||[]).filter(t=>!t.completed).length;
  const urgent   = (tasks||[]).filter(t=>!t.completed&&t.due&&t.due<=today).length;
  const upcoming = (events||[]).filter(e=>{const s=e.start?.dateTime||e.start?.date||"";return s>=today&&s<=sevenDays.toISOString();}).length;
  const cards = [
    {label:"Tasks",    val:open,     icon:ListChecks,  color:"#3B5BDB"},
    {label:"Urgent",   val:urgent,   icon:ListChecks,  color:ACCENT},
    {label:"Upcoming", val:upcoming, icon:CalendarDays, color:"#F59E0B"},
    {label:"Mail",     val:mailCount??0, icon:Mail,    color:"#0097A7"},
  ];
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
      {cards.map(({label,val,icon:Icon,color})=>(
        <div key={label} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:14,padding:"14px 10px",textAlign:"center"}}>
          <Icon size={15} color={color} style={{marginBottom:6,opacity:0.8}}/>
          <div style={{fontSize:22,fontWeight:700,color:"#fff",lineHeight:1,fontFamily:FONT_SORA,marginBottom:4}}>{val}</div>
          <div style={{fontSize:9,fontWeight:600,color:"rgba(240,240,245,0.4)",textTransform:"uppercase",letterSpacing:1.5}}>{label}</div>
        </div>
      ))}
    </div>
  );
}

/* ── FINANCE CARD ── */
function FinanceCard() {
  const accounts = [
    {name:"Chase Checking",  balance:"$4,218.52",  note:"+$342 this month",  up:true},
    {name:"Chase Savings",   balance:"$12,440.00", note:"+$500 this month",  up:true},
    {name:"Amex Gold",       balance:"-$1,882.00", note:"-$224 this month",  up:false},
  ];
  return (
    <div style={{borderRadius:20,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",overflow:"hidden"}}>
      <div style={{padding:"18px 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#F59E0B",marginBottom:4}}>Finance</div>
          <div style={{fontSize:15,fontWeight:700,color:"#fff",fontFamily:FONT_SORA}}>Account Overview</div>
        </div>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:"rgba(240,240,245,0.3)",background:"rgba(255,255,255,0.06)",padding:"4px 10px",borderRadius:6}}>PLAID · COMING SOON</div>
      </div>
      <div style={{padding:"0 20px 20px",display:"flex",flexDirection:"column",gap:8}}>
        {accounts.map((a,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10}}>
            <div style={{fontSize:13,color:"rgba(240,240,245,0.7)"}}>{a.name}</div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#fff",fontFamily:FONT_SORA}}>{a.balance}</div>
              <div style={{fontSize:11,color:a.up?"#4CAF50":ACCENT}}>{a.note}</div>
            </div>
          </div>
        ))}
        <div style={{marginTop:4,padding:"10px 14px",background:"rgba(229,57,53,0.05)",border:"1px dashed rgba(229,57,53,0.22)",borderRadius:10,textAlign:"center",cursor:"pointer"}}>
          <div style={{fontSize:12,fontWeight:600,color:ACCENT}}>+ Connect your bank account</div>
          <div style={{fontSize:11,color:"rgba(240,240,245,0.3)",marginTop:2}}>Bank sync via Plaid — launching with Command Bean Personal</div>
        </div>
      </div>
    </div>
  );
}

/* ── GMAIL CARD ── */
function GmailCard({ threads }) {
  const hasReal = threads && threads.length > 0;
  const placeholder = [
    {from:"Bank of America", subject:"Your statement is ready",          time:"9:14 AM"},
    {from:"Geico",           subject:"Payment confirmation — April 2026", time:"Yesterday"},
    {from:"Duane DeCastro",  subject:"Re: weekend plans",                time:"Mon"},
  ];
  const items = hasReal ? threads.slice(0,6) : placeholder;
  return (
    <div style={{borderRadius:20,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",overflow:"hidden"}}>
      <div style={{padding:"18px 20px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#0097A7",marginBottom:4}}>Gmail</div>
          <div style={{fontSize:15,fontWeight:700,color:"#fff",fontFamily:FONT_SORA}}>Recent Mail</div>
        </div>
        {!hasReal&&<div style={{fontSize:9,fontWeight:700,letterSpacing:1.5,color:"rgba(240,240,245,0.3)",background:"rgba(255,255,255,0.06)",padding:"4px 10px",borderRadius:6}}>PREVIEW</div>}
      </div>
      <div style={{padding:"0 20px 20px",display:"flex",flexDirection:"column",gap:6}}>
        {items.map((item,i)=>{
          const from = hasReal ? (item.messages?.[0]?.payload?.headers?.find(h=>h.name==="From")?.value||"Unknown") : item.from;
          const subj = hasReal ? (item.messages?.[0]?.payload?.headers?.find(h=>h.name==="Subject")?.value||"(no subject)") : item.subject;
          return (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"9px 14px",background:"rgba(255,255,255,0.04)",borderRadius:10,gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:"rgba(240,240,245,0.8)",marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{from}</div>
                <div style={{fontSize:12,color:"rgba(240,240,245,0.45)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{subj}</div>
              </div>
              {!hasReal&&<div style={{fontSize:11,color:"rgba(240,240,245,0.3)",flexShrink:0}}>{item.time}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── MINI CALENDAR ── */
function MiniCalendar({ events }) {
  const now = new Date();
  const [calY, setCalY] = useState(now.getFullYear());
  const [calM, setCalM] = useState(now.getMonth());
  const [sel,  setSel]  = useState(null);
  const today = todayStr();
  const days  = getMonthDays(calY, calM);
  const evDays = new Set((events||[]).map(e=>(e.start?.dateTime||e.start?.date||"").slice(0,10)));

  return (
    <div style={{borderRadius:20,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",padding:"18px 20px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff",fontFamily:FONT_SORA}}>{MONTHS[calM]} {calY}</div>
        <div style={{display:"flex",gap:4}}>
          <button onClick={()=>{let m=calM-1,y=calY;if(m<0){m=11;y--;}setCalM(m);setCalY(y);}} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:7,padding:"4px 8px",cursor:"pointer",color:"rgba(240,240,245,0.6)"}}><ChevronLeft size={13}/></button>
          <button onClick={()=>{let m=calM+1,y=calY;if(m>11){m=0;y++;}setCalM(m);setCalY(y);}} style={{background:"rgba(255,255,255,0.07)",border:"none",borderRadius:7,padding:"4px 8px",cursor:"pointer",color:"rgba(240,240,245,0.6)"}}><ChevronRight size={13}/></button>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {DAYS_S.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"rgba(240,240,245,0.3)",fontWeight:600,paddingBottom:4}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {days.map((d,i)=>{
          if(!d)return<div key={i}/>;
          const iso=isoDate(calY,calM,d);
          const isToday=iso===today;
          const hasEv=evDays.has(iso);
          return(
            <div key={i} onClick={()=>setSel(sel===iso?null:iso)} style={{textAlign:"center",padding:"5px 0",borderRadius:8,cursor:"pointer",background:isToday?ACCENT:sel===iso?"rgba(229,57,53,0.2)":"transparent",color:isToday?"#fff":"rgba(240,240,245,0.75)",fontSize:12,fontWeight:isToday?700:400,position:"relative",transition:"background 0.15s"}}>
              {d}
              {hasEv&&!isToday&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:ACCENT}}/>}
            </div>
          );
        })}
      </div>
      {sel&&(()=>{
        const dayEvs=(events||[]).filter(e=>(e.start?.dateTime||e.start?.date||"").startsWith(sel));
        return(
          <div style={{marginTop:12,borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:12}}>
            {dayEvs.length===0
              ?<div style={{fontSize:12,color:"rgba(240,240,245,0.3)"}}>No events.</div>
              :dayEvs.map((e,i)=><div key={i} style={{fontSize:12,color:"rgba(240,240,245,0.65)",borderLeft:`2px solid ${ACCENT}`,paddingLeft:8,marginBottom:4}}><span style={{color:ACCENT,marginRight:6}}>{fmtTime(e.start?.dateTime)||"All day"}</span>{e.summary}</div>)
            }
          </div>
        );
      })()}
    </div>
  );
}

/* ── AI QUERY BAR ── */
function AIQueryBar() {
  return(
    <div style={{borderRadius:16,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",padding:"14px 16px"}}>
      <div style={{fontSize:10,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:"#7B1FA2",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
        <Sparkles size={12} color="#7B1FA2"/>AI Query
        <span style={{background:"rgba(123,31,162,0.15)",border:"1px solid rgba(123,31,162,0.3)",borderRadius:4,padding:"1px 6px",fontSize:9,letterSpacing:1.5,color:"#7B1FA2"}}>COMING SOON</span>
      </div>
      <div style={{display:"flex",gap:8}}>
        <input placeholder="Ask anything about your money and time…" disabled style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"rgba(240,240,245,0.35)",fontFamily:FONT,outline:"none",cursor:"not-allowed"}}/>
        <button disabled style={{background:"rgba(123,31,162,0.15)",border:"1px solid rgba(123,31,162,0.25)",borderRadius:10,padding:"10px 16px",cursor:"not-allowed",color:"rgba(240,240,245,0.3)",fontSize:12,fontWeight:600}}>Ask</button>
      </div>
    </div>
  );
}

/* ── VOICE BAR ── */
function VoiceBar({ isAuthed }) {
  const [listening,   setListening]   = useState(false);
  const [transcript,  setTranscript]  = useState("");
  const [status,      setStatus]      = useState("");
  const recRef = useRef(null);

  const toggle = () => {
    if (!isAuthed) { setStatus("Sign in with Google to use voice"); setTimeout(()=>setStatus(""),3000); return; }
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    if (!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)) { setStatus("Voice not supported in this browser"); return; }
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec = new SR(); rec.continuous=true; rec.interimResults=true; rec.lang="en-US";
    rec.onresult = e => { let t=""; for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript; setTranscript(t); };
    rec.onend    = () => setListening(false);
    rec.onerror  = () => { setListening(false); setStatus("Mic error — try again"); setTimeout(()=>setStatus(""),3000); };
    recRef.current=rec; rec.start(); setListening(true); setTranscript(""); setStatus("");
  };

  return(
    <div style={{borderRadius:14,background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",padding:"12px 16px",display:"flex",gap:12,alignItems:"center"}}>
      <button onClick={toggle} style={{width:40,height:40,borderRadius:12,background:listening?ACCENT:"rgba(255,255,255,0.08)",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.2s"}}>
        {listening?<Square size={16} color="#fff"/>:<Mic size={16} color="rgba(240,240,245,0.6)"/>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        {transcript?<div style={{fontSize:13,color:"rgba(240,240,245,0.8)",fontStyle:"italic"}}>"{transcript}"</div>
          :status?<div style={{fontSize:12,color:ACCENT}}>{status}</div>
          :<div style={{fontSize:12,color:"rgba(240,240,245,0.3)"}}>{listening?"Listening…":"Tap mic to speak"}</div>}
      </div>
    </div>
  );
}

/* ── MAIN APP ── */
export default function App() {
  const [authToken,    setAuthToken]    = useState(null);
  const [userInfo,     setUserInfo]     = useState(null);
  const [events,       setEvents]       = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [gmailThreads, setGmailThreads] = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [authReady,    setAuthReady]    = useState(false);
  const isMobile = window.innerWidth <= 640;

  useEffect(() => {
    const saved = sessionStorage.getItem("cbp_token");
    if (saved) setAuthToken(saved);
    const check = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(check); setAuthReady(true); } }, 100);
    return () => clearInterval(check);
  }, []);

  const signIn = () => {
    if (!window.google?.accounts?.oauth2) return;
    window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: async (resp) => {
        if (resp.error) return;
        const token = resp.access_token;
        setAuthToken(token);
        sessionStorage.setItem("cbp_token", token);
        try {
          const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers:{ Authorization:`Bearer ${token}` } });
          setUserInfo(await r.json());
        } catch {}
      },
    }).requestAccessToken();
  };

  const signOut = () => {
    if (authToken && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(authToken);
    setAuthToken(null); setUserInfo(null); setEvents([]); setTasks([]); setGmailThreads([]);
    sessionStorage.removeItem("cbp_token");
  };

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    const now = new Date().toISOString();
    const fut = new Date(); fut.setMonth(fut.getMonth()+3);
    Promise.all([
      fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(fut.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=100`,{headers:{Authorization:`Bearer ${authToken}`}})
        .then(r=>r.json()).then(d=>setEvents(d.items||[])).catch(()=>{}),
      fetch("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=100",{headers:{Authorization:`Bearer ${authToken}`}})
        .then(r=>r.json()).then(d=>setTasks(d.items||[])).catch(()=>{}),
      fetch("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=10&labelIds=INBOX",{headers:{Authorization:`Bearer ${authToken}`}})
        .then(r=>r.json()).then(d=>setGmailThreads(d.threads||[])).catch(()=>{}),
    ]).finally(()=>setLoading(false));
  }, [authToken]);

  /* ── SPLASH ── */
  if (!authToken) return (
    <div style={{minHeight:"100vh",background:DARK,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:FONT}}>
      <div style={{marginBottom:28,textAlign:"center"}}>
        <BeanMark size={80} showWordmark={true}/>
      </div>
      <h1 style={{fontFamily:FONT_SORA,fontSize:"clamp(28px,6vw,42px)",fontWeight:900,color:"#fff",letterSpacing:-1.5,marginBottom:6,textAlign:"center"}}>
        Command<span style={{color:ACCENT}}>Bean</span>
      </h1>
      <p style={{fontSize:13,fontWeight:700,letterSpacing:3,color:"rgba(240,240,245,0.4)",textTransform:"lowercase",marginBottom:8}}>personal.</p>
      <p style={{fontSize:16,color:"rgba(240,240,245,0.5)",textAlign:"center",maxWidth:360,lineHeight:1.65,marginBottom:36}}>
        Your finances, calendar, inbox, and daily rhythm — all in one personal command center.
      </p>
      <button onClick={signIn} disabled={!authReady} style={{display:"flex",alignItems:"center",gap:12,background:"#fff",borderRadius:14,padding:"14px 28px",border:"none",cursor:authReady?"pointer":"not-allowed",fontSize:15,fontWeight:700,color:"#1a1a1a",opacity:authReady?1:0.5,boxShadow:"0 4px 24px rgba(0,0,0,0.4)"}}>
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
        Continue with Google
      </button>
      <p style={{fontSize:12,color:"rgba(240,240,245,0.2)",marginTop:20}}>Your data stays yours. Nothing is shared.</p>
    </div>
  );

  /* ── DASHBOARD ── */
  return (
    <div style={{minHeight:"100vh",background:DARK,fontFamily:FONT,paddingBottom:40}}>
      {/* Header */}
      <div style={{position:"sticky",top:0,zIndex:50,background:"rgba(18,25,43,0.92)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",borderBottom:"1px solid rgba(229,57,53,0.12)",padding:isMobile?"12px 16px":"14px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <BeanMark size={isMobile?26:30}/>
          <div>
            <div style={{fontFamily:FONT_SORA,fontWeight:800,fontSize:isMobile?13:15,color:"#fff",letterSpacing:-0.3}}>command<span style={{color:ACCENT}}>bean</span></div>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:2.5,color:"rgba(240,240,245,0.35)",textTransform:"uppercase"}}>personal.</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {loading&&<div style={{fontSize:11,color:"rgba(240,240,245,0.3)"}}>Syncing…</div>}
          {userInfo?.picture&&<img src={userInfo.picture} alt="" style={{width:28,height:28,borderRadius:"50%",border:`2px solid rgba(229,57,53,0.4)`}}/>}
          <button onClick={signOut} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:9,padding:"5px 12px",cursor:"pointer",fontSize:11,color:"rgba(240,240,245,0.5)"}}>Sign out</button>
        </div>
      </div>

      {/* Sections */}
      <div style={{maxWidth:640,margin:"0 auto",padding:isMobile?"14px 12px":"22px 18px",display:"flex",flexDirection:"column",gap:14}}>
        <PersonalBriefCard events={events} tasks={tasks}/>
        <StatCards tasks={tasks} events={events} mailCount={gmailThreads.length}/>
        <MyRhythmCard authToken={authToken}/>
        <FinanceCard/>
        <GmailCard threads={gmailThreads}/>
        <MiniCalendar events={events}/>
        <AIQueryBar/>
        <VoiceBar isAuthed={!!authToken}/>
      </div>
    </div>
  );
}
