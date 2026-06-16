import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, getDocs, deleteDoc } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const VERSION = "1.09";

const firebaseConfig = {
  apiKey: "AIzaSyAUT_w03rbgMPtEkz_fxwXv0rRdqx10OLA",
  authDomain: "pin-high-fcd1b.firebaseapp.com",
  projectId: "pin-high-fcd1b",
  storageBucket: "pin-high-fcd1b.firebasestorage.app",
  messagingSenderId: "554970406618",
  appId: "1:554970406618:web:569e0a8f2b92d5e8558fe3"
};
const VAPID_KEY = "BFj_WQTbF1U_VEPET_SaryvJbg-X_ye-PSQGD9nMpsVG7G3Hj7ZTF_sPsA4wZLZVStg0NVmLcSeuKVHW7O2zSN4";
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
let messaging = null;
try { messaging = getMessaging(firebaseApp); } catch(e) {}

let lastPushKey = null;
async function saveTournament(id, data) { await setDoc(doc(db,"tournaments",id),data); }
async function saveActiveMatch(id, data) { await setDoc(doc(db,"activeMatches",id), data); }
function generateMatchCode(){return String(Math.floor(1000+Math.random()*9000));}
async function loadMatchByCode(code){
  const snap=await getDocs(collection(db,"activeMatches"));
  const matches=snap.docs.map(d=>({id:d.id,...d.data()}));
  return matches.find(m=>m.code===code)||null;
}
async function archiveMatch(id, data) {
  await setDoc(doc(db,"archivedMatches",id), Object.assign({},data,{archivedAt:Date.now()}));
  await deleteDoc(doc(db,"activeMatches",id)).catch(()=>{});
}
async function loadActiveMatches() {
  const snap = await getDocs(collection(db,"activeMatches"));
  return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
async function loadArchivedMatches() {
  const snap = await getDocs(collection(db,"archivedMatches"));
  return snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
}
async function saveActive(id) { await setDoc(doc(db,"meta","active"),{id}); }
async function loadAllTournaments() { const snap=await getDocs(collection(db,"tournaments")); return snap.docs.map(d=>({id:d.id,...d.data()})); }
async function registerFCMToken() { if(!messaging)return null; try { const t=await getToken(messaging,{vapidKey:VAPID_KEY}); if(t){await setDoc(doc(db,"fcm_tokens",t),{token:t,createdAt:Date.now()});return t;} } catch(e){} return null; }
async function sendPushToAll(title,body,key) { if(key&&key===lastPushKey)return; lastPushKey=key; try{await fetch("/api/send-push",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,body})});}catch(e){} }

const ADMIN_CODE="RYDER-ADMIN", VIEWER_CODE="PINHIGH2025";
function resolveRole(code) { const c=code.trim().toUpperCase(); if(c===ADMIN_CODE)return"admin"; if(c===VIEWER_CODE)return"viewer"; const m=c.match(/^MATCH(\d+)$/); if(m)return`match-${parseInt(m[1])-1}`; return null; }

const DEFAULT_COURSES = {
  riedhof:{
    id:"riedhof", name:"GC München-Riedhof", shortName:"Riedhof", location:"Egling",
    par:[4,3,4,5,3,4,3,4,4, 4,3,5,4,5,4,5,4,4],
    si:[3,15,7,1,17,11,13,9,5, 2,16,8,12,4,18,10,6,14],
    cr:71.5, slope:132
  },
  bergkramerhof:{
    id:"bergkramerhof", name:"Golfclub Bergkramerhof", shortName:"Bergkramerhof", location:"Wolfratshausen",
    par:[4,5,3,4,4,3,5,3,5, 4,3,4,3,5,4,5,4,4],
    si:[17,13,9,7,3,5,15,11,1, 14,10,2,18,6,16,8,12,4],
    cr:70.6, slope:126
  },
};

const GAME_MODES = {
  scramble:{label:"Scramble",icon:"🔀",desc:"2v2 · Bestes Ergebnis",pairs:true},
  singles:{label:"Singles",icon:"👤",desc:"1v1 · Individuell",pairs:false},
  foursomes:{label:"Foursomes",icon:"🔄",desc:"2v2 · Abwechselnd",pairs:true},
  fourball:{label:"Four-Ball",icon:"⛳",desc:"2v2 · Bester Ball",pairs:true},
};

function calcTeamHcp(h1,h2){const lo=Math.min(h1,h2),hi=Math.max(h1,h2);return Math.round((lo*0.35+hi*0.15)*10)/10;}
function avgHcp(players){const v=players.filter(p=>p.hcp!=="");if(!v.length)return 0;return Math.round((v.reduce((s,p)=>s+parseFloat(p.hcp),0)/v.length)*10)/10;}

function calcRoundStatus(scores,pars,s,e){
  let diff=0,played=0,decidedAt=-1;
  const total=e-s;
  for(let i=s;i<e;i++){
    const h=scores[i];
    if(h.team1!==null&&h.team2!==null){
      played++;
      if(h.team1<h.team2)diff++;
      else if(h.team2<h.team1)diff--;
      const remaining=total-played;
      if(decidedAt===-1&&Math.abs(diff)>remaining){decidedAt=i-s;}
    }
  }
  const left=total-played;
  let won=false,label="AS",decided=false;
  if(left===0){won=true;label=diff>0?"1UP":diff<0?"1UP":"AS";}
  else if(Math.abs(diff)>left){won=true;decided=true;label=Math.abs(diff)+"&"+left;}
  else if(diff!==0){label=Math.abs(diff)+" UP";}
  return{diff,holesPlayed:played,holesLeft:left,label,won,decided,decidedAt};
}
function getPoints(rs){if(rs.won||rs.holesLeft===0){if(rs.diff>0)return{t1:1,t2:0};if(rs.diff<0)return{t1:0,t2:1};return{t1:0.5,t2:0.5};}return null;}
function projectedPoints(rs){if(rs.won||rs.holesLeft===0)return getPoints(rs);const a=rs.diff/18;return{t1:0.5+a*0.4,t2:0.5-a*0.4};}
function calcTournament(days){
  let t1c=0,t2c=0,t1p=0,t2p=0,total=0;
  days.forEach(day=>{const c=day.course||DEFAULT_COURSES.riedhof;day.matches.forEach(m=>{total+=2;[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,c.par,r*9,r*9+9);const conf=getPoints(rs),proj=projectedPoints(rs);if(conf){t1c+=conf.t1;t2c+=conf.t2;}t1p+=proj.t1;t2p+=proj.t2;});});});
  const s=t1p+t2p;return{t1Confirmed:t1c,t2Confirmed:t2c,t1Projected:Math.round(t1p*10)/10,t2Projected:Math.round(t2p*10)/10,t1WinProb:s>0?Math.round((t1p/s)*100):50,t2WinProb:s>0?Math.round((t2p/s)*100):50,totalPoints:total,needed:total/2+0.5};
}
function emptyScores(){return Array.from({length:18},()=>({team1:null,team2:null}));}
function detectPointChange(oldDays,newDays,t1Name,t2Name){
  if(!oldDays)return null;
  for(let di=0;di<newDays.length;di++){
    const od=oldDays[di],nd=newDays[di];if(!od)continue;const c=nd.course||DEFAULT_COURSES.riedhof;
    for(let mi=0;mi<nd.matches.length;mi++){
      const om=od.matches[mi],nm=nd.matches[mi];if(!om)continue;
      for(let r=0;r<2;r++){
        const ors=calcRoundStatus(om.scores,c.par,r*9,r*9+9),nrs=calcRoundStatus(nm.scores,c.par,r*9,r*9+9);
        const op=getPoints(ors),np=getPoints(nrs);
        if(!op&&np){const runde=r===0?"Runde 1":"Runde 2";const winner=np.t1>np.t2?t1Name:np.t2>np.t1?t2Name:null;const key=`${nm.id}-${r}-${np.t1}-${np.t2}`;
          return{title:winner?`🏆 ${winner} gewinnt ${runde}!`:`🤝 ${runde} Unentschieden`,body:`${nm.name} · ${runde} · ${np.t1}:${np.t2} Punkte`,winner,key};}
      }
    }
  }
  return null;
}

function calcStats(days,t1Name,t2Name){
  const pairStats={};let t1TotalHoles=0,t2TotalHoles=0;
  const holeWins={t1:Array(18).fill(0),t2:Array(18).fill(0),tie:Array(18).fill(0)};
  days.forEach(day=>{const course=day.course||DEFAULT_COURSES.riedhof;day.matches.forEach(m=>{
    const isPairs=GAME_MODES[m.mode||"scramble"]?.pairs!==false;
    const key1=isPairs?m.t1Pair.join(" & "):m.t1Pair[0]||"?";
    const key2=isPairs?m.t2Pair.join(" & "):m.t2Pair[0]||"?";
    if(!pairStats[key1])pairStats[key1]={name:key1,team:"t1",pts:0,holesWon:0,isCaptain:m.captain1||false};
    if(!pairStats[key2])pairStats[key2]={name:key2,team:"t2",pts:0,holesWon:0,isCaptain:m.captain2||false};
    [0,1].forEach(r=>{
      const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);const pts=getPoints(rs);
      if(pts){pairStats[key1].pts+=pts.t1;pairStats[key2].pts+=pts.t2;}
      for(let i=r*9;i<r*9+9;i++){const sc=m.scores[i];if(sc.team1!==null&&sc.team2!==null){if(sc.team1<sc.team2){pairStats[key1].holesWon++;t1TotalHoles++;holeWins.t1[i]++;}else if(sc.team2<sc.team1){pairStats[key2].holesWon++;t2TotalHoles++;holeWins.t2[i]++;}else holeWins.tie[i]++;}}
    });
  });});
  const allPairs=Object.values(pairStats);
  const hotHoles=holeWins.t1.map((_,i)=>({hole:i+1,t1:holeWins.t1[i],t2:holeWins.t2[i],tie:holeWins.tie[i],total:holeWins.t1[i]+holeWins.t2[i]+holeWins.tie[i]})).filter(h=>h.total>0).sort((a,b)=>b.total-a.total);
  return{t1Pairs:allPairs.filter(p=>p.team==="t1").sort((a,b)=>b.pts-a.pts),t2Pairs:allPairs.filter(p=>p.team==="t2").sort((a,b)=>b.pts-a.pts),t1TotalHoles,t2TotalHoles,holeWins,hotHoles,allPairs};
}

const THEMES={
  dark:{bg:"#0A1628",surface:"#0F2040",elevated:"#162448",border:"#1E3560",borderFaint:"#162040",gold:"#C9A96E",cream:"#F0E8D0",muted:"#6A8AAA",faint:"#2A4060",blue:"#6BB5FF",red:"#FF8A80",holeBg:"#0F1E38",holeText:"#2A4060",headerBg:"linear-gradient(180deg,#0A1628,#060E1A)",cardBg:"#0F2040",isDark:true},
  light:{bg:"#F5F0E8",surface:"#FFFFFF",elevated:"#EEE8D8",border:"#DDD5C0",borderFaint:"#EDE5D0",gold:"#A07830",cream:"#1A1A1A",muted:"#7A6A50",faint:"#AAA090",blue:"#1565C0",red:"#C62828",holeBg:"#EDE8DC",holeText:"#AAA090",headerBg:"linear-gradient(180deg,#1B3A6B,#142D55)",cardBg:"#FFFFFF",isDark:false},
};
const fmt=v=>v%1===0?v:v.toFixed(1);

function PinHighLogo({size=24,color="#C9A96E"}){
  return(
    <svg width={size} height={size*0.92} viewBox="0 0 110 100" xmlns="http://www.w3.org/2000/svg">
      <text x="2" y="88" fontFamily="Georgia,'Times New Roman',serif" fontSize="92" fontWeight="700" fill={color}>P</text>
      <line x1="82" y1="10" x2="82" y2="56" stroke={color} strokeWidth="5" strokeLinecap="round"/>
      <path d="M82 10 L104 22 L82 34 Z" fill={color}/>
      <line x1="70" y1="56" x2="94" y2="56" stroke={color} strokeWidth="5" strokeLinecap="round"/>
    </svg>
  );
}

function CaptainBadge({size=16}){
  return(
    <svg width={size} height={size} viewBox="0 0 16 16" style={{flexShrink:0}}>
      <circle cx="8" cy="8" r="7.5" fill="#C9A96E"/>
      <text x="8" y="12" textAnchor="middle" fontFamily="Georgia,serif" fontSize="9" fontWeight="900" fill="#0A1628">C</text>
    </svg>
  );
}

const IconBack=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const IconReset=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const IconChart=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const IconUser=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconPlus=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconTrash=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;

function Confetti({active,onDone}){
  const canvasRef=useRef(null);
  useEffect(()=>{
    if(!active)return;
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");canvas.width=window.innerWidth;canvas.height=window.innerHeight;
    const pieces=Array.from({length:120},()=>({x:Math.random()*canvas.width,y:-20,w:8+Math.random()*8,h:8+Math.random()*8,r:Math.random()*Math.PI*2,dr:(Math.random()-0.5)*0.2,dx:(Math.random()-0.5)*4,dy:3+Math.random()*4,color:["#C9A96E","#6BB5FF","#FF8A80","#F0E8D0","#FFD700","#A07830"][Math.floor(Math.random()*6)],opacity:1}));
    let frame,start=null;
    const draw=ts=>{if(!start)start=ts;const elapsed=ts-start;ctx.clearRect(0,0,canvas.width,canvas.height);pieces.forEach(p=>{p.x+=p.dx;p.y+=p.dy;p.r+=p.dr;if(elapsed>2000)p.opacity=Math.max(0,p.opacity-0.02);ctx.save();ctx.globalAlpha=p.opacity;ctx.translate(p.x,p.y);ctx.rotate(p.r);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();});if(elapsed<3500)frame=requestAnimationFrame(draw);else{ctx.clearRect(0,0,canvas.width,canvas.height);onDone();}};
    frame=requestAnimationFrame(draw);return()=>cancelAnimationFrame(frame);
  },[active]);
  if(!active)return null;
  return<canvas ref={canvasRef} style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:500}}/>;
}

function WinBanner({event,onDone}){
  useEffect(()=>{if(!event)return;const t=setTimeout(onDone,4000);return()=>clearTimeout(t);},[event]);
  if(!event)return null;
  return(
    <div style={{position:"fixed",top:"80px",left:"50%",transform:"translateX(-50%)",zIndex:501,textAlign:"center",pointerEvents:"none",width:"90%",maxWidth:"360px",animation:"slideDown 0.4s ease"}}>
      <style>{`@keyframes slideDown{from{transform:translateX(-50%) translateY(-30px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}`}</style>
      <div style={{background:event.winner?"linear-gradient(135deg,#C9A96E,#A07830)":"linear-gradient(135deg,#1E3560,#0F2040)",borderRadius:"16px",padding:"18px 24px",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",border:"1px solid rgba(255,255,255,0.15)"}}>
        <div style={{fontSize:"32px",marginBottom:"6px"}}>{event.winner?"🏆":"🤝"}</div>
        <div style={{fontSize:"17px",fontWeight:"900",color:event.winner?"#0A1628":"#C9A96E",fontFamily:"Georgia,serif",letterSpacing:"1px"}}>{event.title}</div>
        <div style={{fontSize:"11px",color:event.winner?"rgba(0,0,0,0.6)":"#6A8AAA",marginTop:"4px"}}>{event.body}</div>
      </div>
    </div>
  );
}

function ThemeToggle({theme,onChange}){
  const isDark=theme==="dark";
  return(
    <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
      <span style={{fontSize:"10px",color:isDark?"#2A4060":"#C9A96E"}}>☀</span>
      <div onClick={()=>onChange(isDark?"light":"dark")} style={{position:"relative",width:"32px",height:"18px",cursor:"pointer"}}>
        <div style={{position:"absolute",inset:0,borderRadius:"9px",background:isDark?"#0F2040":"#C9A96E",border:`1px solid ${isDark?"#1E3560":"#A07830"}`,transition:"background 0.3s"}}/>
        <div style={{position:"absolute",top:"3px",left:isDark?"3px":"17px",width:"12px",height:"12px",borderRadius:"50%",background:isDark?"#C9A96E":"#FAF5E4",transition:"left 0.3s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
      </div>
      <span style={{fontSize:"10px",color:isDark?"#C9A96E":"#2A4060"}}>☾</span>
    </div>
  );
}

function AppHeader({T,theme,onThemeChange,onBack,subtitle,rightSlot}){
  return(
    <div style={{background:T.headerBg,borderBottom:"1px solid "+T.gold+"44",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
      <button onClick={onBack} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"rgba(255,255,255,0.5)",padding:"5px 9px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"11px",fontFamily:"Arial,sans-serif"}}>
        <IconBack size={11} color="rgba(255,255,255,0.5)"/> Zurück
      </button>
      <div style={{textAlign:"center"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
          <PinHighLogo size={22} color="#C9A96E"/>
          <span style={{fontFamily:"Georgia,serif",fontSize:"14px",fontWeight:"900",letterSpacing:"4px",color:"#C9A96E",textTransform:"uppercase"}}>PIN HIGH</span>
        </div>
        {subtitle&&<div style={{fontSize:"9px",color:"rgba(255,255,255,0.3)",letterSpacing:"2px",textTransform:"uppercase",marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{subtitle}</div>}
      </div>
      {rightSlot||<ThemeToggle theme={theme} onChange={onThemeChange}/>}
    </div>
  );
}

const BtnGold=({children,onClick,disabled,T})=><button onClick={onClick} disabled={disabled} style={{width:"100%",padding:"13px",background:disabled?T.elevated:`linear-gradient(135deg,#C9A96E,#A07830)`,border:"none",borderRadius:"8px",color:disabled?T.muted:T.isDark?"#0A1628":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:disabled?"not-allowed":"pointer",marginBottom:"8px",opacity:disabled?0.5:1,fontFamily:"Arial,sans-serif"}}>{children}</button>;
const BtnGhost=({children,onClick,T,danger})=><button onClick={onClick} style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${danger?"#E05252":T.border}`,borderRadius:"8px",color:danger?"#E05252":T.muted,fontSize:"13px",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}}>{children}</button>;
const Card=({children,T,style})=><div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px",...style}}>{children}</div>;
const Label=({children,T})=><div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",textTransform:"uppercase",marginBottom:"6px",fontFamily:"Arial,sans-serif"}}>{children}</div>;
const Inp=({value,onChange,placeholder,T,type="text",style})=><input type={type} value={value} onChange={onChange} placeholder={placeholder} style={{width:"100%",padding:"10px 12px",background:T.isDark?"#060E1A":T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",boxSizing:"border-box",outline:"none",marginBottom:"10px",...style}}/>;
const StepDots=({total,current})=><div style={{display:"flex",justifyContent:"center",gap:"6px",marginBottom:"14px"}}>{Array.from({length:total},(_,i)=><div key={i} style={{width:"8px",height:"8px",borderRadius:"50%",background:i<current?"#6A8AAA":i===current?"#C9A96E":"#1E3560"}}/>)}</div>;
const RoleBadge=({role,T})=>{const isAdmin=role==="admin",isViewer=role==="viewer";const num=!isAdmin&&!isViewer?parseInt(role.split("-")[1])+1:null;const label=isAdmin?"👑 Admin":isViewer?"👁 Zuschauer":`⛳ Match ${num}`;const color=isAdmin?T.gold:isViewer?T.muted:T.blue;return<div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"3px 10px",fontSize:"10px",color,letterSpacing:"1px",fontFamily:"Arial,sans-serif"}}>{label}</div>;};
const ResetConfirm=({title,message,onConfirm,onClose,T})=>(
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={onClose}>
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
      <div style={{width:"44px",height:"44px",borderRadius:"50%",background:"#E0525222",border:"1px solid #E0525255",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><IconReset size={22} color="#E05252"/></div>
      <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif",marginBottom:"6px"}}>{title}</div>
      <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"Arial,sans-serif"}}>{message}</div>
      <button style={{width:"100%",padding:"11px",background:"#E05252",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}} onClick={onConfirm}>Ja, zurücksetzen</button>
      <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={onClose}>Abbrechen</button>
    </div>
  </div>
);
const Toast=({message,onDismiss})=>{useEffect(()=>{const t=setTimeout(onDismiss,5000);return()=>clearTimeout(t);},[]);if(!message)return null;return<div style={{position:"fixed",top:"16px",left:"50%",transform:"translateX(-50%)",zIndex:400,background:"linear-gradient(135deg,#1E3560,#0F2040)",border:"1px solid #C9A96E",borderRadius:"12px",padding:"12px 18px",maxWidth:"340px",width:"90%",boxShadow:"0 4px 20px rgba(0,0,0,0.5)",display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={onDismiss}><span style={{fontSize:"20px"}}>🏆</span><div><div style={{fontSize:"13px",fontWeight:"700",color:"#C9A96E",fontFamily:"Georgia,serif"}}>{message.title}</div><div style={{fontSize:"11px",color:"#6A8AAA",marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{message.body}</div></div></div>;};
const PushBanner=({onDismiss,T})=>{
  const [state,setState]=useState("idle");
  const req=async()=>{setState("requesting");if(!("Notification"in window)||!messaging){setState("unsupported");return;}try{const p=await Notification.requestPermission();if(p==="granted"){await registerFCMToken();setState("granted");setTimeout(onDismiss,2000);}else setState("denied");}catch(e){setState("denied");}};
  if(state==="granted")return<div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}><span>✅</span><div style={{fontSize:"12px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Push aktiviert!</div></div>;
  if(state==="denied"||state==="unsupported")return<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px"}}><div style={{fontSize:"12px",color:"#E05252",marginBottom:"4px",fontFamily:"Arial,sans-serif"}}>{state==="unsupported"?"❌ Bitte App als PWA installieren":"❌ Benachrichtigungen blockiert"}</div><button style={{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer",marginTop:"8px",fontFamily:"Arial,sans-serif"}} onClick={onDismiss}>Schließen</button></div>;
  return(<div style={{background:T.elevated,border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}><div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"10px"}}><span style={{fontSize:"20px"}}>🔔</span><div><div style={{fontSize:"13px",fontWeight:"700",color:T.gold,marginBottom:"3px",fontFamily:"Georgia,serif"}}>Push-Benachrichtigungen</div><div style={{fontSize:"11px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Erhalte eine Meldung wenn ein Team einen Punkt gewinnt.</div></div></div><div style={{display:"flex",gap:"8px"}}><button style={{flex:1,padding:"10px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0A1628":"white",fontSize:"12px",fontWeight:"900",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={req} disabled={state==="requesting"}>{state==="requesting"?"Warte...":"🔔 Aktivieren"}</button><button style={{padding:"10px 14px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"12px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={onDismiss}>Später</button></div></div>);
};

function Login({onLogin,theme,onThemeChange}){
  const [code,setCode]=useState(""),[error,setError]=useState("");
  const T=THEMES.dark;
  const check=()=>{const r=resolveRole(code);if(r)onLogin(r);else setError("Ungültiger Code");};
  return(
    <div style={{minHeight:"100vh",background:"#0A1628",color:"#F0E8D0",fontFamily:"Georgia,serif",display:"flex",flexDirection:"column"}}>
      <div style={{position:"absolute",top:"16px",right:"16px"}}><ThemeToggle theme={theme} onChange={onThemeChange}/></div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
        <div style={{width:"100%",maxWidth:"320px",textAlign:"center"}}>
          <div style={{marginBottom:"16px",display:"flex",justifyContent:"center"}}><PinHighLogo size={64} color="#C9A96E"/></div>
          <div style={{fontFamily:"Georgia,serif",fontSize:"28px",fontWeight:"900",letterSpacing:"8px",color:"#C9A96E",textTransform:"uppercase"}}>PIN HIGH</div>
          <div style={{display:"flex",alignItems:"center",gap:"10px",margin:"8px 0 4px"}}>
            <div style={{flex:1,height:"0.5px",background:"linear-gradient(90deg,transparent,#C9A96E44)"}}/>
            <div style={{fontFamily:"Arial,sans-serif",fontSize:"10px",letterSpacing:"4px",color:"#2A4060",textTransform:"uppercase"}}>Friends Tour</div>
            <div style={{flex:1,height:"0.5px",background:"linear-gradient(90deg,#C9A96E44,transparent)"}}/>
          </div>
          <div style={{fontSize:"10px",color:"#1E3560",letterSpacing:"1px",marginBottom:"28px",fontFamily:"Arial,sans-serif"}}>Version {VERSION}</div>
          <input style={{width:"100%",padding:"14px",background:"#0F2040",border:"1px solid #1E3560",borderRadius:"8px",color:"#C9A96E",fontSize:"20px",letterSpacing:"6px",textAlign:"center",marginBottom:"10px",boxSizing:"border-box",outline:"none",fontFamily:"Arial,sans-serif"}}
            placeholder="CODE EINGEBEN" value={code}
            onChange={e=>{setCode(e.target.value.toUpperCase());setError("");}}
            onKeyDown={e=>e.key==="Enter"&&check()}/>
          {error&&<div style={{color:"#E05252",fontSize:"12px",marginBottom:"10px",fontFamily:"Arial,sans-serif"}}>{error}</div>}
          <button style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:"#0A1628",fontSize:"14px",fontWeight:"900",letterSpacing:"3px",textTransform:"uppercase",cursor:"pointer",fontFamily:"Arial,sans-serif",marginBottom:"14px"}} onClick={check}>Eintreten</button>
          <div style={{background:"#0F2040",border:"1px solid #1E3560",borderRadius:"8px",padding:"12px",textAlign:"left"}}>
            <div style={{fontSize:"10px",color:"#C9A96E",letterSpacing:"1px",marginBottom:"8px",fontFamily:"Arial,sans-serif"}}>ZUGANGSCODES</div>
            {[["👑 Admin","RYDER-ADMIN"],["👁 Zuschauer","PINHIGH2025"],["⛳ Spieler","MATCH1 – MATCH8"]].map(([r,c])=>(
              <div key={r} style={{display:"flex",justifyContent:"space-between",fontSize:"11px",marginBottom:"4px",fontFamily:"Arial,sans-serif"}}>
                <span style={{color:"#2A4060"}}>{r}</span><span style={{color:"#C9A96E",fontFamily:"monospace"}}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Quick Match ──────────────────────────────────────────────────────────────
function FfaScoreModal({playerId, holeIndex, players, course, existingScore, onSave, onClose, T}){
  const [val, setVal] = useState(existingScore !== null && existingScore !== undefined ? String(existingScore) : "");
  const p = players.find(x => x.id === playerId);
  const par = course.par[holeIndex];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={onClose}>
      <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"14px"}}>
          {p&&<PlayerAvatar name={p.fn+" "+p.ln} size={36} color={T.blue} photo={p.photo}/>}
          <div>
            <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,fontFamily:"Georgia,serif"}}>Loch {holeIndex+1} · {p?p.fn+" "+p.ln:""}</div>
            <div style={{fontSize:"11px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Par {par}</div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"center",background:T.elevated,border:"1px solid "+T.border,borderRadius:"8px",padding:"6px 12px"}}>
            <div style={{fontSize:"9px",color:T.muted,fontFamily:"Arial,sans-serif"}}>PAR</div>
            <div style={{fontSize:"22px",fontWeight:"900",color:T.gold,fontFamily:"Georgia,serif",lineHeight:1}}>{par}</div>
          </div>
        </div>
        <input type="number" min="1" max="15"
          style={{width:"100%",fontSize:"48px",fontWeight:"900",background:T.isDark?"#060E1A":T.elevated,border:"2px solid "+T.border,borderRadius:"8px",color:T.cream,textAlign:"center",padding:"10px 0",outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif",marginBottom:"12px"}}
          value={val} onChange={e=>setVal(e.target.value)} autoFocus/>
        <BtnGold onClick={()=>{if(val!=="")onSave(playerId,holeIndex,Number(val));}} T={T}>Speichern</BtnGold>
        <BtnGhost onClick={onClose} T={T}>Abbrechen</BtnGhost>
      </div>
    </div>
  );
}


function QuickMatch({onBack,role,T,theme,onThemeChange}){
  const [step,setStep]=useState(1);
  const [qName,setQName]=useState("Quick Match");
  const [format,setFormat]=useState("ffa"); // "teams" | "ffa" (free for all)
  const [mode,setMode]=useState("scramble");
  const [gameFormat,setGameFormat]=useState("stroke"); // "matchplay" | "stroke"
  const [scoring,setScoring]=useState("brutto"); // "brutto" | "netto"
  const [holes,setHoles]=useState(18);
  const [courseId,setCourseId]=useState("riedhof");
  const [savedPlayers,setSavedPlayers]=useState([]);
  const [t1Players,setT1Players]=useState([]);
  const [t2Players,setT2Players]=useState([]);
  const [ffaPlayers,setFfaPlayers]=useState([]); // for free-for-all
  const [scores,setScores]=useState(()=>Array.from({length:18},()=>({team1:null,team2:null})));
  const [ffaScores,setFfaScores]=useState({}); // playerId -> array of 18 scores
  const [modal,setModal]=useState(null);
  const [ffaModal,setFfaModal]=useState(null);
  const [matchId,setMatchId]=useState(null);
  const [matchCode,setMatchCode]=useState(null);
  const [showEndConfirm,setShowEndConfirm]=useState(false); // {playerId, holeIndex}

  const course=DEFAULT_COURSES[courseId];
  const modeInfo=GAME_MODES[mode];
  const isPairs=modeInfo?modeInfo.pairs!==false:true;
  const limit=isPairs?2:1;

  useEffect(()=>{
    getDocs(collection(db,"savedPlayers")).then(snap=>{
      if(!snap.empty)setSavedPlayers(snap.docs.map(d=>({id:d.id,...d.data()})));
    }).catch(()=>{});
  },[]);

  const toggleTeamPlayer=(player,team)=>{
    const setter=team==="t1"?setT1Players:setT2Players;
    const current=team==="t1"?t1Players:t2Players;
    const other=team==="t1"?t2Players:t1Players;
    if(other.find(p=>p.id===player.id))return; // already in other team
    if(current.find(p=>p.id===player.id)){setter(current.filter(p=>p.id!==player.id));}
    else{if(current.length>=limit)return;setter([...current,player]);}
  };

  const toggleFfaPlayer=(player)=>{
    if(ffaPlayers.find(p=>p.id===player.id)){
      setFfaPlayers(ffaPlayers.filter(p=>p.id!==player.id));
      const ns={...ffaScores};delete ns[player.id];setFfaScores(ns);
    } else {
      setFfaPlayers([...ffaPlayers,player]);
      setFfaScores(prev=>({...prev,[player.id]:Array(18).fill(null)}));
    }
  };

  const canStart=format==="teams"
    ?(t1Players.length>=limit&&t2Players.length>=limit)
    :(ffaPlayers.length>=2);

  const saveTeamScore=async(hi,t1s,t2s)=>{
    const ns=[...scores];ns[hi]={team1:t1s,team2:t2s};setScores(ns);setModal(null);
    if(matchId){
      try{await saveActiveMatch(matchId,{id:matchId,name:qName,format,gameFormat,scoring,mode,holes,courseId,t1Players:t1Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),t2Players:t2Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),scores:ns,status:"active",createdAt:Date.now()});}catch(e){}
    }
  };

  const saveFfaScore=async(playerId,hi,val)=>{
    const ns=Object.assign({},ffaScores);
    ns[playerId]=[...(ffaScores[playerId]||Array(18).fill(null))];
    ns[playerId][hi]=val;
    setFfaScores(ns);
    setFfaModal(null);
    if(matchId){
      try{await saveActiveMatch(matchId,{id:matchId,name:qName,format:"ffa",gameFormat,scoring,holes,courseId,ffaPlayers:ffaPlayers.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),ffaScores:ns,status:"active",createdAt:Date.now()});}catch(e){}
    }
  };

  // FFA Leaderboard calculation
  const ffaLeaderboard=ffaPlayers.map(p=>{
    const playerScores=ffaScores[p.id]||Array(18).fill(null);
    const played=playerScores.filter(s=>s!==null);
    const brutto=played.reduce((a,b)=>a+(b||0),0);
    const hcpVal=parseFloat(p.hcp)||0;
    const courseHcp=Math.round(hcpVal*(course.cr-72)/113+hcpVal);
    const netto=brutto-courseHcp;
    return{...p,brutto:played.length>0?brutto:null,netto:played.length>0?netto:null,holesPlayed:played.length};
  }).sort((a,b)=>{
    if(scoring==="netto"){if(a.netto===null)return 1;if(b.netto===null)return -1;return a.netto-b.netto;}
    if(a.brutto===null)return 1;if(b.brutto===null)return -1;return a.brutto-b.brutto;
  });

  const rs=format==="teams"?calcRoundStatus(scores,course.par,0,holes):null;
  const pts=rs?getPoints(rs):null;
  const t1W=rs?Math.max(5,Math.min(95,50+(rs.diff*5))):50;
  const holeRange=Array.from({length:holes},(_,i)=>i);

  // ── STEP 1: Setup ──────────────────────────────────────────────────────────
  if(step===1) return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Quick Match"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <Card T={T}>
          <Label T={T}>Match Name</Label>
          <Inp value={qName} onChange={e=>setQName(e.target.value)} placeholder="z.B. Samstag Scramble" T={T}/>
        </Card>

        <Card T={T}>
          <Label T={T}>Format</Label>
          <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
            {[["teams","👥 Teams","2v2 oder 1v1"],["ffa","⚡ Jeder gegen Jeden","1v1v1v1 · eigene Scorekarte"]].map(([k,l,d])=>(
              <button key={k} onClick={()=>setFormat(k)} style={{flex:1,padding:"12px 8px",borderRadius:"10px",border:"2px solid "+(format===k?T.gold:T.border),background:format===k?T.gold+"22":T.elevated,cursor:"pointer",textAlign:"left"}}>
                <div style={{fontSize:"12px",fontWeight:"700",color:format===k?T.gold:T.cream,fontFamily:"Arial,sans-serif"}}>{l}</div>
                <div style={{fontSize:"10px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{d}</div>
              </button>
            ))}
          </div>

          <Label T={T}>Spielformat</Label>
          <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
            {[["matchplay","🏌️ Match Play","Loch für Loch"],["stroke","📊 Stroke Play","Gesamtschläge"]].map(([k,l,d])=>(
              <button key={k} onClick={()=>setGameFormat(k)} style={{flex:1,padding:"10px 8px",borderRadius:"8px",border:"1px solid "+(gameFormat===k?T.gold:T.border),background:gameFormat===k?T.gold+"22":T.elevated,cursor:"pointer",textAlign:"left"}}>
                <div style={{fontSize:"11px",fontWeight:"700",color:gameFormat===k?T.gold:T.cream,fontFamily:"Arial,sans-serif"}}>{l}</div>
                <div style={{fontSize:"9px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{d}</div>
              </button>
            ))}
          </div>

          <Label T={T}>Wertung</Label>
          <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
            {[["brutto","Brutto","Tatsächliche Schläge"],["netto","Netto","Mit HCP-Abzug"]].map(([k,l,d])=>(
              <button key={k} onClick={()=>setScoring(k)} style={{flex:1,padding:"10px 8px",borderRadius:"8px",border:"1px solid "+(scoring===k?T.gold:T.border),background:scoring===k?T.gold+"22":T.elevated,cursor:"pointer",textAlign:"left"}}>
                <div style={{fontSize:"11px",fontWeight:"700",color:scoring===k?T.gold:T.cream,fontFamily:"Arial,sans-serif"}}>{l}</div>
                <div style={{fontSize:"9px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{d}</div>
              </button>
            ))}
          </div>

          {format==="teams"&&(
            <>
              <Label T={T}>Spielmodus</Label>
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap",marginBottom:"14px"}}>
                {Object.entries(GAME_MODES).map(([k,v])=>(
                  <button key={k} onClick={()=>setMode(k)} style={{padding:"6px 10px",borderRadius:"6px",border:"1px solid "+(mode===k?T.gold:T.border),background:mode===k?T.gold+"22":T.surface,color:mode===k?T.gold:T.muted,fontSize:"11px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <Label T={T}>Löcher</Label>
          <div style={{display:"flex",gap:"8px",marginBottom:"14px"}}>
            {[9,18].map(h=>(
              <button key={h} onClick={()=>setHoles(h)} style={{flex:1,padding:"12px",borderRadius:"8px",border:"2px solid "+(holes===h?T.gold:T.border),background:holes===h?T.gold+"22":T.elevated,color:holes===h?T.gold:T.muted,fontSize:"18px",fontWeight:"900",cursor:"pointer",fontFamily:"Georgia,serif"}}>{h}</button>
            ))}
          </div>

          <Label T={T}>Golfplatz</Label>
          {Object.values(DEFAULT_COURSES).map(c=>(
            <button key={c.id} onClick={()=>setCourseId(c.id)} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:courseId===c.id?T.gold+"18":(T.isDark?"#060E1A":T.elevated),border:"1px solid "+(courseId===c.id?T.gold:T.border),borderRadius:"8px",marginBottom:"6px",cursor:"pointer",width:"100%",textAlign:"left"}}>
              <span style={{fontSize:"18px"}}>⛳</span>
              <div>
                <div style={{fontSize:"12px",fontWeight:"700",color:T.cream,fontFamily:"Arial,sans-serif"}}>{c.name}</div>
                <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{c.location} · Par {c.par.reduce((a,b)=>a+b,0)}</div>
              </div>
            </button>
          ))}
        </Card>

        {/* Spieler wählen */}
        {format==="teams"?(
          <Card T={T}>
            <Label T={T}>Spieler zuordnen</Label>
            <div style={{display:"flex",gap:"8px"}}>
              {[["t1","Team 1",T.blue],["t2","Team 2",T.red]].map(([team,label,color])=>{
                const current=team==="t1"?t1Players:t2Players;
                return(
                  <div key={team} style={{flex:1}}>
                    <div style={{fontSize:"10px",color,letterSpacing:"1px",marginBottom:"6px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>{label} ({current.length}/{limit})</div>
                    {savedPlayers.map(p=>{
                      const inThis=current.find(x=>x.id===p.id);
                      const inOther=(team==="t1"?t2Players:t1Players).find(x=>x.id===p.id);
                      return(
                        <button key={p.id} onClick={()=>!inOther&&toggleTeamPlayer(p,team)} disabled={!!inOther}
                          style={{width:"100%",padding:"6px 8px",marginBottom:"4px",borderRadius:"6px",border:"1px solid "+(inThis?color:T.border),background:inThis?color+"22":T.surface,color:inThis?color:inOther?T.faint:T.cream,fontSize:"11px",cursor:inOther?"not-allowed":"pointer",textAlign:"left",fontFamily:"Arial,sans-serif",opacity:inOther?0.4:1,display:"flex",alignItems:"center",gap:"6px"}}>
                          <PlayerAvatar name={p.fn+" "+p.ln} size={22} color={inThis?color:T.muted}/>
                          <span>{p.fn} {p.ln}</span>
                          <span style={{color:T.faint,fontSize:"9px",marginLeft:"auto"}}>HCP {p.hcp}</span>
                          {inThis&&<span style={{color,fontSize:"12px"}}>✓</span>}
                        </button>
                      );
                    })}
                    {savedPlayers.length===0&&<div style={{fontSize:"11px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Keine Spieler gespeichert</div>}
                  </div>
                );
              })}
            </div>
          </Card>
        ):(
          <Card T={T}>
            <Label T={T}>Spieler auswählen (mind. 2)</Label>
            {savedPlayers.map(p=>{
              const isIn=ffaPlayers.find(x=>x.id===p.id);
              return(
                <button key={p.id} onClick={()=>toggleFfaPlayer(p)}
                  style={{width:"100%",padding:"8px 10px",marginBottom:"6px",borderRadius:"8px",border:"1px solid "+(isIn?T.gold:T.border),background:isIn?T.gold+"22":T.surface,cursor:"pointer",display:"flex",alignItems:"center",gap:"8px"}}>
                  <PlayerAvatar name={p.fn+" "+p.ln} size={28} color={isIn?T.gold:T.muted} photo={p.photo||null}/>
                  <div style={{flex:1,textAlign:"left"}}>
                    <div style={{fontSize:"12px",color:isIn?T.gold:T.cream,fontWeight:isIn?"700":"400",fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                    <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>HCP {p.hcp}</div>
                  </div>
                  {isIn&&<span style={{fontSize:"14px",color:T.gold}}>✓</span>}
                </button>
              );
            })}
            {savedPlayers.length===0&&<div style={{fontSize:"12px",color:T.faint,fontFamily:"Arial,sans-serif",textAlign:"center"}}>Keine gespeicherten Spieler. Erst Spieler im Turnier-Setup anlegen.</div>}
          </Card>
        )}

        <BtnGold onClick={async()=>{
          if(!canStart)return;
          const mid="QM_"+Date.now();
          const code=generateMatchCode();
          setMatchId(mid);
          const data={
            id:mid, name:qName, format, gameFormat, scoring, mode,
            holes, courseId, code,
            t1Players:format==="teams"?t1Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})):[],
            t2Players:format==="teams"?t2Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})):[],
            ffaPlayers:format==="ffa"?ffaPlayers.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})):[],
            scores:Array.from({length:18},()=>({team1:null,team2:null})),
            ffaScores:{},
            status:"active",
            createdAt:Date.now()
          };
          setMatchCode(code);
          await saveActiveMatch(mid, data).catch(()=>{});
          setStep(2);
        }} disabled={!canStart} T={T}>Match starten ⛳</BtnGold>
        <BtnGhost onClick={onBack} T={T}>Abbrechen</BtnGhost>
      </div>
    </div>
  );

  // ── STEP 2: Scoring ────────────────────────────────────────────────────────
  if(format==="ffa") return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={()=>setStep(1)} subtitle={qName}/>
      {matchCode&&<div style={{background:"#1E3560",padding:"8px 14px",textAlign:"center",borderBottom:"1px solid #C9A96E44"}}>
        <span style={{fontSize:"11px",color:"#6A8AAA",fontFamily:"Arial,sans-serif"}}>Match-Code: </span>
        <span style={{fontSize:"18px",fontWeight:"900",color:"#C9A96E",fontFamily:"monospace",letterSpacing:"4px"}}>{matchCode}</span>
        <span style={{fontSize:"10px",color:"#6A8AAA",fontFamily:"Arial,sans-serif",marginLeft:"8px"}}>· Spieler einladen</span>
      </div>}
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {/* Leaderboard */}
        <Card T={T}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
            <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,fontFamily:"Georgia,serif"}}>Leaderboard</div>
            <div style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>{scoring==="netto"?"Netto":"Brutto"} · {holes} Loch</div>
          </div>
          {ffaLeaderboard.map((p,i)=>{
            const medals=["🥇","🥈","🥉"];
            const scoreVal=scoring==="netto"?p.netto:p.brutto;
            return(
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderBottom:i<ffaLeaderboard.length-1?"1px solid "+T.border:"none"}}>
                <div style={{fontSize:"16px",width:"24px",textAlign:"center"}}>{medals[i]||i+1}</div>
                <PlayerAvatar name={p.fn+" "+p.ln} size={34} color={i===0?T.gold:i===1?T.blue:i===2?T.red:T.muted} photo={p.photo||null}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:T.cream,fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                  <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>HCP {p.hcp} · {p.holesPlayed}/{holes} Löcher</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:"18px",fontWeight:"900",color:i===0?T.gold:T.cream,fontFamily:"Georgia,serif"}}>{scoreVal!==null?scoreVal:"—"}</div>
                  {scoring==="netto"&&p.brutto!==null&&<div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Brutto: {p.brutto}</div>}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Individual scorecards */}
        {ffaPlayers.map(p=>{
          const playerScores=ffaScores[p.id]||Array(18).fill(null);
          return(
            <Card key={p.id} T={T}>
              <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px"}}>
                <PlayerAvatar name={p.fn+" "+p.ln} size={30} color={T.blue} photo={p.photo||null}/>
                <div style={{fontSize:"12px",fontWeight:"700",color:T.cream,fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                <div style={{marginLeft:"auto",fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>HCP {p.hcp}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"2px"}}>
                {holeRange.map(i=>{
                  const s=playerScores[i];
                  const par=course.par[i];
                  const bg=s===null?"#0F1E38":s<par?"#6BB5FF25":s===par?"#1E3560":"#FF8A8025";
                  const col=s===null?"#2A4060":s<par?T.blue:s===par?T.muted:T.red;
                  return(
                    <div key={i} onClick={()=>setFfaModal({playerId:p.id,holeIndex:i})}
                      style={{background:bg,borderRadius:"3px",padding:"2px 0",textAlign:"center",minHeight:"32px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                      <div style={{fontSize:"8px",fontWeight:"700",color:col,fontFamily:"Arial,sans-serif"}}>{i+1}</div>
                      <div style={{fontSize:"6px",color:"#2A4060",fontFamily:"Arial,sans-serif"}}>P{par}</div>
                      {s!==null&&<div style={{fontSize:"8px",fontWeight:"900",color:col,fontFamily:"Arial,sans-serif"}}>{s}</div>}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        {role==="admin"&&(
          <button onClick={()=>setShowEndConfirm(true)}
            style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"13px",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif",fontWeight:"700"}}>
            🏁 Match beenden
          </button>
        )}
        <BtnGhost onClick={()=>setStep(1)} T={T}>← Einstellungen</BtnGhost>

        {showEndConfirm&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:"20px"}} onClick={()=>setShowEndConfirm(false)}>
            <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>🏁</div>
              <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif",marginBottom:"6px"}}>Match wirklich beenden?</div>
              <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"Arial,sans-serif"}}>Das Match wird ins Archiv verschoben und kann nicht mehr bearbeitet werden.</div>
              <button style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:"#0A1628",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}} onClick={async()=>{
                if(matchId){
                  const data={id:matchId,name:qName,format,gameFormat,scoring,holes,courseId,
                    ffaPlayers:ffaPlayers.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),
                    ffaScores,t1Players:t1Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),
                    t2Players:t2Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),
                    scores,status:"archived",createdAt:Date.now()};
                  await archiveMatch(matchId,data).catch(()=>{});
                }
                setShowEndConfirm(false);
                onBack();
              }}>Ja, beenden & archivieren</button>
              <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={()=>setShowEndConfirm(false)}>Abbrechen</button>
            </div>
          </div>
        )}

        {/* FFA Score Modal */}
        {ffaModal&&<FfaScoreModal
          playerId={ffaModal.playerId}
          holeIndex={ffaModal.holeIndex}
          players={ffaPlayers}
          course={course}
          existingScore={ffaScores[ffaModal.playerId]?ffaScores[ffaModal.playerId][ffaModal.holeIndex]:null}
          onSave={(pid,hi,val)=>saveFfaScore(pid,hi,val)}
          onClose={()=>setFfaModal(null)}
          T={T}/>}
      </div>
    </div>
  );

  // Teams scoring (existing matchplay)
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={()=>setStep(1)} subtitle={qName}/>
      {matchCode&&<div style={{background:"#1E3560",padding:"8px 14px",textAlign:"center",borderBottom:"1px solid #C9A96E44"}}>
        <span style={{fontSize:"11px",color:"#6A8AAA",fontFamily:"Arial,sans-serif"}}>Match-Code: </span>
        <span style={{fontSize:"18px",fontWeight:"900",color:"#C9A96E",fontFamily:"monospace",letterSpacing:"4px"}}>{matchCode}</span>
      </div>}
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <Card T={T}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              {t1Players.slice(0,2).map((p,i)=><PlayerAvatar key={i} name={p.fn+" "+p.ln} size={30} color={T.blue}/>)}
              <div>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.blue,fontFamily:"Arial,sans-serif"}}>{t1Players.map(p=>p.fn).join(" & ")}</div>
                <div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Team 1</div>
              </div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"16px",fontWeight:"900",color:rs&&rs.holesPlayed>0?(rs.diff>0?T.blue:rs.diff<0?T.red:T.muted):T.muted,fontFamily:"Georgia,serif"}}>{rs&&rs.holesPlayed>0?rs.label:"AS"}</div>
              {rs&&rs.holesPlayed>0&&<div style={{fontSize:"9px",color:rs.diff>0?T.blue:rs.diff<0?T.red:T.muted,fontFamily:"Arial,sans-serif"}}>{rs.diff>0?"Team 1 führt":rs.diff<0?"Team 2 führt":"Gleichstand"}</div>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"8px",flexDirection:"row-reverse"}}>
              {t2Players.slice(0,2).map((p,i)=><PlayerAvatar key={i} name={p.fn+" "+p.ln} size={30} color={T.red}/>)}
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.red,fontFamily:"Arial,sans-serif"}}>{t2Players.map(p=>p.fn).join(" & ")}</div>
                <div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Team 2</div>
              </div>
            </div>
          </div>
          <div style={{height:"8px",borderRadius:"4px",overflow:"hidden",display:"flex"}}>
            <div style={{width:t1W+"%",background:T.blue,transition:"width 0.4s"}}/>
            <div style={{flex:1,background:T.red}}/>
          </div>
        </Card>

        <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:"12px"}}>
          {holeRange.map(i=>{
            const s=scores[i];const played=s.team1!==null&&s.team2!==null;
            const bg=played?(s.team1<s.team2?T.blue+"25":s.team2<s.team1?T.red+"25":T.border):"#0F1E38";
            const col=played?(s.team1<s.team2?T.blue:s.team2<s.team1?T.red:T.muted):"#2A4060";
            return(
              <div key={i} onClick={()=>setModal(i)} style={{background:bg,borderRadius:"4px",padding:"2px 0",textAlign:"center",minHeight:"36px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",border:"1px solid "+T.border}}>
                <div style={{fontSize:"9px",fontWeight:"700",color:col,fontFamily:"Arial,sans-serif"}}>{i+1}</div>
                <div style={{fontSize:"7px",color:"#2A4060",fontFamily:"Arial,sans-serif"}}>P{course.par[i]}</div>
                {played&&<div style={{fontSize:"8px",fontWeight:"900",color:col,fontFamily:"Arial,sans-serif"}}>{s.team1}:{s.team2}</div>}
              </div>
            );
          })}
        </div>

        {role==="admin"&&(
          <button onClick={()=>setShowEndConfirm(true)}
            style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"13px",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif",fontWeight:"700"}}>
            🏁 Match beenden
          </button>
        )}
        <BtnGhost onClick={()=>setStep(1)} T={T}>← Einstellungen</BtnGhost>

        {showEndConfirm&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:"20px"}} onClick={()=>setShowEndConfirm(false)}>
            <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
              <div style={{fontSize:"32px",marginBottom:"12px"}}>🏁</div>
              <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif",marginBottom:"6px"}}>Match wirklich beenden?</div>
              <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"Arial,sans-serif"}}>Das Match wird ins Archiv verschoben.</div>
              <button style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:"#0A1628",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}} onClick={async()=>{
                if(matchId){
                  const data={id:matchId,name:qName,format,gameFormat,scoring,mode,holes,courseId,
                    t1Players:t1Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),
                    t2Players:t2Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp})),
                    scores,status:"archived",createdAt:Date.now()};
                  await archiveMatch(matchId,data).catch(()=>{});
                }
                setShowEndConfirm(false);
                onBack();
              }}>Ja, beenden & archivieren</button>
              <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={()=>setShowEndConfirm(false)}>Abbrechen</button>
            </div>
          </div>
        )}

        {modal!==null&&(
          <ScoreModal
            match={{name:qName,mode,scores,t1Pair:t1Players.map(p=>p.fn+" "+p.ln),t2Pair:t2Players.map(p=>p.fn+" "+p.ln)}}
            holeIndex={modal} t1Name="Team 1" t2Name="Team 2"
            par={course.par} existing={scores[modal]}
            onSave={(t1s,t2s)=>saveTeamScore(modal,t1s,t2s)}
            onClose={()=>setModal(null)} T={T}/>
        )}
      </div>
    </div>
  );
}


function PlayerManager({onBack, T, theme, onThemeChange}){
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [fn, setFn] = useState("");
  const [ln, setLn] = useState("");
  const [hcp, setHcp] = useState("");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(()=>{
    getDocs(collection(db,"savedPlayers")).then(snap=>{
      setPlayers(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  const [cropSrc,setCropSrc]=useState(null);
  const [cropScale,setCropScale]=useState(1);
  const [cropOffX,setCropOffX]=useState(0);
  const [cropOffY,setCropOffY]=useState(0);

  const handlePhotoChange=(e)=>{
    const file=e.target.files[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{setCropSrc(ev.target.result);setCropScale(1);setCropOffX(0);setCropOffY(0);};
    reader.readAsDataURL(file);
  };

  const cropAndSave=()=>{
    const size=200;
    const canvas=document.createElement("canvas");
    canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext("2d");
    const img=new Image();
    img.onload=()=>{
      const s=Math.min(img.width,img.height)*cropScale;
      const sx=(img.width-s)/2+cropOffX;
      const sy=(img.height-s)/2+cropOffY;
      ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.clip();
      ctx.drawImage(img,sx,sy,s,s,0,0,size,size);
      setPhoto(canvas.toDataURL("image/jpeg",0.8));
      setCropSrc(null);
    };
    img.src=cropSrc;
  };

  const startEdit=(p)=>{
    setEditingId(p.id);setFn(p.fn);setLn(p.ln);setHcp(p.hcp||"");setPhoto(p.photo||null);setShowAdd(true);
  };

  const resetForm=()=>{
    setEditingId(null);setFn("");setLn("");setHcp("");setPhoto(null);setShowAdd(false);
  };

  const savePlayer=async()=>{
    if(!fn.trim()||!ln.trim())return;
    setSaving(true);
    const id=editingId||("p"+Date.now());
    const data={fn:fn.trim(),ln:ln.trim(),hcp:hcp||"",photo:photo||null};
    await setDoc(doc(db,"savedPlayers",id),data).catch(()=>{});
    if(editingId){setPlayers(prev=>prev.map(p=>p.id===id?{id,...data}:p));}
    else{setPlayers(prev=>[...prev,{id,...data}]);}
    setSaving(false);
    resetForm();
  };

  const deletePlayer=async(id)=>{
    await deleteDoc(doc(db,"savedPlayers",id)).catch(()=>{});
    setPlayers(prev=>prev.filter(p=>p.id!==id));
    setConfirmDelete(null);
  };

  const inp={background:T.isDark?"#060E1A":T.elevated,border:"1px solid "+T.border,borderRadius:"8px",color:T.cream,fontSize:"14px",padding:"10px 12px",outline:"none",boxSizing:"border-box",width:"100%",marginBottom:"10px"};

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Spieler"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>

        {!showAdd?(
          <>
            <button onClick={()=>setShowAdd(true)}
              style={{width:"100%",padding:"13px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:T.isDark?"#0A1628":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",marginBottom:"14px",fontFamily:"Arial,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
              <IconPlus size={16} color={T.isDark?"#0A1628":"white"}/> Spieler hinzufügen
            </button>

            {loading&&<div style={{textAlign:"center",padding:"20px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Lade...</div>}

            {!loading&&players.length===0&&(
              <div style={{textAlign:"center",padding:"40px 20px"}}>
                <div style={{fontSize:"40px",marginBottom:"12px"}}>👤</div>
                <div style={{color:T.gold,fontSize:"16px",fontFamily:"Georgia,serif",marginBottom:"8px"}}>Noch keine Spieler</div>
                <div style={{color:T.muted,fontSize:"13px",fontFamily:"Arial,sans-serif"}}>Füge Spieler hinzu um sie in Turnieren und Matches zu verwenden</div>
              </div>
            )}

            {players.map(p=>(
              <div key={p.id} style={{background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",padding:"12px 14px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"12px"}}>
                <div onClick={()=>startEdit(p)} style={{cursor:"pointer"}}>
                  <PlayerAvatar name={p.fn+" "+p.ln} size={44} color={T.blue} photo={p.photo}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"14px",fontWeight:"700",color:T.cream,fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                  <div style={{fontSize:"11px",color:T.muted,fontFamily:"Arial,sans-serif"}}>{p.hcp?`HCP ${p.hcp}`:"Kein HCP"}</div>
                </div>
                <div style={{display:"flex",gap:"6px"}}>
                  <button onClick={()=>startEdit(p)} style={{padding:"7px 12px",background:"transparent",border:"1px solid "+T.border,borderRadius:"6px",color:T.muted,fontSize:"11px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>✏️</button>
                  <button onClick={()=>setConfirmDelete(p)} style={{padding:"7px 10px",background:"transparent",border:"1px solid #E0525244",borderRadius:"6px",color:"#E05252",cursor:"pointer"}}>
                    <IconTrash size={14} color="#E05252"/>
                  </button>
                </div>
              </div>
            ))}
          </>
        ):(
          <div>
            <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,fontFamily:"Georgia,serif",marginBottom:"16px"}}>{editingId?"Spieler bearbeiten":"Neuer Spieler"}</div>

            {/* Photo upload */}
            <div style={{display:"flex",justifyContent:"center",marginBottom:"16px"}}>
              <div style={{position:"relative"}}>
                <PlayerAvatar name={fn&&ln?fn+" "+ln:"?"} size={80} color={T.blue} photo={photo}/>
                <label style={{position:"absolute",bottom:0,right:0,width:"28px",height:"28px",background:"linear-gradient(135deg,#C9A96E,#A07830)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0A1628" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <input type="file" accept="image/*" onChange={handlePhotoChange} style={{display:"none"}}/>
                </label>
              </div>
            </div>
            <div style={{fontSize:"10px",color:T.faint,textAlign:"center",marginBottom:"16px",fontFamily:"Arial,sans-serif"}}>Tippe auf das Kamera-Icon für Foto oder Mediathek</div>

            <Label T={T}>Vorname *</Label>
            <input style={inp} placeholder="Vorname" value={fn} onChange={e=>setFn(e.target.value)}/>
            <Label T={T}>Nachname *</Label>
            <input style={inp} placeholder="Nachname" value={ln} onChange={e=>setLn(e.target.value)}/>
            <Label T={T}>Handicap (optional)</Label>
            <input style={{...inp,marginBottom:"20px"}} inputMode="decimal" placeholder="z.B. 8.4" value={hcp} onChange={e=>setHcp(e.target.value)}/>

            <button onClick={savePlayer} disabled={!fn.trim()||!ln.trim()||saving}
              style={{width:"100%",padding:"13px",background:(!fn.trim()||!ln.trim())?"#162448":"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:T.isDark?"#0A1628":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:(!fn.trim()||!ln.trim())?"not-allowed":"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif",opacity:(!fn.trim()||!ln.trim())?0.5:1}}>
              {saving?"Speichere...":"Speichern"}
            </button>
            <button onClick={resetForm} style={{width:"100%",padding:"10px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>Abbrechen</button>
          </div>
        )}
      </div>

      {cropSrc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:400,padding:"20px"}}>
          <div style={{fontSize:"14px",fontWeight:"700",color:"#C9A96E",fontFamily:"Georgia,serif",marginBottom:"16px"}}>Foto zuschneiden</div>
          <div style={{position:"relative",width:"200px",height:"200px",borderRadius:"50%",overflow:"hidden",border:"3px solid #C9A96E",marginBottom:"16px"}}>
            <img src={cropSrc} style={{width:"100%",height:"100%",objectFit:"cover",transform:"scale("+cropScale+")",transformOrigin:"center"}} alt="crop"/>
          </div>
          <div style={{width:"100%",maxWidth:"280px",marginBottom:"8px"}}>
            <div style={{fontSize:"10px",color:"#6A8AAA",fontFamily:"Arial,sans-serif",marginBottom:"4px"}}>Zoom</div>
            <input type="range" min="1" max="3" step="0.05" value={cropScale} onChange={e=>setCropScale(Number(e.target.value))} style={{width:"100%",accentColor:"#C9A96E"}}/>
          </div>
          <div style={{display:"flex",gap:"10px",width:"100%",maxWidth:"280px"}}>
            <button onClick={cropAndSave} style={{flex:1,padding:"12px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:"#0A1628",fontSize:"13px",fontWeight:"900",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>Übernehmen ✓</button>
            <button onClick={()=>setCropSrc(null)} style={{flex:1,padding:"12px",background:"transparent",border:"1px solid #6A8AAA",borderRadius:"8px",color:"#6A8AAA",fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>Abbrechen</button>
          </div>
        </div>
      )}

      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={()=>setConfirmDelete(null)}>
          <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>🗑</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif",marginBottom:"6px"}}>{confirmDelete.fn} {confirmDelete.ln} löschen?</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"Arial,sans-serif"}}>Der Spieler wird aus dem Pool entfernt.</div>
            <button style={{width:"100%",padding:"11px",background:"#E05252",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}} onClick={()=>deletePlayer(confirmDelete.id)}>Ja, löschen</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={()=>setConfirmDelete(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}


function ActiveMatchesScreen({onBack, role, T, theme, onThemeChange}){
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmEnd, setConfirmEnd] = useState(null);

  const [joinCode,setJoinCode]=useState("");
  const [joinMatch,setJoinMatch]=useState(null);
  const [joining,setJoining]=useState(false);
  const [joinError,setJoinError]=useState("");

  const load = async() => {
    setLoading(true);
    const all = await loadActiveMatches().catch(()=>[]);
    setMatches(all);
    setLoading(false);
  };

  const handleJoin=async()=>{
    if(joinCode.length!==4){setJoinError("Bitte 4-stelligen Code eingeben");return;}
    setJoining(true);setJoinError("");
    const found=await loadMatchByCode(joinCode).catch(()=>null);
    setJoining(false);
    if(!found){setJoinError("Kein aktives Match mit diesem Code gefunden");return;}
    setJoinMatch(found);
  };

  useEffect(()=>{load();},[]);

  const endMatch = async(m) => {
    await archiveMatch(m.id, m).catch(()=>{});
    setMatches(prev=>prev.filter(x=>x.id!==m.id));
    setConfirmEnd(null);
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Aktive Matches"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.cardBg,border:"1px solid "+T.gold+"55",borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,fontFamily:"Georgia,serif",marginBottom:"10px"}}>Match beitreten</div>
          <div style={{display:"flex",gap:"8px"}}>
            <input value={joinCode} onChange={e=>setJoinCode(e.target.value.replace(/\D/g,"").slice(0,4))}
              placeholder="4-stelliger Code" inputMode="numeric"
              style={{flex:1,padding:"10px 12px",background:T.isDark?"#060E1A":T.elevated,border:"1px solid "+(joinError?"#E05252":T.border),borderRadius:"8px",color:T.cream,fontSize:"18px",letterSpacing:"6px",textAlign:"center",outline:"none",fontFamily:"monospace"}}/>
            <button onClick={handleJoin} disabled={joining||joinCode.length!==4}
              style={{padding:"10px 16px",background:joinCode.length===4?"linear-gradient(135deg,#C9A96E,#A07830)":T.elevated,border:"none",borderRadius:"8px",color:joinCode.length===4?(T.isDark?"#0A1628":"white"):T.muted,fontSize:"13px",fontWeight:"700",cursor:joinCode.length===4?"pointer":"not-allowed",fontFamily:"Arial,sans-serif"}}>
              {joining?"...":"→"}
            </button>
          </div>
          {joinError&&<div style={{fontSize:"11px",color:"#E05252",marginTop:"6px",fontFamily:"Arial,sans-serif"}}>{joinError}</div>}
        </div>

        {loading&&<div style={{textAlign:"center",padding:"30px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Lade...</div>}
        {!loading&&matches.length===0&&(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <div style={{fontSize:"40px",marginBottom:"12px"}}>🟢</div>
            <div style={{color:T.gold,fontSize:"16px",fontFamily:"Georgia,serif",marginBottom:"8px"}}>Keine aktiven Matches</div>
            <div style={{color:T.muted,fontSize:"13px",fontFamily:"Arial,sans-serif"}}>Starte ein Match um es hier zu sehen</div>
          </div>
        )}
        {matches.map(m=>(
          <div key={m.id} style={{background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",padding:"14px",marginBottom:"10px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
              <div>
                <div style={{fontSize:"14px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif"}}>{m.name}</div>
                <div style={{fontSize:"10px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>
                  {m.format==="ffa"?"⚡ Jeder gegen Jeden":"👥 Teams"} · {m.holes||18} Loch · {DEFAULT_COURSES[m.courseId]?DEFAULT_COURSES[m.courseId].shortName:m.courseId}
                </div>
                <div style={{fontSize:"10px",color:T.faint,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>
                  ID: {m.id.replace("QM_","")}
                </div>
              </div>
              <div style={{background:T.blue+"22",border:"1px solid "+T.blue+"55",borderRadius:"20px",padding:"2px 10px",fontSize:"10px",color:T.blue,fontFamily:"Arial,sans-serif"}}>AKTIV</div>
            </div>
            {m.format==="ffa"&&m.ffaPlayers&&(
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap",marginBottom:"8px"}}>
                {m.ffaPlayers.map((p,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:"4px",background:T.elevated,borderRadius:"20px",padding:"2px 8px",fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>
                    <PlayerAvatar name={p.fn+" "+p.ln} size={18} color={T.gold} photo={p.photo||null}/>
                    {p.fn} {p.ln}
                  </div>
                ))}
              </div>
            )}
            {role==="admin"&&(
              <button onClick={()=>setConfirmEnd(m)} style={{width:"100%",padding:"8px",background:"transparent",border:"1px solid #E05252",borderRadius:"6px",color:"#E05252",fontSize:"11px",cursor:"pointer",fontFamily:"Arial,sans-serif",fontWeight:"700"}}>
                🏁 Match beenden
              </button>
            )}
          </div>
        ))}
      </div>
      {joinMatch&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:200,padding:"0"}}>
          <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}}>
            <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
            <div style={{fontSize:"16px",fontWeight:"900",color:T.gold,fontFamily:"Georgia,serif",marginBottom:"6px"}}>{joinMatch.name}</div>
            <div style={{fontSize:"12px",color:T.muted,fontFamily:"Arial,sans-serif",marginBottom:"16px"}}>
              {joinMatch.format==="ffa"?"Jeder gegen Jeden":"Teams"} · {joinMatch.holes||18} Löcher · {DEFAULT_COURSES[joinMatch.courseId]?DEFAULT_COURSES[joinMatch.courseId].shortName:joinMatch.courseId}
            </div>
            {joinMatch.ffaPlayers&&<div style={{marginBottom:"12px"}}>
              {joinMatch.ffaPlayers.map((p,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 0",borderBottom:"1px solid "+T.border}}>
                  <PlayerAvatar name={p.fn+" "+p.ln} size={28} color={T.gold} photo={p.photo||null}/>
                  <div style={{fontSize:"12px",color:T.cream,fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                </div>
              ))}
            </div>}
            <div style={{fontSize:"11px",color:T.faint,fontFamily:"Arial,sans-serif",textAlign:"center",marginBottom:"14px"}}>Score-Eintragung über den Admin oder direkt im Match</div>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={()=>{setJoinMatch(null);setJoinCode("");}}>Schließen</button>
          </div>
        </div>
      )}

      {confirmEnd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:"20px"}} onClick={()=>setConfirmEnd(null)}>
          <div style={{background:T.surface,border:"1px solid "+T.border,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>🏁</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif",marginBottom:"6px"}}>"{confirmEnd.name}" beenden?</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px",fontFamily:"Arial,sans-serif"}}>Das Match wird ins Archiv verschoben.</div>
            <button style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"8px",color:"#0A1628",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px",fontFamily:"Arial,sans-serif"}} onClick={()=>endMatch(confirmEnd)}>Ja, beenden</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:"1px solid "+T.border,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",fontFamily:"Arial,sans-serif"}} onClick={()=>setConfirmEnd(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArchiveScreen({onBack, T, theme, onThemeChange}){
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    loadArchivedMatches().then(all=>{setMatches(all);setLoading(false);}).catch(()=>setLoading(false));
  },[]);

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Match Archiv"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.cardBg,border:"1px solid "+T.gold+"55",borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,fontFamily:"Georgia,serif",marginBottom:"10px"}}>Match beitreten</div>
          <div style={{display:"flex",gap:"8px"}}>
            <input value={joinCode} onChange={e=>setJoinCode(e.target.value.replace(/\D/g,"").slice(0,4))}
              placeholder="4-stelliger Code" inputMode="numeric"
              style={{flex:1,padding:"10px 12px",background:T.isDark?"#060E1A":T.elevated,border:"1px solid "+(joinError?"#E05252":T.border),borderRadius:"8px",color:T.cream,fontSize:"18px",letterSpacing:"6px",textAlign:"center",outline:"none",fontFamily:"monospace"}}/>
            <button onClick={handleJoin} disabled={joining||joinCode.length!==4}
              style={{padding:"10px 16px",background:joinCode.length===4?"linear-gradient(135deg,#C9A96E,#A07830)":T.elevated,border:"none",borderRadius:"8px",color:joinCode.length===4?(T.isDark?"#0A1628":"white"):T.muted,fontSize:"13px",fontWeight:"700",cursor:joinCode.length===4?"pointer":"not-allowed",fontFamily:"Arial,sans-serif"}}>
              {joining?"...":"→"}
            </button>
          </div>
          {joinError&&<div style={{fontSize:"11px",color:"#E05252",marginTop:"6px",fontFamily:"Arial,sans-serif"}}>{joinError}</div>}
        </div>

        {loading&&<div style={{textAlign:"center",padding:"30px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Lade...</div>}
        {!loading&&matches.length===0&&(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <div style={{fontSize:"40px",marginBottom:"12px"}}>📁</div>
            <div style={{color:T.gold,fontSize:"16px",fontFamily:"Georgia,serif",marginBottom:"8px"}}>Archiv ist leer</div>
            <div style={{color:T.muted,fontSize:"13px",fontFamily:"Arial,sans-serif"}}>Beendete Matches erscheinen hier</div>
          </div>
        )}
        {matches.map(m=>(
          <div key={m.id} style={{background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",padding:"14px",marginBottom:"10px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
              <div>
                <div style={{fontSize:"14px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif"}}>{m.name}</div>
                <div style={{fontSize:"10px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>
                  {m.format==="ffa"?"⚡ Jeder gegen Jeden":"👥 Teams"} · {m.holes||18} Loch
                </div>
              </div>
              <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif",textAlign:"right"}}>
                {m.archivedAt?new Date(m.archivedAt).toLocaleDateString("de-DE"):""}
              </div>
            </div>
            {m.format==="ffa"&&m.ffaPlayers&&(
              <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                {m.ffaPlayers.map((p,i)=>(
                  <div key={i} style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif",background:T.elevated,borderRadius:"20px",padding:"2px 8px"}}>{p.fn} {p.ln}</div>
                ))}
              </div>
            )}
            {m.format==="teams"&&(
              <div style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>
                {(m.t1Players||[]).map(p=>p.fn).join(" & ")} vs {(m.t2Players||[]).map(p=>p.fn).join(" & ")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


function HomeScreen({role, onTournament, onQuickMatch, onPlayers, onArchive, onActiveMatches, activeMatchCount, onLogout, T, theme, onThemeChange}){
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif",display:"flex",flexDirection:"column"}}>
      <div style={{background:T.headerBg,borderBottom:"1px solid "+T.gold+"44",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <button onClick={onLogout} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.15)",borderRadius:"6px",color:"rgba(255,255,255,0.5)",padding:"5px 9px",cursor:"pointer",fontSize:"11px",fontFamily:"Arial,sans-serif"}}>Logout</button>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <PinHighLogo size={22} color="#C9A96E"/>
          <span style={{fontFamily:"Georgia,serif",fontSize:"14px",fontWeight:"900",letterSpacing:"4px",color:"#C9A96E",textTransform:"uppercase"}}>PIN HIGH</span>
        </div>
        <ThemeToggle theme={theme} onChange={onThemeChange}/>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"20px"}}>
        <div style={{marginBottom:"6px",display:"flex",justifyContent:"center"}}>
          <PinHighLogo size={48} color={T.gold}/>
        </div>
        <div style={{fontFamily:"Georgia,serif",fontSize:"20px",fontWeight:"900",letterSpacing:"4px",color:T.gold,textTransform:"uppercase",marginBottom:"3px"}}>PIN HIGH</div>
        <div style={{display:"flex",alignItems:"center",gap:"10px",marginBottom:"28px"}}>
          <div style={{flex:1,height:"0.5px",background:"linear-gradient(90deg,transparent,"+T.gold+"44)"}}/>
          <div style={{fontFamily:"Arial,sans-serif",fontSize:"9px",letterSpacing:"3px",color:T.faint,textTransform:"uppercase"}}>Friends Tour · V{VERSION}</div>
          <div style={{flex:1,height:"0.5px",background:"linear-gradient(90deg,"+T.gold+"44,transparent)"}}/>
        </div>
        <div style={{width:"100%",maxWidth:"320px",display:"flex",flexDirection:"column",gap:"10px"}}>

          <button onClick={onActiveMatches}
            style={{width:"100%",padding:"16px 18px",background:activeMatchCount>0?"linear-gradient(135deg,#1E3560,#0F2040)":T.cardBg,border:"1px solid "+(activeMatchCount>0?T.blue:T.border),borderRadius:"12px",color:T.cream,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px",position:"relative"}}>
            <div style={{fontSize:"24px"}}>🟢</div>
            <div style={{flex:1}}>
              <div style={{fontFamily:"Georgia,serif",fontSize:"15px",fontWeight:"900",letterSpacing:"1px",color:activeMatchCount>0?T.blue:T.cream}}>Aktive Matches</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",color:T.muted,marginTop:"2px"}}>{activeMatchCount>0?activeMatchCount+" Match"+( activeMatchCount===1?"":"es")+" läuft":"Keine aktiven Matches"}</div>
            </div>
            {activeMatchCount>0&&<div style={{background:T.blue,color:"#0A1628",borderRadius:"50%",width:"24px",height:"24px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"12px",fontWeight:"900",fontFamily:"Arial,sans-serif"}}>{activeMatchCount}</div>}
          </button>

          <button onClick={onTournament}
            style={{width:"100%",padding:"16px 18px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"12px",color:T.isDark?"#0A1628":"white",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{fontSize:"24px"}}>➕</div>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:"15px",fontWeight:"900",letterSpacing:"1px",color:T.isDark?"#0A1628":"white"}}>Match oder Turnier erstellen</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",opacity:0.7,marginTop:"2px",color:T.isDark?"#0A1628":"white"}}>Einzel Match · Turnier · Teams</div>
            </div>
          </button>

          <button onClick={onPlayers}
            style={{width:"100%",padding:"16px 18px",background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",color:T.cream,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{fontSize:"24px"}}>👥</div>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:"15px",fontWeight:"900",letterSpacing:"1px"}}>Spieler verwalten</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",color:T.muted,marginTop:"2px"}}>Hinzufügen · Foto · Handicap</div>
            </div>
          </button>

          <button onClick={onArchive}
            style={{width:"100%",padding:"16px 18px",background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",color:T.cream,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{fontSize:"24px"}}>📁</div>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:"15px",fontWeight:"900",letterSpacing:"1px"}}>Match Archiv</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",color:T.muted,marginTop:"2px"}}>Abgeschlossene Matches & Turniere</div>
            </div>
          </button>

        </div>
        <div style={{marginTop:"20px"}}>
          <RoleBadge role={role} T={T}/>
        </div>
      </div>
    </div>
  );
}


function TournamentList({role,tournaments,activeTournamentId,onSelect,onNew,onQuickMatch,onActivate,onDelete,T,theme,onThemeChange,onLogout}){
  const isAdmin=role==="admin";
  const [confirmDelete,setConfirmDelete]=useState(null);
  const sorted=[...tournaments].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onLogout} subtitle="Turniere" showBack={true} rightSlot={<ThemeToggle theme={theme} onChange={onThemeChange}/>}/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
          <RoleBadge role={role} T={T}/>
          {isAdmin&&<button onClick={onNew} style={{display:"flex",alignItems:"center",gap:"6px",padding:"8px 14px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0A1628":"white",fontSize:"12px",fontWeight:"900",cursor:"pointer",letterSpacing:"1px",fontFamily:"Arial,sans-serif"}}><IconPlus size={13} color={T.isDark?"#0A1628":"white"}/> Neues Turnier</button>}
        </div>
        {sorted.length===0&&(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <PinHighLogo size={48} color={T.gold}/>
            <div style={{color:T.gold,fontSize:"16px",fontFamily:"Georgia,serif",marginBottom:"8px",marginTop:"12px"}}>Noch keine Turniere</div>
            <div style={{color:T.muted,fontSize:"13px",fontFamily:"Arial,sans-serif"}}>{isAdmin?"Erstelle dein erstes Turnier!":"Warte auf den Admin."}</div>
          </div>
        )}
        {sorted.map(t=>{
          const isActive=t.id===activeTournamentId;
          const stats=t.days?calcTournament(t.days):null;
          return(
            <div key={t.id} style={{background:T.cardBg,border:`2px solid ${isActive?T.gold:T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"10px",boxShadow:isActive?`0 0 0 1px ${T.gold}22`:"none"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                    <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif"}}>{t.tournamentName||"Turnier"}</div>
                    {isActive&&<div style={{fontSize:"9px",background:T.gold+"22",color:T.gold,border:`1px solid ${T.gold}55`,borderRadius:"20px",padding:"2px 8px",fontFamily:"Arial,sans-serif",letterSpacing:"1px"}}>AKTIV</div>}
                  </div>
                  <div style={{fontSize:"11px",color:T.muted,marginTop:"3px",fontFamily:"Arial,sans-serif"}}>{t.dateFrom&&t.dateTo?`${t.dateFrom} – ${t.dateTo}`:t.dateFrom||""}{t.t1Name&&t.t2Name?` · ${t.t1Name} vs ${t.t2Name}`:""}</div>
                </div>
                {stats&&<div style={{display:"flex",gap:"6px",alignItems:"center"}}><span style={{fontSize:"18px",fontWeight:"900",color:T.blue,fontFamily:"Georgia,serif"}}>{fmt(stats.t1Confirmed)}</span><span style={{fontSize:"11px",color:T.muted}}>:</span><span style={{fontSize:"18px",fontWeight:"900",color:T.red,fontFamily:"Georgia,serif"}}>{fmt(stats.t2Confirmed)}</span></div>}
              </div>
              <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                <button onClick={()=>onSelect(t)} style={{flex:1,padding:"8px",background:isActive?`linear-gradient(135deg,${T.gold},#A07830)`:"transparent",border:`1px solid ${isActive?T.gold:T.border}`,borderRadius:"6px",color:isActive?T.isDark?"#0A1628":"white":T.muted,fontSize:"11px",cursor:"pointer",fontFamily:"Arial,sans-serif",fontWeight:isActive?"700":"400"}}>{isActive?"⛳ Öffnen":"Ansehen"}</button>
                {isAdmin&&!isActive&&<button onClick={()=>onActivate(t.id)} style={{flex:1,padding:"8px",background:"transparent",border:`1px solid ${T.gold}55`,borderRadius:"6px",color:T.gold,fontSize:"11px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>Aktivieren</button>}
                {isAdmin&&<button onClick={()=>setConfirmDelete(t)} style={{padding:"8px 10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.faint,cursor:"pointer"}}><IconTrash size={13} color={T.faint}/></button>}
              </div>
            </div>
          );
        })}
      </div>
      {confirmDelete&&<ResetConfirm title={`"${confirmDelete.tournamentName}" löschen?`} message="Das Turnier und alle Scores werden permanent gelöscht." onConfirm={()=>{onDelete(confirmDelete.id);setConfirmDelete(null);}} onClose={()=>setConfirmDelete(null)} T={T}/>}
    </div>
  );
}

function SetupStep1({onNext,onBack,T,theme,onThemeChange}){
  const [name,setName]=useState("Pin High 2025"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[t1Name,setT1Name]=useState("Team Europa"),[t2Name,setT2Name]=useState("Team USA"),[mc,setMc]=useState(4);
  const ok=name.trim()&&t1Name.trim()&&t2Name.trim();
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Setup · 1/4"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <StepDots total={4} current={0}/>
        <Card T={T}><Label T={T}>Turniername</Label><Inp value={name} onChange={e=>setName(e.target.value)} placeholder="z.B. Pin High Sommer 2025" T={T}/><div style={{display:"flex",gap:"8px"}}><div style={{flex:1}}><Label T={T}>Datum von</Label><Inp type="date" value={from} onChange={e=>setFrom(e.target.value)} T={T}/></div><div style={{flex:1}}><Label T={T}>Datum bis</Label><Inp type="date" value={to} onChange={e=>setTo(e.target.value)} T={T}/></div></div></Card>
        <Card T={T}><div style={{fontSize:"10px",color:T.blue,letterSpacing:"2px",marginBottom:"6px",fontFamily:"Arial,sans-serif"}}>🔵 TEAM 1</div><Inp value={t1Name} onChange={e=>setT1Name(e.target.value)} placeholder="Team 1 Name" T={T}/><div style={{fontSize:"10px",color:T.red,letterSpacing:"2px",marginBottom:"6px",fontFamily:"Arial,sans-serif"}}>🔴 TEAM 2</div><Inp value={t2Name} onChange={e=>setT2Name(e.target.value)} placeholder="Team 2 Name" T={T}/></Card>
        <Card T={T}><Label T={T}>Matches pro Tag</Label><div style={{display:"flex",gap:"8px"}}>{[2,3,4].map(n=><button key={n} onClick={()=>setMc(n)} style={{flex:1,padding:"16px",borderRadius:"10px",border:`2px solid ${mc===n?T.gold:T.border}`,background:mc===n?T.gold+"22":T.elevated,color:mc===n?T.gold:T.muted,fontSize:"22px",fontWeight:"900",cursor:"pointer",fontFamily:"Georgia,serif"}}>{n}</button>)}</div><div style={{fontSize:"11px",color:T.faint,marginTop:"8px",textAlign:"center",fontFamily:"Arial,sans-serif"}}>{mc} Matches × 2 Runden × 2 Tage = <span style={{color:T.gold,fontWeight:"700"}}>{mc*4} Punkte</span></div></Card>
        <BtnGold onClick={()=>ok&&onNext({tournamentName:name,dateFrom:from?new Date(from).toLocaleDateString("de-DE"):null,dateTo:to?new Date(to).toLocaleDateString("de-DE"):null,t1Name,t2Name,matchCount:mc})} disabled={!ok} T={T}>Weiter → Spieler</BtnGold>
        <BtnGhost onClick={onBack} T={T}>Abbrechen</BtnGhost>
      </div>
    </div>
  );
}

function SetupStep2({playerPool,setPlayerPool,onNext,onBack,T,theme,onThemeChange}){
  const [players,setPlayers]=useState(playerPool||[
    {id:"p1",fn:"",ln:"",hcp:""},
    {id:"p2",fn:"",ln:"",hcp:""},
    {id:"p3",fn:"",ln:"",hcp:""},
    {id:"p4",fn:"",ln:"",hcp:""}
  ]);
  const [loadedFromDB,setLoadedFromDB]=useState(false);

  // Load saved players from Firebase on first mount if pool not yet set
  useEffect(()=>{
    if(playerPool&&playerPool.length>0){setLoadedFromDB(true);return;}
    const loadPlayers=async()=>{
      try{
        const snap=await getDocs(collection(db,"savedPlayers"));
        if(!snap.empty){
          const saved=snap.docs.map(d=>({id:d.id,...d.data()}));
          setPlayers(saved);
          setLoadedFromDB(true);
        }
      }catch(e){}
    };
    loadPlayers();
  },[]);

  const upd=(id,f,v)=>{
    const updated=players.map(x=>x.id===id?{...x,[f]:v}:x);
    setPlayers(updated);
    setPlayerPool(updated);
  };
  const add=()=>{
    const updated=[...players,{id:"p"+Date.now(),fn:"",ln:"",hcp:""}];
    setPlayers(updated);
    setPlayerPool(updated);
  };
  const rem=id=>{
    if(players.length<=2)return;
    const updated=players.filter(x=>x.id!==id);
    setPlayers(updated);
    setPlayerPool(updated);
  };

  const ok=players.length>=2&&players.every(p=>p.fn.trim()&&p.ln.trim()&&p.hcp!=="");
  const inp={background:T.isDark?"#060E1A":T.elevated,border:"1px solid "+T.border,borderRadius:"6px",color:T.cream,fontSize:"12px",padding:"7px 8px",outline:"none",boxSizing:"border-box",width:"100%"};

  const saveAndNext=async()=>{
    if(!ok)return;
    // Save players to Firebase for future tournaments (non-blocking)
    const savePromises=players.map(p=>
      setDoc(doc(db,"savedPlayers",p.id),{fn:p.fn,ln:p.ln,hcp:p.hcp}).catch(()=>{})
    );
    Promise.all(savePromises).catch(()=>{});
    setPlayerPool(players);
    onNext();
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Setup · 2/4"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <StepDots total={4} current={1}/>
        {loadedFromDB&&players.length>0&&(
          <div style={{background:T.elevated,border:"1px solid "+T.gold+"55",borderRadius:"8px",padding:"10px 12px",marginBottom:"12px",fontSize:"11px",color:T.gold,fontFamily:"Arial,sans-serif"}}>
            ✓ Spieler aus letztem Turnier geladen
          </div>
        )}
        <div style={{background:T.elevated,border:"1px solid "+T.border,borderRadius:"8px",padding:"10px 12px",marginBottom:"12px",fontSize:"11px",color:T.muted,fontFamily:"Arial,sans-serif"}}>
          Spieler werden gespeichert und beim nächsten Turnier vorausgefüllt
        </div>
        <Card T={T}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 56px 18px",gap:"4px",marginBottom:"8px"}}>
            {["Vorname","Nachname","HCP",""].map((h,i)=><div key={i} style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",fontFamily:"Arial,sans-serif"}}>{h}</div>)}
          </div>
          {players.map(p=>(
            <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 56px 18px",gap:"4px",marginBottom:"6px",alignItems:"center"}}>
              <input style={inp} placeholder="Vorname" value={p.fn} onChange={e=>upd(p.id,"fn",e.target.value)}/>
              <input style={inp} placeholder="Nachname" value={p.ln} onChange={e=>upd(p.id,"ln",e.target.value)}/>
              <input style={{...inp,textAlign:"center"}} inputMode="decimal" placeholder="0.0" value={p.hcp} onChange={e=>upd(p.id,"hcp",e.target.value)}/>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:players.length>2?"#E05252":T.faint}} onClick={()=>rem(p.id)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
            </div>
          ))}
          <button onClick={add} style={{width:"100%",padding:"8px",background:"transparent",border:"1px dashed "+T.gold+"55",borderRadius:"6px",color:T.gold,fontSize:"12px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>+ Spieler hinzufügen</button>
        </Card>
        <div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginBottom:"12px",fontFamily:"Arial,sans-serif"}}>{players.length} Spieler im Pool</div>
        <BtnGold onClick={saveAndNext} disabled={!ok} T={T}>Weiter → Teams</BtnGold>
        <BtnGhost onClick={onBack} T={T}>Zurück</BtnGhost>
      </div>
    </div>
  );
}


function SetupStep3({t1Name,t2Name,playerPool,team1,setTeam1,team2,setTeam2,captain1,setCaptain1,captain2,setCaptain2,onNext,onBack,T,theme,onThemeChange}){
  // Initialize pool: players not yet assigned to either team
  const usedIds=new Set([...team1.map(p=>p.id),...team2.map(p=>p.id)]);
  const [pool,setPool]=useState(()=>playerPool.filter(p=>!usedIds.has(p.id)));
  const [dragId,setDragId]=useState(null);
  const [dragFrom,setDragFrom]=useState(null);

  const move=(player,from,to)=>{
    if(from==="pool")setPool(arr=>arr.filter(p=>p.id!==player.id));
    else if(from==="t1"){setTeam1(arr=>arr.filter(p=>p.id!==player.id));if(captain1===player.id&&to!=="t1")setCaptain1(null);}
    else if(from==="t2"){setTeam2(arr=>arr.filter(p=>p.id!==player.id));if(captain2===player.id&&to!=="t2")setCaptain2(null);}
    if(to==="pool")setPool(arr=>[...arr,player]);
    else if(to==="t1")setTeam1(arr=>[...arr,player]);
    else if(to==="t2")setTeam2(arr=>[...arr,player]);
  };

  const onDrop=to=>{
    if(!dragId)return;
    let player=null;
    if(dragFrom==="pool")player=pool.find(p=>p.id===dragId);
    else if(dragFrom==="t1")player=team1.find(p=>p.id===dragId);
    else if(dragFrom==="t2")player=team2.find(p=>p.id===dragId);
    if(player&&dragFrom!==to)move(player,dragFrom,to);
    setDragId(null);setDragFrom(null);
  };

  const toggleCap=(id,team)=>{
    if(team==="t1")setCaptain1(c=>c===id?null:id);
    else setCaptain2(c=>c===id?null:id);
  };

  const a1=avgHcp(team1),a2=avgHcp(team2);
  const balanced=team1.length>0&&team2.length>0&&Math.abs(a1-a2)<=2;
  const allDone=pool.length===0&&team1.length>0&&team2.length>0;

  const Chip=({player,from,color})=>{
    const isCap=(from==="t1"&&captain1===player.id)||(from==="t2"&&captain2===player.id);
    return(
      <div draggable onDragStart={()=>{setDragId(player.id);setDragFrom(from);}} onDragEnd={()=>{setDragId(null);setDragFrom(null);}}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:isCap?T.gold+"18":(T.isDark?"#060E1A":T.elevated),border:"1px solid "+(isCap?T.gold+"66":T.border),borderRadius:"8px",padding:"7px 10px",marginBottom:"5px",cursor:"grab",userSelect:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:"7px"}}>
          <div style={{width:"28px",height:"28px",borderRadius:"50%",background:color+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><IconUser size={13} color={color}/></div>
          <div>
            <div style={{fontSize:"12px",color:T.cream,fontWeight:"600",display:"flex",alignItems:"center",gap:"5px",fontFamily:"Arial,sans-serif"}}>
              {player.fn} {player.ln}{isCap&&<CaptainBadge size={15}/>}
            </div>
            <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>HCP {player.hcp}</div>
          </div>
        </div>
        {(from==="t1"||from==="t2")&&(
          <button onClick={()=>toggleCap(player.id,from)} style={{background:isCap?T.gold+"22":"transparent",border:"1px solid "+(isCap?T.gold:T.border),borderRadius:"5px",padding:"3px 6px",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px",fontSize:"9px",color:isCap?T.gold:T.faint,fontFamily:"Arial,sans-serif"}}>
            <CaptainBadge size={12}/>{isCap?"":"C"}
          </button>
        )}
      </div>
    );
  };

  const Zone=({label,players,zone,color})=>(
    <div style={{flex:1}}>
      <div style={{fontSize:"10px",color,letterSpacing:"1px",marginBottom:"5px",textTransform:"uppercase",display:"flex",justifyContent:"space-between",fontFamily:"Arial,sans-serif"}}>
        <span>{label}</span>{players.length>0&&<span style={{color:T.faint}}>⌀ {avgHcp(players)}</span>}
      </div>
      <div onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop(zone)}
        style={{minHeight:"80px",border:"2px dashed "+T.border,borderRadius:"10px",padding:"7px",background:T.isDark?"#060E1A44":T.elevated}}>
        {players.length===0&&<div style={{fontSize:"10px",color:T.faint,textAlign:"center",padding:"12px 0",fontFamily:"Arial,sans-serif"}}>Hier ablegen</div>}
        {players.map(p=><Chip key={p.id} player={p} from={zone} color={color}/>)}
      </div>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Setup · 3/4"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <StepDots total={4} current={2}/>
        {(team1.length>0||team2.length>0)&&(
          <div style={{background:balanced?T.elevated:"#3D1A1A22",border:"1px solid "+(balanced?T.border:"#E0525244"),borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
            <span style={{fontSize:"16px"}}>{balanced?"⚖️":"⚠️"}</span>
            <div>
              <div style={{fontSize:"12px",fontWeight:"700",color:balanced?T.muted:"#E05252",fontFamily:"Arial,sans-serif"}}>{balanced?"Teams ausgeglichen":"Unausgeglichen"}</div>
              <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{t1Name}: ⌀ {a1} · {t2Name}: ⌀ {a2} · Diff: {Math.abs(a1-a2).toFixed(1)}</div>
            </div>
          </div>
        )}
        {pool.length>0&&(
          <div style={{marginBottom:"12px"}}>
            <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",marginBottom:"6px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>Pool ({pool.length})</div>
            <div onDragOver={e=>e.preventDefault()} onDrop={()=>onDrop("pool")}
              style={{background:T.elevated,border:"2px dashed "+T.gold+"44",borderRadius:"10px",padding:"8px"}}>
              {pool.map(p=><Chip key={p.id} player={p} from="pool" color={T.gold}/>)}
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:"10px",marginBottom:"12px"}}>
          <Zone label={"🔵 "+t1Name} players={team1} zone="t1" color={T.blue}/>
          <Zone label={"🔴 "+t2Name} players={team2} zone="t2" color={T.red}/>
        </div>
        <div style={{fontSize:"10px",color:T.faint,textAlign:"center",marginBottom:"12px",fontFamily:"Arial,sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:"5px"}}>
          Tippe auf <CaptainBadge size={13}/> um Captain zu ernennen
        </div>
        <BtnGold onClick={()=>{if(allDone)onNext();}} disabled={!allDone} T={T}>Weiter → Matches</BtnGold>
        <BtnGhost onClick={onBack} T={T}>Zurück</BtnGhost>
      </div>
    </div>
  );
}


function SetupStep4({t1Name,t2Name,matchCount,t1Players,t2Players,captain1,captain2,onStart,onBack,T,theme,onThemeChange}){
  const [saving,setSaving]=useState(false);
  const [activeDay,setActiveDay]=useState(0);
  const [selectedPlayer,setSelectedPlayer]=useState(null); // {player, team} - tap state
  const [customCourses,setCustomCourses]=useState([]);
  const [showNewCourse,setShowNewCourse]=useState(false);
  const [ncName,setNcName]=useState("");
  const [ncLoc,setNcLoc]=useState("");
  const [ncPar,setNcPar]=useState(Array(18).fill(4));
  const [course1,setCourse1]=useState("riedhof");
  const [course2,setCourse2]=useState("bergkramerhof");

  const allCourses=Object.assign({},DEFAULT_COURSES);
  customCourses.forEach(c=>{allCourses[c.id]=c;});

  const mkMatch=(id)=>({id,name:"Match "+id,pin:"MATCH"+id,mode:"scramble",t1Players:[],t2Players:[]});
  const [day1,setDay1]=useState(()=>Array.from({length:matchCount},(_,i)=>mkMatch(i+1)));
  const [day2,setDay2]=useState(()=>Array.from({length:matchCount},(_,i)=>mkMatch(i+1+matchCount)));

  const matches=activeDay===0?day1:day2;
  const setMatches=activeDay===0?setDay1:setDay2;

  const addMatch=()=>setMatches(prev=>{
    const newId=prev.length>0?Math.max(...prev.map(m=>m.id))+1:1;
    return [...prev,mkMatch(newId)];
  });
  const removeMatch=(id)=>setMatches(prev=>prev.filter(m=>m.id!==id));

  const usedT1=new Set(matches.flatMap(m=>m.t1Players.map(p=>p.id)));
  const usedT2=new Set(matches.flatMap(m=>m.t2Players.map(p=>p.id)));

  // Tap-to-assign: tap player -> select -> tap slot -> assign
  const handlePlayerTap=(player,team)=>{
    if(selectedPlayer&&selectedPlayer.player.id===player.id){
      setSelectedPlayer(null); // deselect
    } else {
      setSelectedPlayer({player,team});
    }
  };

  const handleSlotTap=(matchIdx,team)=>{
    if(!selectedPlayer)return;
    if(selectedPlayer.team!==team){setSelectedPlayer(null);return;}
    const k=team==="t1"?"t1Players":"t2Players";
    setMatches(prev=>prev.map((m,i)=>{
      if(i!==matchIdx)return m;
      const modeInfo=GAME_MODES[m.mode];
      const isPairs=modeInfo?modeInfo.pairs!==false:true;
      const limit=isPairs?2:1;
      if(m[k].length>=limit||m[k].find(p=>p.id===selectedPlayer.player.id))return m;
      const copy=Object.assign({},m);
      copy[k]=m[k].concat([selectedPlayer.player]);
      return copy;
    }));
    setSelectedPlayer(null);
  };

  const removeFromMatch=(player,team,mi)=>{
    setMatches(prev=>prev.map((m,idx)=>{
      if(idx!==mi)return m;
      const k=team==="t1"?"t1Players":"t2Players";
      const copy=Object.assign({},m);
      copy[k]=m[k].filter(p=>p.id!==player.id);
      return copy;
    }));
  };

  const setMode=(mi,mode)=>{
    setMatches(prev=>prev.map((m,idx)=>{
      if(idx!==mi)return m;
      const modeInfo=GAME_MODES[mode];
      const isPairs=modeInfo?modeInfo.pairs!==false:true;
      const t1p=isPairs?m.t1Players:m.t1Players.slice(0,1);
      const t2p=isPairs?m.t2Players:m.t2Players.slice(0,1);
      return Object.assign({},m,{mode,t1Players:t1p,t2Players:t2p});
    }));
  };

  const checkDay=(dm)=>dm.every(m=>{
    const modeInfo=GAME_MODES[m.mode];
    const need=(modeInfo&&modeInfo.pairs===false)?1:2;
    return m.t1Players.length>=need&&m.t2Players.length>=need;
  });
  const bothFilled=checkDay(day1)&&checkDay(day2);

  const availT1=t1Players.filter(p=>!usedT1.has(p.id));
  const availT2=t2Players.filter(p=>!usedT2.has(p.id));

  const inp={background:T.isDark?"#060E1A":T.elevated,border:"1px solid "+T.border,borderRadius:"6px",color:T.cream,fontSize:"12px",padding:"7px 8px",outline:"none",boxSizing:"border-box",width:"100%",marginBottom:"6px"};

  const Pill=({player,team,color,onRemove})=>(
    <div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:"1px solid "+color+"55",borderRadius:"20px",padding:"2px 6px",fontSize:"11px",color,fontFamily:"Arial,sans-serif",marginBottom:"3px"}}>
      <PlayerAvatar name={player.fn+" "+player.ln} size={18} color={color}/>
      {player.fn} {player.ln[0]}.
      {((team==="t1"&&captain1===player.id)||(team==="t2"&&captain2===player.id))&&<CaptainBadge size={11}/>}
      <span style={{cursor:"pointer",opacity:0.7,marginLeft:"2px"}} onClick={onRemove}>×</span>
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack} subtitle="Setup · 4/4"/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <StepDots total={4} current={3}/>

        <div style={{display:"flex",marginBottom:"12px",borderRadius:"8px",overflow:"hidden",border:"1px solid "+T.border}}>
          {["Tag 1","Tag 2"].map((l,i)=>(
            <button key={i} onClick={()=>setActiveDay(i)} style={{flex:1,padding:"10px",background:activeDay===i?T.elevated:(T.isDark?"#060E1A":T.bg),border:"none",borderLeft:i>0?"1px solid "+T.border:"none",color:activeDay===i?T.gold:T.muted,cursor:"pointer",fontSize:"11px",letterSpacing:"1px",textTransform:"uppercase",fontWeight:activeDay===i?"700":"400",fontFamily:"Arial,sans-serif"}}>{l}</button>
          ))}
        </div>

        <Card T={T}>
          <Label T={T}>{"Golfplatz – "+(activeDay===0?"Tag 1":"Tag 2")}</Label>
          {Object.values(allCourses).map(c=>{
            const selected=(activeDay===0?course1:course2)===c.id;
            return(
              <button key={c.id} onClick={()=>{if(activeDay===0)setCourse1(c.id);else setCourse2(c.id);}}
                style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:selected?T.gold+"18":(T.isDark?"#060E1A":T.elevated),border:"1px solid "+(selected?T.gold:T.border),borderRadius:"8px",marginBottom:"6px",cursor:"pointer",width:"100%",textAlign:"left"}}>
                <div style={{width:"32px",height:"32px",borderRadius:"50%",background:selected?T.gold+"33":T.elevated,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:"14px"}}>⛳</div>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"700",color:T.cream,fontFamily:"Arial,sans-serif"}}>{c.name}</div>
                  <div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{c.location} · Par {c.par.reduce((a,b)=>a+b,0)}</div>
                </div>
              </button>
            );
          })}
          {!showNewCourse?(
            <button onClick={()=>setShowNewCourse(true)} style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 12px",background:"transparent",border:"1px dashed "+T.gold+"44",borderRadius:"8px",cursor:"pointer",width:"100%",color:T.gold,fontSize:"12px",fontFamily:"Arial,sans-serif"}}>
              <IconPlus size={13} color={T.gold}/> Neuen Platz hinzufügen
            </button>
          ):(
            <div style={{background:T.isDark?"#060E1A":T.elevated,borderRadius:"8px",padding:"10px",border:"1px solid "+T.border}}>
              <input style={inp} placeholder="Platzname" value={ncName} onChange={e=>setNcName(e.target.value)}/>
              <input style={inp} placeholder="Ort" value={ncLoc} onChange={e=>setNcLoc(e.target.value)}/>
              <div style={{fontSize:"10px",color:T.muted,marginBottom:"6px",fontFamily:"Arial,sans-serif"}}>Par pro Loch</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:"6px"}}>
                {ncPar.map((p,i)=>(
                  <div key={i} style={{textAlign:"center"}}>
                    <div style={{fontSize:"8px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{i+1}</div>
                    <input type="number" min="3" max="5" value={p} onChange={e=>{const np=[...ncPar];np[i]=parseInt(e.target.value)||4;setNcPar(np);}} style={{width:"100%",background:T.surface,border:"1px solid "+T.border,borderRadius:"4px",color:T.cream,fontSize:"11px",textAlign:"center",padding:"3px 0",outline:"none"}}/>
                  </div>
                ))}
              </div>
              <div style={{display:"flex",gap:"6px"}}>
                <button onClick={()=>{if(!ncName.trim())return;const id="c"+Date.now();const c={id,name:ncName,shortName:ncName,location:ncLoc,par:ncPar};setCustomCourses(prev=>[...prev,c]);setShowNewCourse(false);setNcName("");setNcLoc("");setNcPar(Array(18).fill(4));}} style={{flex:1,padding:"8px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"6px",color:T.isDark?"#0A1628":"white",fontSize:"12px",fontWeight:"700",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>Speichern</button>
                <button onClick={()=>setShowNewCourse(false)} style={{padding:"8px 12px",background:"transparent",border:"1px solid "+T.border,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer"}}>Abbrechen</button>
              </div>
            </div>
          )}
        </Card>

        {/* Tap-to-assign instruction */}
        {selectedPlayer?(
          <div style={{background:T.gold+"22",border:"1px solid "+T.gold,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
            <PlayerAvatar name={selectedPlayer.player.fn+" "+selectedPlayer.player.ln} size={28} color={selectedPlayer.team==="t1"?T.blue:T.red}/>
            <div>
              <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,fontFamily:"Arial,sans-serif"}}>{selectedPlayer.player.fn} {selectedPlayer.player.ln} ausgewählt</div>
              <div style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Tippe einen freien Slot unten um zuzuordnen</div>
            </div>
            <button onClick={()=>setSelectedPlayer(null)} style={{marginLeft:"auto",background:"transparent",border:"none",color:T.muted,fontSize:"18px",cursor:"pointer"}}>×</button>
          </div>
        ):(
          <div style={{background:T.elevated,border:"1px solid "+T.border,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",fontSize:"11px",color:T.muted,fontFamily:"Arial,sans-serif",display:"flex",alignItems:"center",gap:"8px"}}>
            <span style={{fontSize:"16px"}}>👆</span>
            <span>Spieler antippen → dann Match-Slot antippen</span>
          </div>
        )}

        {/* Available players - tap to select */}
        <div style={{display:"flex",gap:"8px",marginBottom:"12px"}}>
          {[[availT1,t1Name,T.blue,"t1"],[availT2,t2Name,T.red,"t2"]].map(([avail,name,color,team])=>(
            <div key={team} style={{flex:1}}>
              <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"5px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>{name} ({avail.length})</div>
              <div style={{background:T.isDark?"#060E1A44":T.elevated,border:"1px solid "+T.border,borderRadius:"8px",padding:"5px",minHeight:"36px"}}>
                {avail.length===0
                  ?<div style={{fontSize:"10px",color:T.faint,textAlign:"center",padding:"6px 0",fontFamily:"Arial,sans-serif"}}>Alle zugeteilt ✓</div>
                  :avail.map(p=>{
                    const isSelected=selectedPlayer&&selectedPlayer.player.id===p.id;
                    return(
                      <div key={p.id} onClick={()=>handlePlayerTap(p,team)}
                        style={{display:"flex",alignItems:"center",gap:"6px",padding:"5px 7px",marginBottom:"3px",borderRadius:"6px",background:isSelected?color+"22":"transparent",border:"1px solid "+(isSelected?color:T.border),cursor:"pointer",transition:"all 0.15s"}}>
                        <PlayerAvatar name={p.fn+" "+p.ln} size={24} color={color}/>
                        <div>
                          <div style={{fontSize:"11px",color:isSelected?color:T.cream,fontWeight:isSelected?"700":"400",fontFamily:"Arial,sans-serif"}}>{p.fn} {p.ln}</div>
                          <div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>HCP {p.hcp}</div>
                        </div>
                        {isSelected&&<div style={{marginLeft:"auto",fontSize:"12px",color}}>✓</div>}
                      </div>
                    );
                  })
                }
              </div>
            </div>
          ))}
        </div>

        {/* Match slots */}
        {matches.map((m,mi)=>{
          const modeInfo=GAME_MODES[m.mode||"scramble"];
          const isPairs=modeInfo?modeInfo.pairs!==false:true;
          const limit=isPairs?2:1;
          return(
            <Card key={m.id} T={T}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,fontFamily:"Georgia,serif"}}>{m.name}</div>
                <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                  <div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{m.pin}</div>
                  <button onClick={()=>removeMatch(m.id)} style={{width:"22px",height:"22px",borderRadius:"50%",background:"#E0525222",border:"1px solid #E0525255",color:"#E05252",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px"}}>×</button>
                </div>
              </div>
              <div style={{marginBottom:"8px"}}>
                <div style={{fontSize:"9px",color:T.muted,letterSpacing:"1px",marginBottom:"4px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>Spielmodus</div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                  {Object.entries(GAME_MODES).map(([k,v])=>(
                    <button key={k} onClick={()=>setMode(mi,k)} style={{padding:"4px 8px",borderRadius:"6px",border:"1px solid "+(m.mode===k?T.gold:T.border),background:m.mode===k?T.gold+"22":T.surface,color:m.mode===k?T.gold:T.muted,fontSize:"10px",cursor:"pointer",fontFamily:"Arial,sans-serif"}}>
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:"8px"}}>
                {[[m.t1Players,T.blue,t1Name,"t1"],[m.t2Players,T.red,t2Name,"t2"]].map(([players,color,teamName,teamKey])=>{
                  const isTargetable=selectedPlayer&&selectedPlayer.team===teamKey&&players.length<limit;
                  return(
                    <div key={teamKey} style={{flex:1}}>
                      <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"4px",fontFamily:"Arial,sans-serif"}}>{teamName}</div>
                      <div onClick={()=>handleSlotTap(mi,teamKey)}
                        style={{minHeight:"48px",background:isTargetable?color+"18":(T.isDark?"#060E1A":T.elevated),border:"2px "+(isTargetable?"solid":"dashed")+" "+(isTargetable?color:T.border),borderRadius:"8px",padding:"6px",cursor:isTargetable?"pointer":"default",transition:"all 0.15s"}}>
                        {players.length===0&&<div style={{fontSize:"10px",color:isTargetable?color:T.faint,textAlign:"center",padding:"6px 0",fontFamily:"Arial,sans-serif"}}>{isTargetable?"Hier tippen ✓":"Leer ("+limit+")"}</div>}
                        <div style={{display:"flex",flexWrap:"wrap",gap:"3px"}}>
                          {players.map(p=><Pill key={p.id} player={p} team={teamKey} color={color} onRemove={e=>{e.stopPropagation();removeFromMatch(p,teamKey,mi);}}/>)}
                        </div>
                        {players.length>0&&players.length<limit&&<div style={{fontSize:"9px",color:isTargetable?color:T.faint,marginTop:"3px",fontFamily:"Arial,sans-serif"}}>{isTargetable?"Hier tippen →":"+1 weiterer"}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}

        <button onClick={addMatch} style={{width:"100%",padding:"10px",background:"transparent",border:"1px dashed "+T.gold+"55",borderRadius:"8px",color:T.gold,fontSize:"12px",cursor:"pointer",fontFamily:"Arial,sans-serif",marginBottom:"12px",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
          <IconPlus size={13} color={T.gold}/> Match hinzufügen
        </button>

        <BtnGold onClick={async()=>{
          if(!bothFilled)return;
          setSaving(true);
          const buildM=m=>{
            const hcp1=m.t1Players.length>=2?calcTeamHcp(parseFloat(m.t1Players[0].hcp),parseFloat(m.t1Players[1].hcp)):(m.t1Players[0]?parseFloat(m.t1Players[0].hcp):null);
            const hcp2=m.t2Players.length>=2?calcTeamHcp(parseFloat(m.t2Players[0].hcp),parseFloat(m.t2Players[1].hcp)):(m.t2Players[0]?parseFloat(m.t2Players[0].hcp):null);
            return{id:m.id,name:m.name,pin:m.pin,mode:m.mode,t1Pair:m.t1Players.map(p=>p.fn+" "+p.ln),t2Pair:m.t2Players.map(p=>p.fn+" "+p.ln),captain1:m.t1Players.some(p=>p.id===captain1),captain2:m.t2Players.some(p=>p.id===captain2),teamHcp1:hcp1,teamHcp2:hcp2,scores:emptyScores(),locked:true};
          };
          onStart({course1:allCourses[course1],course2:allCourses[course2],day1Matches:day1.map(buildM),day2Matches:day2.map(buildM)});
        }} disabled={!bothFilled||saving} T={T}>{saving?"Speichere...":"Turnier starten 🏌️"}</BtnGold>
        <BtnGhost onClick={onBack} T={T}>Zurück</BtnGhost>
      </div>
    </div>
  );
}


function AdminSetup({onStart,onBack,T,theme,onThemeChange}){
  const [step,setStep]=useState(1);
  const [tournamentName,setTournamentName]=useState("Pin High 2025");
  const [dateFrom,setDateFrom]=useState("");
  const [dateTo,setDateTo]=useState("");
  const [t1Name,setT1Name]=useState("Team Europa");
  const [t2Name,setT2Name]=useState("Team USA");
  const [matchCount,setMatchCount]=useState(4);
  const [playerPool,setPlayerPool]=useState(null);
  const [team1,setTeam1]=useState([]);
  const [team2,setTeam2]=useState([]);
  const [captain1,setCaptain1]=useState(null);
  const [captain2,setCaptain2]=useState(null);

  if(step===1)return<SetupStep1
    tournamentName={tournamentName} setTournamentName={setTournamentName}
    dateFrom={dateFrom} setDateFrom={setDateFrom}
    dateTo={dateTo} setDateTo={setDateTo}
    t1Name={t1Name} setT1Name={setT1Name}
    t2Name={t2Name} setT2Name={setT2Name}
    matchCount={matchCount} setMatchCount={setMatchCount}
    onNext={()=>setStep(2)} onBack={onBack} T={T} theme={theme} onThemeChange={onThemeChange}/>;
  if(step===2)return<SetupStep2
    playerPool={playerPool} setPlayerPool={setPlayerPool}
    onNext={()=>setStep(3)} onBack={()=>setStep(1)} T={T} theme={theme} onThemeChange={onThemeChange}/>;
  if(step===3)return<SetupStep3
    t1Name={t1Name} t2Name={t2Name} playerPool={playerPool||[]}
    team1={team1} setTeam1={setTeam1}
    team2={team2} setTeam2={setTeam2}
    captain1={captain1} setCaptain1={setCaptain1}
    captain2={captain2} setCaptain2={setCaptain2}
    onNext={()=>setStep(4)} onBack={()=>setStep(2)} T={T} theme={theme} onThemeChange={onThemeChange}/>;
  return<SetupStep4
    t1Name={t1Name} t2Name={t2Name} matchCount={matchCount}
    t1Players={team1} t2Players={team2}
    captain1={captain1} captain2={captain2}
    onStart={cfg=>onStart({
      tournamentName,
      dateFrom:dateFrom?new Date(dateFrom).toLocaleDateString("de-DE"):null,
      dateTo:dateTo?new Date(dateTo).toLocaleDateString("de-DE"):null,
      t1Name,t2Name,...cfg
    })}
    onBack={()=>setStep(3)} T={T} theme={theme} onThemeChange={onThemeChange}/>;
}


function ScoreModal({match,holeIndex,t1Name,t2Name,existing,par,onSave,onClose,T}){
  const [t1,setT1]=useState(existing?.team1??""),[t2,setT2]=useState(existing?.team2??"");
  const hp=par[holeIndex];const mode=GAME_MODES[match.mode||"scramble"];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:"900",color:T.gold,textTransform:"uppercase",letterSpacing:"1px",fontFamily:"Georgia,serif"}}>Loch {holeIndex+1} · {match.name}</div>
            <div style={{fontSize:"11px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{holeIndex<9?"Runde 1":"Runde 2"} · {mode?.icon} {mode?.label}</div>
          </div>
          <div style={{textAlign:"center",background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"6px 12px"}}>
            <div style={{fontSize:"9px",color:T.muted,fontFamily:"Arial,sans-serif"}}>PAR</div>
            <div style={{fontSize:"22px",fontWeight:"900",color:T.gold,fontFamily:"Georgia,serif",lineHeight:1}}>{hp}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"12px",marginBottom:"16px"}}>
          {[{name:t1Name,val:t1,set:setT1,color:T.blue},{name:t2Name,val:t2,set:setT2,color:T.red}].map((item,i)=>(
            <div key={i} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:"11px",color:item.color,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"6px",fontFamily:"Arial,sans-serif"}}>{item.name}</div>
              <input type="number" min="1" max="12"
                style={{width:"100%",fontSize:"36px",fontWeight:"900",background:T.isDark?"#060E1A":T.elevated,border:`2px solid ${T.border}`,borderRadius:"8px",color:T.cream,textAlign:"center",padding:"8px 0",outline:"none",boxSizing:"border-box",fontFamily:"Georgia,serif"}}
                value={item.val} onChange={e=>item.set(e.target.value)} autoFocus={i===0}/>
            </div>
          ))}
        </div>
        <BtnGold onClick={()=>{if(t1!==""&&t2!=="")onSave(Number(t1),Number(t2));}} T={T}>Speichern</BtnGold>
        <BtnGhost onClick={onClose} T={T}>Abbrechen</BtnGhost>
      </div>
    </div>
  );
}

function ScoreSymbol({score, par, color, size}){
  if(score===null||score===undefined)return null;
  const diff=score-par;
  const s=size||16;
  const num=<span style={{fontSize:(s*0.75)+"px",fontWeight:"900",color,fontFamily:"Arial,sans-serif",lineHeight:1}}>{score}</span>;
  if(diff<=-2)return(
    <div style={{width:s+"px",height:s+"px",borderRadius:"50%",border:"1.5px solid "+color,display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
      <div style={{position:"absolute",inset:"-3px",borderRadius:"50%",border:"1px solid "+color}}/>
      {num}
    </div>
  );
  if(diff===-1)return(
    <div style={{width:s+"px",height:s+"px",borderRadius:"50%",border:"1.5px solid "+color,display:"flex",alignItems:"center",justifyContent:"center"}}>{num}</div>
  );
  if(diff===0)return(
    <div style={{width:s+"px",height:s+"px",display:"flex",alignItems:"center",justifyContent:"center"}}>{num}</div>
  );
  if(diff===1)return(
    <div style={{width:s+"px",height:s+"px",border:"1.5px solid "+color,borderRadius:"2px",display:"flex",alignItems:"center",justifyContent:"center"}}>{num}</div>
  );
  if(diff===2)return(
    <div style={{width:s+"px",height:s+"px",border:"1.5px solid "+color,borderRadius:"2px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative"}}>
      <div style={{position:"absolute",inset:"-4px",border:"1px solid "+color,borderRadius:"3px"}}/>
      {num}
    </div>
  );
  return(
    <div style={{width:s+"px",height:s+"px",border:"1.5px solid "+color,borderRadius:"2px",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",background:color+"33"}}>
      <div style={{position:"absolute",inset:"-4px",border:"1px solid "+color,borderRadius:"3px"}}/>
      {num}
    </div>
  );
}

function NineHoleGrid({scores,pars,startHole,matchId,onHoleClick,canEdit,T,roundDecidedAt}){
  // roundDecidedAt: hole index (0-8 within round) where match was decided, or -1
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px"}}>
      {scores.slice(startHole,startHole+9).map((s,i)=>{
        const hn=startHole+i;
        const p=pars[hn];
        const played=s.team1!==null&&s.team2!==null;
        const winner=played?(s.team1<s.team2?"t1":s.team2<s.team1?"t2":"tie"):null;

        // Hole is after match decision point
        const afterDecision = roundDecidedAt!=null && roundDecidedAt>=0 && i>roundDecidedAt;

        // Sequential lock: can only play if previous hole is filled
        // (except hole 0 which is always playable, and editing already played holes)
        const prevPlayed = i===0 || (scores[startHole+i-1].team1!==null && scores[startHole+i-1].team2!==null);
        const isPlayable = canEdit && prevPlayed;

        const bg = !played
          ? (T.isDark?"#0F1E38":"#EEE8D8")
          : afterDecision
            ? (winner==="t1"?T.blue+"11":winner==="t2"?T.red+"11":T.elevated)
            : (winner==="t1"?T.blue+"22":winner==="t2"?T.red+"22":T.elevated);

        const col = !played
          ? (T.isDark?"#6A8AAA":"#8A7A60")
          : afterDecision
            ? (winner==="t1"?T.blue+"88":winner==="t2"?T.red+"88":T.faint)
            : (winner==="t1"?T.blue:winner==="t2"?T.red:T.muted);

        const bdr = !played
          ? "1px solid "+(T.isDark?"#1E3560":"#CCC5B0")
          : "none";

        const opacity = afterDecision ? 0.5 : (!played&&!isPlayable ? 0.4 : 1);
        const cursor = played ? "pointer" : (isPlayable ? "pointer" : "not-allowed");

        return(
          <div key={i} style={{borderRadius:"4px",cursor,background:bg,border:bdr,userSelect:"none",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            padding:"3px 1px",minHeight:"44px",opacity,transition:"opacity 0.2s",
            position:"relative"}}
            onClick={()=>{
              if(played){onHoleClick(matchId,hn);return;} // always allow editing played
              if(isPlayable)onHoleClick(matchId,hn);
            }}>
            {/* Top: hole number left, par right */}
            <div style={{width:"100%",display:"flex",justifyContent:"space-between",padding:"0 3px",marginBottom:"1px"}}>
              <span style={{fontSize:"8px",fontWeight:"700",color:col,fontFamily:"Arial,sans-serif"}}>{hn+1}</span>
              <span style={{fontSize:"8px",color:T.isDark?"#2A4060":"#AAA090",fontFamily:"Arial,sans-serif"}}>P{p}</span>
            </div>
            {/* Center: score symbols or dash */}
            {!played
              ? <span style={{fontSize:"9px",color:T.isDark?"#2A4060":"#CCC0B0",fontFamily:"Arial,sans-serif"}}>—</span>
              : <div style={{display:"flex",gap:"1px",alignItems:"center"}}>
                  <ScoreSymbol score={s.team1} par={p} color={T.blue} size={14}/>
                  <span style={{fontSize:"7px",color:T.muted}}>:</span>
                  <ScoreSymbol score={s.team2} par={p} color={T.red} size={14}/>
                </div>
            }
            {/* Lock icon for unplayable holes */}
            {!played&&!isPlayable&&canEdit&&(
              <span style={{fontSize:"7px",color:T.faint,position:"absolute",bottom:"2px"}}>🔒</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MatchCard({match, pars, t1Name, t2Name, canEdit, isAdmin, onHoleClick, onReset, onUnlock, onLock, T}){
  const [showReset,setShowReset]=useState(false);
  const r1=calcRoundStatus(match.scores,pars,0,9);
  const r2=calcRoundStatus(match.scores,pars,9,18);
  const modeInfo=GAME_MODES[match.mode||"scramble"];

  const RoundStatus=({rs,label})=>{
    const pts=getPoints(rs);
    const leading=rs.diff>0?"t1":rs.diff<0?"t2":null;
    const color=rs.diff>0?T.blue:rs.diff<0?T.red:T.muted;
    const rPar=pars.slice(label==="R1"?0:9,label==="R1"?9:18).reduce((a,b)=>a+b,0);
    const decidedColor=rs.diff>0?T.blue:T.red;
    return(
      <div style={{flex:1,background:rs.decided?(decidedColor+"11"):(T.isDark?"#060E1A":T.elevated),borderRadius:"6px",padding:"6px 8px",textAlign:"center",border:"1px solid "+(rs.decided?decidedColor+"44":T.border)}}>
        <div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{label} · Par {rPar}</div>
        <div style={{fontSize:"16px",fontWeight:"900",color:rs.decided?decidedColor:color,fontFamily:"Georgia,serif",lineHeight:1,marginTop:"3px"}}>{rs.holesPlayed===0?"—":rs.label}</div>
        {rs.decided&&<div style={{fontSize:"9px",color:decidedColor,marginTop:"2px",fontFamily:"Arial,sans-serif",fontWeight:"700"}}>{rs.diff>0?t1Name:t2Name} gewinnt ✓</div>}
        {!rs.decided&&leading&&<div style={{fontSize:"9px",color,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{leading==="t1"?t1Name:t2Name} führt</div>}
        {!rs.decided&&!leading&&rs.holesPlayed>0&&<div style={{fontSize:"9px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>Gleichstand</div>}
        {pts&&(rs.won||rs.holesLeft===0)&&!rs.decided&&<div style={{fontSize:"9px",color:T.muted,marginTop:"2px",fontFamily:"Arial,sans-serif"}}>{pts.t1}–{pts.t2} Pts</div>}
        {!rs.won&&!rs.decided&&rs.holesLeft>0&&rs.holesPlayed>0&&<div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{rs.holesLeft} übrig</div>}
      </div>
    );
  };

  const t1Pairs=match.t1Pair||[];
  const t2Pairs=match.t2Pair||[];
  const t1Initials=t1Pairs.map(n=>n.split(' ').map(p=>p[0]||'').join('')).join('+');
  const t2Initials=t2Pairs.map(n=>n.split(' ').map(p=>p[0]||'').join('')).join('+');

  return(
    <>
      <div style={{background:T.surface,border:"2px solid "+(canEdit?T.gold:T.border),borderRadius:"12px",marginBottom:"16px",overflow:"visible",opacity:canEdit||isAdmin?1:(match.locked?0.6:0.45),boxShadow:canEdit?"0 0 0 1px "+T.gold+"22,0 4px 20px "+T.gold+"12":"none",transition:"opacity 0.2s",position:"relative",zIndex:canEdit?2:1}}>
        <div style={{padding:"10px 14px",background:canEdit?T.gold+"11":(T.isDark?"#060E1A":T.elevated),borderBottom:"1px solid "+T.border}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{fontSize:"13px",fontWeight:"900",color:canEdit?T.gold:T.cream,fontFamily:"Georgia,serif"}}>{match.name}</div>
              {canEdit&&<div style={{background:T.gold,color:T.isDark?"#0A1628":"white",fontSize:"9px",fontWeight:"900",borderRadius:"4px",padding:"2px 8px",fontFamily:"Arial,sans-serif"}}>✏ Dein Match</div>}
              <div style={{fontSize:"10px",color:T.faint}}>{modeInfo?modeInfo.icon:""} {modeInfo?modeInfo.label:""}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              {match.pin&&<div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{match.pin}</div>}
              {isAdmin&&match.locked&&(
                <button onClick={()=>onUnlock(match.id)} style={{background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"6px",color:"#0A1628",padding:"4px 10px",cursor:"pointer",fontSize:"10px",fontWeight:"700",fontFamily:"Arial,sans-serif"}}>▶ Starten</button>
              )}
              {isAdmin&&!match.locked&&(
                <button onClick={()=>onLock(match.id)} style={{background:"transparent",border:"1px solid "+T.border,borderRadius:"6px",color:T.faint,padding:"4px 7px",cursor:"pointer",fontSize:"10px",fontFamily:"Arial,sans-serif"}}>🔒 Sperren</button>
              )}
              {(canEdit||isAdmin)&&!match.locked&&<button onClick={()=>setShowReset(true)} style={{background:"transparent",border:"1px solid "+T.border,borderRadius:"6px",color:T.faint,padding:"4px 7px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}><IconReset size={11} color={T.faint}/>{isAdmin&&!canEdit&&<span style={{fontFamily:"Arial,sans-serif"}}>Reset</span>}</button>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"4px",flex:1}}>
              {t1Pairs.slice(0,2).map((n,i)=>(
                <PlayerAvatar key={i} name={n} size={28} color={T.blue}/>
              ))}
              <div style={{minWidth:0}}>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.blue,fontFamily:"Arial,sans-serif",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"90px"}}>{t1Pairs.join(" & ")}</div>
                {match.captain1&&<CaptainBadge size={12}/>}
                {match.teamHcp1!=null&&<div style={{fontSize:"9px",color:T.blue+"88",fontFamily:"Arial,sans-serif"}}>HCP {match.teamHcp1}</div>}
              </div>
            </div>
            <div style={{fontSize:"10px",color:T.muted}}>vs</div>
            <div style={{display:"flex",alignItems:"center",gap:"4px",flex:1,justifyContent:"flex-end",flexDirection:"row-reverse"}}>
              {t2Pairs.slice(0,2).map((n,i)=>(
                <PlayerAvatar key={i} name={n} size={28} color={T.red}/>
              ))}
              <div style={{minWidth:0,textAlign:"right"}}>
                <div style={{fontSize:"11px",fontWeight:"700",color:T.red,fontFamily:"Arial,sans-serif",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"90px"}}>{t2Pairs.join(" & ")}</div>
                {match.captain2&&<CaptainBadge size={12}/>}
                {match.teamHcp2!=null&&<div style={{fontSize:"9px",color:T.red+"88",fontFamily:"Arial,sans-serif"}}>HCP {match.teamHcp2}</div>}
              </div>
            </div>
          </div>
        </div>
        <div style={{padding:"10px 14px"}}>
          <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
            <RoundStatus rs={r1} label="R1"/>
            <RoundStatus rs={r2} label="R2"/>
          </div>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",marginBottom:"3px",fontFamily:"Arial,sans-serif"}}>RUNDE 1</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={0} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T} roundDecidedAt={r1.decided?r1.decidedAt:-1}/>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",margin:"6px 0 3px",fontFamily:"Arial,sans-serif"}}>RUNDE 2</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={9} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T} roundDecidedAt={r2.decided?r2.decidedAt:-1}/>
          {match.locked&&!isAdmin&&(
            <div style={{position:"absolute",inset:0,background:"rgba(10,22,40,0.85)",borderRadius:"12px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:"8px"}}>
              <div style={{fontSize:"32px"}}>🔒</div>
              <div style={{fontSize:"13px",fontWeight:"700",color:T.muted,fontFamily:"Georgia,serif"}}>Match noch nicht gestartet</div>
              <div style={{fontSize:"11px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Warte auf den Admin</div>
            </div>
          )}
          {!canEdit&&!isAdmin&&!match.locked&&<div style={{marginTop:"8px",fontSize:"10px",color:T.faint,textAlign:"center",fontFamily:"Arial,sans-serif"}}>🔒 Nur lesbar</div>}
        </div>
      </div>
      {showReset&&<ResetConfirm title={match.name+" zurücksetzen?"} message="Alle Scores werden gelöscht." onConfirm={()=>{onReset(match.id);setShowReset(false);}} onClose={()=>setShowReset(false)} T={T}/>}
    </>
  );
}


function StatsTab({days,t1Name,t2Name,T}){
  const stats=calcStats(days,t1Name,t2Name);
  const totalHoles=stats.t1TotalHoles+stats.t2TotalHoles;
  const t1HolePct=totalHoles>0?Math.round((stats.t1TotalHoles/totalHoles)*100):50;
  const SectionTitle=({children})=>(
    <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",textTransform:"uppercase",fontWeight:"700",marginBottom:"10px",marginTop:"18px",display:"flex",alignItems:"center",gap:"6px",fontFamily:"Arial,sans-serif"}}>
      <div style={{flex:1,height:"1px",background:T.border}}/>{children}<div style={{flex:1,height:"1px",background:T.border}}/>
    </div>
  );
  const PairRow=({pair,maxPts})=>{
    const pct=maxPts>0?(pair.pts/maxPts)*100:0;const color=pair.team==="t1"?T.blue:T.red;
    return(
      <div style={{marginBottom:"10px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
          <div style={{fontSize:"12px",color:T.cream,fontWeight:"600",fontFamily:"Arial,sans-serif",display:"flex",alignItems:"center",gap:"5px"}}>{pair.name}{pair.isCaptain&&<CaptainBadge size={14}/>}</div>
          <div style={{display:"flex",gap:"12px",fontSize:"11px",fontFamily:"Arial,sans-serif"}}><span style={{color:T.muted}}>{pair.holesWon} Löcher</span><span style={{color,fontWeight:"700"}}>{fmt(pair.pts)} Pts</span></div>
        </div>
        <div style={{height:"6px",background:T.elevated,borderRadius:"3px",overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:"3px",transition:"width 0.6s ease"}}/></div>
      </div>
    );
  };
  const maxT1=Math.max(...stats.t1Pairs.map(p=>p.pts),1);
  const maxT2=Math.max(...stats.t2Pairs.map(p=>p.pts),1);
  return(
    <div style={{paddingBottom:"20px"}}>
      <Card T={T}>
        <div style={{fontSize:"11px",color:T.muted,letterSpacing:"1px",marginBottom:"10px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>Gewonnene Löcher gesamt</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"8px"}}>
          <div><div style={{fontSize:"11px",color:T.blue,fontWeight:"700",fontFamily:"Arial,sans-serif"}}>🔵 {t1Name}</div><div style={{fontFamily:"Georgia,serif",fontSize:"32px",fontWeight:"900",color:T.blue,lineHeight:1}}>{stats.t1TotalHoles}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>gespielt</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:T.red,fontWeight:"700",fontFamily:"Arial,sans-serif"}}>🔴 {t2Name}</div><div style={{fontFamily:"Georgia,serif",fontSize:"32px",fontWeight:"900",color:T.red,lineHeight:1}}>{stats.t2TotalHoles}</div></div>
        </div>
        <div style={{height:"10px",borderRadius:"5px",overflow:"hidden",display:"flex"}}><div style={{width:`${t1HolePct}%`,background:T.blue,transition:"width 0.6s ease"}}/><div style={{flex:1,background:T.red}}/></div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted,marginTop:"4px",fontFamily:"Arial,sans-serif"}}><span>{t1HolePct}%</span><span>{100-t1HolePct}%</span></div>
      </Card>
      <SectionTitle>🔵 {t1Name}</SectionTitle>
      <Card T={T}>{stats.t1Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center",fontFamily:"Arial,sans-serif"}}>Noch keine Daten</div>:stats.t1Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT1}/>)}</Card>
      <SectionTitle>🔴 {t2Name}</SectionTitle>
      <Card T={T}>{stats.t2Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center",fontFamily:"Arial,sans-serif"}}>Noch keine Daten</div>:stats.t2Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT2}/>)}</Card>
      <SectionTitle>Loch-Statistik</SectionTitle>
      <Card T={T}>
        {stats.hotHoles.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center",fontFamily:"Arial,sans-serif"}}>Noch keine Daten</div>:(
          stats.hotHoles.slice(0,9).map((h,i)=>{
            const tot=h.t1+h.t2+h.tie||1;
            return(<div key={i} style={{marginBottom:"8px"}}>
              <div style={{display:"grid",gridTemplateColumns:"30px 1fr 30px",gap:"4px",alignItems:"center",marginBottom:"3px"}}>
                <div style={{fontSize:"11px",color:T.blue,textAlign:"center",fontWeight:"700",fontFamily:"Arial,sans-serif"}}>{h.t1}</div>
                <div style={{fontSize:"10px",color:T.muted,textAlign:"center",fontFamily:"Arial,sans-serif"}}>Loch {h.hole}</div>
                <div style={{fontSize:"11px",color:T.red,textAlign:"center",fontWeight:"700",fontFamily:"Arial,sans-serif"}}>{h.t2}</div>
              </div>
              <div style={{display:"flex",height:"6px",borderRadius:"3px",overflow:"hidden",background:T.elevated}}>
                <div style={{width:`${(h.t1/tot)*100}%`,background:T.blue}}/><div style={{width:`${(h.tie/tot)*100}%`,background:T.border}}/><div style={{width:`${(h.t2/tot)*100}%`,background:T.red}}/>
              </div>
            </div>);
          })
        )}
      </Card>
      <SectionTitle>🌟 Top Performer</SectionTitle>
      <Card T={T}>
        {stats.allPairs.filter(p=>p.pts>0).length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center",fontFamily:"Arial,sans-serif"}}>Noch keine abgeschlossenen Runden</div>:(
          stats.allPairs.filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts).slice(0,3).map((p,i)=>{
            const color=p.team==="t1"?T.blue:T.red;
            return(<div key={i} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px",background:T.elevated,borderRadius:"8px",marginBottom:"8px",border:`1px solid ${color}33`}}>
              <div style={{fontSize:"20px"}}>{"🥇🥈🥉"[i]}</div>
              <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color,fontFamily:"Arial,sans-serif",display:"flex",alignItems:"center",gap:"5px"}}>{p.name}{p.isCaptain&&<CaptainBadge size={14}/>}</div><div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{p.holesWon} Löcher</div></div>
              <div style={{fontSize:"20px",fontWeight:"900",color,fontFamily:"Georgia,serif"}}>{fmt(p.pts)}</div>
            </div>);
          })
        )}
      </Card>
    </div>
  );
}

function Dashboard({config,role,onBack,theme,onThemeChange,tournamentId}){
  const T=THEMES[theme];
  const {t1Name,t2Name,days}=config;
  const [modal,setModal]=useState(null);
  const [activeTab,setActiveTab]=useState("day0");
  const [saving,setSaving]=useState(false);
  const [showPush,setShowPush]=useState(true);
  const [toast,setToast]=useState(null);
  const [winEvent,setWinEvent]=useState(null);
  const [confetti,setConfetti]=useState(false);
  const [resetAll,setResetAll]=useState(false);
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

  useEffect(()=>{if(!messaging)return;const u=onMessage(messaging,p=>{setToast({title:p.notification?.title,body:p.notification?.body});});return()=>u();},[]);
  useEffect(()=>{
    if(prevRef.current){const change=detectPointChange(prevRef.current,days,t1Name,t2Name);if(change){setToast(change);if(change.winner){setWinEvent(change);setConfetti(true);}}}
    prevRef.current=days;
  },[days]);

  const stats=calcTournament(days);
  const t1W=Math.max(5,Math.min(95,stats.t1WinProb));

  const doReset=async matchId=>{
    setSaving(true);
    const nd=days.map(day=>({...day,matches:day.matches.map(m=>m.id===matchId?{...m,scores:emptyScores()}:m)}));
    await saveTournament(tournamentId,{...config,days:nd});setSaving(false);
  };
  const doResetAll=async()=>{
    setSaving(true);
    const nd=days.map(day=>({...day,matches:day.matches.map(m=>({...m,scores:emptyScores()}))}));
    await saveTournament(tournamentId,{...config,days:nd});setSaving(false);setResetAll(false);
  };
  const saveScore=async(dayId,matchId,hi,t1s,t2s)=>{
    setSaving(true);
    const nd=days.map(day=>{if(day.id!==dayId)return day;return{...day,matches:day.matches.map(m=>{if(m.id!==matchId)return m;const ns=[...m.scores];ns[hi]={team1:t1s,team2:t2s};return{...m,scores:ns};})};});
    const change=detectPointChange(days,nd,t1Name,t2Name);
    if(change)await sendPushToAll(change.title,change.body,change.key);
    await saveTournament(tournamentId,{...config,days:nd});setSaving(false);setModal(null);
  };

  const activeDay=activeTab==="day0"?days[0]:activeTab==="day1"?days[1]:null;
  const course=activeDay?.course||DEFAULT_COURSES.riedhof;
  const mMatch=modal?days.find(d=>d.id===modal.dayId)?.matches.find(m=>m.id===modal.matchId):null;
  const mDay=modal?days.find(d=>d.id===modal.dayId):null;
  const pushGranted=typeof Notification!=="undefined"&&Notification.permission==="granted";

  const DaySummary=({day})=>{
    const c=day.course||DEFAULT_COURSES.riedhof;let t1=0,t2=0;
    day.matches.forEach(m=>{[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,c.par,r*9,r*9+9);const p=getPoints(rs);if(p){t1+=p.t1;t2+=p.t2;}});});
    return(<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div><div style={{fontSize:"11px",color:T.gold,fontWeight:"700",fontFamily:"Georgia,serif"}}>{day.label}</div><div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{c.shortName} · {day.matches.length} Matches</div></div>
      <div style={{display:"flex",gap:"8px",alignItems:"center"}}><span style={{color:T.blue,fontWeight:"700",fontSize:"16px",fontFamily:"Georgia,serif"}}>{fmt(t1)}</span><span style={{color:T.muted,fontSize:"11px"}}>:</span><span style={{color:T.red,fontWeight:"700",fontSize:"16px",fontFamily:"Georgia,serif"}}>{fmt(t2)}</span></div>
    </div>);
  };

  const tabs=[
    {key:"day0",label:days[0]?.course?.shortName||"Tag 1"},
    {key:"day1",label:days[1]?.course?.shortName||"Tag 2"},
    {key:"stats",label:"Stats",icon:<IconChart size={11} color="currentColor"/>},
  ];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Confetti active={confetti} onDone={()=>setConfetti(false)}/>
      <WinBanner event={winEvent} onDone={()=>setWinEvent(null)}/>
      {toast&&<Toast message={toast} onDismiss={()=>setToast(null)}/>}
      {resetAll&&<ResetConfirm title="Alle zurücksetzen?" message="Wirklich ALLE Scores löschen?" onConfirm={doResetAll} onClose={()=>setResetAll(false)} T={T}/>}

      <AppHeader T={T} theme={theme} onThemeChange={onThemeChange} onBack={onBack}
        subtitle={config.tournamentName||"Pin High"}
        rightSlot={<div style={{display:"flex",alignItems:"center",gap:"8px"}}><div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:saving?"#C9A96E":"#4CAF50"}}/><div style={{fontSize:"9px",color:"rgba(255,255,255,0.4)",letterSpacing:"1px",textTransform:"uppercase",fontFamily:"Arial,sans-serif"}}>{saving?"...":"Live"}</div></div><ThemeToggle theme={theme} onChange={onThemeChange}/></div>}/>

      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {showPush&&!pushGranted&&<PushBanner onDismiss={()=>setShowPush(false)} T={T}/>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
          <RoleBadge role={role} T={T}/>
          {config.dateFrom&&<div style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>{config.dateFrom}{config.dateTo?` – ${config.dateTo}`:""}</div>}
        </div>
        {myMatchName&&(
          <div style={{background:T.gold+"11",border:`1px solid ${T.gold}44`,borderRadius:"10px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
            <PinHighLogo size={20} color={T.gold}/>
            <div><div style={{fontSize:"12px",fontWeight:"700",color:T.gold,fontFamily:"Georgia,serif"}}>Du spielst {myMatchName}</div><div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>Tippe auf ein Loch zum Eintragen</div></div>
          </div>
        )}
        <Card T={T}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
            <div><div style={{fontSize:"11px",fontWeight:"700",color:T.blue,textTransform:"uppercase",letterSpacing:"1px",fontFamily:"Arial,sans-serif"}}>🔵 {t1Name}</div><div style={{fontFamily:"Georgia,serif",fontSize:"40px",fontWeight:"900",color:T.blue,lineHeight:1}}>{fmt(stats.t1Confirmed)}</div><div style={{fontSize:"10px",color:T.faint,fontFamily:"Arial,sans-serif"}}>proj. {stats.t1Projected} Pts</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"9px",color:T.muted,fontFamily:"Arial,sans-serif"}}>ZIEL</div><div style={{fontFamily:"Georgia,serif",fontSize:"20px",fontWeight:"900",color:T.gold}}>{stats.needed}</div><div style={{fontSize:"9px",color:T.faint,fontFamily:"Arial,sans-serif"}}>von {stats.totalPoints}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",fontWeight:"700",color:T.red,textTransform:"uppercase",letterSpacing:"1px",fontFamily:"Arial,sans-serif"}}>🔴 {t2Name}</div><div style={{fontFamily:"Georgia,serif",fontSize:"40px",fontWeight:"900",color:T.red,lineHeight:1}}>{fmt(stats.t2Confirmed)}</div><div style={{fontSize:"10px",color:T.faint,textAlign:"right",fontFamily:"Arial,sans-serif"}}>proj. {stats.t2Projected} Pts</div></div>
          </div>
          <div style={{height:"14px",borderRadius:"7px",overflow:"hidden",display:"flex",margin:"4px 0"}}><div style={{width:`${t1W}%`,background:T.blue,transition:"width 0.6s ease"}}/><div style={{flex:1,background:T.red}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}><span>{stats.t1WinProb}% Sieg</span><span>{stats.t2WinProb}% Sieg</span></div>
          <div style={{marginTop:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>{days.map(d=><DaySummary key={d.id} day={d}/>)}</div>
        </Card>

        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {tabs.map((tab,i)=>(
            <button key={tab.key} style={{flex:1,padding:"10px 4px",background:activeTab===tab.key?T.elevated:T.isDark?"#060E1A":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeTab===tab.key?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"0.5px",textTransform:"uppercase",fontWeight:activeTab===tab.key?"700":"400",display:"flex",alignItems:"center",justifyContent:"center",gap:"4px",fontFamily:"Arial,sans-serif"}}
              onClick={()=>setActiveTab(tab.key)}>{tab.icon}{tab.label}</button>
          ))}
        </div>

        {activeTab==="stats"&&<StatsTab days={days} t1Name={t1Name} t2Name={t2Name} T={T}/>}

        {activeDay&&course&&(
          <>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div><div style={{fontSize:"13px",fontWeight:"700",color:T.cream,fontFamily:"Georgia,serif"}}>{course.name}</div><div style={{fontSize:"11px",color:T.faint,fontFamily:"Arial,sans-serif"}}>{course.location}</div></div>
                <div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:T.muted,fontFamily:"Arial,sans-serif"}}>Par</div><div style={{fontFamily:"Georgia,serif",fontSize:"18px",fontWeight:"900",color:T.gold}}>{course.par.slice(0,9).reduce((a,b)=>a+b,0)} / {course.par.slice(9).reduce((a,b)=>a+b,0)}</div></div>
              </div>
              {[0,1].map(r=>(
                <div key={r} style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:r===0?"3px":"0"}}>
                  {course.par.slice(r*9,r*9+9).map((p,i)=>(
                    <div key={i} style={{textAlign:"center",fontSize:"9px",padding:"2px 0",borderRadius:"3px",background:T.holeBg,color:T.holeText,fontFamily:"Arial,sans-serif"}}>
                      <div style={{opacity:0.6}}>{r*9+i+1}</div><div style={{fontWeight:"700"}}>P{p}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {activeDay.matches.map(m=>(
              <MatchCard key={m.id} match={m} pars={course.par} t1Name={t1Name} t2Name={t2Name}
                canEdit={canEdit(m.id)&&!m.locked} isAdmin={isAdmin} T={T}
                onHoleClick={(matchId,hi)=>{if(!m.locked||isAdmin)setModal({dayId:activeDay.id,matchId,holeIndex:hi});}}
                onReset={doReset}
                onUnlock={doUnlock}
                onLock={doLock}/>
            ))}
            {isAdmin&&<button style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"12px",cursor:"pointer",marginTop:"4px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",letterSpacing:"1px",fontFamily:"Arial,sans-serif"}} onClick={()=>setResetAll(true)}><IconReset size={14} color="#E05252"/> Alle Matches zurücksetzen</button>}
          </>
        )}
      </div>
      {modal&&(()=>{
        const _mDay=days.find(d=>d.id===modal.dayId);
        const _mMatch=_mDay?_mDay.matches.find(m=>m.id===modal.matchId):null;
        if(!_mDay||!_mMatch)return null;
        return<ScoreModal match={_mMatch} holeIndex={modal.holeIndex} t1Name={t1Name} t2Name={t2Name}
          par={(_mDay.course||DEFAULT_COURSES.riedhof).par} existing={_mMatch.scores[modal.holeIndex]}
          onSave={(t1,t2)=>saveScore(modal.dayId,modal.matchId,modal.holeIndex,t1,t2)}
          onClose={()=>setModal(null)} T={T}/>;
      })()}
    </div>
  );
}

export default function App(){
  const [phase,setPhase]=useState("login");
  const [role,setRole]=useState(null);
  const [tournaments,setTournaments]=useState([]);
  const [activeTournamentId,setActiveTournamentId]=useState(null);
  const [currentTournament,setCurrentTournament]=useState(null);
  const [loading,setLoading]=useState(false);
  const [activeMatchCount,setActiveMatchCount]=useState(0);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem("ph_theme")||"dark";}catch(e){return"dark";}});
  const T=THEMES[theme];
  const changeTheme=t=>{setTheme(t);try{localStorage.setItem("ph_theme",t);}catch(e){}};

  const handleLogin=async r=>{
    setRole(r);setLoading(true);
    try{
      const metaSnap=await getDoc(doc(db,"meta","active"));
      const activeId=metaSnap.exists()?metaSnap.data().id:null;
      setActiveTournamentId(activeId);
      const all=await loadAllTournaments();
      setTournaments(all);
      setPhase("home");
      // Load active match count
      loadActiveMatches().then(am=>setActiveMatchCount(am.length)).catch(()=>{});
    }catch(e){setPhase("home");}
    setLoading(false);
  };

  useEffect(()=>{
    if(phase!=="game"||!activeTournamentId)return;
    const unsub=onSnapshot(doc(db,"tournaments",activeTournamentId),snap=>{
      if(snap.exists())setCurrentTournament({id:snap.id,...snap.data()});
    });
    return()=>unsub();
  },[phase,activeTournamentId]);

  const handleSelectTournament=t=>{setCurrentTournament(t);setPhase("game");};
  const handleActivate=async id=>{setActiveTournamentId(id);await saveActive(id);};
  const handleDelete=async id=>{
    await deleteDoc(doc(db,"tournaments",id));
    setTournaments(prev=>prev.filter(t=>t.id!==id));
    if(activeTournamentId===id){setActiveTournamentId(null);await saveActive("");}
  };
  const handleSetupComplete=async setupData=>{
    const id=`tournament_${Date.now()}`;
    const c1=setupData.course1||DEFAULT_COURSES.riedhof;
    const c2=setupData.course2||DEFAULT_COURSES.bergkramerhof;
    const days=[
      {id:0,label:`Tag 1 – ${c1.shortName}`,course:c1,matches:setupData.day1Matches||[]},
      {id:1,label:`Tag 2 – ${c2.shortName}`,course:c2,matches:setupData.day2Matches||[]},
    ];
    const config={tournamentName:setupData.tournamentName||"Pin High Turnier",dateFrom:setupData.dateFrom||null,dateTo:setupData.dateTo||null,t1Name:setupData.t1Name||"Team 1",t2Name:setupData.t2Name||"Team 2",t1Players:setupData.t1Players||[],t2Players:setupData.t2Players||[],captain1:setupData.captain1||null,captain2:setupData.captain2||null,days,createdAt:Date.now(),phase:"game"};
    await saveTournament(id,config);
    await saveActive(id);
    setActiveTournamentId(id);
    setTournaments(prev=>[{id,...config},...prev]);
    setCurrentTournament({id,...config});
    setPhase("game");
  };

  if(phase==="login")return<Login onLogin={handleLogin} theme={theme} onThemeChange={changeTheme}/>;
  if(loading)return(
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><PinHighLogo size={48} color="#C9A96E"/><div style={{color:T.muted,fontSize:"14px",letterSpacing:"2px",marginTop:"16px",fontFamily:"Arial,sans-serif"}}>Lade...</div></div>
    </div>
  );
  if(phase==="players")return<PlayerManager onBack={()=>setPhase("home")} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="create")return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif",display:"flex",flexDirection:"column"}}>
      <AppHeader T={T} theme={theme} onThemeChange={changeTheme} onBack={()=>setPhase("home")} subtitle="Erstellen"/>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px"}}>
        <div style={{width:"100%",maxWidth:"320px",display:"flex",flexDirection:"column",gap:"12px"}}>
          <button onClick={()=>setPhase("quickmatch")}
            style={{width:"100%",padding:"20px",background:T.cardBg,border:"1px solid "+T.border,borderRadius:"12px",color:T.cream,cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{fontSize:"28px"}}>⚡</div>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:"16px",fontWeight:"900"}}>Einzel Match</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",color:T.muted,marginTop:"2px"}}>Schnell starten · 9 oder 18 Löcher</div>
            </div>
          </button>
          <button onClick={()=>setPhase("list")}
            style={{width:"100%",padding:"20px",background:"linear-gradient(135deg,#C9A96E,#A07830)",border:"none",borderRadius:"12px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:"14px"}}>
            <div style={{fontSize:"28px"}}>🏆</div>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:"16px",fontWeight:"900",color:T.isDark?"#0A1628":"white"}}>Turnier</div>
              <div style={{fontFamily:"Arial,sans-serif",fontSize:"11px",opacity:0.7,marginTop:"2px",color:T.isDark?"#0A1628":"white"}}>Mehrere Matches · Teams · Rangliste</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
  if(phase==="active")return<ActiveMatchesScreen onBack={()=>setPhase("home")} role={role} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="archive")return<ArchiveScreen onBack={()=>setPhase("home")} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="home")return<HomeScreen role={role}
    onActiveMatches={()=>setPhase("active")}
    onTournament={()=>setPhase("create")}
    onQuickMatch={()=>setPhase("quickmatch")}
    onPlayers={()=>setPhase("players")}
    onArchive={()=>setPhase("archive")}
    activeMatchCount={activeMatchCount}
    onLogout={()=>{setPhase("login");setRole(null);}} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="quickmatch")return<QuickMatch onBack={()=>setPhase("home")} role={role} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="list")return<TournamentList role={role} tournaments={tournaments} activeTournamentId={activeTournamentId} onSelect={handleSelectTournament} onNew={()=>setPhase("setup")} onQuickMatch={()=>setPhase("quickmatch")} onActivate={handleActivate} onDelete={handleDelete} T={T} theme={theme} onThemeChange={changeTheme} onLogout={()=>setPhase("home")}/>;
  if(phase==="setup")return<AdminSetup onStart={handleSetupComplete} onBack={()=>setPhase("list")} T={T} theme={theme} onThemeChange={changeTheme}/>;
  if(phase==="game"&&currentTournament)return<Dashboard config={currentTournament} role={role} onBack={()=>setPhase("list")} theme={theme} onThemeChange={changeTheme} tournamentId={currentTournament.id}/>;
  return null;
}
function PlayerAvatar({name, size, color, photo, onPhotoClick}){
  size = size || 36;
  const initials = name ? name.split(' ').map(p=>p[0]||'').slice(0,2).join('').toUpperCase() : '?';
  return(
    <div style={{width:size+"px",height:size+"px",borderRadius:"50%",background:color+"22",border:"1.5px solid "+color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,position:"relative",overflow:"hidden",cursor:onPhotoClick?"pointer":"default"}}
      onClick={onPhotoClick}>
      {photo
        ? <img src={photo} alt={name} style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:"50%"}}/>
        : <span style={{fontSize:(size*0.33)+"px",fontWeight:"700",color,fontFamily:"Arial,sans-serif"}}>{initials}</span>
      }
      {onPhotoClick&&!photo&&(
        <div style={{position:"absolute",bottom:0,right:0,width:(size*0.35)+"px",height:(size*0.35)+"px",background:"#C9A96E",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width={size*0.2} height={size*0.2} viewBox="0 0 24 24" fill="none" stroke="#0A1628" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
      )}
    </div>
  );
}


