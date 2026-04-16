import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { Mic, Square, CalendarDays, ListChecks, PenLine, Terminal } from "lucide-react";
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import BudgetManager from "./BudgetManager";

const BIZ = [
  { id:0, name:"Spliffs Downtown",          short:"Spliffs DT",      type:"Restaurant",     color:"#E65100" },
  { id:1, name:"Spliffs Bayard",            short:"Spliffs Bayard",  type:"Restaurant",     color:"#E65100" },
  { id:2, name:"Spliffs Mayport",           short:"Spliffs Mayport", type:"Restaurant",     color:"#E65100" },
  { id:3, name:"Ocean Street Tacos",        short:"OST",             type:"Restaurant",     color:"#F9A825" },
  { id:4, name:"The Circuit Barcade",       short:"The Circuit",     type:"Arcade Bar",     color:"#0097A7" },
  { id:5, name:"American Terrapin Apparel", short:"ATA",             type:"Clothing Brand", color:"#2E7D32" },
  { id:6, name:"Personal",                  short:"Personal",        type:"My Hub",         color:"#E53935" },
  { id:7, name:"Command Bean Mogul",         short:"CB Mogul",        type:"Tech Platform",  color:"#3B5BDB" },
];

const WIDGETS = [
  { id:"net-worth",     name:"Net Worth",     category:"Finance",    color:"#EF5350", stats:[{v:"—",l:"ASSETS"},{v:"—",l:"DEBT"},{v:"—",l:"NET"}] },
  { id:"finance",       name:"Finance",       category:"Banking",    color:"#3B5BDB", stats:[{v:"—",l:"CHECK"},{v:"—",l:"SAVE"},{v:"—",l:"CARD"}] },
  { id:"budget",        name:"Budget",        category:"Spending",   color:"#F59E0B", stats:[{v:"—",l:"SPENT"},{v:"—",l:"LEFT"},{v:"—",l:"BILLS"}] },
  { id:"investments",   name:"Investments",   category:"Portfolio",  color:"#43A047", stats:[{v:"—",l:"VALUE"},{v:"—",l:"TODAY"},{v:"—",l:"401K"}] },
  { id:"health",        name:"Health",        category:"Wellness",   color:"#42A5F5", stats:[{v:"—",l:"STEPS"},{v:"—",l:"SLEEP"},{v:"—",l:"HRV"}] },
  { id:"habits",        name:"Habits",        category:"Daily",      color:"#AB47BC", stats:[{v:"—",l:"TODAY"},{v:"—",l:"STREAK"},{v:"—",l:"WEEK"}] },
  { id:"goals",         name:"Goals",         category:"Personal",   color:"#FF7043", stats:[{v:"—",l:"ACTIVE"},{v:"—",l:"ON TRACK"},{v:"—",l:"DONE"}] },
  { id:"subscriptions", name:"Subscriptions", category:"Monthly",    color:"#0097A7", stats:[{v:"—",l:"ACTIVE"},{v:"—",l:"MO COST"},{v:"—",l:"UNUSED"}] },
];

// Apply user business config over the BIZ defaults at module load time
(function applyUserBiz(){
  try{
    const existingData=localStorage.getItem("dws_v5");
    const onboardingDone=localStorage.getItem("dws_onboarding_done");
    const storedBiz=localStorage.getItem("dws_user_biz");
    // Backwards compat: existing user with saved data — skip onboarding
    if(existingData&&!onboardingDone){localStorage.setItem("dws_onboarding_done","1");return;}
    // No onboarding done and no existing data — fresh new user
    if(!onboardingDone){for(let i=0;i<6;i++)BIZ[i].hidden=true;BIZ[7].hidden=true;return;}
    // Onboarding done but no custom biz stored (pre-feature existing user)
    if(!storedBiz)return;
    const stored=JSON.parse(storedBiz);
    if(!Array.isArray(stored))return;
    // Hide all user slots first, then apply configured ones
    for(let i=0;i<6;i++)BIZ[i].hidden=true;
    stored.forEach(b=>{if(b.id>=0&&b.id<=5)Object.assign(BIZ[b.id],{name:b.name,short:b.short,type:b.type,color:b.color,hidden:false});});
  }catch(e){}
})();

/* Bold text colors for headings on dark */
const BIZ_TEXT = BIZ.map(b => b.color);

const PRI = { high:"#C62828", med:"#E65100", low:"#2E7D32" };
const PRI_LABELS = { high:"High", med:"Medium", low:"Low" };
const SK = "dws_v5";
const CLIENT_ID = "32624962382-rte923b8bm122u5pqv3592f0q73bai0q.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose";

const EMAIL_BIZ_MAP = {
  "duane@spliffsgastropub.com":0,
  "duane@1904musichall.com":3,
  "duane@terrapinapparel.com":5,
  "inbox@terrapinapparel.com":5,
};
function emailToBizId(toHeader=""){
  const lower=toHeader.toLowerCase();
  for(const [addr,id] of Object.entries(EMAIL_BIZ_MAP)){if(lower.includes(addr))return id;}
  return 6; // Personal
}
function gmailHeader(headers=[],name){return(headers.find(h=>h.name.toLowerCase()===name.toLowerCase())||{}).value||"";}
function b64Decode(str){try{return decodeURIComponent(escape(atob(str.replace(/-/g,"+").replace(/_/g,"/"))));}catch{return "";}}
function stripHtml(html){return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"").replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<br\s*\/?>/gi,"\n").replace(/<\/p>/gi,"\n").replace(/<\/div>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#\d+;/g,"").replace(/[ \t]{2,}/g," ").replace(/\n[ \t]+/g,"\n").replace(/\n{3,}/g,"\n\n").trim();}
function extractBody(payload){
  // Returns {text, html} — prefer HTML for rich display
  if(!payload)return{text:"",html:""};
  let text="",html="";
  const scan=(p)=>{
    if(!p)return;
    if(p.mimeType==="text/plain"&&p.body?.data&&!text)text=b64Decode(p.body.data);
    if(p.mimeType==="text/html"&&p.body?.data&&!html)html=b64Decode(p.body.data);
    if(p.parts)p.parts.forEach(scan);
  };
  scan(payload);
  if(!html&&!text&&payload.body?.data)text=b64Decode(payload.body.data);
  return{text,html};
}
function sanitizeHtml(html){
  // Remove scripts and on* handlers only — keep everything else including images
  return html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/\son\w+="[^"]*"/gi,"").replace(/\son\w+='[^']*'/gi,"");
}
function makeMime({from,to,subject,body}){
  const msg=`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
  return btoa(unescape(encodeURIComponent(msg))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_S = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const GC_EVENTS = [
  { id:"s1",  summary:"\u{1F338} Evening with Stephanie",            start:"2026-04-10", end:"2026-04-11", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s2",  summary:"\u{1F4CA} Budget Review \u2014 April 2026",       start:"2026-04-14T20:00:00-04:00",    allDay:false, bizId:6, color:"#E53935" },
  { id:"s3",  summary:"\u{1F697} Jaguar car payment",                start:"2026-04-25", end:"2026-04-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s4",  summary:"\u{1F382} Solomon DeCastro's birthday",       start:"2026-04-25", end:"2026-04-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s5",  summary:"\u{1F9B7} Island Walk Dental Care",           start:"2026-04-28T14:30:00-04:00",    allDay:false, bizId:6, color:"#E53935" },
  { id:"s6",  summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-05-01", end:"2026-05-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s7",  summary:"\u{1F697} Jaguar car payment",                start:"2026-05-25", end:"2026-05-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s8",  summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-06-01", end:"2026-06-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s9",  summary:"\u{1F382} Peter & Tish Gappmayr birthday",    start:"2026-06-23", end:"2026-06-24", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s10", summary:"\u{1F697} Jaguar car payment",                start:"2026-06-25", end:"2026-06-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s11", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-07-01", end:"2026-07-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s12", summary:"\u{1F697} Jaguar car payment",                start:"2026-07-25", end:"2026-07-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s13", summary:"\u{1F4B3} Care Credit \u2014 Verify Payoff",       start:"2026-08-01", end:"2026-08-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s14", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-08-01", end:"2026-08-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s15", summary:"\u{1F6A8} Care Credit \u2014 FINAL DEADLINE",      start:"2026-08-09", end:"2026-08-10", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s16", summary:"\u{1F697} Jaguar car payment",                start:"2026-08-25", end:"2026-08-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s17", summary:"\u{1F4B3} Lowes \u2014 Review & Increase Payment", start:"2026-09-01", end:"2026-09-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s18", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-09-01", end:"2026-09-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s19", summary:"\u{1F697} Jaguar car payment",                start:"2026-09-25", end:"2026-09-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s20", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-10-01", end:"2026-10-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s21", summary:"\u{1F382} Frank & Mercedez Dinino birthday",  start:"2026-10-07", end:"2026-10-08", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s22", summary:"\u{1F697} Jaguar car payment",                start:"2026-10-25", end:"2026-10-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s23", summary:"\u{1F382} Jason Hunnicutt birthday",          start:"2026-11-01", end:"2026-11-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s24", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-11-01", end:"2026-11-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s25", summary:"\u{1F4B3} Lowes \u2014 Verify Payoff on Track",    start:"2026-11-01", end:"2026-11-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s26", summary:"\u{1F382} Jeff Davis birthday",               start:"2026-11-10", end:"2026-11-11", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s27", summary:"\u{1F382} Isaac's birthday",                  start:"2026-11-11", end:"2026-11-12", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s28", summary:"\u{1F697} Jaguar car payment",                start:"2026-11-25", end:"2026-11-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s29", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2026-12-01", end:"2026-12-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s30", summary:"\u{1F697} Jaguar car payment",                start:"2026-12-25", end:"2026-12-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s31", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2027-01-01", end:"2027-01-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s32", summary:"\u{1F697} Jaguar car payment",                start:"2027-01-25", end:"2027-01-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s33", summary:"\u{1F382} Kristin Dinino birthday",           start:"2027-01-25", end:"2027-01-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s34", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2027-02-01", end:"2027-02-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s35", summary:"\u{1F6A8} Lowes \u2014 FINAL DEADLINE TODAY",      start:"2027-02-02", end:"2027-02-03", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s36", summary:"\u{1F697} Jaguar car payment",                start:"2027-02-25", end:"2027-02-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s37", summary:"\u{1F4B0} Monthly Budget Check-In",           start:"2027-03-01", end:"2027-03-02", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s38", summary:"\u{1F382} Ken & Charmaine Collins birthday",  start:"2027-03-05", end:"2027-03-06", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s39", summary:"\u{1F697} Jaguar car payment",                start:"2027-03-25", end:"2027-03-26", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s40", summary:"\u{1F382} Karl & Cassandra Kovacs birthday",  start:"2027-03-30", end:"2027-03-31", allDay:true,  bizId:6, color:"#E53935" },
  { id:"s41", summary:"\u{1F382} Dave & Jenny DeCastro Birthday",    start:"2027-03-31", end:"2027-04-01", allDay:true,  bizId:6, color:"#7B1FA2" },
  { id:"s42", summary:"\u{1F4B5} Cash Count \u2014 Spliffs Downtown",     start:"2026-04-06", end:"2026-04-07", allDay:true,  bizId:0, color:"#E65100" },
];

const DEFAULT_TASKS = [[], [], [], [], [], [], [], []];

function loadSaved(){try{const r=localStorage.getItem(SK);if(!r)return null;const d=JSON.parse(r);if(!d||!Array.isArray(d.tasks))return null;while(d.tasks.length<BIZ.length)d.tasks.push([]);if(!d.notes||!Array.isArray(d.notes))d.notes=BIZ.map(()=>[]);while(d.notes.length<BIZ.length)d.notes.push([]);return d;}catch{return null;}}
function persist(d){try{localStorage.setItem(SK,JSON.stringify(d));}catch{}}

/* ── Google Drive appData sync for notes ── */
const DRIVE_NOTES_FILE="dws_notes.json";
let _driveFileId=null;
const DRIVE_RHYTHM_FILE="dws_rhythm_planner.json";
let _driveRhythmFileId=null;
async function driveReadRhythm(token){
  try{
    const r=await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)",{headers:{Authorization:`Bearer ${token}`}});
    if(r.status===403)return null;
    const d=await r.json();
    const f=(d.files||[]).find(f=>f.name===DRIVE_RHYTHM_FILE);
    if(!f)return null;
    _driveRhythmFileId=f.id;
    const r2=await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});
    return await r2.json();
  }catch(e){console.warn("Drive rhythm read failed:",e);return null;}
}
async function driveWriteRhythm(token,data){
  try{
    const body=JSON.stringify({...data,savedAt:new Date().toISOString()});
    if(!_driveRhythmFileId){
      const r=await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)",{headers:{Authorization:`Bearer ${token}`}});
      const d=await r.json();
      const f=(d.files||[]).find(f=>f.name===DRIVE_RHYTHM_FILE);
      if(f)_driveRhythmFileId=f.id;
    }
    if(_driveRhythmFileId){
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${_driveRhythmFileId}?uploadType=media`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body});
    }else{
      const bnd="dws_rbnd";
      const meta=JSON.stringify({name:DRIVE_RHYTHM_FILE,parents:["appDataFolder"]});
      const mp=`--${bnd}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bnd}--`;
      const r2=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${bnd}`},body:mp});
      const d=await r2.json();_driveRhythmFileId=d.id;
    }
  }catch(e){console.warn("Drive rhythm write failed:",e);}
}
async function driveListFile(token){
  const r=await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)",{headers:{Authorization:`Bearer ${token}`}});
  if(r.status===403)return "FORBIDDEN";
  const d=await r.json();return(d.files||[]).find(f=>f.name===DRIVE_NOTES_FILE)||null;
}
async function driveReadNotes(token){
  try{
    const f=await driveListFile(token);
    if(f==="FORBIDDEN")return "FORBIDDEN";
    if(!f){console.warn("Drive notes: no file found in appDataFolder");return null;}
    _driveFileId=f.id;
    const r=await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,{headers:{Authorization:`Bearer ${token}`}});
    const d=await r.json();
    const notes=Array.isArray(d.notes)?d.notes:null;
    console.log("Drive notes loaded:",notes?notes.map(b=>b.length).join(",")+" notes per biz":"none");
    return notes;
  }catch(e){console.warn("Drive notes read failed:",e);return null;}
}
async function driveWriteNotes(token,notes){
  try{
    const body=JSON.stringify({notes,savedAt:new Date().toISOString()});
    if(!_driveFileId){const f=await driveListFile(token);if(f)_driveFileId=f.id;}
    if(_driveFileId){
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${_driveFileId}?uploadType=media`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body});
    }else{
      const bnd="dws_bnd";
      const meta=JSON.stringify({name:DRIVE_NOTES_FILE,parents:["appDataFolder"]});
      const mp=`--${bnd}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bnd}--`;
      const r=await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${bnd}`},body:mp});
      const d=await r.json();_driveFileId=d.id;
    }
  }catch(e){console.warn("Drive notes sync failed:",e);}
}
function mergeNotes(local,remote){
  return BIZ.map((_,i)=>{
    const a=local[i]||[];const b=(remote&&remote[i])||[];
    const map={};
    [...a,...b].forEach(n=>{
      const existing=map[n.id];
      if(!existing||new Date(n.edited||n.timestamp)>new Date(existing.edited||existing.timestamp))map[n.id]=n;
    });
    return Object.values(map).sort((x,y)=>new Date(y.timestamp)-new Date(x.timestamp));
  });
}

function todayStr(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

function fmtDate(d){if(!d)return"";const dt=new Date(d+(d.includes("T")?"":"T00:00:00"));return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});}
function fmtTime(d){if(!d||d.length===10)return"";return new Date(d).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});}
function getMonthDays(y,m){const f=new Date(y,m,1),l=new Date(y,m+1,0),a=[];for(let i=0;i<f.getDay();i++)a.push(null);for(let d=1;d<=l.getDate();d++)a.push(d);return a;}
function isoDate(y,m,d){return`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;}
function defaultState(){return{tasks:DEFAULT_TASKS,notes:BIZ.map(()=>[])};}
function guessEventBizId(s="",d=""){const t=(s+" "+d).toLowerCase();if(t.includes("spliff")&&t.includes("downtown"))return 0;if(t.includes("spliff")&&t.includes("bayard"))return 1;if(t.includes("spliff")&&t.includes("mayport"))return 2;if(t.includes("spliff"))return 0;if(t.includes("ost")||t.includes("ocean")||t.includes("taco"))return 3;if(t.includes("circuit")||t.includes("barcade")||t.includes("arcade"))return 4;if(t.includes("ata")||t.includes("terrapin")||t.includes("apparel")||t.includes("clothing"))return 5;if(t.includes("connect bean")||t.includes("connectbean"))return 7;return 6;}
function matchCalendarToBiz(name){const n=(name||"").toLowerCase();if(n.includes("spliff")&&n.includes("downtown"))return 0;if(n.includes("spliff")&&n.includes("bayard"))return 1;if(n.includes("spliff")&&n.includes("mayport"))return 2;if(n.includes("spliff"))return 0;if(n.includes("ocean")||n.includes("ost")||n.includes("taco"))return 3;if(n.includes("circuit")||n.includes("barcade")||n.includes("arcade"))return 4;if(n.includes("ata")||n.includes("terrapin")||n.includes("apparel"))return 5;if(n.includes("personal"))return 6;if(n.includes("connect bean")||n.includes("connect"))return 7;return null;}

const FONT="'Inter','Helvetica Neue',Arial,sans-serif";
const FONT_MONO="'JetBrains Mono','Fira Mono',monospace";

/* ── Voice command parser ── */
const VDAYS=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const VORDS={first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,eleventh:11,twelfth:12,thirteenth:13,fourteenth:14,fifteenth:15,sixteenth:16,seventeenth:17,eighteenth:18,nineteenth:19,twentieth:20,thirtieth:30,"twenty first":21,"twenty second":22,"twenty third":23,"twenty fourth":24,"twenty fifth":25,"twenty sixth":26,"twenty seventh":27,"twenty eighth":28,"twenty ninth":29,"thirty first":31};
function parseVoiceCmd(transcript,fixedBizId){
  const t=transcript.trim();const tl=t.toLowerCase();
  let intent="task";let rest=t;
  if(/^(calendar\s+event|add\s+event|event|schedule|meeting)\b/i.test(tl)){intent="event";rest=t.replace(/^(calendar\s+event|add\s+event|event|schedule|meeting)\s*/i,"");}
  else if(/^(task|todo|to\s+do|add\s+task)\b/i.test(tl)){intent="task";rest=t.replace(/^(task|todo|to\s+do|add\s+task)\s*/i,"");}
  else if(/^(reminder|remind\s+me)\b/i.test(tl)){intent="task";rest=t.replace(/^(reminder|remind\s+me(\s+to)?)\s*/i,"");}
  if(intent==="task"){const bi=fixedBizId!=null?fixedBizId:guessEventBizId(rest);return{type:"task",text:rest.trim(),bizId:bi};}
  const rl=rest.toLowerCase();
  let recur="none";
  if(/\b(recurring|reoccurring|re-occurring|repeating|repeat|every)\b/i.test(rl)){
    if(/every\s+weekday|mon(day)?\s*(thru|through|to|-)\s*fri/i.test(rl))recur="weekdays";
    else if(/every\s+day|daily/i.test(rl))recur="daily";
    else if(/every\s+month|monthly/i.test(rl))recur="monthly";
    else if(/\b\d{1,2}(st|nd|rd|th)?\b/.test(rl)||(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(rl)&&/\b\d{1,2}\b/.test(rl)))recur="monthly";
    else recur="weekly";
  }
  let time="";let allDay=true;
  const tm=rl.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if(tm){allDay=false;let h=parseInt(tm[1]);const m=tm[2]||"00";const mer=(tm[3]||"").toLowerCase();if(mer==="pm"&&h<12)h+=12;else if(mer==="am"&&h===12)h=0;else if(!mer&&h>=1&&h<=6)h+=12;time=`${String(h).padStart(2,"0")}:${m}`;}
  const today=new Date();let date=today.toISOString().split("T")[0];
  const dm=rl.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if(dm){const di=VDAYS.indexOf(dm[1]);const diff=((di-today.getDay())+7)%7||7;const nd=new Date(today);nd.setDate(today.getDate()+diff);date=nd.toISOString().split("T")[0];}
  const om=rl.match(/\bthe\s+(\d{1,2}(?:st|nd|rd|th)?|([\w]+ )?[\w]+(teenth|tieth|th|st|nd|rd))\b/);
  if(om){let dn=parseInt(om[1]);if(isNaN(dn))dn=VORDS[om[1].replace(/\s+/g," ")]||0;if(dn>=1&&dn<=31){const td2=new Date(today.getFullYear(),today.getMonth(),dn);if(td2<=today)td2.setMonth(td2.getMonth()+1);date=td2.toISOString().split("T")[0];}}
  if(/\btomorrow\b/i.test(rl)){const t2=new Date(today);t2.setDate(today.getDate()+1);date=t2.toISOString().split("T")[0];}
  const MONTH_NAMES=["january","february","march","april","may","june","july","august","september","october","november","december"];
  const mnm=rl.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(st|nd|rd|th)?\b/i);
  if(mnm){const mo=MONTH_NAMES.indexOf(mnm[1].toLowerCase());const dy=parseInt(mnm[2]);if(mo>=0&&dy>=1&&dy<=31){const nd=new Date(today.getFullYear(),mo,dy);if(nd<=today)nd.setFullYear(today.getFullYear()+1);date=nd.toISOString().split("T")[0];}}
  let title=rest
    .replace(/\b(make|set)\s+(it\s+)?(recurring|reoccurring|re-occurring|repeating|repeat(ing)?)\b/gi,"")
    .replace(/\b(recurring|reoccurring|re-occurring|repeating|repeat)\b/gi,"")
    .replace(/\bevery\s+(day|weekday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,"")
    .replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,"")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(st|nd|rd|th)?\b/gi,"")
    .replace(/\bthe\s+\d{1,2}(st|nd|rd|th)?\b/gi,"")
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi,"")
    .replace(/\b(on\s+the|on)\b/gi,"")
    .replace(/\btomorrow\b/gi,"").replace(/\btoday\b/gi,"")
    .replace(/\s+/g," ").trim();
  const bi=fixedBizId!=null?fixedBizId:guessEventBizId(title);
  return{type:"event",title,date,time,allDay,recur,bizId:bi,color:BIZ[bi].color,note:""};
}

function VoiceTaskBar({onTask,onAddCalEvent,onAddNote,isAuthed,bizId,compact}){
  const[activeMode,setActiveMode]=useState(null); // "calendar"|"task"|"note"
  const[listening,setListening]=useState(false);
  const[transcript,setTranscript]=useState("");
  const[status,setStatus]=useState("");
  const[hoveredMode,setHoveredMode]=useState(null);
  const recRef=useRef(null);
  const MODE_COLORS={calendar:"#EF5350",task:"#3B5BDB",note:"#7B1FA2"};
  const MODE_ICONS={calendar:CalendarDays,task:ListChecks,note:PenLine};
  const ac=activeMode?MODE_COLORS[activeMode]:"#3B5BDB";
  const btnSize=compact?40:64;
  const btnRadius=compact?12:18;

  const stopMic=()=>{if(recRef.current){recRef.current._keepAlive=false;recRef.current.stop();}};

  const startMic=(mode)=>{
    if(!isAuthed){setStatus("Connect Google first to use voice commands");setTimeout(()=>setStatus(""),3000);return;}
    if(listening&&activeMode===mode){stopMic();return;}
    if(recRef.current){recRef.current._keepAlive=false;try{recRef.current.stop();}catch(e){}}
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)){setStatus("Voice not supported in this browser");return;}
    setActiveMode(mode);setTranscript("");setStatus("");
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=true;rec.interimResults=true;rec.lang="en-US";
    rec.onresult=(e)=>{let t="";for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setTranscript(t);};
    rec.onend=()=>{if(recRef.current?._keepAlive){try{rec.start();}catch(e){setListening(false);}}else{setListening(false);}};
    rec.onerror=(e)=>{if(e.error==="no-speech")return;setListening(false);rec._keepAlive=false;setStatus(e.error==="not-allowed"?"Mic blocked — check browser permissions":"Mic error — try again");setTimeout(()=>setStatus(""),4000);};
    rec._keepAlive=true;recRef.current=rec;rec.start();setListening(true);
  };

  const send=()=>{
    if(!transcript.trim())return;
    if(activeMode==="calendar"){
      const cmd=parseVoiceCmd("event "+transcript,bizId);
      onAddCalEvent?.(cmd);
      const recurLabel=cmd.recur!=="none"?" \uD83D\uDD01 repeating":"";
      setStatus(`\u2705 Calendar: ${cmd.title} \u00B7 ${fmtDate(cmd.date)}${cmd.time?` \u00B7 ${cmd.time}`:" \u00B7 All day"}${recurLabel}`);
    }else if(activeMode==="note"){
      const targetBiz=bizId!=null?bizId:6;
      onAddNote?.(targetBiz,transcript.trim());
      setStatus(`\u2705 Note saved to ${BIZ[targetBiz].short}`);
    }else{
      const targetBiz=bizId!=null?bizId:guessEventBizId(transcript);
      onTask(targetBiz,{text:transcript.trim(),priority:"med",due:"",done:false});
      setStatus(`\u2705 Task added to ${BIZ[targetBiz].short}`);
    }
    setTranscript("");setActiveMode(null);setTimeout(()=>setStatus(""),5000);
  };

  const eventPreview=activeMode==="calendar"&&transcript?parseVoiceCmd("event "+transcript,bizId):null;

  return(
    <div style={{display:"flex",flexDirection:"column",gap:0,fontFamily:FONT}}>
      <div style={{display:"flex",gap:compact?8:12,alignItems:"flex-start"}}>
        {["calendar","task","note"].map(mode=>{
          const isActive=activeMode===mode&&listening;
          const isHovered=hoveredMode===mode&&!isActive;
          const c=MODE_COLORS[mode];
          const scale=isActive?1:(isHovered?1.08:1);
          const translateY=isHovered?-3:0;
          const bgColor=isActive?"#fff2f2":isHovered?`${c}12`:(compact?"rgba(255,255,255,0.1)":"#fff");
          const borderColor=isActive?"#C62828":c;
          const borderWidth=isHovered||isActive?3:2.5;
          const shadow=isActive?`0 6px 20px rgba(198,40,40,0.3)`:isHovered?`0 6px 20px ${c}50`:`0 2px 10px ${c}30`;
          const IdleIcon=MODE_ICONS[mode];
          return(
            <div key={mode}
              onClick={()=>startMic(mode)}
              onMouseEnter={()=>setHoveredMode(mode)}
              onMouseLeave={()=>setHoveredMode(null)}
              style={{display:"flex",flexDirection:"column",alignItems:"center",gap:compact?4:6,cursor:"pointer"}}>
              <div style={{width:btnSize,height:btnSize,borderRadius:btnRadius,background:bgColor,border:`${borderWidth}px solid ${borderColor}`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:shadow,transform:`scale(${scale}) translateY(${translateY}px)`,transition:"all 0.2s cubic-bezier(0.34,1.56,0.64,1)",animation:isActive?"pulseGlow 1s ease-in-out infinite":"none"}}>
                <span style={{transition:"transform 0.2s",transform:isHovered?"scale(1.15)":"scale(1)",display:"flex",alignItems:"center",justifyContent:"center",color:isActive?"#C62828":c}}>{isActive?<Square size={compact?18:24} strokeWidth={2.5}/>:<IdleIcon size={compact?18:24} strokeWidth={2.5}/>}</span>
              </div>
              {!compact&&<div style={{fontSize:10,fontWeight:800,letterSpacing:1.2,color:isActive?"#C62828":c,fontFamily:FONT_MONO,transition:"color 0.2s"}}>{mode.toUpperCase()}</div>}
            </div>
          );
        })}
      </div>
      {(transcript||status)&&(
        <div style={{marginTop:8,padding:"14px 16px",background:"rgba(14,20,38,0.96)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1.5px solid ${ac}44`,borderRadius:14,boxShadow:`0 4px 20px rgba(0,0,0,0.4)`,animation:"fadeSlideIn 0.3s ease-out",minWidth:compact?260:240,maxWidth:compact?360:undefined}}>
          {transcript&&(
            <>
              {eventPreview&&<div style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:FONT_MONO,marginBottom:6}}>{fmtDate(eventPreview.date)}{eventPreview.time?` \u00B7 ${eventPreview.time}`:" \u00B7 All day"}{eventPreview.recur!=="none"?" \uD83D\uDD01":""}</div>}
              <div style={{fontSize:15,color:"rgba(255,255,255,0.88)",fontWeight:500,lineHeight:1.5,marginBottom:4}}>{transcript}</div>
            </>
          )}
          {transcript&&!listening&&(
            <div style={{display:"flex",gap:8,marginTop:10}}>
              <button onClick={()=>{setTranscript("");setStatus("");setActiveMode(null);}} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>CANCEL</button>
              <button onClick={send} style={{flex:2,background:`linear-gradient(135deg,${ac},${ac}cc)`,border:"none",color:"#fff",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT,boxShadow:`0 4px 16px ${ac}40`,letterSpacing:0.5}}>ADD {activeMode?.toUpperCase()} \u2192</button>
            </div>
          )}
          {status&&!transcript&&<div style={{fontSize:13,fontWeight:700,color:status.startsWith("\u2705")?"#2E7D32":"#C62828"}}>{status}</div>}
        </div>
      )}
    </div>
  );
}

const BAR_CONF=[
  {ha:"eq1",hd:"3.2s",hd2:"0s",   od:"5.5s",od2:"0s"},
  {ha:"eq2",hd:"4.4s",hd2:"0.7s", od:"7.1s",od2:"1.2s"},
  {ha:"eq3",hd:"2.8s",hd2:"0.4s", od:"4.9s",od2:"2.2s"},
  {ha:"eq4",hd:"5.1s",hd2:"1.1s", od:"8.1s",od2:"0.7s"},
  {ha:"eq5",hd:"3.8s",hd2:"0.5s", od:"6.3s",od2:"1.9s"},
];
const BAR_GRADIENTS=[
  "linear-gradient(to top,#7A3800,#F59E0B,#FFD060)",// amber  — Bean brand
  "linear-gradient(to top,#1B4D1E,#2E7D32,#69F073)",// green  — ATA
  "linear-gradient(to top,#004D56,#0097A7,#29D9F0)",// teal   — Circuit
  "linear-gradient(to top,#1A237E,#3B5BDB,#7C9CFF)",// blue   — Bean blue
  "linear-gradient(to top,#3E0061,#7B1FA2,#CE93D8)",// purple — Personal
];
function EQBars({fab=false}){
  const w=fab?7:5,h=fab?30:18,gap=fab?3:2;
  const segH=fab?3:2,segGap=1;
  const mask=`repeating-linear-gradient(to top,#000 0px,#000 ${segH}px,transparent ${segH}px,transparent ${segH+segGap}px)`;
  return(
    <div style={{display:"flex",alignItems:"flex-end",gap}}>
      {BAR_CONF.map((b,i)=>(
        <div key={i} style={{
          width:w,height:h,borderRadius:1,
          transformOrigin:"bottom center",
          background:BAR_GRADIENTS[i],
          maskImage:mask,
          WebkitMaskImage:mask,
          animation:`${b.ha} ${b.hd} linear ${b.hd2} infinite,eqOp ${b.od} ease-in-out ${b.od2} infinite`
        }}/>
      ))}
    </div>
  );
}

function PanelMic({mode,color,isAuthed,onSubmit,bizId}){
  const[listening,setListening]=useState(false);
  const[transcript,setTranscript]=useState("");
  const[status,setStatus]=useState("");
  const recRef=useRef(null);
  const ICONS={calendar:CalendarDays,task:ListChecks,note:PenLine};
  const IdleIcon=ICONS[mode];
  const stopMic=()=>{if(recRef.current){recRef.current._keepAlive=false;recRef.current.stop();}};
  const startMic=()=>{
    if(!isAuthed){setStatus("Connect Google first");setTimeout(()=>setStatus(""),3000);return;}
    if(listening){stopMic();return;}
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)){setStatus("Voice not supported");return;}
    setTranscript("");setStatus("");
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=true;rec.interimResults=true;rec.lang="en-US";
    rec.onresult=(e)=>{let t="";for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setTranscript(t);};
    rec.onend=()=>{if(recRef.current?._keepAlive){try{rec.start();}catch(e){setListening(false);}}else{setListening(false);}};
    rec.onerror=(e)=>{if(e.error==="no-speech")return;setListening(false);rec._keepAlive=false;setStatus("Mic error — try again");setTimeout(()=>setStatus(""),3000);};
    rec._keepAlive=true;recRef.current=rec;rec.start();setListening(true);
  };
  const send=()=>{
    if(!transcript.trim())return;
    if(mode==="calendar"){const cmd=parseVoiceCmd("event "+transcript,bizId);onSubmit(cmd);setStatus(`\u2705 ${cmd.title} \u00B7 ${fmtDate(cmd.date)}`);}
    else{onSubmit(transcript.trim());setStatus(`\u2705 Added`);}
    setTranscript("");setListening(false);setTimeout(()=>setStatus(""),3000);
  };
  const calPreview=mode==="calendar"&&transcript?parseVoiceCmd("event "+transcript,bizId):null;
  return(
    <div style={{position:"relative",display:"inline-flex"}}>
      <div onClick={startMic} style={{display:"flex",alignItems:"center",gap:5,paddingLeft:10,paddingRight:10,height:32,borderRadius:20,background:listening?"#fff2f2":`${color}15`,border:`2px solid ${listening?"#C62828":color}`,cursor:"pointer",boxShadow:listening?"0 4px 14px rgba(198,40,40,0.3)":`0 2px 8px ${color}30`,animation:listening?"pulseGlow 1s ease-in-out infinite":"none",transition:"all 0.2s ease",whiteSpace:"nowrap"}}>
        {listening
          ?<><Square size={13} strokeWidth={2.5} color="#C62828"/><span style={{fontSize:11,fontWeight:700,color:"#C62828",fontFamily:"Inter,sans-serif",letterSpacing:0.3}}>STOP</span></>
          :<><IdleIcon size={13} strokeWidth={2.5} color={color}/><Mic size={12} strokeWidth={2.5} color={color} style={{opacity:0.7}}/></>
        }
      </div>
      {(transcript||status)&&(
        <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:2000,background:"rgba(14,20,38,0.97)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1.5px solid ${color}44`,borderRadius:14,padding:"14px 16px",boxShadow:`0 8px 30px rgba(0,0,0,0.45)`,minWidth:260,maxWidth:340,animation:"fadeSlideIn 0.2s ease-out"}}>
          {transcript&&(
            <>
              {calPreview&&<div style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:FONT_MONO,marginBottom:6}}>{fmtDate(calPreview.date)}{calPreview.time?` \u00B7 ${calPreview.time}`:" \u00B7 All day"}{calPreview.recur!=="none"?" \uD83D\uDD01":""}</div>}
              <div style={{fontSize:14,color:"rgba(255,255,255,0.88)",fontWeight:500,lineHeight:1.5,marginBottom:10}}>{transcript}</div>
              {!listening&&(
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setTranscript("");setStatus("");}} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:10,padding:"8px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>CANCEL</button>
                  <button onClick={send} style={{flex:2,background:`linear-gradient(135deg,${color},${color}cc)`,border:"none",color:"#fff",borderRadius:10,padding:"8px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT,boxShadow:`0 4px 14px ${color}40`}}>ADD {mode.toUpperCase()} \u2192</button>
                </div>
              )}
            </>
          )}
          {status&&!transcript&&<div style={{fontSize:13,fontWeight:700,color:status.startsWith("\u2705")?"#2E7D32":"#C62828"}}>{status}</div>}
        </div>
      )}
    </div>
  );
}

/* ── Glassmorphism panel with animated glow ── */
const panelSt=(c)=>({
  background:"rgba(255,255,255,0.05)",
  backdropFilter:"blur(20px)",
  WebkitBackdropFilter:"blur(20px)",
  border:`1px solid rgba(255,255,255,0.08)`,
  borderRadius:18,
  padding:"20px 22px",
  boxShadow:`0 4px 30px rgba(0,0,0,0.3), 0 0 0 1px ${c}18`,
  animation:"fadeSlideIn 0.4s ease-out both",
  transition:"all 0.3s ease",
  fontFamily:FONT,
});

const iSt=(c)=>({background:"rgba(255,255,255,0.07)",border:`1.5px solid ${c}44`,color:"rgba(255,255,255,0.88)",borderRadius:10,padding:"11px 14px",fontSize:14,fontFamily:FONT,width:"100%",boxSizing:"border-box",outline:"none",transition:"border-color 0.2s, box-shadow 0.2s"});
const tSt=(a,c,mobile=false)=>({flexShrink:0,padding:mobile?"10px 7px":"14px 12px",border:"none",background:"none",cursor:"pointer",fontSize:mobile?10:12,fontWeight:700,letterSpacing:mobile?0.3:0.8,whiteSpace:"nowrap",color:a?"#fff":"rgba(255,255,255,0.4)",borderBottom:`3px solid ${a?c:"transparent"}`,transition:"all .2s ease",fontFamily:FONT_MONO,textTransform:"uppercase"});
const nB={background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:26,padding:"0 12px",lineHeight:1,transition:"color 0.2s"};
const btnSt=(c)=>({background:`linear-gradient(135deg, ${c}, ${c}dd)`,border:"none",color:"#fff",borderRadius:12,padding:"11px 18px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:FONT,boxShadow:`0 4px 16px ${c}40`,transition:"all 0.2s ease",letterSpacing:0.3});

function EventPopup({date,biz,onSave,onClose}){
  const[title,setTitle]=useState("");
  const[allDay,setAllDay]=useState(true);
  const[time,setTime]=useState("");
  const[note,setNote]=useState("");
  const[recur,setRecur]=useState("none");
  const submit=()=>{if(!title.trim())return;onSave({title:title.trim(),date,time:allDay?"":time,allDay,note:note.trim(),bizId:biz.id,color:biz.color,recur});};
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(4px)"}} onClick={onClose}>
      <div style={{...panelSt(biz.color),width:360,boxShadow:`0 8px 40px ${biz.color}40`}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,color:BIZ_TEXT[biz.id],letterSpacing:1}}>+ ADD EVENT · {fmtDate(date)}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,padding:0}}>{"\u2715"}</button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Event title..." style={iSt(biz.color)} autoFocus onKeyDown={e=>e.key==="Enter"&&submit()}/>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <label style={{fontSize:13,color:"rgba(255,255,255,0.55)",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
              <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} style={{accentColor:biz.color,width:16,height:16}}/>All day
            </label>
            {!allDay&&<input type="time" value={time} onChange={e=>setTime(e.target.value)} style={{...iSt(biz.color),flex:1}}/>}
          </div>
          <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Notes (optional)..." rows={2} style={{...iSt(biz.color),resize:"none"}}/>
          <select value={recur} onChange={e=>setRecur(e.target.value)} style={{...iSt(biz.color),cursor:"pointer"}}>
            <option value="none">Does not repeat</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week (same day)</option>
            <option value="weekdays">Every weekday (Mon–Fri)</option>
            <option value="monthly">Every month (same date)</option>
          </select>
          <div style={{display:"flex",gap:10,marginTop:6}}>
            <button onClick={onClose} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:8,padding:"10px 0",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>CANCEL</button>
            <button onClick={submit} style={{...btnSt(biz.color),flex:2}}>{`SAVE \u2192`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventDetailPopup({events,date,biz,onClose,onAddNew,onDelete,onDeleteAll,onEdit,onEditAll}){
  const[editingId,setEditingId]=useState(null);
  const[editForm,setEditForm]=useState({title:"",allDay:true,time:""});
  const startEdit=(ev)=>{
    const isAllDay=!!ev.allDay||(ev.start&&!ev.start.includes("T"));
    const time=!isAllDay&&ev.start?ev.start.split("T")[1]?.substring(0,5)||"":"";
    setEditingId(ev.id);
    setEditForm({title:ev.summary||"",allDay:isAllDay,time});
  };
  const saveEdit=(ev)=>{if(!editForm.title.trim())return;onEdit(ev,editForm);setEditingId(null);};
  const saveEditAll=(ev)=>{if(!editForm.title.trim())return;onEditAll&&onEditAll(ev,editForm);setEditingId(null);};
  const ac=biz?biz.color:"#7B1FA2";
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,backdropFilter:"blur(4px)"}} onClick={()=>{setEditingId(null);onClose();}}>
      <div style={{...panelSt(ac),width:340,maxHeight:"80vh",overflow:"auto",boxShadow:`0 8px 40px ${ac}40`}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:14,fontWeight:700,color:BIZ_TEXT[biz?biz.id:6],letterSpacing:1}}>{fmtDate(date)}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,padding:0}}>{"\u2715"}</button>
        </div>
        {events.length===0&&<div style={{fontSize:14,color:"rgba(255,255,255,0.35)",padding:"10px 0"}}>No events this day</div>}
        {events.map((ev,i)=>(
          <div key={i} style={{background:`linear-gradient(135deg, ${ev.color}12, ${ev.color}25)`,borderLeft:`4px solid ${ev.color}`,borderRadius:10,padding:"12px 14px",marginBottom:8}}>
            {editingId===ev.id?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <input value={editForm.title} onChange={e=>setEditForm(f=>({...f,title:e.target.value}))} style={iSt(ev.color)} autoFocus onKeyDown={e=>e.key==="Enter"&&saveEdit(ev)}/>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <label style={{fontSize:13,color:"rgba(255,255,255,0.55)",display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                    <input type="checkbox" checked={editForm.allDay} onChange={e=>setEditForm(f=>({...f,allDay:e.target.checked}))} style={{accentColor:ev.color,width:16,height:16}}/>All day
                  </label>
                  {!editForm.allDay&&<input type="time" value={editForm.time} onChange={e=>setEditForm(f=>({...f,time:e.target.value}))} style={{...iSt(ev.color),flex:1}}/>}
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <button onClick={()=>setEditingId(null)} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:8,padding:"8px 0",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>CANCEL</button>
                  <button onClick={()=>saveEdit(ev)} style={{...btnSt(ev.color),flex:2,padding:"8px 14px",fontSize:12}}>{`SAVE THIS \u2192`}</button>
                  {ev.recurringEventId&&onEditAll&&<button onClick={()=>saveEditAll(ev)} style={{...btnSt(ev.color),flex:"1 1 100%",padding:"8px 14px",fontSize:12,opacity:0.8}}>{`SAVE ALL \u2192`}</button>}
                </div>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.88)",lineHeight:1.4,fontFamily:FONT}}>{ev.summary}</div>
                  {!ev.allDay&&<div style={{fontSize:12,color:"rgba(255,255,255,0.5)",marginTop:4,fontFamily:FONT_MONO}}>{fmtTime(ev.start)}</div>}
                  {ev.recurringEventId&&<div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:3,fontFamily:FONT_MONO,letterSpacing:1}}>{"\uD83D\uDD01"} RECURRING</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                  <button onClick={()=>startEdit(ev)} style={{background:`${ev.color}18`,border:`1px solid ${ev.color}44`,color:ev.color,borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>EDIT</button>
                  <button onClick={()=>onDelete(ev)} style={{background:"rgba(198,40,40,0.1)",border:"1px solid rgba(198,40,40,0.3)",color:"#C62828",borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>DELETE</button>
                  {ev.recurringEventId&&onDeleteAll&&<button onClick={()=>{if(window.confirm("Delete ALL occurrences of this recurring event?"))onDeleteAll(ev.recurringEventId);onClose();}} style={{background:"rgba(198,40,40,0.2)",border:"1px solid rgba(198,40,40,0.5)",color:"#C62828",borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>DEL ALL</button>}
                </div>
              </div>
            )}
          </div>
        ))}
        {biz&&<button onClick={()=>{onClose();onAddNew(date);}} style={{...btnSt(biz.color),width:"100%",marginTop:6}}>+ ADD EVENT</button>}
      </div>
    </div>
  );
}

function MonthCal({biz,events,calMonth,setCalMonth,onAddEvent,onDeleteEvent,onDeleteAllEvent,onEditEvent,onEditAllEvent,isAuthed}){
  const{year,month}=calMonth;
  const days=getMonthDays(year,month);
  const td=todayStr();
  const ac=biz?biz.color:"#7B1FA2";
  const[popup,setPopup]=useState(null);
  const[detailPopup,setDetailPopup]=useState(null);
  const isMobile=window.innerWidth<768;
  const maxEvPerCell=isMobile?1:3;
  const prev=()=>setCalMonth(m=>m.month===0?{year:m.year-1,month:11}:{...m,month:m.month-1});
  const next=()=>setCalMonth(m=>m.month===11?{year:m.year+1,month:0}:{...m,month:m.month+1});
  const goToday=()=>{const n=new Date();setCalMonth({year:n.getFullYear(),month:n.getMonth()});};
  const evOnDay=(d)=>{if(!d)return[];const ds=isoDate(year,month,d);return events.filter(ev=>{const s=(ev.start||"").split("T")[0];const e=(ev.end||"").split("T")[0]||s;return ds===s||(ds>s&&ds<e);});};
  const handleCellClick=(d)=>{
    if(!biz||!d)return;
    const ds=isoDate(year,month,d);
    const devs=evOnDay(d);
    if(devs.length>0){setDetailPopup({date:ds,events:devs});}
    else{setPopup(ds);}
  };
  return(
    <>
      {popup&&biz&&<EventPopup date={popup} biz={biz} onSave={(ev)=>{onAddEvent(ev);setPopup(null);}} onClose={()=>setPopup(null)}/>}
      {detailPopup&&<EventDetailPopup events={detailPopup.events} date={detailPopup.date} biz={biz} onClose={()=>setDetailPopup(null)} onAddNew={(d)=>{setDetailPopup(null);setPopup(d);}} onDelete={(ev)=>{onDeleteEvent(ev);setDetailPopup(p=>({...p,events:p.events.filter(e=>e.id!==ev.id)}));}} onDeleteAll={onDeleteAllEvent} onEdit={(ev,updates)=>{onEditEvent(ev,updates);setDetailPopup(p=>({...p,events:p.events.map(e=>e.id===ev.id?{...e,summary:updates.title,allDay:updates.allDay}:e)}));}} onEditAll={(ev,updates)=>{onEditAllEvent&&onEditAllEvent(ev,updates);setDetailPopup(null);}}/>}
      <div style={panelSt(ac)}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <button onClick={prev} style={nB}>{"\u2039"}</button>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20,fontWeight:900,color:BIZ_TEXT[biz?biz.id:6],letterSpacing:0}}>{MONTHS[month]} {year}</span>
            <button onClick={goToday} style={{background:ac,color:"#fff",border:"none",borderRadius:6,padding:"4px 12px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:700,boxShadow:`0 2px 6px ${ac}44`}}>TODAY</button>
          </div>
          <button onClick={next} style={nB}>{"\u203A"}</button>
        </div>
        {biz&&<div style={{fontSize:11,color:"rgba(255,255,255,0.35)",textAlign:"center",marginBottom:8}}>TAP ANY DATE TO VIEW OR ADD EVENTS</div>}
        {biz&&events.length===0&&<div style={{fontSize:13,color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"6px 0 10px",animation:"textPulse 2.8s ease-in-out infinite"}}>Tap the voice button to add your first event</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:6}}>
          {DAYS_S.map(d=><div key={d} style={{fontSize:isMobile?11:13,color:"rgba(255,255,255,0.4)",textAlign:"center",padding:isMobile?"4px 0":"6px 0",fontWeight:700}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:isMobile?3:5}}>
          {days.map((d,i)=>{
            const ds=d?isoDate(year,month,d):null;
            const isT=ds===td;
            const devs=evOnDay(d);
            return(
              <div key={i} className="cal-cell" onClick={()=>handleCellClick(d)}
                style={{height:isMobile?80:150,padding:isMobile?"3px 2px":"6px 5px",background:isT?`${ac}12`:"rgba(255,255,255,0.03)",borderRadius:isMobile?6:10,border:isT?`2px solid ${ac}`:"1px solid rgba(255,255,255,0.06)",cursor:biz&&d?"pointer":"default",transition:"all 0.2s ease",overflow:"hidden",animation:isT?"todayPulse 3s ease-in-out infinite":"none"}}
                onMouseEnter={e=>{if(biz&&d){e.currentTarget.style.background=`${ac}10`;e.currentTarget.style.borderColor=ac;}}}
                onMouseLeave={e=>{e.currentTarget.style.background=isT?`${ac}15`:"rgba(255,255,255,0.03)";e.currentTarget.style.borderColor=isT?ac:"rgba(255,255,255,0.06)";}}>
                {d&&<>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:isMobile?2:4}}>
                    <div style={{width:isMobile?22:28,height:isMobile?22:28,borderRadius:"50%",background:isT?ac:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:isMobile?11:14,fontWeight:isT?800:600,color:isT?"#fff":"#444",lineHeight:1}}>{d}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:isMobile?1:3,overflow:"hidden"}}>
                    {devs.slice(0,maxEvPerCell).map((ev,j)=>(
                      <div key={j} style={{background:`linear-gradient(135deg, ${ev.color}40, ${ev.color}55)`,borderLeft:`3px solid ${ev.color}`,borderRadius:4,padding:isMobile?"1px 3px":"3px 6px"}}>
                        <div style={{fontSize:isMobile?7:11,fontWeight:700,color:"rgba(255,255,255,0.88)",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:isMobile?1:2,WebkitBoxOrient:"vertical",wordBreak:"break-word",fontFamily:FONT}}>{ev.summary}</div>
                      </div>
                    ))}
                    {devs.length>maxEvPerCell&&<div style={{fontSize:isMobile?7:10,color:"rgba(255,255,255,0.35)",textAlign:"center",fontWeight:700}}>+{devs.length-maxEvPerCell}</div>}
                  </div>
                </>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}


function TaskPanel({biz,bizId,tasks,onAdd,onDelete,onToggle,onDeleteAll,gTasks,gTaskLists,onDeleteGTask,onCompleteGTask,onEditGTask,onEditTask,onAddCalEvent,isAuthed}){
  const[adding,setAdding]=useState(false);
  const[editingId,setEditingId]=useState(null);
  const[gDone,setGDone]=useState(()=>{try{const d=JSON.parse(localStorage.getItem(`dws_gdone_${bizId}`)||"null");if(d&&d.date===todayStr())return d.done;}catch{}return{};});
  const saveGDone=(next)=>{try{localStorage.setItem(`dws_gdone_${bizId}`,JSON.stringify({date:todayStr(),done:next}));}catch{}};
  const[editForm,setEditForm]=useState({text:"",priority:"med",due:""});
  const[form,setForm]=useState({text:"",priority:"med",due:""});
  const submit=()=>{if(!form.text.trim())return;onAdd(bizId,{text:form.text.trim(),priority:form.priority,due:form.due,done:false});setForm({text:"",priority:"med",due:""});setAdding(false);};
  const startEdit=(t)=>{setEditingId(t.id);setEditForm({text:t.title||t.text||"",priority:t.priority||"med",due:t.dueDate||t.due||""});};
  const saveEdit=(t)=>{if(!editForm.text.trim())return;if(t.isGoogle){onEditGTask(t.listId,t.id,editForm);}else{onEditTask?.(bizId,t.id,editForm);}if(editForm.due)onAddCalEvent?.({title:editForm.text,date:editForm.due,allDay:true,bizId,color:biz.color});setEditingId(null);};
  const matchingLists=bizId===6
    ?gTaskLists.filter(l=>l.title===biz.name||!BIZ.slice(0,6).some(b=>b.name===l.title))
    :gTaskLists.filter(l=>l.title===biz.name);
  const googleTasks=matchingLists.flatMap(l=>(gTasks[l.id]||[]).map(t=>({...t,_listId:l.id}))).filter(t=>t.title&&t.title.trim());
  const parsedGTasks=googleTasks.map(t=>{
    const notes=t.notes||"";
    const priMatch=notes.match(/Priority:\s*(High|Medium|Low)/i);
    const pri=priMatch?(priMatch[1].toLowerCase()==="high"?"high":priMatch[1].toLowerCase()==="low"?"low":"med"):"med";
    const dueDate=t.due?t.due.split("T")[0]:"";
    return{...t,priority:pri,dueDate,isGoogle:true,listId:t._listId};
  });
  const showLocal=!isAuthed;
  const hasTasks=(showLocal?tasks.length:0)+parsedGTasks.length;
  const renderEditForm=(t)=>(
    <div style={{padding:"10px 0",borderBottom:"1px solid #f0f0f5",animation:"fadeSlideIn 0.2s ease-out"}}>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <input value={editForm.text} onChange={e=>setEditForm(f=>({...f,text:e.target.value}))} style={iSt(biz.color)} autoFocus onKeyDown={e=>e.key==="Enter"&&saveEdit(t)}/>
        <div style={{display:"flex",gap:8}}>
          <select value={editForm.priority} onChange={e=>setEditForm(f=>({...f,priority:e.target.value}))} style={{...iSt(biz.color),flex:1}}>
            <option value="high">{"\u{1F534}"} High</option>
            <option value="med">{"\u{1F7E1}"} Medium</option>
            <option value="low">{"\u{1F7E2}"} Low</option>
          </select>
          <input type="date" value={editForm.due} onChange={e=>setEditForm(f=>({...f,due:e.target.value}))} style={{...iSt(biz.color),flex:1}}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setEditingId(null)} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:10,padding:"9px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>CANCEL</button>
          <button onClick={()=>saveEdit(t)} style={{...btnSt(biz.color),flex:2,padding:"9px 14px",fontSize:12}}>SAVE</button>
        </div>
      </div>
    </div>
  );
  return(
    <div style={panelSt(biz.color)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:800,color:BIZ_TEXT[bizId],letterSpacing:1}}>{"\u{1F4CB}"} TASKS{isAuthed?"":" (offline)"}</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {hasTasks>0&&<button onClick={()=>{if(window.confirm("Delete all tasks?"))onDeleteAll(bizId);}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.4)",borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5}}>DELETE ALL</button>}
          <button onClick={()=>setAdding(!adding)} style={{...btnSt(biz.color),padding:"5px 14px",fontSize:12}}>{adding?"\u2715":"+ ADD"}</button>
        </div>
      </div>
      {adding&&(
        <div style={{marginBottom:14,display:"flex",flexDirection:"column",gap:8}}>
          <input value={form.text} onChange={e=>setForm(f=>({...f,text:e.target.value}))} placeholder="Task description..." onKeyDown={e=>e.key==="Enter"&&submit()} style={iSt(biz.color)}/>
          <div style={{display:"flex",gap:8}}>
            <select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} style={{...iSt(biz.color),flex:1}}>
              <option value="high">{"\u{1F534}"} High</option>
              <option value="med">{"\u{1F7E1}"} Medium</option>
              <option value="low">{"\u{1F7E2}"} Low</option>
            </select>
            <input type="date" value={form.due} onChange={e=>setForm(f=>({...f,due:e.target.value}))} style={{...iSt(biz.color),flex:1}}/>
          </div>
          <button onClick={submit} style={btnSt(biz.color)}>{`ADD TASK \u2192`}</button>
        </div>
      )}
      {hasTasks===0&&<div style={{fontSize:13,color:"rgba(255,255,255,0.3)",padding:"12px 0",animation:"textPulse 2.8s ease-in-out infinite"}}>Tap the voice button to add your first task</div>}
      {parsedGTasks.map(t=>editingId===t.id?<div key={t.id}>{renderEditForm(t)}</div>:(
        <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <input type="checkbox" checked={!!gDone[t.id]} onChange={()=>setGDone(d=>{const next={...d,[t.id]:!d[t.id]};saveGDone(next);return next;})} style={{accentColor:biz.color,marginTop:3,flexShrink:0,cursor:"pointer",width:18,height:18}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:14,color:gDone[t.id]?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.88)",fontWeight:500,textDecoration:gDone[t.id]?"line-through":"none",transition:"all 0.2s"}}>{t.title}</div>
            <div style={{display:"flex",gap:10,marginTop:3}}>
              <span style={{fontSize:11,color:PRI[t.priority],fontWeight:700}}>{PRI_LABELS[t.priority]?.toUpperCase()}</span>
              {t.dueDate&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>Due: {fmtDate(t.dueDate)}</span>}
            </div>
          </div>
          <button onClick={()=>startEdit(t)} style={{background:"none",border:"none",color:biz.color,cursor:"pointer",fontSize:14,padding:"2px 6px",lineHeight:1,opacity:0.6}}>✏️</button>
          <button onClick={(e)=>{e.stopPropagation();onDeleteGTask(t.listId,t.id);}} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:16,padding:"4px 8px",lineHeight:1,borderRadius:6,flexShrink:0}}>{"\u2715"}</button>
        </div>
      ))}
      {showLocal&&tasks.map(t=>editingId===t.id?<div key={t.id}>{renderEditForm(t)}</div>:(
        <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.06)"}}>
          <input type="checkbox" checked={!!t.done} onChange={()=>onToggle(bizId,t.id)} style={{accentColor:biz.color,marginTop:3,flexShrink:0,cursor:"pointer",width:18,height:18}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:14,color:t.done?"rgba(255,255,255,0.3)":"rgba(255,255,255,0.88)",textDecoration:t.done?"line-through":"none",fontWeight:500,transition:"all 0.2s"}}>{t.text}</div>
            <div style={{display:"flex",gap:10,marginTop:3}}>
              <span style={{fontSize:11,color:PRI[t.priority],fontWeight:700}}>{PRI_LABELS[t.priority]?.toUpperCase()}</span>
              {t.due&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>Due: {fmtDate(t.due)}</span>}
            </div>
          </div>
          <button onClick={()=>startEdit(t)} style={{background:"none",border:"none",color:biz.color,cursor:"pointer",fontSize:14,padding:"2px 6px",lineHeight:1,opacity:0.6}}>✏️</button>
          <button onClick={()=>onDelete(bizId,t.id)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:16,padding:"4px 8px",lineHeight:1,borderRadius:6,flexShrink:0}}>{"\u2715"}</button>
        </div>
      ))}
    </div>
  );
}

/* ── Note helper fns ── */
function fmtNoteDate(ts){const d=new Date(ts),t=new Date(),y=new Date(t);y.setDate(y.getDate()-1);if(d.toDateString()===t.toDateString())return"Today";if(d.toDateString()===y.toDateString())return"Yesterday";return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});}
function fmtNoteTime(ts){return new Date(ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});}

function NoteModal({note,biz,bizId,onClose,onUpdate,onDelete,onAddTask}){
  const[editing,setEditing]=useState(false);
  const[editText,setEditText]=useState(note.content);
  const[copied,setCopied]=useState(false);
  const[voicing,setVoicing]=useState(false);
  const recRef=useRef(null);
  const taRef=useRef(null);
  useEffect(()=>{if(taRef.current){taRef.current.style.height="auto";taRef.current.style.height=taRef.current.scrollHeight+"px";}},[editText,editing]);
  const startVoice=()=>{
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window))return;
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=true;rec.interimResults=false;
    rec.onresult=(e)=>{const t=Array.from(e.results).map(r=>r[0].transcript).join(" ");setEditText(s=>s+(s&&!s.endsWith(" ")&&!s.endsWith("\n")?" ":"")+t);};
    rec.onend=()=>setVoicing(false);rec.onerror=()=>setVoicing(false);
    recRef.current=rec;rec.start();setVoicing(true);
  };
  const stopVoice=()=>{try{recRef.current?.stop();}catch(e){}setVoicing(false);};
  const save=()=>{if(!editText.trim())return;onUpdate(bizId,note.id,{content:editText.trim(),edited:new Date().toISOString()});setEditing(false);stopVoice();};
  const downloadNote=(fmt)=>{
    const d=new Date(note.timestamp);
    const header=`${biz.name} \u2014 ${d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})} at ${d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}\n${"\u2500".repeat(50)}\n\n`;
    const blob=new Blob([header+note.content],{type:"text/plain"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`note_${biz.short.replace(/\s+/g,"_")}_${d.toISOString().split("T")[0]}${fmt}`;a.click();URL.revokeObjectURL(url);
  };
  const copyNote=()=>{navigator.clipboard.writeText(note.content).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);});};
  const sendToTask=()=>{onAddTask(bizId,{text:note.content.split("\n")[0].slice(0,120),priority:"med",due:"",done:false});onClose();};
  const togglePin=()=>onUpdate(bizId,note.id,{pinned:!note.pinned});
  return createPortal(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000}} onClick={onClose}>
      <div style={{...panelSt(biz.color),width:380,maxWidth:"92vw",maxHeight:"80vh",display:"flex",flexDirection:"column",boxShadow:`0 8px 40px ${biz.color}40`}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO}}>{fmtNoteDate(note.timestamp)} \u00B7 {fmtNoteTime(note.timestamp)}{note.edited&&<span style={{marginLeft:6,color:biz.color,fontSize:10}}>\u00B7 edited</span>}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,padding:0}}>{"\u2715"}</button>
        </div>
        <div style={{flex:1,overflow:"auto",marginBottom:14}}>
          {editing
            ?<div>
              <textarea ref={taRef} value={editText} onChange={e=>setEditText(e.target.value)} style={{...iSt(biz.color),minHeight:80,resize:"none",width:"100%",boxSizing:"border-box",overflow:"auto"}} autoFocus/>
              <button onClick={voicing?stopVoice:startVoice} style={{marginTop:6,width:"100%",background:voicing?"rgba(198,40,40,0.15)":`rgba(239,83,80,0.1)`,border:voicing?"1px solid #C62828":`1px solid ${biz.color}44`,color:voicing?"#C62828":biz.color,borderRadius:8,padding:"8px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                {voicing?"\u25A0 STOP RECORDING":"\uD83C\uDF99\uFE0F SPEAK TO APPEND"}
              </button>
            </div>
            :<div style={{fontSize:15,color:"rgba(255,255,255,0.88)",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",overflowWrap:"break-word"}}>{note.content}</div>
          }
        </div>
        {editing
          ?<div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={()=>{setEditing(false);setEditText(note.content);stopVoice();}} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>CANCEL</button>
            <button onClick={save} style={{...btnSt(biz.color),flex:2}}>{`SAVE \u2192`}</button>
          </div>
          :<div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              {label:"EDIT",action:()=>setEditing(true),bg:`${biz.color}18`,border:`${biz.color}44`,color:biz.color},
              {label:note.pinned?"UNPIN":"\uD83D\uDCCC PIN",action:togglePin,bg:note.pinned?"#EF535018":"rgba(255,255,255,0.08)",border:note.pinned?"#EF535044":"rgba(255,255,255,0.12)",color:note.pinned?"#EF5350":"rgba(255,255,255,0.5)"},
              {label:copied?"COPIED!":"COPY",action:copyNote,bg:"rgba(255,255,255,0.08)",border:"rgba(255,255,255,0.12)",color:copied?"#2E7D32":"rgba(255,255,255,0.5)"},
              {label:"\u2192 TASK",action:sendToTask,bg:"#3B5BDB18",border:"#3B5BDB44",color:"#3B5BDB"},
              {label:".TXT",action:()=>downloadNote(".txt"),bg:"rgba(255,255,255,0.08)",border:"rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.5)"},
              {label:".MD",action:()=>downloadNote(".md"),bg:"rgba(255,255,255,0.08)",border:"rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.5)"},
              {label:"DELETE",action:()=>{if(window.confirm("Delete this note?")){{onDelete(bizId,note.id);onClose();}}},bg:"rgba(198,40,40,0.08)",border:"rgba(198,40,40,0.3)",color:"#C62828"},
            ].map(({label,action,bg,border,color})=>(
              <button key={label} onClick={action} style={{flex:"1 1 60px",background:bg,border:`1px solid ${border}`,color,borderRadius:10,padding:"8px 6px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.3}}>{label}</button>
            ))}
          </div>
        }
      </div>
    </div>,
    document.body);
}

function NotesAllModal({biz,bizId,notes,onClose,onSelect,onUpdate,onDelete,onAddTask}){
  const[search,setSearch]=useState("");
  const sorted=[...notes].sort((a,b)=>{if(a.pinned&&!b.pinned)return-1;if(!a.pinned&&b.pinned)return 1;return new Date(b.timestamp)-new Date(a.timestamp);});
  const filtered=search?sorted.filter(n=>n.content.toLowerCase().includes(search.toLowerCase())):sorted;
  return createPortal(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000}} onClick={onClose}>
      <div style={{...panelSt(biz.color),width:960,maxWidth:"92vw",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:`0 8px 40px ${biz.color}40`}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:800,color:BIZ_TEXT[bizId],letterSpacing:1,fontFamily:FONT_MONO}}>ALL NOTES ({notes.length})</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,padding:0}}>{"\u2715"}</button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notes..." style={{...iSt(biz.color),marginBottom:12}}/>
        <div style={{flex:1,overflow:"auto"}}>
          {filtered.length===0&&<div style={{fontSize:14,color:"rgba(255,255,255,0.3)",padding:"12px 0",textAlign:"center"}}>No notes found</div>}
          {filtered.map(n=>(
            <div key={n.id} onClick={()=>{onClose();onSelect(n);}}
              style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:12,background:`${biz.color}08`,border:`1px solid ${biz.color}20`,marginBottom:8,cursor:"pointer",transition:"all 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${biz.color}15`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${biz.color}08`;}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                  {n.pinned&&<span style={{fontSize:11}}>{"\uD83D\uDCCC"}</span>}
                  <span style={{fontSize:10,color:biz.color,fontFamily:FONT_MONO,fontWeight:600}}>{fmtNoteDate(n.timestamp)} \u00B7 {fmtNoteTime(n.timestamp)}</span>
                </div>
                <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:4,WebkitBoxOrient:"vertical",wordBreak:"break-word",overflowWrap:"break-word"}}>{n.content}</div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,flexShrink:0}}>
                <span style={{fontSize:12,color:"#ccc"}}>{"\u203A"}</span>
                <button onClick={e=>{e.stopPropagation();if(window.confirm("Delete this note?"))onDelete(bizId,n.id);}} style={{background:"none",border:"none",color:"rgba(198,40,40,0.45)",cursor:"pointer",fontSize:13,padding:0,lineHeight:1,fontFamily:FONT_MONO}}>{"\u2715"}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body);
}

function NotePanel({biz,bizId,notes,onUpdate,onDelete,onAddTask,isAuthed,onAddNote}){
  const[selectedNote,setSelectedNote]=useState(null);
  const[showAll,setShowAll]=useState(false);
  const[adding,setAdding]=useState(false);
  const[newText,setNewText]=useState("");
  const sorted=[...notes].sort((a,b)=>{if(a.pinned&&!b.pinned)return-1;if(!a.pinned&&b.pinned)return 1;return new Date(b.timestamp)-new Date(a.timestamp);});
  const visible=sorted.slice(0,3);
  const handleUpdate=(bi,nid,updates)=>{onUpdate(bi,nid,updates);if(selectedNote&&selectedNote.id===nid)setSelectedNote(n=>({...n,...updates}));};
  const submitNote=()=>{if(!newText.trim())return;onAddNote?.(bizId,newText.trim());setNewText("");setAdding(false);};
  return(
    <div style={{...panelSt(biz.color),overflow:"hidden",minWidth:0}}>
      {selectedNote&&<NoteModal note={selectedNote} biz={biz} bizId={bizId} onClose={()=>setSelectedNote(null)} onUpdate={handleUpdate} onDelete={onDelete} onAddTask={onAddTask}/>}
      {showAll&&<NotesAllModal biz={biz} bizId={bizId} notes={sorted} onClose={()=>setShowAll(false)} onSelect={(n)=>{setShowAll(false);setSelectedNote(n);}} onUpdate={handleUpdate} onDelete={onDelete} onAddTask={onAddTask}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:800,color:BIZ_TEXT[bizId],letterSpacing:2,fontFamily:FONT_MONO}}>{"\uD83D\uDCDD"} NOTES</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {sorted.length>3&&<button onClick={()=>setShowAll(true)} style={{background:"none",border:"none",color:biz.color,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5}}>VIEW ALL ({sorted.length}) {"\u2192"}</button>}
          <button onClick={()=>{setAdding(v=>!v);setNewText("");}} style={{background:adding?`${biz.color}22`:"none",border:`1px solid ${adding?biz.color:biz.color+"44"}`,color:biz.color,fontSize:14,fontWeight:700,cursor:"pointer",borderRadius:6,width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,transition:"all 0.15s"}}>{adding?"\u2715":"+"}</button>
        </div>
      </div>
      {adding&&(
        <div style={{display:"flex",gap:6,marginBottom:10,animation:"fadeSlideIn 0.2s ease-out"}}>
          <input autoFocus value={newText} onChange={e=>setNewText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")submitNote();if(e.key==="Escape"){setAdding(false);setNewText("");}}}
            placeholder="Type a note..." style={{...iSt(biz.color),flex:1,padding:"8px 12px",fontSize:13}}/>
          <button onClick={submitNote} style={{background:biz.color,border:"none",color:"#fff",borderRadius:10,padding:"8px 12px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT,whiteSpace:"nowrap"}}>ADD</button>
        </div>
      )}
      {sorted.length===0&&!adding&&<div style={{fontSize:13,color:"rgba(255,255,255,0.3)",padding:"8px 0",animation:"textPulse 2.8s ease-in-out infinite"}}>Tap + or the voice button to add your first note</div>}
      {visible.map(n=>(
        <div key={n.id} onClick={()=>setSelectedNote(n)}
          style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:`${biz.color}08`,border:`1px solid ${biz.color}20`,marginBottom:6,cursor:"pointer",transition:"all 0.15s",minWidth:0,overflow:"hidden"}}
          onMouseEnter={e=>{e.currentTarget.style.background=`${biz.color}15`;e.currentTarget.style.borderColor=`${biz.color}40`;}}
          onMouseLeave={e=>{e.currentTarget.style.background=`${biz.color}08`;e.currentTarget.style.borderColor=`${biz.color}20`;}}>
          {n.pinned&&<span style={{fontSize:11,flexShrink:0}}>{"\uD83D\uDCCC"}</span>}
          <span style={{fontSize:10,color:biz.color,fontFamily:FONT_MONO,fontWeight:600,flexShrink:0,minWidth:40}}>{fmtNoteTime(n.timestamp)}</span>
          <span style={{fontSize:13,color:"rgba(255,255,255,0.88)",flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.content}</span>
          <button onClick={e=>{e.stopPropagation();if(window.confirm("Delete this note?"))onDelete(bizId,n.id);}} style={{background:"none",border:"none",color:"rgba(198,40,40,0.45)",cursor:"pointer",fontSize:14,padding:"0 2px",flexShrink:0,lineHeight:1,fontFamily:FONT_MONO}}>{"\u2715"}</button>
        </div>
      ))}
    </div>
  );
}

const RHYTHM_QUOTES=[
  {q:"You have power over your mind, not outside events. Realize this, and you will find strength.",a:"Marcus Aurelius"},
  {q:"The impediment to action advances action. What stands in the way becomes the way.",a:"Marcus Aurelius"},
  {q:"Waste no more time arguing about what a good man should be. Be one.",a:"Marcus Aurelius"},
  {q:"Very little is needed to make a happy life; it is all within yourself, in your way of thinking.",a:"Marcus Aurelius"},
  {q:"When you wake up in the morning, tell yourself: the people I deal with today will be meddling, ungrateful, arrogant. But I have seen the beauty of good.",a:"Marcus Aurelius"},
  {q:"Do not indulge in dreams of having what you have not, but reckon up the chief of the blessings you do possess.",a:"Marcus Aurelius"},
  {q:"The best revenge is to be unlike him who performed the injury.",a:"Marcus Aurelius"},
  {q:"Accept the things to which fate binds you, and love the people with whom fate brings you together.",a:"Marcus Aurelius"},
  {q:"If it is not right, do not do it; if it is not true, do not say it.",a:"Marcus Aurelius"},
  {q:"Confine yourself to the present.",a:"Marcus Aurelius"},
  {q:"Never esteem anything as of advantage to you that will make you break your word or lose your self-respect.",a:"Marcus Aurelius"},
  {q:"The soul becomes dyed with the color of its thoughts.",a:"Marcus Aurelius"},
  {q:"He who lives in harmony with himself lives in harmony with the universe.",a:"Marcus Aurelius"},
  {q:"Our life is what our thoughts make it.",a:"Marcus Aurelius"},
  {q:"Loss is nothing else but change, and change is Nature's delight.",a:"Marcus Aurelius"},
  {q:"Do every act of your life as though it were the very last act of your life.",a:"Marcus Aurelius"},
  {q:"How much more grievous are the consequences of anger than the causes of it.",a:"Marcus Aurelius"},
  {q:"Receive without pride, relinquish without struggle.",a:"Marcus Aurelius"},
  {q:"The first rule is to keep an untroubled spirit. The second is to look things in the face and know them for what they are.",a:"Marcus Aurelius"},
  {q:"Begin at once to live, and count each separate day as a separate life.",a:"Marcus Aurelius"},
];

const EQ_BANDS=[
  {cx:35, w:110, color:"rgba(59,91,219,0.32)"},
  {cx:110,w:130, color:"rgba(239,83,80,0.28)"},
  {cx:190,w:140, color:"rgba(0,151,167,0.26)"},
  {cx:270,w:130, color:"rgba(180,90,30,0.24)"},
  {cx:345,w:140, color:"rgba(26,39,68,0.38)"},
  {cx:420,w:120, color:"rgba(99,131,255,0.22)"},
  {cx:488,w:130, color:"rgba(239,83,80,0.2)"},
  {cx:555,w:110, color:"rgba(0,120,140,0.28)"},
];

async function fetchMarcusQuotes(){
  try{
    const r=await fetch("https://api.quotable.io/quotes?author=marcus-aurelius&limit=20&page="+Math.ceil(Math.random()*3));
    if(!r.ok)return null;
    const d=await r.json();
    if(!d.results||!d.results.length)return null;
    return d.results.map(q=>({q:q.content,a:"Marcus Aurelius"}));
  }catch{return null;}
}

const BLOCK_COLORS={morning:"#EF5350",afternoon:"#FCD34D",evening:"#F97316",night:"#818CF8"};
const EQ_MOODS=[
  {key:"sleep",   label:"SLEEP"},
  {key:"focus",   label:"FOCUS"},
  {key:"stress",  label:"STRESS"},
  {key:"momentum",label:"MOMENTUM"},
  {key:"clarity", label:"CLARITY"},
];
const DEFAULT_BLOCK_TIMES={morning:"05:00",afternoon:"12:00",evening:"17:00",night:"21:00"};
const defaultEq=()=>({sleep:0,focus:0,stress:0,momentum:0,clarity:0});

function playBlockChime(block){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const master=ctx.createGain();master.connect(ctx.destination);
    const note=(freq,t,dur,type="sine",vol=0.2)=>{
      const o=ctx.createOscillator();const g=ctx.createGain();
      o.connect(g);g.connect(master);o.type=type;
      o.frequency.setValueAtTime(freq,t);
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(vol,t+0.025);
      g.gain.exponentialRampToValueAtTime(0.001,t+dur);
      o.start(t);o.stop(t+dur+0.05);
    };
    const n=ctx.currentTime;
    if(block==="morning"){note(523.25,n,0.55,"triangle",0.22);note(659.25,n+0.18,0.55,"triangle",0.22);note(783.99,n+0.36,0.9,"triangle",0.26);}
    else if(block==="afternoon"){note(392.00,n,0.45,"sine",0.18);note(523.25,n+0.22,0.85,"sine",0.22);}
    else if(block==="evening"){note(392.00,n,0.5,"sine",0.18);note(329.63,n+0.22,0.5,"sine",0.16);note(261.63,n+0.44,1.1,"sine",0.18);}
    else{note(130.81,n,2.2,"sine",0.14);note(196.00,n+0.06,2.2,"sine",0.07);}
    setTimeout(()=>ctx.close(),4000);
  }catch(e){}
}

function getBlockFromTimes(times){
  const t=times||DEFAULT_BLOCK_TIMES;
  const now=new Date();const mins=now.getHours()*60+now.getMinutes();
  const m=(s)=>{const[h,mn]=(s||"00:00").split(":").map(Number);return h*60+mn;};
  const mo=m(t.morning),af=m(t.afternoon),ev=m(t.evening),ni=m(t.night);
  if(mins>=mo&&mins<af)return"morning";
  if(mins>=af&&mins<ev)return"afternoon";
  if(mins>=ev&&mins<ni)return"evening";
  return"night";
}

// VU-meter gradient anchored to bottom — same palette as decorative EQ_BANDS
const VU_FILL="linear-gradient(to top,#3B5BDB 0%,#0097A7 25%,#EF5350 55%,#F97316 78%,#EF5350 100%)";
const VU_GHOST="linear-gradient(to top,rgba(59,91,219,0.13) 0%,rgba(0,151,167,0.1) 25%,rgba(239,83,80,0.08) 55%,rgba(249,115,22,0.07) 78%,rgba(239,83,80,0.06) 100%)";
function vuKnobColor(v){
  if(v===0)return"rgba(255,255,255,0.08)";
  const p=v/5;
  if(p<=0.25)return"#3B5BDB";
  if(p<=0.55)return"#0097A7";
  if(p<=0.78)return"#EF5350";
  if(p<=0.9)return"#F97316";
  return"#EF5350";
}
// Canvas rounded-rect helper
function canvasRR(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

// EQFader — Canvas: trading terminal colors, segmented LED meter, metallic handle
function EQFader({label,value,onChange,color}){
  const wrapRef=useRef(null);const cvRef=useRef(null);
  const active=value>0;

  const redraw=useCallback(()=>{
    const cv=cvRef.current;const wrap=wrapRef.current;
    if(!cv||!wrap)return;
    const dpr=window.devicePixelRatio||1;
    const W=wrap.offsetWidth;const H=wrap.offsetHeight;
    if(!W||!H)return;
    cv.width=W*dpr;cv.height=H*dpr;
    cv.style.width=W+'px';cv.style.height=H+'px';
    const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);

    // Background
    ctx.fillStyle='#080c14';ctx.fillRect(0,0,W,H);
    // Subtle horizontal grid lines
    ctx.strokeStyle='rgba(0,180,200,0.05)';ctx.lineWidth=0.5;
    for(let y=0;y<H;y+=H/5){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

    // Layout constants
    const lblH=18,valH=16,aTop=valH+2,aBot=H-lblH-2,aH=aBot-aTop;
    const cx=W/2;

    // ── Segmented LED meter ──
    const segN=20,mW=5,mX=cx-9,segGap=1.5;
    const segH=(aH-segGap*segN)/segN;
    const lit=Math.round((value/5)*segN);
    for(let i=0;i<segN;i++){
      const sy=aBot-(i+1)*(segH+segGap);
      const on=i<lit;
      const sc=i<14?'#00e676':i<18?'#ffb800':'#ff3b3b';
      if(on){ctx.shadowColor=sc;ctx.shadowBlur=8;ctx.fillStyle=sc;}
      else{ctx.shadowBlur=0;ctx.fillStyle='rgba(255,255,255,0.05)';}
      ctx.fillRect(mX,sy,mW,segH);
    }
    ctx.shadowBlur=0;

    // ── Fader track ──
    const tW=5;
    const tg=ctx.createLinearGradient(cx-tW/2,0,cx+tW/2,0);
    tg.addColorStop(0,'rgba(0,0,0,0.9)');tg.addColorStop(0.4,'rgba(0,0,0,0.3)');
    tg.addColorStop(0.6,'rgba(0,0,0,0.3)');tg.addColorStop(1,'rgba(255,255,255,0.07)');
    ctx.fillStyle='#04060c';canvasRR(ctx,cx-tW/2,aTop,tW,aH,2.5);ctx.fill();
    ctx.fillStyle=tg;canvasRR(ctx,cx-tW/2,aTop,tW,aH,2.5);ctx.fill();
    // Track glow below handle
    if(active){
      const hy=aBot-(value/5)*aH;
      const tg2=ctx.createLinearGradient(0,hy,0,aBot);
      tg2.addColorStop(0,color+'99');tg2.addColorStop(1,color+'12');
      ctx.fillStyle=tg2;ctx.fillRect(cx-2,hy,4,aBot-hy);
    }

    // ── Fader handle ──
    const hy=aBot-(value/5)*aH;
    const hW=W*0.8,hH=18,hX=(W-hW)/2;
    ctx.shadowColor='rgba(0,0,0,0.95)';ctx.shadowBlur=14;ctx.shadowOffsetY=5;
    const hg=ctx.createLinearGradient(hX,hy-hH/2,hX,hy+hH/2);
    if(active){
      hg.addColorStop(0,'rgba(245,248,255,0.97)');
      hg.addColorStop(0.10,'rgba(200,210,232,0.92)');
      hg.addColorStop(0.42,'rgba(118,128,155,0.88)');
      hg.addColorStop(0.85,'rgba(52,58,82,0.92)');
      hg.addColorStop(1,'rgba(16,20,36,0.97)');
    }else{
      hg.addColorStop(0,'rgba(100,105,120,0.6)');
      hg.addColorStop(0.5,'rgba(45,48,60,0.55)');
      hg.addColorStop(1,'rgba(14,16,26,0.6)');
    }
    ctx.fillStyle=hg;canvasRR(ctx,hX,hy-hH/2,hW,hH,3);ctx.fill();
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    // Handle border
    ctx.strokeStyle=active?color+'aa':'rgba(255,255,255,0.1)';
    ctx.lineWidth=active?1:0.5;
    canvasRR(ctx,hX,hy-hH/2,hW,hH,3);ctx.stroke();
    // Handle glow
    if(active){
      ctx.shadowColor=color;ctx.shadowBlur=22;
      ctx.strokeStyle=color+'55';ctx.lineWidth=1.5;
      canvasRR(ctx,hX-1,hy-hH/2-1,hW+2,hH+2,4);ctx.stroke();
      ctx.shadowBlur=0;
    }
    // Grip ridges (3 lines)
    for(let g=-1;g<=1;g++){
      const gy=hy+g*4.5;
      ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(hX+hW*0.2,gy,hW*0.6,1);
      ctx.fillStyle='rgba(255,255,255,0.22)';ctx.fillRect(hX+hW*0.2,gy+0.6,hW*0.6,0.5);
    }

    // ── Value readout ──
    ctx.textAlign='center';ctx.textBaseline='middle';
    if(active){
      ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=10;
      ctx.font=`bold 9px monospace`;ctx.fillText(value,W/2,valH/2);ctx.shadowBlur=0;
    }else{
      ctx.fillStyle='rgba(255,255,255,0.1)';ctx.font=`7px monospace`;
      ctx.fillText('—',W/2,valH/2);
    }

    // ── Label strip ──
    ctx.fillStyle=color+'18';ctx.fillRect(0,H-lblH,W,lblH);
    ctx.fillStyle=color;
    if(active){ctx.shadowColor=color;ctx.shadowBlur=6;}
    ctx.fillRect(0,H-lblH,W,2);ctx.shadowBlur=0;
    ctx.fillStyle=active?color:'rgba(255,255,255,0.25)';
    ctx.font=`bold 5.5px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(label.length>4?label.slice(0,3):label,W/2,H-lblH/2);
    ctx.textBaseline='alphabetic';
  },[value,color,label,active]);

  useEffect(()=>{redraw();},[redraw]);
  useEffect(()=>{
    const ro=new ResizeObserver(redraw);
    if(wrapRef.current)ro.observe(wrapRef.current);
    return()=>ro.disconnect();
  },[redraw]);

  const interact=(e)=>{
    e.stopPropagation();
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    const cv=cvRef.current;if(!cv)return;
    const rect=cv.getBoundingClientRect();
    const lblH=18,valH=16,aTop=valH+2,aBot=rect.height-lblH-2;
    const pct=Math.max(0,Math.min(1,1-(clientY-rect.top-aTop)/(aBot-aTop)));
    onChange(Math.round(pct*5));
  };

  return(
    <div ref={wrapRef} style={{flex:1,minWidth:0,minHeight:0,position:'relative',
      borderRight:'1px solid rgba(0,180,200,0.07)'}}>
      <canvas ref={cvRef} onClick={interact} onTouchStart={interact}
        style={{position:'absolute',inset:0,width:'100%',height:'100%',cursor:'pointer'}}/>
    </div>
  );
}

// ─── RadarChart — Canvas: teal terminal grid, glowing polygon, colored data nodes ─
function RadarChart({eq,blockColor}){
  const wrapRef=useRef(null);const cvRef=useRef(null);

  const redraw=useCallback(()=>{
    const cv=cvRef.current;const wrap=wrapRef.current;
    if(!cv||!wrap)return;
    const dpr=window.devicePixelRatio||1;
    const W=wrap.offsetWidth;const H=wrap.offsetHeight;
    if(!W||!H)return;
    cv.width=W*dpr;cv.height=H*dpr;
    cv.style.width=W+'px';cv.style.height=H+'px';
    const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);

    ctx.fillStyle='#080c14';ctx.fillRect(0,0,W,H);

    const cx=W/2,cy=H/2,r=Math.min(W,H)*0.33;
    const ang=(i)=>-Math.PI/2+(2*Math.PI/5)*i;
    const pt=(i,v)=>{const a=ang(i);const rr=(Math.max(0,v)/5)*r;return{x:cx+rr*Math.cos(a),y:cy+rr*Math.sin(a)};};
    const channels=EQ_MOODS.map(m=>m.key);

    // Grid rings
    for(let ring=1;ring<=5;ring++){
      ctx.beginPath();
      for(let i=0;i<5;i++){const p=pt(i,ring);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
      ctx.closePath();
      ctx.strokeStyle=ring===5?'rgba(0,180,200,0.18)':'rgba(0,180,200,0.06)';
      ctx.lineWidth=0.5;ctx.stroke();
    }
    // Spokes
    for(let i=0;i<5;i++){
      const ep=pt(i,5);
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ep.x,ep.y);
      ctx.strokeStyle='rgba(0,180,200,0.08)';ctx.lineWidth=0.5;ctx.stroke();
    }
    // Benchmark polygon
    const bVals=channels.map(ch=>HP_WEEKLY[ch].reduce((a,b)=>a+b,0)/7);
    ctx.beginPath();
    for(let i=0;i<5;i++){const p=pt(i,bVals[i]);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
    ctx.closePath();
    ctx.fillStyle=blockColor+'12';ctx.fill();
    ctx.setLineDash([2,3]);ctx.strokeStyle=blockColor+'40';ctx.lineWidth=0.8;ctx.stroke();
    ctx.setLineDash([]);

    // Live polygon
    const cVals=channels.map(ch=>eq[ch]||0);
    const anyActive=cVals.some(v=>v>0);
    if(anyActive){
      ctx.beginPath();
      for(let i=0;i<5;i++){const p=pt(i,cVals[i]);i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}
      ctx.closePath();
      // Gradient fill
      const rg=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      rg.addColorStop(0,blockColor+'35');rg.addColorStop(1,blockColor+'10');
      ctx.fillStyle=rg;ctx.fill();
      ctx.shadowColor=blockColor;ctx.shadowBlur=10;
      ctx.strokeStyle=blockColor;ctx.lineWidth=1.5;ctx.stroke();
      ctx.shadowBlur=0;
      // Colored channel dots
      channels.forEach((ch,i)=>{
        const v=cVals[i];if(!v)return;
        const p=pt(i,v);const col=CHANNEL_COLORS[ch];
        ctx.shadowColor=col;ctx.shadowBlur=14;
        ctx.fillStyle=col;ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();
        ctx.shadowBlur=0;
      });
    }
    // Axis labels
    ctx.textAlign='center';ctx.textBaseline='middle';
    channels.forEach((ch,i)=>{
      const a=ang(i);
      const lx=cx+(r+11)*Math.cos(a);const ly=cy+(r+11)*Math.sin(a);
      const col=CHANNEL_COLORS[ch];
      ctx.fillStyle=col;
      if(eq[ch]>0){ctx.shadowColor=col;ctx.shadowBlur=8;}
      ctx.font=`bold 5.5px monospace`;
      ctx.fillText(EQ_MOODS[i].label.slice(0,3),lx,ly);
      ctx.shadowBlur=0;
    });
  },[eq,blockColor]);

  useEffect(()=>{redraw();},[redraw]);
  useEffect(()=>{
    const ro=new ResizeObserver(redraw);
    if(wrapRef.current)ro.observe(wrapRef.current);
    return()=>ro.disconnect();
  },[redraw]);

  return(
    <div ref={wrapRef} style={{width:'100%',height:'100%',position:'relative'}}>
      <canvas ref={cvRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
    </div>
  );
}

// ─── MiniSpectral — Canvas: TradingView-style multi-line chart per block ────────
function MiniSpectral({blockKey,history,todayRhythm}){
  const wrapRef=useRef(null);const cvRef=useRef(null);

  const recentData=useMemo(()=>{
    const all=[...history];const today=todayStr();
    const entry={date:today,blocks:todayRhythm};
    const idx=all.findIndex(h=>h.date===today);
    if(idx>=0)all[idx]=entry;else all.push(entry);
    all.sort((a,b)=>a.date<b.date?-1:1);
    return all.slice(-7);
  },[history,todayRhythm]);

  const benchData=useMemo(()=>genBenchmark(7),[]);
  const demoData=useMemo(()=>genDemo(7),[]);
  const bScores=useCallback((arr)=>arr.map(e=>({
    date:e.date,
    scores:Object.fromEntries(EQ_MOODS.map(m=>[m.key,(e.blocks||{})[blockKey]?.eq?.[m.key]||0])),
  })),[blockKey]);
  const realScores=useMemo(()=>bScores(recentData),[recentData,bScores]);
  const benchScores=useMemo(()=>benchData.map(e=>({date:e.date,scores:e.scores})),[benchData]);
  const demoScores=useMemo(()=>bScores(demoData),[demoData,bScores]);
  const hasReal=realScores.some(d=>Object.values(d.scores).some(v=>v>0));
  const display=hasReal?realScores:demoScores;

  const redraw=useCallback(()=>{
    const cv=cvRef.current;const wrap=wrapRef.current;
    if(!cv||!wrap)return;
    const dpr=window.devicePixelRatio||1;
    const W=wrap.offsetWidth;const H=wrap.offsetHeight;
    if(!W||!H)return;
    cv.width=W*dpr;cv.height=H*dpr;
    cv.style.width=W+'px';cv.style.height=H+'px';
    const ctx=cv.getContext('2d');ctx.scale(dpr,dpr);

    ctx.fillStyle='#080c14';ctx.fillRect(0,0,W,H);
    // Grid
    ctx.strokeStyle='rgba(0,180,200,0.06)';ctx.lineWidth=0.5;
    [0.25,0.5,0.75].forEach(f=>{
      ctx.beginPath();ctx.moveTo(0,H*f);ctx.lineTo(W,H*f);ctx.stroke();
      ctx.beginPath();ctx.moveTo(W*f,0);ctx.lineTo(W*f,H);ctx.stroke();
    });

    const mkPts=(arr,ch)=>arr.map((d,i)=>({
      x:arr.length===1?W/2:(i/(arr.length-1))*(W-4)+2,
      y:H-((d.scores[ch]||0)/5)*H*0.83-H*0.06,
    }));

    const drawCurve=(pts)=>{
      if(!pts||pts.length<2)return false;
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=0;i<pts.length-1;i++){
        const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(pts.length-1,i+2)];
        const c1x=p1.x+(p2.x-p0.x)/6,c1y=p1.y+(p2.y-p0.y)/6;
        const c2x=p2.x-(p3.x-p1.x)/6,c2y=p2.y-(p3.y-p1.y)/6;
        ctx.bezierCurveTo(c1x,c1y,c2x,c2y,p2.x,p2.y);
      }
      return true;
    };

    const channels=EQ_MOODS.map(m=>m.key);

    // Area fills under display curves
    channels.forEach(ch=>{
      const p=mkPts(display,ch);const col=CHANNEL_COLORS[ch];
      if(!drawCurve(p))return;
      ctx.lineTo(p[p.length-1].x,H);ctx.lineTo(p[0].x,H);ctx.closePath();
      const ag=ctx.createLinearGradient(0,0,0,H);
      ag.addColorStop(0,col+(hasReal?'38':'12'));ag.addColorStop(0.7,col+'00');
      ctx.fillStyle=ag;ctx.fill();
    });

    // Benchmark dashes
    channels.forEach(ch=>{
      const p=mkPts(benchScores,ch);const col=CHANNEL_COLORS[ch];
      ctx.setLineDash([2,4]);ctx.strokeStyle=col+'40';ctx.lineWidth=0.8;
      if(drawCurve(p))ctx.stroke();ctx.setLineDash([]);
    });

    // Main glowing lines + end-of-line price dots
    channels.forEach(ch=>{
      const p=mkPts(display,ch);const col=CHANNEL_COLORS[ch];
      ctx.shadowColor=col;ctx.shadowBlur=hasReal?12:4;
      ctx.strokeStyle=hasReal?col:col+'44';ctx.lineWidth=hasReal?1.8:0.8;
      if(!drawCurve(p))return;
      ctx.stroke();ctx.shadowBlur=0;
      // End dot + value label
      if(hasReal&&p.length>0){
        const last=p[p.length-1];
        const val=(display[display.length-1]?.scores[ch]||0);
        ctx.shadowColor=col;ctx.shadowBlur=16;
        ctx.fillStyle=col;ctx.beginPath();ctx.arc(last.x,last.y,3,0,Math.PI*2);ctx.fill();
        ctx.shadowBlur=0;
        // Tiny value badge
        ctx.fillStyle=col+'cc';ctx.font=`bold 5.5px monospace`;ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillText(val.toFixed(1),last.x-5,last.y);
      }
    });

    // "DEMO" watermark when no real data
    if(!hasReal){
      ctx.fillStyle='rgba(0,180,200,0.08)';ctx.font=`bold 9px monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('EXAMPLE',W/2,H/2);
    }
  },[display,benchScores,hasReal]);

  useEffect(()=>{redraw();},[redraw]);
  useEffect(()=>{
    const ro=new ResizeObserver(redraw);
    if(wrapRef.current)ro.observe(wrapRef.current);
    return()=>ro.disconnect();
  },[redraw]);

  return(
    <div ref={wrapRef} style={{width:'100%',height:'100%',position:'relative'}}>
      <canvas ref={cvRef} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}/>
    </div>
  );
}

// ─── Insights Panel helpers ───────────────────────────────────────────────────

const CHANNEL_COLORS={sleep:"#818CF8",focus:"#00D4FF",stress:"#FF3B3B",momentum:"#FFB800",clarity:"#00E676"};

// High-performer benchmark — weekly pattern per channel (Sun=0…Sat=6)
// Based on performance research: mid-week peaks, managed stress, strong sleep
const HP_WEEKLY={
  sleep:   [4.5,4.0,4.2,4.5,4.2,3.8,4.8],
  focus:   [3.0,4.0,4.8,4.8,4.2,3.5,2.5],
  stress:  [1.5,2.5,2.2,2.0,2.5,3.0,1.2],
  momentum:[3.2,4.0,4.5,4.8,4.5,3.8,3.5],
  clarity: [3.5,4.2,4.8,4.5,4.2,3.8,3.2],
};

function genBenchmark(n){
  const out=[];
  const now=new Date();
  for(let i=n-1;i>=0;i--){
    const d=new Date(now);d.setDate(d.getDate()-i);
    const dow=d.getDay();
    const scores={};
    Object.keys(HP_WEEKLY).forEach(ch=>{scores[ch]=HP_WEEKLY[ch][dow];});
    out.push({date:d.toISOString().split("T")[0],scores});
  }
  return out;
}

// Ghost demo data — shown transparently when <3 real days exist
const DEMO_WEEKLY={
  sleep:   [3.5,3.2,3.5,3.8,3.5,3.0,4.0],
  focus:   [2.5,3.2,3.8,3.5,3.2,2.8,2.0],
  stress:  [2.0,3.0,2.8,2.5,3.0,3.5,1.5],
  momentum:[2.8,3.5,3.8,4.0,3.8,3.2,3.0],
  clarity: [3.0,3.5,4.0,3.8,3.5,3.0,2.8],
};
function genDemo(n){
  const out=[];const now=new Date();
  for(let i=n-1;i>=0;i--){
    const d=new Date(now);d.setDate(d.getDate()-i);
    const dow=d.getDay();
    const scores={};
    Object.keys(DEMO_WEEKLY).forEach(ch=>{scores[ch]=DEMO_WEEKLY[ch][dow];});
    out.push({date:d.toISOString().split("T")[0],scores});
  }
  return out;
}

// Smooth SVG path through data points using Catmull-Rom → cubic bezier
function smoothPath(pts){
  if(!pts||pts.length<2)return pts&&pts.length===1?`M${pts[0].x},${pts[0].y}`:"";
  let d=`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(0,i-1)],p1=pts[i],p2=pts[i+1],p3=pts[Math.min(pts.length-1,i+2)];
    const cp1x=p1.x+(p2.x-p0.x)/6,cp1y=p1.y+(p2.y-p0.y)/6;
    const cp2x=p2.x-(p3.x-p1.x)/6,cp2y=p2.y-(p3.y-p1.y)/6;
    d+=` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function makeSvgPoints(dataArr,channel,vW,vH){
  if(!dataArr||dataArr.length===0)return[];
  return dataArr.map((d,i)=>({
    x:(dataArr.length===1?vW/2:(i/(dataArr.length-1))*vW),
    y:vH-(((d.scores||{})[channel]||0)/5)*vH*0.82-vH*0.08,
  }));
}

function areaPath(pts,vH){
  if(!pts||pts.length<2)return"";
  const line=smoothPath(pts);
  const last=pts[pts.length-1];
  const first=pts[0];
  return`${line} L${last.x.toFixed(1)},${vH} L${first.x.toFixed(1)},${vH} Z`;
}

// Compute daily composite score from rhythm blocks filtered by blockFilter
function computeDailyScores(historyArr,todayEntry,blockFilter,timeFilter){
  const cutoffMs=Date.now()-timeFilter*24*60*60*1000;
  const allEntries=[...historyArr.filter(h=>new Date(h.date).getTime()>=cutoffMs)];
  // merge or add today
  if(todayEntry){
    const idx=allEntries.findIndex(h=>h.date===todayEntry.date);
    if(idx>=0)allEntries[idx]=todayEntry;else allEntries.push(todayEntry);
  }
  allEntries.sort((a,b)=>a.date<b.date?-1:1);

  const blockKeys=
    blockFilter==="all"?["morning","afternoon","evening","night"]:
    blockFilter==="ampm"?["morning","afternoon"]:
    blockFilter==="evenight"?["evening","night"]:
    [blockFilter];

  return allEntries.map(entry=>{
    const scores={sleep:0,focus:0,stress:0,momentum:0,clarity:0};
    let count=0;
    blockKeys.forEach(bk=>{
      const eq=(entry.blocks||{})[bk]?.eq||{};
      if(Object.values(eq).some(v=>v>0)){
        EQ_MOODS.forEach(m=>{scores[m.key]+=(eq[m.key]||0);});
        count++;
      }
    });
    if(count>0)EQ_MOODS.forEach(m=>{scores[m.key]=+(scores[m.key]/count).toFixed(2);});
    return{date:entry.date,scores};
  });
}

// ─── InsightsPanel ────────────────────────────────────────────────────────────
function InsightsPanel({onClose,history,todayRhythm}){
  const isMobile=window.innerWidth<768;
  const[blockFilter,setBlockFilter]=useState("all");
  const[timeFilter,setTimeFilter]=useState(7);

  // Inject breathing animation CSS once
  useEffect(()=>{
    const id="eq-insight-anim";
    if(!document.getElementById(id)){
      const s=document.createElement("style");s.id=id;
      s.textContent=`
        @keyframes wvBreathe{0%,100%{opacity:1}50%{opacity:0.72}}
        @keyframes wvBreatheB{0%,100%{opacity:0.42}50%{opacity:0.26}}
        @keyframes wvBreatheD{0%,100%{opacity:0.22}50%{opacity:0.13}}
        @keyframes cellIn{from{opacity:0;transform:scaleY(0.4)}to{opacity:1;transform:scaleY(1)}}
        @keyframes barIn{from{transform:scaleY(0)}to{transform:scaleY(1)}}
      `;
      document.head.appendChild(s);
    }
  },[]);

  const todayEntry=useMemo(()=>({date:todayStr(),blocks:todayRhythm}),[todayRhythm]);
  const dailyScores=useMemo(()=>computeDailyScores(history,todayEntry,blockFilter,timeFilter),[history,todayEntry,blockFilter,timeFilter]);
  const benchmark=useMemo(()=>genBenchmark(timeFilter),[timeFilter]);
  const demo=useMemo(()=>genDemo(timeFilter),[timeFilter]);

  const realDays=dailyScores.filter(d=>Object.values(d.scores).some(v=>v>0)).length;
  const showDemo=realDays<3;

  // ── Spectral wave SVG ─────────────────────────────────────────────────────
  const WV_W=560,WV_H=130;
  const spectralData=showDemo?demo:dailyScores;

  // ── Channel bar history (last 7 per channel) ───────────────────────────────
  const barData=useMemo(()=>dailyScores.slice(-7),[dailyScores]);

  // ── Heatmap (blocks × days, last 14) ──────────────────────────────────────
  const hmDays=useMemo(()=>{
    const cutoff=Date.now()-14*24*60*60*1000;
    const all=[...history.filter(h=>new Date(h.date).getTime()>=cutoff)];
    if(todayEntry){const idx=all.findIndex(h=>h.date===todayEntry.date);if(idx>=0)all[idx]=todayEntry;else all.push(todayEntry);}
    all.sort((a,b)=>a.date<b.date?-1:1);
    return all.slice(-14);
  },[history,todayEntry]);

  const hmBlockScore=(entry,bk)=>{
    const eq=entry?.blocks?.[bk]?.eq||{};
    const vals=Object.values(eq).filter(v=>v>0);
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
  };

  // ── Insights (threshold detection) ────────────────────────────────────────
  const insights=useMemo(()=>{
    const msgs=[];
    if(dailyScores.length<2)return["Check in each block to start building your performance pattern.","Your data grows every time you set your faders.","After 7 days your first trends will emerge."];
    const recent=dailyScores.slice(-5);
    const avg=ch=>recent.reduce((s,d)=>s+(d.scores[ch]||0),0)/recent.length;
    const sleepAvg=avg("sleep"),focusAvg=avg("focus"),stressAvg=avg("stress"),momAvg=avg("momentum"),clarAvg=avg("clarity");

    if(stressAvg>=3.5)msgs.push(`Stress is running high (avg ${stressAvg.toFixed(1)}/5). Watch for burnout — protect your recovery time.`);
    else if(stressAvg<=1.5)msgs.push(`Stress is well managed (avg ${stressAvg.toFixed(1)}/5). You're in a sustainable rhythm.`);

    if(focusAvg>=4)msgs.push(`Focus is peaking this period (avg ${focusAvg.toFixed(1)}/5). Schedule your most important work now.`);
    else if(focusAvg<=2)msgs.push(`Focus is low (avg ${focusAvg.toFixed(1)}/5). Consider simplifying your day and reducing context switching.`);

    if(sleepAvg<=2&&sleepAvg>0)msgs.push(`Sleep ratings are low (avg ${sleepAvg.toFixed(1)}/5). This correlates with every other channel — prioritize rest.`);
    else if(sleepAvg>=4)msgs.push(`Strong sleep scores (avg ${sleepAvg.toFixed(1)}/5) — your foundation is solid.`);

    if(momAvg>=4)msgs.push(`Momentum is strong (avg ${momAvg.toFixed(1)}/5). You're in a winning streak — double down.`);
    else if(momAvg<=2&&momAvg>0)msgs.push(`Momentum is sluggish (avg ${momAvg.toFixed(1)}/5). Identify one blocker to remove this week.`);

    if(clarAvg>=4)msgs.push(`Clarity is high (avg ${clarAvg.toFixed(1)}/5). Good time for strategic decisions.`);
    if(msgs.length===0)msgs.push(`You're tracking consistently. Keep checking in — patterns emerge after 7 days.`);
    return msgs.slice(0,3);
  },[dailyScores]);

  const BLOCKS_META=[
    {key:"morning",label:"Morning",color:BLOCK_COLORS.morning},
    {key:"afternoon",label:"Afternoon",color:BLOCK_COLORS.afternoon},
    {key:"evening",label:"Evening",color:BLOCK_COLORS.evening},
    {key:"night",label:"Night",color:BLOCK_COLORS.night},
  ];

  const blockFilters=[
    {v:"all",    label:"ALL"},
    {v:"morning",label:"AM"},
    {v:"afternoon",label:"PM"},
    {v:"evening",label:"EVE"},
    {v:"night",  label:"NIGHT"},
    {v:"ampm",   label:"AM+PM"},
    {v:"evenight",label:"EVE+NIGHT"},
  ];

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:8000,background:"rgba(0,0,0,0.88)",display:"flex",flexDirection:"column",overflowY:"auto"}}>
      {/* Header */}
      <div style={{flexShrink:0,padding:isMobile?"16px 18px 12px":"20px 28px 14px",
        background:"linear-gradient(135deg,#12192b,#1c1408 60%,#1a2744)",
        borderBottom:"1px solid rgba(239,83,80,0.15)",display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?22:28,fontWeight:800,color:"#EF5350",letterSpacing:-0.5,lineHeight:1}}>performance insights.</div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,marginTop:3,letterSpacing:1}}>
              {realDays} DAY{realDays!==1?"S":""} OF DATA{showDemo?" · SHOWING EXAMPLE DATA":""}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:"rgba(239,83,80,0.18)",border:"1px solid rgba(239,83,80,0.4)",color:"#EF5350",borderRadius:9,padding:"8px 14px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>✕</button>
        </div>
        {/* Controls */}
        <div style={{display:"flex",gap:isMobile?8:16,flexWrap:"wrap",alignItems:"center"}}>
          {/* Block filter */}
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {blockFilters.map(f=>(
              <button key={f.v} onClick={()=>setBlockFilter(f.v)}
                style={{background:blockFilter===f.v?"rgba(239,83,80,0.25)":"rgba(255,255,255,0.06)",
                  border:`1px solid ${blockFilter===f.v?"rgba(239,83,80,0.6)":"rgba(255,255,255,0.1)"}`,
                  color:blockFilter===f.v?"#EF5350":"rgba(255,255,255,0.45)",
                  borderRadius:6,padding:"4px 8px",fontSize:9,fontFamily:FONT_MONO,cursor:"pointer",letterSpacing:0.5,transition:"all 0.15s"}}>
                {f.label}
              </button>
            ))}
          </div>
          {/* Time filter */}
          <div style={{display:"flex",gap:4}}>
            {[7,14,30,90].map(d=>(
              <button key={d} onClick={()=>setTimeFilter(d)}
                style={{background:timeFilter===d?"rgba(59,91,219,0.3)":"rgba(255,255,255,0.06)",
                  border:`1px solid ${timeFilter===d?"rgba(59,91,219,0.8)":"rgba(255,255,255,0.1)"}`,
                  color:timeFilter===d?"#818CF8":"rgba(255,255,255,0.45)",
                  borderRadius:6,padding:"4px 8px",fontSize:9,fontFamily:FONT_MONO,cursor:"pointer",letterSpacing:0.5,transition:"all 0.15s"}}>
                {d}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body — 4 quadrants */}
      <div style={{flex:1,padding:isMobile?"12px":"20px 24px",
        display:"grid",
        gridTemplateColumns:isMobile?"1fr":"1fr 1fr",
        gridTemplateRows:isMobile?"auto":"1fr 1fr",
        gap:isMobile?12:16,
        minHeight:isMobile?"auto":0}}>

        {/* ① Spectral wave — hero */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,border:"1px solid rgba(255,255,255,0.07)",
          padding:"16px 14px 12px",display:"flex",flexDirection:"column",gap:8,
          gridColumn:isMobile?"1":"1",gridRow:isMobile?"auto":"1"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:9,fontFamily:FONT_MONO,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>SPECTRAL · {timeFilter}D</div>
            <div style={{display:"flex",gap:8}}>
              {EQ_MOODS.map(m=>(
                <div key={m.key} style={{display:"flex",alignItems:"center",gap:3}}>
                  <div style={{width:8,height:2,borderRadius:1,background:CHANNEL_COLORS[m.key]}}/>
                  <span style={{fontSize:7,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO}}>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
          <svg viewBox={`0 0 ${WV_W} ${WV_H}`} style={{width:"100%",height:isMobile?100:130}} preserveAspectRatio="none">
            {/* Ghost demo overlay */}
            {showDemo&&EQ_MOODS.map(m=>{
              const pts=makeSvgPoints(demo,m.key,WV_W,WV_H);
              return<path key={m.key} d={smoothPath(pts)} fill="none" stroke={CHANNEL_COLORS[m.key]}
                strokeWidth={1.5} strokeOpacity={0.18} style={{animation:"wvBreatheD 5s ease-in-out infinite"}}/>;
            })}
            {/* Benchmark curves — dashed */}
            {EQ_MOODS.map(m=>{
              const pts=makeSvgPoints(benchmark,m.key,WV_W,WV_H);
              return<path key={m.key} d={smoothPath(pts)} fill="none" stroke={CHANNEL_COLORS[m.key]}
                strokeWidth={1} strokeOpacity={0.35} strokeDasharray="4 4"
                style={{animation:"wvBreatheB 4.5s ease-in-out infinite"}}/>;
            })}
            {/* Real data curves */}
            {EQ_MOODS.map((m,mi)=>{
              const pts=makeSvgPoints(dailyScores,m.key,WV_W,WV_H);
              if(pts.length<2)return null;
              return<path key={m.key} d={smoothPath(pts)} fill="none" stroke={CHANNEL_COLORS[m.key]}
                strokeWidth={2} style={{animation:`wvBreathe ${3.8+mi*0.3}s ease-in-out infinite`}}/>;
            })}
          </svg>
          {showDemo&&(
            <div style={{fontSize:8,color:"rgba(255,255,255,0.2)",fontFamily:FONT_MONO,textAlign:"center",letterSpacing:0.5}}>
              EXAMPLE DATA — CHECK IN TO BUILD YOUR CURVE
            </div>
          )}
          {!showDemo&&(
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:8,color:"rgba(255,255,255,0.2)",fontFamily:FONT_MONO}}>{dailyScores[0]?.date||""}</span>
              <span style={{fontSize:8,color:"rgba(239,83,80,0.5)",fontFamily:FONT_MONO,letterSpacing:0.5}}>─ ─ HIGH PERFORMER BENCHMARK</span>
              <span style={{fontSize:8,color:"rgba(255,255,255,0.2)",fontFamily:FONT_MONO}}>TODAY</span>
            </div>
          )}
        </div>

        {/* ② Channel bars */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,border:"1px solid rgba(255,255,255,0.07)",
          padding:"16px 14px 12px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:9,fontFamily:FONT_MONO,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>CHANNEL HISTORY · LAST 7 DAYS</div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:8,justifyContent:"space-around"}}>
            {EQ_MOODS.map(m=>{
              const col=CHANNEL_COLORS[m.key];
              const vals=barData.map(d=>(d.scores[m.key]||0));
              const peak=Math.max(...vals,0);
              const hpAvg=HP_WEEKLY[m.key].reduce((a,b)=>a+b,0)/7;
              return(
                <div key={m.key} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontSize:7,color:col,fontFamily:FONT_MONO,width:52,flexShrink:0,letterSpacing:0.3}}>{m.label}</div>
                  <div style={{flex:1,display:"flex",alignItems:"flex-end",gap:3,height:28,position:"relative"}}>
                    {/* HP benchmark line */}
                    <div style={{position:"absolute",left:0,right:0,bottom:`${(hpAvg/5)*100}%`,
                      height:1,borderTop:`1px dashed ${col}55`,pointerEvents:"none"}}/>
                    {vals.map((v,i)=>(
                      <div key={i} style={{flex:1,height:`${(v/5)*100}%`,minHeight:v>0?2:0,
                        background:v>0?`linear-gradient(to top,${col}99,${col})`:"rgba(255,255,255,0.06)",
                        borderRadius:"2px 2px 0 0",
                        transformOrigin:"bottom",
                        animation:v>0?"barIn 0.4s ease-out both":"none",
                        animationDelay:`${i*0.06}s`}}/>
                    ))}
                    {/* Peak hold */}
                    {peak>0&&<div style={{position:"absolute",left:0,right:0,bottom:`${(peak/5)*100}%`,
                      height:1.5,background:col,opacity:0.6,pointerEvents:"none"}}/>}
                  </div>
                  <div style={{fontSize:8,color:col,fontFamily:FONT_MONO,width:16,textAlign:"right",flexShrink:0}}>
                    {barData[barData.length-1]?.scores[m.key]>0?barData[barData.length-1].scores[m.key].toFixed(1):"—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ③ Block heatmap */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,border:"1px solid rgba(255,255,255,0.07)",
          padding:"16px 14px 12px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:9,fontFamily:FONT_MONO,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>BLOCK HEATMAP · 14 DAYS</div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:5,justifyContent:"space-around"}}>
            {BLOCKS_META.map(bm=>(
              <div key={bm.key} style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:7,color:bm.color,fontFamily:FONT_MONO,width:28,flexShrink:0}}>{bm.label.slice(0,3).toUpperCase()}</div>
                <div style={{flex:1,display:"flex",gap:2}}>
                  {hmDays.map((entry,i)=>{
                    const score=hmBlockScore(entry,bm.key);
                    const intensity=score/5;
                    return(
                      <div key={i} title={`${entry.date}: ${score.toFixed(1)}`}
                        style={{flex:1,height:16,borderRadius:2,
                          background:score>0?`${bm.color}${Math.round(intensity*200+30).toString(16).padStart(2,"0")}`:"rgba(255,255,255,0.04)",
                          animation:"cellIn 0.3s ease-out both",
                          animationDelay:`${i*0.03}s`}}/>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <span style={{fontSize:7,color:"rgba(255,255,255,0.18)",fontFamily:FONT_MONO}}>14 DAYS AGO</span>
            <span style={{fontSize:7,color:"rgba(255,255,255,0.18)",fontFamily:FONT_MONO}}>TODAY</span>
          </div>
        </div>

        {/* ④ Insights card */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:16,border:"1px solid rgba(239,83,80,0.12)",
          padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{fontSize:9,fontFamily:FONT_MONO,color:"rgba(255,255,255,0.35)",letterSpacing:1}}>PERFORMANCE SIGNALS</div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:14,justifyContent:"center"}}>
            {insights.map((msg,i)=>(
              <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:["#EF5350","#3B5BDB","#0097A7"][i],flexShrink:0,marginTop:3}}/>
                <div style={{fontSize:11,color:"rgba(255,255,255,0.75)",fontFamily:FONT,lineHeight:1.6}}>{msg}</div>
              </div>
            ))}
          </div>
          {realDays>0&&(
            <div style={{fontSize:8,color:"rgba(255,255,255,0.15)",fontFamily:FONT_MONO,borderTop:"1px solid rgba(255,255,255,0.06)",paddingTop:8,letterSpacing:0.5}}>
              BASED ON {realDays} CHECK-IN{realDays!==1?"S":""}
            </div>
          )}
        </div>

      </div>
    </div>,document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const BLOCKS_META=[
  {key:"morning",label:"Morning",color:BLOCK_COLORS.morning},
  {key:"afternoon",label:"Afternoon",color:BLOCK_COLORS.afternoon},
  {key:"evening",label:"Evening",color:BLOCK_COLORS.evening},
  {key:"night",label:"Night",color:BLOCK_COLORS.night},
];

function DailySheetCard({authToken}){
  const isMobile=window.innerWidth<768;
  const[open,setOpen]=useState(false);
  const[showSettings,setShowSettings]=useState(false);
  const[showInsights,setShowInsights]=useState(false);
  const[editingTime,setEditingTime]=useState(null);
  const[chimeToast,setChimeToast]=useState(null);
  const[liveQuotes,setLiveQuotes]=useState(null);
  const[quoteFade,setQuoteFade]=useState(true);
  const[quoteIdx,setQuoteIdx]=useState(()=>Math.floor(Math.random()*RHYTHM_QUOTES.length));
  const activeQuotes=liveQuotes||RHYTHM_QUOTES;
  useEffect(()=>{const h=()=>setOpen(false);window.addEventListener("closeRhythm",h);return()=>window.removeEventListener("closeRhythm",h);},[]);
  useEffect(()=>{
    const id="eq-card-anim";
    if(!document.getElementById(id)){
      const s=document.createElement("style");s.id=id;
      s.textContent=`
        @keyframes wvBreathe{0%,100%{opacity:1}50%{opacity:0.72}}
        @keyframes wvBreatheB{0%,100%{opacity:0.42}50%{opacity:0.26}}
        @keyframes wvBreatheD{0%,100%{opacity:0.22}50%{opacity:0.13}}
        @keyframes cellIn{from{opacity:0;transform:scaleY(0.4)}to{opacity:1;transform:scaleY(1)}}
        @keyframes barIn{from{transform:scaleY(0)}to{transform:scaleY(1)}}
      `;
      document.head.appendChild(s);
    }
  },[]);
  useEffect(()=>{
    const t=setInterval(()=>{setQuoteFade(false);setTimeout(()=>{setQuoteIdx(i=>(i+1)%RHYTHM_QUOTES.length);setQuoteFade(true);},900);},9000);
    return()=>clearInterval(t);
  },[activeQuotes.length]);

  // Block times — user-editable
  const[blockTimes,setBlockTimes]=useState(()=>{try{return JSON.parse(localStorage.getItem("dws_block_times")||"null")||DEFAULT_BLOCK_TIMES;}catch{return DEFAULT_BLOCK_TIMES;}});
  const saveBlockTimes=(bt)=>{setBlockTimes(bt);try{localStorage.setItem("dws_block_times",JSON.stringify(bt));}catch{}};
  const fmtBlockTime=(key)=>{const t=blockTimes[key]||DEFAULT_BLOCK_TIMES[key];const[h,m]=t.split(":").map(Number);const ampm=h>=12?"pm":"am";return`${h%12||12}:${String(m).padStart(2,"0")}${ampm}`;};

  // Rhythm data — eq + optional note per block
  const migrateBlock=(b)=>{
    if(!b)return{eq:defaultEq(),note:""};
    if(Array.isArray(b))return{eq:defaultEq(),note:""};
    const m=b;
    // Migrate old keys to new 5-channel schema — old values discarded gracefully
    const eq={...defaultEq(),...(m.eq||{})};
    // strip any old keys not in new schema
    Object.keys(eq).forEach(k=>{if(!defaultEq().hasOwnProperty(k))delete eq[k];});
    return{eq,note:m.note||""};
  };
  const[rhythm,setRhythm]=useState(()=>{
    try{const s=JSON.parse(localStorage.getItem("dws_rhythm")||"null");if(s&&s.date===todayStr()){const bl=s.blocks;return{morning:migrateBlock(bl.morning),afternoon:migrateBlock(bl.afternoon),evening:migrateBlock(bl.evening),night:migrateBlock(bl.night)};}}catch{}
    return{morning:{eq:defaultEq(),note:""},afternoon:{eq:defaultEq(),note:""},evening:{eq:defaultEq(),note:""},night:{eq:defaultEq(),note:""}};
  });
  const[history,setHistory]=useState(()=>{try{return JSON.parse(localStorage.getItem("dws_rhythm_history")||"[]");}catch{return[];}});

  const saveRhythm=(r)=>{
    setRhythm(r);
    try{
      localStorage.setItem("dws_rhythm",JSON.stringify({date:todayStr(),blocks:r}));
      // Append/update 30-day history
      const hist=[...history];
      const today=todayStr();
      const idx=hist.findIndex(h=>h.date===today);
      const entry={date:today,blocks:r};
      if(idx>=0)hist[idx]=entry;else hist.push(entry);
      hist.sort((a,b)=>a.date<b.date?-1:1);
      const trimmed=hist.slice(-30);
      setHistory(trimmed);
      localStorage.setItem("dws_rhythm_history",JSON.stringify(trimmed));
    }catch{}
  };
  const setEqLevel=(block,key,val)=>{const b=rhythm[block];saveRhythm({...rhythm,[block]:{...b,eq:{...b.eq,[key]:val}}});};
  const setNote=(block,val)=>{const b=rhythm[block];saveRhythm({...rhythm,[block]:{...b,note:val}});};

  const currentBlock=getBlockFromTimes(blockTimes);
  const prevBlockRef=useRef(currentBlock);
  // Block transition detection — chime + toast
  useEffect(()=>{
    const id=setInterval(()=>{
      const nb=getBlockFromTimes(blockTimes);
      if(nb!==prevBlockRef.current){
        prevBlockRef.current=nb;
        playBlockChime(nb);
        const labels={morning:"Morning just started. Set your intentions. 🌅",afternoon:"Afternoon check-in. How's your rhythm? ☀️",evening:"Evening is here. Reflect on your day. 🌆",night:"Night mode. Wind down and recharge. 🌙"};
        setChimeToast(labels[nb]);
        setTimeout(()=>setChimeToast(null),6000);
      }
    },15000);// check every 15s for dev; use 60000 for prod
    return()=>clearInterval(id);
  },[blockTimes]);

  const dateLabel=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  const BLOCKS=[
    {key:"morning",label:"Morning",icon:"🌅"},
    {key:"afternoon",label:"Afternoon",icon:"☀️"},
    {key:"evening",label:"Evening",icon:"🌆"},
    {key:"night",label:"Night",icon:"🌙"},
  ];
  const checkedIn=BLOCKS.filter(b=>{const eq=rhythm[b.key].eq||{};return Object.values(eq).some(v=>v>0);}).length;
  const bell=(cx,width,viewH=80)=>{const pts=[];for(let i=0;i<=60;i++){const x=cx-width/2+(i/60)*width;const t=(x-cx)/(width/3.5);pts.push(`${x} ${viewH-viewH*0.92*Math.exp(-t*t)}`);}return`M${cx-width/2} ${viewH} L${pts.join(" L")} L${cx+width/2} ${viewH} Z`;};


  // ── Planner state ─────────────────────────────────────────────
  const[tab,setTab]=useState("today");
  const SK_PRIORITIES="dws_rhythm_priorities";
  const SK_SCHEDULE="dws_rhythm_schedule";
  const SK_CATEGORIES="dws_rhythm_categories";
  const SK_HABITS="dws_rhythm_habits";
  const SK_HABIT_CHECKS="dws_rhythm_habit_checks";
  const DEFAULT_SCHEDULE=Array.from({length:19},(_,i)=>{const h=5+i;return{time:String(h).padStart(2,"0")+":00",label:""};});
  const DEFAULT_CATEGORIES=[{key:"health",label:"Health & Fitness",value:""},{key:"dev",label:"Personal Development",value:""},{key:"family",label:"Family & Friends",value:""},{key:"romance",label:"Romance",value:""},{key:"finance",label:"Finance",value:""},{key:"fun",label:"Fun & Recreation",value:""},{key:"spiritual",label:"Spiritual",value:""},{key:"career",label:"Career",value:""}];
  const DEFAULT_HABITS=["Gym","Read","Meditate","Journal","Walk","Water"].map(n=>({name:n}));
  const DAYS=["M","T","W","T","F","S","S"];
  const plannerTodayKey=()=>todayStr();
  const plannerWeekKey=()=>{const d=new Date();const day=d.getDay()||7;d.setDate(d.getDate()-day+1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;};
  const plannerLoad=(key,def)=>{try{const v=JSON.parse(localStorage.getItem(key));return v??def;}catch{return def;}};
  const[priorities,setPriorities]=useState(()=>{const s=plannerLoad(SK_PRIORITIES,null);if(s&&s.date===plannerTodayKey())return s.items;return["","",""];});
  const[schedule,setSchedule]=useState(()=>plannerLoad(SK_SCHEDULE,DEFAULT_SCHEDULE));
  const[categories,setCategories]=useState(()=>plannerLoad(SK_CATEGORIES,DEFAULT_CATEGORIES));
  const[habits,setHabits]=useState(()=>plannerLoad(SK_HABITS,DEFAULT_HABITS));
  const[checks,setChecks]=useState(()=>{const s=plannerLoad(SK_HABIT_CHECKS,null);if(s&&s.week===plannerWeekKey())return s.data;return{};});
  const[editingTimeIdx,setEditingTimeIdx]=useState(null);
  const nowHour=new Date().getHours();
  const savePriorities=(p)=>{setPriorities(p);localStorage.setItem(SK_PRIORITIES,JSON.stringify({date:plannerTodayKey(),items:p}));};
  const saveSchedule=(s)=>{setSchedule(s);localStorage.setItem(SK_SCHEDULE,JSON.stringify(s));};
  const saveCategories=(c)=>{setCategories(c);localStorage.setItem(SK_CATEGORIES,JSON.stringify(c));};
  const saveHabits=(h)=>{setHabits(h);localStorage.setItem(SK_HABITS,JSON.stringify(h));};
  const saveChecks=(c)=>{setChecks(c);localStorage.setItem(SK_HABIT_CHECKS,JSON.stringify({week:plannerWeekKey(),data:c}));};
  const toggleCheck=(hi,di)=>{const key=hi+"-"+di;saveChecks({...checks,[key]:!checks[key]});};
  const updateScheduleSlot=(i,field,val)=>saveSchedule(schedule.map((s,idx)=>idx===i?{...s,[field]:val}:s));
  const updateCategory=(i,val)=>saveCategories(categories.map((c,idx)=>idx===i?{...c,value:val}:c));
  const updateHabitName=(i,val)=>saveHabits(habits.map((h,idx)=>idx===i?{...h,name:val}:h));
  const tabBtn=(active)=>({padding:"8px 20px",borderRadius:20,border:"none",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:1,transition:"all 0.15s",background:active?"#EF5350":"rgba(255,255,255,0.05)",color:active?"#080c14":"rgba(255,255,255,0.4)"});
  const inp=()=>({background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,padding:"9px 12px",color:"rgba(255,255,255,0.85)",fontSize:13,fontFamily:FONT,outline:"none",width:"100%",boxSizing:"border-box",caretColor:"#EF5350"});

  // Drive sync — read on auth, write on change or auth (debounced)
  const rhythmSaveTimer=useRef(null);
  const isFirstAuth=useRef(true);
  useEffect(()=>{
    if(!authToken)return;
    // On auth: read first, then write existing local data after 5s (gives read time to finish)
    driveReadRhythm(authToken).then(d=>{
      if(d){
        if(d.priorities&&d.priorities.date===plannerTodayKey())setPriorities(d.priorities.items);
        if(d.schedule)setSchedule(d.schedule);
        if(d.categories)setCategories(d.categories);
        if(d.habits)setHabits(d.habits);
        if(d.checks&&d.checks.week===plannerWeekKey())setChecks(d.checks.data);
      } else {
        // No Drive file yet — push local data up now
        driveWriteRhythm(authToken,{
          priorities:{date:plannerTodayKey(),items:priorities},
          schedule,categories,habits,
          checks:{week:plannerWeekKey(),data:checks},
        });
      }
    });
  },[authToken]);
  useEffect(()=>{
    if(!authToken)return;
    clearTimeout(rhythmSaveTimer.current);
    rhythmSaveTimer.current=setTimeout(()=>{
      driveWriteRhythm(authToken,{
        priorities:{date:plannerTodayKey(),items:priorities},
        schedule,categories,habits,
        checks:{week:plannerWeekKey(),data:checks},
      });
    },3000);
    return()=>clearTimeout(rhythmSaveTimer.current);
  },[priorities,schedule,categories,habits,checks]);

  return(
    <>
    {/* Block transition toast */}
    {chimeToast&&createPortal(
      <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",zIndex:9999,background:"linear-gradient(135deg,#1c1408,#1a2744)",border:"1px solid rgba(239,83,80,0.4)",borderRadius:14,padding:"12px 20px",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",animation:"fadeSlideIn 0.3s ease-out",whiteSpace:"nowrap"}}>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.9)",fontFamily:FONT,fontWeight:600}}>{chimeToast}</div>
      </div>,document.body
    )}
    <div style={{borderRadius:20,overflow:"hidden",boxShadow:"0 8px 40px rgba(0,0,0,0.35),0 0 0 1px rgba(239,83,80,0.15)",cursor:open?"default":"pointer"}}
      onClick={()=>setOpen(true)}>
      {/* Collapsed header */}
      <div style={{position:"relative",background:"linear-gradient(135deg,#12192b 0%,#1c1408 55%,#1a2744 100%)",padding:isMobile?"14px 16px 28px":"16px 20px 32px",overflow:"hidden"}}>
        <svg style={{position:"absolute",bottom:0,left:0,width:"100%",height:"100%",pointerEvents:"none"}} viewBox="0 0 620 80" preserveAspectRatio="xMidYMax slice">
          <defs>{EQ_BANDS.map((b,i)=>(<linearGradient key={i} id={`eqg${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={b.color.replace(/[\d.]+\)$/,"0.95)")}/><stop offset="100%" stopColor={b.color.replace(/[\d.]+\)$/,"0.1)")}/></linearGradient>))}</defs>
          {EQ_BANDS.map((b,i)=>(<path key={i} d={bell(b.cx,b.w,80)} fill={`url(#eqg${i})`} className={`eq-b${i}`} style={{transformOrigin:`${b.cx}px 80px`}}/>))}
        </svg>
        <div style={{position:"relative",zIndex:1}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
            <div>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?20:24,fontWeight:800,color:"#EF5350",letterSpacing:-0.5,lineHeight:1}}>my rhythm.</div>
              <div style={{transition:"opacity 0.9s ease",opacity:quoteFade?1:0,marginTop:5,minHeight:52}}>
                <div style={{fontSize:11,color:"rgba(239,83,80,0.65)",fontFamily:FONT,fontStyle:"italic",lineHeight:1.45}}>"{activeQuotes[quoteIdx%activeQuotes.length].q}"</div>
                <div style={{fontSize:9,color:"rgba(239,83,80,0.4)",fontFamily:FONT_MONO,letterSpacing:1,marginTop:3}}>— {activeQuotes[quoteIdx%activeQuotes.length].a}</div>
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO}}>{dateLabel}</div>
            </div>
          </div>
        </div>
        <div style={{position:"absolute",bottom:6,left:"50%",transform:`translateX(-50%) rotate(${open?180:0}deg)`,color:"rgba(239,83,80,0.4)",fontSize:9,transition:"transform 0.3s ease",zIndex:2}}>▼</div>
      </div>

    </div>

    {open&&createPortal(
      <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)",padding:isMobile?"8px":"20px"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#0b1120",border:"1px solid rgba(239,83,80,0.2)",borderTop:"3px solid #EF5350",borderRadius:20,width:"100%",maxWidth:520,height:isMobile?"88vh":"min(92vh,780px)",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,0.8)",animation:"fadeSlideIn 0.2s ease-out"}}>
          <div style={{padding:"20px 20px 0",flexShrink:0}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'Sora',sans-serif",fontSize:18,fontWeight:800,color:"#EF5350",letterSpacing:-0.5}}>my rhythm.</div>
              <button onClick={()=>setOpen(false)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.5)",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <button style={tabBtn(tab==="today")} onClick={()=>setTab("today")}>TODAY</button>
              <button style={tabBtn(tab==="week")} onClick={()=>setTab("week")}>THIS WEEK</button>
            </div>
          </div>
          <div style={{overflowY:"auto",flex:1,padding:"0 20px 28px",WebkitOverflowScrolling:"touch"}}>
            {tab==="today"&&(
              <>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,color:"rgba(239,83,80,0.7)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:10}}>TOP 3 PRIORITIES</div>
                  {priorities.map((p,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(239,83,80,0.12)",border:"1px solid rgba(239,83,80,0.3)",color:"#EF5350",fontSize:11,fontWeight:800,fontFamily:FONT_MONO,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{i+1}</div>
                      <input value={p} onChange={e=>{const n=[...priorities];n[i]=e.target.value;savePriorities(n);}} placeholder={"Priority "+(i+1)} style={inp()}/>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{fontSize:10,color:"rgba(0,180,200,0.7)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:10}}>TODAY'S SCHEDULE</div>
                  {schedule.map((sl,i)=>{
                    const isNow=parseInt(sl.time.split(":")[0])===nowHour;
                    return(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:8,background:isNow?"rgba(239,83,80,0.06)":"transparent",borderLeft:isNow?"2px solid #EF5350":"2px solid transparent",marginBottom:2}}>
                        {editingTimeIdx===i?(
                          <input value={sl.time} onChange={e=>updateScheduleSlot(i,"time",e.target.value)} onBlur={()=>setEditingTimeIdx(null)} autoFocus style={{width:54,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(239,83,80,0.4)",borderRadius:6,padding:"3px 6px",color:"#EF5350",fontSize:11,fontFamily:FONT_MONO,outline:"none",textAlign:"center"}}/>
                        ):(
                          <span onClick={()=>setEditingTimeIdx(i)} style={{fontSize:11,color:isNow?"#EF5350":"rgba(0,180,200,0.5)",fontFamily:FONT_MONO,width:54,flexShrink:0,cursor:"pointer"}}>{sl.time}</span>
                        )}
                        <input value={sl.label} onChange={e=>updateScheduleSlot(i,"label",e.target.value)} placeholder="—" style={{flex:1,background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.06)",color:"rgba(255,255,255,0.85)",fontSize:13,fontFamily:FONT,outline:"none",padding:"3px 0",caretColor:"#EF5350"}}/>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
            {tab==="week"&&(
              <>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,color:"rgba(239,83,80,0.7)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:10}}>LIFE INTENTIONS</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {categories.map((c,i)=>(
                      <div key={c.key} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"10px 12px"}}>
                        <div style={{fontSize:9,color:"rgba(239,83,80,0.5)",fontFamily:FONT_MONO,letterSpacing:1,marginBottom:6}}>{c.label.toUpperCase()}</div>
                        <input value={c.value} onChange={e=>updateCategory(i,e.target.value)} placeholder="Add intention..." style={{background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.8)",fontSize:12,fontFamily:FONT,outline:"none",padding:"2px 0",width:"100%",caretColor:"#EF5350"}}/>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:"rgba(0,180,200,0.7)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:10}}>HABIT TRACKER</div>
                  <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr repeat(7, 22px)":"1fr repeat(7, 28px)",gap:isMobile?3:4,marginBottom:6,paddingLeft:4}}>
                    <div/>
                    {DAYS.map((d,i)=><div key={i} style={{fontSize:9,color:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,textAlign:"center",fontWeight:700}}>{d}</div>)}
                  </div>
                  {habits.map((h,hi)=>(
                    <div key={hi} style={{display:"grid",gridTemplateColumns:isMobile?"1fr repeat(7, 22px)":"1fr repeat(7, 28px)",gap:isMobile?3:4,alignItems:"center",marginBottom:8,paddingLeft:4}}>
                      <input value={h.name} onChange={e=>updateHabitName(hi,e.target.value)} style={{background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.75)",fontSize:12,fontFamily:FONT,outline:"none",padding:"2px 0",caretColor:"#EF5350"}}/>
                      {DAYS.map((_,di)=>{
                        const checked=!!checks[hi+"-"+di];
                        return(
                          <div key={di} onClick={()=>toggleCheck(hi,di)} style={{width:isMobile?20:24,height:isMobile?20:24,borderRadius:5,border:"1.5px solid "+(checked?"#EF5350":"rgba(255,255,255,0.12)"),background:checked?"#EF5350":"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",transition:"all 0.15s"}}>
                            {checked&&<span style={{fontSize:isMobile?9:10,color:"#080c14",fontWeight:900}}>✓</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>,document.body
    )}
  </>
  );
}




function ComposeModal({token,onClose}){
  const[to,setTo]=useState("");
  const[subject,setSubject]=useState("");
  const[body,setBody]=useState("");
  const[from,setFrom]=useState("");
  const[fromOpts,setFromOpts]=useState([]);
  const[sending,setSending]=useState(false);
  const[sent,setSent]=useState(false);
  const[voicing,setVoicing]=useState(false);
  const recRef=useRef(null);
  useEffect(()=>{
    (async()=>{
      try{
        const r=await fetch("https://www.googleapis.com/gmail/v1/users/me/settings/sendAs",{headers:{Authorization:`Bearer ${token}`}});
        const d=await r.json();
        console.log("[sendAs]",JSON.stringify(d.sendAs?.map(a=>({email:a.sendAsEmail,status:a.verificationStatus,default:a.isDefault}))));
        const all=(d.sendAs||[]).map(a=>a.sendAsEmail).filter(Boolean);
        if(all.length){setFromOpts(all);setFrom(all[0]);}
      }catch{
        const fallback=["duanedecastro@gmail.com","duane@spliffsgastropub.com","duane@1904musichall.com","duane@terrapinapparel.com","inbox@terrapinapparel.com"];
        setFromOpts(fallback);setFrom(fallback[0]);
      }
    })();
  },[token]);
  const startVoice=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return;
    const rec=new SR();rec.continuous=true;rec.interimResults=false;
    rec.onresult=(e)=>{const t=Array.from(e.results).map(r=>r[0].transcript).join(" ");setBody(s=>s+(s&&!s.endsWith(" ")?" ":"")+t);};
    rec.onend=()=>setVoicing(false);rec.onerror=()=>setVoicing(false);
    recRef.current=rec;rec.start();setVoicing(true);
  };
  const stopVoice=()=>{try{recRef.current?.stop();}catch{}setVoicing(false);};
  const sendToDraft=async()=>{
    if(!to.trim()||!body.trim())return;
    setSending(true);
    try{
      const raw=makeMime({from,to:to.trim(),subject:subject.trim()||"(no subject)",body:body.trim()});
      await fetch("https://www.googleapis.com/gmail/v1/users/me/drafts",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({message:{raw}})});
      setSent(true);setTimeout(()=>onClose(),1500);
    }catch(e){console.error(e);}
    setSending(false);
  };
  return createPortal(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:11000,backdropFilter:"blur(4px)"}} onClick={onClose}>
      <div style={{...panelSt("#3B5BDB"),width:480,maxWidth:"94vw",maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 16px 60px rgba(0,0,0,0.6)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:800,color:"#EF5350",letterSpacing:2,fontFamily:FONT_MONO}}>✉ COMPOSE DRAFT</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:18,padding:0}}>✕</button>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginBottom:6}}>FROM</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {fromOpts.length===0&&<div style={{fontSize:11,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO}}>Loading...</div>}
            {fromOpts.map(o=>(
              <button key={o} onClick={()=>setFrom(o)}
                style={{textAlign:"left",padding:"7px 12px",borderRadius:8,border:from===o?"1px solid #EF5350":"1px solid rgba(255,255,255,0.1)",background:from===o?"rgba(239,83,80,0.15)":"rgba(255,255,255,0.04)",color:from===o?"#EF5350":"rgba(255,255,255,0.5)",fontSize:11,fontFamily:FONT_MONO,cursor:"pointer",transition:"all 0.15s",letterSpacing:0.3}}>
                {from===o?"✓ ":""}{o}
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:8}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginBottom:4}}>TO</div>
          <input value={to} onChange={e=>setTo(e.target.value)} placeholder="recipient@email.com" style={{...iSt("#3B5BDB"),width:"100%",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:8}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginBottom:4}}>SUBJECT</div>
          <input value={subject} onChange={e=>setSubject(e.target.value)} placeholder="Subject" style={{...iSt("#3B5BDB"),width:"100%",boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:10,flex:1}}>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginBottom:4}}>BODY</div>
          <textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Type or speak your message..." style={{...iSt("#3B5BDB"),width:"100%",boxSizing:"border-box",minHeight:120,resize:"vertical"}}/>
          <button onClick={voicing?stopVoice:startVoice} style={{marginTop:6,width:"100%",background:voicing?"rgba(198,40,40,0.15)":"rgba(239,83,80,0.15)",border:voicing?"1px solid #C62828":"1px solid #EF535044",color:voicing?"#C62828":"#EF5350",borderRadius:8,padding:"8px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5}}>
            {voicing?"⏹ STOP RECORDING":"🎤 SPEAK TO APPEND"}
          </button>
        </div>
        <button onClick={sendToDraft} disabled={sending||sent||!to.trim()||!body.trim()}
          style={{...btnSt("#3B5BDB"),width:"100%",opacity:(!to.trim()||!body.trim())?0.4:1}}>
          {sent?"✓ DRAFT SAVED":sending?"SAVING...":"SEND TO DRAFTS →"}
        </button>
      </div>
    </div>,document.body);
}

function GmailEmailModal({token,msg,onClose,onCompose}){
  const[msgBody,setMsgBody]=useState({text:"",html:""});
  const[loading,setLoading]=useState(true);
  const headers=msg.payload?.headers||[];
  const bizId=emailToBizId(gmailHeader(headers,"To"));
  const biz=BIZ[bizId];
  useEffect(()=>{
    (async()=>{
      try{
        const r=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,{headers:{Authorization:`Bearer ${token}`}});
        const d=await r.json();
        setMsgBody(extractBody(d.payload));
      }catch{}
      setLoading(false);
    })();
  },[msg.id,token]);
  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:12000,background:"#f4f4f4",display:"flex",flexDirection:"column",animation:"fadeSlideIn 0.2s ease-out"}}>
      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#EF5350,#FF8A80)",padding:"12px 16px",display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.25)",border:"none",color:"#fff",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,flexShrink:0}}>← INBOX</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#fff",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gmailHeader(headers,"Subject")||"(no subject)"}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.7)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{gmailHeader(headers,"From")}</div>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          <button onClick={onCompose} style={{background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.3)",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>✉ COMPOSE</button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
      </div>
      {/* Meta */}
      <div style={{background:"#fff",padding:"10px 16px",borderBottom:"1px solid #e0e0e0",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:4,height:32,borderRadius:2,background:biz.color,flexShrink:0}}/>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:"#333"}}>{gmailHeader(headers,"From")}</div>
          <div style={{fontSize:10,color:"#999",marginTop:2}}>{gmailHeader(headers,"Date")}</div>
        </div>
      </div>
      {/* Body */}
      <div style={{flex:1,overflow:"auto",background:"#fff",padding:"16px"}}>
        {loading
          ?<div style={{color:"#999",fontSize:13,padding:16,textAlign:"center"}}>Loading...</div>
          :msgBody.html
            ?<div dangerouslySetInnerHTML={{__html:sanitizeHtml(msgBody.html)}} style={{maxWidth:700,margin:"0 auto"}}/>
            :<div style={{fontSize:14,color:"#333",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",maxWidth:700,margin:"0 auto"}}>{msgBody.text||"(no content)"}</div>
        }
      </div>
    </div>,document.body);
}

function DeleteBizConfirmModal({biz,onConfirm,onCancel}){
  const[checked,setChecked]=useState(false);
  return createPortal(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(6px)"}} onClick={onCancel}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#141c2e",border:"1px solid rgba(239,83,80,0.3)",borderTop:"3px solid #EF5350",borderRadius:16,padding:28,maxWidth:380,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.7),0 0 0 1px rgba(239,83,80,0.1)",animation:"fadeSlideIn 0.18s ease-out"}}>
        <div style={{fontSize:28,textAlign:"center",marginBottom:10}}>⚠️</div>
        <div style={{fontSize:20,fontWeight:800,color:"#EF5350",textAlign:"center",marginBottom:4,fontFamily:FONT}}>Delete Business?</div>
        <div style={{fontSize:16,fontWeight:700,color:"rgba(255,255,255,0.95)",textAlign:"center",marginBottom:20,fontFamily:FONT}}>{biz.name}</div>
        <div style={{background:"rgba(239,83,80,0.07)",border:"1px solid rgba(239,83,80,0.2)",borderRadius:10,padding:"14px 16px",marginBottom:20}}>
          <div style={{fontSize:11,fontWeight:800,color:"#EF5350",letterSpacing:1.5,fontFamily:FONT_MONO,marginBottom:10}}>THIS WILL PERMANENTLY DELETE:</div>
          {["All tasks for this business","All notes for this business","All calendar events linked to this business","All data and routing associations"].map(item=>(
            <div key={item} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
              <span style={{color:"#EF5350",fontSize:13,flexShrink:0,fontWeight:800}}>✕</span>
              <span style={{fontSize:13,color:"rgba(255,255,255,0.72)",lineHeight:1.4}}>{item}</span>
            </div>
          ))}
        </div>
        <label style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:22,cursor:"pointer",userSelect:"none"}}>
          <input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} style={{marginTop:3,accentColor:"#EF5350",width:17,height:17,flexShrink:0,cursor:"pointer"}}/>
          <span style={{fontSize:13,color:"rgba(255,255,255,0.55)",lineHeight:1.55}}>I understand this <strong style={{color:"rgba(255,255,255,0.85)"}}>cannot be undone</strong> and all data for <strong style={{color:"rgba(255,255,255,0.85)"}}>{biz.name}</strong> will be permanently lost.</span>
        </label>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onCancel} style={{flex:1,padding:"12px 0",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.7)",borderRadius:9,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:FONT,transition:"background 0.15s"}}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>Cancel</button>
          <button onClick={checked?onConfirm:undefined} style={{flex:1,padding:"12px 0",background:checked?"#C62828":"rgba(198,40,40,0.15)",border:`1px solid ${checked?"#EF5350":"rgba(198,40,40,0.25)"}`,color:checked?"#fff":"rgba(255,255,255,0.25)",borderRadius:9,fontSize:14,fontWeight:800,cursor:checked?"pointer":"not-allowed",fontFamily:FONT,transition:"all 0.2s",letterSpacing:0.3}}>
            {checked?"Delete Business":"Check box to confirm"}</button>
        </div>
      </div>
    </div>,document.body);
}

function SwipeableEmailRow({msg,token,onOpen,onArchived}){
  const[offset,setOffset]=useState(0);
  const[snapping,setSnapping]=useState(false);
  const[archiving,setArchiving]=useState(false);
  const[done,setDone]=useState(false);
  const wrapRef=useRef(null);
  const sx=useRef(null),sy=useRef(null),dragging=useRef(false);
  const REVEAL=72;

  useEffect(()=>{
    const el=wrapRef.current;
    if(!el)return;
    const ts=(e)=>{sx.current=e.touches[0].clientX;sy.current=e.touches[0].clientY;dragging.current=false;};
    const tm=(e)=>{
      if(sx.current===null)return;
      const dx=e.touches[0].clientX-sx.current;
      const dy=Math.abs(e.touches[0].clientY-sy.current);
      if(!dragging.current){if(Math.abs(dx)<6&&dy<6)return;if(dy>Math.abs(dx)){sx.current=null;return;}dragging.current=true;}
      e.preventDefault();
      setSnapping(false);
      setOffset(Math.max(Math.min(dx,0),-REVEAL-10));
    };
    const te=()=>{
      if(!dragging.current){sx.current=null;return;}
      dragging.current=false;sx.current=null;
      setSnapping(true);
      setOffset(o=>o<-(REVEAL/2)?-REVEAL:0);
    };
    el.addEventListener('touchstart',ts,{passive:true});
    el.addEventListener('touchmove',tm,{passive:false});
    el.addEventListener('touchend',te,{passive:true});
    return()=>{el.removeEventListener('touchstart',ts);el.removeEventListener('touchmove',tm);el.removeEventListener('touchend',te);};
  },[]);

  const doArchive=async()=>{
    if(archiving)return;
    setArchiving(true);
    try{
      await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}/modify`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({removeLabelIds:['INBOX']})
      });
      setDone(true);
      setTimeout(()=>onArchived(msg.id),300);
    }catch{setArchiving(false);setOffset(0);}
  };

  const headers=msg.payload?.headers||[];
  const from=gmailHeader(headers,"From");
  const subject=gmailHeader(headers,"Subject");
  const date=gmailHeader(headers,"Date");
  const unread=(msg.labelIds||[]).includes("UNREAD");
  const bizId=emailToBizId(gmailHeader(headers,"To"));
  const biz=BIZ[bizId];
  const displayDate=new Date(date).toLocaleDateString("en-US",{month:"short",day:"numeric"});

  return(
    <div ref={wrapRef} style={{position:"relative",overflow:"hidden",borderRadius:8,opacity:done?0:1,maxHeight:done?"0px":"100px",transition:done?"opacity 0.25s ease, max-height 0.3s ease":"none"}}>
      {/* Archive reveal */}
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:REVEAL,background:"linear-gradient(135deg,#2E7D32,#43A047)",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"0 8px 8px 0"}}>
        <button onClick={doArchive} style={{background:"none",border:"none",color:"#fff",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"0 8px"}}>
          <span style={{fontSize:16}}>{archiving?"⏳":"📥"}</span>
          <span style={{fontSize:9,fontWeight:700,fontFamily:FONT_MONO,letterSpacing:1}}>{archiving?"...":"ARCHIVE"}</span>
        </button>
      </div>
      {/* Email row */}
      <div onClick={()=>{if(offset===0)onOpen(msg);else{setSnapping(true);setOffset(0);}}}
        style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderBottom:"1px solid rgba(255,255,255,0.06)",cursor:"pointer",background:"#0e1320",transform:`translateX(${offset}px)`,transition:snapping?"transform 0.2s ease":"none"}}
        onMouseEnter={e=>{if(offset===0)e.currentTarget.style.background="rgba(255,255,255,0.05)";}}
        onMouseLeave={e=>{e.currentTarget.style.background="#0e1320";}}>
        <div style={{width:3,alignSelf:"stretch",borderRadius:2,background:biz.color,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
            <span style={{fontSize:12,fontWeight:unread?700:500,color:unread?"#fff":"rgba(255,255,255,0.55)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"65%"}}>{from.replace(/<.*>/,"").trim()||from}</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,flexShrink:0}}>{displayDate}</span>
          </div>
          <div style={{fontSize:12,color:unread?"rgba(255,255,255,0.88)":"rgba(255,255,255,0.4)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:unread?600:400}}>{subject||"(no subject)"}</div>
        </div>
        {unread&&<div style={{width:7,height:7,borderRadius:"50%",background:"#3B5BDB",flexShrink:0}}/>}
      </div>
    </div>
  );
}

function GmailPanel({token,unreadCount,onClose}){
  const[messages,setMessages]=useState([]);
  const[loading,setLoading]=useState(true);
  const[loadingMore,setLoadingMore]=useState(false);
  const[nextPageToken,setNextPageToken]=useState(null);
  const[selectedMsg,setSelectedMsg]=useState(null);
  const[composeOpen,setComposeOpen]=useState(false);

  const fetchMessages=async(pageToken=null)=>{
    const url=`https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=in:inbox${pageToken?`&pageToken=${pageToken}`:""}`;
    const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
    const d=await r.json();
    const ids=(d.messages||[]).map(m=>m.id);
    const details=await Promise.all(ids.map(id=>fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json())));
    return{details,nextPageToken:d.nextPageToken||null};
  };

  useEffect(()=>{
    (async()=>{
      try{const{details,nextPageToken}=await fetchMessages();setMessages(details);setNextPageToken(nextPageToken);}
      catch(e){console.error(e);}
      setLoading(false);
    })();
  },[token]);

  const loadMore=async()=>{
    if(!nextPageToken||loadingMore)return;
    setLoadingMore(true);
    try{const{details,nextPageToken:next}=await fetchMessages(nextPageToken);setMessages(p=>[...p,...details]);setNextPageToken(next);}
    catch(e){console.error(e);}
    setLoadingMore(false);
  };

  const isUnread=(msg)=>(msg.labelIds||[]).includes("UNREAD");
  const getBizId=(msg)=>emailToBizId(gmailHeader(msg.payload?.headers,"To"));

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {selectedMsg&&<GmailEmailModal token={token} msg={selectedMsg} onClose={()=>setSelectedMsg(null)} onCompose={()=>setComposeOpen(true)}/>}
      {composeOpen&&<ComposeModal token={token} onClose={()=>setComposeOpen(false)}/>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexShrink:0}}>
        <div style={{fontSize:11,fontWeight:800,color:"#EF5350",letterSpacing:2,fontFamily:FONT_MONO}}>INBOX {unreadCount>0&&`(${unreadCount} unread)`}</div>
        <button onClick={()=>setComposeOpen(true)} style={{...btnSt("#3B5BDB"),padding:"6px 12px",fontSize:11}}>✉ COMPOSE</button>
      </div>
      {loading&&<div style={{fontSize:13,color:"rgba(255,255,255,0.35)",padding:"16px 0",textAlign:"center"}}>Loading emails...</div>}
      {!loading&&messages.map((msg)=>(
        <SwipeableEmailRow key={msg.id} msg={msg} token={token} onOpen={setSelectedMsg} onArchived={(id)=>setMessages(p=>p.filter(m=>m.id!==id))}/>
      ))}
      {nextPageToken&&(
        <button onClick={loadMore} disabled={loadingMore} style={{margin:"12px 0",width:"100%",background:"rgba(239,83,80,0.15)",border:"1px solid #EF535044",color:"#EF5350",borderRadius:10,padding:"10px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO}}>
          {loadingMore?"Loading...":"LOAD MORE ↓"}
        </button>
      )}
    </div>
  );
}

function StatCards({allTasks,urgentTasks,upcoming,allNotes,open,onOpen,unreadMail}){
  const notesFlat=(allNotes||[]).flatMap((arr,i)=>arr.map(n=>({...n,bizId:i})));
  const cards=[
    {key:"tasks",label:"TASKS",val:allTasks.length,color:"#3B5BDB",gradient:"linear-gradient(135deg, #3B5BDB, #6B8EFF)"},
    {key:"urgent",label:"URGENT",val:urgentTasks.length,color:"#C62828",gradient:"linear-gradient(135deg, #C62828, #EF5350)"},
    {key:"upcoming",label:"UPCOMING",val:upcoming.length,color:"#0097A7",gradient:"linear-gradient(135deg, #0097A7, #00BCD4)"},
    {key:"notes",label:"NOTES",val:notesFlat.length,color:"#EF5350",gradient:"linear-gradient(135deg, #EF5350, #FF8A80)"},
    {key:"mail",label:"MAIL",val:unreadMail==null?"-":unreadMail>99?"99+":unreadMail,color:"#EF5350",gradient:"linear-gradient(135deg, #EF5350, #FF8A80)"},
  ];
  return(
    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
      {cards.map(s=>(
        <div key={s.key} onClick={()=>onOpen(open===s.key?null:s.key)}
          style={{...panelSt(s.color),padding:"10px 16px",flex:"1 1 0",minWidth:0,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,
            background:open===s.key?s.gradient:"linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.03) 100%)",
            border:open===s.key?`1px solid ${s.color}66`:"1px solid rgba(255,255,255,0.12)",
            borderTop:open===s.key?`1px solid ${s.color}88`:"1px solid rgba(255,255,255,0.22)",
            boxShadow:open===s.key?`0 4px 20px ${s.color}44`:"0 6px 20px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.06) inset",
            transform:open===s.key?"scale(1.05)":"none",
            transition:"all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"}}>
          <div style={{fontSize:26,fontWeight:900,color:open===s.key?"#fff":"#EF5350",lineHeight:1,transition:"color 0.3s"}}>{s.val}</div>
          <div style={{fontSize:8,color:open===s.key?"rgba(255,255,255,0.8)":"rgba(255,255,255,0.4)",letterSpacing:0,fontWeight:600,fontFamily:FONT_MONO,textTransform:"uppercase",transition:"color 0.3s",textAlign:"center"}}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function OverviewNotePanel({allNotes,onUpdate,onDelete,onAddTask}){
  const[selectedNote,setSelectedNote]=useState(null);
  const[showAll,setShowAll]=useState(false);
  const[search,setSearch]=useState("");
  const flat=allNotes.flatMap((arr,i)=>arr.map(n=>({...n,bizId:i})));
  const sorted=[...flat].sort((a,b)=>{if(a.pinned&&!b.pinned)return-1;if(!a.pinned&&b.pinned)return 1;return new Date(b.timestamp)-new Date(a.timestamp);});
  const visible=sorted.slice(0,3);
  const filteredAll=search?sorted.filter(n=>n.content.toLowerCase().includes(search.toLowerCase())):sorted;
  const ac="#6A1B9A";
  const handleUpdate=(bi,nid,updates)=>{onUpdate(bi,nid,updates);if(selectedNote&&selectedNote.id===nid)setSelectedNote(n=>({...n,...updates}));};
  return(
    <div style={panelSt(ac)}>
      {selectedNote&&<NoteModal note={selectedNote} biz={BIZ[selectedNote.bizId]} bizId={selectedNote.bizId} onClose={()=>setSelectedNote(null)} onUpdate={handleUpdate} onDelete={onDelete} onAddTask={onAddTask}/>}
      {showAll&&(
        <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,backdropFilter:"blur(4px)"}} onClick={()=>setShowAll(false)}>
          <div style={{...panelSt(ac),width:420,maxWidth:"94vw",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:`0 8px 40px ${ac}40`}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:13,fontWeight:800,color:ac,letterSpacing:1,fontFamily:FONT_MONO}}>ALL NOTES ({sorted.length})</div>
              <button onClick={()=>setShowAll(false)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,padding:0}}>{"\u2715"}</button>
            </div>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search all notes..." style={{...iSt(ac),marginBottom:12}}/>
            <div style={{flex:1,overflow:"auto"}}>
              {filteredAll.length===0&&<div style={{fontSize:14,color:"rgba(255,255,255,0.3)",padding:"12px 0",textAlign:"center"}}>No notes found</div>}
              {filteredAll.map(n=>{const b=BIZ[n.bizId];return(
                <div key={n.id} onClick={()=>{setShowAll(false);setSelectedNote(n);}}
                  style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:12,background:`${b.color}08`,border:`1px solid ${b.color}20`,marginBottom:8,cursor:"pointer",transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=`${b.color}15`;}}
                  onMouseLeave={e=>{e.currentTarget.style.background=`${b.color}08`;}}>
                  <div style={{width:3,alignSelf:"stretch",borderRadius:2,background:b.color,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                      {n.pinned&&<span style={{fontSize:11}}>{"\uD83D\uDCCC"}</span>}
                      <span style={{fontSize:10,color:b.color,fontFamily:FONT_MONO,fontWeight:700}}>{b.short}</span>
                      <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO}}>{fmtNoteDate(n.timestamp)} \u00B7 {fmtNoteTime(n.timestamp)}</span>
                    </div>
                    <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.5,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{n.content}</div>
                  </div>
                  <span style={{fontSize:12,color:"#ccc",flexShrink:0,marginTop:4}}>{"\u203A"}</span>
                </div>
              );})}
            </div>
          </div>
        </div>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:800,color:ac,letterSpacing:2,fontFamily:FONT_MONO}}>{"\uD83D\uDCDD"} RECENT NOTES</div>
        {sorted.length>3&&<button onClick={()=>setShowAll(true)} style={{background:"none",border:"none",color:ac,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5}}>VIEW ALL ({sorted.length}) {"\u2192"}</button>}
      </div>
      {sorted.length===0&&<div style={{fontSize:13,color:"rgba(255,255,255,0.3)",padding:"8px 0",animation:"textPulse 2.8s ease-in-out infinite"}}>Tap the voice button to add your first note</div>}
      {visible.map(n=>{const b=BIZ[n.bizId];return(
        <div key={n.id} onClick={()=>setSelectedNote(n)}
          style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:10,background:`${b.color}08`,border:`1px solid ${b.color}20`,marginBottom:6,cursor:"pointer",transition:"all 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.background=`${b.color}15`;e.currentTarget.style.borderColor=`${b.color}40`;}}
          onMouseLeave={e=>{e.currentTarget.style.background=`${b.color}08`;e.currentTarget.style.borderColor=`${b.color}20`;}}>
          {n.pinned&&<span style={{fontSize:11,flexShrink:0}}>{"\uD83D\uDCCC"}</span>}
          <div style={{width:3,height:32,borderRadius:2,background:b.color,flexShrink:0}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,color:b.color,fontFamily:FONT_MONO,fontWeight:700,marginBottom:2}}>{b.short} \u00B7 {fmtNoteTime(n.timestamp)}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.content}</div>
          </div>
          <span style={{fontSize:12,color:"#ccc",flexShrink:0}}>{"\u203A"}</span>
        </div>
      );})}
    </div>
  );
}

const ONBOARD_COLORS=["#E65100","#F9A825","#0097A7","#2E7D32","#3B5BDB","#9333EA","#C62828","#AD1457"];
const ONBOARD_TYPES=["Restaurant","Bar/Lounge","Retail","Service Business","Tech/Software","Real Estate","Hospitality","Healthcare","Clothing Brand","Food Truck","Fitness","Salon/Spa","Entertainment","Other"];

function EditBizModal({bizId,onSave,onClose}){
  const b=BIZ[bizId];
  const[name,setName]=useState(b.name);
  const[type,setType]=useState(b.type);
  const[color,setColor]=useState(b.color);
  const inp={width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"10px 12px",color:"#fff",fontSize:15,fontFamily:FONT,outline:"none",boxSizing:"border-box"};
  const canSave=name.trim().length>0;
  return createPortal(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24,backdropFilter:"blur(6px)"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#141c2e",border:`1px solid ${color}44`,borderTop:`3px solid ${color}`,borderRadius:16,padding:28,maxWidth:380,width:"100%",boxShadow:"0 24px 64px rgba(0,0,0,0.7)",animation:"fadeSlideIn 0.18s ease-out"}}>
        <div style={{fontSize:18,fontWeight:800,color:"#fff",marginBottom:20,fontFamily:FONT}}>Edit Business</div>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:6}}>BUSINESS NAME</div>
            <input value={name} onChange={e=>setName(e.target.value)} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:6}}>TYPE</div>
            <select value={type} onChange={e=>setType(e.target.value)} style={{...inp,color:"rgba(255,255,255,0.7)"}}>
              {ONBOARD_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:8}}>COLOR</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {ONBOARD_COLORS.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",border:color===c?"3px solid #fff":"2px solid transparent",boxSizing:"border-box",flexShrink:0,boxShadow:color===c?`0 0 8px ${c}88`:"none",transition:"all 0.15s"}}/>)}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"12px 0",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.7)",borderRadius:9,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>Cancel</button>
          <button onClick={canSave?()=>onSave(bizId,{name:name.trim(),type,color}):undefined} style={{flex:1,padding:"12px 0",background:canSave?color:"rgba(255,255,255,0.08)",border:`1px solid ${canSave?color:"transparent"}`,color:canSave?"#fff":"rgba(255,255,255,0.25)",borderRadius:9,fontSize:14,fontWeight:800,cursor:canSave?"pointer":"default",fontFamily:FONT,transition:"all 0.2s"}}>Save Changes</button>
        </div>
      </div>
    </div>,document.body);
}

function CommandScore({urgentTasks}){
  const[open,setOpen]=useState(false);
  const today=todayStr();
  const rhythmToday=(()=>{try{const s=JSON.parse(localStorage.getItem("dws_rhythm")||"null");if(s&&s.date===today)return s.blocks;}catch{}return null;})();
  const goals=(()=>{try{return JSON.parse(localStorage.getItem("cp_goals")||"[]");}catch{return[];}})();

  const rhythmChecked=rhythmToday?Object.values(rhythmToday).filter(b=>Object.values(b.eq||{}).some(v=>v>0)).length:0;
  const rhythmPts=rhythmChecked>=4?30:rhythmChecked===3?22:rhythmChecked===2?14:rhythmChecked===1?7:0;
  const goalsLogged=goals.filter(g=>g.lastLogged===today).length;
  const goalsPts=goalsLogged>=2?20:goalsLogged===1?12:0;
  const urgent=urgentTasks.length;
  const tasksPts=urgent===0?25:urgent<=2?15:5;
  const bestStreak=goals.length?Math.max(...goals.map(g=>g.streak||0)):0;
  const streakPts=bestStreak>=7?10:bestStreak>=3?6:bestStreak>=1?3:0;
  const budgetPts=15;

  const score=Math.min(100,rhythmPts+goalsPts+tasksPts+streakPts+budgetPts);
  const scoreColor=score<40?"#C62828":score<70?"#EF5350":"#43A047";
  const scoreMsg=score>=70?"Strong day. Keep it up.":score>=40?"Building momentum.":"Get your day started.";

  const sz=230,cx=115,cy=115,outerR=108,innerR=91;
  const innerCirc=2*Math.PI*innerR;
  const innerArc=(score/100)*innerCirc;

  const cats=[
    {label:"RHYTHM", pts:rhythmPts, max:30, color:"#EF5350"},
    {label:"GOALS",  pts:goalsPts,  max:20, color:"#FF7043"},
    {label:"TASKS",  pts:tasksPts,  max:25, color:"#3B5BDB"},
    {label:"STREAKS",pts:streakPts, max:10, color:"#43A047"},
    {label:"BUDGET", pts:budgetPts, max:15, color:"#0097A7"},
  ];

  return(
    <>
      <div onClick={()=>setOpen(true)} style={{cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,userSelect:"none"}}
        onMouseEnter={e=>e.currentTarget.querySelector("svg").style.filter=`drop-shadow(0 0 32px ${scoreColor}55)`}
        onMouseLeave={e=>e.currentTarget.querySelector("svg").style.filter=`drop-shadow(0 0 20px ${scoreColor}33)`}>
        <svg width={sz} height={sz} style={{overflow:"visible",filter:`drop-shadow(0 0 20px ${scoreColor}33)`,transition:"filter 0.3s ease"}}>
          <defs>
            <clipPath id="scoreClip"><circle cx={cx} cy={cy} r={outerR-1}/></clipPath>
            <filter id="blobBlur"><feGaussianBlur stdDeviation="20"/></filter>
            <filter id="orbBlob" x="-40%" y="-40%" width="180%" height="180%">
              <feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="2" result="noise">
                <animate attributeName="baseFrequency" values="0.025;0.042;0.03;0.022;0.025" dur="22s" repeatCount="indefinite"/>
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="45" xChannelSelector="R" yChannelSelector="G" result="warped"/>
              <feGaussianBlur in="warped" stdDeviation="5" result="glow"/>
              <feMerge><feMergeNode in="glow"/><feMergeNode in="warped"/></feMerge>
            </filter>
          </defs>
          {/* Dark fill + animated color blobs clipped to circle */}
          <g clipPath="url(#scoreClip)">
            <circle cx={cx} cy={cy} r={outerR} fill="#060b16"/>
            <circle cx={cx-28} cy={cy-22} r={60} fill="#EF5350" filter="url(#blobBlur)" className="score-blob-1"/>
            <circle cx={cx+32} cy={cy+28} r={55} fill="#43A047" filter="url(#blobBlur)" className="score-blob-2"/>
            <circle cx={cx-8} cy={cy+35} r={48} fill="#3B5BDB" filter="url(#blobBlur)" className="score-blob-3"/>
            {/* Floating plasma orbs — widget colors, blobby, centered, always drifting */}
            <circle cx={90} cy={95} r={42} fill="#ffffff" opacity={0.4} filter="url(#orbBlob)" style={{mixBlendMode:"screen"}} className="score-orb-1"/>
            <circle cx={140} cy={88} r={42} fill="#ffffff" opacity={0.4} filter="url(#orbBlob)" style={{mixBlendMode:"screen"}} className="score-orb-2"/>
            <circle cx={100} cy={142} r={42} fill="#ffffff" opacity={0.4} filter="url(#orbBlob)" style={{mixBlendMode:"screen"}} className="score-orb-3"/>
            <circle cx={138} cy={140} r={42} fill="#ffffff" opacity={0.4} filter="url(#orbBlob)" style={{mixBlendMode:"screen"}} className="score-orb-4"/>
          </g>
          {/* Outer frame ring — amber, glow + crisp edge */}
          <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#F59E0B" strokeWidth={4} opacity={0.18} style={{filter:"blur(3px)"}}/>
          <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#F59E0B" strokeWidth={1.5} opacity={0.78}/>
          {/* Score track */}
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={11}/>
          {/* Score arc */}
          <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#F59E0B" strokeWidth={11} strokeLinecap="round"
            strokeDasharray={`${innerArc} ${innerCirc}`}
            style={{transform:"rotate(-90deg)",transformOrigin:`${cx}px ${cy}px`,filter:"drop-shadow(0 0 9px #F59E0Bcc)",transition:"stroke-dasharray 0.7s ease"}}/>
          {/* Score number — Orbitron digital font, true center */}
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
            style={{fontSize:62,fontWeight:900,fill:"#F59E0B",fontFamily:"'Orbitron',sans-serif"}}>{score}</text>
          {/* COMMAND SCORE label */}
          <text x={cx} y={cy+46} textAnchor="middle" dominantBaseline="middle"
            style={{fontSize:8,fill:"#F59E0B",fontFamily:FONT_MONO,letterSpacing:2.5,opacity:0.75}}>COMMAND SCORE</text>
          <text x={cx} y={cy+61} textAnchor="middle" dominantBaseline="middle"
            style={{fontSize:7,fill:"rgba(255,255,255,0.15)",fontFamily:FONT_MONO,letterSpacing:1}}>TAP FOR BREAKDOWN</text>
        </svg>
      </div>

      {open&&createPortal(
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(10px)",padding:20}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#080e1c",border:`1px solid ${scoreColor}28`,borderRadius:24,padding:"28px 28px 24px",width:"min(380px,92vw)",display:"flex",flexDirection:"column",gap:20,boxShadow:`0 0 60px ${scoreColor}18, 0 24px 80px rgba(0,0,0,0.8)`,animation:"fadeSlideIn 0.2s ease-out"}}>
            <div style={{display:"flex",alignItems:"center",gap:18}}>
              <svg width={76} height={76} style={{flexShrink:0}}>
                <circle cx={38} cy={38} r={32} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={6}/>
                <circle cx={38} cy={38} r={32} fill="none" stroke={scoreColor} strokeWidth={6} strokeLinecap="round"
                  strokeDasharray={`${(score/100)*2*Math.PI*32} ${2*Math.PI*32}`}
                  style={{transform:"rotate(-90deg)",transformOrigin:"38px 38px",filter:`drop-shadow(0 0 5px ${scoreColor}88)`}}/>
                <text x={38} y={38} textAnchor="middle" dominantBaseline="middle" style={{fontSize:20,fontWeight:900,fill:scoreColor,fontFamily:"'Sora',sans-serif"}}>{score}</text>
              </svg>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:"rgba(255,255,255,0.9)",fontFamily:"'Sora',sans-serif",letterSpacing:-0.3}}>Command Score</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,marginTop:5,lineHeight:1.5}}>{scoreMsg}</div>
              </div>
            </div>
            <div style={{height:1,background:"rgba(255,255,255,0.07)"}}/>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {cats.map(cat=>(
                <div key={cat.label}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <div style={{fontSize:10,fontWeight:700,color:cat.pts>0?cat.color:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,letterSpacing:1.2}}>{cat.label}</div>
                    <div style={{fontSize:10,fontWeight:700,color:cat.pts>0?cat.color:"rgba(255,255,255,0.18)",fontFamily:FONT_MONO}}>{cat.pts} / {cat.max}</div>
                  </div>
                  <div style={{height:3,borderRadius:2,background:"rgba(255,255,255,0.07)"}}>
                    <div style={{height:"100%",width:`${(cat.pts/cat.max)*100}%`,borderRadius:2,background:cat.color,boxShadow:`0 0 6px ${cat.color}55`,transition:"width 0.5s ease"}}/>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={()=>setOpen(false)} style={{padding:"11px 0",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.45)",borderRadius:10,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:FONT,marginTop:4}}>Close</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function WidgetCard({widget,onOpen,goalsData}){
  const c=widget.color;
  const isMobile=window.innerWidth<768;
  const isGoals=widget.id==="goals"&&goalsData&&goalsData.length>0;
  const ringSize=isMobile?40:46;
  return(
    <div onClick={onOpen}
      style={{background:`linear-gradient(180deg,${c}18 0%,${c}08 100%)`,border:`1px solid ${c}30`,borderTop:`1px solid ${c}55`,borderRadius:14,padding:isMobile?"10px 12px 14px":"14px 16px 16px",cursor:"pointer",position:"relative",minWidth:0,overflow:"hidden",display:"flex",flexDirection:"column",boxSizing:"border-box",boxShadow:`0 6px 24px rgba(0,0,0,0.4), 0 1px 0 ${c}22 inset`,transition:"all 0.18s",minHeight:isMobile?90:112}}
      onMouseEnter={e=>{e.currentTarget.style.background=`linear-gradient(180deg,${c}28 0%,${c}12 100%)`;e.currentTarget.style.boxShadow=`0 8px 44px ${c}66, 0 1px 0 ${c}33 inset`;e.currentTarget.style.transform="translateY(-3px) scale(1.02)";}}
      onMouseLeave={e=>{e.currentTarget.style.background=`linear-gradient(180deg,${c}18 0%,${c}08 100%)`;e.currentTarget.style.boxShadow=`0 6px 24px rgba(0,0,0,0.4), 0 1px 0 ${c}22 inset`;e.currentTarget.style.transform="none";}}>
      <div style={{fontSize:14,fontWeight:700,color:c,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{widget.name}</div>
      <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginBottom:10,fontWeight:600}}>{widget.category.toUpperCase()}</div>
      {isGoals?(
        <div style={{display:"flex",gap:8,flex:1,alignItems:"center",justifyContent:"center"}}>
          {goalsData.slice(0,3).map(g=>{
            const pct=Math.round(Math.min(100,(g.current||0)/(g.target||1)*100));
            return(
              <div key={g.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <ArcRing pct={pct} color={g.color||c} size={ringSize}/>
                <div style={{fontSize:8,color:"rgba(255,255,255,0.45)",fontFamily:"'JetBrains Mono',monospace",letterSpacing:0.3,width:ringSize,textAlign:"center",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.title}</div>
              </div>
            );
          })}
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,textAlign:"center"}}>
          {widget.stats.map(({v,l})=>(
            <div key={l} style={{background:`${c}14`,borderRadius:6,padding:"5px 2px"}}>
              <div style={{fontSize:15,fontWeight:800,color:"rgba(255,255,255,0.88)",lineHeight:1}}>{v}</div>
              <div style={{fontSize:9,color:`${c}cc`,fontWeight:700,letterSpacing:0.5,marginTop:2}}>{l}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableBizCard({bizId,state,allEvents,urgentTasks,td,isAuthed,gTasksFlat,onNavigate,onDeleteBiz,onEditBiz}){
  const b=BIZ[bizId];
  const isMobile=window.innerWidth<768;
  const{attributes,listeners,setNodeRef,transform,transition,isDragging}=useSortable({id:bizId});
  const tasks=isAuthed?gTasksFlat.filter(t=>t.bizId===bizId&&!t.done).length:(state.tasks[bizId]||[]).filter(t=>!t.done).length;
  const events=allEvents.filter(ev=>ev.bizId===bizId&&(ev.start||"").split("T")[0]>=td).length;
  const noteCount=(state.notes[bizId]||[]).length;
  const urgentCount=urgentTasks.filter(t=>t.bizId===bizId).length;
  const nextEv=allEvents.filter(ev=>ev.bizId===bizId&&(ev.start||"").split("T")[0]>=td).sort((a,c)=>(a.start||"")<(c.start||"")?-1:1)[0];
  const needsAttention=urgentCount>0;
  return(
    <div ref={setNodeRef} style={{transform:DndCSS.Transform.toString(transform),transition,opacity:isDragging?0.45:1,zIndex:isDragging?50:1,position:"relative",minWidth:0,overflow:"hidden"}}{...attributes}>
      <div onClick={e=>{if(e.target.closest("button"))return;onNavigate(bizId);}} style={{...panelSt(b.color),cursor:"pointer",padding:"14px 16px",position:"relative",height:"100%",minWidth:0,overflow:"hidden",display:"flex",flexDirection:"column",boxSizing:"border-box",
        background:`linear-gradient(180deg,${b.color}18 0%,${b.color}08 100%)`,
        border:`1px solid ${needsAttention?"#C6282855":b.color+"30"}`,
        borderTop:`1px solid ${needsAttention?"#C62828aa":b.color+"55"}`,
        boxShadow:isDragging?`0 16px 48px ${b.color}55, 0 1px 0 ${b.color}33 inset`:needsAttention?`0 6px 24px rgba(198,40,40,0.25), 0 1px 0 ${b.color}22 inset`:`0 6px 24px rgba(0,0,0,0.4), 0 1px 0 ${b.color}22 inset`}}
        onMouseEnter={e=>{if(!isDragging){e.currentTarget.style.background=`linear-gradient(180deg,${b.color}28 0%,${b.color}12 100%)`;e.currentTarget.style.boxShadow=`0 8px 44px ${b.color}66, 0 1px 0 ${b.color}33 inset`;e.currentTarget.style.transform="translateY(-3px) scale(1.02)";}}}
        onMouseLeave={e=>{e.currentTarget.style.background=`linear-gradient(180deg,${b.color}18 0%,${b.color}08 100%)`;e.currentTarget.style.boxShadow=needsAttention?`0 6px 24px rgba(198,40,40,0.25), 0 1px 0 ${b.color}22 inset`:`0 6px 24px rgba(0,0,0,0.4), 0 1px 0 ${b.color}22 inset`;e.currentTarget.style.transform="none";}}>
        <div {...listeners} onClick={e=>e.stopPropagation()} title="Drag to reorder" style={{position:"absolute",top:8,left:8,color:"rgba(255,255,255,0.18)",fontSize:13,cursor:"grab",padding:"2px 4px",lineHeight:1,userSelect:"none",touchAction:"none",borderRadius:3,transition:"color 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.color=b.color}
          onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.18)"}>⠿</div>
        {urgentCount>0&&(
          <div style={{position:"absolute",top:10,right:10,background:"#C62828",borderRadius:10,minWidth:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 5px",fontSize:10,fontWeight:800,color:"#fff",fontFamily:FONT_MONO}}>{urgentCount}</div>
        )}
        <div style={{fontSize:14,fontWeight:700,color:BIZ_TEXT[bizId],marginBottom:3,paddingLeft:18,paddingRight:urgentCount>0?22:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
        <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginBottom:10,fontWeight:600,paddingLeft:18}}>{b.type.toUpperCase()}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,textAlign:"center",marginBottom:nextEv?10:0}}>
          {[{v:tasks,l:"T"},{v:events,l:"E"},{v:noteCount,l:"N"}].map(({v,l})=>(
            <div key={l}>
              <div style={{fontSize:16,fontWeight:700,color:v>0?b.color:"rgba(255,255,255,0.2)"}}>{v}</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontWeight:600}}>{l}</div>
            </div>
          ))}
        </div>
        {nextEv&&(
          <div style={{borderTop:`1px solid ${b.color}20`,paddingTop:8,display:"flex",alignItems:"flex-start",gap:5}}>
            <span style={{fontSize:9,color:b.color,fontFamily:FONT_MONO,fontWeight:700,flexShrink:0,marginTop:1}}>NEXT</span>
            <span style={{fontSize:10,color:"rgba(255,255,255,0.5)",lineHeight:1.3,overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{nextEv.summary}{!nextEv.allDay&&` · ${fmtTime(nextEv.start)}`}</span>
          </div>
        )}
        <button onClick={e=>{e.stopPropagation();onEditBiz(bizId);}} title="Edit business" style={{position:"absolute",bottom:8,left:8,background:"transparent",border:"none",color:"rgba(255,255,255,0.18)",fontSize:13,cursor:"pointer",padding:"2px 5px",lineHeight:1,borderRadius:4,transition:"color 0.15s,background 0.15s",display:"flex",alignItems:"center"}}
          onMouseEnter={e=>{e.currentTarget.style.color=b.color;e.currentTarget.style.background=`${b.color}18`;}}
          onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.18)";e.currentTarget.style.background="transparent";}}><PenLine size={11}/></button>
        <button onClick={e=>{e.stopPropagation();onDeleteBiz(bizId);}} style={{position:"absolute",bottom:8,right:8,background:"transparent",border:"none",color:"rgba(255,255,255,0.18)",fontSize:14,cursor:"pointer",padding:"2px 5px",lineHeight:1,borderRadius:4,transition:"color 0.15s,background 0.15s"}}
          onMouseEnter={e=>{e.currentTarget.style.color="#EF5350";e.currentTarget.style.background="rgba(239,83,80,0.12)";}}
          onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.18)";e.currentTarget.style.background="transparent";}}>✕</button>
      </div>
    </div>
  );
}

function PlatformStrip(){
  return(
    <div style={{...panelSt("#1A2744"),background:"linear-gradient(135deg,#12192b,#1a2744)",border:"1px solid rgba(255,255,255,0.08)",padding:"16px 20px"}}>
      <div style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.3)",letterSpacing:2,fontFamily:FONT_MONO,textTransform:"uppercase",marginBottom:12}}>More from the Command Bean platform</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        {[{n:"Command Bean Mogul",c:"#F59E0B",s:"Run everything. Miss nothing.",badge:"Early Access"},{n:"Command Bean Personal",c:"#E53935",s:"Control your time. Own your freedom.",badge:"Coming Soon"},{n:"Command Bean Pulse",c:"#7C3AED",s:"Every app. One pulse.",badge:"Roadmap"},{n:"Command Bean Partners",c:"#3949AB",s:"One business. One view. Every partner.",badge:"Roadmap"},{n:"Command Bean Family",c:"#66BB6A",s:"For families that win.",badge:"Roadmap"}].map(p=>(
          <div key={p.n} style={{display:"flex",alignItems:"center",gap:8,flex:"1 1 140px"}}>
            <div style={{width:3,height:32,borderRadius:2,background:p.c,flexShrink:0}}/>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                <span style={{fontSize:11,fontWeight:800,color:"rgba(255,255,255,0.75)",fontFamily:"Sora,sans-serif"}}>{p.n}</span>
                <span style={{fontSize:8,fontWeight:700,color:p.c,letterSpacing:0.5,fontFamily:FONT_MONO,opacity:0.8}}>{p.badge}</span>
              </div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontWeight:400}}>{p.s}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodayBriefModal({urgentTasks,allEvents,td,onNavigate,onClose,state,isAuthed,gTasksFlat}){
  const isMobile=window.innerWidth<768;
  const dateLabel=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  const bizData=BIZ.map((biz,i)=>{
    const urgent=urgentTasks.filter(t=>t.bizId===i);
    const todayEvs=allEvents.filter(ev=>ev.bizId===i&&(ev.start||"").split("T")[0]===td).sort((ea,eb)=>(ea.start||"").localeCompare(eb.start||""));
    const tasks=isAuthed?gTasksFlat.filter(t=>t.bizId===i&&!t.done):((state.tasks&&state.tasks[i]||[]).filter(t=>!t.done));
    return{b:biz,i,urgent,todayEvs,tasks};
  }).filter(({b,urgent,todayEvs})=>!b.hidden&&(urgent.length>0||todayEvs.length>0));
  const totalEvents=bizData.reduce((s,{todayEvs})=>s+todayEvs.length,0);
  const totalUrgent=urgentTasks.length;
  return createPortal(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)",padding:"16px"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#0e1320",border:"1px solid rgba(0,180,200,0.2)",borderTop:"3px solid #EF5350",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"80vh",display:"flex",flexDirection:"column",animation:"fadeSlideIn 0.22s ease-out",boxShadow:"0 8px 60px rgba(0,0,0,0.8)"}}>
        {/* Header */}
        <div style={{padding:"20px 20px 14px",borderBottom:"1px solid rgba(255,255,255,0.06)",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:"#EF5350",fontFamily:FONT,letterSpacing:-0.5}}>Today's Brief</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1.5,marginTop:3}}>{dateLabel.toUpperCase()}</div>
            </div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.5)",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          {/* Summary pills */}
          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
            {totalEvents>0&&<span style={{fontSize:10,fontWeight:700,color:"#EF5350",background:"rgba(239,83,80,0.12)",border:"1px solid rgba(239,83,80,0.25)",borderRadius:20,padding:"3px 10px",fontFamily:FONT_MONO,letterSpacing:0.5}}>{totalEvents} EVENT{totalEvents!==1?"S":""} TODAY</span>}
            {totalUrgent>0&&<span style={{fontSize:10,fontWeight:700,color:"#FF3B3B",background:"rgba(255,59,59,0.12)",border:"1px solid rgba(255,59,59,0.3)",borderRadius:20,padding:"3px 10px",fontFamily:FONT_MONO,letterSpacing:0.5}}>⚠ {totalUrgent} URGENT</span>}
            {bizData.length===0&&<span style={{fontSize:10,color:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,letterSpacing:0.5}}>ALL CLEAR — NOTHING DUE TODAY</span>}
          </div>
        </div>
        {/* Body */}
        <div style={{overflowY:"auto",padding:"12px 20px 32px",flex:1}}>
          {bizData.length===0?(
            <div style={{textAlign:"center",padding:"40px 0",color:"rgba(255,255,255,0.2)",fontSize:13,fontFamily:FONT_MONO}}>Nothing on the books today.</div>
          ):(
            bizData.map(({b,i,urgent,todayEvs,tasks})=>(
              <div key={b.id} style={{marginBottom:20}}>
                {/* Business header — tappable to navigate */}
                <div onClick={()=>{onClose();onNavigate(i);}} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8,cursor:"pointer"}}>
                  <div style={{width:4,height:20,background:b.color,borderRadius:2,flexShrink:0}}/>
                  <div style={{fontSize:12,fontWeight:800,color:b.color,fontFamily:FONT_MONO,letterSpacing:1.5}}>{b.name.toUpperCase()}</div>
                  <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",fontFamily:FONT_MONO,marginLeft:"auto"}}>TAP TO OPEN ›</div>
                </div>
                {/* Today's events */}
                {todayEvs.length>0&&(
                  <div style={{marginBottom:urgent.length>0?10:0}}>
                    <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:6,paddingLeft:14}}>SCHEDULE</div>
                    {todayEvs.map(ev=>(
                      <div key={ev.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"7px 14px",borderRadius:8,background:"rgba(255,255,255,0.03)",marginBottom:3}}>
                        <span style={{fontSize:10,color:"rgba(0,180,200,0.7)",fontFamily:FONT_MONO,minWidth:54,flexShrink:0,paddingTop:1}}>{ev.allDay?"ALL DAY":fmtTime(ev.start)}</span>
                        <span style={{fontSize:13,color:"rgba(255,255,255,0.85)",fontFamily:FONT,lineHeight:1.4}}>{ev.summary}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Urgent tasks */}
                {urgent.length>0&&(
                  <div>
                    <div style={{fontSize:9,color:"rgba(255,59,59,0.6)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:6,paddingLeft:14}}>URGENT</div>
                    {urgent.map((t,idx)=>(
                      <div key={t.id||idx} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 14px",borderRadius:8,background:"rgba(255,59,59,0.05)",border:"1px solid rgba(255,59,59,0.12)",marginBottom:3}}>
                        <span style={{fontSize:10,color:"#FF3B3B",flexShrink:0}}>⚠</span>
                        <span style={{fontSize:13,color:"rgba(255,255,255,0.8)",fontFamily:FONT,lineHeight:1.4}}>{t.title||t.text}</span>
                        {t.dueDate&&<span style={{fontSize:9,color:"rgba(255,59,59,0.5)",fontFamily:FONT_MONO,marginLeft:"auto",flexShrink:0}}>{t.dueDate}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,document.body);
}

const EXAMPLE_GOALS=[
  {id:"ex1",title:"Run 50 miles",target:50,current:18,unit:"miles",color:"#43A047",isExample:true,createdAt:new Date().toISOString(),lastLogged:"2026-04-14",streak:3},
  {id:"ex2",title:"Save $2,000",target:2000,current:1200,unit:"dollars",color:"#3B5BDB",isExample:true,createdAt:new Date().toISOString(),lastLogged:"2026-04-15",streak:7},
  {id:"ex3",title:"Read 12 books",target:12,current:3,unit:"books",color:"#FF7043",isExample:true,createdAt:new Date().toISOString(),lastLogged:"2026-04-12",streak:1},
  {id:"ex4",title:"Pay off $3,000",target:3000,current:1350,unit:"dollars",color:"#AB47BC",isExample:true,createdAt:new Date().toISOString(),lastLogged:"2026-04-15",streak:12},
];

function parseVoiceNumber(text){
  const WORD_MAP={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
    eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,
    eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,
    seventy:70,eighty:80,ninety:90,hundred:100,thousand:1000};
  const lower=text.toLowerCase();
  for(const [word,val] of Object.entries(WORD_MAP)){
    if(new RegExp(`\\b${word}\\b`).test(lower))return val;
  }
  const m=text.match(/[\d,.]+/);
  if(m)return parseFloat(m[0].replace(/,/g,""));
  return null;
}

function daysAgo(dateStr){
  if(!dateStr)return null;
  const d=new Date(dateStr+"T12:00:00");
  const now=new Date();
  const diff=Math.floor((now-d)/(1000*60*60*24));
  return diff;
}

function streakLabel(streak){
  if(!streak||streak<1)return null;
  return `${streak}d streak`;
}

function hexToRgbStr(hex){
  const h=hex.replace("#","");
  const r=parseInt(h.substring(0,2),16)||0;
  const g=parseInt(h.substring(2,4),16)||0;
  const b=parseInt(h.substring(4,6),16)||0;
  return`${r},${g},${b}`;
}

// Lava lamp — contrasting color pairings per goal color
const LAMP_PAIRS={
  "#EF5350":{fluid:"#1A237E",blob:"#CE93D8",blob2:"#9C27B0"},
  "#FF7043":{fluid:"#004D40",blob:"#26C6DA",blob2:"#00838F"},
  "#F59E0B":{fluid:"#1A237E",blob:"#CE93D8",blob2:"#7B1FA2"},
  "#43A047":{fluid:"#1A0033",blob:"#F48FB1",blob2:"#AD1457"},
  "#3B5BDB":{fluid:"#7B1900",blob:"#FFAB40",blob2:"#E64A19"},
  "#42A5F5":{fluid:"#1B5E20",blob:"#FFF176",blob2:"#F9A825"},
  "#AB47BC":{fluid:"#004D40",blob:"#FFD54F",blob2:"#F57F17"},
  "#0097A7":{fluid:"#4A148C",blob:"#FF80AB",blob2:"#F06292"},
};
const LAMP_DEFAULT={fluid:"#1A237E",blob:"#AB47BC",blob2:"#CE93D8"};

function ArcRing({pct,color,size}){
  const pair=LAMP_PAIRS[color]||LAMP_DEFAULT;
  const fp=Math.min(100,Math.max(0,pct));
  const SIZE=size||64;
  const cx=SIZE/2;
  const cy=SIZE/2;
  const r=SIZE*0.406;
  const strokeW=SIZE*0.07;
  const circ=2*Math.PI*r;
  const offset=circ*(1-fp/100);
  const angleDeg=(fp/100)*360-90;
  const angleRad=angleDeg*Math.PI/180;
  const dotX=+(cx+r*Math.cos(angleRad)).toFixed(2);
  const dotY=+(cy+r*Math.sin(angleRad)).toFixed(2);
  const glowId=`ag_${color.replace("#","")}${SIZE}`;
  const fsSm=SIZE*0.17;
  const fsDone=SIZE*0.155;
  const dotR=SIZE*0.07;
  const dotPulseR=SIZE*0.109;
  return(
    <div style={{position:"relative",width:SIZE,height:SIZE,flexShrink:0}}>
      <svg width={SIZE} height={SIZE} style={{overflow:"visible"}}>
        <defs>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeW}/>
        {fp>0&&(
          <circle cx={cx} cy={cy} r={r}
            fill="none" stroke={pair.blob}
            strokeWidth={strokeW} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              filter:`drop-shadow(0 0 4px ${pair.blob}) drop-shadow(0 0 10px ${pair.blob}77)`,
              transition:"stroke-dashoffset 0.65s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          />
        )}
        {fp>0&&fp<100&&(
          <>
            <g style={{transformOrigin:`${dotX}px ${dotY}px`,animation:"arcPulse 2s ease-out infinite"}}>
              <circle cx={dotX} cy={dotY} r={dotPulseR} fill="none" stroke={pair.blob} strokeWidth={1.5} opacity={0.55}/>
            </g>
            <circle cx={dotX} cy={dotY} r={dotR} fill={pair.blob} filter={`url(#${glowId})`}/>
          </>
        )}
        <text x={cx} y={cy+0.5} textAnchor="middle" dominantBaseline="middle"
          fill={fp>0?pair.blob:"rgba(255,255,255,0.18)"}
          fontSize={fp>=100?fsDone:fsSm} fontWeight="800"
          fontFamily="'JetBrains Mono',monospace"
          style={{filter:fp>0?`drop-shadow(0 0 6px ${pair.blob}99)`:"none"}}>
          {fp>=100?"DONE":`${fp}%`}
        </text>
      </svg>
    </div>
  );
}

function GoalVoiceButton({onTap,listening,color}){
  const segH=3,segGap=1;
  const mask=`repeating-linear-gradient(to top,#000 0px,#000 ${segH}px,transparent ${segH}px,transparent ${segH+segGap}px)`;
  return(
    <div onClick={onTap} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"pointer",padding:"8px 16px",borderRadius:12,background:listening?`${color||"#3B5BDB"}22`:"transparent",border:listening?`1px solid ${color||"#3B5BDB"}44`:"1px solid transparent",transition:"all 0.2s"}}>
      <div style={{display:"flex",alignItems:"flex-end",gap:3}}>
        {BAR_CONF.map((b,i)=>(
          <div key={i} style={{
            width:7,height:36,borderRadius:1,
            transformOrigin:"bottom center",
            background:BAR_GRADIENTS[i],
            maskImage:mask,
            WebkitMaskImage:mask,
            animation:`${b.ha} ${b.hd} linear ${b.hd2} infinite,eqOp ${b.od} ease-in-out ${b.od2} infinite`,
          }}/>
        ))}
      </div>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:listening?"#fff":"rgba(255,255,255,0.5)",fontFamily:FONT_MONO,transition:"color 0.2s"}}>{listening?"LISTENING":"VOICE"}</div>
      <div style={{fontSize:8,color:listening?`${color||"#3B5BDB"}`:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,letterSpacing:0.5}}>tap to talk</div>
    </div>
  );
}

function GoalsWidget({onBack}){
  const isMobile=window.innerWidth<768;
  const[goals,setGoals]=useState(()=>{
    try{const s=localStorage.getItem("cp_goals");return s?JSON.parse(s):[];}catch{return[];}
  });
  const[dismissedExamples,setDismissedExamples]=useState(()=>{
    try{const s=localStorage.getItem("cp_goals_dismissed_ex");return s?JSON.parse(s):[];}catch{return[];}
  });
  const[showAdd,setShowAdd]=useState(false);
  const[newTitle,setNewTitle]=useState("");
  const[newTarget,setNewTarget]=useState("");
  const[newUnit,setNewUnit]=useState("");
  const[newColor,setNewColor]=useState("#FF7043");
  const[newStep,setNewStep]=useState("1");
  // Edit state
  const[editGoalId,setEditGoalId]=useState(null);
  const[editTitle,setEditTitle]=useState("");
  const[editTarget,setEditTarget]=useState("");
  const[editUnit,setEditUnit]=useState("");
  // Voice state
  const[voiceGoalId,setVoiceGoalId]=useState(null);
  const[voiceTranscript,setVoiceTranscript]=useState("");
  const[voiceStatus,setVoiceStatus]=useState("");
  const[voiceStatusFor,setVoiceStatusFor]=useState(null);
  const voiceRef=useRef(null);

  const save=(list)=>{setGoals(list);try{localStorage.setItem("cp_goals",JSON.stringify(list));}catch{}};
  const saveDismissed=(list)=>{setDismissedExamples(list);try{localStorage.setItem("cp_goals_dismissed_ex",JSON.stringify(list));}catch{}};

  const todayDate=new Date().toISOString().split("T")[0];

  const logProgressAmount=(id,amt)=>{
    if(isNaN(amt)||amt<=0)return;
    save(goals.map(g=>{
      if(g.id!==id)return g;
      const newCurrent=Math.min(g.target,g.current+amt);
      const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
      const yStr=yesterday.toISOString().split("T")[0];
      const newStreak=(g.lastLogged===todayDate)?g.streak||1:(g.lastLogged===yStr)?(g.streak||0)+1:1;
      return{...g,current:newCurrent,lastLogged:todayDate,streak:newStreak};
    }));
  };

  const startVoice=(goalId)=>{
    if(voiceGoalId===goalId){stopVoice();return;}
    stopVoice();
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)){setVoiceStatus("Voice not supported");return;}
    setVoiceGoalId(goalId);setVoiceTranscript("");setVoiceStatus("");
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=false;rec.interimResults=true;rec.lang="en-US";
    rec.onresult=(e)=>{let t="";for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setVoiceTranscript(t);};
    rec.onend=()=>{
      setVoiceGoalId(vid=>{
        if(vid===goalId){
          setVoiceTranscript(tr=>{
            const num=parseVoiceNumber(tr);
            if(num&&num>0){logProgressAmount(goalId,num);setVoiceStatus(`+${num} logged`);setVoiceStatusFor(goalId);setTimeout(()=>{setVoiceStatus("");setVoiceStatusFor(null);},2500);}
            else if(tr.trim()){setVoiceStatus("No number found — try again");setVoiceStatusFor(goalId);setTimeout(()=>{setVoiceStatus("");setVoiceStatusFor(null);},3000);}
            return"";
          });
        }
        return null;
      });
    };
    rec.onerror=(e)=>{if(e.error!=="no-speech"){setVoiceStatus("Mic error");setVoiceStatusFor(goalId);setTimeout(()=>{setVoiceStatus("");setVoiceStatusFor(null);},3000);}setVoiceGoalId(null);};
    voiceRef.current=rec;rec.start();
  };
  const stopVoice=()=>{if(voiceRef.current){try{voiceRef.current.stop();}catch(e){}}voiceRef.current=null;};

  const useExample=(ex)=>{
    const g={...ex,id:`g_${Date.now()}`,isExample:false,createdAt:new Date().toISOString()};
    save([...goals,g]);
    saveDismissed([...dismissedExamples,ex.id]);
  };
  const dismissExample=(id)=>saveDismissed([...dismissedExamples,id]);

  const addGoal=()=>{
    if(!newTitle.trim()||!newTarget)return;
    const stepVal=parseFloat(newStep)||1;
    const g={id:`g_${Date.now()}`,title:newTitle.trim(),target:parseFloat(newTarget)||100,current:0,unit:newUnit.trim()||"",color:newColor,step:stepVal,isExample:false,createdAt:new Date().toISOString(),lastLogged:null,streak:0};
    save([...goals,g]);
    setNewTitle("");setNewTarget("");setNewUnit("");setNewColor("#FF7043");setNewStep("1");setShowAdd(false);
  };

  const deleteGoal=(id)=>save(goals.filter(g=>g.id!==id));
  const resetGoal=(id)=>save(goals.map(g=>g.id===id?{...g,current:0,lastLogged:null,streak:0}:g));
  const startEdit=(g)=>{setEditGoalId(g.id);setEditTitle(g.title);setEditTarget(String(g.target));setEditUnit(g.unit||"");};
  const saveEdit=(id)=>{
    if(!editTitle.trim()||!editTarget)return;
    save(goals.map(g=>g.id===id?{...g,title:editTitle.trim(),target:parseFloat(editTarget)||g.target,unit:editUnit.trim()}:g));
    setEditGoalId(null);
  };

  const visibleExamples=EXAMPLE_GOALS.filter(e=>!dismissedExamples.includes(e.id)&&!goals.some(g=>g.title===e.title));
  const GOAL_COLORS=["#EF5350","#FF7043","#F59E0B","#43A047","#3B5BDB","#42A5F5","#AB47BC","#0097A7"];

  const goalPrompt=(g)=>{
    const u=(g.unit||"").toLowerCase();
    if(u.includes("dollar")||u.includes("$"))return"How much did you save?";
    if(u.includes("mile"))return"How far did you go?";
    if(u.includes("book"))return"How many did you finish?";
    if(u.includes("hour"))return"How many hours?";
    return"How much progress today?";
  };

  return(
    <div style={{padding:"16px",paddingBottom:"80px",display:"flex",flexDirection:"column",gap:16}}>
      {/* Persistent brand header — same as Overview */}
      <div style={{position:"sticky",top:0,zIndex:50,background:"linear-gradient(180deg,#0e1320 80%,transparent 100%)",paddingTop:isMobile?"14px":"32px",paddingBottom:12,marginBottom:-4}}>
        <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?22:32,fontWeight:900,letterSpacing:-1,color:"#F59E0B",lineHeight:1.1}}><span style={{color:"#F59E0B"}}>command</span><br/><span style={{color:"#EF5350"}}>personal.</span></div>
        <div style={{fontSize:isMobile?10:13,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginTop:6,fontWeight:500,fontFamily:FONT_MONO}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      </div>

      {/* Goals section header */}
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.7)",borderRadius:9,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>← Back</button>
        <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?16:20,fontWeight:800,letterSpacing:-0.3,lineHeight:1}}>
          <span style={{color:"#FF7043"}}>goals</span><span style={{color:"rgba(255,255,255,0.3)"}}>.</span>
        </div>
      </div>

      {/* Add goal button */}
      <button onClick={()=>setShowAdd(v=>!v)} style={{background:showAdd?"rgba(255,112,67,0.12)":"rgba(255,112,67,0.1)",border:`1px solid ${showAdd?"#FF7043":"rgba(255,112,67,0.3)"}`,color:"#FF7043",borderRadius:12,padding:"12px 0",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:FONT,width:"100%",transition:"all 0.15s"}}>
        {showAdd?"✕ Cancel":"+ Add New Goal"}
      </button>

      {/* Add goal form */}
      {showAdd&&(
        <div style={{background:"rgba(255,112,67,0.08)",border:"1px solid rgba(255,112,67,0.3)",borderRadius:16,padding:20,display:"flex",flexDirection:"column",gap:12,animation:"fadeSlideIn 0.2s ease-out"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#FF7043",fontFamily:FONT_MONO,letterSpacing:1.5}}>NEW GOAL</div>
          <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="What are you working toward?" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
          <div style={{display:"flex",gap:10}}>
            <input value={newTarget} onChange={e=>setNewTarget(e.target.value)} placeholder="Target (e.g. 14)" type="number" style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
            <input value={newUnit} onChange={e=>setNewUnit(e.target.value)} placeholder="Unit (days, reps…)" style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontFamily:FONT_MONO,letterSpacing:1,flexShrink:0}}>INCREMENT BY</div>
            <select value={newStep} onChange={e=>setNewStep(e.target.value)} style={{flex:1,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:9,padding:"10px 14px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}>
              <option value="1">1 (days, reps, sessions)</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="0.5">0.5</option>
              <option value="0.1">0.1 (miles, dollars)</option>
            </select>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
            {GOAL_COLORS.map(c=>(
              <div key={c} onClick={()=>setNewColor(c)} style={{width:24,height:24,borderRadius:"50%",background:c,cursor:"pointer",border:newColor===c?"3px solid #fff":"2px solid transparent",boxSizing:"border-box",boxShadow:newColor===c?`0 0 8px ${c}88`:"none",transition:"all 0.15s"}}/>
            ))}
          </div>
          <button onClick={addGoal} style={{padding:"12px 0",background:newTitle.trim()&&newTarget?"#FF7043":"rgba(255,255,255,0.08)",border:"none",color:newTitle.trim()&&newTarget?"#fff":"rgba(255,255,255,0.25)",borderRadius:9,fontSize:14,fontWeight:800,cursor:newTitle.trim()&&newTarget?"pointer":"default",fontFamily:FONT}}>Add Goal</button>
        </div>
      )}

      {/* Active goals */}
      {goals.length===0&&visibleExamples.length===0&&(
        <div style={{textAlign:"center",padding:"48px 24px",color:"rgba(255,255,255,0.35)",fontSize:14,lineHeight:1.6}}>
          What are you working toward?<br/>
          <span style={{fontSize:12}}>Tap the bars to log progress with your voice.</span>
        </div>
      )}

      {goals.map(g=>{
        const pct=Math.round(Math.min(100,g.current/g.target*100));
        const done=pct>=100;
        const isListening=voiceGoalId===g.id;
        const da=daysAgo(g.lastLogged);
        const sk=streakLabel(g.streak);
        return(
          <div key={g.id} style={{background:`linear-gradient(180deg,${g.color}14 0%,${g.color}06 100%)`,border:`1px solid ${g.color}30`,borderTop:`2px solid ${g.color}66`,borderRadius:16,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12,animation:"fadeSlideIn 0.2s ease-out"}}>
            {/* Title row */}
            {editGoalId===g.id?(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <input value={editTitle} onChange={e=>setEditTitle(e.target.value)} style={{background:"rgba(255,255,255,0.06)",border:`1px solid ${g.color}55`,borderRadius:8,padding:"8px 12px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
                <div style={{display:"flex",gap:8}}>
                  <input value={editTarget} onChange={e=>setEditTarget(e.target.value)} type="number" placeholder="Target" style={{flex:1,background:"rgba(255,255,255,0.06)",border:`1px solid ${g.color}55`,borderRadius:8,padding:"8px 12px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
                  <input value={editUnit} onChange={e=>setEditUnit(e.target.value)} placeholder="Unit" style={{flex:1,background:"rgba(255,255,255,0.06)",border:`1px solid ${g.color}55`,borderRadius:8,padding:"8px 12px",fontSize:14,color:"rgba(255,255,255,0.88)",fontFamily:FONT,outline:"none"}}/>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>saveEdit(g.id)} style={{flex:1,padding:"8px 0",background:g.color,border:"none",color:"#fff",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>Save</button>
                  <button onClick={()=>setEditGoalId(null)} style={{flex:1,padding:"8px 0",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.55)",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:FONT}}>Cancel</button>
                </div>
              </div>
            ):(
              <>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:15,fontWeight:700,color:"rgba(255,255,255,0.92)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.title}</span>
                      {sk&&<span style={{fontSize:9,fontWeight:700,color:"#F59E0B",fontFamily:FONT_MONO,letterSpacing:0.5,flexShrink:0}}>🔥 {sk}</span>}
                    </div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginTop:2}}>
                      {(g.step||1)>=1?Math.round(g.current):g.current} / {g.target}{g.unit?" "+g.unit:""} · {pct}%
                    </div>
                    {da!==null&&<div style={{fontSize:9,color:"rgba(255,255,255,0.22)",fontFamily:FONT_MONO,marginTop:3}}>{da===0?"Updated today":da===1?"Updated yesterday":`Updated ${da} days ago`}</div>}
                  </div>
                  {/* Edit / Reset / Delete */}
                  <div style={{display:"flex",gap:4,flexShrink:0}}>
                    <button onClick={()=>startEdit(g)} title="Edit goal" style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.25)",fontSize:13,cursor:"pointer",padding:"2px 5px",lineHeight:1,borderRadius:4,transition:"color 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.color=g.color}
                      onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.25)"}>✎</button>
                    <button onClick={()=>{if(window.confirm("Reset progress to 0?"))resetGoal(g.id);}} title="Reset progress" style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.25)",fontSize:11,cursor:"pointer",padding:"2px 5px",lineHeight:1,borderRadius:4,fontFamily:FONT_MONO,fontWeight:700,transition:"color 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.color="#F59E0B"}
                      onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.25)"}>RST</button>
                    <button onClick={()=>deleteGoal(g.id)} title="Delete goal" style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.18)",fontSize:16,cursor:"pointer",padding:"2px 4px",lineHeight:1,borderRadius:4,transition:"color 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.color="#EF5350"}
                      onMouseLeave={e=>e.currentTarget.style.color="rgba(255,255,255,0.18)"}>✕</button>
                  </div>
                </div>

                {/* EQ bar centered + ArcRing centered — side by side, full-width centered */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:24,padding:"8px 0 4px"}}>
                  {done
                    ?<div style={{fontSize:14,color:g.color,fontWeight:700,fontFamily:FONT_MONO,letterSpacing:1,textAlign:"center",lineHeight:1.4}}>🎉<br/>COMPLETE</div>
                    :<GoalVoiceButton onTap={()=>startVoice(g.id)} listening={isListening} color={g.color}/>
                  }
                  <ArcRing pct={pct} color={g.color}/>
                </div>

                {/* Voice recording state */}
                {isListening&&(
                  <div style={{textAlign:"center",padding:"6px 0",animation:"fadeSlideIn 0.15s ease-out"}}>
                    <div style={{fontSize:12,color:g.color,fontWeight:600,marginBottom:4}}>{goalPrompt(g)}</div>
                    {voiceTranscript&&<div style={{fontSize:14,color:"rgba(255,255,255,0.85)",fontWeight:500}}>{voiceTranscript}</div>}
                  </div>
                )}
                {voiceStatus&&voiceStatusFor===g.id&&(
                  <div style={{textAlign:"center",fontSize:12,fontWeight:700,color:voiceStatus.includes("logged")?"#43A047":"rgba(255,255,255,0.45)",fontFamily:FONT_MONO,animation:"fadeSlideIn 0.15s ease-out"}}>{voiceStatus}</div>
                )}

                {/* Progress bar — boosted contrast */}
                {!done&&(
                  <div style={{position:"relative",height:16,display:"flex",alignItems:"center"}}>
                    <div style={{position:"absolute",left:0,right:0,height:4,borderRadius:2,background:"rgba(255,255,255,0.14)",zIndex:0}}/>
                    <div style={{position:"absolute",left:0,width:`${pct}%`,height:4,borderRadius:2,background:`linear-gradient(90deg,${g.color}bb,${g.color})`,boxShadow:`0 0 6px ${g.color}66`,transition:"width 0.3s ease",pointerEvents:"none",zIndex:1}}/>
                    <input type="range" className="goal-slider" style={{"--goal-color":g.color,position:"relative",zIndex:2}} min={0} max={g.target} step={g.step||1} value={g.current} onChange={e=>{const v=parseFloat(e.target.value);save(goals.map(gg=>gg.id===g.id?{...gg,current:v}:gg));}}/>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Example goals */}
      {visibleExamples.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,letterSpacing:1.5,paddingLeft:2}}>EXAMPLES — TAP TO USE</div>
          {visibleExamples.map(ex=>{
            const pct=Math.round(Math.min(100,ex.current/ex.target*100));
            const sk=streakLabel(ex.streak);
            return(
              <div key={ex.id} style={{background:`linear-gradient(180deg,${ex.color}10 0%,${ex.color}04 100%)`,border:`1px solid ${ex.color}22`,borderTop:`2px solid ${ex.color}44`,borderRadius:14,padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.75)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ex.title}</span>
                      {sk&&<span style={{fontSize:9,fontWeight:700,color:"#F59E0B",fontFamily:FONT_MONO,flexShrink:0}}>🔥 {sk}</span>}
                    </div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,marginTop:2}}>{ex.current} / {ex.target} {ex.unit} · {pct}%</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:5,flexShrink:0}}>
                    <button onClick={()=>useExample(ex)} style={{background:ex.color,border:"none",color:"#fff",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT,whiteSpace:"nowrap"}}>Use this</button>
                    <button onClick={()=>dismissExample(ex.id)} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.35)",borderRadius:8,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:FONT}}>Dismiss</button>
                  </div>
                </div>
                {/* Mini thermometer + EQ preview */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:20,padding:"4px 0"}}>
                  <ArcRing pct={pct} color={ex.color} height={38}/>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,opacity:0.5}}>
                    <EQBars fab={false}/>
                    <div style={{fontSize:8,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,letterSpacing:1}}>VOICE</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Overview({state,allEvents,calLoading,onRefresh,onNavigate,gTasks,gTaskLists,authStatus,authToken,onCompleteGTask,onDeleteGTask,onAddTask,onAddCalEvent,onUpdateNote,onDeleteNote,onAddNote,deletedBizIds,onDeleteBiz,onEditBiz,bizOrder,onReorder}){
  const td=todayStr();
  const isMobile=window.innerWidth<768;
  const isAuthed=authStatus==="authed"||authStatus==="cached";
  // When authed, Google Tasks are the source of truth for task counts
  const gTasksFlat=gTaskLists.flatMap(list=>{
    const items=(gTasks[list.id]||[]).filter(t=>t.title&&t.title.trim());
    const b=BIZ.find(bz=>bz.name===list.title)||BIZ[6];
    const bi=BIZ.indexOf(b);
    return items.map(t=>{
      const notes=t.notes||"";
      const priMatch=notes.match(/Priority:\s*(High|Medium|Low)/i);
      const pri=priMatch?(priMatch[1].toLowerCase()==="high"?"high":priMatch[1].toLowerCase()==="low"?"low":"med"):"med";
      const dueDate=t.due?t.due.split("T")[0]:"";
      return{...t,priority:pri,dueDate,bizId:bi>=0?bi:6,text:t.title,done:false,isGoogle:true,listId:list.id};
    });
  });
  const localTasks=state.tasks.flatMap((arr,i)=>arr.map(t=>({...t,bizId:i})));
  const allTasks=isAuthed?gTasksFlat:localTasks;
  const urgentTasks=allTasks.filter(t=>!t.done&&(t.priority==="high"||(t.dueDate?t.dueDate<=td:t.due&&t.due<=td)));
  const totalTasks=allTasks.filter(t=>!t.done).length;
  const sevenDays=new Date();sevenDays.setDate(sevenDays.getDate()+7);
  const upcoming=allEvents.filter(ev=>{const d=(ev.start||"").split("T")[0];return d>=td&&new Date(d)<=sevenDays;});
  const[statOpen,setStatOpen]=useState(null);
  const[briefOpen,setBriefOpen]=useState(false);
  const[selectedNote,setSelectedNote]=useState(null);
  const[unreadMail,setUnreadMail]=useState(null);
  const notesFlat=(state.notes||[]).flatMap((arr,i)=>arr.map(n=>({...n,bizId:i})));
  const token=authToken||window._dwsToken||null;
  useEffect(()=>{
    const t=authToken||window._dwsToken;
    if(!isAuthed||!t)return;
    fetch("https://www.googleapis.com/gmail/v1/users/me/labels/INBOX",{headers:{Authorization:`Bearer ${t}`}})
      .then(r=>r.json()).then(d=>{console.log("[Gmail INBOX label]",d);setUnreadMail(d.messagesUnread??0);}).catch(e=>console.error("[Gmail label err]",e));
  },[isAuthed,authToken]);
  const sensors=useSensors(
    useSensor(PointerSensor,{activationConstraint:{distance:8}}),
    useSensor(TouchSensor,{activationConstraint:{delay:200,tolerance:8}})
  );
  const visibleOrder=(bizOrder||BIZ.map((_,i)=>i)).filter(i=>!(deletedBizIds||[]).includes(i)&&!BIZ[i].hidden);
  const handleDragEnd=(event)=>{
    const{active,over}=event;
    if(over&&active.id!==over.id){
      const order=bizOrder||BIZ.map((_,i)=>i);
      const oldIdx=order.indexOf(active.id);
      const newIdx=order.indexOf(over.id);
      onReorder(arrayMove(order,oldIdx,newIdx));
    }
  };
  const statCards=[
    {key:"tasks",label:"TASKS",val:allTasks.filter(t=>!t.done).length,color:"#3B5BDB",gradient:"linear-gradient(135deg, #3B5BDB, #6B8EFF)"},
    {key:"urgent",label:"URGENT",val:urgentTasks.length,color:"#C62828",gradient:"linear-gradient(135deg, #C62828, #EF5350)"},
    {key:"upcoming",label:"UPCOMING",val:upcoming.length,color:"#0097A7",gradient:"linear-gradient(135deg, #0097A7, #00BCD4)"},
    {key:"notes",label:"NOTES",val:notesFlat.length,color:"#EF5350",gradient:"linear-gradient(135deg, #EF5350, #FF8A80)"},
    {key:"mail",label:"MAIL",val:unreadMail==null?"-":unreadMail>99?"99+":unreadMail,color:"#EF5350",gradient:"linear-gradient(135deg, #EF5350, #FF8A80)"},
  ];
  const statItems=statOpen==="tasks"?allTasks.filter(t=>!t.done):statOpen==="urgent"?urgentTasks:statOpen==="upcoming"?upcoming:statOpen==="notes"?[...notesFlat].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)):[];
  const statActiveCard=statCards.find(c=>c.key===statOpen&&c.key!=="mail");
  return(
    <div style={{padding:"16px",paddingTop:isMobile?"0":"0",paddingBottom:"80px",display:"flex",flexDirection:"column",gap:20}}>
      <div style={{position:"sticky",top:0,zIndex:50,background:"linear-gradient(180deg,#0e1320 80%,transparent 100%)",paddingTop:isMobile?"14px":"32px",paddingBottom:12,marginBottom:-4}}>
        <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?22:32,fontWeight:900,letterSpacing:-1,color:"#F59E0B",lineHeight:1.1}}><span style={{color:"#F59E0B"}}>command</span><br/><span style={{color:"#EF5350"}}>personal.</span></div>
        <div style={{fontSize:isMobile?10:13,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginTop:6,fontWeight:500,fontFamily:FONT_MONO}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      </div>
      <div style={{display:"flex",gap:20,alignItems:"flex-start",width:"100%"}}>
      <div style={{display:"flex",flexDirection:"column",gap:12,flex:1,minWidth:0,maxWidth:580}}>
      <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%",maxWidth:520}}>
        <StatCards allTasks={allTasks.filter(t=>!t.done)} urgentTasks={urgentTasks} upcoming={upcoming} allNotes={state.notes} open={statOpen} onOpen={setStatOpen} unreadMail={unreadMail}/>
        {statOpen&&statActiveCard&&(
          <div style={{background:"rgba(14,20,38,0.97)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderRadius:20,border:`2px solid ${statActiveCard.color}44`,boxShadow:`0 8px 40px rgba(0,0,0,0.5), 0 0 0 1px ${statActiveCard.color}22 inset`,overflow:"hidden",animation:"fadeSlideIn 0.3s ease-out",maxHeight:"40vh",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"16px 20px",background:statActiveCard.gradient,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{fontSize:14,fontWeight:800,color:"#fff",letterSpacing:1.5,fontFamily:FONT_MONO}}>{statActiveCard.label} ({statActiveCard.val})</div>
              <button onClick={()=>setStatOpen(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:28,height:28,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{"\u2715"}</button>
            </div>
            <div style={{overflow:"auto",padding:"8px 16px",flex:1,minHeight:0,WebkitOverflowScrolling:"touch"}}>
              {selectedNote&&<NoteModal note={selectedNote} biz={BIZ[selectedNote.bizId]} bizId={selectedNote.bizId} onClose={()=>setSelectedNote(null)} onUpdate={(bi,nid,updates)=>{onUpdateNote?.(bi,nid,updates);setSelectedNote(n=>({...n,...updates}));}} onDelete={onDeleteNote} onAddTask={onAddTask}/>}
              {statItems.length===0&&<div style={{padding:"16px 0",color:"rgba(255,255,255,0.35)",fontSize:14,textAlign:"center"}}>Nothing here</div>}
              {statItems.map((item,i)=>{
                if(statOpen==="notes"){
                  const b=BIZ[item.bizId]||BIZ[6];
                  return(
                    <div key={item.id||i} onClick={()=>setSelectedNote(item)}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"10px 6px",borderBottom:i<statItems.length-1?"1px solid #f0f0f5":"none",cursor:"pointer",transition:"background 0.15s",borderRadius:8}}
                      onMouseEnter={e=>e.currentTarget.style.background="#f8f6fc"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {item.pinned&&<span style={{fontSize:11,flexShrink:0}}>{"\uD83D\uDCCC"}</span>}
                      <div style={{width:4,alignSelf:"stretch",borderRadius:2,background:b.color,flexShrink:0}}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2}}>
                          <span style={{fontSize:10,color:b.color,fontFamily:FONT_MONO,fontWeight:700}}>{b.short}</span>
                          <span style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO}}>{fmtNoteDate(item.timestamp)} \u00B7 {fmtNoteTime(item.timestamp)}</span>
                        </div>
                        <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.content}</div>
                      </div>
                      <span style={{fontSize:12,color:"#ccc",flexShrink:0}}>{"\u203A"}</span>
                    </div>
                  );
                }
                const isEvent=!!item.summary;
                const biz=BIZ[item.bizId]||BIZ[6];
                return(
                  <div key={item.id||i} onClick={()=>{onNavigate(item.bizId);setStatOpen(null);}}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"12px 6px",borderBottom:i<statItems.length-1?"1px solid rgba(255,255,255,0.06)":"none",cursor:"pointer",transition:"background 0.15s",borderRadius:8}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    {!isEvent&&item.isGoogle&&(
                      <input type="checkbox" checked={false} onChange={(e)=>{e.stopPropagation();onCompleteGTask(item.listId,item.id);}} style={{accentColor:biz.color,flexShrink:0,cursor:"pointer",width:18,height:18}}/>
                    )}
                    <div style={{width:4,alignSelf:"stretch",borderRadius:2,background:biz.color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:600,color:"rgba(255,255,255,0.88)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{isEvent?item.summary:item.text||item.title}</div>
                      <div style={{display:"flex",gap:8,marginTop:3,alignItems:"center"}}>
                        <span style={{fontSize:11,color:BIZ_TEXT[item.bizId],fontWeight:700}}>{biz.short}</span>
                        {!isEvent&&<span style={{fontSize:10,color:PRI[item.priority],fontWeight:700}}>{PRI_LABELS[item.priority]?.toUpperCase()}</span>}
                        {isEvent&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>{fmtDate(item.start)}{!item.allDay&&" · "+fmtTime(item.start)}</span>}
                        {!isEvent&&(item.dueDate||item.due)&&<span style={{fontSize:11,color:"rgba(255,255,255,0.35)"}}>Due: {fmtDate(item.dueDate||item.due)}</span>}
                      </div>
                    </div>
                    <span style={{fontSize:12,color:"#ccc",flexShrink:0}}>{"\u203A"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      {/* Gmail Inbox Panel — full width */}
      {statOpen==="mail"&&token&&(
        <div style={{background:"rgba(14,20,38,0.97)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",borderRadius:20,border:"2px solid #EF535044",boxShadow:"0 8px 40px rgba(0,0,0,0.5)",overflow:"hidden",animation:"fadeSlideIn 0.3s ease-out",maxHeight:"65vh",display:"flex",flexDirection:"column",width:"100%",maxWidth:800}}>
          <div style={{padding:"14px 20px",background:"linear-gradient(135deg,#EF5350,#FF8A80)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <div style={{fontSize:14,fontWeight:800,color:"#fff",letterSpacing:1.5,fontFamily:FONT_MONO}}>✉ INBOX</div>
            <button onClick={()=>setStatOpen(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:28,height:28,borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          </div>
          <div style={{overflow:"auto",padding:"8px 16px",flex:1}}>
            <GmailPanel token={token} unreadCount={unreadMail} onClose={()=>setStatOpen(null)}/>
          </div>
        </div>
      )}
        <DailySheetCard authToken={authToken}/>
      {/* Daily Brief — always visible */}
      {(()=>{
        const hasBriefData=BIZ.some((b,i)=>{
          const u=urgentTasks.filter(t=>t.bizId===i).length;
          const todayEv=allEvents.filter(ev=>ev.bizId===i&&(ev.start||"").split("T")[0]===td).length;
          return u>0||todayEv>0;
        });
        return(
          <div onClick={()=>setBriefOpen(true)} style={{background:'#080c14',borderRadius:20,border:'1px solid rgba(0,180,200,0.18)',padding:'14px 16px',
            backgroundImage:'linear-gradient(rgba(0,180,200,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,200,0.03) 1px,transparent 1px)',
            backgroundSize:'22px 22px',boxShadow:'0 4px 30px rgba(0,0,0,0.5),inset 0 1px 0 rgba(0,180,200,0.08)',cursor:'pointer',transition:'border-color 0.15s',
            minHeight:130}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(0,180,200,0.35)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(0,180,200,0.18)'}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:800,color:'#EF5350',letterSpacing:2,fontFamily:FONT_MONO}}>⚡ TODAY'S BRIEF</div>
              <div style={{fontSize:9,color:'rgba(0,180,200,0.5)',fontFamily:FONT_MONO,letterSpacing:1}}>TAP TO OPEN ›</div>
            </div>
            {hasBriefData
              ?<div style={{display:'flex',flexDirection:'column',gap:4}}>
                {BIZ.map((b,i)=>{
                  const u=urgentTasks.filter(t=>t.bizId===i).length;
                  const todayEvs=allEvents.filter(ev=>ev.bizId===i&&(ev.start||"").split("T")[0]===td);
                  if(u===0&&todayEvs.length===0)return null;
                  return(
                    <div key={b.id} style={{display:'flex',alignItems:'center',gap:0,borderRadius:8,overflow:'hidden'}}>
                      <div style={{width:3,alignSelf:'stretch',background:b.color,flexShrink:0,borderRadius:'2px 0 0 2px'}}/>
                      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',flex:1,minWidth:0}}>
                        <span style={{fontSize:10,fontWeight:800,color:b.color,fontFamily:FONT_MONO,minWidth:74,flexShrink:0,letterSpacing:0.3}}>{b.short.toUpperCase()}</span>
                        <div style={{display:'flex',gap:6,alignItems:'center',flex:1,minWidth:0,flexWrap:'wrap'}}>
                          {u>0&&<span style={{fontSize:9,fontWeight:800,color:'#FF3B3B',fontFamily:FONT_MONO,background:'rgba(255,59,59,0.12)',border:'1px solid rgba(255,59,59,0.3)',borderRadius:5,padding:'1px 6px',flexShrink:0}}>⚠ {u} URGENT</span>}
                          {todayEvs.slice(0,2).map(ev=>(
                            <span key={ev.id} style={{fontSize:9,color:'#EF5350',fontFamily:FONT_MONO,opacity:0.75,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:160}}>
                              {ev.allDay?'ALL DAY':fmtTime(ev.start)} · {ev.summary}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              :<div style={{fontSize:12,color:'rgba(255,255,255,0.25)',fontFamily:FONT_MONO,letterSpacing:1}}>All clear — nothing urgent today.</div>
            }
          </div>
        );
      })()}
      </div>{/* end outer left col */}
      {!isMobile&&<div style={{flex:1,display:"flex",justifyContent:"flex-start",alignItems:"flex-start",paddingLeft:120}}><CommandScore urgentTasks={urgentTasks}/></div>}
      </div>{/* end outer two-col */}
      {briefOpen&&<TodayBriefModal urgentTasks={urgentTasks} allEvents={allEvents} td={td} onNavigate={onNavigate} onClose={()=>setBriefOpen(false)} state={state} isAuthed={isAuthed} gTasksFlat={gTasksFlat||[]}/>}
      {(()=>{
        const liveGoals=(()=>{try{return JSON.parse(localStorage.getItem("cp_goals")||"[]");}catch{return[];}})();
        return(
          <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(8,minmax(0,175px))",gap:isMobile?8:12,width:isMobile?"100%":"fit-content"}}>
            {WIDGETS.map(w=>(
              <WidgetCard key={w.id} widget={w} goalsData={w.id==="goals"?liveGoals:null} onOpen={()=>w.id==="goals"?onNavigate("goals"):w.id==="budget"?onNavigate("budget"):null}/>
            ))}
          </div>
        );
      })()}
      <div style={panelSt("#C62828")}>
        <div style={{fontSize:13,fontWeight:800,color:"#C62828",letterSpacing:2,marginBottom:14}}>URGENT TASKS</div>
        {urgentTasks.length===0
          ?<div style={{fontSize:13,color:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,letterSpacing:0.5}}>No urgent tasks — you're clear.</div>
          :urgentTasks.map(t=>(
            <div key={t.id}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderBottom:"1px solid rgba(255,255,255,0.06)",borderLeft:"3px solid transparent",borderRadius:6,transition:"background 0.18s,border-left-color 0.18s",cursor:"default"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${BIZ[t.bizId].color}10`;e.currentTarget.style.borderLeftColor=BIZ[t.bizId].color;}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.borderLeftColor="transparent";}}>
              {t.isGoogle&&<input type="checkbox" checked={false} onChange={()=>onCompleteGTask(t.listId,t.id)} style={{accentColor:BIZ[t.bizId].color,flexShrink:0,cursor:"pointer",width:18,height:18}}/>}
              <div style={{width:4,alignSelf:"stretch",borderRadius:2,background:BIZ[t.bizId].color,flexShrink:0}}/>
              <div style={{flex:1,fontSize:15,color:"rgba(255,255,255,0.88)",fontWeight:500}}>{t.text||t.title}</div>
              <div style={{fontSize:12,color:BIZ_TEXT[t.bizId],fontWeight:700}}>{BIZ[t.bizId].short}</div>
            </div>
          ))
        }
      </div>
      <div style={panelSt("#0097A7")}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:800,color:"#00BCD4",letterSpacing:2}}>NEXT 7 DAYS {calLoading&&"(syncing...)"}</div>
          {authStatus==="authed"&&<button onClick={onRefresh} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.5)",borderRadius:6,padding:"5px 14px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>{"\u{1F504}"} REFRESH</button>}
        </div>
        {upcoming.length===0
          ?<div style={{fontSize:14,color:"rgba(255,255,255,0.3)",padding:"10px 0"}}>No upcoming events this week</div>
          :upcoming.map(ev=>(
            <div key={ev.id}
              style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:`${ev.color}12`,borderRadius:10,marginBottom:6,borderLeft:`4px solid ${ev.color}`,transition:"background 0.18s,box-shadow 0.18s",cursor:"default"}}
              onMouseEnter={e=>{e.currentTarget.style.background=`${ev.color}22`;e.currentTarget.style.boxShadow=`0 2px 12px ${ev.color}25`;}}
              onMouseLeave={e=>{e.currentTarget.style.background=`${ev.color}12`;e.currentTarget.style.boxShadow="none";}}>
              <div style={{flex:1}}>
                <div style={{fontSize:15,color:"rgba(255,255,255,0.88)",fontWeight:600}}>{ev.summary}</div>
                <div style={{fontSize:12,color:BIZ_TEXT[ev.bizId],marginTop:2,fontWeight:600}}>{BIZ[ev.bizId]?.short} · {fmtDate(ev.start).split(",")[0]}{!ev.allDay&&` · ${fmtTime(ev.start)}`}</div>
              </div>
            </div>
          ))
        }
      </div>
      <PlatformStrip/>
    </div>
  );
}

/* ── Command Bean Dialog — EQ popup query interface ── */
function CommandBeanDialog({state,allEvents,gTasks,gTaskLists,isAuthed,onClose,onNavigate,isMobile}){
  const[query,setQuery]=useState("");
  const[results,setResults]=useState(null);
  const[listening,setListening]=useState(false);
  const[recentQueries,setRecentQueries]=useState(()=>{try{return JSON.parse(localStorage.getItem("dws_cmd_recent")||"[]");}catch{return[];}});
  const recRef=useRef(null);
  const inputRef=useRef(null);
  const resultsRef=useRef(null);

  const td=todayStr();
  const localTasks=state.tasks.flatMap((arr,i)=>arr.map(t=>({...t,bizId:i})));
  const gTasksFlat=gTaskLists.flatMap(list=>{
    const b=BIZ.find(bz=>bz.name===list.title)||BIZ[6];const bi=BIZ.indexOf(b);
    return(gTasks[list.id]||[]).filter(t=>t.title&&t.title.trim()).map(t=>({...t,text:t.title,bizId:bi>=0?bi:6,isGoogle:true,listId:list.id}));
  });
  const allTasks=isAuthed?gTasksFlat:localTasks;
  const notesFlat=state.notes.flatMap((arr,i)=>arr.map(n=>({...n,bizId:i})));
  const urgentTasks=allTasks.filter(t=>!t.done&&(t.priority==="high"||(t.dueDate?t.dueDate<=td:t.due&&t.due<=td)));

  function parseQuery(q){
    const ql=q.toLowerCase().trim();
    const norm=s=>s.toLowerCase().replace(/['\u2018\u2019`]/g,"").replace(/\s+/g," ").trim();
    const qln=norm(ql);

    // "tasks for [biz]" / "show [biz] tasks"
    const qlWords=qln.split(/\s+/);
    console.log("[CMB query]",JSON.stringify(qln),"words:",qlWords);
    const bizMatch=BIZ.find(b=>{
      const nameWords=norm(b.name).split(/\s+/).filter(w=>w.length>=4);
      const shortLower=norm(b.short);
      const matched=nameWords.filter(nw=>qlWords.some(qw=>nw.startsWith(qw.slice(0,4))||qw.startsWith(nw.slice(0,4)))).length;
      // 1-2 key words: need all; 3+ key words: need at least 2 (handles "american terrapin" matching "american terrapin apparel")
      const fuzzy=nameWords.length>0&&(nameWords.length<=2?matched===nameWords.length:matched>=2);
      console.log("[CMB biz]",b.name,"keyWords:",nameWords,"matched:",matched,"fuzzy:",fuzzy);
      return fuzzy||qln.includes(shortLower);
    });
    console.log("[CMB bizMatch]",bizMatch?.name||"none");
    if(bizMatch&&(ql.includes("task")||ql.includes("todo"))){
      const bi=BIZ.indexOf(bizMatch);
      const items=allTasks.filter(t=>t.bizId===bi&&!t.done);
      return{type:"tasks",label:`Tasks — ${bizMatch.name}`,items,color:bizMatch.color,bizId:bi};
    }

    // "notes for [biz]" / "show [biz] notes"
    if(bizMatch&&ql.includes("note")){
      const bi=BIZ.indexOf(bizMatch);
      const items=[...notesFlat].filter(n=>n.bizId===bi).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
      return{type:"notes",label:`Notes — ${bizMatch.name}`,items,color:bizMatch.color,bizId:bi};
    }

    // "notes from [date] to [date]" / "notes april 10"
    if(ql.includes("note")){
      const MONTHS_RE=/(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})/gi;
      const dates=[];let m;
      while((m=MONTHS_RE.exec(ql))!==null){
        const mo=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].findIndex(x=>m[1].toLowerCase().startsWith(x));
        const day=parseInt(m[2]);
        if(mo>=0&&day>=1){const y=new Date().getFullYear();dates.push(new Date(y,mo,day).toISOString().split("T")[0]);}
      }
      if(dates.length>=2){
        const[from,to]=[dates[0],dates[1]].sort();
        const items=[...notesFlat].filter(n=>{const d=n.timestamp.split("T")[0];return d>=from&&d<=to;}).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
        return{type:"notes",label:`Notes — ${fmtDate(from)} to ${fmtDate(to)}`,items,color:"#7B1FA2"};
      }
      if(dates.length===1){
        const items=[...notesFlat].filter(n=>n.timestamp.startsWith(dates[0])).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
        return{type:"notes",label:`Notes — ${fmtDate(dates[0])}`,items,color:"#7B1FA2"};
      }
      // all notes
      const items=[...notesFlat].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
      return{type:"notes",label:"All Notes",items,color:"#7B1FA2"};
    }

    // "events for next [n] [weeks/days/months]" / "events this week"
    if(ql.includes("event")||ql.includes("calendar")||ql.includes("schedule")){
      let days=7;
      const dm=ql.match(/next\s+(\d+)\s+(day|week|month)/);
      if(dm){const n=parseInt(dm[1]);const u=dm[2];days=u.startsWith("month")?n*30:u.startsWith("week")?n*7:n;}
      else if(ql.includes("two month")||ql.includes("2 month"))days=60;
      else if(ql.includes("three month")||ql.includes("3 month"))days=90;
      else if(ql.includes("two week")||ql.includes("2 week"))days=14;
      else if(ql.includes("month"))days=30;
      const cutoff=new Date();cutoff.setDate(cutoff.getDate()+days);
      const cutoffStr=cutoff.toISOString().split("T")[0];
      let items=allEvents.filter(ev=>{const d=(ev.start||"").split("T")[0];return d>=td&&d<=cutoffStr;});
      if(bizMatch)items=items.filter(ev=>ev.bizId===BIZ.indexOf(bizMatch));
      items.sort((a,b)=>((a.start||"")<(b.start||""))?-1:1);
      return{type:"events",label:`Events — Next ${days} day${days===1?"":"s"}${bizMatch?` · ${bizMatch.name}`:""}`,items,color:"#0097A7"};
    }

    // "show [biz] summary" / "[biz]"
    if(bizMatch){
      const bi=BIZ.indexOf(bizMatch);
      const tasks=allTasks.filter(t=>t.bizId===bi&&!t.done);
      const notes=[...notesFlat].filter(n=>n.bizId===bi).slice(0,3);
      const events=allEvents.filter(ev=>ev.bizId===bi&&(ev.start||"").split("T")[0]>=td).slice(0,5);
      return{type:"summary",label:`Summary — ${bizMatch.name}`,tasks,notes,events,color:bizMatch.color,bizId:bi,biz:bizMatch};
    }

    // "urgent tasks"
    if(ql.includes("urgent")){
      return{type:"tasks",label:"Urgent Tasks",items:urgentTasks,color:"#C62828"};
    }

    // "all tasks"
    if(ql.includes("all task")||ql.includes("task")){
      return{type:"tasks",label:"All Tasks",items:allTasks.filter(t=>!t.done),color:"#E65100"};
    }

    return{type:"empty",label:"",items:[]};
  }

  function runQuery(q){
    if(!q.trim())return;
    const r=parseQuery(q);
    setResults(r);
    const updated=[q,...recentQueries.filter(x=>x!==q)].slice(0,4);
    setRecentQueries(updated);
    localStorage.setItem("dws_cmd_recent",JSON.stringify(updated));
    setTimeout(()=>resultsRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),100);
  }

  function startListen(){
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window))return;
    if(listening){recRef.current?._keepAlive&&(recRef.current._keepAlive=false);recRef.current?.stop();return;}
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=false;rec.interimResults=false;rec.lang="en-US";
    rec.onresult=(e)=>{const t=e.results[0][0].transcript;setQuery(t);runQuery(t);setTimeout(()=>setQuery(""),800);};
    rec.onend=()=>setListening(false);
    rec.onerror=()=>setListening(false);
    rec._keepAlive=false;recRef.current=rec;rec.start();setListening(true);
  }

  useEffect(()=>{setTimeout(()=>inputRef.current?.focus(),150);},[]);

  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:3000,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:isMobile?10:72,paddingLeft:16,paddingRight:16}}>
      {/* Backdrop */}
      <div onClick={onClose} style={{position:"absolute",inset:0,background:"rgba(15,15,30,0.65)",backdropFilter:"blur(4px)",WebkitBackdropFilter:"blur(4px)"}}/>
      {/* Dialog */}
      <div style={{position:"relative",width:"100%",maxWidth:540,background:"rgba(14,20,38,0.98)",borderRadius:20,border:"1.5px solid rgba(59,91,219,0.35)",boxShadow:"0 24px 64px rgba(0,0,0,0.6),0 4px 20px rgba(59,91,219,0.2)",animation:"fadeSlideIn 0.25s ease-out",overflow:"hidden",maxHeight:isMobile?"88vh":"80vh",display:"flex",flexDirection:"column"}}>

        {/* Header */}
        <div style={{background:"linear-gradient(135deg,#12192b,#1e2a44)",padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:34,height:34,borderRadius:9,background:"rgba(239,83,80,0.12)",border:"1px solid rgba(239,83,80,0.28)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontFamily:"Sora,sans-serif",fontWeight:800,fontSize:20,color:"#EF5350",lineHeight:1,userSelect:"none"}}>b</span>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:800,color:"#fff",letterSpacing:2,fontFamily:FONT_MONO}}>COMMAND BEAN MOGUL</div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.45)",letterSpacing:1,fontFamily:FONT_MONO,marginTop:1}}>search your data.</div>
            </div>
          </div>
          <button onClick={results?()=>setResults(null):onClose} style={{background:"rgba(255,255,255,0.1)",border:"none",color:"rgba(255,255,255,0.6)",width:28,height:28,borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:"14px",display:"flex",flexDirection:"column",gap:12}}>

          {/* Recent queries */}
          {recentQueries.length>0&&(
            <div>
              <div style={{fontSize:9,color:"rgba(255,255,255,0.3)",letterSpacing:1.5,fontFamily:FONT_MONO,fontWeight:700,marginBottom:7}}>RECENT</div>
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:6}}>
                {recentQueries.map((q,i)=>(
                  <button key={i} onClick={()=>{setQuery(q);runQuery(q);}}
                    style={{background:"#EF53500D",border:"1px solid #EF535030",borderRadius:10,padding:"7px 9px",cursor:"pointer",fontFamily:FONT_MONO,fontSize:10,color:"#EF5350",fontWeight:600,textAlign:"left",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",transition:"all 0.15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="#EF535020";e.currentTarget.style.borderColor="#EF535060";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="#EF53500D";e.currentTarget.style.borderColor="#EF535030";}}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input row */}
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input
              ref={inputRef}
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"){runQuery(query);setQuery("");}}}
              placeholder='e.g. "Spliffs DT tasks" · "events next 2 weeks"'
              style={{...iSt("#3B5BDB"),flex:1,fontSize:13,padding:"10px 13px"}}
            />
            <button onClick={startListen} title={listening?"Stop":"Voice query"}
              style={{...btnSt(listening?"#C62828":"#3B5BDB"),padding:"10px 12px",flexShrink:0,animation:listening?"pulseGlow 1s ease-in-out infinite":"none"}}>
              {listening?<Square size={14}/>:<Mic size={14}/>}
            </button>
          </div>

          {/* Results */}
          {results&&(
            <div ref={resultsRef} style={panelSt(results.color||"#EF5350")}>
              <div style={{fontSize:11,fontWeight:800,color:results.color||"#EF5350",letterSpacing:2,fontFamily:FONT_MONO,marginBottom:12}}>{results.label.toUpperCase()}</div>

              {results.type==="tasks"&&(
                results.items.length===0
                  ?<div style={{fontSize:13,color:"rgba(255,255,255,0.3)"}}>No tasks found</div>
                  :results.items.map((t,i)=>(
                    <div key={t.id||i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 10px",borderRadius:9,background:`${BIZ[t.bizId].color}08`,border:`1px solid ${BIZ[t.bizId].color}20`,marginBottom:5}}>
                      <div style={{width:3,alignSelf:"stretch",borderRadius:2,background:BIZ[t.bizId].color,flexShrink:0}}/>
                      <div style={{flex:1,fontSize:13,color:"rgba(255,255,255,0.88)",wordBreak:"break-word"}}>{t.text||t.title}</div>
                      <button onClick={()=>{onClose();onNavigate?.(t.bizId);}} style={{background:"none",border:"none",color:BIZ[t.bizId].color,fontSize:10,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,flexShrink:0}}>{BIZ[t.bizId].short} →</button>
                    </div>
                  ))
              )}

              {results.type==="notes"&&(
                results.items.length===0
                  ?<div style={{fontSize:13,color:"rgba(255,255,255,0.3)"}}>No notes found</div>
                  :results.items.map((n,i)=>{const b=BIZ[n.bizId];return(
                    <div key={n.id||i} style={{padding:"9px 11px",borderRadius:9,background:`${b.color}08`,border:`1px solid ${b.color}20`,marginBottom:7}}>
                      <span style={{fontSize:10,color:b.color,fontFamily:FONT_MONO,fontWeight:700}}>{b.short} · {fmtNoteDate(n.timestamp)} · {fmtNoteTime(n.timestamp)}</span>
                      <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.6,marginTop:4,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{n.content}</div>
                    </div>
                  );})
              )}

              {results.type==="events"&&(
                results.items.length===0
                  ?<div style={{fontSize:13,color:"rgba(255,255,255,0.3)"}}>No events found</div>
                  :results.items.map((ev,i)=>(
                    <div key={ev.id||i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 13px",background:`${ev.color}12`,borderRadius:9,marginBottom:5,borderLeft:`4px solid ${ev.color}`}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",fontWeight:600,wordBreak:"break-word"}}>{ev.summary}</div>
                        <div style={{fontSize:10,color:BIZ_TEXT[ev.bizId]||"#888",marginTop:2,fontFamily:FONT_MONO,fontWeight:600}}>{BIZ[ev.bizId]?.short} · {fmtDate(ev.start)}{!ev.allDay&&` · ${fmtTime(ev.start)}`}</div>
                      </div>
                    </div>
                  ))
              )}

              {results.type==="summary"&&(
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {[
                    {title:"TASKS",items:results.tasks,render:(t,i)=><div key={t.id||i} style={{fontSize:13,color:"rgba(255,255,255,0.88)",padding:"4px 0",borderBottom:"1px solid #f0f0f5"}}>{t.text||t.title}</div>},
                    {title:"UPCOMING EVENTS",items:results.events,render:(ev,i)=><div key={ev.id||i} style={{fontSize:13,color:"rgba(255,255,255,0.88)",padding:"4px 0",borderBottom:"1px solid #f0f0f5"}}>{ev.summary} <span style={{color:"rgba(255,255,255,0.35)",fontSize:11}}>· {fmtDate(ev.start)}</span></div>},
                    {title:"RECENT NOTES",items:results.notes,render:(n,i)=><div key={n.id||i} style={{fontSize:13,color:"rgba(255,255,255,0.88)",padding:"4px 0",borderBottom:"1px solid #f0f0f5",wordBreak:"break-word"}}>{n.content.split("\n")[0].slice(0,100)}</div>},
                  ].map(({title,items,render})=>(
                    <div key={title}>
                      <div style={{fontSize:9,fontWeight:800,color:results.color,letterSpacing:2,fontFamily:FONT_MONO,marginBottom:5}}>{title} ({items.length})</div>
                      {items.length===0?<div style={{fontSize:12,color:"rgba(255,255,255,0.3)"}}>None</div>:items.map(render)}
                    </div>
                  ))}
                  <button onClick={()=>{onClose();onNavigate?.(results.bizId);}} style={{...btnSt(results.color),alignSelf:"flex-start",fontSize:12,padding:"9px 18px"}}>
                    OPEN {results.biz.name.toUpperCase()} →
                  </button>
                </div>
              )}

              {results.type==="empty"&&(
                <div style={{fontSize:13,color:"rgba(255,255,255,0.3)",lineHeight:1.7}}>
                  Not sure — try:<br/>
                  <span style={{color:"rgba(255,255,255,0.4)",fontFamily:FONT_MONO,fontSize:11}}>"tasks for Spliffs DT" · "events next 2 weeks" · "ATA notes"</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function FixedVoice({currentBizId,isAuthed,onAddTask,onAddCalEvent,onAddNote,onOpenCommandBean,isMobile,onGoHome}){
  const[open,setOpen]=useState(false);
  const[step,setStep]=useState(1);
  const[mode,setMode]=useState(null);
  const[listening,setListening]=useState(false);
  const[transcript,setTranscript]=useState("");
  const[status,setStatus]=useState("");
  const recRef=useRef(null);
  useEffect(()=>{if(!open){setStep(1);setMode(null);setTranscript("");setStatus("");}},[open]);
  const VOICE_TYPES=[
    {key:"task",     label:"Task",         prompt:"What needs to get done?",        color:"#3B5BDB"},
    {key:"note",     label:"Note",         prompt:"What's on your mind?",           color:"#AB47BC"},
    {key:"expense",  label:"Expense",      prompt:"What did you spend?",            color:"#F59E0B"},
    {key:"goal",     label:"Goal",         prompt:"What are you working toward?",   color:"#FF7043"},
    {key:"habit",    label:"Habit",        prompt:"What did you do today?",         color:"#43A047"},
    {key:"subscription",label:"Subscription",prompt:"What are you paying for?",    color:"#0097A7"},
    {key:"calendar", label:"Calendar",     prompt:"What's happening and when?",     color:"#42A5F5"},
  ];
  const activeType=VOICE_TYPES.find(t=>t.key===mode);
  const stopRec=()=>{if(recRef.current){recRef.current._keepAlive=false;try{recRef.current.stop();}catch(e){}}};
  const startRec=()=>{
    if(!("webkitSpeechRecognition" in window||"SpeechRecognition" in window)){setStatus("Voice not supported");return;}
    setTranscript("");setStatus("");
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    const rec=new SR();rec.continuous=true;rec.interimResults=true;rec.lang="en-US";
    rec.onresult=(e)=>{let t="";for(let i=0;i<e.results.length;i++)t+=e.results[i][0].transcript;setTranscript(t);};
    rec.onend=()=>{if(recRef.current?._keepAlive){try{rec.start();}catch(e){setListening(false);}}else setListening(false);};
    rec.onerror=(e)=>{if(e.error==="no-speech")return;setListening(false);rec._keepAlive=false;setStatus("Mic error \u2014 try again");};
    rec._keepAlive=true;recRef.current=rec;rec.start();setListening(true);
  };
  const reset=()=>{stopRec();setOpen(false);setStep(1);setMode(null);setListening(false);setTranscript("");setStatus("");};
  const send=()=>{
    if(!transcript.trim())return;
    if(mode==="calendar"){const cmd=parseVoiceCmd("event "+transcript,6);onAddCalEvent?.(cmd);setStatus(`\u2705 ${cmd.title} \u00B7 ${fmtDate(cmd.date)}`);}
    else if(mode==="task"){onAddTask?.(6,{text:transcript.trim(),priority:"med",due:"",done:false});setStatus("\u2705 Task added");}
    else if(mode==="note"){onAddNote?.(6,transcript.trim());setStatus("\u2705 Note added");}
    else if(mode==="expense"){onAddNote?.(6,`💰 Expense: ${transcript.trim()}`);setStatus("\u2705 Expense logged");}
    else if(mode==="goal"){onAddNote?.(6,`🎯 Goal: ${transcript.trim()}`);setStatus("\u2705 Goal added");}
    else if(mode==="habit"){onAddNote?.(6,`✅ Habit: ${transcript.trim()}`);setStatus("\u2705 Habit logged");}
    else if(mode==="subscription"){onAddNote?.(6,`🔄 Subscription: ${transcript.trim()}`);setStatus("\u2705 Subscription added");}
    setTranscript("");setListening(false);setTimeout(()=>reset(),2500);
  };
  return(
    <>
      {/* Fixed pill — top-right, Bean logo + voice button on shared navy background */}
      <div style={{position:"fixed",top:10,right:16,zIndex:2000,display:"inline-flex",alignItems:"stretch",
        background:"linear-gradient(135deg,#12192b,#1a2744)",
        borderRadius:isMobile?16:20,
        border:"1px solid rgba(239,83,80,0.18)",
        boxShadow:"0 4px 24px rgba(0,0,0,0.45),0 0 0 1px rgba(239,83,80,0.06)",
        overflow:"hidden"}}>
        {/* Bean logo side — equal width box */}
        <div onClick={onGoHome} style={{cursor:"pointer",width:isMobile?80:96,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:"6px 0",position:"relative",overflow:"hidden"}}>
          {/* Rising embers */}
          <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden"}}>
            <div style={{position:"absolute",bottom:"18%",left:"22%",width:3,height:3,borderRadius:"50%",background:"#F59E0B",boxShadow:"0 0 5px 2px rgba(245,158,11,0.5)",animation:"emberFloat 7s ease-in-out infinite",animationDelay:"0s"}}/>
            <div style={{position:"absolute",bottom:"12%",left:"55%",width:2,height:2,borderRadius:"50%",background:"#FFB830",boxShadow:"0 0 4px 2px rgba(245,158,11,0.4)",animation:"emberFloat2 9s ease-in-out infinite",animationDelay:"-3s"}}/>
            <div style={{position:"absolute",bottom:"22%",left:"38%",width:4,height:4,borderRadius:"50%",background:"#F59E0B",boxShadow:"0 0 7px 3px rgba(245,158,11,0.45)",animation:"emberFloat3 11s ease-in-out infinite",animationDelay:"-6s"}}/>
            <div style={{position:"absolute",bottom:"8%",left:"70%",width:2,height:2,borderRadius:"50%",background:"#FFD060",boxShadow:"0 0 4px 2px rgba(245,158,11,0.35)",animation:"emberFloat 8s ease-in-out infinite",animationDelay:"-4.5s"}}/>
          </div>
          <svg width={isMobile?66:80} height={isMobile?50:61} viewBox="0 0 200 190" xmlns="http://www.w3.org/2000/svg" style={{display:"block",position:"relative",zIndex:1}}>
            <defs>
              <mask id="pillBlueM"><rect x="50" y="0" width="120" height="140" fill="white"/><rect x="50" y="0" width="38" height="140" fill="black"/></mask>
              <mask id="pillBowlM"><rect x="50" y="0" width="120" height="140" fill="white"/><circle cx="122" cy="96" r="22" fill="black"/></mask>
            </defs>
            <rect x="68" y="10" width="16" height="114" rx="8" fill="#F59E0B"/>
            <circle cx="84" cy="34" r="22" fill="#3B5BDB" mask="url(#pillBlueM)"/>
            <circle cx="122" cy="96" r="40" fill="#F59E0B" mask="url(#pillBowlM)"/>
            <text x="60" y="40" fontFamily="Sora,sans-serif" fontWeight="700" fontSize="20" textAnchor="middle" fill="#3B5BDB">c</text>
            <text x="115" y="178" fontFamily="Sora,sans-serif" fontWeight="800" fontSize="52" letterSpacing="-1.5" textAnchor="middle" fill="#F59E0B">bean</text>
          </svg>
        </div>
        {/* Amber divider */}
        <div style={{width:1,background:"rgba(239,83,80,0.45)",flexShrink:0}}/>
        {/* Voice side — equal width box */}
        <div style={{position:"relative",width:isMobile?80:96,flexShrink:0}}>
          {!open&&(<>
            <div style={{position:"absolute",top:0,right:0,width:44,height:44,borderBottom:"2px solid rgba(239,83,80,0.75)",borderLeft:"2px solid rgba(239,83,80,0.75)",borderTop:"none",borderRight:"none",borderRadius:"0 0 0 100%",transformOrigin:"top right",animation:"arcPulse 2.4s ease-out 0s infinite",pointerEvents:"none"}}/>
            <div style={{position:"absolute",top:0,right:0,width:44,height:44,borderBottom:"2px solid rgba(0,151,167,0.65)",borderLeft:"2px solid rgba(0,151,167,0.65)",borderTop:"none",borderRight:"none",borderRadius:"0 0 0 100%",transformOrigin:"top right",animation:"arcPulse 2.4s ease-out 0.8s infinite",pointerEvents:"none"}}/>
            <div style={{position:"absolute",top:0,right:0,width:44,height:44,borderBottom:"2px solid rgba(123,31,162,0.6)",borderLeft:"2px solid rgba(123,31,162,0.6)",borderTop:"none",borderRight:"none",borderRadius:"0 0 0 100%",transformOrigin:"top right",animation:"arcPulse 2.4s ease-out 1.6s infinite",pointerEvents:"none"}}/>
          </>)}
          <div onClick={()=>setOpen(!open)}
            style={{width:"100%",height:"100%",
              background:"transparent",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:5,
              cursor:"pointer",transition:"all 0.25s ease"}}>
            {open
              ?<span style={{fontSize:18,color:"rgba(255,255,255,0.7)",fontWeight:400,lineHeight:1,padding:"5px 0"}}>{"\u2715"}</span>
              :<EQBars fab={true}/>
            }
            <div style={{fontSize:9,color:"#EF5350",letterSpacing:2,fontWeight:700,fontFamily:FONT_MONO}}>{open?"CLOSE":"VOICE"}</div>
          </div>
        </div>
      </div>
      {/* Dropdown panel */}
      {open&&(
        <div style={{position:"fixed",top:isMobile?88:88,right:16,zIndex:1999,width:isMobile?"calc(100vw - 32px)":290,maxWidth:320,
          background:"rgba(14,20,38,0.97)",backdropFilter:"blur(24px)",WebkitBackdropFilter:"blur(24px)",
          borderRadius:18,border:"1.5px solid rgba(59,91,219,0.35)",
          boxShadow:"0 8px 40px rgba(0,0,0,0.5),0 2px 8px rgba(59,91,219,0.15)",
          animation:"fadeSlideIn 0.25s ease-out",overflow:"hidden"}}>
          <div style={{padding:"12px 16px",background:"linear-gradient(135deg,#3B5BDB,#5C7CFA)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <EQBars fab={false}/>
              <div>
                <div style={{fontSize:12,fontWeight:800,color:"#fff",letterSpacing:2,fontFamily:FONT_MONO}}>BEAN VOICE</div>
                <div style={{fontSize:9,color:"rgba(255,255,255,0.65)",letterSpacing:1,marginTop:1,fontFamily:FONT_MONO}}>{step===1?"WHAT ARE YOU ADDING?":"RECORDING"}</div>
              </div>
            </div>
            <button onClick={reset} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:24,height:24,borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center"}}>{"\u2715"}</button>
          </div>
          <div style={{padding:"14px 14px",maxHeight:"65vh",overflow:"auto"}}>
            {step===1&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <button onClick={()=>{reset();onOpenCommandBean?.();}}
                  style={{display:"flex",alignItems:"center",gap:12,background:"#EF535010",border:"2px solid #EF535044",borderRadius:12,padding:"11px 14px",cursor:"pointer",fontFamily:FONT,transition:"all 0.15s",width:"100%"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#EF535022";e.currentTarget.style.borderColor="#EF5350";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#EF535010";e.currentTarget.style.borderColor="#EF535044";}}>
                  <div style={{width:34,height:34,borderRadius:9,background:"linear-gradient(135deg,#EF5350,#EF5350cc)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    <span style={{fontFamily:"Sora,sans-serif",fontWeight:800,fontSize:20,color:"#fff",lineHeight:1}}>b</span>
                  </div>
                  <div style={{textAlign:"left"}}>
                    <div style={{fontSize:12,fontWeight:800,color:"#EF5350",letterSpacing:0.3}}>COMMAND PERSONAL</div>
                    <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",marginTop:1}}>search your data.</div>
                  </div>
                </button>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,marginTop:4,marginBottom:2}}>Or speak something new:</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                  {VOICE_TYPES.map(t=>(
                    <button key={t.key} onClick={()=>{if(t.key==="calendar"&&!isAuthed){setStatus("Connect Google for calendar");return;}setMode(t.key);setStep(2);setTimeout(startRec,300);}}
                      style={{background:`${t.color}12`,border:`2px solid ${t.color}44`,borderRadius:11,padding:"11px 12px",cursor:"pointer",textAlign:"left",fontFamily:FONT,transition:"all 0.15s",gridColumn:t.key==="calendar"?"1 / -1":"auto"}}
                      onMouseEnter={e=>{e.currentTarget.style.background=`${t.color}25`;e.currentTarget.style.borderColor=t.color;}}
                      onMouseLeave={e=>{e.currentTarget.style.background=`${t.color}12`;e.currentTarget.style.borderColor=`${t.color}44`;}}>
                      <div style={{fontSize:12,fontWeight:800,color:t.color,letterSpacing:0.3,textAlign:t.key==="calendar"?"center":"left"}}>{t.label.toUpperCase()}</div>
                    </button>
                  ))}
                </div>
                {status&&<div style={{fontSize:11,color:"#C62828",fontWeight:600,padding:"4px 0"}}>{status}</div>}
              </div>
            )}
            {step===2&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{fontSize:10,color:activeType?.color||"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1,fontWeight:700}}>{(mode||"").toUpperCase()}</div>
                {listening&&!transcript&&(
                  <div style={{fontSize:16,color:"rgba(255,255,255,0.5)",fontStyle:"italic",lineHeight:1.5,padding:"4px 0"}}>
                    {activeType?.prompt||"Speak now\u2026"}
                  </div>
                )}
                {transcript&&<div style={{fontSize:15,color:"rgba(255,255,255,0.88)",fontWeight:500,lineHeight:1.6,borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:8}}>{transcript}</div>}
                {status&&<div style={{fontSize:12,fontWeight:700,color:status.startsWith("\u2705")?"#2E7D32":"#C62828"}}>{status}</div>}
                <div style={{display:"flex",gap:7}}>
                  <button onClick={()=>{stopRec();reset();}} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.6)",borderRadius:10,padding:"9px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>CANCEL</button>
                  {listening&&<button onClick={stopRec} style={{flex:1,background:"rgba(198,40,40,0.1)",border:"1px solid #C62828",color:"#C62828",borderRadius:10,padding:"9px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT}}>{"\u25A0"} STOP</button>}
                  {transcript&&!listening&&<button onClick={send} style={{flex:2,background:`linear-gradient(135deg,${activeType?.color||"#3B5BDB"},${activeType?.color||"#5C7CFA"}cc)`,border:"none",color:"#fff",borderRadius:10,padding:"9px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:FONT,boxShadow:`0 4px 12px ${activeType?.color||"#3B5BDB"}55`}}>SAVE {(mode||"").toUpperCase()} \u2192</button>}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function _VitalsCard_DELETED({bizId,biz}){
  const storageKey=`dws_vitals_${bizId}`;
  const empty={revenue:'',cogs:'',grossProfit:'',netIncome:'',revenuePrev:'',cogsPrev:'',grossProfitPrev:'',netIncomePrev:'',period:''};
  const[vitals,setVitals]=useState(()=>{try{const s=localStorage.getItem(storageKey);return s?JSON.parse(s):empty;}catch{return empty;}});
  const[editing,setEditing]=useState(false);
  const[expanded,setExpanded]=useState(false);
  const[form,setForm]=useState(vitals);
  const n=v=>Number(v)||0;
  const hasData=n(vitals.revenue)>0;
  const rev=n(vitals.revenue),cogs=n(vitals.cogs),gp=n(vitals.grossProfit),net=n(vitals.netIncome);
  const maxV=Math.max(rev,cogs,gp,Math.abs(net),1);
  const fmtD=v=>{const x=n(v);if(x>=1000000)return`$${(x/1000000).toFixed(1)}M`;if(x>=1000)return`$${(x/1000).toFixed(1)}k`;return x>0?`$${x}`:'—';};
  const getDelta=(curr,prev)=>{if(!n(prev))return null;const d=(n(curr)-n(prev))/n(prev)*100;return{pct:Math.abs(d).toFixed(1),up:d>=0};};
  const save=()=>{setVitals(form);try{localStorage.setItem(storageKey,JSON.stringify(form));}catch{}setEditing(false);};
  const eqCh=[
    {v:hasData?Math.round((rev/maxV)*5):0,c:'#EF5350',l:'REV'},
    {v:hasData?Math.round((cogs/maxV)*5):0,c:'#3B5BDB',l:'CGS'},
    {v:hasData?Math.round((gp/maxV)*5):0,c:'#00D4FF',l:'GP'},
    {v:hasData?Math.round((Math.max(0,net)/maxV)*5):0,c:net>=0?'#00E676':'#FF3B3B',l:'NET'},
  ];
  const rows=[
    {label:'REV',key:'revenue',prevKey:'revenuePrev',color:'#EF5350',neg:false},
    {label:'COGS',key:'cogs',prevKey:'cogsPrev',color:'#3B5BDB',neg:true},
    {label:'GP',key:'grossProfit',prevKey:'grossProfitPrev',color:'#00D4FF',neg:false},
    {label:'NET',key:'netIncome',prevKey:'netIncomePrev',color:net>=0?'#00E676':'#FF3B3B',neg:false},
  ];
  const ExpandedModal=()=>createPortal(
    <div onClick={()=>setExpanded(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',backdropFilter:'blur(10px)',WebkitBackdropFilter:'blur(10px)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:'24px 16px',animation:'fadeSlideIn 0.2s ease-out'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:'min(92vw,340px)',background:'#080c14',borderRadius:20,
        backgroundImage:'linear-gradient(rgba(0,180,200,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,200,0.04) 1px,transparent 1px)',
        backgroundSize:'20px 20px',border:`1px solid ${biz.color}44`,borderTop:`3px solid ${biz.color}`,
        boxShadow:`0 20px 60px rgba(0,0,0,0.8),0 0 0 1px ${biz.color}18`,overflow:'hidden'}}>
        <div style={{padding:'14px 18px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:biz.color,letterSpacing:0.5,fontFamily:FONT_MONO}}>{biz.name.toUpperCase()}</div>
            {vitals.period&&<div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2,fontFamily:FONT_MONO}}>{vitals.period}</div>}
          </div>
          <button onClick={()=>setExpanded(false)} style={{background:'rgba(255,255,255,0.08)',border:'none',color:'rgba(255,255,255,0.5)',cursor:'pointer',fontSize:14,width:28,height:28,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
        <div style={{padding:'12px 18px'}}>
          {rows.map(r=>{
            const d=getDelta(vitals[r.key],vitals[r.prevKey]);
            const dColor=r.neg?(d?.up?'#FF3B3B':'#00E676'):(d?.up?'#00E676':'#FF3B3B');
            const gpPct=r.key==='grossProfit'&&rev>0?` · ${(gp/rev*100).toFixed(1)}%`:'';
            const netPct=r.key==='netIncome'&&rev>0?` · ${(net/rev*100).toFixed(1)}%`:'';
            return(
              <div key={r.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                <div>
                  <div style={{fontSize:9,fontWeight:700,color:'rgba(255,255,255,0.3)',fontFamily:FONT_MONO,letterSpacing:1.5}}>{r.label==='REV'?'REVENUE':r.label==='COGS'?'COST OF GOODS':r.label==='GP'?'GROSS PROFIT':'NET INCOME'}</div>
                  {(gpPct||netPct)&&<div style={{fontSize:9,color:'rgba(255,255,255,0.2)',fontFamily:FONT_MONO,marginTop:1}}>{gpPct||netPct}</div>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{fontSize:22,fontWeight:900,color:r.color,fontFamily:"'Sora',sans-serif",letterSpacing:-1}}>{fmtD(vitals[r.key])}</span>
                  {d&&<span style={{fontSize:9,fontWeight:700,color:dColor,fontFamily:FONT_MONO}}>{d.up?'▲':'▼'}{d.pct}%</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{padding:'8px 18px 14px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{display:'flex',gap:4,alignItems:'flex-end',height:28}}>
            {eqCh.map(ch=>(
              <div key={ch.l} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                <div style={{width:'100%',height:ch.v>0?`${(ch.v/5)*22}px`:'2px',background:ch.c,borderRadius:2,opacity:ch.v>0?1:0.15,boxShadow:ch.v>0?`0 0 6px ${ch.c}99`:'none'}}/>
                <div style={{fontSize:7,color:ch.v>0?ch.c:'rgba(255,255,255,0.12)',fontFamily:FONT_MONO}}>{ch.l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:'0 18px 14px'}}>
          <button onClick={()=>{setExpanded(false);setForm(vitals);setEditing(true);}} style={{...btnSt(biz.color),padding:'8px',fontSize:11,width:'100%'}}>✏️ EDIT DATA</button>
        </div>
      </div>
    </div>,
    document.body
  );

  return(
    <>
    {expanded&&<ExpandedModal/>}
    <div style={{width:158,flexShrink:0,background:'#080c14',borderRadius:14,
      backgroundImage:'linear-gradient(rgba(0,180,200,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,200,0.035) 1px,transparent 1px)',
      backgroundSize:'18px 18px',border:`1px solid ${biz.color}33`,borderTop:`2px solid ${biz.color}99`,
      boxShadow:`0 4px 20px rgba(0,0,0,0.5),0 0 0 1px ${biz.color}11`,overflow:'hidden'}}>
      <div style={{padding:'9px 11px 7px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <div style={{fontSize:9,fontWeight:800,color:biz.color,letterSpacing:0.5,fontFamily:FONT_MONO,lineHeight:1.2}}>{biz.short.toUpperCase()}</div>
          {vitals.period&&<div style={{fontSize:6,color:'rgba(255,255,255,0.2)',marginTop:1,fontFamily:FONT_MONO}}>{vitals.period}</div>}
        </div>
        <button onClick={()=>{setForm(vitals);setEditing(!editing);}} style={{background:'none',border:'none',color:editing?biz.color:'rgba(255,255,255,0.25)',cursor:'pointer',fontSize:11,padding:0,lineHeight:1}}>{editing?'✕':'✏️'}</button>
      </div>
      {editing?(
        <div style={{padding:'8px 10px',display:'flex',flexDirection:'column',gap:4}}>
          <input placeholder="Period" value={form.period} onChange={e=>setForm(f=>({...f,period:e.target.value}))} style={{...iSt(biz.color),fontSize:9,padding:'4px 7px'}}/>
          <div style={{fontSize:6,color:'rgba(255,255,255,0.2)',fontFamily:FONT_MONO,letterSpacing:1,marginTop:2}}>CURRENT</div>
          {rows.map(r=><input key={r.key} placeholder={r.label} type="number" value={form[r.key]} onChange={e=>setForm(f=>({...f,[r.key]:e.target.value}))} style={{...iSt(biz.color),fontSize:9,padding:'4px 7px'}}/>)}
          <div style={{fontSize:6,color:'rgba(255,255,255,0.2)',fontFamily:FONT_MONO,letterSpacing:1,marginTop:2}}>PRIOR PERIOD</div>
          {rows.map(r=><input key={r.prevKey} placeholder={r.label+' prior'} type="number" value={form[r.prevKey]} onChange={e=>setForm(f=>({...f,[r.prevKey]:e.target.value}))} style={{...iSt(biz.color),fontSize:9,padding:'4px 7px'}}/>)}
          <button onClick={save} style={{...btnSt(biz.color),padding:'6px',fontSize:9,marginTop:2}}>SAVE</button>
        </div>
      ):(
        <>
          <div onClick={()=>!editing&&setExpanded(true)} style={{padding:'7px 11px',cursor:'pointer'}}>
            {hasData?rows.map(r=>{
              const d=getDelta(vitals[r.key],vitals[r.prevKey]);
              const dColor=r.neg?(d?.up?'#FF3B3B':'#00E676'):(d?.up?'#00E676':'#FF3B3B');
              return(
                <div key={r.label} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  <span style={{fontSize:7,fontWeight:700,color:'rgba(255,255,255,0.28)',fontFamily:FONT_MONO,letterSpacing:1}}>{r.label}</span>
                  <div style={{display:'flex',alignItems:'center',gap:3}}>
                    <span style={{fontSize:13,fontWeight:800,color:r.color,fontFamily:FONT_MONO,letterSpacing:-0.5}}>{fmtD(vitals[r.key])}</span>
                    {d&&<span style={{fontSize:7,color:dColor,fontFamily:FONT_MONO}}>{d.up?'▲':'▼'}{d.pct}%</span>}
                  </div>
                </div>
              );
            }):(
              <div style={{padding:'14px 0',textAlign:'center'}}>
                <div style={{fontSize:8,color:'rgba(255,255,255,0.18)',fontFamily:FONT_MONO,lineHeight:1.6}}>No data{'\n'}Tap ✏️ to add</div>
              </div>
            )}
          </div>
          <div style={{padding:'5px 11px 8px',borderTop:'1px solid rgba(255,255,255,0.04)'}}>
            <div style={{display:'flex',gap:3,alignItems:'flex-end',height:20}}>
              {eqCh.map(ch=>(
                <div key={ch.l} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
                  <div style={{width:'100%',height:ch.v>0?`${(ch.v/5)*14}px`:'2px',background:ch.c,borderRadius:2,opacity:ch.v>0?1:0.15,boxShadow:ch.v>0?`0 0 4px ${ch.c}88`:'none'}}/>
                  <div style={{fontSize:5,color:ch.v>0?ch.c:'rgba(255,255,255,0.12)',fontFamily:FONT_MONO}}>{ch.l}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}

function BizPage({biz,bizId,state,allEvents,calMonth,setCalMonth,onAddTask,onDeleteTask,onDeleteAllTasks,onToggleTask,gTasks,gTaskLists,onAddCalEvent,onDeleteCalEvent,onDeleteAllCalEvent,onEditCalEvent,onEditAllCalEvent,onCompleteGTask,onDeleteGTask,onEditGTask,onEditTask,isAuthed,onPushBudgetEvent,onUpdateNote,onDeleteNote,onAddNote,onNavigate,bizOrder}){
  const tasks=state.tasks[bizId]||[];
  const bizEvents=allEvents.filter(ev=>ev.bizId===bizId);
  const[showBudget,setShowBudget]=useState(false);
  const isMobile=window.innerWidth<768;
  const navOrder=bizOrder||BIZ.map((_,i)=>i);
  const BizNavCards=()=>(<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4}}>
    {navOrder.map(i=>{const b=BIZ[i];const active=i===bizId;return(
      <div key={b.id} onClick={active?undefined:()=>onNavigate(i)}
        style={{cursor:active?"default":"pointer",padding:"8px 10px",borderRadius:12,minWidth:72,background:active?`linear-gradient(180deg,${b.color}30 0%,${b.color}14 100%)`:`linear-gradient(180deg,${b.color}12 0%,${b.color}06 100%)`,border:`1px solid ${b.color}${active?"55":"22"}`,borderTop:`1px solid ${b.color}${active?"88":"40"}`,boxShadow:active?`0 4px 16px ${b.color}44`:`0 3px 10px rgba(0,0,0,0.3)`,transition:"all 0.2s",opacity:active?1:0.7}}
        onMouseEnter={e=>{if(!active){e.currentTarget.style.background=`linear-gradient(180deg,${b.color}22 0%,${b.color}10 100%)`;e.currentTarget.style.opacity="1";e.currentTarget.style.boxShadow=`0 4px 16px ${b.color}44`;}}}
        onMouseLeave={e=>{if(!active){e.currentTarget.style.background=`linear-gradient(180deg,${b.color}12 0%,${b.color}06 100%)`;e.currentTarget.style.opacity="0.7";e.currentTarget.style.boxShadow=`0 3px 10px rgba(0,0,0,0.3)`;}}}>
        <div style={{fontSize:10,fontWeight:700,color:active?b.color:BIZ_TEXT[i],letterSpacing:0.3,whiteSpace:"nowrap"}}>{b.short}</div>
        <div style={{fontSize:8,color:"rgba(255,255,255,0.25)",fontFamily:FONT_MONO,marginTop:1,letterSpacing:0.3}}>{b.type.toUpperCase()}</div>
      </div>
    );})}
  </div>);
  return(
    <div style={{padding:"16px",paddingTop:0,paddingBottom:"80px",display:"flex",flexDirection:"column",gap:16,overflow:"hidden"}}>
      <div style={{position:"sticky",top:0,zIndex:50,background:"linear-gradient(180deg,#0e1320 80%,transparent 100%)",paddingTop:isMobile?"14px":"32px",paddingBottom:12,marginBottom:-4}}>
        <div style={{fontFamily:"'Sora',sans-serif",fontSize:isMobile?22:32,fontWeight:900,letterSpacing:-1,color:"#F59E0B",lineHeight:1.1}}><span style={{color:"#F59E0B"}}>command</span><br/><span style={{color:"#EF5350"}}>personal.</span></div>
        <div style={{fontSize:isMobile?10:13,color:"rgba(255,255,255,0.4)",letterSpacing:2,marginTop:6,fontWeight:500,fontFamily:FONT_MONO}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
      </div>
      <div style={{borderLeft:`5px solid ${biz.color}`,paddingLeft:16,borderImage:`linear-gradient(180deg, ${biz.color}, ${biz.color}66) 1`}}>
        <div style={{fontSize:isMobile?15:22,fontWeight:900,color:BIZ_TEXT[bizId],letterSpacing:0.5}}>{biz.name.toUpperCase()}</div>
        <div style={{fontSize:isMobile?10:12,color:"rgba(255,255,255,0.35)",letterSpacing:3,fontWeight:500,fontFamily:FONT_MONO,marginTop:2}}>{biz.type.toUpperCase()}</div>
      </div>
      {bizId===6&&(
        <button onClick={()=>setShowBudget(v=>!v)} style={{alignSelf:"flex-start",display:"inline-flex",alignItems:"center",gap:8,background:showBudget?"linear-gradient(135deg, #7B1FA2, #7B1FA2dd)":"rgba(123,31,162,0.12)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:showBudget?"2px solid #7B1FA2":`2px solid #7B1FA255`,color:showBudget?"#fff":"#CE93D8",borderRadius:12,padding:"10px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"'Inter','Helvetica Neue',Arial,sans-serif",letterSpacing:0.8,boxShadow:showBudget?"0 4px 20px #7B1FA240":"0 2px 10px #7B1FA220",transition:"all 0.3s ease"}}>
          {showBudget?"\u2715 CLOSE BUDGET":"\u{1F4CA} BUDGET & DEBT TRACKER"}
        </button>
      )}
      {bizId===6&&showBudget?(
        <div style={{animation:"fadeSlideIn 0.4s ease-out both"}}>
          <BudgetManager onPushToCalendar={onPushBudgetEvent}/>
        </div>
      ):(
        <>
          <div className="biz-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18,marginTop:4}}>
            <TaskPanel biz={biz} bizId={bizId} tasks={tasks} onAdd={onAddTask} onDelete={onDeleteTask} onDeleteAll={onDeleteAllTasks} onToggle={onToggleTask} gTasks={gTasks} gTaskLists={gTaskLists} onCompleteGTask={onCompleteGTask} onDeleteGTask={onDeleteGTask} onEditGTask={onEditGTask} onEditTask={onEditTask} onAddCalEvent={onAddCalEvent} isAuthed={isAuthed}/>
            <div style={{display:"flex",flexDirection:"column",gap:16,minWidth:0}}>
              {!isMobile&&<BizNavCards/>}
              <NotePanel biz={biz} bizId={bizId} notes={state.notes[bizId]||[]} onUpdate={onUpdateNote} onDelete={onDeleteNote} onAddTask={onAddTask} isAuthed={isAuthed} onAddNote={onAddNote}/>
            </div>
          </div>
          <MonthCal biz={biz} events={bizEvents} calMonth={calMonth} setCalMonth={setCalMonth} onAddEvent={onAddCalEvent} onDeleteEvent={onDeleteCalEvent} onDeleteAllEvent={onDeleteAllCalEvent} onEditEvent={onEditCalEvent} onEditAllEvent={onEditAllCalEvent} isAuthed={isAuthed}/>
        </>
      )}
      <PlatformStrip/>
    </div>
  );
}

function LiveClock(){
  const[t,setT]=useState(new Date());
  useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]);
  return <span>{t.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"})}</span>;
}

/* ── Onboarding ─────────────────────────────────────────────────── */

function OnboardingFlow({onComplete,onConnectGoogle}){
  const[step,setStep]=useState(0);
  const[bizList,setBizList]=useState([{name:"",type:"Restaurant",color:"#E65100",email:""}]);
  const isMob=window.innerWidth<768;
  const addBiz=()=>{if(bizList.length>=6)return;const c=ONBOARD_COLORS[bizList.length%ONBOARD_COLORS.length];setBizList(p=>[...p,{name:"",type:"Restaurant",color:c,email:""}]);};
  const removeBiz=(i)=>{if(bizList.length<=1)return;setBizList(p=>p.filter((_,idx)=>idx!==i));};
  const updateBiz=(i,field,val)=>setBizList(p=>p.map((b,idx)=>idx===i?{...b,[field]:val}:b));
  const canNext=bizList.some(b=>b.name.trim());
  const saveBizAndAdvance=()=>{
    const configured=bizList.filter(b=>b.name.trim()).map((b,i)=>{
      const n=b.name.trim();const words=n.split(" ").filter(Boolean);
      const short=n.length<=12?n:words.length>1?words.map(w=>w[0]).join("").slice(0,5).toUpperCase():n.slice(0,8);
      return{id:i,name:n,short,type:b.type,color:b.color,email:b.email.trim()};
    });
    try{localStorage.setItem("dws_user_biz",JSON.stringify(configured));}catch{}
    setStep(2);
  };
  const termBg={background:"#080c14",backgroundImage:"linear-gradient(rgba(0,180,200,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,180,200,0.03) 1px,transparent 1px)",backgroundSize:"28px 28px"};
  const inp={width:"100%",background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:8,padding:"10px 12px",color:"#fff",fontSize:15,fontFamily:FONT,outline:"none",boxSizing:"border-box"};
  const inpSm={...inp,fontSize:13,padding:"8px 12px"};
  if(step===0) return(
    <div style={{...termBg,minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:isMob?"20px 16px 48px":"40px 24px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:400,textAlign:"center"}}>
        <div style={{fontSize:11,fontWeight:800,color:"rgba(0,180,200,0.5)",letterSpacing:3,fontFamily:FONT_MONO,marginBottom:20}}>COMMAND BEAN MOGUL v1.0</div>
        <div style={{fontSize:isMob?38:46,fontWeight:900,color:"#F59E0B",fontFamily:"'Sora',sans-serif",letterSpacing:-2,lineHeight:1,marginBottom:8}}><span style={{color:"#F59E0B"}}>command</span><br/><span style={{color:"#EF5350"}}>personal.</span></div>
        <div style={{fontSize:12,color:"rgba(255,255,255,0.3)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:36}}>command center.</div>
        <div style={{background:"rgba(0,180,200,0.05)",border:"1px solid rgba(0,180,200,0.15)",borderRadius:16,padding:"22px 20px",marginBottom:28,textAlign:"left"}}>
          <div style={{fontSize:11,color:"rgba(0,180,200,0.6)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:10}}>{"> "} SYSTEM INIT</div>
          <div style={{fontSize:15,color:"rgba(255,255,255,0.8)",lineHeight:1.65}}>Your multi-business command center. Manage tasks, vitals, calendar, and notes — all in one place.</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.4)",marginTop:10,lineHeight:1.5}}>Setup takes under 2 minutes.</div>
        </div>
        <button onClick={()=>setStep(1)} style={{background:"#EF5350",color:"#080c14",border:"none",borderRadius:12,padding:"14px 0",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:FONT,width:"100%",letterSpacing:0.3}}>Get Started →</button>
      </div>
    </div>
  );
  if(step===1) return(
    <div style={{...termBg,minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",padding:isMob?"20px 16px 40px":"40px 24px 60px",overflowY:"auto"}}>
      <div style={{width:"100%",maxWidth:500}}>
        <div style={{fontSize:10,color:"rgba(0,180,200,0.5)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:6}}>STEP 2 OF 3</div>
        <div style={{fontSize:isMob?22:26,fontWeight:800,color:"#fff",marginBottom:4}}>Add Your Businesses</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.38)",marginBottom:22}}>Up to 6 businesses. You can rename or add more later.</div>
        {bizList.map((biz,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.04)",border:`1px solid ${biz.color}44`,borderRadius:16,padding:"16px",marginBottom:10}}>
            <div style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontFamily:FONT_MONO,letterSpacing:1.5,marginBottom:6}}>BUSINESS {i+1}</div>
                <input value={biz.name} onChange={e=>updateBiz(i,"name",e.target.value)} placeholder={`e.g. My ${biz.type}`} style={{...inp,marginBottom:8}}/>
                <input value={biz.email} onChange={e=>updateBiz(i,"email",e.target.value)} placeholder="Business email (optional)" style={inpSm} type="email"/>
              </div>
              {bizList.length>1&&<button onClick={()=>removeBiz(i)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.22)",cursor:"pointer",fontSize:16,paddingTop:30,lineHeight:1,flexShrink:0}}>✕</button>}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <select value={biz.type} onChange={e=>updateBiz(i,"type",e.target.value)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"8px 10px",color:"rgba(255,255,255,0.7)",fontSize:13,fontFamily:FONT,outline:"none",flex:1,minWidth:130}}>
                {ONBOARD_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {ONBOARD_COLORS.map(c=><div key={c} onClick={()=>updateBiz(i,"color",c)} style={{width:22,height:22,borderRadius:"50%",background:c,cursor:"pointer",border:biz.color===c?"2.5px solid #fff":"2px solid transparent",boxSizing:"border-box",flexShrink:0}}/>)}
              </div>
            </div>
          </div>
        ))}
        {bizList.length<6&&(
          <button onClick={addBiz} style={{width:"100%",background:"transparent",border:"1px dashed rgba(0,180,200,0.22)",borderRadius:12,padding:"12px",color:"rgba(0,180,200,0.55)",fontSize:12,fontFamily:FONT_MONO,cursor:"pointer",letterSpacing:1.5,marginBottom:20}}>+ ADD ANOTHER BUSINESS</button>
        )}
        <button onClick={saveBizAndAdvance} disabled={!canNext} style={{width:"100%",background:canNext?"#EF5350":"rgba(255,255,255,0.08)",color:canNext?"#080c14":"rgba(255,255,255,0.25)",border:"none",borderRadius:12,padding:"14px 0",fontSize:15,fontWeight:800,cursor:canNext?"pointer":"default",fontFamily:FONT,marginTop:canNext?0:4}}>
          {canNext?"Next: Connect Google →":"Enter at least one business name to continue"}
        </button>
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={()=>setStep(0)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",fontSize:12,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:1}}>← BACK</button>
        </div>
      </div>
    </div>
  );
  // Step 2: Connect Google
  const finish=(connect)=>{
    try{localStorage.setItem("dws_onboarding_done","1");}catch{}
    if(connect&&onConnectGoogle)onConnectGoogle();
    onComplete();
  };
  return(
    <div style={{...termBg,minHeight:"100dvh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:isMob?"20px 16px":"40px 24px"}}>
      <div style={{width:"100%",maxWidth:440,textAlign:"center"}}>
        <div style={{fontSize:10,color:"rgba(0,180,200,0.5)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:20}}>STEP 3 OF 3</div>
        <div style={{fontSize:isMob?26:32,fontWeight:900,color:"#fff",marginBottom:6,fontFamily:"'Sora',sans-serif",letterSpacing:-1}}>Connect Google</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.4)",marginBottom:28,lineHeight:1.6}}>Unlock the full command center experience.<br/>Your data syncs instantly.</div>
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:16,padding:"20px",marginBottom:24,textAlign:"left"}}>
          <div style={{fontSize:10,color:"rgba(0,180,200,0.6)",fontFamily:FONT_MONO,letterSpacing:2,marginBottom:14}}>WHAT SYNCS AUTOMATICALLY</div>
          {[{icon:"📅",label:"Google Calendar",desc:"All your events populate instantly"},
            {icon:"✅",label:"Google Tasks",desc:"Existing task lists sync to your businesses"},
            {icon:"📧",label:"Gmail",desc:"Works if your business email runs through Google"}
          ].map(({icon,label,desc})=>(
            <div key={label} style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:12}}>
              <span style={{fontSize:18,flexShrink:0}}>{icon}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"rgba(255,255,255,0.85)"}}>{label}</div>
                <div style={{fontSize:12,color:"rgba(255,255,255,0.38)",marginTop:1}}>{desc}</div>
              </div>
            </div>
          ))}
          <div style={{borderTop:"1px solid rgba(255,255,255,0.07)",paddingTop:12,marginTop:4}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.28)",lineHeight:1.6}}>
              <strong style={{color:"rgba(255,255,255,0.45)"}}>Business email on Outlook or another provider?</strong> That won't sync yet — but it's coming. Add it to your business profile now so it's ready.
            </div>
          </div>
        </div>
        <button onClick={()=>finish(true)} style={{width:"100%",background:"#EF5350",color:"#080c14",border:"none",borderRadius:12,padding:"14px 0",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:FONT,marginBottom:12,letterSpacing:0.3}}>Connect Google →</button>
        <button onClick={()=>finish(false)} style={{width:"100%",background:"transparent",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.35)",borderRadius:12,padding:"12px 0",fontSize:13,cursor:"pointer",fontFamily:FONT}}>Skip for now</button>
        <div style={{textAlign:"center",marginTop:16}}>
          <button onClick={()=>setStep(1)} style={{background:"none",border:"none",color:"rgba(255,255,255,0.2)",fontSize:12,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:1}}>← BACK</button>
        </div>
      </div>
    </div>
  );
}

// Seed demo vitals data so the UI looks populated on first load
(()=>{
  const seed=[
    {id:0,period:"Q1 2026",revenue:387420,cogs:154968,grossProfit:232452,netIncome:46490,revenuePrev:361800,cogsPrev:148338,grossProfitPrev:213462,netIncomePrev:39798},
    {id:1,period:"Q1 2026",revenue:298650,cogs:119460,grossProfit:179190,netIncome:32851,revenuePrev:276900,cogsPrev:113529,grossProfitPrev:163371,netIncomePrev:28950},
    {id:2,period:"Q1 2026",revenue:214800,cogs:85920,grossProfit:128880,netIncome:21480,revenuePrev:198400,cogsPrev:81344,grossProfitPrev:117056,netIncomePrev:18356},
    {id:3,period:"Q1 2026",revenue:176500,cogs:79425,grossProfit:97075,netIncome:17650,revenuePrev:162000,cogsPrev:74520,grossProfitPrev:87480,netIncomePrev:14580},
    {id:4,period:"Q1 2026",revenue:412300,cogs:123690,grossProfit:288610,netIncome:61845,revenuePrev:389100,cogsPrev:116730,grossProfitPrev:272370,netIncomePrev:54474},
    {id:5,period:"Q1 2026",revenue:94200,cogs:37680,grossProfit:56520,netIncome:11304,revenuePrev:81600,cogsPrev:32640,grossProfitPrev:48960,netIncomePrev:8976},
  ];
  seed.forEach(d=>{
    const k=`dws_vitals_${d.id}`;
    if(!localStorage.getItem(k))localStorage.setItem(k,JSON.stringify(d));
  });
})();

const TUTORIAL_HINTS=[
  {id:1,emoji:"🎙",title:"Create your first task",body:'Tap the voice button in the top right. Say a task like "Add a call with Mike to Spliffs" and it routes automatically.',arrow:"↗",pos:"top"},
  {id:2,emoji:"🏢",title:"Tap into any business",body:"Each card below is a full command center — tasks, notes, calendar, and vitals all in one view.",arrow:"↓",pos:"top"},
  {id:3,emoji:"⚡",title:"You're all set",body:"Urgent tasks surface here automatically. Your calendar syncs in the background. Your voice does the work.",arrow:null,pos:"center"},
];
function TutorialHints({onDone}){
  const[step,setStep]=useState(()=>{try{return parseInt(localStorage.getItem("dws_tutorial_step")||"1");}catch{return 1;}});
  const hint=TUTORIAL_HINTS[step-1];
  if(!hint)return null;
  const advance=()=>{
    const next=step+1;
    if(next>TUTORIAL_HINTS.length){try{localStorage.setItem("dws_tutorial_step","done");}catch{}onDone();return;}
    try{localStorage.setItem("dws_tutorial_step",String(next));}catch{}
    setStep(next);
  };
  const skip=()=>{try{localStorage.setItem("dws_tutorial_step","done");}catch{}onDone();};
  const isLast=step===TUTORIAL_HINTS.length;
  const isMob=window.innerWidth<768;
  const panelTop=hint.pos==="top";
  return createPortal(
    <div style={{position:"fixed",inset:0,zIndex:8000,pointerEvents:"none"}}>
      <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.55)"}}/>
      <div style={{position:"absolute",...(panelTop?{top:isMob?70:80,right:isMob?12:16,left:isMob?12:"auto"}:{top:"50%",left:"50%",transform:"translate(-50%,-50%)"}),pointerEvents:"auto",background:"#141c2e",border:"1px solid rgba(239,83,80,0.35)",borderTop:"3px solid #EF5350",borderRadius:16,padding:"20px 20px 16px",maxWidth:320,width:isMob&&panelTop?"calc(100% - 24px)":"320px",boxShadow:"0 16px 48px rgba(0,0,0,0.6)",animation:"fadeSlideIn 0.22s ease-out"}}>
        {hint.arrow&&<div style={{position:"absolute",...(hint.arrow==="↗"?{top:-22,right:isMob?60:16,fontSize:28,transform:"rotate(0deg)"}:{top:-26,left:"50%",transform:"translateX(-50%)",fontSize:28}),color:"#EF5350",lineHeight:1}}>{hint.arrow}</div>}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
          <span style={{fontSize:22}}>{hint.emoji}</span>
          <div style={{fontSize:15,fontWeight:800,color:"#fff",fontFamily:FONT,flex:1}}>{hint.title}</div>
          <div style={{display:"flex",gap:4}}>
            {TUTORIAL_HINTS.map(h=><div key={h.id} style={{width:6,height:6,borderRadius:"50%",background:h.id===step?"#EF5350":"rgba(255,255,255,0.18)"}}/>)}
          </div>
        </div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.6)",lineHeight:1.6,marginBottom:16}}>{hint.body}</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={skip} style={{flex:1,padding:"9px 0",background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.3)",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:FONT}}>Skip</button>
          <button onClick={advance} style={{flex:2,padding:"9px 0",background:"#EF5350",color:"#080c14",border:"none",borderRadius:8,fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:FONT}}>{isLast?"Let's go ✓":"Got it →"}</button>
        </div>
      </div>
    </div>,document.body);
}

export default function App(){
  const[showSplash,setShowSplash]=useState(()=>{
    const mobile=window.innerWidth<768;
    if(!mobile){if(sessionStorage.getItem("dws_splash_shown"))return false;sessionStorage.setItem("dws_splash_shown","1");}
    return true;
  });
  const[splashFading,setSplashFading]=useState(false);
  useEffect(()=>{
    if(!showSplash)return;
    setSplashFading(false);
    const fadeTimer=setTimeout(()=>setSplashFading(true),4000);
    const hideTimer=setTimeout(()=>setShowSplash(false),4800);
    return()=>{clearTimeout(fadeTimer);clearTimeout(hideTimer);};
  },[showSplash]);
  const[isMobile,setIsMobile]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const h=()=>setIsMobile(window.innerWidth<768);window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[]);
  const[showTooltip,setShowTooltip]=useState(()=>!localStorage.getItem("dws_vt"));
  const[showOnboarding,setShowOnboarding]=useState(false);
  // ?newuser=1 resets all localStorage so Duane can test the new-user experience
  useEffect(()=>{
    const p=new URLSearchParams(window.location.search);
    if(p.get("newuser")==="1"){
      ["dws_user_biz","dws_onboarding_done","dws_v5","dws_deleted_biz","dws_biz_order",
       "dws_vitals_0","dws_vitals_1","dws_vitals_2","dws_vitals_3","dws_vitals_4","dws_vitals_5",
       "dws_cache_events","dws_cache_tasklists","dws_cache_tasks","dws_dismissed_events","dws_vt"
      ].forEach(k=>localStorage.removeItem(k));
      window.location.href=window.location.pathname;
    }
  },[]);
  useEffect(()=>{if(!showTooltip)return;const t=setTimeout(()=>{setShowTooltip(false);localStorage.setItem("dws_vt","1");},5500);return()=>clearTimeout(t);},[showTooltip]);

  const[state,setState]=useState(()=>loadSaved()||defaultState());
  const stateRef=useRef(state);
  useEffect(()=>{stateRef.current=state;},[state]);
  const[deletedBizIds,setDeletedBizIds]=useState(()=>{try{return JSON.parse(localStorage.getItem("dws_deleted_biz")||"[]");}catch{return[];}});
  useEffect(()=>{try{localStorage.setItem("dws_deleted_biz",JSON.stringify(deletedBizIds));}catch{};},[deletedBizIds]);
  const[bizOrder,setBizOrder]=useState(()=>{try{const s=localStorage.getItem("dws_biz_order");return s?JSON.parse(s):BIZ.map((_,i)=>i);}catch{return BIZ.map((_,i)=>i);}});
  useEffect(()=>{try{localStorage.setItem("dws_biz_order",JSON.stringify(bizOrder));}catch{};},[bizOrder]);
  const[showTutorial,setShowTutorial]=useState(()=>{const s=localStorage.getItem("dws_tutorial_step");return s!==null&&s!=="done";});
  const[deleteBizConfirm,setDeleteBizConfirm]=useState(null);
  const deleteBiz=(bizId)=>setDeleteBizConfirm(bizId);
  const confirmDeleteBiz=()=>{
    const bizId=deleteBizConfirm;
    setDeleteBizConfirm(null);
    setDeletedBizIds(prev=>[...prev,bizId]);
    setState(prev=>{const tasks=[...prev.tasks];const notes=[...prev.notes];tasks[bizId]=[];notes[bizId]=[];const ns={...prev,tasks,notes};persist(ns);return ns;});
  };
  const[editBizId,setEditBizId]=useState(null);
  const saveEditBiz=(bizId,{name,type,color})=>{
    const words=name.split(" ").filter(Boolean);
    const short=name.length<=12?name:words.length>1?words.map(w=>w[0]).join("").slice(0,5).toUpperCase():name.slice(0,8);
    Object.assign(BIZ[bizId],{name,short,type,color});
    BIZ_TEXT[bizId]=color;
    const stored=BIZ.slice(0,6).filter(b=>!b.hidden).map(b=>({id:b.id,name:b.name,short:b.short,type:b.type,color:b.color}));
    try{localStorage.setItem("dws_user_biz",JSON.stringify(stored));}catch{}
    setEditBizId(null);
    setBizOrder(o=>[...o]);
  };
  const[activeTab,setActiveTab]=useState(-1);
  const[cmdOpen,setCmdOpen]=useState(false);
  const[liveEvents,setLiveEvents]=useState(()=>{try{const c=localStorage.getItem("dws_cache_events");return c?JSON.parse(c):[];}catch{return[];}});
  const[localEvents,setLocalEvents]=useState([]);
  const[gTaskLists,setGTaskLists]=useState(()=>{try{const c=localStorage.getItem("dws_cache_tasklists");return c?JSON.parse(c):[];}catch{return[];}});
  const[gTasks,setGTasks]=useState(()=>{try{const c=localStorage.getItem("dws_cache_tasks");return c?JSON.parse(c):{};}catch{return{};}});
  const[authToken,setAuthToken]=useState(null);
  const[unreadMail,setUnreadMail]=useState(null);
  const authTokenRef=useRef(null);
  const hasCachedData=gTaskLists.length>0||liveEvents.length>0;
  const[authStatus,setAuthStatus]=useState(hasCachedData?"cached":"idle");
  const[needsDriveConsent,setNeedsDriveConsent]=useState(false);
  const[calLoading,setCalLoading]=useState(false);
  const[calMonth,setCalMonth]=useState(()=>{const n=new Date();return{year:n.getFullYear(),month:n.getMonth()};});
  const[dismissedEvents,setDismissedEvents]=useState(()=>{try{const c=localStorage.getItem("dws_dismissed_events");return c?JSON.parse(c):[];}catch{return[];}});
  const tcRef=useRef(null);

  const allEvents=(()=>{
    const map={};
    const dedupKey=(ev)=>`${(ev.summary||"").toLowerCase().trim()}|${(ev.start||"").split("T")[0]}`;
    if(!authToken){GC_EVENTS.forEach(ev=>{if(!dismissedEvents.includes(ev.id))map[ev.id]=ev;});}
    else{
      GC_EVENTS.forEach(ev=>{if(!dismissedEvents.includes(ev.id))map[ev.id]=ev;});
      liveEvents.forEach(ev=>{
        const dk=dedupKey(ev);
        const existing=Object.values(map).find(e=>dedupKey(e)===dk);
        if(existing){delete map[existing.id];}
        map[ev.id]=ev;
      });
    }
    localEvents.forEach(ev=>{map[ev.id]=ev;});
    return Object.values(map).sort((a,b)=>((a.start||"")<(b.start||""))?-1:1);
  })();

  useEffect(()=>{persist(state);},[state]);
  // Debounced Drive sync whenever notes change
  const driveSaveTimer=useRef(null);
  useEffect(()=>{
    if(!authTokenRef.current)return;
    clearTimeout(driveSaveTimer.current);
    driveSaveTimer.current=setTimeout(()=>{driveWriteNotes(authTokenRef.current,state.notes);},2500);
    return()=>clearTimeout(driveSaveTimer.current);
  },[state.notes]);
  // When authed, clear local tasks — Google is sole source of truth
  useEffect(()=>{if(authStatus==="authed"){setState(s=>{const hasLocal=s.tasks.some(a=>a.length>0);return hasLocal?{...s,tasks:BIZ.map(()=>[])}:s;});}},[authStatus]);

  useEffect(()=>{
    const s=document.createElement("script");
    s.src="https://accounts.google.com/gsi/client";s.async=true;
    s.onload=()=>{tcRef.current=window.google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPES,callback:(resp)=>{if(resp.error){setAuthStatus("error");return;}authTokenRef.current=resp.access_token;window._dwsToken=resp.access_token;setAuthToken(resp.access_token);setAuthStatus("authed");}});};
    document.head.appendChild(s);
    return()=>{try{document.head.removeChild(s);}catch{}};
  },[]);

  const convertedRef=useRef(new Set());
  const gTaskListsRef=useRef(gTaskLists);
  gTaskListsRef.current=gTaskLists;
  const calMapRef=useRef({});    // bizId → calendarId
  const calRevMapRef=useRef({}); // calendarId → bizId
  const liveEventsRef=useRef([]); // mirror of liveEvents for use in async fns
  const fnsRef=useRef({});

  // Plain functions — no useCallback, no dependency chains, no TDZ
  function reAuth(){authTokenRef.current=null;setAuthToken(null);setAuthStatus("expired");tcRef.current?.requestAccessToken();}

  async function fetchTasksInner(token){
    if(!token)return;
    try{
      const lr=await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists",{headers:{Authorization:`Bearer ${token}`}});
      if(lr.status===401){reAuth();return;}
      const ld=await lr.json();const lists=ld.items||[];setGTaskLists(lists);
      gTaskListsRef.current=lists;
      try{localStorage.setItem("dws_cache_tasklists",JSON.stringify(lists));}catch{}
      const tm={};
      await Promise.all(lists.map(async list=>{const tr=await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks?showCompleted=false`,{headers:{Authorization:`Bearer ${token}`}});const td2=await tr.json();tm[list.id]=td2.items||[];}));
      setGTasks(tm);
      try{localStorage.setItem("dws_cache_tasks",JSON.stringify(tm));}catch{}
    }catch(e){console.error(e);}
  }

  async function migratePersonalEvents(token,personalCalId,primaryId){
    // Fetch primary events WITHOUT singleEvents so recurring templates appear once (with RRULE intact)
    const now=new Date();
    const tMin=new Date(now.getFullYear()-1,0,1).toISOString();
    const tMax=new Date(now.getFullYear()+2,0,1).toISOString();
    const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}&maxResults=500`,{headers:{Authorization:`Bearer ${token}`}});
    if(!r.ok)return;
    const data=await r.json();
    const events=(data.items||[]).filter(ev=>{
      if(!ev.summary||/^TASK\b/i.test(ev.summary))return false;
      if(ev.status==="cancelled")return false;
      const desc=ev.description||"";
      // Skip events tagged to another business
      const hasBizTag=BIZ.slice(0,6).some(b=>desc.includes(`[${b.name}]`));
      if(hasBizTag)return false;
      // Skip events whose title matches a business keyword
      if(guessEventBizId(ev.summary,desc)!==6)return false;
      return true;
    });
    for(const ev of events){
      try{
        const body={summary:ev.summary,colorId:"3"};
        if(ev.description)body.description=ev.description;
        if(ev.start?.date){body.start=ev.start;body.end=ev.end;}
        else{body.start=ev.start;body.end=ev.end;}
        if(ev.recurrence)body.recurrence=ev.recurrence;
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(personalCalId)}/events`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
        await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
      }catch(e){console.error("migrate err",e);}
    }
  }

  async function fetchCalendarMapping(token){
    if(!token)return;
    try{
      const res=await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList",{headers:{Authorization:`Bearer ${token}`}});
      if(res.status===401){reAuth();return;}
      const data=await res.json();
      const map={};const rev={};let primaryId="primary";
      for(const cal of (data.items||[])){
        if(cal.primary)primaryId=cal.id;
        const bi=matchCalendarToBiz(cal.summary||"");
        if(bi!==null){map[bi]=cal.id;rev[cal.id]=bi;}
      }
      // Personal tab falls back to primary only if no "Personal" calendar found
      if(!map[6])map[6]=primaryId;
      calMapRef.current=map;calRevMapRef.current=rev;
      // Sync Google Calendar colors to match DWS colors
      const BIZ_GCAL_COLOR=["6","6","6","5","7","10","3","9"]; // tangerine,tangerine,tangerine,banana,peacock,basil,grape,blueberry
      for(const [bizIdStr,calId] of Object.entries(map)){
        const bi=parseInt(bizIdStr);if(bi===6&&calId===primaryId)continue; // don't recolor primary
        const colorId=BIZ_GCAL_COLOR[bi];if(!colorId)continue;
        fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calId)}`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({colorId})}).catch(()=>{});
      }
      // Migrate Personal events from primary to Personal calendar
      const personalCalId=map[6];
      if(personalCalId&&personalCalId!==primaryId){
        migratePersonalEvents(token,personalCalId,primaryId).catch(()=>{});
      }
    }catch(e){console.error(e);}
  }

  async function fetchCalInner(token){
    if(!token)return;setCalLoading(true);
    try{
      const now=new Date();
      const tMin=new Date(now.getFullYear(),now.getMonth()-1,1).toISOString();
      const tMax=new Date(now.getFullYear(),now.getMonth()+6,0).toISOString();
      const params=`timeMin=${encodeURIComponent(tMin)}&timeMax=${encodeURIComponent(tMax)}&singleEvents=true&orderBy=startTime&maxResults=250`;
      // Fetch from primary + all matched business calendars in parallel
      const calIds=[...new Set(["primary",...Object.values(calMapRef.current)])];
      const results=await Promise.all(calIds.map(async calId=>{
        const r=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,{headers:{Authorization:`Bearer ${token}`}});
        if(r.status===401){reAuth();return{calId,items:[]};}
        const d=await r.json();return{calId,items:d.items||[]};
      }));
      // TASK conversion — primary calendar only
      const primaryRes=results.find(r=>r.calId==="primary");
      const taskEventIds=new Set();
      if(primaryRes){
        const taskEvents=primaryRes.items.filter(ev=>ev.summary&&/^TASK\b/i.test(ev.summary.trim())&&!convertedRef.current.has(ev.id));
        for(const ev of taskEvents){
          convertedRef.current.add(ev.id);taskEventIds.add(ev.id);
          const rawTitle=ev.summary.replace(/^TASK\s*/i,"").trim();
          const bizId=guessEventBizId(rawTitle,ev.description||"");
          const bizName=BIZ[bizId].name;
          const due=ev.start?.date||(ev.start?.dateTime?ev.start.dateTime.split("T")[0]:"")||"";
          try{
            let list=gTaskListsRef.current.find(l=>l.title===bizName);
            if(!list){const lr2=await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({title:bizName})});list=await lr2.json();setGTaskLists(p=>[...p,list]);gTaskListsRef.current=[...gTaskListsRef.current,list];}
            await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({title:rawTitle,notes:ev.description||"",due:due?new Date(due+"T00:00:00").toISOString():undefined})});
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${ev.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
          }catch(e){console.error("TASK convert error",e);}
        }
        if(taskEvents.length>0)await fetchTasksInner(token);
      }
      // Map all events with correct bizId from calendar assignment
      const seen=new Set();
      const mapped=results.flatMap(({calId,items})=>
        items.filter(ev=>!taskEventIds.has(ev.id)&&!seen.has(ev.id)&&seen.add(ev.id)).map(ev=>{
          const start=ev.start?.dateTime||ev.start?.date||"";
          const end=ev.end?.dateTime||ev.end?.date||"";
          const bizId=calRevMapRef.current[calId]!=null?calRevMapRef.current[calId]:guessEventBizId(ev.summary,ev.description);
          return{id:ev.id,calId,summary:ev.summary||"(no title)",start,end,allDay:!!ev.start?.date,bizId,color:BIZ[bizId].color,recurringEventId:ev.recurringEventId||null};
        })
      );
      setLiveEvents(mapped);liveEventsRef.current=mapped;
      try{localStorage.setItem("dws_cache_events",JSON.stringify(mapped));}catch{}
    }catch(e){console.error(e);}
    setCalLoading(false);
  }

  const[refreshing,setRefreshing]=useState(false);
  async function doRefresh(){const t=authTokenRef.current;if(t){setRefreshing(true);await Promise.all([fetchCalInner(t),fetchTasksInner(t),driveReadNotes(t).then(remoteNotes=>{if(remoteNotes==="FORBIDDEN"){setNeedsDriveConsent(true);}else if(remoteNotes){setState(s=>({...s,notes:mergeNotes(s.notes,remoteNotes)}));}})]);setRefreshing(false);}else{setAuthStatus("expired");tcRef.current?.requestAccessToken();}}
  fnsRef.current={doRefresh,fetchCalInner,fetchTasksInner};

  useEffect(()=>{
    if(authToken){
      fetchCalendarMapping(authToken).then(async()=>{
        await fetchTasksInner(authToken);
        // Push any local tasks created before auth to Google
        const localTasks=stateRef.current.tasks;
        const hasLocal=localTasks.some(arr=>arr.length>0);
        if(hasLocal){
          for(let bizId=0;bizId<BIZ.length;bizId++){
            const arr=localTasks[bizId]||[];
            for(const task of arr.filter(t=>!t.done)){
              try{
                const bizName=BIZ[bizId].name;
                let list=gTaskListsRef.current.find(l=>l.title===bizName);
                if(!list){const r=await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists",{method:"POST",headers:{Authorization:`Bearer ${authToken}`,"Content-Type":"application/json"},body:JSON.stringify({title:bizName})});list=await r.json();gTaskListsRef.current=[...gTaskListsRef.current,list];}
                await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks`,{method:"POST",headers:{Authorization:`Bearer ${authToken}`,"Content-Type":"application/json"},body:JSON.stringify({title:task.text,notes:`Priority: ${PRI_LABELS[task.priority]||"Medium"}${task.due?` | Due: ${task.due}`:""}`,due:task.due?new Date(task.due+"T00:00:00").toISOString():undefined})});
              }catch(e){console.error("local task sync err",e);}
            }
          }
          await fetchTasksInner(authToken);
          setState(s=>({...s,tasks:BIZ.map(()=>[])}));
        }
        fetchCalInner(authToken);
      });
      // Load notes from Drive and merge with local
      driveReadNotes(authToken).then(remoteNotes=>{
        if(remoteNotes==="FORBIDDEN"){setNeedsDriveConsent(true);}
        else if(remoteNotes){setState(s=>({...s,notes:mergeNotes(s.notes,remoteNotes)}));}
      });
    }
  },[authToken]);

  useEffect(()=>{
    if(!authToken)return;
    const id=setInterval(()=>{fnsRef.current.doRefresh();},30000);
    return()=>clearInterval(id);
  },[authToken]);

  // Re-check token when app resumes from background
  useEffect(()=>{
    const onVisible=()=>{
      if(document.visibilityState==="visible"&&authTokenRef.current){
        fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1",{headers:{Authorization:`Bearer ${authTokenRef.current}`}})
          .then(r=>{if(r.status===401){authTokenRef.current=null;setAuthToken(null);setAuthStatus("expired");tcRef.current?.requestAccessToken();}
            else{fnsRef.current.doRefresh();}})
          .catch(()=>{});
      }
    };
    document.addEventListener("visibilitychange",onVisible);
    return()=>document.removeEventListener("visibilitychange",onVisible);
  },[]);

  async function pushTask(task,bizName){
    const token=authTokenRef.current;if(!token)return;
    try{
      let list=gTaskListsRef.current.find(l=>l.title===bizName);
      if(!list){const r=await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({title:bizName})});list=await r.json();setGTaskLists(p=>[...p,list]);gTaskListsRef.current=[...gTaskListsRef.current,list];}
      await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${list.id}/tasks`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({title:task.text,notes:`Priority: ${PRI_LABELS[task.priority]||"Medium"}${task.due?` | Due: ${task.due}`:""}`,due:task.due?new Date(task.due+"T00:00:00").toISOString():undefined})});
      await new Promise(r=>setTimeout(r,1000));
      await fetchTasksInner(token);
    }catch(e){console.error(e);}
  }

  async function pushCalEvent(evData){
    const token=authTokenRef.current;if(!token)return;
    try{
      const bizTag=evData.bizId!=null&&evData.bizId!==6?`[${BIZ[evData.bizId].name}]`:"";
      const BIZ_GCAL_COLOR=["6","6","6","5","7","10","3","9"];
      const body={summary:evData.title,description:[bizTag,evData.note||""].filter(Boolean).join(" "),colorId:BIZ_GCAL_COLOR[evData.bizId]||"1"};
      if(evData.allDay){const nd=new Date(evData.date+"T00:00:00");nd.setDate(nd.getDate()+1);body.start={date:evData.date};body.end={date:nd.toISOString().split("T")[0]};}
      else{const dt=`${evData.date}T${evData.time||"09:00"}:00`;const[h,m]=(evData.time||"09:00").split(":").map(Number);const eh=h+1>=24?23:h+1;const edt=`${evData.date}T${String(eh).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`;body.start={dateTime:dt,timeZone:"America/New_York"};body.end={dateTime:edt,timeZone:"America/New_York"};}
      if(evData.recur&&evData.recur!=="none"){const dow=["SU","MO","TU","WE","TH","FR","SA"][new Date(evData.date+"T12:00:00").getDay()];const dom=new Date(evData.date+"T12:00:00").getDate();const ruleMap={daily:"RRULE:FREQ=DAILY",weekly:`RRULE:FREQ=WEEKLY;BYDAY=${dow}`,weekdays:"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",monthly:`RRULE:FREQ=MONTHLY;BYMONTHDAY=${dom}`};body.recurrence=[ruleMap[evData.recur]];}
      const targetCalId=calMapRef.current[evData.bizId]||"primary";
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalId)}/events`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      await fetchCalInner(token);
    }catch(e){console.error(e);}
  }

  function addCalEvent(evData){
    const newEv={id:`local_${Date.now()}`,summary:evData.title,start:evData.allDay?evData.date:`${evData.date}T${evData.time||"09:00"}:00`,end:evData.allDay?evData.date:`${evData.date}T${evData.time||"09:00"}:00`,allDay:evData.allDay,bizId:evData.bizId,color:evData.color};
    setLocalEvents(p=>[...p,newEv]);
    if(authTokenRef.current)pushCalEvent(evData);
  }

  async function deleteCalEvent(ev){
    // Hardcoded events — dismiss locally
    if(ev.id&&ev.id.startsWith("s")){
      const updated=[...dismissedEvents,ev.id];
      setDismissedEvents(updated);
      try{localStorage.setItem("dws_dismissed_events",JSON.stringify(updated));}catch{}
      return;
    }
    setLiveEvents(p=>p.filter(e=>e.id!==ev.id));
    setLocalEvents(p=>p.filter(e=>e.id!==ev.id));
    const token=authTokenRef.current;
    if(token&&ev.id&&!ev.id.startsWith("local_")){
      const calId=ev.calId||"primary";
      try{await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${ev.id}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});}catch(e){console.error(e);}
    }
  }

  async function editCalEvent(ev,updates){
    const summary=updates.title.trim();if(!summary)return;
    setLiveEvents(p=>p.map(e=>e.id===ev.id?{...e,summary,allDay:updates.allDay}:e));
    setLocalEvents(p=>p.map(e=>e.id===ev.id?{...e,summary,allDay:updates.allDay}:e));
    const token=authTokenRef.current;
    if(!token||!ev.id||ev.id.startsWith("local_")||ev.id.startsWith("s"))return;
    const calId=ev.calId||"primary";
    const body={summary};
    const evDate=ev.start?ev.start.split("T")[0]:new Date().toISOString().split("T")[0];
    if(updates.allDay){
      const nd=new Date(evDate+"T00:00:00");nd.setDate(nd.getDate()+1);
      body.start={date:evDate};body.end={date:nd.toISOString().split("T")[0]};
    }else{
      const t=updates.time||"09:00";const[h,m]=t.split(":").map(Number);
      const eh=h+1>=24?23:h+1;
      body.start={dateTime:`${evDate}T${t}:00`,timeZone:"America/New_York"};
      body.end={dateTime:`${evDate}T${String(eh).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`,timeZone:"America/New_York"};
    }
    try{
      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${ev.id}`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      await fetchCalInner(token);
    }catch(e){console.error(e);}
  }
  async function editAllCalEvents(ev,updates){
    const summary=updates.title.trim();if(!summary)return;
    const baseId=ev.recurringEventId;if(!baseId)return;
    setLiveEvents(p=>p.map(e=>(e.recurringEventId===baseId||e.id===baseId)?{...e,summary,allDay:updates.allDay}:e));
    setLocalEvents(p=>p.map(e=>(e.recurringEventId===baseId||e.id===baseId)?{...e,summary,allDay:updates.allDay}:e));
    const token=authTokenRef.current;if(!token)return;
    const calId=ev.calId||"primary";
    try{await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${baseId}`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({summary})});await fetchCalInner(token);}catch(e){console.error(e);}
  }
  async function deleteAllRecurringEvents(baseId){
    if(!baseId)return;
    // Find which calendar this recurring event lives in
    const baseEv=liveEventsRef.current.find(e=>e.recurringEventId===baseId||e.id===baseId);
    const calId=baseEv?.calId||"primary";
    setLiveEvents(p=>p.filter(e=>e.recurringEventId!==baseId&&e.id!==baseId));
    setLocalEvents(p=>p.filter(e=>e.recurringEventId!==baseId&&e.id!==baseId));
    const token=authTokenRef.current;
    if(token){
      try{await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${baseId}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});await fetchCalInner(token);}catch(e){console.error(e);}
    }
  }

  async function pushBudgetEvent(ev){
    const token=authTokenRef.current;if(!token)return;
    try{
      const body={summary:ev.title,description:ev.description||"",colorId:"3",start:{date:ev.date},end:{date:ev.date}};
      await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      await fetchCalInner(token);
    }catch(e){console.error(e);}
  }

  function addTask(bizId,task){
    setState(s=>({...s,tasks:s.tasks.map((a,i)=>i===bizId?[...a,{...task,id:Date.now()}]:a)}));
    if(authTokenRef.current)pushTask(task,BIZ[bizId].name);
    // If task has a due date, also create a calendar event
    if(task.due){addCalEvent({title:task.text,date:task.due,allDay:true,bizId,color:BIZ[bizId].color});}
  }
  function deleteTask(bizId,taskId){setState(s=>({...s,tasks:s.tasks.map((a,i)=>i===bizId?a.filter(t=>t.id!==taskId):a)}));}
  function deleteAllTasks(bizId){setState(s=>({...s,tasks:s.tasks.map((a,i)=>i===bizId?[]:a)}));}
  function toggleTask(bizId,taskId){setState(s=>({...s,tasks:s.tasks.map((a,i)=>i===bizId?a.map(t=>t.id===taskId?{...t,done:!t.done}:t):a)}));}
  function editLocalTask(bizId,taskId,updates){setState(s=>({...s,tasks:s.tasks.map((a,i)=>i===bizId?a.map(t=>t.id===taskId?{...t,text:updates.text,priority:updates.priority,due:updates.due}:t):a)}));}
  async function completeGTask(listId,taskId){
    const token=authTokenRef.current;if(!token)return;
    try{
      await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({status:"completed"})});
      await fetchTasksInner(token);
    }catch(e){console.error(e);}
  }
  async function editGTask(listId,taskId,updates){
    const token=authTokenRef.current;if(!token)return;
    try{
      const body={title:updates.text};
      if(updates.priority)body.notes=`Priority: ${PRI_LABELS[updates.priority]||"Medium"}${updates.due?` | Due: ${updates.due}`:""}`;
      if(updates.due)body.due=new Date(updates.due+"T00:00:00").toISOString();
      await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,{method:"PATCH",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      await fetchTasksInner(token);
    }catch(e){console.error(e);}
  }
  async function deleteGTask(listId,taskId){
    const token=authTokenRef.current;if(!token)return;
    // Optimistic: remove immediately so UI feels instant
    setGTasks(p=>{const n={...p};if(n[listId])n[listId]=n[listId].filter(t=>t.id!==taskId);return n;});
    try{
      await fetch(`https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,{method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
      await fetchTasksInner(token);
    }catch(e){console.error(e);}
  }

  function addNote(bizId,content){setState(s=>({...s,notes:s.notes.map((a,i)=>i===bizId?[{id:Date.now(),content,timestamp:new Date().toISOString(),pinned:false},...a]:a)}));}
  function updateNote(bizId,noteId,updates){setState(s=>({...s,notes:s.notes.map((a,i)=>i===bizId?a.map(n=>n.id===noteId?{...n,...updates}:n):a)}));}
  function deleteNote(bizId,noteId){setState(s=>({...s,notes:s.notes.map((a,i)=>i===bizId?a.filter(n=>n.id!==noteId):a)}));}

  const biz=(typeof activeTab==="number"&&activeTab>=0)?BIZ[activeTab]:null;
  const signIn=()=>{setAuthStatus("loading");tcRef.current?.requestAccessToken();};

  if(showSplash)return(
    <div style={{position:"fixed",inset:0,background:"#12192B",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,opacity:splashFading?0:1,transition:"opacity 0.7s ease",fontFamily:FONT}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",animation:"fadeSlideIn 0.8s ease-out both"}}>
        <svg width="290" height="330" viewBox="0 0 200 235" xmlns="http://www.w3.org/2000/svg" overflow="visible">
          <defs>
            <mask id="splashBlueM"><rect width="120" height="140" fill="white"/><rect x="0" y="0" width="38" height="140" fill="black"/></mask>
            <mask id="splashBowlM"><rect width="120" height="140" fill="white"/><circle cx="72" cy="96" r="22" fill="black"/></mask>
          </defs>
          <svg x="50" y="10" width="100" height="116.67" viewBox="0 0 120 140">
            <rect x="18" y="10" width="16" height="114" rx="8" fill="#F59E0B"/>
            <circle cx="34" cy="34" r="22" fill="#3B5BDB" mask="url(#splashBlueM)"/>
            <circle cx="72" cy="96" r="40" fill="#F59E0B" mask="url(#splashBowlM)"/>
            <text x="10" y="40" fontFamily="Sora,sans-serif" fontWeight="700" fontSize="18" textAnchor="middle" fill="#3B5BDB">c</text>
          </svg>
          <text x="100" y="158" fontFamily="Sora,sans-serif" fontWeight="800" fontSize="52" letterSpacing="-1.5" textAnchor="middle" fill="#F59E0B">bean</text>
          <text x="105" y="176" fontFamily="Sora,sans-serif" fontWeight="400" fontSize="11" letterSpacing="3" textAnchor="middle" fill="#F59E0B" opacity="0.7">command.</text>
          <text x="100" y="201" fontFamily="Inter,sans-serif" fontWeight="400" fontSize="9.5" letterSpacing="0.5" textAnchor="middle" fill="rgba(255,255,255,0.55)" style={{animation:"textPulse 3s ease-in-out infinite"}}>Stop typing. Start commanding.</text>
        </svg>
        <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,animation:"fadeSlideIn 1.6s ease-out both",opacity:0.55}}>
          {[{n:"Command",c:"#EF5350"},{n:"Personal",c:"#E53935"},{n:"Pulse",c:"#2E7D32"},{n:"Partners",c:"#0097A7"},{n:"Family",c:"#7B1FA2"}].map((p,i)=>(
            <span key={p.n} style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:8,fontWeight:700,color:p.c,fontFamily:"Sora,sans-serif",letterSpacing:0.3}}>{p.n}</span>
              {i<4&&<span style={{fontSize:8,color:"rgba(255,255,255,0.2)"}}>·</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  // Floating logo removed — logo now lives in the nav bar left side

  // Nav bar Bean logo (left-anchored, 72px wide)
  const NavLogo=(
    <svg width="72" height="55" viewBox="0 0 200 183" xmlns="http://www.w3.org/2000/svg" style={{display:"block"}}>
      <defs>
        <mask id="navBlueM"><rect width="120" height="140" fill="white"/><rect x="0" y="0" width="38" height="140" fill="black"/></mask>
        <mask id="navBowlM"><rect width="120" height="140" fill="white"/><circle cx="72" cy="96" r="22" fill="black"/></mask>
      </defs>
      <svg x="50" y="10" width="100" height="116.67" viewBox="0 0 120 140">
        <rect x="18" y="10" width="16" height="114" rx="8" fill="#F59E0B"/>
        <circle cx="34" cy="34" r="22" fill="#3B5BDB" mask="url(#navBlueM)"/>
        <circle cx="72" cy="96" r="40" fill="#F59E0B" mask="url(#navBowlM)"/>
        <text x="10" y="40" fontFamily="Sora,sans-serif" fontWeight="700" fontSize="18" textAnchor="middle" fill="#3B5BDB">c</text>
      </svg>
      <text x="100" y="158" fontFamily="Sora,sans-serif" fontWeight="800" fontSize="52" letterSpacing="-1.5" textAnchor="middle" fill="#F59E0B">bean</text>
    </svg>
  );

  if(showOnboarding) return <OnboardingFlow onComplete={()=>{try{localStorage.setItem("dws_tutorial_step","1");}catch{}window.location.reload();}} onConnectGoogle={signIn}/>;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100dvh",background:"linear-gradient(135deg, #0e1320 0%, #111827 25%, #0e1a2e 50%, #131b2e 75%, #0e1320 100%)",backgroundSize:"400% 400%",animation:"bgShift 30s ease infinite",color:"rgba(255,255,255,0.88)",fontFamily:FONT,overflow:"hidden"}}>
      <FixedVoice currentBizId={activeTab} isAuthed={authStatus==="authed"||authStatus==="cached"} onAddTask={addTask} onAddCalEvent={addCalEvent} onAddNote={addNote} onOpenCommandBean={()=>setCmdOpen(true)} isMobile={isMobile} onGoHome={()=>{window.dispatchEvent(new Event("closeRhythm"));setActiveTab(-1);}}/>
      {showTooltip&&(
        <div onClick={()=>{setShowTooltip(false);localStorage.setItem("dws_vt","1");}}
          style={{position:"fixed",top:isMobile?104:104,right:16,zIndex:1998,maxWidth:isMobile?"calc(100vw - 32px)":220,
            background:"rgba(255,255,255,0.97)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",
            borderRadius:14,border:"1.5px solid rgba(239,83,80,0.5)",
            boxShadow:"0 8px 30px rgba(239,83,80,0.2),0 2px 8px rgba(0,0,0,0.08)",
            padding:"12px 14px",cursor:"pointer",animation:"fadeSlideIn 0.4s ease-out",fontFamily:FONT}}>
          <div style={{position:"absolute",top:-8,right:28,width:0,height:0,borderLeft:"7px solid transparent",borderRight:"7px solid transparent",borderBottom:"8px solid rgba(239,83,80,0.5)"}}/>
          <div style={{position:"absolute",top:-6,right:29,width:0,height:0,borderLeft:"6px solid transparent",borderRight:"6px solid transparent",borderBottom:"7px solid rgba(255,255,255,0.97)"}}/>
          <div style={{fontSize:12,fontWeight:700,color:"#EF5350",letterSpacing:1,fontFamily:FONT_MONO,marginBottom:4}}>BEAN VOICE</div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.88)",lineHeight:1.5}}>Tap the voice button to add tasks, notes, and events with your voice.</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginTop:6,letterSpacing:0.5}}>Tap to dismiss</div>
        </div>
      )}
      {cmdOpen&&<CommandBeanDialog state={state} allEvents={allEvents} gTasks={gTasks} gTaskLists={gTaskLists} isAuthed={authStatus==="authed"||authStatus==="cached"} onClose={()=>setCmdOpen(false)} onNavigate={(id)=>{setCmdOpen(false);setActiveTab(id);}} isMobile={isMobile}/>}
      {deleteBizConfirm!==null&&<DeleteBizConfirmModal biz={BIZ[deleteBizConfirm]} onConfirm={confirmDeleteBiz} onCancel={()=>setDeleteBizConfirm(null)}/>}
      {editBizId!==null&&<EditBizModal bizId={editBizId} onSave={saveEditBiz} onClose={()=>setEditBizId(null)}/>}
      {showTutorial&&<TutorialHints onDone={()=>setShowTutorial(false)}/>}
      {needsDriveConsent&&(
        <div style={{background:"#EF5350",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexShrink:0}}>
          <span style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.88)",fontFamily:FONT_MONO,letterSpacing:0.5}}>NOTES NEED DRIVE ACCESS</span>
          <button onClick={()=>{setNeedsDriveConsent(false);tcRef.current?.requestAccessToken({prompt:"consent"});}} style={{background:"#1a1a2e",color:"#EF5350",border:"none",borderRadius:6,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:FONT_MONO,letterSpacing:0.5,whiteSpace:"nowrap"}}>GRANT ACCESS</button>
        </div>
      )}
      <div style={{flex:1,minHeight:0,overflow:"auto",WebkitOverflowScrolling:"touch"}}>
        {activeTab===-1
          ?<Overview state={state} allEvents={allEvents} calLoading={calLoading} authStatus={authStatus} authToken={authToken} onRefresh={doRefresh} onNavigate={setActiveTab} gTasks={gTasks} gTaskLists={gTaskLists} onCompleteGTask={completeGTask} onDeleteGTask={deleteGTask} onAddTask={addTask} onAddCalEvent={addCalEvent} onUpdateNote={updateNote} onDeleteNote={deleteNote} onAddNote={addNote} deletedBizIds={deletedBizIds} onDeleteBiz={deleteBiz} onEditBiz={setEditBizId} bizOrder={bizOrder} onReorder={setBizOrder}/>
          :activeTab==="goals"
          ?<GoalsWidget onBack={()=>setActiveTab(-1)}/>
          :<BizPage biz={biz} bizId={activeTab} state={state} allEvents={allEvents} calMonth={calMonth} setCalMonth={setCalMonth} onAddTask={addTask} onDeleteTask={deleteTask} onDeleteAllTasks={deleteAllTasks} onToggleTask={toggleTask} onEditTask={editLocalTask} gTasks={gTasks} gTaskLists={gTaskLists} onAddCalEvent={addCalEvent} onDeleteCalEvent={deleteCalEvent} onDeleteAllCalEvent={deleteAllRecurringEvents} onEditCalEvent={editCalEvent} onEditAllCalEvent={editAllCalEvents} onCompleteGTask={completeGTask} onDeleteGTask={deleteGTask} onEditGTask={editGTask} isAuthed={authStatus==="authed"||authStatus==="cached"} onPushBudgetEvent={authStatus==="authed"?pushBudgetEvent:null} onUpdateNote={updateNote} onDeleteNote={deleteNote} onAddNote={addNote} onNavigate={setActiveTab} bizOrder={bizOrder}/>
        }
      </div>
      <div style={{background:"linear-gradient(90deg, #12122a, #1e1e3a)",borderTop:"1px solid rgba(255,255,255,0.06)",padding:"6px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <span onClick={authStatus!=="authed"?(authStatus==="expired"?reAuth:signIn):undefined} style={{fontSize:10,color:authStatus==="authed"?"rgba(255,255,255,0.3)":authStatus==="expired"?"#EF5350":"rgba(100,180,255,0.7)",fontFamily:FONT_MONO,letterSpacing:0.5,cursor:authStatus!=="authed"?"pointer":"default",textDecoration:authStatus!=="authed"?"underline":"none",textUnderlineOffset:2}}>DWS v7.0 · {authStatus==="authed"?"Google Live ✓":authStatus==="expired"?"Session expired — Tap to reconnect →":authStatus==="cached"?"Cached — Tap to connect Google →":"Tap to connect Google →"}</span>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.4)",fontWeight:600,fontFamily:FONT_MONO}}><LiveClock/></span>
      </div>
    </div>
  );
}
