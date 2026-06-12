import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const VERSION = "7";

// ── Firebase ──────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBLlzavBNImCRG0JacPZWdVIxezxKiqHcc",
  authDomain: "rydercup-6f9d1.firebaseapp.com",
  projectId: "rydercup-6f9d1",
  storageBucket: "rydercup-6f9d1.firebasestorage.app",
  messagingSenderId: "198567886432",
  appId: "1:198567886432:web:e02904e589913db76c4d05"
};
const VAPID_KEY = "BOvJniR7hOuyvR44_6ZTm-O9y6T6DLvCT4KCGhKirxWMJpN456RXCoCpD_OHB301ZrgMBlys5XEmDjC1VfF0QTs";
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
let messaging = null;
try { messaging = getMessaging(firebaseApp); } catch(e) {}

// Dedup push: track last sent notification to avoid double-firing
let lastPushKey = null;

async function saveTournament(data) { await setDoc(doc(db,"tournaments","ryder2024"),data); }
async function registerFCMToken() {
  if(!messaging) return null;
  try {
    const t = await getToken(messaging,{vapidKey:VAPID_KEY});
    if(t) { await setDoc(doc(db,"fcm_tokens",t),{token:t,createdAt:Date.now()}); return t; }
  } catch(e) { console.warn("FCM token error:",e); }
  return null;
}
async function sendPushToAll(title, body, dedupeKey) {
  // Prevent double-sending same notification
  if(dedupeKey && dedupeKey === lastPushKey) return;
  lastPushKey = dedupeKey;
  try {
    await fetch('/api/send-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})});
  } catch(e) { console.warn("Push error:",e); }
}

// ── Access ────────────────────────────────────────────────────────────────────
const ADMIN_CODE="RYDER-ADMIN", VIEWER_CODE="RYDER2024";
function resolveRole(code) {
  const c=code.trim().toUpperCase();
  if(c===ADMIN_CODE) return "admin";
  if(c===VIEWER_CODE) return "viewer";
  const m=c.match(/^MATCH(\d+)$/); if(m) return `match-${parseInt(m[1])-1}`;
  return null;
}

// ── Courses ───────────────────────────────────────────────────────────────────
const COURSES = {
  riedhof:{name:"GC München-Riedhof",shortName:"Riedhof",location:"Egling",par:[4,3,4,5,3,4,3,4,4,4,3,5,4,5,4,5,4,4]},
  bergkramerhof:{name:"Golfclub Bergkramerhof",shortName:"Bergkramerhof",location:"Wolfratshausen",par:[4,5,3,4,4,3,5,3,5,4,3,4,3,5,4,5,4,4]},
};

// ── Game Modes ────────────────────────────────────────────────────────────────
const GAME_MODES = {
  scramble: { label:"Scramble", icon:"🔀", desc:"2v2 · Bestes Team-Ergebnis", pairs:true },
  singles:  { label:"Singles",  icon:"👤", desc:"1v1 · Individuell",          pairs:false },
  foursomes:{ label:"Foursomes",icon:"🔄", desc:"2v2 · Abwechselnd schlagen", pairs:true },
  fourball: { label:"Four-Ball",icon:"⛳", desc:"2v2 · Bester Ball zählt",    pairs:true },
};

// ── HCP ───────────────────────────────────────────────────────────────────────
function calcTeamHcp(h1, h2) {
  const lo=Math.min(h1,h2), hi=Math.max(h1,h2);
  return Math.round((lo*0.35+hi*0.15)*10)/10;
}
function avgHcp(players) {
  if(!players.length) return 0;
  const valid=players.filter(p=>p.hcp!=="");
  if(!valid.length) return 0;
  return Math.round((valid.reduce((s,p)=>s+parseFloat(p.hcp),0)/valid.length)*10)/10;
}

// ── Matchplay ─────────────────────────────────────────────────────────────────
function calcRoundStatus(scores, pars, s, e) {
  let diff=0, played=0;
  for(let i=s;i<e;i++){
    const h=scores[i];
    if(h.team1!==null&&h.team2!==null){played++;if(h.team1<h.team2)diff++;else if(h.team2<h.team1)diff--;}
  }
  const left=e-s-played; let won=false,label="AS";
  if(left===0){won=true;label=diff>0?"1UP":diff<0?"1UP":"AS";}
  else if(Math.abs(diff)>left){won=true;label=`${Math.abs(diff)}&${left}`;}
  else if(diff!==0){label=`${Math.abs(diff)} UP`;}
  return{diff,holesPlayed:played,holesLeft:left,label,won};
}
function getPoints(rs) {
  if(rs.won||rs.holesLeft===0){if(rs.diff>0)return{t1:1,t2:0};if(rs.diff<0)return{t1:0,t2:1};return{t1:0.5,t2:0.5};}
  return null;
}
function projectedPoints(rs) {
  if(rs.won||rs.holesLeft===0) return getPoints(rs);
  const a=rs.diff/18; return{t1:0.5+a*0.4,t2:0.5-a*0.4};
}
function calcTournament(days) {
  let t1c=0,t2c=0,t1p=0,t2p=0,total=0;
  days.forEach(day=>{
    const c=COURSES[day.courseKey];
    day.matches.forEach(m=>{
      total+=2;
      [0,1].forEach(r=>{
        const rs=calcRoundStatus(m.scores,c.par,r*9,r*9+9);
        const conf=getPoints(rs),proj=projectedPoints(rs);
        if(conf){t1c+=conf.t1;t2c+=conf.t2;}
        t1p+=proj.t1;t2p+=proj.t2;
      });
    });
  });
  const s=t1p+t2p;
  return{t1Confirmed:t1c,t2Confirmed:t2c,t1Projected:Math.round(t1p*10)/10,t2Projected:Math.round(t2p*10)/10,t1WinProb:s>0?Math.round((t1p/s)*100):50,t2WinProb:s>0?Math.round((t2p/s)*100):50,totalPoints:total,needed:total/2+0.5};
}
function emptyScores() { return Array.from({length:18},()=>({team1:null,team2:null})); }
function detectPointChange(oldDays,newDays,t1Name,t2Name) {
  if(!oldDays) return null;
  for(let di=0;di<newDays.length;di++){
    const od=oldDays[di],nd=newDays[di]; if(!od) continue;
    const c=COURSES[nd.courseKey];
    for(let mi=0;mi<nd.matches.length;mi++){
      const om=od.matches[mi],nm=nd.matches[mi]; if(!om) continue;
      for(let r=0;r<2;r++){
        const ors=calcRoundStatus(om.scores,c.par,r*9,r*9+9);
        const nrs=calcRoundStatus(nm.scores,c.par,r*9,r*9+9);
        const op=getPoints(ors),np=getPoints(nrs);
        if(!op&&np){
          const runde=r===0?"Runde 1":"Runde 2";
          const winner=np.t1>np.t2?t1Name:np.t2>np.t1?t2Name:null;
          const key=`${nm.id}-${r}-${np.t1}-${np.t2}`;
          return{title:winner?`🏆 ${winner} gewinnt ${runde}!`:`🤝 ${runde} Unentschieden`,body:`${nm.name} · ${runde} · ${np.t1}:${np.t2} Punkte`,winner,key};
        }
      }
    }
  }
  return null;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function calcStats(days,t1Name,t2Name) {
  const pairStats={};
  let t1TotalHoles=0,t2TotalHoles=0;
  const holeWins={t1:Array(18).fill(0),t2:Array(18).fill(0),tie:Array(18).fill(0)};
  days.forEach(day=>{
    const course=COURSES[day.courseKey];
    day.matches.forEach(m=>{
      const isPairs=GAME_MODES[m.mode||"scramble"]?.pairs!==false;
      const key1=isPairs?m.t1Pair.join(" & "):m.t1Pair[0]||"?";
      const key2=isPairs?m.t2Pair.join(" & "):m.t2Pair[0]||"?";
      if(!pairStats[key1])pairStats[key1]={name:key1,team:"t1",pts:0,holesWon:0};
      if(!pairStats[key2])pairStats[key2]={name:key2,team:"t2",pts:0,holesWon:0};
      [0,1].forEach(r=>{
        const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);
        const pts=getPoints(rs);
        if(pts){pairStats[key1].pts+=pts.t1;pairStats[key2].pts+=pts.t2;}
        for(let i=r*9;i<r*9+9;i++){
          const sc=m.scores[i];
          if(sc.team1!==null&&sc.team2!==null){
            if(sc.team1<sc.team2){pairStats[key1].holesWon++;t1TotalHoles++;holeWins.t1[i]++;}
            else if(sc.team2<sc.team1){pairStats[key2].holesWon++;t2TotalHoles++;holeWins.t2[i]++;}
            else holeWins.tie[i]++;
          }
        }
      });
    });
  });
  const allPairs=Object.values(pairStats);
  const hotHoles=holeWins.t1.map((_,i)=>({hole:i+1,t1:holeWins.t1[i],t2:holeWins.t2[i],tie:holeWins.tie[i],total:holeWins.t1[i]+holeWins.t2[i]+holeWins.tie[i]})).filter(h=>h.total>0).sort((a,b)=>b.total-a.total);
  return{t1Pairs:allPairs.filter(p=>p.team==="t1").sort((a,b)=>b.pts-a.pts),t2Pairs:allPairs.filter(p=>p.team==="t2").sort((a,b)=>b.pts-a.pts),t1TotalHoles,t2TotalHoles,holeWins,hotHoles,allPairs};
}

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES={
  dark:{bg:"#0D2B1A",surface:"#0F2D1A",elevated:"#1A4D2E",border:"#2D6B40",borderFaint:"#1A4030",gold:"#C9A84C",cream:"#F2EDD7",muted:"#8BAF7C",faint:"#4A7A5C",blue:"#4A9EFF",red:"#FF6B6B",holeBg:"#1A3D25",holeText:"#4A7A5C",headerBg:"linear-gradient(135deg,#0A2014,#1A4D2E)",cardBg:"linear-gradient(180deg,#1A4D2E 0%,#0F3320 100%)",isDark:true},
  light:{bg:"#F4F6F4",surface:"#FFFFFF",elevated:"#EEF2EE",border:"#D0DDD0",borderFaint:"#E0E8E0",gold:"#2E7D32",cream:"#1A1A1A",muted:"#5A7A5A",faint:"#8A9A8A",blue:"#1565C0",red:"#C62828",holeBg:"#F0F4F0",holeText:"#AAAAAA",headerBg:"linear-gradient(135deg,#1B5E20,#2E7D32)",cardBg:"#FFFFFF",isDark:false},
};
const fmt=v=>v%1===0?v:v.toFixed(1);

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconReset=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const IconSettings=({size=18,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconBack=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const IconChart=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const IconUser=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconPlus=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconTrash=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti({active,onDone}){
  const canvasRef=useRef(null);
  useEffect(()=>{
    if(!active)return;
    const canvas=canvasRef.current; if(!canvas)return;
    const ctx=canvas.getContext("2d");
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const pieces=Array.from({length:120},()=>({x:Math.random()*canvas.width,y:-20,w:8+Math.random()*8,h:8+Math.random()*8,r:Math.random()*Math.PI*2,dr:(Math.random()-0.5)*0.2,dx:(Math.random()-0.5)*4,dy:3+Math.random()*4,color:["#C9A84C","#4A9EFF","#FF6B6B","#8BAF7C","#F2EDD7","#FFD700"][Math.floor(Math.random()*6)],opacity:1}));
    let frame,start=null;
    const draw=(ts)=>{
      if(!start)start=ts; const elapsed=ts-start;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      pieces.forEach(p=>{p.x+=p.dx;p.y+=p.dy;p.r+=p.dr;if(elapsed>2000)p.opacity=Math.max(0,p.opacity-0.02);ctx.save();ctx.globalAlpha=p.opacity;ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();});
      if(elapsed<3500)frame=requestAnimationFrame(draw);
      else{ctx.clearRect(0,0,canvas.width,canvas.height);onDone();}
    };
    frame=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(frame);
  },[active]);
  if(!active)return null;
  return<canvas ref={canvasRef} style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:500}}/>;
}

// ── Win Banner ────────────────────────────────────────────────────────────────
function WinBanner({event,onDone}){
  useEffect(()=>{if(!event)return;const t=setTimeout(onDone,4000);return()=>clearTimeout(t);},[event]);
  if(!event)return null;
  return(
    <div style={{position:"fixed",top:"80px",left:"50%",transform:"translateX(-50%)",zIndex:501,textAlign:"center",pointerEvents:"none",width:"90%",maxWidth:"360px",animation:"slideDown 0.4s ease"}}>
      <style>{`@keyframes slideDown{from{transform:translateX(-50%) translateY(-30px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}`}</style>
      <div style={{background:event.winner?"linear-gradient(135deg,#C9A84C,#A07830)":"linear-gradient(135deg,#2D6B40,#1A4D2E)",borderRadius:"16px",padding:"18px 24px",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",border:"2px solid rgba(255,255,255,0.2)"}}>
        <div style={{fontSize:"36px",marginBottom:"6px"}}>{event.winner?"🏆":"🤝"}</div>
        <div style={{fontSize:"18px",fontWeight:"900",color:event.winner?"#0D2B1A":"#F2EDD7",fontFamily:"'Arial Black',sans-serif",letterSpacing:"1px"}}>{event.title}</div>
        <div style={{fontSize:"12px",color:event.winner?"rgba(0,0,0,0.6)":"#8BAF7C",marginTop:"4px"}}>{event.body}</div>
      </div>
    </div>
  );
}

// ── Back Button ───────────────────────────────────────────────────────────────
function BackButton({onConfirm,T}){
  const [show,setShow]=useState(false);
  return(
    <>
      <button style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"6px",color:"rgba(255,255,255,0.6)",fontSize:"11px",padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px"}} onClick={()=>setShow(true)}>
        <IconBack size={12} color="rgba(255,255,255,0.6)"/> Login
      </button>
      {show&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={()=>setShow(false)}>
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"32px",marginBottom:"10px"}}>🚪</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,marginBottom:"6px"}}>Zurück zum Login?</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px"}}>Dein Fortschritt bleibt gespeichert.</div>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px"}} onClick={onConfirm}>Zurück zum Login</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={()=>setShow(false)}>Abbrechen</button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Reset Confirm ─────────────────────────────────────────────────────────────
function ResetConfirm({title,message,onConfirm,onClose,T}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"44px",height:"44px",borderRadius:"50%",background:"#E0525222",border:"1px solid #E0525255",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><IconReset size={22} color="#E05252"/></div>
        <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,marginBottom:"6px"}}>{title}</div>
        <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px"}}>{message}</div>
        <button style={{width:"100%",padding:"11px",background:"#E05252",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px"}} onClick={onConfirm}>Ja, zurücksetzen</button>
        <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Role Badge ────────────────────────────────────────────────────────────────
function RoleBadge({role,T}){
  const isAdmin=role==="admin",isViewer=role==="viewer";
  const num=!isAdmin&&!isViewer?parseInt(role.split("-")[1])+1:null;
  const label=isAdmin?"👑 Admin":isViewer?"👁 Zuschauer":`⛳ Match ${num}`;
  const color=isAdmin?T.gold:isViewer?T.muted:T.blue;
  return<div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"3px 10px",fontSize:"10px",color,letterSpacing:"1px"}}>{label}</div>;
}

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel({T,currentTheme,onThemeChange,onClose}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",padding:"20px 18px 32px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{fontSize:"14px",fontWeight:"700",color:T.cream,marginBottom:"16px",letterSpacing:"1px",textTransform:"uppercase"}}>Darstellung</div>
        <div style={{display:"flex",gap:"10px",marginBottom:"20px"}}>
          {[["dark","🌲 Dark Green"],["light","☀️ Clean White"]].map(([k,l])=>(
            <button key={k} onClick={()=>onThemeChange(k)} style={{flex:1,padding:"14px 10px",borderRadius:"10px",border:`2px solid ${currentTheme===k?T.gold:T.border}`,background:currentTheme===k?T.gold+"22":T.elevated,color:currentTheme===k?T.gold:T.muted,fontSize:"13px",cursor:"pointer",fontWeight:currentTheme===k?"700":"400"}}>{l}</button>
          ))}
        </div>
        <button style={{width:"100%",padding:"12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={onClose}>Schließen</button>
      </div>
    </div>
  );
}

// ── Push Banner ───────────────────────────────────────────────────────────────
function PushBanner({onDismiss,T}){
  const [state,setState]=useState("idle");
  const req=async()=>{setState("requesting");if(!("Notification"in window)||!messaging){setState("unsupported");return;}try{const p=await Notification.requestPermission();if(p==="granted"){await registerFCMToken();setState("granted");setTimeout(onDismiss,2000);}else setState("denied");}catch(e){setState("denied");}};
  if(state==="granted")return<div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}><span style={{fontSize:"20px"}}>✅</span><div style={{fontSize:"12px",color:T.muted}}>Push aktiviert!</div></div>;
  if(state==="denied"||state==="unsupported")return<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px"}}><div style={{fontSize:"12px",color:"#E05252",marginBottom:"4px"}}>{state==="unsupported"?"❌ Bitte App als PWA installieren":"❌ Benachrichtigungen blockiert"}</div><button style={{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer",marginTop:"8px"}} onClick={onDismiss}>Schließen</button></div>;
  return(
    <div style={{background:T.isDark?"linear-gradient(135deg,#1A3D2E,#0F2D1A)":T.elevated,border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"10px"}}>
        <span style={{fontSize:"22px"}}>🔔</span>
        <div><div style={{fontSize:"13px",fontWeight:"700",color:T.gold,marginBottom:"3px"}}>Push-Benachrichtigungen</div><div style={{fontSize:"11px",color:T.muted}}>Erhalte eine Meldung wenn ein Team einen Punkt gewinnt.</div><div style={{fontSize:"10px",color:T.faint,marginTop:"4px"}}>⚠️ Nur als PWA (Homescreen) auf iOS 16.4+</div></div>
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <button style={{flex:1,padding:"10px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"12px",fontWeight:"900",cursor:"pointer"}} onClick={req} disabled={state==="requesting"}>{state==="requesting"?"Warte...":"🔔 Aktivieren"}</button>
        <button style={{padding:"10px 14px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"12px",cursor:"pointer"}} onClick={onDismiss}>Später</button>
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({message,onDismiss}){
  useEffect(()=>{const t=setTimeout(onDismiss,5000);return()=>clearTimeout(t);},[]);
  if(!message)return null;
  return(
    <div style={{position:"fixed",top:"16px",left:"50%",transform:"translateX(-50%)",zIndex:400,background:"linear-gradient(135deg,#1A4D2E,#0F3320)",border:"1px solid #C9A84C",borderRadius:"12px",padding:"12px 18px",maxWidth:"340px",width:"90%",boxShadow:"0 4px 20px rgba(0,0,0,0.5)",display:"flex",alignItems:"center",gap:"10px"}} onClick={onDismiss}>
      <span style={{fontSize:"20px"}}>🏆</span>
      <div><div style={{fontSize:"13px",fontWeight:"700",color:"#C9A84C"}}>{message.title}</div><div style={{fontSize:"11px",color:"#8BAF7C",marginTop:"2px"}}>{message.body}</div></div>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function Login({onLogin}){
  const [code,setCode]=useState(""),[error,setError]=useState("");
  const check=()=>{const r=resolveRole(code);if(r)onLogin(r);else setError("Ungültiger Code");};
  const T=THEMES.dark;
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:"320px",textAlign:"center"}}>
        <div style={{fontSize:"56px",marginBottom:"10px"}}>⛳</div>
        <div style={{fontSize:"26px",fontWeight:"900",color:T.gold,letterSpacing:"4px",textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Ryder Cup</div>
        <div style={{fontSize:"11px",color:T.muted,letterSpacing:"2px",marginBottom:"4px"}}>Friends Edition · 2 Spieltage</div>
        <div style={{fontSize:"10px",color:T.faint,letterSpacing:"1px",marginBottom:"24px"}}>Version {VERSION}</div>
        <input style={{width:"100%",padding:"14px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"20px",letterSpacing:"6px",textAlign:"center",marginBottom:"10px",boxSizing:"border-box",outline:"none"}}
          placeholder="CODE EINGEBEN" value={code}
          onChange={e=>{setCode(e.target.value.toUpperCase());setError("");}}
          onKeyDown={e=>e.key==="Enter"&&check()}/>
        {error&&<div style={{color:"#E05252",fontSize:"12px",marginBottom:"10px"}}>{error}</div>}
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:"#0D2B1A",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"}} onClick={check}>Eintreten</button>
        <div style={{marginTop:"16px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"12px",textAlign:"left"}}>
          <div style={{fontSize:"10px",color:T.gold,letterSpacing:"1px",marginBottom:"8px"}}>ZUGANGSCODES</div>
          {[["👑 Admin","RYDER-ADMIN"],["👁 Zuschauer","RYDER2024"],["⛳ Spieler","MATCH1 – MATCH8"]].map(([r,c])=>(
            <div key={r} style={{display:"flex",justifyContent:"space-between",fontSize:"11px",marginBottom:"4px"}}>
              <span style={{color:T.muted}}>{r}</span><span style={{color:T.cream,fontFamily:"monospace"}}>{c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN SETUP – 4 STEPS
// ══════════════════════════════════════════════════════════════════════════════

// ── Step 1: Teams & Match Count ───────────────────────────────────────────────
function SetupStep1({onNext,onBack,T}){
  const [t1Name,setT1Name]=useState("Team Europa");
  const [t2Name,setT2Name]=useState("Team USA");
  const [mc,setMc]=useState(4);
  const inp={width:"100%",padding:"10px 12px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",boxSizing:"border-box",outline:"none"};
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup 1/4</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>TEAMS & MATCHES</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"10px",color:T.blue,letterSpacing:"2px",marginBottom:"6px"}}>🔵 TEAM 1 NAME</div>
          <input style={{...inp,marginBottom:"14px"}} value={t1Name} onChange={e=>setT1Name(e.target.value)}/>
          <div style={{fontSize:"10px",color:T.red,letterSpacing:"2px",marginBottom:"6px"}}>🔴 TEAM 2 NAME</div>
          <input style={inp} value={t2Name} onChange={e=>setT2Name(e.target.value)}/>
        </div>
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"12px"}}>MATCHES PRO TAG</div>
          <div style={{display:"flex",gap:"8px"}}>
            {[2,3,4].map(n=>(
              <button key={n} onClick={()=>setMc(n)} style={{flex:1,padding:"16px",borderRadius:"10px",border:`2px solid ${mc===n?T.gold:T.border}`,background:mc===n?T.gold+"22":T.elevated,color:mc===n?T.gold:T.muted,fontSize:"22px",fontWeight:"900",cursor:"pointer",fontFamily:"'Arial Black',sans-serif"}}>{n}</button>
            ))}
          </div>
          <div style={{fontSize:"11px",color:T.faint,marginTop:"8px",textAlign:"center"}}>{mc} Matches × 2 Runden × 2 Tage = <span style={{color:T.gold,fontWeight:"700"}}>{mc*4} Punkte</span></div>
        </div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"}} onClick={()=>onNext({t1Name,t2Name,matchCount:mc})}>Weiter → Spieler</button>
      </div>
    </div>
  );
}

// ── Step 2: Player Pool (loaded from Firestore savedPlayers) ──────────────────
function SetupStep2({initialPlayers,onNext,onBack,T}){
  const defaultPool=initialPlayers&&initialPlayers.length>=2?initialPlayers:[
    {id:"p1",firstName:"",lastName:"",fn:"",ln:"",hcp:""},
    {id:"p2",firstName:"",lastName:"",fn:"",ln:"",hcp:""},
  ];
  const [players,setPlayers]=useState(defaultPool);
  const fromDB=initialPlayers&&initialPlayers.length>=2;

  const addPlayer=()=>setPlayers(p=>[...p,{id:`p${Date.now()}`,firstName:"",lastName:"",fn:"",ln:"",hcp:""}]);
  const upd=(id,field,val)=>setPlayers(p=>p.map(x=>{
    if(x.id!==id)return x;
    // keep both firstName/fn and lastName/ln in sync
    if(field==="firstName")return{...x,firstName:val,fn:val};
    if(field==="lastName")return{...x,lastName:val,ln:val};
    return{...x,[field]:val};
  }));
  const rem=id=>setPlayers(p=>p.filter(x=>x.id!==id));

  // Normalise: ensure fn/ln are set for players that came from Firestore
  const norm=(p)=>({...p,firstName:p.firstName||p.fn||"",lastName:p.lastName||p.ln||"",fn:p.fn||p.firstName||"",ln:p.ln||p.lastName||""});
  const normPlayers=players.map(norm);
  const ok=normPlayers.every(p=>p.fn.trim()&&p.ln.trim()&&p.hcp!=="")&&normPlayers.length>=2;

  const inp={background:T.surface,border:`1px solid ${T.border}`,borderRadius:"6px",color:T.cream,fontSize:"12px",padding:"7px 8px",outline:"none",boxSizing:"border-box",fontFamily:"'Arial',sans-serif"};

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup 2/4</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>SPIELER POOL</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {fromDB?(
          <div style={{background:T.elevated,border:`1px solid ${T.gold}55`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.gold,fontFamily:"'Arial',sans-serif"}}>
            ✓ {players.length} Spieler aus der Spielerverwaltung geladen
          </div>
        ):(
          <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.muted,fontFamily:"'Arial',sans-serif"}}>
            💡 Tipp: Lege Spieler in der Spielerverwaltung an, dann werden sie hier automatisch geladen.
          </div>
        )}
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          {normPlayers.map((p,i)=>(
            <div key={p.id} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"10px",padding:"8px",background:T.surface,borderRadius:"8px",border:`1px solid ${T.border}`}}>
              <PlayerAvatar name={(p.fn||"?")+(" "+(p.ln||""))} size={36} color={T.blue} photo={p.photo||null}/>
              <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr 56px",gap:"4px"}}>
                <input style={inp} placeholder="Vorname" value={p.fn} onChange={e=>upd(p.id,"firstName",e.target.value)}/>
                <input style={inp} placeholder="Nachname" value={p.ln} onChange={e=>upd(p.id,"lastName",e.target.value)}/>
                <input style={{...inp,textAlign:"center"}} inputMode="decimal" placeholder="HCP" value={p.hcp} onChange={e=>upd(p.id,"hcp",e.target.value)}/>
              </div>
              <div style={{cursor:"pointer",color:normPlayers.length>2?"#E05252":T.faint}} onClick={()=>normPlayers.length>2&&rem(p.id)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
            </div>
          ))}
          <button style={{width:"100%",padding:"8px",background:"transparent",border:`1px dashed ${T.gold}55`,borderRadius:"6px",color:T.gold,fontSize:"12px",cursor:"pointer",marginTop:"4px",fontFamily:"'Arial',sans-serif"}} onClick={addPlayer}>+ Spieler hinzufügen</button>
        </div>
        <div style={{fontSize:"11px",color:T.muted,textAlign:"center",marginBottom:"14px",fontFamily:"'Arial',sans-serif"}}>{normPlayers.length} Spieler im Pool</div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:ok?1:0.4,fontFamily:"'Arial',sans-serif"}} onClick={()=>ok&&onNext({playerPool:normPlayers})}>Weiter → Teams</button>
        {!ok&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px",fontFamily:"'Arial',sans-serif"}}>Bitte alle Felder ausfüllen (mind. 2 Spieler)</div>}
      </div>
    </div>
  );
}

// ── Step 3: Team Builder (Drag & Drop) ────────────────────────────────────────
function SetupStep3({t1Name,t2Name,playerPool,onNext,onBack,T}){
  const [pool,setPool]=useState([...playerPool]);
  const [team1,setTeam1]=useState([]);
  const [team2,setTeam2]=useState([]);
  const [dragging,setDragging]=useState(null); // {player, from}

  const movePlayer=(player,from,to)=>{
    const remove=(arr)=>arr.filter(p=>p.id!==player.id);
    if(from==="pool")setPool(remove);
    else if(from==="t1")setTeam1(remove);
    else if(from==="t2")setTeam2(remove);
    if(to==="pool")setPool(p=>[...p,player]);
    else if(to==="t1")setTeam1(p=>[...p,player]);
    else if(to==="t2")setTeam2(p=>[...p,player]);
  };

  const onDrop=(to)=>{
    if(!dragging)return;
    if(dragging.from!==to)movePlayer(dragging.player,dragging.from,to);
    setDragging(null);
  };

  const avg1=avgHcp(team1), avg2=avgHcp(team2);
  const diff=Math.abs(avg1-avg2);
  const balanced=diff<=2;

  const PlayerChip=({player,from,color})=>(
    <div
      draggable
      onDragStart={()=>setDragging({player,from})}
      onDragEnd={()=>setDragging(null)}
      style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:T.surface,border:`1px solid ${color||T.border}`,borderRadius:"8px",padding:"6px 10px",marginBottom:"6px",cursor:"grab",userSelect:"none",opacity:dragging?.player.id===player.id?0.4:1}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <PlayerAvatar name={(player.fn||player.firstName||"?")+" "+(player.ln||player.lastName||"")} size={28} color={color||T.gold} photo={player.photo||null}/>
        <div>
          <div style={{fontSize:"12px",fontWeight:"600",color:T.cream,fontFamily:"'Arial',sans-serif"}}>{player.fn||player.firstName} {player.ln||player.lastName}</div>
          <div style={{fontSize:"10px",color:T.faint,fontFamily:"'Arial',sans-serif"}}>HCP {player.hcp}</div>
        </div>
      </div>
      <div style={{fontSize:"9px",color:T.faint}}>⠿</div>
    </div>
  );

  const DropZone=({label,players,zoneName,color})=>(
    <div
      onDragOver={e=>e.preventDefault()}
      onDrop={()=>onDrop(zoneName)}
      style={{flex:1,minHeight:"120px",background:dragging&&dragging.from!==zoneName?color+"11":T.surface,border:`2px dashed ${dragging&&dragging.from!==zoneName?color:T.border}`,borderRadius:"10px",padding:"10px",transition:"all 0.15s"}}>
      <div style={{fontSize:"10px",fontWeight:"700",color,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>{label}</span>
        {players.length>0&&<span style={{fontSize:"10px",color:T.faint}}>⌀ HCP {avgHcp(players)}</span>}
      </div>
      {players.length===0&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",paddingTop:"16px"}}>Hier ablegen</div>}
      {players.map(p=><PlayerChip key={p.id} player={p} from={zoneName} color={color}/>)}
    </div>
  );

  const ok=team1.length>0&&team2.length>0&&pool.length===0;

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup 3/4</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>TEAMS ZUSAMMENSTELLEN</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>

        {/* Balance indicator */}
        {(team1.length>0||team2.length>0)&&(
          <div style={{background:balanced?T.elevated:"#3D1A1A",border:`1px solid ${balanced?T.border:"#E0525266"}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}>
            <span style={{fontSize:"16px"}}>{balanced?"⚖️":"⚠️"}</span>
            <div>
              <div style={{fontSize:"12px",fontWeight:"700",color:balanced?T.muted:"#E05252"}}>{balanced?"Teams ausgeglichen":"Teams unausgeglichen"}</div>
              <div style={{fontSize:"10px",color:T.faint}}>
                {t1Name}: ⌀ {avg1} HCP · {t2Name}: ⌀ {avg2} HCP · Diff: {diff.toFixed(1)}
              </div>
            </div>
          </div>
        )}

        {/* Pool */}
        {pool.length>0&&(
          <div style={{marginBottom:"14px"}}>
            <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",marginBottom:"8px",textTransform:"uppercase"}}>Spieler Pool ({pool.length})</div>
            <div onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop("pool")}
              style={{background:T.surface,border:`2px dashed ${T.gold}55`,borderRadius:"10px",padding:"10px"}}>
              {pool.map(p=><PlayerChip key={p.id} player={p} from="pool" color={T.gold}/>)}
            </div>
          </div>
        )}

        {/* Teams */}
        <div style={{display:"flex",gap:"10px",marginBottom:"14px"}}>
          <DropZone label={`🔵 ${t1Name}`} players={team1} zoneName="t1" color={T.blue}/>
          <DropZone label={`🔴 ${t2Name}`} players={team2} zoneName="t2" color={T.red}/>
        </div>

        {pool.length>0&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginBottom:"14px"}}>Alle Spieler müssen einem Team zugeordnet sein</div>}

        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:ok?1:0.4}}
          onClick={()=>ok&&onNext({t1Players:team1,t2Players:team2})}>Weiter → Matches</button>
      </div>
    </div>
  );
}

// ── Player Avatar ─────────────────────────────────────────────────────────────
function PlayerAvatar({name,size,color,photo}){
  size=size||36;
  const initials=name?name.split(' ').map(p=>p[0]||'').slice(0,2).join('').toUpperCase():'?';
  return(
    <div style={{width:size+"px",height:size+"px",borderRadius:"50%",background:color+"22",border:"1.5px solid "+color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>
      {photo
        ?<img src={photo} alt={name} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"50%"}}/>
        :<span style={{fontSize:(size*0.36)+"px",fontWeight:"700",color,fontFamily:"'Arial',sans-serif"}}>{initials}</span>
      }
    </div>
  );
}

// ── Player Manager ────────────────────────────────────────────────────────────
function PlayerManager({onBack,T}){
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [editingId,setEditingId]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [fn,setFn]=useState("");
  const [ln,setLn]=useState("");
  const [hcp,setHcp]=useState("");
  const [photo,setPhoto]=useState(null);
  const [saving,setSaving]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(null);
  const [cropSrc,setCropSrc]=useState(null);
  const [cropScale,setCropScale]=useState(1);

  useEffect(()=>{
    getDocs(collection(db,"savedPlayers")).then(snap=>{
      setPlayers(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  const handlePhotoChange=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{setCropSrc(ev.target.result);setCropScale(1);};
    reader.readAsDataURL(file);
  };

  const cropAndSave=()=>{
    const size=200;const canvas=document.createElement("canvas");
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext("2d");
    const img=new Image();
    img.onload=()=>{
      const s=Math.min(img.width,img.height)*cropScale;
      const sx=(img.width-s)/2;const sy=(img.height-s)/2;
      ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.clip();
      ctx.drawImage(img,sx,sy,s,s,0,0,size,size);
      setPhoto(canvas.toDataURL("image/jpeg",0.8));setCropSrc(null);
    };
    img.src=cropSrc;
  };

  const startEdit=(p)=>{setEditingId(p.id);setFn(p.fn);setLn(p.ln);setHcp(p.hcp||"");setPhoto(p.photo||null);setShowForm(true);};
  const resetForm=()=>{setEditingId(null);setFn("");setLn("");setHcp("");setPhoto(null);setShowForm(false);};

  const savePlayer=async()=>{
    if(!fn.trim()||!ln.trim())return;
    setSaving(true);
    const id=editingId||("p"+Date.now());
    const data={fn:fn.trim(),ln:ln.trim(),hcp:hcp||"",photo:photo||null};
    await setDoc(doc(db,"savedPlayers",id),data).catch(()=>{});
    if(editingId){setPlayers(prev=>prev.map(p=>p.id===id?{id,...data}:p));}
    else{setPlayers(prev=>[...prev,{id,...data}]);}
    setSaving(false);resetForm();
  };

  const deletePlayer=async(id)=>{
    await deleteDoc(doc(db,"savedPlayers",id)).catch(()=>{});
    setPlayers(prev=>prev.filter(p=>p.id!==id));setConfirmDelete(null);
  };

  const inp={background:T.isDark?"#0A2014":T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",padding:"10px 12px",outline:"none",boxSizing:"border-box",width:"100%",marginBottom:"10px",fontFamily:"'Arial',sans-serif"};

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <button style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:`1px solid rgba(255,255,255,0.2)`,borderRadius:"6px",color:"rgba(255,255,255,0.6)",fontSize:"11px",padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontFamily:"'Arial',sans-serif"}} onClick={onBack}>
          <IconBack size={12} color="rgba(255,255,255,0.6)"/> Menü
        </button>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>👤 Spieler</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>VERWALTUNG</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>

        {!showForm?(
          <>
            <button onClick={()=>setShowForm(true)} style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",marginBottom:"14px",fontFamily:"'Arial',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
              <IconPlus size={16} color={T.isDark?"#0D2B1A":"white"}/> Spieler hinzufügen
            </button>
            {loading&&<div style={{textAlign:"center",padding:"20px",color:T.muted,fontFamily:"'Arial',sans-serif"}}>Lade...</div>}
            {!loading&&players.length===0&&(
              <div style={{textAlign:"center",padding:"40px 20px"}}>
                <div style={{fontSize:"40px",marginBottom:"12px"}}>👤</div>
                <div style={{color:T.gold,fontSize:"16px",fontFamily:"'Georgia',serif",marginBottom:"8px"}}>Noch keine Spieler</div>
                <div style={{color:T.muted,fontSize:"13px",fontFamily:"'Arial',sans-serif"}}>Füge Spieler hinzu um sie in Turnieren zu verwenden</div>
              </div>
            )}
            {players.map(p=>(
              <div key={p.id} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"12px 14px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"12px"}}>
                <PlayerAvatar name={p.fn+" "+p.ln} size={48} color={T.blue} photo={p.photo}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:"14px",fontWeight:"700",color:T.cream,fontFamily:"'Arial',sans-serif"}}>{p.fn} {p.ln}</div>
                  <div style={{fontSize:"11px",color:T.muted,fontFamily:"'Arial',sans-serif"}}>{p.hcp?`HCP ${p.hcp}`:"Kein HCP"}</div>
                </div>
                <div style={{display:"flex",gap:"6px"}}>
                  <button onClick={()=>startEdit(p)} style={{padding:"7px 12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"11px",cursor:"pointer"}}>✏️</button>
                  <button onClick={()=>setConfirmDelete(p)} style={{padding:"7px 10px",background:"transparent",border:`1px solid #E0525244`,borderRadius:"6px",color:"#E05252",cursor:"pointer"}}>
                    <IconTrash size={14} color="#E05252"/>
                  </button>
                </div>
              </div>
            ))}
          </>
        ):(
          <div>
            <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,fontFamily:"'Georgia',serif",marginBottom:"16px"}}>{editingId?"Spieler bearbeiten":"Neuer Spieler"}</div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:"16px"}}>
              <div style={{position:"relative"}}>
                <PlayerAvatar name={fn&&ln?fn+" "+ln:"?"} size={80} color={T.blue} photo={photo}/>
                <label style={{position:"absolute",bottom:0,right:0,width:"28px",height:"28px",background:`linear-gradient(135deg,${T.gold},#A07830)`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D2B1A" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <input type="file" accept="image/*" onChange={handlePhotoChange} style={{display:"none"}}/>
                </label>
              </div>
            </div>
            <div style={{fontSize:"10px",color:T.faint,textAlign:"center",marginBottom:"16px",fontFamily:"'Arial',sans-serif"}}>Tippe das Kamera-Icon für Foto oder Mediathek</div>
            <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"4px",fontFamily:"'Arial',sans-serif"}}>VORNAME *</div>
            <input style={inp} placeholder="Vorname" value={fn} onChange={e=>setFn(e.target.value)}/>
            <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"4px",fontFamily:"'Arial',sans-serif"}}>NACHNAME *</div>
            <input style={inp} placeholder="Nachname" value={ln} onChange={e=>setLn(e.target.value)}/>
            <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"4px",fontFamily:"'Arial',sans-serif"}}>HANDICAP</div>
            <input style={{...inp,marginBottom:"20px"}} inputMode="decimal" placeholder="z.B. 8.4" value={hcp} onChange={e=>setHcp(e.target.value)}/>
            <button onClick={savePlayer} disabled={!fn.trim()||!ln.trim()||saving}
              style={{width:"100%",padding:"13px",background:(!fn.trim()||!ln.trim())?T.elevated:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:(!fn.trim()||!ln.trim())?T.muted:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:(!fn.trim()||!ln.trim())?"not-allowed":"pointer",marginBottom:"8px",fontFamily:"'Arial',sans-serif",opacity:(!fn.trim()||!ln.trim())?0.5:1}}>
              {saving?"Speichere...":"Speichern"}
            </button>
            <button onClick={resetForm} style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"'Arial',sans-serif"}}>Abbrechen</button>
          </div>
        )}
      </div>

      {cropSrc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:400,padding:"20px"}}>
          <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,fontFamily:"'Georgia',serif",marginBottom:"16px"}}>Foto zuschneiden</div>
          <div style={{position:"relative",width:"200px",height:"200px",borderRadius:"50%",overflow:"hidden",border:`3px solid ${T.gold}`,marginBottom:"16px"}}>
            <img src={cropSrc} style={{width:"100%",height:"100%",objectFit:"cover",transform:`scale(${cropScale})`,transformOrigin:"center"}} alt="crop"/>
          </div>
          <div style={{width:"100%",maxWidth:"280px",marginBottom:"8px"}}>
            <div style={{fontSize:"10px",color:T.muted,fontFamily:"'Arial',sans-serif",marginBottom:"4px"}}>Zoom</div>
            <input type="range" min="1" max="3" step="0.05" value={cropScale} onChange={e=>setCropScale(Number(e.target.value))} style={{width:"100%",accentColor:T.gold}}/>
          </div>
          <div style={{display:"flex",gap:"10px",width:"100%",maxWidth:"280px"}}>
            <button onClick={cropAndSave} style={{flex:1,padding:"12px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"13px",fontWeight:"900",cursor:"pointer",fontFamily:"'Arial',sans-serif"}}>Übernehmen ✓</button>
            <button onClick={()=>setCropSrc(null)} style={{flex:1,padding:"12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"'Arial',sans-serif"}}>Abbrechen</button>
          </div>
        </div>
      )}

      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={()=>setConfirmDelete(null)}>
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>🗑</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"'Georgia',serif",marginBottom:"6px"}}>{confirmDelete.fn} {confirmDelete.ln} löschen?</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"'Arial',sans-serif"}}>Der Spieler wird aus dem Pool entfernt.</div>
            <button style={{width:"100%",padding:"11px",background:"#E05252",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"'Arial',sans-serif"}} onClick={()=>deletePlayer(confirmDelete.id)}>Ja, löschen</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"'Arial',sans-serif"}} onClick={()=>setConfirmDelete(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Match Builder (Tap-to-Assign + Add/Remove Matches) ────────────────
function SetupStep4({t1Name,t2Name,matchCount,t1Players,t2Players,onStart,onBack,T}){
  const [saving,setSaving]=useState(false);
  const [activeDay,setActiveDay]=useState(0);
  const [selectedPlayer,setSelectedPlayer]=useState(null); // {player, team}

  const mkMatch=(id)=>({id,name:"Match "+id,pin:"MATCH"+id,mode:"scramble",t1Players:[],t2Players:[]});

  const [day1,setDay1]=useState(()=>Array.from({length:matchCount},(_,i)=>mkMatch(i+1)));
  const [day2,setDay2]=useState(()=>Array.from({length:matchCount},(_,i)=>mkMatch(i+1+matchCount)));

  const matches=activeDay===0?day1:day2;
  const setMatches=activeDay===0?setDay1:setDay2;

  const addMatch=()=>setMatches(prev=>{
    const newId=prev.length>0?Math.max(...prev.map(m=>m.id))+1:1;
    return[...prev,mkMatch(newId)];
  });
  const removeMatch=(id)=>setMatches(prev=>prev.filter(m=>m.id!==id));

  const usedT1=new Set(matches.flatMap(m=>m.t1Players.map(p=>p.id)));
  const usedT2=new Set(matches.flatMap(m=>m.t2Players.map(p=>p.id)));
  const availT1=t1Players.filter(p=>!usedT1.has(p.id));
  const availT2=t2Players.filter(p=>!usedT2.has(p.id));

  const handlePlayerTap=(player,team)=>{
    if(selectedPlayer&&selectedPlayer.player.id===player.id){setSelectedPlayer(null);}
    else{setSelectedPlayer({player,team});}
  };

  const handleSlotTap=(matchIdx,teamKey)=>{
    if(!selectedPlayer)return;
    if(selectedPlayer.team!==teamKey){setSelectedPlayer(null);return;}
    const k=teamKey==="t1"?"t1Players":"t2Players";
    setMatches(prev=>prev.map((m,i)=>{
      if(i!==matchIdx)return m;
      const isPairs=GAME_MODES[m.mode]?.pairs!==false;
      const limit=isPairs?2:1;
      if(m[k].length>=limit||m[k].find(p=>p.id===selectedPlayer.player.id))return m;
      return{...m,[k]:[...m[k],selectedPlayer.player]};
    }));
    setSelectedPlayer(null);
  };

  const removeFromMatch=(player,teamKey,mi)=>{
    setMatches(prev=>prev.map((m,idx)=>{
      if(idx!==mi)return m;
      const k=teamKey==="t1"?"t1Players":"t2Players";
      return{...m,[k]:m[k].filter(p=>p.id!==player.id)};
    }));
  };

  const setMode=(mi,mode)=>{
    setMatches(prev=>prev.map((m,idx)=>{
      if(idx!==mi)return m;
      const isPairs=GAME_MODES[mode]?.pairs!==false;
      return{...m,mode,t1Players:isPairs?m.t1Players:m.t1Players.slice(0,1),t2Players:isPairs?m.t2Players:m.t2Players.slice(0,1)};
    }));
  };

  const checkDay=(dm)=>dm.length>0&&dm.every(m=>{
    const isPairs=GAME_MODES[m.mode]?.pairs!==false;
    const need=isPairs?2:1;
    return m.t1Players.length>=need&&m.t2Players.length>=need;
  });
  const bothFilled=checkDay(day1)&&checkDay(day2);

  const Pill=({player,color,onRemove})=>(
    <div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"2px 6px 2px 4px",fontSize:"11px",color,marginBottom:"3px",fontFamily:"'Arial',sans-serif"}}>
      <PlayerAvatar name={player.fn+" "+player.ln} size={18} color={color} photo={player.photo}/>
      {player.fn} {player.ln[0]}.
      <span style={{cursor:"pointer",opacity:0.7,marginLeft:"2px"}} onClick={e=>{e.stopPropagation();onRemove();}}>×</span>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <button style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:`1px solid rgba(255,255,255,0.2)`,borderRadius:"6px",color:"rgba(255,255,255,0.6)",fontSize:"11px",padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontFamily:"'Arial',sans-serif"}} onClick={onBack}>
          <IconBack size={12} color="rgba(255,255,255,0.6)"/> Zurück
        </button>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>📋 Planung</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>MATCHES & SPIELERZUORDNUNG</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>

        {/* Day tabs */}
        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {[["Tag 1 – Riedhof","riedhof"],["Tag 2 – Bergkramer","bergkramerhof"]].map(([l],i)=>(
            <button key={i} style={{flex:1,padding:"10px 6px",background:activeDay===i?T.elevated:T.isDark?"#0A2014":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeDay===i?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"1px",textTransform:"uppercase",fontWeight:activeDay===i?"700":"400",fontFamily:"'Arial',sans-serif"}}
              onClick={()=>{setActiveDay(i);setSelectedPlayer(null);}}>{l}</button>
          ))}
        </div>

        {/* Tap instruction */}
        {selectedPlayer?(
          <div style={{background:T.gold+"22",border:`1px solid ${T.gold}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
            <PlayerAvatar name={selectedPlayer.player.fn+" "+selectedPlayer.player.ln} size={28} color={selectedPlayer.team==="t1"?T.blue:T.red} photo={selectedPlayer.player.photo}/>
            <div>
              <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,fontFamily:"'Arial',sans-serif"}}>{selectedPlayer.player.fn} {selectedPlayer.player.ln} ausgewählt</div>
              <div style={{fontSize:"10px",color:T.muted,fontFamily:"'Arial',sans-serif"}}>Tippe einen freien Match-Slot unten</div>
            </div>
            <button onClick={()=>setSelectedPlayer(null)} style={{marginLeft:"auto",background:"transparent",border:"none",color:T.muted,fontSize:"20px",cursor:"pointer"}}>×</button>
          </div>
        ):(
          <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",fontSize:"11px",color:T.muted,fontFamily:"'Arial',sans-serif",display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"16px"}}>👆</span>
            <span>Spieler antippen → dann Match-Slot antippen</span>
          </div>
        )}

        {/* Available players */}
        <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
          {[[availT1,t1Name,T.blue,"t1"],[availT2,t2Name,T.red,"t2"]].map(([avail,name,color,team])=>(
            <div key={team} style={{flex:1}}>
              <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"5px",textTransform:"uppercase",fontFamily:"'Arial',sans-serif"}}>{name} ({avail.length})</div>
              <div style={{background:T.isDark?"#0A2014":T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"5px",minHeight:"36px"}}>
                {avail.length===0
                  ?<div style={{fontSize:"10px",color:T.faint,textAlign:"center",padding:"6px 0",fontFamily:"'Arial',sans-serif"}}>Alle zugeteilt ✓</div>
                  :avail.map(p=>{
                    const isSel=selectedPlayer&&selectedPlayer.player.id===p.id;
                    return(
                      <div key={p.id} onClick={()=>handlePlayerTap(p,team)}
                        style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 7px",marginBottom:"3px",borderRadius:"6px",background:isSel?color+"22":"transparent",border:`1px solid ${isSel?color:T.border}`,cursor:"pointer",transition:"all 0.15s"}}>
                        <PlayerAvatar name={p.fn+" "+p.ln} size={26} color={color} photo={p.photo}/>
                        <div>
                          <div style={{fontSize:"11px",color:isSel?color:T.cream,fontWeight:isSel?"700":"400",fontFamily:"'Arial',sans-serif"}}>{p.fn} {p.ln}</div>
                          <div style={{fontSize:"9px",color:T.faint,fontFamily:"'Arial',sans-serif"}}>HCP {p.hcp||"–"}</div>
                        </div>
                        {isSel&&<div style={{marginLeft:"auto",fontSize:"12px",color}}>✓</div>}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          ))}
        </div>

        {/* Match cards */}
        {matches.map((m,mi)=>{
          const isPairs=GAME_MODES[m.mode]?.pairs!==false;
          const limit=isPairs?2:1;
          return(
            <div key={m.id} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>{m.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{m.pin}</div>
                  <button onClick={()=>removeMatch(m.id)} style={{width:"22px",height:"22px",borderRadius:"50%",background:"#E0525222",border:"1px solid #E0525255",color:"#E05252",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",lineHeight:1}}>×</button>
                </div>
              </div>

              {/* Mode selector */}
              <div style={{marginBottom:"8px"}}>
                <div style={{fontSize:"9px",color:T.muted,letterSpacing:"1px",marginBottom:"4px",textTransform:"uppercase",fontFamily:"'Arial',sans-serif"}}>Spielmodus</div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                  {Object.entries(GAME_MODES).map(([k,v])=>(
                    <button key={k} onClick={()=>setMode(mi,k)} style={{padding:"4px 8px",borderRadius:"6px",border:`1px solid ${m.mode===k?T.gold:T.border}`,background:m.mode===k?T.gold+"22":T.surface,color:m.mode===k?T.gold:T.muted,fontSize:"10px",cursor:"pointer",fontFamily:"'Arial',sans-serif"}}>
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player slots */}
              <div style={{display:"flex",gap:"8px"}}>
                {[[m.t1Players,T.blue,t1Name,"t1"],[m.t2Players,T.red,t2Name,"t2"]].map(([players,color,teamName,teamKey])=>{
                  const isTarget=selectedPlayer&&selectedPlayer.team===teamKey&&players.length<limit;
                  const hcpVal=players.length===limit?(limit===2?calcTeamHcp(parseFloat(players[0].hcp||0),parseFloat(players[1].hcp||0)):parseFloat(players[0]?.hcp||0)):null;
                  return(
                    <div key={teamKey} style={{flex:1}}>
                      <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"4px",fontFamily:"'Arial',sans-serif"}}>{teamName}</div>
                      <div onClick={()=>handleSlotTap(mi,teamKey)}
                        style={{minHeight:"52px",background:isTarget?color+"18":(T.isDark?"#0A2014":T.elevated),border:`2px ${isTarget?"solid":"dashed"} ${isTarget?color:T.border}`,borderRadius:"8px",padding:"6px",cursor:isTarget?"pointer":"default",transition:"all 0.15s"}}>
                        {players.length===0&&<div style={{fontSize:"10px",color:isTarget?color:T.faint,textAlign:"center",padding:"6px 0",fontFamily:"'Arial',sans-serif"}}>{isTarget?"Hier tippen ✓":"Leer ("+limit+")"}</div>}
                        <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>
                          {players.map(p=><Pill key={p.id} player={p} color={color} onRemove={()=>removeFromMatch(p,teamKey,mi)}/>)}
                        </div>
                        {players.length>0&&players.length<limit&&<div style={{fontSize:"9px",color:isTarget?color:T.faint,marginTop:"3px",fontFamily:"'Arial',sans-serif"}}>{isTarget?"Hier tippen →":"+1 weiterer"}</div>}
                      </div>
                      {hcpVal!==null&&<div style={{fontSize:"9px",color:color+"99",marginTop:"3px",fontFamily:"'Arial',sans-serif"}}>Team HCP: {hcpVal}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Add match button */}
        <button onClick={addMatch} style={{width:"100%",padding:"10px",background:"transparent",border:`1px dashed ${T.gold}55`,borderRadius:"8px",color:T.gold,fontSize:"12px",cursor:"pointer",fontFamily:"'Arial',sans-serif",marginBottom:"12px",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
          <IconPlus size={13} color={T.gold}/> Match hinzufügen
        </button>

        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:bothFilled?1:0.4}}
          onClick={async()=>{
            if(!bothFilled)return;
            setSaving(true);
            const buildMatch=(m)=>({
              id:m.id,name:m.name,pin:m.pin,mode:m.mode,
              t1Pair:m.t1Players.map(p=>`${p.fn} ${p.ln}`),
              t2Pair:m.t2Players.map(p=>`${p.fn} ${p.ln}`),
              teamHcp1:m.t1Players.length>=2?calcTeamHcp(parseFloat(m.t1Players[0].hcp||0),parseFloat(m.t1Players[1].hcp||0)):(m.t1Players[0]?parseFloat(m.t1Players[0].hcp||0):null),
              teamHcp2:m.t2Players.length>=2?calcTeamHcp(parseFloat(m.t2Players[0].hcp||0),parseFloat(m.t2Players[1].hcp||0)):(m.t2Players[0]?parseFloat(m.t2Players[0].hcp||0):null),
              scores:emptyScores(),
            });
            const days=[
              {id:0,label:"Tag 1 – Riedhof",courseKey:"riedhof",matches:day1.map(buildMatch)},
              {id:1,label:"Tag 2 – Bergkramerhof",courseKey:"bergkramerhof",matches:day2.map(buildMatch)},
            ];
            const config={t1Name,t2Name,t1Players,t2Players,days,phase:"game"};
            await saveTournament(config);
            onStart(config);
          }}
          disabled={saving}>
          {saving?"Speichere...":"Turnier starten 🏌️"}
        </button>
        {!bothFilled&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px",fontFamily:"'Arial',sans-serif"}}>Bitte alle Matches für beide Tage befüllen</div>}
      </div>
    </div>
  );
}

function AdminSetup({onStart,onBack,T}){
  const [step,setStep]=useState(1);
  const [d1,setD1]=useState(null);
  const [d2,setD2]=useState(null);
  const [d3,setD3]=useState(null);
  // Load players from Firestore for step 2 if not entered manually
  if(step===1)return<SetupStep1 onNext={d=>{setD1(d);setStep(2);}} onBack={onBack} T={T}/>;
  if(step===2)return<SetupStep2PlayerLoader onNext={d=>{setD2(d);setStep(3);}} onBack={()=>setStep(1)} T={T}/>;
  if(step===3)return<SetupStep3 {...d1} {...d2} onNext={d=>{setD3(d);setStep(4);}} onBack={()=>setStep(2)} T={T}/>;
  return<SetupStep4 {...d1} {...d3} onStart={onStart} onBack={()=>setStep(3)} T={T}/>;
}

// Step 2 now loads players from Firestore savedPlayers
function SetupStep2PlayerLoader({onNext,onBack,T}){
  const [players,setPlayers]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    getDocs(collection(db,"savedPlayers")).then(snap=>{
      const saved=snap.docs.map(d=>({id:d.id,...d.data()}));
      // Map fn/ln to firstName/lastName for compatibility with SetupStep2
      const mapped=saved.map(p=>({...p,firstName:p.fn,lastName:p.ln}));
      setPlayers(mapped);setLoading(false);
    }).catch(()=>{setPlayers([]);setLoading(false);});
  },[]);

  if(loading)return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>⛳</div><div style={{color:T.muted,fontSize:"14px",letterSpacing:"2px",fontFamily:"'Arial',sans-serif"}}>Lade Spieler...</div></div>
    </div>
  );
  return<SetupStep2 initialPlayers={players} onNext={onNext} onBack={onBack} T={T}/>;
}  const [saving,setSaving]=useState(false);
  const [activeDay,setActiveDay]=useState(0);

  const mkEmptyMatches=(offset=0)=>Array.from({length:matchCount},(_,i)=>({
    id:i+offset, name:`Match ${i+1+offset}`, pin:`MATCH${i+1+offset}`,
    mode:"scramble", t1Players:[], t2Players:[],
  }));

  const [day1Matches,setDay1Matches]=useState(mkEmptyMatches(0));
  const [day2Matches,setDay2Matches]=useState(mkEmptyMatches(matchCount));
  const [dragging,setDragging]=useState(null);

  const matches=activeDay===0?day1Matches:day2Matches;
  const setMatches=activeDay===0?setDay1Matches:setDay2Matches;

  const moveToMatch=(player,team,matchIdx)=>{
    setMatches(prev=>prev.map((m,i)=>{
      if(i!==matchIdx)return m;
      const key=team==="t1"?"t1Players":"t2Players";
      const isPairs=GAME_MODES[m.mode]?.pairs!==false;
      const limit=isPairs?2:1;
      if(m[key].length>=limit)return m; // slot full
      if(m[key].find(p=>p.id===player.id))return m; // already in
      return{...m,[key]:[...m[key],player]};
    }));
  };

  const removeFromMatch=(player,team,matchIdx)=>{
    setMatches(prev=>prev.map((m,i)=>{
      if(i!==matchIdx)return m;
      const key=team==="t1"?"t1Players":"t2Players";
      return{...m,[key]:m[key].filter(p=>p.id!==player.id)};
    }));
  };

  const setMode=(matchIdx,mode)=>{
    setMatches(prev=>prev.map((m,i)=>{
      if(i!==matchIdx)return m;
      const isPairs=GAME_MODES[mode]?.pairs!==false;
      // If switching to singles, keep only first player
      return{...m,mode,t1Players:isPairs?m.t1Players:m.t1Players.slice(0,1),t2Players:isPairs?m.t2Players:m.t2Players.slice(0,1)};
    }));
  };

  // Used players per team per day
  const usedT1=new Set(matches.flatMap(m=>m.t1Players.map(p=>p.id)));
  const usedT2=new Set(matches.flatMap(m=>m.t2Players.map(p=>p.id)));
  const availT1=t1Players.filter(p=>!usedT1.has(p.id));
  const availT2=t2Players.filter(p=>!usedT2.has(p.id));

  const allFilled=matches.every(m=>{
    const isPairs=GAME_MODES[m.mode]?.pairs!==false;
    const need=isPairs?2:1;
    return m.t1Players.length>=need&&m.t2Players.length>=need;
  });
  const bothDaysFilled=day1Matches.every(m=>{const isPairs=GAME_MODES[m.mode]?.pairs!==false;const need=isPairs?2:1;return m.t1Players.length>=need&&m.t2Players.length>=need;})&&
    day2Matches.every(m=>{const isPairs=GAME_MODES[m.mode]?.pairs!==false;const need=isPairs?2:1;return m.t1Players.length>=need&&m.t2Players.length>=need;});

  const PlayerPill=({player,onRemove,color})=>(
    <div style={{display:"flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"2px 8px",fontSize:"11px",color}}>
      {player.firstName} {player.lastName[0]}.
      <span style={{cursor:"pointer",marginLeft:"2px",opacity:0.7}} onClick={onRemove}>×</span>
    </div>
  );

  const SmallPlayer=({player,team,onDragStart})=>(
    <div draggable onDragStart={onDragStart}
      style={{display:"flex",alignItems:"center",gap:"6px",background:T.surface,border:`1px solid ${team==="t1"?T.blue+"55":T.red+"55"}`,borderRadius:"6px",padding:"4px 8px",marginBottom:"4px",cursor:"grab",fontSize:"11px",color:T.cream}}>
      <IconUser size={11} color={team==="t1"?T.blue:T.red}/>
      {player.firstName} {player.lastName} <span style={{color:T.faint,fontSize:"10px"}}>({player.hcp})</span>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup 4/4</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>MATCHES & SPIELMODUS</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>

        {/* Day tabs */}
        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {["Tag 1 – Riedhof","Tag 2 – Bergkramerhof"].map((l,i)=>(
            <button key={i} style={{flex:1,padding:"10px 6px",background:activeDay===i?T.elevated:T.isDark?"#0A2014":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeDay===i?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"1px",textTransform:"uppercase",fontWeight:activeDay===i?"700":"400"}}
              onClick={()=>setActiveDay(i)}>{l}</button>
          ))}
        </div>

        {/* Available players */}
        <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
          {[[availT1,t1Name,T.blue,"t1"],[availT2,t2Name,T.red,"t2"]].map(([avail,name,color,team])=>(
            <div key={team} style={{flex:1}}>
              <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"6px",textTransform:"uppercase"}}>{name} ({avail.length})</div>
              <div style={{minHeight:"40px",background:T.surface,border:`1px dashed ${color}44`,borderRadius:"8px",padding:"6px"}}>
                {avail.length===0?<div style={{fontSize:"10px",color:T.faint,textAlign:"center",padding:"8px 0"}}>Alle zugeteilt</div>:
                  avail.map(p=><SmallPlayer key={p.id} player={p} team={team} onDragStart={()=>setDragging({player:p,team})}/>)}
              </div>
            </div>
          ))}
        </div>

        {/* Match slots */}
        {matches.map((m,mi)=>{
          const mode=GAME_MODES[m.mode||"scramble"];
          const isPairs=mode?.pairs!==false;
          const limit=isPairs?2:1;
          const hcp1=m.t1Players.length===limit?(isPairs&&limit===2?calcTeamHcp(parseFloat(m.t1Players[0].hcp),parseFloat(m.t1Players[1].hcp)):parseFloat(m.t1Players[0]?.hcp||0)):null;
          const hcp2=m.t2Players.length===limit?(isPairs&&limit===2?calcTeamHcp(parseFloat(m.t2Players[0].hcp),parseFloat(m.t2Players[1].hcp)):parseFloat(m.t2Players[0]?.hcp||0)):null;

          return(
            <div key={m.id} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>{m.name}</div>
                <div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{m.pin}</div>
              </div>

              {/* Mode selector */}
              <div style={{marginBottom:"10px"}}>
                <div style={{fontSize:"9px",color:T.muted,letterSpacing:"1px",marginBottom:"6px",textTransform:"uppercase"}}>Spielmodus</div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                  {Object.entries(GAME_MODES).map(([k,v])=>(
                    <button key={k} onClick={()=>setMode(mi,k)}
                      style={{padding:"4px 8px",borderRadius:"6px",border:`1px solid ${m.mode===k?T.gold:T.border}`,background:m.mode===k?T.gold+"22":T.surface,color:m.mode===k?T.gold:T.muted,fontSize:"10px",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px"}}>
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Player slots */}
              <div style={{display:"flex",gap:"8px"}}>
                {[[m.t1Players,T.blue,t1Name,"t1"],[m.t2Players,T.red,t2Name,"t2"]].map(([players,color,teamName,teamKey])=>(
                  <div key={teamKey} style={{flex:1}}
                    onDragOver={e=>e.preventDefault()}
                    onDrop={()=>{if(dragging&&dragging.team===teamKey)moveToMatch(dragging.player,teamKey,mi);setDragging(null);}}>
                    <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"4px"}}>{teamName}</div>
                    <div style={{minHeight:"44px",background:T.surface,border:`2px dashed ${dragging?.team===teamKey&&players.length<limit?color:T.border}`,borderRadius:"8px",padding:"6px",transition:"all 0.15s"}}>
                      {players.length===0&&<div style={{fontSize:"10px",color:T.faint,textAlign:"center",paddingTop:"6px"}}>Ablegen ({limit})</div>}
                      <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
                        {players.map(p=><PlayerPill key={p.id} player={p} color={color} onRemove={()=>removeFromMatch(p,teamKey,mi)}/>)}
                      </div>
                      {players.length>0&&players.length<limit&&<div style={{fontSize:"9px",color:T.faint,marginTop:"4px"}}>+{limit-players.length} weiterer</div>}
                    </div>
                    {hcp1!==null&&teamKey==="t1"&&<div style={{fontSize:"10px",color:T.blue,marginTop:"4px"}}>Team HCP: {hcp1}</div>}
                    {hcp2!==null&&teamKey==="t2"&&<div style={{fontSize:"10px",color:T.red,marginTop:"4px"}}>Team HCP: {hcp2}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:bothDaysFilled?1:0.4,marginTop:"4px"}}
          onClick={async()=>{
            if(!bothDaysFilled)return;
            setSaving(true);
            const buildMatch=(m)=>({
              id:m.id, name:m.name, pin:m.pin, mode:m.mode,
              t1Pair:m.t1Players.map(p=>`${p.firstName} ${p.lastName}`),
              t2Pair:m.t2Players.map(p=>`${p.firstName} ${p.lastName}`),
              teamHcp1:m.t1Players.length>=2?calcTeamHcp(parseFloat(m.t1Players[0].hcp),parseFloat(m.t1Players[1].hcp)):m.t1Players[0]?parseFloat(m.t1Players[0].hcp):null,
              teamHcp2:m.t2Players.length>=2?calcTeamHcp(parseFloat(m.t2Players[0].hcp),parseFloat(m.t2Players[1].hcp)):m.t2Players[0]?parseFloat(m.t2Players[0].hcp):null,
              scores:emptyScores(),
            });
            const days=[
              {id:0,label:"Tag 1 – Riedhof",courseKey:"riedhof",matches:day1Matches.map(buildMatch)},
              {id:1,label:"Tag 2 – Bergkramerhof",courseKey:"bergkramerhof",matches:day2Matches.map(buildMatch)},
            ];
            const config={t1Name,t2Name,t1Players,t2Players,days,phase:"game"};
            await saveTournament(config);
            onStart(config);
          }}
          disabled={saving}>
          {saving?"Speichere...":"Turnier starten 🏌️"}
        </button>
        {!bothDaysFilled&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Bitte alle Matches für beide Tage befüllen</div>}
      </div>
    </div>
  );
}


// ── Score Modal ───────────────────────────────────────────────────────────────
function ScoreModal({match,holeIndex,t1Name,t2Name,existing,par,onSave,onClose,T}){
  const [t1,setT1]=useState(existing?.team1??"");
  const [t2,setT2]=useState(existing?.team2??"");
  const hp=par[holeIndex];
  const mode=GAME_MODES[match.mode||"scramble"];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:"900",color:T.gold,textTransform:"uppercase",letterSpacing:"1px"}}>Loch {holeIndex+1} · {match.name}</div>
            <div style={{fontSize:"11px",color:T.muted,marginTop:"2px"}}>{holeIndex<9?"Runde 1":"Runde 2"} · {mode?.icon} {mode?.label}</div>
          </div>
          <div style={{textAlign:"center",background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"6px 12px"}}>
            <div style={{fontSize:"9px",color:T.muted}}>PAR</div>
            <div style={{fontSize:"22px",fontWeight:"900",color:T.gold,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{hp}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"12px",marginBottom:"16px"}}>
          {[{name:t1Name,val:t1,set:setT1,color:T.blue},{name:t2Name,val:t2,set:setT2,color:T.red}].map((item,i)=>(
            <div key={i} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:"11px",color:item.color,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"6px"}}>{item.name}</div>
              <input type="number" min="1" max="12"
                style={{width:"100%",fontSize:"36px",fontWeight:"900",background:T.isDark?"#0A2014":T.elevated,border:`2px solid ${T.border}`,borderRadius:"8px",color:T.cream,textAlign:"center",padding:"8px 0",outline:"none",boxSizing:"border-box",fontFamily:"'Arial Black',sans-serif"}}
                value={item.val} onChange={e=>item.set(e.target.value)} autoFocus={i===0}/>
            </div>
          ))}
        </div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"}}
          onClick={()=>{if(t1!==""&&t2!=="")onSave(Number(t1),Number(t2));}}>Speichern</button>
        <button style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",marginTop:"8px"}} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── Hole Grid ─────────────────────────────────────────────────────────────────
function NineHoleGrid({scores,pars,startHole,matchId,onHoleClick,canEdit,T}){
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px"}}>
      {scores.slice(startHole,startHole+9).map((s,i)=>{
        const hn=startHole+i,p=pars[hn],played=s.team1!==null&&s.team2!==null;
        let bg=T.holeBg,color=T.holeText,border=`1px solid ${T.border}`;
        if(played){border="none";if(s.team1<s.team2){bg=T.blue+"25";color=T.blue;}else if(s.team2<s.team1){bg=T.red+"25";color=T.red;}else{bg=T.border;color=T.muted;}}
        return(
          <div key={i} style={{borderRadius:"4px",cursor:canEdit?"pointer":"default",background:bg,color,border,userSelect:"none",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2px 0",minHeight:"32px",opacity:canEdit?1:played?0.9:0.6}} onClick={()=>canEdit&&onHoleClick(matchId,hn)}>
            <div style={{fontSize:"9px",fontWeight:"700",lineHeight:1}}>{hn+1}</div>
            <div style={{fontSize:"7px",opacity:0.6,lineHeight:1}}>P{p}</div>
            {played&&<div style={{fontSize:"8px",fontWeight:"900",lineHeight:1}}>{s.team1}:{s.team2}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Match Card ────────────────────────────────────────────────────────────────
function MatchCard({match,pars,t1Name,t2Name,canEdit,isAdmin,onHoleClick,onReset,T}){
  const [showReset,setShowReset]=useState(false);
  const r1=calcRoundStatus(match.scores,pars,0,9);
  const r2=calcRoundStatus(match.scores,pars,9,18);
  const mode=GAME_MODES[match.mode||"scramble"];

  const RoundBadge=({rs,pts,label,range})=>{
    const color=rs.diff>0?T.blue:rs.diff<0?T.red:T.muted;
    const rPar=pars.slice(range[0],range[1]).reduce((a,b)=>a+b,0);
    return(
      <div style={{flex:1,background:T.isDark?"#0A2014":T.elevated,borderRadius:"6px",padding:"6px 8px",textAlign:"center",border:`1px solid ${T.border}`}}>
        <div style={{fontSize:"9px",color:T.faint}}>{label}</div>
        <div style={{fontSize:"9px",color:T.faint,marginBottom:"3px"}}>Par {rPar}</div>
        <div style={{fontSize:"14px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>{rs.holesPlayed===0?"—":rs.label}</div>
        {(rs.won||rs.holesLeft===0)&&pts&&<div style={{fontSize:"9px",color:T.muted,marginTop:"2px"}}>{pts.t1}–{pts.t2} Pts</div>}
        {!rs.won&&rs.holesLeft>0&&rs.holesPlayed>0&&<div style={{fontSize:"9px",color:T.faint,marginTop:"2px"}}>{rs.holesLeft} left</div>}
      </div>
    );
  };

  return(
    <>
      <div style={{background:T.surface,border:`2px solid ${canEdit?T.gold:T.border}`,borderRadius:"12px",marginBottom:"12px",overflow:"hidden",opacity:canEdit||isAdmin?1:0.45,boxShadow:canEdit?`0 0 0 1px ${T.gold}33,0 4px 20px ${T.gold}18`:"none",transition:"opacity 0.2s"}}>
        <div style={{padding:"10px 14px",background:canEdit?T.gold+"11":T.isDark?"#0A2014":T.elevated,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"4px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{fontSize:"13px",fontWeight:"900",color:canEdit?T.gold:T.cream,fontFamily:"'Arial Black',sans-serif"}}>{match.name}</div>
              {canEdit&&<div style={{background:T.gold,color:T.isDark?"#0D2B1A":"white",fontSize:"9px",fontWeight:"900",borderRadius:"4px",padding:"2px 8px",letterSpacing:"1px"}}>✏️ DEIN MATCH</div>}
              <div style={{fontSize:"10px",color:T.faint}}>{mode?.icon} {mode?.label}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              {match.pin&&<div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{match.pin}</div>}
              {(canEdit||isAdmin)&&(
                <button onClick={()=>setShowReset(true)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.faint,padding:"4px 7px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}>
                  <IconReset size={11} color={T.faint}/>{isAdmin&&!canEdit&&<span>Reset</span>}
                </button>
              )}
            </div>
          </div>
          <div style={{fontSize:"10px",color:T.faint}}>
            <span style={{color:T.blue}}>🔵 {(match.t1Pair||[]).join(" & ")}</span>
            {match.teamHcp1!=null&&<span style={{color:T.blue+"88",marginLeft:"4px"}}>(HCP {match.teamHcp1})</span>}
            <span style={{color:T.muted}}> vs </span>
            <span style={{color:T.red}}>🔴 {(match.t2Pair||[]).join(" & ")}</span>
            {match.teamHcp2!=null&&<span style={{color:T.red+"88",marginLeft:"4px"}}>(HCP {match.teamHcp2})</span>}
          </div>
        </div>
        <div style={{padding:"10px 14px"}}>
          <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
            <RoundBadge rs={r1} pts={getPoints(r1)} label="Runde 1 (L. 1–9)" range={[0,9]}/>
            <RoundBadge rs={r2} pts={getPoints(r2)} label="Runde 2 (L. 10–18)" range={[9,18]}/>
          </div>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",marginBottom:"3px"}}>RUNDE 1</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={0} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T}/>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",margin:"6px 0 3px"}}>RUNDE 2</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={9} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T}/>
          {!canEdit&&!isAdmin&&<div style={{marginTop:"8px",fontSize:"10px",color:T.faint,textAlign:"center"}}>🔒 Nur lesbar</div>}
        </div>
      </div>
      {showReset&&<ResetConfirm title={`${match.name} zurücksetzen?`} message="Alle eingetragenen Scores werden gelöscht." onConfirm={()=>{onReset(match.id);setShowReset(false);}} onClose={()=>setShowReset(false)} T={T}/>}
    </>
  );
}

// ── Stats Tab ─────────────────────────────────────────────────────────────────
function StatsTab({days,t1Name,t2Name,T}){
  const stats=calcStats(days,t1Name,t2Name);
  const totalHoles=stats.t1TotalHoles+stats.t2TotalHoles;
  const t1HolePct=totalHoles>0?Math.round((stats.t1TotalHoles/totalHoles)*100):50;
  const SectionTitle=({children})=>(
    <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",textTransform:"uppercase",fontWeight:"700",marginBottom:"10px",marginTop:"18px",display:"flex",alignItems:"center",gap:"6px"}}>
      <div style={{flex:1,height:"1px",background:T.border}}/>{children}<div style={{flex:1,height:"1px",background:T.border}}/>
    </div>
  );
  const PairRow=({pair,maxPts})=>{
    const pct=maxPts>0?(pair.pts/maxPts)*100:0;
    const color=pair.team==="t1"?T.blue:T.red;
    return(
      <div style={{marginBottom:"10px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
          <div style={{fontSize:"12px",color:T.cream,fontWeight:"600"}}>{pair.name}</div>
          <div style={{display:"flex",gap:"12px",fontSize:"11px"}}>
            <span style={{color:T.muted}}>{pair.holesWon} Löcher</span>
            <span style={{color,fontWeight:"700"}}>{fmt(pair.pts)} Pts</span>
          </div>
        </div>
        <div style={{height:"6px",background:T.elevated,borderRadius:"3px",overflow:"hidden"}}>
          <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:"3px",transition:"width 0.6s ease"}}/>
        </div>
      </div>
    );
  };
  const maxT1=Math.max(...stats.t1Pairs.map(p=>p.pts),1);
  const maxT2=Math.max(...stats.t2Pairs.map(p=>p.pts),1);
  return(
    <div style={{paddingBottom:"20px"}}>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        <div style={{fontSize:"11px",color:T.muted,letterSpacing:"1px",marginBottom:"10px",textTransform:"uppercase"}}>Gewonnene Löcher gesamt</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"8px"}}>
          <div><div style={{fontSize:"11px",color:T.blue,fontWeight:"700"}}>🔵 {t1Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t1TotalHoles}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:"10px",color:T.faint}}>Löcher gespielt</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:T.red,fontWeight:"700"}}>🔴 {t2Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t2TotalHoles}</div></div>
        </div>
        <div style={{height:"12px",borderRadius:"6px",overflow:"hidden",display:"flex"}}>
          <div style={{width:`${t1HolePct}%`,background:T.blue,transition:"width 0.6s ease"}}/><div style={{flex:1,background:T.red}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted,marginTop:"4px"}}><span>{t1HolePct}%</span><span>{100-t1HolePct}%</span></div>
      </div>
      <SectionTitle>🔵 {t1Name}</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.t1Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t1Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT1}/>)}
      </div>
      <SectionTitle>🔴 {t2Name}</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.t2Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t2Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT2}/>)}
      </div>
      <SectionTitle>Loch-Statistik</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.hotHoles.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:(
          <>
            {stats.hotHoles.slice(0,9).map((h,i)=>{
              const tot=h.t1+h.t2+h.tie||1;
              return(
                <div key={i} style={{marginBottom:"8px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"30px 1fr 30px",gap:"4px",alignItems:"center",marginBottom:"3px"}}>
                    <div style={{fontSize:"11px",color:T.blue,textAlign:"center",fontWeight:"700"}}>{h.t1}</div>
                    <div style={{fontSize:"10px",color:T.muted,textAlign:"center"}}>Loch {h.hole}</div>
                    <div style={{fontSize:"11px",color:T.red,textAlign:"center",fontWeight:"700"}}>{h.t2}</div>
                  </div>
                  <div style={{display:"flex",height:"6px",borderRadius:"3px",overflow:"hidden",background:T.elevated}}>
                    <div style={{width:`${(h.t1/tot)*100}%`,background:T.blue}}/><div style={{width:`${(h.tie/tot)*100}%`,background:T.border}}/><div style={{width:`${(h.t2/tot)*100}%`,background:T.red}}/>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
      <SectionTitle>🌟 Top Performer</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px"}}>
        {stats.allPairs.filter(p=>p.pts>0).length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine abgeschlossenen Runden</div>:(
          stats.allPairs.filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts).slice(0,3).map((p,i)=>{
            const color=p.team==="t1"?T.blue:T.red;
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px",background:T.elevated,borderRadius:"8px",marginBottom:"8px",border:`1px solid ${color}33`}}>
                <div style={{fontSize:"20px"}}>{"🥇🥈🥉"[i]||"⛳"}</div>
                <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color}}>{p.name}</div><div style={{fontSize:"10px",color:T.faint}}>{p.team==="t1"?t1Name:t2Name} · {p.holesWon} Löcher</div></div>
                <div style={{fontSize:"20px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>{fmt(p.pts)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Day Summary ───────────────────────────────────────────────────────────────
function DaySummary({day,t1Name,t2Name,T}){
  const course=COURSES[day.courseKey];let t1=0,t2=0;
  day.matches.forEach(m=>{[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);const p=getPoints(rs);if(p){t1+=p.t1;t2+=p.t2;}});});
  return(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div><div style={{fontSize:"11px",color:T.gold,fontWeight:"700"}}>{day.label}</div><div style={{fontSize:"10px",color:T.faint}}>{course.shortName} · {day.matches.length} Matches</div></div>
      <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
        <span style={{color:T.blue,fontWeight:"700",fontSize:"16px"}}>{fmt(t1)}</span>
        <span style={{color:T.muted,fontSize:"11px"}}>:</span>
        <span style={{color:T.red,fontWeight:"700",fontSize:"16px"}}>{fmt(t2)}</span>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({config,role,onBack,theme,onThemeChange}){
  const T=THEMES[theme];
  const {t1Name,t2Name,days}=config;
  const [modal,setModal]=useState(null);
  const [activeTab,setActiveTab]=useState("day0");
  const [saving,setSaving]=useState(false);
  const [showPush,setShowPush]=useState(true);
  const [toast,setToast]=useState(null);
  const [showSettings,setShowSettings]=useState(false);
  const [resetAll,setResetAll]=useState(false);
  const [winEvent,setWinEvent]=useState(null);
  const [confetti,setConfetti]=useState(false);
  const prevRef=useRef(null);

  const isAdmin=role==="admin",isViewer=role==="viewer";
  const editableIds=isAdmin?"all":isViewer?[]:(() => {
    const idx=parseInt(role.split("-")[1]);
    const all=[];days.forEach(d=>d.matches.forEach(m=>all.push(m.id)));
    const perDay=days[0]?.matches.length||4;
    return[all[idx],all[idx+perDay]].filter(id=>id!==undefined);
  })();
  const canEdit=id=>editableIds==="all"||editableIds.includes(id);
  const myMatchName=!isAdmin&&!isViewer?(()=>{const idx=parseInt(role.split("-")[1]);const all=[];days.forEach(d=>d.matches.forEach(m=>all.push(m.name)));return all[idx]||null;})():null;

  // Foreground push – deduplicated
  useEffect(()=>{
    if(!messaging)return;
    const u=onMessage(messaging,p=>{
      // Only show in-app toast; background handler shows system notification
      // This prevents double notification on foreground
      setToast({title:p.notification?.title,body:p.notification?.body});
    });
    return()=>u();
  },[]);

  useEffect(()=>{
    if(prevRef.current){
      const change=detectPointChange(prevRef.current,days,t1Name,t2Name);
      if(change){
        setToast(change);
        if(change.winner){setWinEvent(change);setConfetti(true);}
      }
    }
    prevRef.current=days;
  },[days]);

  const stats=calcTournament(days);
  const t1W=Math.max(5,Math.min(95,stats.t1WinProb));

  const doReset=async matchId=>{
    setSaving(true);
    const nd=days.map(day=>({...day,matches:day.matches.map(m=>m.id===matchId?{...m,scores:emptyScores()}:m)}));
    await saveTournament({...config,days:nd});setSaving(false);
  };
  const doResetAll=async()=>{
    setSaving(true);
    const nd=days.map(day=>({...day,matches:day.matches.map(m=>({...m,scores:emptyScores()}))}));
    await saveTournament({...config,days:nd});setSaving(false);setResetAll(false);
  };
  const saveScore=async(dayId,matchId,hi,t1s,t2s)=>{
    setSaving(true);
    const nd=days.map(day=>{
      if(day.id!==dayId)return day;
      return{...day,matches:day.matches.map(m=>{if(m.id!==matchId)return m;const ns=[...m.scores];ns[hi]={team1:t1s,team2:t2s};return{...m,scores:ns};})};
    });
    const change=detectPointChange(days,nd,t1Name,t2Name);
    if(change) await sendPushToAll(change.title,change.body,change.key);
    await saveTournament({...config,days:nd});
    setSaving(false);setModal(null);
  };

  const activeDay=activeTab==="day0"?days[0]:activeTab==="day1"?days[1]:null;
  const course=activeDay?COURSES[activeDay.courseKey]:null;
  const mMatch=modal?days.find(d=>d.id===modal.dayId)?.matches.find(m=>m.id===modal.matchId):null;
  const mDay=modal?days.find(d=>d.id===modal.dayId):null;
  const pushGranted=typeof Notification!=="undefined"&&Notification.permission==="granted";

  const tabs=[
    {key:"day0",label:"Riedhof"},
    {key:"day1",label:"Bergkramer"},
    {key:"stats",label:"Statistik",icon:<IconChart size={11} color="currentColor"/>},
  ];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <Confetti active={confetti} onDone={()=>setConfetti(false)}/>
      <WinBanner event={winEvent} onDone={()=>setWinEvent(null)}/>
      {toast&&<Toast message={toast} onDismiss={()=>setToast(null)}/>}
      {showSettings&&<SettingsPanel T={T} currentTheme={theme} onThemeChange={onThemeChange} onClose={()=>setShowSettings(false)}/>}
      {resetAll&&<ResetConfirm title="Alle Matches zurücksetzen?" message="Wirklich ALLE Scores löschen?" onConfirm={doResetAll} onClose={()=>setResetAll(false)} T={T}/>}

      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <button style={{position:"absolute",right:"14px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",padding:"4px",display:"flex",alignItems:"center"}} onClick={()=>setShowSettings(true)}>
          <IconSettings size={20} color="rgba(255,255,255,0.6)"/>
        </button>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"3px",color:"#C9A84C",textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>⛳ Ryder Cup</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",marginTop:"4px"}}>
          <RoleBadge role={role} T={T}/>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"6px",height:"6px",borderRadius:"50%",background:saving?"#C9A84C":"#4CAF50"}}/>
            <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",textTransform:"uppercase"}}>{saving?"Speichert...":"Live"}</div>
          </div>
        </div>
      </div>

      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {showPush&&!pushGranted&&<PushBanner onDismiss={()=>setShowPush(false)} T={T}/>}

        {myMatchName&&(
          <div style={{background:T.isDark?`linear-gradient(135deg,${T.gold}22,${T.gold}11)`:T.gold+"18",border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"10px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}>
            <div style={{width:"32px",height:"32px",borderRadius:"50%",background:T.gold+"33",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"16px"}}>⛳</div>
            <div><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Du spielst {myMatchName}</div><div style={{fontSize:"10px",color:T.faint}}>Tippe auf ein Loch zum Eintragen</div></div>
          </div>
        )}

        {/* Scoreboard */}
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
            <div><div style={{fontSize:"12px",fontWeight:"700",color:T.blue,textTransform:"uppercase",letterSpacing:"1px"}}>🔵 {t1Name}</div><div style={{fontSize:"40px",fontWeight:"900",color:T.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t1Confirmed)}</div><div style={{fontSize:"10px",color:T.faint}}>proj. {stats.t1Projected} Pts</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"9px",color:T.muted}}>ZIEL</div><div style={{fontSize:"20px",fontWeight:"900",color:T.gold}}>{stats.needed}</div><div style={{fontSize:"9px",color:T.faint}}>von {stats.totalPoints}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"12px",fontWeight:"700",color:T.red,textTransform:"uppercase",letterSpacing:"1px"}}>🔴 {t2Name}</div><div style={{fontSize:"40px",fontWeight:"900",color:T.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t2Confirmed)}</div><div style={{fontSize:"10px",color:T.faint,textAlign:"right"}}>proj. {stats.t2Projected} Pts</div></div>
          </div>
          <div style={{height:"16px",borderRadius:"8px",overflow:"hidden",display:"flex",margin:"4px 0"}}>
            <div style={{width:`${t1W}%`,background:T.blue,transition:"width 0.6s ease"}}/><div style={{flex:1,background:T.red}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted}}>
            <span>{stats.t1WinProb}% Sieg</span><span>{stats.t2WinProb}% Sieg</span>
          </div>
          <div style={{marginTop:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
            {days.map(d=><DaySummary key={d.id} day={d} t1Name={t1Name} t2Name={t2Name} T={T}/>)}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {tabs.map((tab,i)=>(
            <button key={tab.key} style={{flex:1,padding:"10px 4px",background:activeTab===tab.key?T.elevated:T.isDark?"#0A2014":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeTab===tab.key?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"0.5px",textTransform:"uppercase",fontWeight:activeTab===tab.key?"700":"400",display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"}}
              onClick={()=>setActiveTab(tab.key)}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {activeTab==="stats"&&<StatsTab days={days} t1Name={t1Name} t2Name={t2Name} T={T}/>}

        {activeDay&&course&&(
          <>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div><div style={{fontSize:"13px",fontWeight:"700",color:T.cream}}>{course.name}</div><div style={{fontSize:"11px",color:T.faint}}>{course.location}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:T.muted}}>Par</div><div style={{fontSize:"18px",fontWeight:"900",color:T.gold}}>{course.par.slice(0,9).reduce((a,b)=>a+b,0)} / {course.par.slice(9).reduce((a,b)=>a+b,0)}</div></div>
              </div>
              {[0,1].map(r=>(
                <div key={r} style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:r===0?"3px":"0"}}>
                  {course.par.slice(r*9,r*9+9).map((p,i)=>(
                    <div key={i} style={{textAlign:"center",fontSize:"9px",padding:"2px 0",borderRadius:"3px",background:T.holeBg,color:T.holeText}}>
                      <div style={{opacity:0.6}}>{r*9+i+1}</div><div style={{fontWeight:"700"}}>P{p}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {activeDay.matches.map(m=>(
              <MatchCard key={m.id} match={m} pars={course.par} t1Name={t1Name} t2Name={t2Name}
                canEdit={canEdit(m.id)} isAdmin={isAdmin} T={T}
                onHoleClick={(matchId,hi)=>setModal({dayId:activeDay.id,matchId,holeIndex:hi})}
                onReset={doReset}/>
            ))}
            {isAdmin&&(
              <button style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"12px",cursor:"pointer",marginTop:"4px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",letterSpacing:"1px"}} onClick={()=>setResetAll(true)}>
                <IconReset size={14} color="#E05252"/> Alle Matches zurücksetzen
              </button>
            )}
          </>
        )}
      </div>

      {modal&&mMatch&&mDay&&(
        <ScoreModal match={mMatch} holeIndex={modal.holeIndex} t1Name={t1Name} t2Name={t2Name}
          par={COURSES[mDay.courseKey].par} existing={mMatch.scores[modal.holeIndex]}
          onSave={(t1,t2)=>saveScore(modal.dayId,modal.matchId,modal.holeIndex,t1,t2)}
          onClose={()=>setModal(null)} T={T}/>
      )}
    </div>
  );
}

// ── Admin Main Menu ───────────────────────────────────────────────────────────
function AdminMenu({config,onSelect,onBack,theme,onThemeChange,T}){
  const [showSettings,setShowSettings]=useState(false);
  const hasConfig=!!config;
  const menuItems=[
    {key:"players",icon:"👤",label:"Spielerverwaltung",desc:"Spieler erstellen & verwalten",available:true,color:T.blue},
    {key:"planning",icon:"📋",label:"Turnierplanung",desc:"Matches & Spielerzuordnung",available:true,color:T.gold},
    {key:"game",icon:"⛳",label:"Turnier Durchführung",desc:hasConfig?"Scores eintragen & live verfolgen":"Turnier muss zuerst geplant werden",available:hasConfig,color:T.muted},
  ];
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      {showSettings&&<SettingsPanel T={T} currentTheme={theme} onThemeChange={onThemeChange} onClose={()=>setShowSettings(false)}/>}
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <button style={{position:"absolute",right:"14px",top:"50%",transform:"translateY(-50%)",background:"transparent",border:"none",color:"rgba(255,255,255,0.6)",cursor:"pointer",padding:"4px"}} onClick={()=>setShowSettings(true)}>
          <IconSettings size={20} color="rgba(255,255,255,0.6)"/>
        </button>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"3px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>⛳ Ryder Cup</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>ADMIN BEREICH</div>
      </div>
      <div style={{padding:"20px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.elevated,border:`1px solid ${T.gold}44`,borderRadius:"10px",padding:"12px 16px",marginBottom:"24px",display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{fontSize:"20px"}}>👑</span>
          <div><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Administrator</div><div style={{fontSize:"11px",color:T.muted}}>Vollzugriff auf alle Bereiche</div></div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"6px",height:"6px",borderRadius:"50%",background:hasConfig?"#4CAF50":"#C9A84C"}}/>
            <div style={{fontSize:"10px",color:T.faint}}>{hasConfig?"Aktiv":"Kein Turnier"}</div>
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {menuItems.map(item=>(
            <button key={item.key}
              onClick={()=>item.available&&onSelect(item.key)}
              style={{width:"100%",background:T.cardBg,border:`2px solid ${item.available?item.color+"55":T.border}`,borderRadius:"14px",padding:"18px 20px",cursor:item.available?"pointer":"not-allowed",textAlign:"left",display:"flex",alignItems:"center",gap:"16px",opacity:item.available?1:0.5,transition:"all 0.15s"}}>
              <div style={{width:"52px",height:"52px",borderRadius:"14px",background:item.color+"22",border:`1px solid ${item.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"24px",flexShrink:0}}>
                {item.icon}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:"15px",fontWeight:"900",color:item.available?item.color:T.muted,fontFamily:"'Arial Black',sans-serif",letterSpacing:"0.5px"}}>{item.label}</div>
                <div style={{fontSize:"11px",color:T.faint,marginTop:"3px"}}>{item.desc}</div>
              </div>
              <div style={{fontSize:"18px",color:item.available?item.color:T.border,opacity:0.6}}>›</div>
            </button>
          ))}
        </div>

        {hasConfig&&(
          <div style={{marginTop:"20px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:T.gold,letterSpacing:"1px",marginBottom:"8px",textTransform:"uppercase"}}>Aktives Turnier</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px"}}>
              <span style={{color:T.blue}}>🔵 {config.t1Name}</span>
              <span style={{color:T.muted}}>vs</span>
              <span style={{color:T.red}}>🔴 {config.t2Name}</span>
            </div>
            <div style={{fontSize:"11px",color:T.faint,marginTop:"6px"}}>{config.days?.length||0} Spieltage · {config.days?.reduce((s,d)=>s+d.matches.length,0)||0} Matches gesamt</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [phase,setPhase]=useState("login");
  const [adminSection,setAdminSection]=useState(null); // "players"|"planning"|"game"
  const [config,setConfig]=useState(null);
  const [role,setRole]=useState(null);
  const [loading,setLoading]=useState(false);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem("ryder_theme")||"dark";}catch(e){return"dark";}});

  const changeTheme=t=>{setTheme(t);try{localStorage.setItem("ryder_theme",t);}catch(e){}};
  const goToLogin=()=>{setPhase("login");setConfig(null);setRole(null);setAdminSection(null);};
  const goToAdminMenu=()=>setAdminSection(null);

  const handleLogin=async r=>{
    setRole(r);setLoading(true);
    try{
      const s=await getDoc(doc(db,"tournaments","ryder2024"));
      if(s.exists()){
        setConfig(s.data());
        if(r==="admin") setPhase("adminMenu");
        else setPhase("game");
      } else {
        if(r==="admin") setPhase("adminMenu");
        else setPhase("waiting");
      }
    }
    catch(e){
      if(r==="admin") setPhase("adminMenu");
      else setPhase("waiting");
    }
    setLoading(false);
  };

  useEffect(()=>{
    if(phase!=="game"&&!(phase==="adminMenu"&&adminSection==="game"))return;
    const u=onSnapshot(doc(db,"tournaments","ryder2024"),s=>{if(s.exists())setConfig(s.data());});
    return()=>u();
  },[phase,adminSection]);

  const T=THEMES[theme];

  if(phase==="login")return<Login onLogin={handleLogin}/>;
  if(loading)return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>⛳</div><div style={{color:T.muted,fontSize:"14px",letterSpacing:"2px"}}>Lade Turnier...</div></div>
    </div>
  );
  if(phase==="waiting")return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={goToLogin} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>⛳ Ryder Cup</div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 70px)",padding:"20px"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:"40px",marginBottom:"12px"}}>⏳</div>
          <div style={{color:T.gold,fontSize:"16px",fontWeight:"700",marginBottom:"8px"}}>Turnier noch nicht gestartet</div>
          <div style={{color:T.muted,fontSize:"13px",marginBottom:"12px"}}>Der Admin muss zuerst das Turnier einrichten.</div>
          <RoleBadge role={role} T={T}/>
        </div>
      </div>
    </div>
  );

  // Admin-specific routing
  if(phase==="adminMenu"){
    if(!adminSection)return(
      <AdminMenu config={config} onSelect={s=>setAdminSection(s)} onBack={goToLogin} theme={theme} onThemeChange={changeTheme} T={T}/>
    );
    if(adminSection==="players")return(
      <PlayerManager onBack={goToAdminMenu} T={T}/>
    );
    if(adminSection==="planning")return(
      <AdminSetup
        onStart={cfg=>{setConfig(cfg);setAdminSection("game");}}
        onBack={goToAdminMenu} T={T}
      />
    );
    if(adminSection==="game"){
      if(!config)return<AdminMenu config={config} onSelect={s=>setAdminSection(s)} onBack={goToLogin} theme={theme} onThemeChange={changeTheme} T={T}/>;
      return<Dashboard config={config} role="admin" onBack={goToAdminMenu} theme={theme} onThemeChange={changeTheme}/>;
    }
  }

  if(!config)return null;
  return<Dashboard config={config} role={role} onBack={goToLogin} theme={theme} onThemeChange={changeTheme}/>;
}
  const [phase,setPhase]=useState("login");
  const [adminSection,setAdminSection]=useState(null); // "players"|"planning"|"game"
  const [config,setConfig]=useState(null);
  const [role,setRole]=useState(null);
  const [loading,setLoading]=useState(false);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem("ryder_theme")||"dark";}catch(e){return"dark";}});

  const changeTheme=t=>{setTheme(t);try{localStorage.setItem("ryder_theme",t);}catch(e){}};
  const goToLogin=()=>{setPhase("login");setConfig(null);setRole(null);setAdminSection(null);};
  const goToAdminMenu=()=>setAdminSection(null);

  const handleLogin=async r=>{
    setRole(r);setLoading(true);
    try{
      const s=await getDoc(doc(db,"tournaments","ryder2024"));
      if(s.exists()){
        setConfig(s.data());
        if(r==="admin") setPhase("adminMenu");
        else setPhase("game");
      } else {
        if(r==="admin") setPhase("adminMenu");
        else setPhase("waiting");
      }
    }
    catch(e){
      if(r==="admin") setPhase("adminMenu");
      else setPhase("waiting");
    }
    setLoading(false);
  };

  useEffect(()=>{
    if(phase!=="game"&&!(phase==="adminMenu"&&adminSection==="game"))return;
    const u=onSnapshot(doc(db,"tournaments","ryder2024"),s=>{if(s.exists())setConfig(s.data());});
    return()=>u();
  },[phase,adminSection]);

  const T=THEMES[theme];

  if(phase==="login")return<Login onLogin={handleLogin}/>;
  if(loading)return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>⛳</div><div style={{color:T.muted,fontSize:"14px",letterSpacing:"2px"}}>Lade Turnier...</div></div>
    </div>
  );
  if(phase==="waiting")return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={goToLogin} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>⛳ Ryder Cup</div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 70px)",padding:"20px"}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:"40px",marginBottom:"12px"}}>⏳</div>
          <div style={{color:T.gold,fontSize:"16px",fontWeight:"700",marginBottom:"8px"}}>Turnier noch nicht gestartet</div>
          <div style={{color:T.muted,fontSize:"13px",marginBottom:"12px"}}>Der Admin muss zuerst das Turnier einrichten.</div>
          <RoleBadge role={role} T={T}/>
        </div>
      </div>
    </div>
  );

  // Admin-specific routing
  if(phase==="adminMenu"){
    if(!adminSection)return(
      <AdminMenu config={config} onSelect={s=>setAdminSection(s)} onBack={goToLogin} theme={theme} onThemeChange={changeTheme} T={T}/>
    );
    if(adminSection==="players")return(
      <PlayerManagement onBack={goToAdminMenu} T={T}/>
    );
    if(adminSection==="planning")return(
      <AdminSetup
        onStart={cfg=>{setConfig(cfg);setAdminSection("game");}}
        onBack={goToAdminMenu} T={T}
      />
    );
    if(adminSection==="game"){
      if(!config)return<AdminMenu config={config} onSelect={s=>setAdminSection(s)} onBack={goToLogin} theme={theme} onThemeChange={changeTheme} T={T}/>;
      return<Dashboard config={config} role="admin" onBack={goToAdminMenu} theme={theme} onThemeChange={changeTheme}/>;
    }
  }

  if(!config)return null;
  return<Dashboard config={config} role={role} onBack={goToLogin} theme={theme} onThemeChange={changeTheme}/>;
}
