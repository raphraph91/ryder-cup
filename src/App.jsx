import React, { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, getDocs, deleteDoc, addDoc, query, orderBy } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const VERSION = "2.04";

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

let lastPushKey = null;
async function saveTournament(data) { await setDoc(doc(db,"tournaments","ryder2024"),data); }
async function archiveTournament(data) {
  const archived = { ...data, archivedAt: Date.now(), archivedAtLabel: new Date().toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}) };
  await addDoc(collection(db,"tournamentArchive"), archived);
}
async function registerFCMToken() {
  if(!messaging) return null;
  try { const t=await getToken(messaging,{vapidKey:VAPID_KEY}); if(t){await setDoc(doc(db,"fcm_tokens",t),{token:t,createdAt:Date.now()});return t;} } catch(e) {}
  return null;
}
async function sendPushToAll(title,body,dedupeKey) {
  if(dedupeKey&&dedupeKey===lastPushKey)return; lastPushKey=dedupeKey;
  try{await fetch('/api/send-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})});}catch(e){}
}

const ADMIN_CODE="RYDER-ADMIN", VIEWER_CODE="RYDER2024";
function resolveRole(code) {
  const c=code.trim().toUpperCase();
  if(c===ADMIN_CODE)return"admin"; if(c===VIEWER_CODE)return"viewer";
  const m=c.match(/^MATCH(\d+)$/); if(m)return`match-${parseInt(m[1])-1}`; return null;
}

const COURSES = {
  riedhof:{id:"riedhof",name:"GC München-Riedhof",shortName:"Riedhof",location:"Egling",par:[4,3,4,5,3,4,3,4,4,4,3,5,4,5,4,5,4,4]},
  bergkramerhof:{id:"bergkramerhof",name:"Golfclub Bergkramerhof",shortName:"Bergkramerhof",location:"Wolfratshausen",par:[4,5,3,4,4,3,5,3,5,4,3,4,3,5,4,5,4,4]},
};

const GAME_MODES = {
  scramble:{label:"Scramble",icon:"🔀",desc:"Bestes Team-Ergebnis",pairs:true},
  singles:{label:"Singles",icon:"👤",desc:"Individuell",pairs:false},
  foursomes:{label:"Foursomes",icon:"🔄",desc:"Abwechselnd schlagen",pairs:true},
  fourball:{label:"Four-Ball",icon:"⛳",desc:"Bester Ball zählt",pairs:true},
};

function calcRoundStatus(scores,pars,s,e){
  let diff=0,played=0,won=false,decisionAt=null;
  for(let i=s;i<e;i++){
    const h=scores[i];
    if(h.team1!==null&&h.team2!==null){
      // Only count this hole if match not yet decided
      if(!won){
        played++;
        if(h.team1<h.team2)diff++;else if(h.team2<h.team1)diff--;
        const left=e-s-played;
        // Check if match is decided after this hole
        if(Math.abs(diff)>left){won=true;decisionAt=i;}
        else if(left===0){won=true;decisionAt=i;}
      }
      // Dead hole: already decided — count as played for UI but don't affect score
      else{played++;}
    }
  }
  const left=e-s-played;
  let label="AS";
  if(won){label=decisionAt!==null&&(e-s-(decisionAt-s+1))>0?`${Math.abs(diff)}&${e-(decisionAt+1)}`:diff>0?"1UP":diff<0?"1UP":"AS";}
  else if(diff!==0){label=`${Math.abs(diff)} UP`;}
  return{diff,holesPlayed:played,holesLeft:left,label,won,decisionAt};
}
function getPoints(rs){if(rs.won||rs.holesLeft===0){if(rs.diff>0)return{t1:1,t2:0};if(rs.diff<0)return{t1:0,t2:1};return{t1:0.5,t2:0.5};}return null;}
function projectedPoints(rs){if(rs.won||rs.holesLeft===0)return getPoints(rs);const a=rs.diff/18;return{t1:0.5+a*0.4,t2:0.5-a*0.4};}

function calcTournament(days){
  let t1c=0,t2c=0,t1p=0,t2p=0,total=0;
  days.forEach(day=>{
    const c=COURSES[day.courseKey]||Object.values(COURSES)[0];
    day.matches.forEach(m=>{total+=2;[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,c.par,r*9,r*9+9);const conf=getPoints(rs),proj=projectedPoints(rs);if(conf){t1c+=conf.t1;t2c+=conf.t2;}t1p+=proj.t1;t2p+=proj.t2;});});
  });
  const s=t1p+t2p;return{t1Confirmed:t1c,t2Confirmed:t2c,t1Projected:Math.round(t1p*10)/10,t2Projected:Math.round(t2p*10)/10,t1WinProb:s>0?Math.round((t1p/s)*100):50,t2WinProb:s>0?Math.round((t2p/s)*100):50,totalPoints:total,needed:total/2+0.5};
}
function emptyScores(){return Array.from({length:18},()=>({team1:null,team2:null}));}
function detectPointChange(oldDays,newDays,t1Name,t2Name){
  if(!oldDays)return null;
  for(let di=0;di<newDays.length;di++){
    const od=oldDays[di],nd=newDays[di];if(!od)continue;
    const c=COURSES[nd.courseKey]||Object.values(COURSES)[0];
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
  days.forEach(day=>{
    const course=COURSES[day.courseKey]||Object.values(COURSES)[0];
    day.matches.forEach(m=>{
      const isPairs=GAME_MODES[m.mode||"scramble"]?.pairs!==false;
      const key1=isPairs?(m.t1Pair||[]).join(" & "):(m.t1Pair||[])[0]||"?";
      const key2=isPairs?(m.t2Pair||[]).join(" & "):(m.t2Pair||[])[0]||"?";
      if(!pairStats[key1])pairStats[key1]={name:key1,team:"t1",pts:0,holesWon:0};
      if(!pairStats[key2])pairStats[key2]={name:key2,team:"t2",pts:0,holesWon:0};
      [0,1].forEach(r=>{
        const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);const pts=getPoints(rs);
        if(pts){pairStats[key1].pts+=pts.t1;pairStats[key2].pts+=pts.t2;}
        for(let i=r*9;i<r*9+9;i++){const sc=m.scores[i];if(sc.team1!==null&&sc.team2!==null){if(sc.team1<sc.team2){pairStats[key1].holesWon++;t1TotalHoles++;holeWins.t1[i]++;}else if(sc.team2<sc.team1){pairStats[key2].holesWon++;t2TotalHoles++;holeWins.t2[i]++;}else holeWins.tie[i]++;}}
      });
    });
  });
  const allPairs=Object.values(pairStats);
  return{t1Pairs:allPairs.filter(p=>p.team==="t1").sort((a,b)=>b.pts-a.pts),t2Pairs:allPairs.filter(p=>p.team==="t2").sort((a,b)=>b.pts-a.pts),t1TotalHoles,t2TotalHoles,holeWins,allPairs};
}

const THEMES={
  dark:{bg:"#0D2B1A",surface:"#0F2D1A",elevated:"#1A4D2E",border:"#2D6B40",gold:"#C9A84C",cream:"#F2EDD7",muted:"#8BAF7C",faint:"#4A7A5C",blue:"#4A9EFF",red:"#FF6B6B",holeBg:"#1A3D25",holeText:"#4A7A5C",headerBg:"linear-gradient(135deg,#0A2014,#1A4D2E)",cardBg:"linear-gradient(180deg,#1A4D2E 0%,#0F3320 100%)",isDark:true},
  light:{bg:"#F4F6F4",surface:"#FFFFFF",elevated:"#EEF2EE",border:"#D0DDD0",gold:"#2E7D32",cream:"#1A1A1A",muted:"#5A7A5A",faint:"#8A9A8A",blue:"#1565C0",red:"#C62828",holeBg:"#F0F4F0",holeText:"#AAAAAA",headerBg:"linear-gradient(135deg,#1B5E20,#2E7D32)",cardBg:"#FFFFFF",isDark:false},
};
const fmt=v=>v%1===0?v:v.toFixed(1);

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconReset=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const IconBack=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const IconChart=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
const IconPlus=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconTrash=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>;
const IconCheck=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IconArchive=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>;
const IconExpand=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const IconSend=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IconBell=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>;
const IconGear=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;

// ── LiveChat helpers ───────────────────────────────────────────────────────────
const CHAT_PREFS_KEY="ryder_chat_prefs";
const CHAT_PROFILE_KEY="ryder_chat_profile";
const DEFAULT_PREFS={matchDecision:true,birdie:true,leadChange:true,halftime:true,equalize:false,everyHole:false};

function useChatPrefs(){
  const [prefs,setPrefs]=useState(()=>{try{const s=localStorage.getItem(CHAT_PREFS_KEY);return s?JSON.parse(s):DEFAULT_PREFS;}catch(e){return DEFAULT_PREFS;}});
  const update=p=>{const n={...prefs,...p};setPrefs(n);try{localStorage.setItem(CHAT_PREFS_KEY,JSON.stringify(n));}catch(e){}};
  return[prefs,update];
}

function useChatProfile(){
  const [profile,setProfile]=useState(()=>{try{const s=localStorage.getItem(CHAT_PROFILE_KEY);return s?JSON.parse(s):null;}catch(e){return null;}});
  const save=p=>{setProfile(p);try{localStorage.setItem(CHAT_PROFILE_KEY,JSON.stringify(p));}catch(e){}};
  return[profile,save];
}

// Dedup guard — track recently posted system event keys in memory
const _postedKeys=new Set();
async function postChatMessage(msg,dedupeKey){
  if(dedupeKey){if(_postedKeys.has(dedupeKey))return;_postedKeys.add(dedupeKey);setTimeout(()=>_postedKeys.delete(dedupeKey),10000);}
  try{await addDoc(collection(db,"liveChat"),{...msg,ts:Date.now()});}catch(e){}
}

function useChatMessages(){
  const [msgs,setMsgs]=useState([]);
  useEffect(()=>{
    const q=query(collection(db,"liveChat"),orderBy("ts","asc"));
    const unsub=onSnapshot(q,snap=>{setMsgs(snap.docs.map(d=>({id:d.id,...d.data()})));});
    return()=>unsub();
  },[]);
  return msgs;
}

// ── Chat Profile Setup (name + photo with crop/zoom) ─────────────────────────
function ChatProfileSetup({role,T,onDone}){
  const roleLabel=role==="admin"?"Admin":role==="viewer"?"Zuschauer":`Spieler ${parseInt(role.split("-")[1])+1}`;
  const [name,setName]=useState(roleLabel);
  const [photo,setPhoto]=useState(null);
  const [cropSrc,setCropSrc]=useState(null);
  const [cropScale,setCropScale]=useState(1);
  const [cropX,setCropX]=useState(0);
  const [cropY,setCropY]=useState(0);
  const [dragging,setDragging]=useState(false);
  const [dragStart,setDragStart]=useState({x:0,y:0,ox:0,oy:0});

  const handlePhoto=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{setCropSrc(ev.target.result);setCropScale(1);setCropX(0);setCropY(0);};r.readAsDataURL(f);};

  const startDrag=e=>{
    const clientX=e.touches?e.touches[0].clientX:e.clientX;
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    setDragging(true);setDragStart({x:clientX,y:clientY,ox:cropX,oy:cropY});
  };
  const onDrag=e=>{
    if(!dragging)return;
    const clientX=e.touches?e.touches[0].clientX:e.clientX;
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    setCropX(dragStart.ox+(clientX-dragStart.x));
    setCropY(dragStart.oy+(clientY-dragStart.y));
  };
  const endDrag=()=>setDragging(false);

  const cropAndSave=()=>{
    const size=200;const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext("2d");const img=new Image();
    img.onload=()=>{
      const s=Math.min(img.width,img.height)*cropScale;
      const sx=(img.width-s)/2-cropX*(img.width/200);
      const sy=(img.height-s)/2-cropY*(img.height/200);
      ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.clip();
      ctx.drawImage(img,sx,sy,s,s,0,0,size,size);
      setPhoto(canvas.toDataURL("image/jpeg",0.8));setCropSrc(null);
    };
    img.src=cropSrc;
  };

  const inp={background:T.isDark?"#0A2014":T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",padding:"10px 12px",outline:"none",boxSizing:"border-box",width:"100%"};

  if(cropSrc){
    return(
      <div style={{padding:"20px",display:"flex",flexDirection:"column",alignItems:"center",gap:"16px"}}>
        <div style={{fontSize:"14px",fontWeight:"700",color:T.gold}}>Foto zuschneiden</div>
        <div
          style={{position:"relative",width:"200px",height:"200px",borderRadius:"50%",overflow:"hidden",border:`3px solid ${T.gold}`,cursor:"grab",userSelect:"none",touchAction:"none"}}
          onMouseDown={startDrag} onMouseMove={onDrag} onMouseUp={endDrag} onMouseLeave={endDrag}
          onTouchStart={startDrag} onTouchMove={onDrag} onTouchEnd={endDrag}>
          <img src={cropSrc} style={{position:"absolute",top:"50%",left:"50%",transform:`translate(calc(-50% + ${cropX}px), calc(-50% + ${cropY}px)) scale(${cropScale})`,transformOrigin:"center",minWidth:"100%",minHeight:"100%",pointerEvents:"none"}} alt="crop"/>
        </div>
        <div style={{width:"100%",maxWidth:"280px"}}>
          <div style={{fontSize:"10px",color:T.muted,marginBottom:"4px"}}>Zoom</div>
          <input type="range" min="1" max="4" step="0.05" value={cropScale} onChange={e=>setCropScale(Number(e.target.value))} style={{width:"100%",accentColor:T.gold}}/>
        </div>
        <div style={{display:"flex",gap:"10px",width:"100%",maxWidth:"280px"}}>
          <button onClick={cropAndSave} style={{flex:1,padding:"12px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"13px",fontWeight:"900",cursor:"pointer"}}>Übernehmen ✓</button>
          <button onClick={()=>setCropSrc(null)} style={{flex:1,padding:"12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}}>Abbrechen</button>
        </div>
      </div>
    );
  }

  return(
    <div style={{padding:"24px 20px",display:"flex",flexDirection:"column",alignItems:"center",gap:"16px"}}>
      <div style={{fontSize:"16px",fontWeight:"700",color:T.gold,textAlign:"center"}}>💬 Chat beitreten</div>
      <div style={{fontSize:"12px",color:T.muted,textAlign:"center"}}>Wähle einen Namen und optional ein Foto</div>
      <div style={{position:"relative"}}>
        <div style={{width:"80px",height:"80px",borderRadius:"50%",background:T.elevated,border:`2px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
          {photo?<img src={photo} style={{width:"100%",height:"100%",objectFit:"cover"}} alt="avatar"/>
            :<span style={{fontSize:"32px",color:T.muted}}>👤</span>}
        </div>
        <label style={{position:"absolute",bottom:0,right:0,width:"28px",height:"28px",background:`linear-gradient(135deg,${T.gold},#A07830)`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D2B1A" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <input type="file" accept="image/*" onChange={handlePhoto} style={{display:"none"}}/>
        </label>
      </div>
      <div style={{width:"100%",maxWidth:"280px"}}>
        <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"4px"}}>ANZEIGENAME</div>
        <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Dein Name im Chat"/>
      </div>
      <button disabled={!name.trim()} onClick={()=>onDone({name:name.trim(),photo})} style={{width:"100%",maxWidth:"280px",padding:"13px",background:name.trim()?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"8px",color:name.trim()?(T.isDark?"#0D2B1A":"white"):T.muted,fontSize:"14px",fontWeight:"900",cursor:name.trim()?"pointer":"default",letterSpacing:"1px"}}>
        Beitreten →
      </button>
    </div>
  );
}

// ── Chat Bubble ───────────────────────────────────────────────────────────────
function ChatBubble({msg,myUid,isAdmin,T,onReact,onDelete}){
  const isSystem=msg.type==="system";
  const isMe=msg.authorId===myUid;
  const EMOJI_LIST=["🔥","👏","😮","🎉","😂","👍"];
  const [showPicker,setShowPicker]=useState(false);
  const reactions=msg.reactions||{};

  const typeColor={matchDecision:T.red,birdie:T.blue,leadChange:T.gold,halftime:T.muted,equalize:T.muted,everyHole:T.faint};
  const typeBg={matchDecision:T.red+"18",birdie:T.blue+"18",leadChange:T.gold+"18",halftime:T.elevated,equalize:T.elevated,everyHole:T.elevated};

  const ReactionBar=()=>(
    <div style={{display:"flex",gap:"4px",marginTop:"4px",flexWrap:"wrap",paddingLeft:"4px"}}>
      {Object.entries(reactions).map(([e,users])=>users.length>0&&(
        <button key={e} onClick={()=>onReact(msg.id,e)} style={{background:users.includes(myUid)?T.gold+"33":T.elevated,border:`1px solid ${users.includes(myUid)?T.gold:T.border}`,borderRadius:"12px",padding:"2px 7px",fontSize:"10px",cursor:"pointer",color:T.cream,display:"flex",alignItems:"center",gap:"3px"}}>
          {e}<span style={{color:T.faint}}>{users.length}</span>
        </button>
      ))}
      <div style={{position:"relative"}}>
        <button onClick={()=>setShowPicker(p=>!p)} style={{background:"transparent",border:`1px solid ${T.border}44`,borderRadius:"12px",padding:"2px 7px",fontSize:"10px",cursor:"pointer",color:T.faint}}>+</button>
        {showPicker&&(
          <div style={{position:"absolute",bottom:"24px",left:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"6px",display:"flex",gap:"4px",zIndex:20,boxShadow:"0 4px 16px rgba(0,0,0,0.3)"}}>
            {EMOJI_LIST.map(e=><button key={e} onClick={()=>{onReact(msg.id,e);setShowPicker(false);}} style={{background:"none",border:"none",fontSize:"16px",cursor:"pointer",padding:"2px 3px"}}>{e}</button>)}
          </div>
        )}
      </div>
      {isAdmin&&onDelete&&<button onClick={()=>onDelete(msg.id)} style={{background:"transparent",border:`1px solid #E0525233`,borderRadius:"12px",padding:"2px 7px",fontSize:"9px",cursor:"pointer",color:"#E05252",marginLeft:"auto"}}>🗑</button>}
    </div>
  );

  if(isSystem){
    const bg=typeBg[msg.subtype]||T.elevated;
    const border=typeColor[msg.subtype]||T.border;
    return(
      <div style={{marginBottom:"8px"}}>
        <div style={{background:bg,border:`1px solid ${border}44`,borderLeft:`3px solid ${border}`,borderRadius:"0 8px 8px 0",padding:"7px 10px"}}>
          <div style={{fontSize:"11px",color:T.cream,lineHeight:1.4}}>{msg.text}</div>
          <div style={{fontSize:"9px",color:T.faint,marginTop:"3px"}}>{new Date(msg.ts).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}</div>
        </div>
        <ReactionBar/>
      </div>
    );
  }

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:isMe?"flex-end":"flex-start",marginBottom:"8px"}}>
      {!isMe&&(
        <div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"3px",paddingLeft:"4px"}}>
          {msg.photo?<img src={msg.photo} style={{width:"18px",height:"18px",borderRadius:"50%",objectFit:"cover"}} alt=""/>
            :<div style={{width:"18px",height:"18px",borderRadius:"50%",background:T.elevated,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"9px",color:T.muted}}>{(msg.author||"?")[0]}</div>}
          <div style={{fontSize:"9px",color:T.faint}}>{msg.author}</div>
        </div>
      )}
      <div style={{maxWidth:"80%",background:isMe?T.gold:T.elevated,border:`1px solid ${isMe?T.gold+"55":T.border}`,borderRadius:isMe?"12px 12px 2px 12px":"12px 12px 12px 2px",padding:"8px 10px"}}>
        <div style={{fontSize:"12px",color:isMe?(T.isDark?"#0D2B1A":T.cream):T.cream,lineHeight:1.4}}>{msg.text}</div>
        <div style={{fontSize:"9px",color:isMe?(T.isDark?"#0D2B1A44":"rgba(255,255,255,0.5)"):T.faint,marginTop:"3px",textAlign:isMe?"right":"left"}}>{new Date(msg.ts).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}</div>
      </div>
      <ReactionBar/>
    </div>
  );
}

// ── Notification Settings ─────────────────────────────────────────────────────
function NotifSettings({prefs,onUpdate,T}){
  const rows=[
    {key:"matchDecision",label:"Match-Entscheidungen",sub:"4&3, 1UP, Runde gewonnen"},
    {key:"birdie",label:"Birdie & Eagle",sub:"Besondere Schläge"},
    {key:"leadChange",label:"Lead-Wechsel",sub:"Wenn Führung wechselt"},
    {key:"halftime",label:"Halbzeit-Zusammenfassung",sub:"Nach Runde 1"},
    {key:"equalize",label:"Ausgleich (AS)",sub:"Wenn Match gleichsteht"},
    {key:"everyHole",label:"Jedes Loch-Ergebnis",sub:"Alle Scores in Echtzeit"},
  ];
  return(
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"10px"}}>
      <div style={{fontSize:"10px",color:T.gold,letterSpacing:"1px",fontWeight:"700",marginBottom:"10px",display:"flex",alignItems:"center",gap:"6px"}}><IconBell size={12} color={T.gold}/>BENACHRICHTIGUNGEN</div>
      {rows.map(r=>(
        <div key={r.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${T.border}33`}}>
          <div><div style={{fontSize:"12px",color:T.cream}}>{r.label}</div><div style={{fontSize:"10px",color:T.faint}}>{r.sub}</div></div>
          <div onClick={()=>onUpdate({[r.key]:!prefs[r.key]})}
            style={{width:"36px",height:"20px",borderRadius:"10px",background:prefs[r.key]?T.gold:T.border,cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
            <div style={{position:"absolute",top:"3px",left:prefs[r.key]?"18px":"3px",width:"14px",height:"14px",borderRadius:"50%",background:"white",transition:"left 0.2s"}}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── LiveChat main component ───────────────────────────────────────────────────
function LiveChat({role,T,mini=true,onExpand}){
  const msgs=useChatMessages();
  const [prefs,updatePrefs]=useChatPrefs();
  const [profile,saveProfile]=useChatProfile();
  const [text,setText]=useState("");
  const [showSettings,setShowSettings]=useState(false);
  const [showProfileEdit,setShowProfileEdit]=useState(false);
  const scrollRef=useRef(null);
  const isAdmin=role==="admin";
  // unique uid per browser session + role
  const myUid=`${role}_${typeof window!=="undefined"?(localStorage.getItem("ryder_uid")||(()=>{const u="u"+Math.random().toString(36).slice(2);try{localStorage.setItem("ryder_uid",u);}catch(e){}return u;})()):"anon"}`;

  // Filter by prefs
  const visible=msgs.filter(m=>{
    if(m.type!=="system")return true;
    return prefs[m.subtype]!==false;
  });

  useEffect(()=>{
    if(scrollRef.current&&!mini){scrollRef.current.scrollTop=scrollRef.current.scrollHeight;}
  },[visible.length,mini]);

  const send=async()=>{
    if(!text.trim())return;
    const p=profile||{name:role==="admin"?"Admin":role==="viewer"?"Zuschauer":`Spieler ${parseInt(role.split("-")[1])+1}`,photo:null};
    await postChatMessage({type:"user",author:p.name,photo:p.photo||null,authorId:myUid,text:text.trim()});
    setText("");
  };

  const react=async(msgId,emoji)=>{
    const msg=msgs.find(m=>m.id===msgId);if(!msg)return;
    const reactions={...msg.reactions||{}};
    const users=reactions[emoji]||[];
    reactions[emoji]=users.includes(myUid)?users.filter(u=>u!==myUid):[...users,myUid];
    try{await setDoc(doc(db,"liveChat",msgId),{reactions},{merge:true});}catch(e){}
  };

  const deleteMsg=async(msgId)=>{
    try{await deleteDoc(doc(db,"liveChat",msgId));}catch(e){}
  };

  const unreadCount=visible.filter(m=>m.type==="system").length;

  // Profile setup gate — shown on first open of full chat
  if(!mini&&!profile&&!showProfileEdit){
    return <ChatProfileSetup role={role} T={T} onDone={p=>{saveProfile(p);}}/>;
  }
  if(!mini&&showProfileEdit){
    return(
      <div>
        <ChatProfileSetup role={role} T={T} onDone={p=>{saveProfile(p);setShowProfileEdit(false);}}/>
        <button onClick={()=>setShowProfileEdit(false)} style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"12px",cursor:"pointer",marginTop:"8px"}}>Abbrechen</button>
      </div>
    );
  }

  // ── Mini View (only shown when chat tab is NOT active) ─────────────────────
  if(mini){
    const last3=visible.slice(-3);
    return(
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",marginBottom:"14px",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:`1px solid ${T.border}33`,background:T.isDark?"#0A2014":T.elevated}}>
          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#4CAF50"}}/>
            <span style={{fontSize:"10px",color:T.gold,fontWeight:"700",letterSpacing:"1px"}}>💬 LIVE CHAT</span>
          </div>
          <button onClick={onExpand} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",padding:"4px 8px",color:T.muted,cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}>
            <IconExpand size={11} color={T.muted}/>Öffnen
          </button>
        </div>
        <div style={{padding:"8px 12px",maxHeight:"140px",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
          {last3.length===0&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",padding:"12px 0"}}>Noch keine Nachrichten</div>}
          {last3.map(m=><ChatBubble key={m.id} msg={m} myUid={myUid} isAdmin={isAdmin} T={T} onReact={react}/>)}
        </div>
        <div style={{display:"flex",gap:"6px",padding:"6px 10px",borderTop:`1px solid ${T.border}33`}}>
          <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Kommentar..." style={{flex:1,background:T.isDark?"#0A2014":T.elevated,border:`1px solid ${T.border}`,borderRadius:"6px",color:T.cream,fontSize:"12px",padding:"6px 10px",outline:"none"}}/>
          <button onClick={send} style={{background:T.gold,border:"none",borderRadius:"6px",padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center"}}><IconSend size={12} color={T.isDark?"#0D2B1A":"white"}/></button>
        </div>
      </div>
    );
  }

  // ── Full View (Chat Tab) ───────────────────────────────────────────────────
  const avatarPhoto=profile?.photo;
  const avatarName=profile?.name||"?";
  return(
    <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
          <div style={{fontSize:"10px",color:T.gold,letterSpacing:"1px",fontWeight:"700"}}>💬 LIVE CHAT · {unreadCount} EVENTS</div>
        </div>
        <div style={{display:"flex",gap:"6px"}}>
          <button onClick={()=>setShowProfileEdit(true)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",padding:"5px 8px",color:T.muted,cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}>
            {avatarPhoto?<img src={avatarPhoto} style={{width:"16px",height:"16px",borderRadius:"50%",objectFit:"cover"}} alt=""/>
              :<div style={{width:"16px",height:"16px",borderRadius:"50%",background:T.elevated,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"8px",color:T.muted}}>{avatarName[0]}</div>}
            {avatarName}
          </button>
          <button onClick={()=>setShowSettings(s=>!s)} style={{background:"transparent",border:`1px solid ${showSettings?T.gold:T.border}`,borderRadius:"6px",padding:"5px 8px",color:showSettings?T.gold:T.muted,cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}>
            <IconGear size={13} color={showSettings?T.gold:T.muted}/>
          </button>
        </div>
      </div>

      {showSettings&&<NotifSettings prefs={prefs} onUpdate={updatePrefs} T={T}/>}

      <div ref={scrollRef} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"10px 12px",height:"420px",overflowY:"auto",WebkitOverflowScrolling:"touch",display:"flex",flexDirection:"column",justifyContent:visible.length<6?"flex-end":"flex-start"}}>
        {visible.length===0&&(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <div style={{fontSize:"32px",marginBottom:"8px"}}>💬</div>
            <div style={{fontSize:"13px",color:T.gold,marginBottom:"4px"}}>Noch keine Nachrichten</div>
            <div style={{fontSize:"11px",color:T.faint}}>System-Events erscheinen hier sobald Scores eingetragen werden.</div>
          </div>
        )}
        {visible.map(m=><ChatBubble key={m.id} msg={m} myUid={myUid} isAdmin={isAdmin} T={T} onReact={react} onDelete={isAdmin?deleteMsg:null}/>)}
      </div>

      <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
        {avatarPhoto?<img src={avatarPhoto} style={{width:"32px",height:"32px",borderRadius:"50%",objectFit:"cover",flexShrink:0}} alt=""/>
          :<div style={{width:"32px",height:"32px",borderRadius:"50%",background:T.elevated,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",color:T.muted,flexShrink:0}}>{avatarName[0]}</div>}
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder={`Schreiben als ${avatarName}...`} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"13px",padding:"10px 14px",outline:"none"}}/>
        <button onClick={send} style={{background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",padding:"10px 12px",cursor:"pointer",display:"flex",alignItems:"center",flexShrink:0}}>
          <IconSend size={14} color={T.isDark?"#0D2B1A":"white"}/>
        </button>
      </div>
    </div>
  );
}

// ── Theme Toggle (sun/moon) ───────────────────────────────────────────────────
function ThemeToggle({theme,onToggle}){
  const isDark=theme==="dark";
  return(
    <button onClick={onToggle}
      style={{display:"flex",alignItems:"center",gap:"5px",background:isDark?"#1A4D2E":"#E8F5E9",border:`1.5px solid ${isDark?"#C9A84C55":"#2E7D3255"}`,borderRadius:"20px",padding:"4px 8px 4px 4px",cursor:"pointer",height:"28px",position:"relative",transition:"all 0.3s",flexShrink:0}}>
      <div style={{width:"20px",height:"20px",borderRadius:"50%",background:isDark?"#C9A84C":"#2E7D32",flexShrink:0,transition:"background 0.3s",boxShadow:"0 1px 4px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px"}}>
        {isDark?"🌙":"☀️"}
      </div>
      <span style={{fontSize:"10px",fontWeight:"700",color:isDark?"#C9A84C":"#2E7D32",letterSpacing:"0.5px",whiteSpace:"nowrap"}}>
        {isDark?"Nacht":"Tag"}
      </span>
    </button>
  );
}

// ── Player Avatar ─────────────────────────────────────────────────────────────
function PlayerAvatar({name,size=36,color,photo}){
  const initials=(name||"?").split(" ").map(p=>p[0]||"").slice(0,2).join("").toUpperCase();
  return(
    <div style={{width:size,height:size,borderRadius:"50%",background:color+"22",border:`1.5px solid ${color}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,overflow:"hidden"}}>
      {photo?<img src={photo} alt={name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        :<span style={{fontSize:size*0.36,fontWeight:"700",color,fontFamily:"Arial,sans-serif"}}>{initials}</span>}
    </div>
  );
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti({active,onDone}){
  const canvasRef=useRef(null);
  useEffect(()=>{
    if(!active)return;
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");canvas.width=window.innerWidth;canvas.height=window.innerHeight;
    const pieces=Array.from({length:120},()=>({x:Math.random()*canvas.width,y:-20,w:8+Math.random()*8,h:8+Math.random()*8,r:Math.random()*Math.PI*2,dr:(Math.random()-0.5)*0.2,dx:(Math.random()-0.5)*4,dy:3+Math.random()*4,color:["#C9A84C","#4A9EFF","#FF6B6B","#8BAF7C","#F2EDD7","#FFD700"][Math.floor(Math.random()*6)],opacity:1}));
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
    <div style={{position:"fixed",top:"80px",left:"50%",transform:"translateX(-50%)",zIndex:501,textAlign:"center",pointerEvents:"none",width:"90%",maxWidth:"360px"}}>
      <div style={{background:event.winner?"linear-gradient(135deg,#C9A84C,#A07830)":"linear-gradient(135deg,#2D6B40,#1A4D2E)",borderRadius:"16px",padding:"18px 24px",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",border:"2px solid rgba(255,255,255,0.2)"}}>
        <div style={{fontSize:"36px",marginBottom:"6px"}}>{event.winner?"🏆":"🤝"}</div>
        <div style={{fontSize:"18px",fontWeight:"900",color:event.winner?"#0D2B1A":"#F2EDD7",fontFamily:"'Arial Black',sans-serif"}}>{event.title}</div>
        <div style={{fontSize:"12px",color:event.winner?"rgba(0,0,0,0.6)":"#8BAF7C",marginTop:"4px"}}>{event.body}</div>
      </div>
    </div>
  );
}

// ── Header (sticky, no back-confirmation popup, theme toggle built in) ────────
function Header({title,subtitle,onBack,backLabel,rightSlot,theme,onThemeToggle,T}){
  return(
    <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"0 14px",height:"60px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
      <div style={{width:"80px",display:"flex",alignItems:"center"}}>
        {onBack&&(
          <button onClick={onBack} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"6px",color:"rgba(255,255,255,0.7)",fontSize:"11px",padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px",whiteSpace:"nowrap"}}>
            <IconBack size={11} color="rgba(255,255,255,0.7)"/>{backLabel||"Zurück"}
          </button>
        )}
      </div>
      <div style={{textAlign:"center",flex:1}}>
        <div style={{fontSize:"17px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>⛳ {title}</div>
        {subtitle&&<div style={{fontSize:"9px",color:"rgba(255,255,255,0.45)",letterSpacing:"2px",marginTop:"2px"}}>{subtitle}</div>}
      </div>
      <div style={{width:"80px",display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"6px"}}>
        {onThemeToggle&&<ThemeToggle theme={theme} onToggle={onThemeToggle}/>}
        {rightSlot}
      </div>
    </div>
  );
}

function ResetConfirm({title,message,onConfirm,onClose,T,confirmLabel="Ja, zurücksetzen",danger=true}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"44px",height:"44px",borderRadius:"50%",background:danger?"#E0525222":"#C9A84C22",border:`1px solid ${danger?"#E0525255":"#C9A84C55"}`,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><IconReset size={22} color={danger?"#E05252":"#C9A84C"}/></div>
        <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,marginBottom:"6px"}}>{title}</div>
        <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px"}}>{message}</div>
        <button style={{width:"100%",padding:"11px",background:danger?"#E05252":"linear-gradient(135deg,#C9A84C,#A07830)",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px"}} onClick={onConfirm}>{confirmLabel}</button>
        <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

function RoleBadge({role,T}){
  const isAdmin=role==="admin",isViewer=role==="viewer";
  const num=!isAdmin&&!isViewer?parseInt(role.split("-")[1])+1:null;
  const label=isAdmin?"👑 Admin":isViewer?"👁 Zuschauer":`⛳ Match ${num}`;
  const color=isAdmin?T.gold:isViewer?T.muted:T.blue;
  return<div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"3px 10px",fontSize:"10px",color,letterSpacing:"1px"}}>{label}</div>;
}

function PushBanner({onDismiss,T}){
  const [state,setState]=useState("idle");
  const req=async()=>{setState("requesting");if(!("Notification"in window)||!messaging){setState("unsupported");return;}try{const p=await Notification.requestPermission();if(p==="granted"){await registerFCMToken();setState("granted");setTimeout(onDismiss,2000);}else setState("denied");}catch(e){setState("denied");}};
  if(state==="granted")return<div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}><span>✅</span><div style={{fontSize:"12px",color:T.muted}}>Push aktiviert!</div></div>;
  if(state==="denied"||state==="unsupported")return<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px"}}><div style={{fontSize:"12px",color:"#E05252",marginBottom:"4px"}}>{state==="unsupported"?"❌ Bitte App als PWA installieren":"❌ Benachrichtigungen blockiert"}</div><button style={{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer",marginTop:"8px"}} onClick={onDismiss}>Schließen</button></div>;
  return(
    <div style={{background:T.isDark?"linear-gradient(135deg,#1A3D2E,#0F2D1A)":T.elevated,border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"10px"}}><span style={{fontSize:"22px"}}>🔔</span><div><div style={{fontSize:"13px",fontWeight:"700",color:T.gold,marginBottom:"3px"}}>Push-Benachrichtigungen</div><div style={{fontSize:"11px",color:T.muted}}>Erhalte eine Meldung wenn ein Team einen Punkt gewinnt.</div></div></div>
      <div style={{display:"flex",gap:"8px"}}>
        <button style={{flex:1,padding:"10px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"12px",fontWeight:"900",cursor:"pointer"}} onClick={req} disabled={state==="requesting"}>{state==="requesting"?"Warte...":"🔔 Aktivieren"}</button>
        <button style={{padding:"10px 14px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"12px",cursor:"pointer"}} onClick={onDismiss}>Später</button>
      </div>
    </div>
  );
}

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
function Login({onLogin,theme,onThemeToggle}){
  const [code,setCode]=useState(""),[error,setError]=useState("");
  const check=()=>{const r=resolveRole(code);if(r)onLogin(r);else setError("Ungültiger Code");};
  const T=THEMES[theme];
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:"320px",textAlign:"center"}}>
        <div style={{position:"fixed",top:"16px",right:"16px"}}><ThemeToggle theme={theme} onToggle={onThemeToggle}/></div>
        <div style={{fontSize:"56px",marginBottom:"10px"}}>⛳</div>
        <div style={{fontSize:"26px",fontWeight:"900",color:T.gold,letterSpacing:"4px",textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Ryder Cup</div>
        <div style={{fontSize:"11px",color:T.muted,letterSpacing:"2px",marginBottom:"4px"}}>Friends Edition</div>
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
// PLAYER MANAGER
// ══════════════════════════════════════════════════════════════════════════════
function PlayerManager({onBack,T,theme,onThemeToggle}){
  const [players,setPlayers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [editingId,setEditingId]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [fn,setFn]=useState(""); const [ln,setLn]=useState(""); const [hcp,setHcp]=useState(""); const [photo,setPhoto]=useState(null);
  const [saving,setSaving]=useState(false); const [confirmDelete,setConfirmDelete]=useState(null);
  const [cropSrc,setCropSrc]=useState(null); const [cropScale,setCropScale]=useState(1);

  useEffect(()=>{getDocs(collection(db,"savedPlayers")).then(snap=>{setPlayers(snap.docs.map(d=>({id:d.id,...d.data()})));setLoading(false);}).catch(()=>setLoading(false));},[]);

  const handlePhotoChange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=ev=>{setCropSrc(ev.target.result);setCropScale(1);};reader.readAsDataURL(file);};
  const cropAndSave=()=>{
    const size=200;const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
    const ctx=canvas.getContext("2d");const img=new Image();
    img.onload=()=>{const s=Math.min(img.width,img.height)*cropScale;const sx=(img.width-s)/2;const sy=(img.height-s)/2;ctx.beginPath();ctx.arc(size/2,size/2,size/2,0,Math.PI*2);ctx.clip();ctx.drawImage(img,sx,sy,s,s,0,0,size,size);setPhoto(canvas.toDataURL("image/jpeg",0.8));setCropSrc(null);};
    img.src=cropSrc;
  };
  const startEdit=p=>{setEditingId(p.id);setFn(p.fn||"");setLn(p.ln||"");setHcp(p.hcp||"");setPhoto(p.photo||null);setShowForm(true);};
  const resetForm=()=>{setEditingId(null);setFn("");setLn("");setHcp("");setPhoto(null);setShowForm(false);};
  const savePlayer=async()=>{
    if(!fn.trim()||!ln.trim())return;setSaving(true);
    const id=editingId||("p"+Date.now());const data={fn:fn.trim(),ln:ln.trim(),hcp:hcp||"",photo:photo||null};
    await setDoc(doc(db,"savedPlayers",id),data).catch(()=>{});
    if(editingId){setPlayers(prev=>prev.map(p=>p.id===id?{id,...data}:p));}else{setPlayers(prev=>[...prev,{id,...data}]);}
    setSaving(false);resetForm();
  };
  const deletePlayer=async id=>{await deleteDoc(doc(db,"savedPlayers",id)).catch(()=>{});setPlayers(prev=>prev.filter(p=>p.id!==id));setConfirmDelete(null);};
  const inp={background:T.isDark?"#0A2014":T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",padding:"10px 12px",outline:"none",boxSizing:"border-box",width:"100%",marginBottom:"10px"};

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Header title="Spieler" subtitle="VERWALTUNG" onBack={onBack} backLabel="Menü" theme={theme} onThemeToggle={onThemeToggle} T={T}/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {!showForm?(
          <>
            <button onClick={()=>setShowForm(true)} style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",marginBottom:"14px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}}>
              <IconPlus size={16} color={T.isDark?"#0D2B1A":"white"}/> Spieler hinzufügen
            </button>
            {loading&&<div style={{textAlign:"center",padding:"20px",color:T.muted}}>Lade...</div>}
            {!loading&&players.length===0&&<div style={{textAlign:"center",padding:"40px 20px"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>👤</div><div style={{color:T.gold,fontSize:"16px",marginBottom:"8px"}}>Noch keine Spieler</div><div style={{color:T.muted,fontSize:"13px"}}>Füge Spieler hinzu um sie in Turnieren zu verwenden</div></div>}
            {players.map(p=>(
              <div key={p.id} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"12px 14px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"12px"}}>
                <PlayerAvatar name={(p.fn||"")+" "+(p.ln||"")} size={48} color={T.blue} photo={p.photo}/>
                <div style={{flex:1}}><div style={{fontSize:"14px",fontWeight:"700",color:T.cream}}>{p.fn} {p.ln}</div><div style={{fontSize:"11px",color:T.muted}}>{p.hcp?`HCP ${p.hcp}`:"Kein HCP"}</div></div>
                <div style={{display:"flex",gap:"6px"}}>
                  <button onClick={()=>startEdit(p)} style={{padding:"7px 12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"11px",cursor:"pointer"}}>✏️</button>
                  <button onClick={()=>setConfirmDelete(p)} style={{padding:"7px 10px",background:"transparent",border:"1px solid #E0525244",borderRadius:"6px",color:"#E05252",cursor:"pointer"}}><IconTrash size={14} color="#E05252"/></button>
                </div>
              </div>
            ))}
          </>
        ):(
          <div>
            <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,marginBottom:"16px"}}>{editingId?"Spieler bearbeiten":"Neuer Spieler"}</div>
            <div style={{display:"flex",justifyContent:"center",marginBottom:"16px"}}>
              <div style={{position:"relative"}}>
                <PlayerAvatar name={(fn||"?")+(" "+(ln||""))} size={80} color={T.blue} photo={photo}/>
                <label style={{position:"absolute",bottom:0,right:0,width:"28px",height:"28px",background:`linear-gradient(135deg,${T.gold},#A07830)`,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D2B1A" strokeWidth="2.5" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  <input type="file" accept="image/*" onChange={handlePhotoChange} style={{display:"none"}}/>
                </label>
              </div>
            </div>
            <div style={{fontSize:"10px",color:T.faint,textAlign:"center",marginBottom:"16px"}}>Tippe das Kamera-Icon für Foto</div>
            {[["VORNAME *",fn,setFn,"Vorname"],["NACHNAME *",ln,setLn,"Nachname"],["HANDICAP",hcp,setHcp,"z.B. 8.4"]].map(([lbl,val,setter,ph])=>(
              <div key={lbl}><div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"4px"}}>{lbl}</div><input style={inp} placeholder={ph} value={val} onChange={e=>setter(e.target.value)}/></div>
            ))}
            <button onClick={savePlayer} disabled={!fn.trim()||!ln.trim()||saving}
              style={{width:"100%",padding:"13px",background:(!fn.trim()||!ln.trim())?T.elevated:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:(!fn.trim()||!ln.trim())?T.muted:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",marginBottom:"8px",opacity:(!fn.trim()||!ln.trim())?0.5:1}}>
              {saving?"Speichere...":"Speichern"}
            </button>
            <button onClick={resetForm} style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}}>Abbrechen</button>
          </div>
        )}
      </div>
      {cropSrc&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:400,padding:"20px"}}>
          <div style={{fontSize:"14px",fontWeight:"700",color:T.gold,marginBottom:"16px"}}>Foto zuschneiden</div>
          <div style={{position:"relative",width:"200px",height:"200px",borderRadius:"50%",overflow:"hidden",border:`3px solid ${T.gold}`,marginBottom:"16px"}}><img src={cropSrc} style={{width:"100%",height:"100%",objectFit:"cover",transform:`scale(${cropScale})`,transformOrigin:"center"}} alt="crop"/></div>
          <div style={{width:"100%",maxWidth:"280px",marginBottom:"16px"}}><div style={{fontSize:"10px",color:T.muted,marginBottom:"4px"}}>Zoom</div><input type="range" min="1" max="3" step="0.05" value={cropScale} onChange={e=>setCropScale(Number(e.target.value))} style={{width:"100%",accentColor:T.gold}}/></div>
          <div style={{display:"flex",gap:"10px",width:"100%",maxWidth:"280px"}}>
            <button onClick={cropAndSave} style={{flex:1,padding:"12px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"13px",fontWeight:"900",cursor:"pointer"}}>Übernehmen ✓</button>
            <button onClick={()=>setCropSrc(null)} style={{flex:1,padding:"12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}}>Abbrechen</button>
          </div>
        </div>
      )}
      {confirmDelete&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}} onClick={()=>setConfirmDelete(null)}>
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>🗑</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,marginBottom:"6px"}}>{confirmDelete.fn} {confirmDelete.ln} löschen?</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px"}}>Der Spieler wird aus dem Pool entfernt.</div>
            <button style={{width:"100%",padding:"11px",background:"#E05252",border:"none",borderRadius:"8px",color:"white",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px"}} onClick={()=>deletePlayer(confirmDelete.id)}>Ja, löschen</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={()=>setConfirmDelete(null)}>Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TOURNAMENT PLANNING  – supports 1v1 and 2v2 per match format
// ══════════════════════════════════════════════════════════════════════════════
function TournamentPlanning({onStart,onBack,T,theme,onThemeToggle}){
  const [tab,setTab]=useState(0);
  const [saving,setSaving]=useState(false);

  // Tab 0 – Settings
  const [t1Name,setT1Name]=useState("Team Europa");
  const [t2Name,setT2Name]=useState("Team USA");
  const [numDays,setNumDays]=useState(2);
  const [matchesPerDay,setMatchesPerDay]=useState(4);
  const [matchFormat,setMatchFormat]=useState("1v1"); // "1v1" | "2v2"
  const [daySettings,setDaySettings]=useState([{courseKey:"riedhof",mode:"scramble"},{courseKey:"bergkramerhof",mode:"scramble"}]);

  const updateDays=nd=>{setNumDays(nd);setDaySettings(prev=>{const next=[];for(let i=0;i<nd;i++)next.push(prev[i]||{courseKey:"riedhof",mode:"scramble"});return next;});};
  const setDayCourse=(i,key)=>setDaySettings(prev=>prev.map((d,idx)=>idx===i?{...d,courseKey:key}:d));
  const setDayMode=(i,mode)=>setDaySettings(prev=>prev.map((d,idx)=>idx===i?{...d,mode}:d));
  const playersPerSlot=matchFormat==="2v2"?2:1;

  // Tab 1 – Players
  const [allSavedPlayers,setAllSavedPlayers]=useState([]);
  const [playersLoaded,setPlayersLoaded]=useState(false);
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [team1Ids,setTeam1Ids]=useState(new Set());
  const [team2Ids,setTeam2Ids]=useState(new Set());
  const [captainT1,setCaptainT1]=useState(null);
  const [captainT2,setCaptainT2]=useState(null);
  const [showAddPlayer,setShowAddPlayer]=useState(false);
  const [newFn,setNewFn]=useState(""); const [newLn,setNewLn]=useState(""); const [newHcp,setNewHcp]=useState(""); const [addingPlayer,setAddingPlayer]=useState(false);

  useEffect(()=>{if(!playersLoaded){getDocs(collection(db,"savedPlayers")).then(snap=>{setAllSavedPlayers(snap.docs.map(d=>({id:d.id,...d.data()})));setPlayersLoaded(true);}).catch(()=>setPlayersLoaded(true));}},[playersLoaded]);

  const allSelected=allSavedPlayers.length>0&&allSavedPlayers.every(p=>selectedIds.has(p.id));
  const toggleSelectAll=()=>{if(allSelected){setSelectedIds(new Set());setTeam1Ids(new Set());setTeam2Ids(new Set());setCaptainT1(null);setCaptainT2(null);}else{setSelectedIds(new Set(allSavedPlayers.map(p=>p.id)));}};
  const toggleSelect=id=>{setSelectedIds(prev=>{const next=new Set(prev);if(next.has(id)){next.delete(id);setTeam1Ids(t=>{const n=new Set(t);n.delete(id);return n;});setTeam2Ids(t=>{const n=new Set(t);n.delete(id);return n;});if(captainT1===id)setCaptainT1(null);if(captainT2===id)setCaptainT2(null);}else next.add(id);return next;});};
  const assignTeam=(id,team)=>{if(team==="t1"){setTeam1Ids(p=>{const n=new Set(p);n.add(id);return n;});setTeam2Ids(p=>{const n=new Set(p);n.delete(id);return n;});if(captainT2===id)setCaptainT2(null);}else{setTeam2Ids(p=>{const n=new Set(p);n.add(id);return n;});setTeam1Ids(p=>{const n=new Set(p);n.delete(id);return n;});if(captainT1===id)setCaptainT1(null);}};
  const toggleCaptain=(id,team)=>{if(team==="t1"){setCaptainT1(prev=>prev===id?null:id);}else{setCaptainT2(prev=>prev===id?null:id);}};
  const addNewPlayer=async()=>{
    if(!newFn.trim()||!newLn.trim())return;setAddingPlayer(true);
    const id="p"+Date.now();const data={fn:newFn.trim(),ln:newLn.trim(),hcp:newHcp||"",photo:null};
    await setDoc(doc(db,"savedPlayers",id),data).catch(()=>{});
    setAllSavedPlayers(prev=>[...prev,{id,...data}]);setSelectedIds(prev=>new Set([...prev,id]));
    setNewFn("");setNewLn("");setNewHcp("");setShowAddPlayer(false);setAddingPlayer(false);
  };
  const selectedPlayers=allSavedPlayers.filter(p=>selectedIds.has(p.id));
  const t1Players=selectedPlayers.filter(p=>team1Ids.has(p.id));
  const t2Players=selectedPlayers.filter(p=>team2Ids.has(p.id));
  const unassigned=selectedPlayers.filter(p=>!team1Ids.has(p.id)&&!team2Ids.has(p.id));

  // Tab 2 – Match assignment
  // matchAssign[dayIdx][matchIdx] = { t1Players: [id,...], t2Players: [id,...] }
  const makeEmptyMatch=()=>({t1Players:[],t2Players:[]});
  const [matchAssign,setMatchAssign]=useState(()=>Array.from({length:2},()=>Array.from({length:4},makeEmptyMatch)));
  const [activeDay2,setActiveDay2]=useState(0);
  // pickingSlot: { dayIdx, matchIdx, team, slotIdx }  slotIdx = 0|1 for 2v2
  const [pickingSlot,setPickingSlot]=useState(null);

  useEffect(()=>{setMatchAssign(prev=>Array.from({length:numDays},(_,di)=>Array.from({length:matchesPerDay},(_,mi)=>prev[di]?.[mi]||makeEmptyMatch())));},[numDays,matchesPerDay]);

  const usedOnDay=dayIdx=>{const used=new Set();(matchAssign[dayIdx]||[]).forEach(m=>{m.t1Players.forEach(id=>used.add(id));m.t2Players.forEach(id=>used.add(id));});return used;};

  const assignPlayerToSlot=playerId=>{
    if(!pickingSlot)return;
    const{dayIdx,matchIdx,team,slotIdx}=pickingSlot;
    setMatchAssign(prev=>{
      const next=prev.map(d=>d.map(m=>({t1Players:[...m.t1Players],t2Players:[...m.t2Players]})));
      // remove from other slots same day
      next[dayIdx]=next[dayIdx].map((m,mi)=>{
        if(mi===matchIdx)return m;
        return{t1Players:m.t1Players.filter(id=>id!==playerId),t2Players:m.t2Players.filter(id=>id!==playerId)};
      });
      const slot=next[dayIdx][matchIdx];
      const arr=team==="t1"?slot.t1Players:slot.t2Players;
      arr[slotIdx]=playerId;
      return next;
    });
    setPickingSlot(null);
  };

  const clearSlotPlayer=(dayIdx,matchIdx,team,slotIdx)=>{
    setMatchAssign(prev=>{
      const next=prev.map(d=>d.map(m=>({t1Players:[...m.t1Players],t2Players:[...m.t2Players]})));
      const arr=team==="t1"?next[dayIdx][matchIdx].t1Players:next[dayIdx][matchIdx].t2Players;
      arr[slotIdx]=undefined;
      return next;
    });
  };

  const matchFilled=m=>{
    for(let i=0;i<playersPerSlot;i++){if(!m.t1Players[i]||!m.t2Players[i])return false;}
    return true;
  };
  const allMatchesFilled=matchAssign.slice(0,numDays).every(day=>day.every(matchFilled));
  const tab0ok=t1Name.trim()&&t2Name.trim();
  const tab1ok=t1Players.length>=playersPerSlot&&t2Players.length>=playersPerSlot&&unassigned.length===0&&selectedIds.size>=2;

  const handleStart=async()=>{
    if(!allMatchesFilled)return;setSaving(true);
    const playerMap={};allSavedPlayers.forEach(p=>{playerMap[p.id]=p;});
    const days=daySettings.slice(0,numDays).map((ds,di)=>{
      const mode=ds.mode;
      const matches=matchAssign[di].map((ma,mi)=>{
        const p1a=playerMap[ma.t1Players[0]];const p1b=playerMap[ma.t1Players[1]];
        const p2a=playerMap[ma.t2Players[0]];const p2b=playerMap[ma.t2Players[1]];
        const t1Pair=[p1a?`${p1a.fn} ${p1a.ln}`:"?",p1b?`${p1b.fn} ${p1b.ln}`:null].filter(Boolean);
        const t2Pair=[p2a?`${p2a.fn} ${p2a.ln}`:"?",p2b?`${p2b.fn} ${p2b.ln}`:null].filter(Boolean);
        const t1Photos={};ma.t1Players.forEach(id=>{if(id)t1Photos[id]=playerMap[id]?.photo||null;});
        const t2Photos={};ma.t2Players.forEach(id=>{if(id)t2Photos[id]=playerMap[id]?.photo||null;});
        return{
          id:(di*100)+(mi+1),name:`Match ${mi+1}`,pin:`MATCH${(di*matchesPerDay)+(mi+1)}`,mode,matchFormat,
          t1Pair,t2Pair,t1PlayerIds:ma.t1Players.filter(Boolean),t2PlayerIds:ma.t2Players.filter(Boolean),
          t1Photos,t2Photos,
          teamHcp1:p1a?parseFloat(p1a.hcp||0):null,teamHcp2:p2a?parseFloat(p2a.hcp||0):null,
          scores:emptyScores()
        };
      });
      return{id:di,label:`Tag ${di+1} – ${COURSES[ds.courseKey]?.shortName||ds.courseKey}`,courseKey:ds.courseKey,mode,matches};
    });
    const config={t1Name,t2Name,matchFormat,captainT1,captainT2,t1Players:t1Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp,photo:p.photo||null,isCapt:p.id===captainT1})),t2Players:t2Players.map(p=>({id:p.id,fn:p.fn,ln:p.ln,hcp:p.hcp,photo:p.photo||null,isCapt:p.id===captainT2})),days,phase:"game",startedAt:Date.now()};
    await saveTournament(config);setSaving(false);onStart(config);
  };

  const tabLabels=["⚙️ Setup","👥 Spieler","🏌️ Matches"];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Header title="Turnierplanung" onBack={onBack} backLabel="Menü" theme={theme} onThemeToggle={onThemeToggle} T={T}/>
      <div style={{display:"flex",borderBottom:`2px solid ${T.border}`,position:"sticky",top:"60px",zIndex:9,background:T.bg}}>
        {tabLabels.map((l,i)=>(
          <button key={i} onClick={()=>setTab(i)} style={{flex:1,padding:"11px 4px",background:"transparent",border:"none",borderBottom:`3px solid ${tab===i?T.gold:"transparent"}`,color:tab===i?T.gold:T.muted,fontSize:"11px",fontWeight:tab===i?"700":"400",cursor:"pointer",textTransform:"uppercase",marginBottom:"-2px"}}>
            {l}
          </button>
        ))}
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto",paddingBottom:"100px"}}>

        {/* ── TAB 0 ── */}
        {tab===0&&(
          <>
            <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
              <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"10px"}}>TEAMNAMEN</div>
              <div style={{fontSize:"10px",color:T.blue,letterSpacing:"1px",marginBottom:"4px"}}>🔵 TEAM 1</div>
              <input style={{width:"100%",padding:"10px 12px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",boxSizing:"border-box",outline:"none",marginBottom:"10px"}} value={t1Name} onChange={e=>setT1Name(e.target.value)}/>
              <div style={{fontSize:"10px",color:T.red,letterSpacing:"1px",marginBottom:"4px"}}>🔴 TEAM 2</div>
              <input style={{width:"100%",padding:"10px 12px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",boxSizing:"border-box",outline:"none"}} value={t2Name} onChange={e=>setT2Name(e.target.value)}/>
            </div>

            {/* Match format */}
            <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
              <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"10px"}}>SPIELFORMAT</div>
              <div style={{display:"flex",gap:"8px"}}>
                {[["1v1","👤 1 vs 1","Je 1 Spieler pro Team"],["2v2","👥 2 vs 2","Je 2 Spieler pro Team"]].map(([k,lbl,desc])=>(
                  <button key={k} onClick={()=>setMatchFormat(k)} style={{flex:1,padding:"12px",borderRadius:"10px",border:`2px solid ${matchFormat===k?T.gold:T.border}`,background:matchFormat===k?T.gold+"22":T.elevated,color:matchFormat===k?T.gold:T.muted,cursor:"pointer",textAlign:"center"}}>
                    <div style={{fontSize:"16px",marginBottom:"4px"}}>{lbl}</div>
                    <div style={{fontSize:"10px"}}>{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
              <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"10px"}}>ANZAHL SPIELTAGE</div>
              <div style={{display:"flex",gap:"8px"}}>{[1,2,3,4].map(n=><button key={n} onClick={()=>updateDays(n)} style={{flex:1,padding:"14px",borderRadius:"10px",border:`2px solid ${numDays===n?T.gold:T.border}`,background:numDays===n?T.gold+"22":T.elevated,color:numDays===n?T.gold:T.muted,fontSize:"20px",fontWeight:"900",cursor:"pointer"}}>{n}</button>)}</div>
            </div>
            <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
              <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"10px"}}>MATCHES PRO TAG</div>
              <div style={{display:"flex",gap:"8px"}}>{[2,3,4,5].map(n=><button key={n} onClick={()=>setMatchesPerDay(n)} style={{flex:1,padding:"14px",borderRadius:"10px",border:`2px solid ${matchesPerDay===n?T.gold:T.border}`,background:matchesPerDay===n?T.gold+"22":T.elevated,color:matchesPerDay===n?T.gold:T.muted,fontSize:"20px",fontWeight:"900",cursor:"pointer"}}>{n}</button>)}</div>
              <div style={{fontSize:"11px",color:T.faint,marginTop:"8px",textAlign:"center"}}>{numDays} Tage × {matchesPerDay} Matches × 2 Runden = <span style={{color:T.gold,fontWeight:"700"}}>{numDays*matchesPerDay*2} Punkte</span></div>
            </div>
            {Array.from({length:numDays},(_,di)=>(
              <div key={di} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
                <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,marginBottom:"12px"}}>Tag {di+1}</div>
                <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"6px"}}>GOLFPLATZ</div>
                {Object.values(COURSES).map(c=>(
                  <button key={c.id} onClick={()=>setDayCourse(di,c.id)} style={{display:"flex",alignItems:"center",gap:"10px",padding:"10px 12px",background:daySettings[di]?.courseKey===c.id?T.gold+"18":T.isDark?"#0A2014":T.elevated,border:`1px solid ${daySettings[di]?.courseKey===c.id?T.gold:T.border}`,borderRadius:"8px",marginBottom:"6px",cursor:"pointer",width:"100%",textAlign:"left"}}>
                    <span>⛳</span><div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color:T.cream}}>{c.name}</div><div style={{fontSize:"10px",color:T.faint}}>{c.location} · Par {c.par.reduce((a,b)=>a+b,0)}</div></div>
                    {daySettings[di]?.courseKey===c.id&&<IconCheck size={16} color={T.gold}/>}
                  </button>
                ))}
                <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"6px",marginTop:"10px"}}>SPIELMODUS (alle Matches des Tages)</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                  {Object.entries(GAME_MODES).map(([k,v])=>(
                    <button key={k} onClick={()=>setDayMode(di,k)} style={{padding:"8px 12px",borderRadius:"8px",border:`1px solid ${daySettings[di]?.mode===k?T.gold:T.border}`,background:daySettings[di]?.mode===k?T.gold+"22":T.surface,color:daySettings[di]?.mode===k?T.gold:T.muted,fontSize:"11px",cursor:"pointer"}}>
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button disabled={!tab0ok} onClick={()=>setTab(1)} style={{width:"100%",padding:"13px",background:tab0ok?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"8px",color:tab0ok?T.isDark?"#0D2B1A":"white":T.muted,fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:tab0ok?"pointer":"not-allowed",opacity:tab0ok?1:0.5}}>
              Weiter → Spieler
            </button>
          </>
        )}

        {/* ── TAB 1 ── */}
        {tab===1&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
              <div style={{fontSize:"11px",color:T.muted}}>✅ Haken = dabei · 🔵🔴 Team · 🎖️ Captain</div>
              <button onClick={toggleSelectAll} style={{padding:"6px 12px",borderRadius:"20px",border:`1px solid ${allSelected?T.gold:T.border}`,background:allSelected?T.gold+"22":"transparent",color:allSelected?T.gold:T.muted,fontSize:"11px",fontWeight:allSelected?"700":"400",cursor:"pointer",whiteSpace:"nowrap"}}>
                {allSelected?"✓ Alle":"Alle wählen"}
              </button>
            </div>
            {!playersLoaded&&<div style={{textAlign:"center",padding:"20px",color:T.muted}}>Lade...</div>}
            {playersLoaded&&allSavedPlayers.map(p=>{
              const sel=selectedIds.has(p.id);const inT1=team1Ids.has(p.id);const inT2=team2Ids.has(p.id);
              const isCapt1=captainT1===p.id;const isCapt2=captainT2===p.id;const isCapt=isCapt1||isCapt2;
              return(
                <div key={p.id} style={{background:T.cardBg,border:`1px solid ${isCapt?T.gold:sel?(inT1?T.blue:inT2?T.red:T.gold):T.border}`,borderRadius:"10px",padding:"10px 12px",marginBottom:"8px",display:"flex",alignItems:"center",gap:"8px"}}>
                  <div onClick={()=>toggleSelect(p.id)} style={{width:"26px",height:"26px",borderRadius:"6px",border:`2px solid ${sel?T.gold:T.border}`,background:sel?T.gold+"22":"transparent",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>{sel&&<IconCheck size={14} color={T.gold}/>}</div>
                  <div style={{position:"relative",flexShrink:0}}>
                    <PlayerAvatar name={(p.fn||"")+" "+(p.ln||"")} size={38} color={inT1?T.blue:inT2?T.red:T.muted} photo={p.photo}/>
                    {isCapt&&<div style={{position:"absolute",top:"-6px",right:"-6px",fontSize:"13px",lineHeight:1}}>🎖️</div>}
                  </div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:"13px",fontWeight:"600",color:T.cream,display:"flex",alignItems:"center",gap:"4px"}}>{p.fn} {p.ln}{isCapt&&<span style={{fontSize:"9px",background:T.gold+"33",color:T.gold,borderRadius:"4px",padding:"1px 5px",fontWeight:"700"}}>CAPTAIN</span>}</div><div style={{fontSize:"10px",color:T.faint}}>{p.hcp?`HCP ${p.hcp}`:"—"}</div></div>
                  {sel&&(<div style={{display:"flex",gap:"3px",flexShrink:0}}>
                    <button onClick={()=>assignTeam(p.id,"t1")} style={{padding:"5px 9px",borderRadius:"6px",border:`1px solid ${inT1?T.blue:T.border}`,background:inT1?T.blue+"22":"transparent",color:inT1?T.blue:T.muted,fontSize:"12px",fontWeight:inT1?"700":"400",cursor:"pointer"}}>🔵</button>
                    <button onClick={()=>assignTeam(p.id,"t2")} style={{padding:"5px 9px",borderRadius:"6px",border:`1px solid ${inT2?T.red:T.border}`,background:inT2?T.red+"22":"transparent",color:inT2?T.red:T.muted,fontSize:"12px",fontWeight:inT2?"700":"400",cursor:"pointer"}}>🔴</button>
                    {(inT1||inT2)&&<button onClick={()=>toggleCaptain(p.id,inT1?"t1":"t2")} title="Captain" style={{padding:"5px 8px",borderRadius:"6px",border:`1px solid ${isCapt?T.gold:T.border}`,background:isCapt?T.gold+"22":"transparent",color:isCapt?T.gold:T.faint,fontSize:"12px",cursor:"pointer"}}>🎖️</button>}
                  </div>)}
                </div>
              );
            })}
            {playersLoaded&&allSavedPlayers.length===0&&<div style={{textAlign:"center",padding:"30px",color:T.muted}}>Noch keine Spieler. Bitte zuerst in der Spielerverwaltung anlegen.</div>}
            {!showAddPlayer?(
              <button onClick={()=>setShowAddPlayer(true)} style={{width:"100%",padding:"11px",background:"transparent",border:`1px dashed ${T.gold}55`,borderRadius:"8px",color:T.gold,fontSize:"12px",cursor:"pointer",marginBottom:"14px",display:"flex",alignItems:"center",justifyContent:"center",gap:"6px"}}>
                <IconPlus size={13} color={T.gold}/> Neuen Spieler hinzufügen
              </button>
            ):(
              <div style={{background:T.cardBg,border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
                <div style={{fontSize:"12px",fontWeight:"700",color:T.gold,marginBottom:"10px"}}>Neuer Spieler</div>
                {[["Vorname *",newFn,setNewFn],["Nachname *",newLn,setNewLn],["HCP",newHcp,setNewHcp]].map(([lbl,val,setter])=>(
                  <input key={lbl} placeholder={lbl} value={val} onChange={e=>setter(e.target.value)} style={{width:"100%",padding:"9px 12px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"6px",color:T.cream,fontSize:"13px",boxSizing:"border-box",outline:"none",marginBottom:"8px"}}/>
                ))}
                <div style={{display:"flex",gap:"8px"}}>
                  <button onClick={addNewPlayer} disabled={!newFn.trim()||!newLn.trim()||addingPlayer} style={{flex:1,padding:"10px",background:newFn.trim()&&newLn.trim()?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"6px",color:T.isDark?"#0D2B1A":"white",fontSize:"12px",fontWeight:"700",cursor:"pointer",opacity:newFn.trim()&&newLn.trim()?1:0.5}}>{addingPlayer?"...":"Hinzufügen"}</button>
                  <button onClick={()=>setShowAddPlayer(false)} style={{padding:"10px 14px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer"}}>Abbrechen</button>
                </div>
              </div>
            )}
            {selectedIds.size>0&&<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.muted}}><span style={{color:T.blue}}>🔵 {t1Name}: {t1Players.length}</span>{" · "}<span style={{color:T.red}}>🔴 {t2Name}: {t2Players.length}</span>{unassigned.length>0&&<span style={{color:"#E05252"}}>{" · "}{unassigned.length} ohne Team</span>}</div>}
            <button disabled={!tab1ok} onClick={()=>setTab(2)} style={{width:"100%",padding:"13px",background:tab1ok?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"8px",color:tab1ok?T.isDark?"#0D2B1A":"white":T.muted,fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:tab1ok?"pointer":"not-allowed",opacity:tab1ok?1:0.5}}>
              Weiter → Matches
            </button>
            {!tab1ok&&selectedIds.size>0&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Alle Spieler einem Team zuordnen · min. {playersPerSlot} pro Team</div>}
          </>
        )}

        {/* ── TAB 2 ── */}
        {tab===2&&(
          <>
            {numDays>1&&(
              <div style={{display:"flex",gap:"6px",marginBottom:"14px",overflowX:"auto",paddingBottom:"4px"}}>
                {Array.from({length:numDays},(_,i)=>(
                  <button key={i} onClick={()=>{setActiveDay2(i);setPickingSlot(null);}} style={{padding:"8px 14px",borderRadius:"20px",border:`1px solid ${activeDay2===i?T.gold:T.border}`,background:activeDay2===i?T.gold+"22":"transparent",color:activeDay2===i?T.gold:T.muted,fontSize:"11px",fontWeight:activeDay2===i?"700":"400",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                    Tag {i+1} · {COURSES[daySettings[i]?.courseKey]?.shortName||"?"}
                  </button>
                ))}
              </div>
            )}

            {pickingSlot?(
              <div style={{background:T.gold+"22",border:`1px solid ${T.gold}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{fontSize:"16px"}}>{pickingSlot.team==="t1"?"🔵":"🔴"}</div>
                <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Match {pickingSlot.matchIdx+1} · Slot {pickingSlot.slotIdx+1} · {pickingSlot.team==="t1"?t1Name:t2Name}</div><div style={{fontSize:"10px",color:T.muted}}>Tippe einen Spieler unten</div></div>
                <button onClick={()=>setPickingSlot(null)} style={{background:"transparent",border:"none",color:T.muted,fontSize:"22px",cursor:"pointer",padding:"0 4px"}}>×</button>
              </div>
            ):(
              <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",fontSize:"11px",color:T.muted}}>
                💡 Tippe einen Spieler-Slot um ihn zuzuordnen
              </div>
            )}

            {/* Player picker */}
            {pickingSlot&&(()=>{
              const teamPlayers=pickingSlot.team==="t1"?t1Players:t2Players;
              const used=usedOnDay(pickingSlot.dayIdx);
              const curSlot=matchAssign[pickingSlot.dayIdx]?.[pickingSlot.matchIdx];
              const curArr=pickingSlot.team==="t1"?curSlot?.t1Players:curSlot?.t2Players;
              const curPlayerId=curArr?.[pickingSlot.slotIdx];
              const color=pickingSlot.team==="t1"?T.blue:T.red;
              return(
                <div style={{background:T.cardBg,border:`1px solid ${color}55`,borderRadius:"10px",padding:"10px",marginBottom:"14px"}}>
                  <div style={{fontSize:"10px",color:T.muted,letterSpacing:"1px",marginBottom:"8px"}}>SPIELER WÄHLEN</div>
                  {teamPlayers.map(p=>{
                    const isUsed=used.has(p.id)&&p.id!==curPlayerId;
                    const isCurrent=p.id===curPlayerId;
                    return(
                      <button key={p.id} disabled={isUsed} onClick={()=>assignPlayerToSlot(p.id)}
                        style={{width:"100%",padding:"10px 12px",marginBottom:"6px",borderRadius:"8px",border:`1px solid ${isCurrent?color:T.border}`,background:isCurrent?color+"22":"transparent",cursor:isUsed?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:"10px",opacity:isUsed?0.4:1}}>
                        <PlayerAvatar name={(p.fn||"")+" "+(p.ln||"")} size={32} color={isCurrent?color:T.muted} photo={p.photo}/>
                        <div style={{flex:1,textAlign:"left"}}><div style={{fontSize:"13px",color:isCurrent?color:T.cream,fontWeight:isCurrent?"700":"400"}}>{p.fn} {p.ln}</div><div style={{fontSize:"10px",color:T.faint}}>{isUsed?"Bereits eingeteilt":p.hcp?`HCP ${p.hcp}`:"—"}</div></div>
                        {isCurrent&&<IconCheck size={16} color={color}/>}
                      </button>
                    );
                  })}
                  {teamPlayers.length===0&&<div style={{fontSize:"12px",color:T.faint,textAlign:"center",padding:"12px"}}>Keine Spieler in diesem Team</div>}
                </div>
              );
            })()}

            {/* Match cards */}
            {(matchAssign[activeDay2]||[]).map((ma,mi)=>{
              const mode=daySettings[activeDay2]?.mode||"scramble";
              return(
                <div key={mi} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"12px 14px",marginBottom:"10px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                    <div style={{fontSize:"13px",fontWeight:"900",color:T.gold}}>Match {mi+1}</div>
                    <div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>MATCH{activeDay2*matchesPerDay+mi+1} · {GAME_MODES[mode]?.icon} {GAME_MODES[mode]?.label} · {matchFormat}</div>
                  </div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {[["t1",ma.t1Players,T.blue,t1Name],[["t2"],ma.t2Players,T.red,t2Name]].map(([team,playerIds,color,teamName])=>{
                      const actualTeam=Array.isArray(team)?team[0]:team;
                      return(
                        <div key={actualTeam} style={{flex:1}}>
                          <div style={{fontSize:"9px",color,letterSpacing:"1px",marginBottom:"5px",fontWeight:"700"}}>{teamName}</div>
                          {Array.from({length:playersPerSlot},(_,si)=>{
                            const pid=playerIds[si];
                            const player=allSavedPlayers.find(p=>p.id===pid);
                            const isActive=pickingSlot?.dayIdx===activeDay2&&pickingSlot?.matchIdx===mi&&pickingSlot?.team===actualTeam&&pickingSlot?.slotIdx===si;
                            return(
                              <button key={si} onClick={()=>{if(isActive){setPickingSlot(null);}else{setPickingSlot({dayIdx:activeDay2,matchIdx:mi,team:actualTeam,slotIdx:si});window.scrollTo({top:0,behavior:"smooth"});}}}
                                style={{width:"100%",padding:"8px",borderRadius:"8px",border:`2px solid ${isActive?color:player?color+"55":T.border}`,background:isActive?color+"22":player?color+"11":T.isDark?"#0A2014":T.elevated,cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",minHeight:"44px",marginBottom:si<playersPerSlot-1?"6px":"0"}}>
                                {player?(
                                  <>
                                    <PlayerAvatar name={(player.fn||"")+" "+(player.ln||"")} size={26} color={color} photo={player.photo}/>
                                    <div style={{flex:1,textAlign:"left"}}><div style={{fontSize:"11px",color,fontWeight:"700"}}>{player.fn} {player.ln}</div></div>
                                    <span onClick={e=>{e.stopPropagation();clearSlotPlayer(activeDay2,mi,actualTeam,si);}} style={{color:T.faint,fontSize:"16px",lineHeight:1,cursor:"pointer",padding:"2px"}}>×</span>
                                  </>
                                ):(
                                  <div style={{flex:1,textAlign:"center",fontSize:"11px",color:isActive?color:T.faint}}>
                                    {isActive?"↑ Wählen":"+ Spieler"}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button disabled={!allMatchesFilled||saving} onClick={handleStart}
              style={{width:"100%",padding:"13px",background:allMatchesFilled?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"8px",color:allMatchesFilled?T.isDark?"#0D2B1A":"white":T.muted,fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:allMatchesFilled?"pointer":"not-allowed",opacity:allMatchesFilled?1:0.5,marginTop:"6px"}}>
              {saving?"Speichere...":"Turnier starten 🏌️"}
            </button>
            {!allMatchesFilled&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Alle Match-Slots müssen befüllt sein</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PAIRING EDITOR  – admin can change match pairings after tournament start
// ══════════════════════════════════════════════════════════════════════════════
function PairingEditor({config,dayIdx,onSave,onClose,T}){
  const day=config.days[dayIdx];
  const allPlayers=[...(config.t1Players||[]),...(config.t2Players||[])];
  const t1Ids=new Set((config.t1Players||[]).map(p=>p.id));
  const t2Ids=new Set((config.t2Players||[]).map(p=>p.id));
  const matchFormat=config.matchFormat||"1v1";
  const playersPerSlot=matchFormat==="2v2"?2:1;

  // Build initial assignment from current day matches
  const [matchAssign,setMatchAssign]=useState(()=>
    day.matches.map(m=>({
      t1Players:[...(m.t1PlayerIds||[])],
      t2Players:[...(m.t2PlayerIds||[])],
    }))
  );
  const [pickingSlot,setPickingSlot]=useState(null);
  const [saving,setSaving]=useState(false);

  const usedIds=()=>{const s=new Set();matchAssign.forEach(ma=>{ma.t1Players.forEach(id=>{if(id)s.add(id);});ma.t2Players.forEach(id=>{if(id)s.add(id);});});return s;};

  const assignPlayer=playerId=>{
    if(!pickingSlot)return;
    const{matchIdx,team,slotIdx}=pickingSlot;
    setMatchAssign(prev=>{
      const next=prev.map(ma=>({t1Players:[...ma.t1Players],t2Players:[...ma.t2Players]}));
      // remove from other matches
      next.forEach((ma,mi)=>{if(mi!==matchIdx){ma.t1Players=ma.t1Players.map(id=>id===playerId?undefined:id);ma.t2Players=ma.t2Players.map(id=>id===playerId?undefined:id);}});
      const arr=team==="t1"?next[matchIdx].t1Players:next[matchIdx].t2Players;
      arr[slotIdx]=playerId;
      return next;
    });
    setPickingSlot(null);
  };

  const clearSlot=(matchIdx,team,slotIdx)=>{
    setMatchAssign(prev=>{const next=prev.map(ma=>({t1Players:[...ma.t1Players],t2Players:[...ma.t2Players]}));const arr=team==="t1"?next[matchIdx].t1Players:next[matchIdx].t2Players;arr[slotIdx]=undefined;return next;});
  };

  const allFilled=matchAssign.every(ma=>{
    for(let i=0;i<playersPerSlot;i++){if(!ma.t1Players[i]||!ma.t2Players[i])return false;}return true;
  });

  const handleSave=async()=>{
    setSaving(true);
    const playerMap={};allPlayers.forEach(p=>{playerMap[p.id]=p;});
    const newMatches=day.matches.map((m,mi)=>{
      const ma=matchAssign[mi];
      const p1a=playerMap[ma.t1Players[0]];const p1b=playerMap[ma.t1Players[1]];
      const p2a=playerMap[ma.t2Players[0]];const p2b=playerMap[ma.t2Players[1]];
      const t1Pair=[p1a?`${p1a.fn} ${p1a.ln}`:"?",p1b?`${p1b.fn} ${p1b.ln}`:null].filter(Boolean);
      const t2Pair=[p2a?`${p2a.fn} ${p2a.ln}`:"?",p2b?`${p2b.fn} ${p2b.ln}`:null].filter(Boolean);
      const t1Photos={};ma.t1Players.forEach(id=>{if(id)t1Photos[id]=playerMap[id]?.photo||null;});
      const t2Photos={};ma.t2Players.forEach(id=>{if(id)t2Photos[id]=playerMap[id]?.photo||null;});
      return{...m,t1Pair,t2Pair,t1PlayerIds:ma.t1Players.filter(Boolean),t2PlayerIds:ma.t2Players.filter(Boolean),t1Photos,t2Photos,
        teamHcp1:p1a?parseFloat(p1a.hcp||0):null,teamHcp2:p2a?parseFloat(p2a.hcp||0):null,
        scores:emptyScores()}; // reset scores for this day
    });
    const newDays=config.days.map((d,di)=>di===dayIdx?{...d,matches:newMatches}:d);
    await saveTournament({...config,days:newDays});
    setSaving(false);onSave({...config,days:newDays});
  };

  const color=s=>s==="t1"?T.blue:T.red;
  const teamName=s=>s==="t1"?config.t1Name:config.t2Name;
  const teamPlayers=s=>allPlayers.filter(p=>s==="t1"?t1Ids.has(p.id):t2Ids.has(p.id));

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",flexDirection:"column"}}>
      <div style={{background:T.bg,flex:1,overflowY:"auto",maxWidth:"480px",width:"100%",margin:"0 auto",display:"flex",flexDirection:"column"}}>
        <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"0 14px",height:"60px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:5}}>
          <button onClick={onClose} style={{background:"transparent",border:`1px solid rgba(255,255,255,0.2)`,borderRadius:"6px",color:"rgba(255,255,255,0.7)",fontSize:"11px",padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:"3px"}}>
            <IconBack size={11} color="rgba(255,255,255,0.7)"/>Abbrechen
          </button>
          <div style={{fontSize:"14px",fontWeight:"900",color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>⛳ Paarings ändern</div>
          <div style={{width:"70px"}}/>
        </div>
        <div style={{padding:"14px",flex:1}}>
          <div style={{background:"#E0820022",border:"1px solid #E08200",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:"#E08200"}}>
            ⚠️ Scores von Tag {dayIdx+1} werden zurückgesetzt wenn du speicherst.
          </div>
          {pickingSlot?(
            <div style={{background:T.gold+"22",border:`1px solid ${T.gold}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",display:"flex",alignItems:"center",gap:"10px"}}>
              <div>{pickingSlot.team==="t1"?"🔵":"🔴"}</div>
              <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Match {pickingSlot.matchIdx+1} · Slot {pickingSlot.slotIdx+1} · {teamName(pickingSlot.team)}</div><div style={{fontSize:"10px",color:T.muted}}>Spieler unten antippen</div></div>
              <button onClick={()=>setPickingSlot(null)} style={{background:"transparent",border:"none",color:T.muted,fontSize:"22px",cursor:"pointer"}}>×</button>
            </div>
          ):(
            <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px",fontSize:"11px",color:T.muted}}>
              💡 Tippe einen Spieler-Slot um ihn zu ändern
            </div>
          )}

          {pickingSlot&&(()=>{
            const used=usedIds();
            const curArr=pickingSlot.team==="t1"?matchAssign[pickingSlot.matchIdx].t1Players:matchAssign[pickingSlot.matchIdx].t2Players;
            const curId=curArr[pickingSlot.slotIdx];
            const c=color(pickingSlot.team);
            return(
              <div style={{background:T.cardBg,border:`1px solid ${c}55`,borderRadius:"10px",padding:"10px",marginBottom:"14px"}}>
                {teamPlayers(pickingSlot.team).map(p=>{
                  const isUsed=used.has(p.id)&&p.id!==curId;const isCur=p.id===curId;
                  return(
                    <button key={p.id} disabled={isUsed} onClick={()=>assignPlayer(p.id)}
                      style={{width:"100%",padding:"9px 12px",marginBottom:"5px",borderRadius:"8px",border:`1px solid ${isCur?c:T.border}`,background:isCur?c+"22":"transparent",cursor:isUsed?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:"10px",opacity:isUsed?0.4:1}}>
                      <PlayerAvatar name={(p.fn||"")+" "+(p.ln||"")} size={30} color={isCur?c:T.muted} photo={p.photo}/>
                      <div style={{flex:1,textAlign:"left"}}><div style={{fontSize:"13px",color:isCur?c:T.cream,fontWeight:isCur?"700":"400"}}>{p.fn} {p.ln}</div><div style={{fontSize:"10px",color:T.faint}}>{isUsed?"Bereits eingeteilt":p.hcp?`HCP ${p.hcp}`:"—"}</div></div>
                      {isCur&&<IconCheck size={15} color={c}/>}
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {day.matches.map((m,mi)=>(
            <div key={mi} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"12px 14px",marginBottom:"10px"}}>
              <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,marginBottom:"10px"}}>Match {mi+1}</div>
              <div style={{display:"flex",gap:"8px"}}>
                {(["t1","t2"]).map(team=>(
                  <div key={team} style={{flex:1}}>
                    <div style={{fontSize:"9px",color:color(team),letterSpacing:"1px",marginBottom:"5px",fontWeight:"700"}}>{teamName(team)}</div>
                    {Array.from({length:playersPerSlot},(_,si)=>{
                      const pid=(team==="t1"?matchAssign[mi].t1Players:matchAssign[mi].t2Players)[si];
                      const player=allPlayers.find(p=>p.id===pid);
                      const isActive=pickingSlot?.matchIdx===mi&&pickingSlot?.team===team&&pickingSlot?.slotIdx===si;
                      const c=color(team);
                      return(
                        <button key={si} onClick={()=>{if(isActive)setPickingSlot(null);else{setPickingSlot({matchIdx:mi,team,slotIdx:si});window.scrollTo({top:0,behavior:"smooth"});}}}
                          style={{width:"100%",padding:"8px",borderRadius:"8px",border:`2px solid ${isActive?c:player?c+"55":T.border}`,background:isActive?c+"22":player?c+"11":T.isDark?"#0A2014":T.elevated,cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",minHeight:"44px",marginBottom:si<playersPerSlot-1?"5px":"0"}}>
                          {player?(<>
                            <PlayerAvatar name={(player.fn||"")+" "+(player.ln||"")} size={26} color={c} photo={player.photo}/>
                            <div style={{flex:1,textAlign:"left"}}><div style={{fontSize:"11px",color:c,fontWeight:"700"}}>{player.fn} {player.ln}</div></div>
                            <span onClick={e=>{e.stopPropagation();clearSlot(mi,team,si);}} style={{color:T.faint,fontSize:"16px",cursor:"pointer",padding:"2px"}}>×</span>
                          </>):(
                            <div style={{flex:1,textAlign:"center",fontSize:"11px",color:isActive?c:T.faint}}>{isActive?"↑ Wählen":"+ Spieler"}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button disabled={!allFilled||saving} onClick={handleSave}
            style={{width:"100%",padding:"13px",background:allFilled?`linear-gradient(135deg,${T.gold},#A07830)`:T.elevated,border:"none",borderRadius:"8px",color:allFilled?T.isDark?"#0D2B1A":"white":T.muted,fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:allFilled?"pointer":"not-allowed",opacity:allFilled?1:0.5}}>
            {saving?"Speichere...":"Paarings speichern ✓"}
          </button>
          {!allFilled&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Alle Slots müssen befüllt sein</div>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════
function ScoreModal({match,holeIndex,t1Name,t2Name,existing,par,onSave,onClose,T}){
  const [t1,setT1]=useState(existing?.team1??"");
  const [t2,setT2]=useState(existing?.team2??"");
  const hp=par[holeIndex];const mode=GAME_MODES[match.mode||"scramble"];
  const t1Photos=match.t1Photos||{};const t2Photos=match.t2Photos||{};
  const t1PlayerIds=match.t1PlayerIds||[];const t2PlayerIds=match.t2PlayerIds||[];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:"900",color:T.gold,textTransform:"uppercase",letterSpacing:"1px"}}>Loch {holeIndex+1} · {match.name}</div>
            <div style={{fontSize:"11px",color:T.muted,marginTop:"2px"}}>{holeIndex<9?"Runde 1":"Runde 2"} · {mode?.icon} {mode?.label}</div>
          </div>
          <div style={{textAlign:"center",background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"6px 12px"}}><div style={{fontSize:"9px",color:T.muted}}>PAR</div><div style={{fontSize:"22px",fontWeight:"900",color:T.gold,lineHeight:1}}>{hp}</div></div>
        </div>
        <div style={{display:"flex",gap:"12px",marginBottom:"16px"}}>
          {[{name:t1Name,val:t1,set:setT1,color:T.blue,pair:match.t1Pair||[],playerIds:t1PlayerIds,photos:t1Photos},{name:t2Name,val:t2,set:setT2,color:T.red,pair:match.t2Pair||[],playerIds:t2PlayerIds,photos:t2Photos}].map((item,i)=>(
            <div key={i} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:"11px",color:item.color,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"6px"}}>{item.name}</div>
              <div style={{display:"flex",justifyContent:"center",gap:"4px",marginBottom:"6px"}}>{item.pair.map((name,pi)=>{const pid=item.playerIds[pi];const photo=pid?item.photos[pid]:null;return<PlayerAvatar key={pi} name={name} size={32} color={item.color} photo={photo}/>;})}</div>
              <div style={{fontSize:"11px",color:item.color,fontWeight:"600",marginBottom:"6px"}}>{item.pair.join(" & ")}</div>
              <input type="number" min="1" max="12" style={{width:"100%",fontSize:"36px",fontWeight:"900",background:T.isDark?"#060E1A":T.elevated,border:`2px solid ${T.border}`,borderRadius:"8px",color:T.cream,textAlign:"center",padding:"8px 0",outline:"none",boxSizing:"border-box"}} value={item.val} onChange={e=>item.set(e.target.value)} autoFocus={i===0}/>
            </div>
          ))}
        </div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",cursor:"pointer"}} onClick={()=>{if(t1!==""&&t2!=="")onSave(Number(t1),Number(t2));}}>Speichern</button>
        <button style={{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer",marginTop:"8px"}} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

function NineHoleGrid({scores,pars,startHole,matchId,onHoleClick,canEdit,T,roundStatus}){
  // decisionAt is the absolute hole index where the round was decided
  // holes after that index are "dead" – shown dimmed
  const decisionAt = roundStatus?.won && roundStatus.decisionAt != null
    ? roundStatus.decisionAt
    : null;
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px"}}>
      {scores.slice(startHole,startHole+9).map((s,i)=>{
        const hn=startHole+i,p=pars[hn],played=s.team1!==null&&s.team2!==null;
        const isDead=decisionAt!==null&&hn>decisionAt;
        let bg=T.holeBg,color=T.holeText,border=`1px solid ${T.border}`;
        if(played){
          border="none";
          if(s.team1<s.team2){bg=T.blue+"25";color=T.blue;}
          else if(s.team2<s.team1){bg=T.red+"25";color=T.red;}
          else{bg=T.border;color=T.muted;}
        }
        const finalOpacity=isDead?0.32:(canEdit?1:played?0.9:0.6);
        const finalBorder=isDead?`1px dashed ${T.border}`:border;
        const finalFilter=isDead?"saturate(0.25)":"none";
        return(
          <div key={i} style={{borderRadius:"4px",cursor:canEdit?"pointer":"default",background:bg,color,border:finalBorder,userSelect:"none",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2px 0",minHeight:"32px",opacity:finalOpacity,filter:finalFilter}} onClick={()=>canEdit&&onHoleClick(matchId,hn)}>
            <div style={{fontSize:"9px",fontWeight:"700",lineHeight:1}}>{hn+1}</div>
            <div style={{fontSize:"7px",opacity:0.6,lineHeight:1}}>P{p}</div>
            {played&&<div style={{fontSize:"8px",fontWeight:"900",lineHeight:1}}>{s.team1}:{s.team2}</div>}
          </div>
        );
      })}
    </div>
  );
}

function MatchCard({match,pars,t1Name,t2Name,canEdit,isAdmin,onHoleClick,onReset,T}){
  const [showReset,setShowReset]=useState(false);
  const r1=calcRoundStatus(match.scores,pars,0,9);const r2=calcRoundStatus(match.scores,pars,9,18);
  const mode=GAME_MODES[match.mode||"scramble"];
  const t1Photos=match.t1Photos||{};const t2Photos=match.t2Photos||{};
  const t1PlayerIds=match.t1PlayerIds||[];const t2PlayerIds=match.t2PlayerIds||[];
  const RoundBadge=({rs,pts,label})=>{
    const color=rs.diff>0?T.blue:rs.diff<0?T.red:T.muted;
    return(
      <div style={{flex:1,background:T.isDark?"#0A2014":T.elevated,borderRadius:"6px",padding:"6px 8px",textAlign:"center",border:`1px solid ${T.border}`}}>
        <div style={{fontSize:"9px",color:T.faint}}>{label}</div>
        <div style={{fontSize:"14px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>{rs.holesPlayed===0?"—":rs.label}</div>
        {(rs.won||rs.holesLeft===0)&&pts&&<div style={{fontSize:"9px",color:T.muted,marginTop:"2px"}}>{pts.t1}–{pts.t2} Pts</div>}
        {!rs.won&&rs.holesLeft>0&&rs.holesPlayed>0&&<div style={{fontSize:"9px",color:T.faint,marginTop:"2px"}}>{rs.holesLeft} left</div>}
      </div>
    );
  };
  return(
    <>
      <div style={{background:T.surface,border:`2px solid ${canEdit?T.gold:T.border}`,borderRadius:"12px",marginBottom:"12px",overflow:"hidden",opacity:canEdit||isAdmin?1:0.45,boxShadow:canEdit?`0 0 0 1px ${T.gold}33,0 4px 20px ${T.gold}18`:"none"}}>
        <div style={{padding:"10px 14px",background:canEdit?T.gold+"11":T.isDark?"#0A2014":T.elevated,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{fontSize:"13px",fontWeight:"900",color:canEdit?T.gold:T.cream}}>{match.name}</div>
              {canEdit&&<div style={{background:T.gold,color:T.isDark?"#0D2B1A":"white",fontSize:"9px",fontWeight:"900",borderRadius:"4px",padding:"2px 8px"}}>✏️ DEIN MATCH</div>}
              <div style={{fontSize:"10px",color:T.faint}}>{mode?.icon} {mode?.label}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              {match.pin&&<div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>{match.pin}</div>}
              {(canEdit||isAdmin)&&<button onClick={()=>setShowReset(true)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.faint,padding:"4px 7px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px",fontSize:"10px"}}><IconReset size={11} color={T.faint}/></button>}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              {t1PlayerIds.map((pid,i)=><PlayerAvatar key={i} name={(match.t1Pair||[])[i]||""} size={28} color={T.blue} photo={t1Photos[pid]||null}/>)}
              <div><div style={{fontSize:"11px",color:T.blue,fontWeight:"700"}}>{(match.t1Pair||[]).join(" & ")}</div>{match.teamHcp1!=null&&<div style={{fontSize:"9px",color:T.blue+"88"}}>HCP {match.teamHcp1}</div>}</div>
            </div>
            <div style={{fontSize:"10px",color:T.muted}}>vs</div>
            <div style={{display:"flex",alignItems:"center",gap:"6px",flexDirection:"row-reverse"}}>
              {t2PlayerIds.map((pid,i)=><PlayerAvatar key={i} name={(match.t2Pair||[])[i]||""} size={28} color={T.red} photo={t2Photos[pid]||null}/>)}
              <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:T.red,fontWeight:"700"}}>{(match.t2Pair||[]).join(" & ")}</div>{match.teamHcp2!=null&&<div style={{fontSize:"9px",color:T.red+"88"}}>HCP {match.teamHcp2}</div>}</div>
            </div>
          </div>
        </div>
        <div style={{padding:"10px 14px"}}>
          <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
            <RoundBadge rs={r1} pts={getPoints(r1)} label="Runde 1 (L. 1–9)"/>
            <RoundBadge rs={r2} pts={getPoints(r2)} label="Runde 2 (L. 10–18)"/>
          </div>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",marginBottom:"3px"}}>RUNDE 1</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={0} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T} roundStatus={r1}/>
          <div style={{fontSize:"9px",color:T.faint,letterSpacing:"1px",margin:"6px 0 3px"}}>RUNDE 2</div>
          <NineHoleGrid scores={match.scores} pars={pars} startHole={9} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} T={T} roundStatus={r2}/>
          {!canEdit&&!isAdmin&&<div style={{marginTop:"8px",fontSize:"10px",color:T.faint,textAlign:"center"}}>🔒 Nur lesbar</div>}
        </div>
      </div>
      {showReset&&<ResetConfirm title={`${match.name} zurücksetzen?`} message="Alle eingetragenen Scores werden gelöscht." onConfirm={()=>{onReset(match.id);setShowReset(false);}} onClose={()=>setShowReset(false)} T={T}/>}
    </>
  );
}

// ── Score distribution helper ─────────────────────────────────────────────────
function calcScoreDistribution(days) {
  // Returns per-pair: { eagle, birdie, par, bogey, double, worse }
  const pairDist = {};
  days.forEach(day => {
    const course = COURSES[day.courseKey] || Object.values(COURSES)[0];
    day.matches.forEach(m => {
      const pairs = [
        { key: (m.t1Pair||[]).join(" & ") || "?", team: "t1" },
        { key: (m.t2Pair||[]).join(" & ") || "?", team: "t2" },
      ];
      pairs.forEach(({key,team}) => {
        if (!pairDist[key]) pairDist[key] = { key, team, eagle:0, birdie:0, par:0, bogey:0, double:0, worse:0, total:0 };
      });
      m.scores.forEach((sc, hi) => {
        const par = course.par[hi];
        const t1s = sc.team1; const t2s = sc.team2;
        [[t1s, pairs[0].key], [t2s, pairs[1].key]].forEach(([score, key]) => {
          if (score === null || score === undefined) return;
          const diff = score - par;
          const d = pairDist[key];
          if (!d) return;
          d.total++;
          if (diff <= -2) d.eagle++;
          else if (diff === -1) d.birdie++;
          else if (diff === 0) d.par++;
          else if (diff === 1) d.bogey++;
          else if (diff === 2) d.double++;
          else d.worse++;
        });
      });
    });
  });
  return Object.values(pairDist);
}

// ── Hole heatmap helper ───────────────────────────────────────────────────────
function calcHoleHeatmap(days) {
  const holes = Array.from({length:18}, (_,i) => ({ hole:i+1, t1:0, t2:0, tie:0, total:0 }));
  days.forEach(day => {
    const course = COURSES[day.courseKey] || Object.values(COURSES)[0];
    day.matches.forEach(m => {
      m.scores.forEach((sc, hi) => {
        if (sc.team1 === null || sc.team2 === null) return;
        holes[hi].total++;
        if (sc.team1 < sc.team2) holes[hi].t1++;
        else if (sc.team2 < sc.team1) holes[hi].t2++;
        else holes[hi].tie++;
      });
    });
  });
  return holes;
}

// ── Match timeline helper ─────────────────────────────────────────────────────
function calcMatchTimeline(match, pars) {
  // Returns array of 18 cumulative diff values (t1 perspective: + = t1 leading)
  let diff = 0;
  return match.scores.map((sc, hi) => {
    if (sc.team1 !== null && sc.team2 !== null) {
      if (sc.team1 < sc.team2) diff++;
      else if (sc.team2 < sc.team1) diff--;
    }
    return diff;
  });
}

function StatsTab({days,t1Name,t2Name,T}){
  const [activeSection, setActiveSection] = useState(0);
  const stats = calcStats(days,t1Name,t2Name);
  const scoreDist = calcScoreDistribution(days);
  const heatmap = calcHoleHeatmap(days);
  const totalHoles = stats.t1TotalHoles + stats.t2TotalHoles;
  const t1HolePct = totalHoles > 0 ? Math.round((stats.t1TotalHoles/totalHoles)*100) : 50;

  const SectionTitle = ({children}) => (
    <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",textTransform:"uppercase",fontWeight:"700",marginBottom:"10px",marginTop:"16px",display:"flex",alignItems:"center",gap:"6px"}}>
      <div style={{flex:1,height:"1px",background:T.border}}/>{children}<div style={{flex:1,height:"1px",background:T.border}}/>
    </div>
  );

  const PairRow = ({pair,maxPts}) => {
    const pct = maxPts>0?(pair.pts/maxPts)*100:0;
    const color = pair.team==="t1"?T.blue:T.red;
    return(
      <div style={{marginBottom:"10px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
          <div style={{fontSize:"12px",color:T.cream,fontWeight:"600"}}>{pair.name}</div>
          <div style={{display:"flex",gap:"12px",fontSize:"11px"}}><span style={{color:T.muted}}>{pair.holesWon} Löcher</span><span style={{color,fontWeight:"700"}}>{fmt(pair.pts)} Pts</span></div>
        </div>
        <div style={{height:"6px",background:T.elevated,borderRadius:"3px",overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:"3px",transition:"width 0.6s"}}/></div>
      </div>
    );
  };

  const maxT1 = Math.max(...stats.t1Pairs.map(p=>p.pts),1);
  const maxT2 = Math.max(...stats.t2Pairs.map(p=>p.pts),1);

  // Score distribution bars per pair
  const ScoreDistCard = ({dist}) => {
    const color = dist.team==="t1"?T.blue:T.red;
    const cats = [
      { key:"eagle", label:"🦅 Eagle", color:"#FFD700" },
      { key:"birdie", label:"🐦 Birdie", color:"#4CAF50" },
      { key:"par", label:"⬜ Par", color:T.muted },
      { key:"bogey", label:"🔴 Bogey", color:"#FF9800" },
      { key:"double", label:"💀 Doppel", color:"#E05252" },
      { key:"worse", label:"⛔ +3 oder mehr", color:"#8B0000" },
    ];
    const maxVal = Math.max(...cats.map(c=>dist[c.key]),1);
    return(
      <div style={{background:T.isDark?"#0A2014":T.elevated,borderRadius:"10px",padding:"12px",marginBottom:"10px",border:`1px solid ${color}33`}}>
        <div style={{fontSize:"12px",fontWeight:"700",color,marginBottom:"10px"}}>{dist.key}</div>
        {cats.map(cat=>{
          const val = dist[cat.key];
          const pct = (val/maxVal)*100;
          const pctOfTotal = dist.total>0?Math.round((val/dist.total)*100):0;
          return(
            <div key={cat.key} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
              <div style={{width:"90px",fontSize:"10px",color:T.muted,flexShrink:0}}>{cat.label}</div>
              <div style={{flex:1,height:"14px",background:T.elevated,borderRadius:"7px",overflow:"hidden",border:`1px solid ${T.border}`}}>
                <div style={{width:`${pct}%`,height:"100%",background:cat.color,borderRadius:"7px",transition:"width 0.6s",opacity:val===0?0.2:1}}/>
              </div>
              <div style={{width:"36px",textAlign:"right",fontSize:"11px",fontWeight:"700",color:val>0?cat.color:T.faint}}>{val>0?`${val} (${pctOfTotal}%)`:"-"}</div>
            </div>
          );
        })}
        {dist.total===0&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",padding:"8px"}}>Noch keine Scores</div>}
      </div>
    );
  };

  // Hole heatmap
  const HoleHeatmap = () => {
    const activeHoles = heatmap.filter(h=>h.total>0);
    if (activeHoles.length === 0) return <div style={{fontSize:"12px",color:T.faint,textAlign:"center",padding:"20px"}}>Noch keine Scores eingetragen</div>;
    return(
      <div>
        <div style={{display:"flex",gap:"8px",marginBottom:"10px",fontSize:"10px",color:T.muted,justifyContent:"center"}}>
          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"12px",height:"12px",borderRadius:"2px",background:T.blue}}/> {t1Name}</span>
          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"12px",height:"12px",borderRadius:"2px",background:"#888"}}/> Unentschieden</span>
          <span style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"12px",height:"12px",borderRadius:"2px",background:T.red}}/> {t2Name}</span>
        </div>
        {[0,1].map(row=>(
          <div key={row} style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"4px",marginBottom:"4px"}}>
            {heatmap.slice(row*9, row*9+9).map((h,i)=>{
              const hi = row*9+i;
              let bg = T.elevated; let txt = T.faint; let intensity = 0;
              if (h.total > 0) {
                const t1pct = h.t1/h.total; const t2pct = h.t2/h.total;
                intensity = Math.max(t1pct, t2pct);
                if (h.t1 > h.t2) { bg = T.blue; txt = "#fff"; }
                else if (h.t2 > h.t1) { bg = T.red; txt = "#fff"; }
                else { bg = "#666"; txt = "#fff"; }
              }
              return(
                <div key={hi} style={{borderRadius:"6px",padding:"4px 2px",background:bg,opacity:h.total===0?0.25:0.4+intensity*0.6,textAlign:"center",minHeight:"40px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",transition:"opacity 0.3s"}}>
                  <div style={{fontSize:"9px",color:txt,fontWeight:"700",opacity:0.8}}>L{hi+1}</div>
                  {h.total>0&&(
                    <>
                      <div style={{fontSize:"11px",color:txt,fontWeight:"900",lineHeight:1}}>{h.t1>h.t2?h.t1:h.t2>h.t1?h.t2:h.tie}</div>
                      <div style={{fontSize:"8px",color:txt,opacity:0.7}}>/{h.total}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        <div style={{fontSize:"10px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Farbe = dominierendes Team · Intensität = Dominanz</div>
      </div>
    );
  };

  // Match timeline
  const MatchTimelines = () => {
    const allMatches = [];
    days.forEach(day => {
      const course = COURSES[day.courseKey]||Object.values(COURSES)[0];
      day.matches.forEach(m => {
        const timeline = calcMatchTimeline(m, course.par);
        const hasData = m.scores.some(s=>s.team1!==null);
        if (hasData) allMatches.push({match:m, timeline, day});
      });
    });
    if (allMatches.length===0) return <div style={{fontSize:"12px",color:T.faint,textAlign:"center",padding:"20px"}}>Noch keine Scores eingetragen</div>;
    return(
      <div>
        {allMatches.map(({match,timeline,day},idx)=>{
          const played = match.scores.filter(s=>s.team1!==null).length;
          const lastDiff = timeline[played-1]||0;
          const maxAbs = Math.max(...timeline.map(Math.abs),1);
          const W=280; const H=60; const pad=8;
          const xStep=(W-pad*2)/17;
          const yMid=H/2;
          const yScale=(H/2-pad)/Math.max(maxAbs,2);
          const points=timeline.slice(0,played).map((v,i)=>`${pad+i*xStep},${yMid-v*yScale}`).join(" ");
          const lineColor=lastDiff>0?T.blue:lastDiff<0?T.red:T.muted;
          return(
            <div key={idx} style={{background:T.isDark?"#0A2014":T.elevated,borderRadius:"10px",padding:"12px",marginBottom:"10px",border:`1px solid ${T.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
                <div>
                  <div style={{fontSize:"12px",fontWeight:"700",color:T.cream}}>{match.name} <span style={{fontSize:"10px",color:T.faint}}>· {day.label}</span></div>
                  <div style={{fontSize:"10px",color:T.blue}}>{(match.t1Pair||[]).join(" & ")} <span style={{color:T.muted}}>vs</span> <span style={{color:T.red}}>{(match.t2Pair||[]).join(" & ")}</span></div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:"16px",fontWeight:"900",color:lineColor,fontFamily:"'Arial Black',sans-serif"}}>{lastDiff===0?"AS":lastDiff>0?`${lastDiff} UP`:`${Math.abs(lastDiff)} UP`}</div>
                  <div style={{fontSize:"9px",color:T.faint}}>{lastDiff>0?t1Name:lastDiff<0?t2Name:"Gleich"}</div>
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <svg width={W} height={H} style={{display:"block",margin:"0 auto"}}>
                  {/* Zero line */}
                  <line x1={pad} y1={yMid} x2={W-pad} y2={yMid} stroke={T.border} strokeWidth="1" strokeDasharray="3,3"/>
                  {/* Round divider at hole 9 */}
                  <line x1={pad+8*xStep} y1={pad} x2={pad+8*xStep} y2={H-pad} stroke={T.border} strokeWidth="1" strokeDasharray="2,4" opacity="0.5"/>
                  {/* Fill under the line */}
                  {played>1&&(
                    <polygon
                      points={`${pad},${yMid} ${points} ${pad+(played-1)*xStep},${yMid}`}
                      fill={lineColor} opacity="0.15"/>
                  )}
                  {/* Line */}
                  {played>1&&<polyline points={points} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>}
                  {/* Current dot */}
                  {played>0&&<circle cx={pad+(played-1)*xStep} cy={yMid-lastDiff*yScale} r="4" fill={lineColor}/>}
                  {/* Hole labels */}
                  {[0,8,17].map(i=>(
                    <text key={i} x={pad+i*xStep} y={H-1} fontSize="7" fill={T.faint} textAnchor="middle">L{i+1}</text>
                  ))}
                  {/* +/- labels */}
                  <text x={pad-4} y={yMid-yScale*2+3} fontSize="7" fill={T.blue} textAnchor="end">+2</text>
                  <text x={pad-4} y={yMid+yScale*2+3} fontSize="7" fill={T.red} textAnchor="end">-2</text>
                </svg>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"9px",color:T.faint,marginTop:"4px",paddingTop:"4px",borderTop:`1px solid ${T.border}`}}>
                <span>{played}/18 Löcher gespielt</span>
                <span>R1: {pad} · R2: 10–18</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const sections = ["Übersicht","Scores","Heatmap","Verlauf"];

  return(
    <div style={{paddingBottom:"20px"}}>
      {/* Section tabs */}
      <div style={{display:"flex",gap:"6px",marginBottom:"16px",overflowX:"auto",paddingBottom:"2px"}}>
        {sections.map((s,i)=>(
          <button key={i} onClick={()=>setActiveSection(i)}
            style={{padding:"7px 14px",borderRadius:"20px",border:`1px solid ${activeSection===i?T.gold:T.border}`,background:activeSection===i?T.gold+"22":"transparent",color:activeSection===i?T.gold:T.muted,fontSize:"11px",fontWeight:activeSection===i?"700":"400",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
            {["📊","🎯","🗺️","📈"][i]} {s}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeSection===0&&(
        <>
          <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
            <div style={{fontSize:"11px",color:T.muted,letterSpacing:"1px",marginBottom:"10px",textTransform:"uppercase"}}>Gewonnene Löcher</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"8px"}}>
              <div><div style={{fontSize:"11px",color:T.blue,fontWeight:"700"}}>🔵 {t1Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t1TotalHoles}</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:T.red,fontWeight:"700"}}>🔴 {t2Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t2TotalHoles}</div></div>
            </div>
            <div style={{height:"12px",borderRadius:"6px",overflow:"hidden",display:"flex"}}><div style={{width:`${t1HolePct}%`,background:T.blue,transition:"width 0.6s"}}/><div style={{flex:1,background:T.red}}/></div>
          </div>
          <SectionTitle>🔵 {t1Name}</SectionTitle>
          <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
            {stats.t1Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t1Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT1}/>)}
          </div>
          <SectionTitle>🔴 {t2Name}</SectionTitle>
          <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
            {stats.t2Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t2Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT2}/>)}
          </div>
          <SectionTitle>🌟 Top Performer</SectionTitle>
          <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px"}}>
            {stats.allPairs.filter(p=>p.pts>0).length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine abgeschlossenen Runden</div>:
              stats.allPairs.filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts).slice(0,3).map((p,i)=>{
                const color=p.team==="t1"?T.blue:T.red;
                return(<div key={i} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px",background:T.elevated,borderRadius:"8px",marginBottom:"8px",border:`1px solid ${color}33`}}>
                  <div style={{fontSize:"20px"}}>{"🥇🥈🥉"[i]}</div>
                  <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"700",color}}>{p.name}</div><div style={{fontSize:"10px",color:T.faint}}>{p.team==="t1"?t1Name:t2Name} · {p.holesWon} Löcher</div></div>
                  <div style={{fontSize:"20px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>{fmt(p.pts)}</div>
                </div>);
              })}
          </div>
        </>
      )}

      {/* ── Score Distribution ── */}
      {activeSection===1&&(
        <>
          <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.muted}}>
            🎯 Score-Verteilung pro Pair — relativ zu Par
          </div>
          {scoreDist.length===0&&<div style={{fontSize:"12px",color:T.faint,textAlign:"center",padding:"30px"}}>Noch keine Scores</div>}
          {scoreDist.filter(d=>d.team==="t1").length>0&&<div style={{fontSize:"10px",color:T.blue,letterSpacing:"2px",fontWeight:"700",marginBottom:"8px"}}>🔵 {t1Name}</div>}
          {scoreDist.filter(d=>d.team==="t1").map((d,i)=><ScoreDistCard key={i} dist={d}/>)}
          {scoreDist.filter(d=>d.team==="t2").length>0&&<div style={{fontSize:"10px",color:T.red,letterSpacing:"2px",fontWeight:"700",marginBottom:"8px",marginTop:"12px"}}>🔴 {t2Name}</div>}
          {scoreDist.filter(d=>d.team==="t2").map((d,i)=><ScoreDistCard key={i} dist={d}/>)}
        </>
      )}

      {/* ── Hole Heatmap ── */}
      {activeSection===2&&(
        <>
          <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px"}}>
            <div style={{fontSize:"11px",color:T.muted,letterSpacing:"1px",marginBottom:"14px",textTransform:"uppercase"}}>Loch-Heatmap – Wer dominiert welches Loch?</div>
            <HoleHeatmap/>
          </div>
          {/* Best/worst holes summary */}
          {heatmap.filter(h=>h.total>0).length>0&&(
            <>
              <SectionTitle>💪 Stärkste Löcher</SectionTitle>
              <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px"}}>
                {[...heatmap].filter(h=>h.total>0).sort((a,b)=>{
                  const aEdge=Math.abs(a.t1-a.t2)/a.total;const bEdge=Math.abs(b.t1-b.t2)/b.total;return bEdge-aEdge;
                }).slice(0,5).map((h,i)=>{
                  const winner=h.t1>h.t2?t1Name:h.t2>h.t1?t2Name:null;
                  const color=h.t1>h.t2?T.blue:h.t2>h.t1?T.red:T.muted;
                  const pct=Math.round(Math.max(h.t1,h.t2)/h.total*100);
                  return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 0",borderBottom:i<4?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:"32px",height:"32px",borderRadius:"8px",background:color+"22",border:`1px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:"900",fontSize:"13px",color}}>{h.hole}</div>
                      <div style={{flex:1}}><div style={{fontSize:"12px",fontWeight:"600",color:winner?color:T.muted}}>{winner||"Ausgeglichen"}</div><div style={{fontSize:"10px",color:T.faint}}>{h.total} gespielt</div></div>
                      <div style={{fontSize:"14px",fontWeight:"900",color}}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Match Timeline ── */}
      {activeSection===3&&(
        <>
          <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.muted}}>
            📈 Gesamtverlauf + Einzelmatches — 🔵 oben = {t1Name} führt
          </div>

          {/* Day cumulative chart */}
          {(()=>{
            // Collect all matches across all days in order, compute cumulative point diff
            const points=[];let cumT1=0,cumT2=0;
            days.forEach((day,di)=>{
              const course=COURSES[day.courseKey]||Object.values(COURSES)[0];
              day.matches.forEach((m,mi)=>{
                [0,1].forEach(r=>{
                  const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);
                  const pt=getPoints(rs);
                  if(pt){cumT1+=pt.t1;cumT2+=pt.t2;}
                  points.push({cumT1,cumT2,label:`T${di+1}M${mi+1}R${r+1}`,done:pt!==null});
                });
              });
            });
            const played=points.filter(p=>p.done);
            if(played.length<2)return<div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"20px",textAlign:"center",marginBottom:"14px",fontSize:"12px",color:T.faint}}>Noch keine abgeschlossenen Runden für Gesamtverlauf</div>;
            const W=320;const H=80;const pad=12;const xStep=(W-pad*2)/Math.max(played.length-1,1);
            const maxVal=Math.max(...played.map(p=>Math.max(p.cumT1,p.cumT2)),1);
            const yScale=(H-pad*2)/maxVal;
            const t1pts=played.map((p,i)=>[`${pad+i*xStep}`,`${H-pad-p.cumT1*yScale}`].join(",")).join(" ");
            const t2pts=played.map((p,i)=>[`${pad+i*xStep}`,`${H-pad-p.cumT2*yScale}`].join(",")).join(" ");
            const last=played[played.length-1];
            const diff=last.cumT1-last.cumT2;
            return(
              <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color:T.cream}}>Gesamtverlauf · alle Tage</div>
                  <div style={{textAlign:"right"}}>
                    <span style={{color:T.blue,fontWeight:"900",fontSize:"16px"}}>{fmt(last.cumT1)}</span>
                    <span style={{color:T.muted,fontSize:"12px"}}> : </span>
                    <span style={{color:T.red,fontWeight:"900",fontSize:"16px"}}>{fmt(last.cumT2)}</span>
                  </div>
                </div>
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
                  {/* grid lines */}
                  {[0.25,0.5,0.75,1].map(f=>(
                    <line key={f} x1={pad} y1={H-pad-f*maxVal*yScale} x2={W-pad} y2={H-pad-f*maxVal*yScale} stroke={T.border} strokeWidth="0.5" strokeDasharray="3,4"/>
                  ))}
                  {/* day dividers */}
                  {(()=>{let idx=0;return days.map((day,di)=>{const n=day.matches.length*2;const x=pad+(idx+n-1)*xStep;idx+=n;return di<days.length-1?<line key={di} x1={x} y1={pad} x2={x} y2={H-pad} stroke={T.border} strokeWidth="0.8" strokeDasharray="2,4" opacity="0.6"/>:null;});})()}
                  {/* t2 area + line */}
                  <polyline points={t2pts} fill="none" stroke={T.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
                  {/* t1 area + line */}
                  <polyline points={t1pts} fill="none" stroke={T.blue} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  {/* end dots */}
                  {played.length>0&&<>
                    <circle cx={pad+(played.length-1)*xStep} cy={H-pad-last.cumT1*yScale} r="4" fill={T.blue}/>
                    <circle cx={pad+(played.length-1)*xStep} cy={H-pad-last.cumT2*yScale} r="4" fill={T.red}/>
                  </>}
                  {/* labels */}
                  <text x={pad} y={H-1} fontSize="7" fill={T.faint}>Start</text>
                  {played.length>1&&<text x={pad+(played.length-1)*xStep} y={H-1} fontSize="7" fill={T.faint} textAnchor="end">Jetzt</text>}
                  {days.map((day,di)=>{
                    let idx=0;days.slice(0,di).forEach(d=>idx+=d.matches.length*2);
                    const x=pad+idx*xStep;
                    return<text key={di} x={x+2} y={pad+8} fontSize="7" fill={T.gold} opacity="0.7">T{di+1}</text>;
                  })}
                </svg>
                <div style={{display:"flex",gap:"12px",justifyContent:"center",marginTop:"8px",fontSize:"10px",color:T.muted}}>
                  <span style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"16px",height:"2px",background:T.blue,borderRadius:"1px"}}/>{t1Name}</span>
                  <span style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"16px",height:"2px",background:T.red,borderRadius:"1px",opacity:0.6}}/>{t2Name}</span>
                </div>
              </div>
            );
          })()}

          <div style={{fontSize:"10px",color:T.gold,letterSpacing:"2px",fontWeight:"700",marginBottom:"10px",display:"flex",alignItems:"center",gap:"6px"}}><div style={{flex:1,height:"1px",background:T.border}}/>EINZELNE MATCHES<div style={{flex:1,height:"1px",background:T.border}}/></div>
          <MatchTimelines/>
        </>
      )}
    </div>
  );
}

// ── Course Tracker ────────────────────────────────────────────────────────────
function CourseTracker({day, matches, matchRefs, T}){
  const course = COURSES[day.courseKey] || Object.values(COURSES)[0];
  const HOLE_R = 11;
  const CARD_W = 56;
  const CARD_H = 28;
  const STEM_H = 6;

  // completedHoles per match = number of scores entered
  const completedHoles = matches.map(m =>
    m.scores.filter(s => s.team1 !== null).length
  );

  // Status per match
  const statuses = matches.map((m,i) => {
    let diff=0, played=0;
    m.scores.forEach(s => {
      if(s.team1===null)return;
      played++;
      if(s.team1<s.team2)diff++;
      else if(s.team2<s.team1)diff--;
    });
    const left=18-played;
    if(!played)return{label:"—",diff:0};
    if(left===0||Math.abs(diff)>left)return diff===0?{label:"AS",diff:0}:{label:`${Math.abs(diff)}&${left}`,diff};
    return diff===0?{label:"AS",diff:0}:{label:`${Math.abs(diff)} UP`,diff};
  });

  // holeMap: holeIndex → [matchIndex, ...] (multiple matches can share a hole)
  // A match is "on hole h" when completedHoles===h (next hole to play)
  const holeMap = {};
  const doneMI = [];

  matches.forEach((m,i) => {
    const c = completedHoles[i];
    if(c>=18){ doneMI.push({mi:i,label:"R1+R2"}); return; }
    if(c===9){ doneMI.push({mi:i,label:"R1"}); return; }
    if(!holeMap[c]) holeMap[c]=[];
    holeMap[c].push(i);
  });
  matches.forEach((m,i) => {
    const c = completedHoles[i];
    if(c>=10&&c<18){ doneMI.push({mi:i,label:"R1 ✓"}); }
  });

  const allPastHole = h => matches.every((_,i) => completedHoles[i]>h);

  const stColor = diff => diff>0?T.blue:diff<0?T.red:T.muted;
  const bcColor = diff => diff>0?T.blue:diff<0?T.red:T.border;
  const bgColor = (diff,T) => diff>0?T.blue+"0D":diff<0?T.red+"0D":T.isDark?"#0A1F10":T.elevated;

  const scrollToMatch = mi => {
    const ref = matchRefs[mi];
    if(ref && ref.current){
      ref.current.scrollIntoView({behavior:"smooth",block:"start"});
      // flash handled by parent
    }
  };

  function buildRow(rowIdx, stripW){
    const start = rowIdx*9;
    const rowPar = course.par.slice(start, start+9);
    const HOLE_W = stripW/9;

    // Compute max stacks needed above/below for height calculation
    let maxStackAbove=0, maxStackBelow=0;
    rowPar.forEach((_,i)=>{
      const hi=start+i;
      const mis=holeMap[hi]||[];
      const above=mis.filter(mi=>mi%2===0).length;
      const below=mis.filter(mi=>mi%2!==0).length;
      maxStackAbove=Math.max(maxStackAbove,above);
      maxStackBelow=Math.max(maxStackBelow,below);
    });
    const topPad = maxStackAbove>0 ? (CARD_H+STEM_H+2)*maxStackAbove+4 : 8;
    const botPad = maxStackBelow>0 ? (CARD_H+STEM_H+2)*maxStackBelow+4 : 8;
    const midY   = topPad+HOLE_R;
    const totalH = topPad+HOLE_R*2+botPad;

    return(
      <div style={{position:"relative",height:totalH,marginBottom:4}}>
        <div style={{position:"absolute",top:0,left:0,fontSize:"7.5px",color:T.gold+"66",letterSpacing:"1px",fontWeight:"700",textTransform:"uppercase"}}>
          {rowIdx===0?"R1 · L 1–9":"R2 · L 10–18"}
        </div>
        <div style={{position:"absolute",top:midY,left:4,right:4,height:2,background:`linear-gradient(90deg,${T.border},${T.muted}44,${T.border})`,borderRadius:1,transform:"translateY(-50%)"}}/>
        {rowPar.map((p,i)=>{
          const hi=start+i, hNum=hi+1;
          const mis=holeMap[hi]||[];
          const hasAny=mis.length>0;
          const allP=allPastHole(hi);
          const cx=(i+0.5)*HOLE_W;
          const bg2 = hasAny?T.gold+"22":allP?T.elevated:T.isDark?"#0A1F10":T.bg;
          const bdr = hasAny?T.gold:allP?T.border:T.isDark?"#1A3A20":"#D0DDD0";
          const tc2 = hasAny?T.gold:allP?T.muted:T.isDark?"#1E4020":"#C8D8C8";

          // Count stacks per side for this hole
          let aboveCount=0, belowCount=0;

          return(
            <div key={i}>
              {/* Hole circle */}
              <div style={{position:"absolute",left:cx-HOLE_R,top:midY-HOLE_R,width:HOLE_R*2,height:HOLE_R*2,borderRadius:"50%",background:bg2,border:`2px solid ${bdr}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:900,color:tc2,zIndex:2}}>{hNum}</div>
              {/* Par */}
              <div style={{position:"absolute",left:cx,top:midY+HOLE_R+3,transform:"translateX(-50%)",fontSize:"6.5px",color:T.isDark?"#1A3A20":"#C0D0C0",fontWeight:700}}>P{p}</div>
              {/* Cards for each match on this hole */}
              {mis.map(mi=>{
                const above=mi%2===0;
                const st=statuses[mi];
                const stackIdx=above?aboveCount++:belowCount++;
                const stackOffset=stackIdx*(CARD_H+3);
                const cardLeft=Math.max(2,Math.min(Math.round(cx-CARD_W/2), stripW-CARD_W-2));
                return above?(
                  <React.Fragment key={mi}>
                    <div style={{position:"absolute",left:cx-0.75,top:midY-HOLE_R-STEM_H,width:1.5,height:STEM_H+stackOffset,background:T.gold+"33",zIndex:1}}/>
                    <div onClick={()=>scrollToMatch(mi)} style={{position:"absolute",left:cardLeft,top:midY-HOLE_R-STEM_H-CARD_H-stackOffset,width:CARD_W,height:CARD_H,background:bgColor(st.diff,T),border:`1.5px solid ${bcColor(st.diff)}`,borderRadius:6,padding:"3px 6px",cursor:"pointer",zIndex:5+stackIdx,boxShadow:"0 2px 8px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
                      <span style={{fontSize:10,fontWeight:900,color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>M{mi+1}</span>
                      <span style={{fontSize:11,fontWeight:900,color:stColor(st.diff),fontFamily:"'Arial Black',sans-serif",whiteSpace:"nowrap"}}>{st.label}</span>
                    </div>
                  </React.Fragment>
                ):(
                  <React.Fragment key={mi}>
                    <div style={{position:"absolute",left:cx-0.75,top:midY+HOLE_R,width:1.5,height:STEM_H+stackOffset,background:T.gold+"33",zIndex:1}}/>
                    <div onClick={()=>scrollToMatch(mi)} style={{position:"absolute",left:cardLeft,top:midY+HOLE_R+STEM_H+stackOffset,width:CARD_W,height:CARD_H,background:bgColor(st.diff,T),border:`1.5px solid ${bcColor(st.diff)}`,borderRadius:6,padding:"3px 6px",cursor:"pointer",zIndex:5+stackIdx,boxShadow:"0 2px 8px rgba(0,0,0,0.3)",display:"flex",alignItems:"center",justifyContent:"space-between",gap:4}}>
                      <span style={{fontSize:10,fontWeight:900,color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>M{mi+1}</span>
                      <span style={{fontSize:11,fontWeight:900,color:stColor(st.diff),fontFamily:"'Arial Black',sans-serif",whiteSpace:"nowrap"}}>{st.label}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  const stripRef = React.useRef(null);
  const [stripW, setStripW] = useState(348);
  useEffect(()=>{
    if(!stripRef.current)return;
    const obs=new ResizeObserver(e=>{setStripW(e[0].contentRect.width||348);});
    obs.observe(stripRef.current);
    return()=>obs.disconnect();
  },[]);

  return(
    <div style={{background:T.isDark?"#0F2D1A":T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 10px 10px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{fontSize:"10px",color:T.faint,letterSpacing:"2px",textTransform:"uppercase",fontWeight:"700"}}>🗺 Flights</div>
        <div style={{fontSize:"10px",color:T.gold,fontWeight:"700"}}>{course.shortName}</div>
      </div>
      <div ref={stripRef}>
        {buildRow(0, stripW)}
        {buildRow(1, stripW)}
      </div>
      {doneMI.length>0&&(
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"6px 8px",background:T.gold+"0D",border:`1px solid ${T.gold}22`,borderRadius:8,marginTop:6,flexWrap:"wrap"}}>
          <span style={{fontSize:"10px",color:T.gold,fontWeight:"700"}}>✅</span>
          {doneMI.map(({mi,label},idx)=>{
            const st=statuses[mi];
            const c=stColor(st.diff);
            return(
              <span key={idx} onClick={()=>scrollToMatch(mi)}
                style={{background:c+"22",border:`1px solid ${c}55`,borderRadius:5,padding:"3px 7px",fontSize:"10px",fontWeight:900,color:c,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>
                <span style={{color:T.gold}}>M{mi+1}</span>
                <span style={{color:T.faint,fontSize:9}}>{label}</span>
                {st.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DaySummary({day,t1Name,t2Name,T}){
  const course=COURSES[day.courseKey]||Object.values(COURSES)[0];let t1=0,t2=0;
  day.matches.forEach(m=>{[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);const p=getPoints(rs);if(p){t1+=p.t1;t2+=p.t2;}});});
  return(<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontSize:"11px",color:T.gold,fontWeight:"700"}}>{day.label}</div><div style={{fontSize:"10px",color:T.faint}}>{course.shortName} · {day.matches.length} Matches</div></div><div style={{display:"flex",gap:"8px",alignItems:"center"}}><span style={{color:T.blue,fontWeight:"700",fontSize:"16px"}}>{fmt(t1)}</span><span style={{color:T.muted,fontSize:"11px"}}>:</span><span style={{color:T.red,fontWeight:"700",fontSize:"16px"}}>{fmt(t2)}</span></div></div>);
}

function Dashboard({config,role,onBack,onEndTournament,theme,onThemeToggle}){
  const T=THEMES[theme];
  const {t1Name,t2Name,days}=config;
  const [modal,setModal]=useState(null);
  const [activeTab,setActiveTab]=useState("day0");
  const [saving,setSaving]=useState(false);
  const [showPush,setShowPush]=useState(true);
  const [toast,setToast]=useState(null);
  const [resetAll,setResetAll]=useState(false);
  const [winEvent,setWinEvent]=useState(null);
  const [confetti,setConfetti]=useState(false);
  const [showEndConfirm,setShowEndConfirm]=useState(false);
  const [pairingDay,setPairingDay]=useState(null); // dayIdx to edit
  const prevRef=useRef(null);
  // Refs for scrolling to match cards from tracker
  const matchCardRefs=useRef({});
  const isAdmin=role==="admin",isViewer=role==="viewer";
  const editableIds=isAdmin?"all":isViewer?[]:(() => {
    const idx=parseInt(role.split("-")[1]);const all=[];days.forEach(d=>d.matches.forEach(m=>all.push(m.id)));
    const perDay=days[0]?.matches.length||4;return[all[idx],all[idx+perDay]].filter(id=>id!==undefined);
  })();
  const canEdit=id=>editableIds==="all"||editableIds.includes(id);
  const myMatchName=!isAdmin&&!isViewer?(()=>{const idx=parseInt(role.split("-")[1]);const all=[];days.forEach(d=>d.matches.forEach(m=>all.push(m.name)));return all[idx]||null;})():null;

  useEffect(()=>{if(!messaging)return;const u=onMessage(messaging,p=>{setToast({title:p.notification?.title,body:p.notification?.body});});return()=>u();},[]);
  useEffect(()=>{if(prevRef.current){const change=detectPointChange(prevRef.current,days,t1Name,t2Name);if(change){setToast(change);if(change.winner){setWinEvent(change);setConfetti(true);}}}prevRef.current=days;},[days]);

  const stats=calcTournament(days);const t1W=Math.max(5,Math.min(95,stats.t1WinProb));
  const doReset=async matchId=>{setSaving(true);const nd=days.map(day=>({...day,matches:day.matches.map(m=>m.id===matchId?{...m,scores:emptyScores()}:m)}));await saveTournament({...config,days:nd});setSaving(false);};
  const doResetAll=async()=>{setSaving(true);const nd=days.map(day=>({...day,matches:day.matches.map(m=>({...m,scores:emptyScores()}))}));await saveTournament({...config,days:nd});setSaving(false);setResetAll(false);};
  const saveScore=async(dayId,matchId,hi,t1s,t2s)=>{
    setSaving(true);
    const nd=days.map(day=>{if(day.id!==dayId)return day;return{...day,matches:day.matches.map(m=>{if(m.id!==matchId)return m;const ns=[...m.scores];ns[hi]={team1:t1s,team2:t2s};return{...m,scores:ns};})};});
    const change=detectPointChange(days,nd,t1Name,t2Name);if(change)await sendPushToAll(change.title,change.body,change.key);

    // ── System Chat Events ──────────────────────────────────────────────────
    const day=nd.find(d=>d.id===dayId);
    const match=day?.matches.find(m=>m.id===matchId);
    const course=day?COURSES[day.courseKey]||Object.values(COURSES)[0]:null;
    if(match&&course){
      const par=course.par[hi];
      const holeNum=hi+1;
      const matchName=match.name||`Match`;
      // Birdie or Eagle
      const best=Math.min(t1s,t2s);
      if(best<=par-2){
        const label=best<=par-3?"🦅 Eagle":"🐦 Birdie";
        await postChatMessage({type:"system",subtype:"birdie",text:`${label} auf Loch ${holeNum} (${best} vs Par ${par}) — ${matchName}`,ts:Date.now()},`birdie-${matchId}-${hi}`);
      }
      // Round decision
      const roundIdx=hi<9?0:1;const rs=calcRoundStatus(match.scores,course.par,roundIdx*9,roundIdx*9+9);
      const prevMatch=days.find(d=>d.id===dayId)?.matches.find(m=>m.id===matchId);
      const prevRs=prevMatch?calcRoundStatus(prevMatch.scores,course.par,roundIdx*9,roundIdx*9+9):null;
      if(rs.won&&!prevRs?.won){
        const winner=rs.diff>0?t1Name:rs.diff<0?t2Name:null;
        await postChatMessage({type:"system",subtype:"matchDecision",text:`🏆 ${matchName} · Runde ${roundIdx+1} entschieden: ${winner?winner+" gewinnt":""} ${rs.label}`,ts:Date.now()},`decision-${matchId}-${roundIdx}`);
      }
      // Lead change
      const prevDiff=prevMatch?prevMatch.scores.slice(0,hi).reduce((acc,s)=>{if(s.team1===null)return acc;return acc+(s.team1<s.team2?1:s.team2<s.team1?-1:0);},0):0;
      const newDiff=match.scores.slice(0,hi+1).reduce((acc,s)=>{if(s.team1===null)return acc;return acc+(s.team1<s.team2?1:s.team2<s.team1?-1:0);},0);
      if((prevDiff>0&&newDiff<0)||(prevDiff<0&&newDiff>0)){
        const leader=newDiff>0?t1Name:t2Name;
        await postChatMessage({type:"system",subtype:"leadChange",text:`🔄 Führungswechsel in ${matchName} nach Loch ${holeNum} — ${leader} übernimmt die Führung`,ts:Date.now()},`lead-${matchId}-${hi}`);
      } else if(prevDiff!==0&&newDiff===0&&!rs.won){
        await postChatMessage({type:"system",subtype:"equalize",text:`🤝 ${matchName} · Ausgleich auf Loch ${holeNum} — jetzt AS`,ts:Date.now()},`eq-${matchId}-${hi}`);
      }
      // Halftime: when hole 9 just completed
      if(hi===8){
        const r1=calcRoundStatus(match.scores,course.par,0,9);
        const pts=getPoints(r1);
        if(pts){await postChatMessage({type:"system",subtype:"halftime",text:`📊 Halbzeit ${matchName}: ${r1.label} — ${pts.t1>pts.t2?t1Name:pts.t2>pts.t1?t2Name:"Unentschieden"} gewinnt Runde 1`,ts:Date.now()},`halftime-${matchId}`);}
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    await saveTournament({...config,days:nd});setSaving(false);
    if(hi===8){setModal({dayId,matchId,holeIndex:9});}
    else{setModal(null);}
  };

  const dayTabs=days.map((d,i)=>({key:`day${i}`,label:`Spieltag ${i+1}`}));
  const tabs=[...dayTabs,{key:"stats",label:"Statistik",icon:<IconChart size={11} color="currentColor"/>},{key:"chat",label:"Chat",icon:<IconBell size={11} color="currentColor"/>}];
  const activeDayIdx=dayTabs.findIndex(t=>t.key===activeTab);
  const activeDay=activeDayIdx>=0?days[activeDayIdx]:null;
  const course=activeDay?COURSES[activeDay.courseKey]||Object.values(COURSES)[0]:null;
  const mMatch=modal?days.find(d=>d.id===modal.dayId)?.matches.find(m=>m.id===modal.matchId):null;
  const mDay=modal?days.find(d=>d.id===modal.dayId):null;
  const pushGranted=typeof Notification!=="undefined"&&Notification.permission==="granted";

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Confetti active={confetti} onDone={()=>setConfetti(false)}/>
      <WinBanner event={winEvent} onDone={()=>setWinEvent(null)}/>
      {toast&&<Toast message={toast} onDismiss={()=>setToast(null)}/>}
      {resetAll&&<ResetConfirm title="Alle Matches zurücksetzen?" message="Wirklich ALLE Scores löschen?" onConfirm={doResetAll} onClose={()=>setResetAll(false)} T={T}/>}
      {showEndConfirm&&<ResetConfirm title="Turnier beenden?" message="Das Turnier wird archiviert und ist danach unter 'Match Archiv' einsehbar." confirmLabel="Ja, Turnier beenden" danger={false} onConfirm={()=>{setShowEndConfirm(false);onEndTournament(config);}} onClose={()=>setShowEndConfirm(false)} T={T}/>}

      <Header title="Ryder Cup" onBack={onBack} backLabel="Menü" theme={theme} onThemeToggle={onThemeToggle} T={T}
        rightSlot={<div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:saving?"#C9A84C":"#4CAF50"}}/><div style={{fontSize:"9px",color:"rgba(255,255,255,0.4)",letterSpacing:"1px"}}>{saving?"...":"Live"}</div></div>}/>

      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {showPush&&!pushGranted&&<PushBanner onDismiss={()=>setShowPush(false)} T={T}/>}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:"12px"}}><RoleBadge role={role} T={T}/></div>
        {myMatchName&&<div style={{background:T.isDark?`linear-gradient(135deg,${T.gold}22,${T.gold}11)`:T.gold+"18",border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"10px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}><div style={{fontSize:"16px"}}>⛳</div><div><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Du spielst {myMatchName}</div><div style={{fontSize:"10px",color:T.faint}}>Tippe auf ein Loch zum Eintragen</div></div></div>}

        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
            <div><div style={{fontSize:"12px",fontWeight:"700",color:T.blue,textTransform:"uppercase",letterSpacing:"1px"}}>🔵 {t1Name}</div><div style={{fontSize:"40px",fontWeight:"900",color:T.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t1Confirmed)}</div><div style={{fontSize:"10px",color:T.faint}}>proj. {stats.t1Projected}</div></div>
            <div style={{textAlign:"center"}}><div style={{fontSize:"9px",color:T.muted}}>ZIEL</div><div style={{fontSize:"20px",fontWeight:"900",color:T.gold}}>{stats.needed}</div><div style={{fontSize:"9px",color:T.faint}}>von {stats.totalPoints}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"12px",fontWeight:"700",color:T.red,textTransform:"uppercase",letterSpacing:"1px"}}>🔴 {t2Name}</div><div style={{fontSize:"40px",fontWeight:"900",color:T.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t2Confirmed)}</div><div style={{fontSize:"10px",color:T.faint,textAlign:"right"}}>proj. {stats.t2Projected}</div></div>
          </div>
          <div style={{height:"16px",borderRadius:"8px",overflow:"hidden",display:"flex",margin:"4px 0"}}><div style={{width:`${t1W}%`,background:T.blue,transition:"width 0.6s"}}/><div style={{flex:1,background:T.red}}/></div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted}}><span>{stats.t1WinProb}% Sieg</span><span>{stats.t2WinProb}% Sieg</span></div>
          <div style={{marginTop:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>{days.map(d=><DaySummary key={d.id} day={d} t1Name={t1Name} t2Name={t2Name} T={T}/>)}</div>
        </div>

        {activeDay&&(
          <CourseTracker
            day={activeDay}
            matches={activeDay.matches}
            matchRefs={matchCardRefs.current}
            T={T}
          />
        )}

        {activeTab!=="chat"&&<LiveChat role={role} T={T} mini={true} onExpand={()=>setActiveTab("chat")}/>}

        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {tabs.map((tab,i)=>(<button key={tab.key} style={{flex:1,padding:"10px 4px",background:activeTab===tab.key?T.elevated:T.isDark?"#0A2014":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeTab===tab.key?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"0.5px",textTransform:"uppercase",fontWeight:activeTab===tab.key?"700":"400",display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"}} onClick={()=>setActiveTab(tab.key)}>{tab.icon}{tab.label}</button>))}
        </div>

        {activeTab==="chat"&&<LiveChat role={role} T={T} mini={false}/>}
        {activeTab==="stats"&&<StatsTab days={days} t1Name={t1Name} t2Name={t2Name} T={T}/>}
        {activeDay&&course&&(
          <>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}><div><div style={{fontSize:"13px",fontWeight:"700",color:T.cream}}>{course.name}</div><div style={{fontSize:"11px",color:T.faint}}>{course.location}</div></div><div style={{textAlign:"right"}}><div style={{fontSize:"10px",color:T.muted}}>Par</div><div style={{fontSize:"18px",fontWeight:"900",color:T.gold}}>{course.par.slice(0,9).reduce((a,b)=>a+b,0)} / {course.par.slice(9).reduce((a,b)=>a+b,0)}</div></div></div>
              {[0,1].map(r=>(<div key={r} style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:r===0?"3px":"0"}}>{course.par.slice(r*9,r*9+9).map((p,i)=>(<div key={i} style={{textAlign:"center",fontSize:"9px",padding:"2px 0",borderRadius:"3px",background:T.holeBg,color:T.holeText}}><div style={{opacity:0.6}}>{r*9+i+1}</div><div style={{fontWeight:"700"}}>P{p}</div></div>))}</div>))}
            </div>
            {activeDay.matches.map((m,mi)=>{
              const ref = matchCardRefs.current[mi] || (matchCardRefs.current[mi]=React.createRef());
              return(
                <div key={m.id} ref={ref} style={{scrollMarginTop:"76px"}}>
                  <MatchCard match={m} pars={course.par} t1Name={t1Name} t2Name={t2Name} canEdit={canEdit(m.id)} isAdmin={isAdmin} T={T} onHoleClick={(matchId,hi)=>setModal({dayId:activeDay.id,matchId,holeIndex:hi})} onReset={doReset}/>
                </div>
              );
            })}
            {isAdmin&&(<>
              <button style={{width:"100%",padding:"12px",background:"transparent",border:`1px solid ${T.blue}55`,borderRadius:"8px",color:T.blue,fontSize:"12px",cursor:"pointer",marginTop:"4px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}} onClick={()=>setPairingDay(activeDayIdx)}>✏️ Paarings Tag {activeDayIdx+1} ändern</button>
              <button style={{width:"100%",padding:"12px",background:"transparent",border:"1px solid #E05252",borderRadius:"8px",color:"#E05252",fontSize:"12px",cursor:"pointer",marginTop:"8px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}} onClick={()=>setResetAll(true)}><IconReset size={14} color="#E05252"/> Alle Matches zurücksetzen</button>
              <button style={{width:"100%",padding:"12px",background:"transparent",border:`1px solid ${T.gold}55`,borderRadius:"8px",color:T.gold,fontSize:"12px",cursor:"pointer",marginTop:"8px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px"}} onClick={()=>setShowEndConfirm(true)}><IconArchive size={14} color={T.gold}/> Turnier beenden & archivieren</button>
            </>)}
          </>
        )}
      </div>
      {modal&&mMatch&&mDay&&(
        <ScoreModal match={mMatch} holeIndex={modal.holeIndex} t1Name={t1Name} t2Name={t2Name} par={(COURSES[mDay.courseKey]||Object.values(COURSES)[0]).par} existing={mMatch.scores[modal.holeIndex]} onSave={(t1s,t2s)=>saveScore(modal.dayId,modal.matchId,modal.holeIndex,t1s,t2s)} onClose={()=>setModal(null)} T={T}/>
      )}
      {pairingDay!==null&&<PairingEditor config={config} dayIdx={pairingDay} T={T} onClose={()=>setPairingDay(null)} onSave={newConfig=>{setPairingDay(null);}}/>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MATCH ARCHIVE
// ══════════════════════════════════════════════════════════════════════════════
function MatchArchive({onBack,T,theme,onThemeToggle}){
  const [archived,setArchived]=useState([]);
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState(null);
  const [confirmDelete,setConfirmDelete]=useState(null);

  useEffect(()=>{
    getDocs(collection(db,"tournamentArchive")).then(snap=>{
      const docs=snap.docs.map(d=>({_id:d.id,...d.data()}));
      docs.sort((a,b)=>(b.archivedAt||0)-(a.archivedAt||0));
      setArchived(docs);setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  const deleteEntry=async id=>{
    await deleteDoc(doc(db,"tournamentArchive",id)).catch(()=>{});
    setArchived(prev=>prev.filter(a=>a._id!==id));setConfirmDelete(null);
  };

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Header title="Match Archiv" onBack={onBack} backLabel="Menü" theme={theme} onThemeToggle={onThemeToggle} T={T}/>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {loading&&<div style={{textAlign:"center",padding:"40px",color:T.muted}}>Lade...</div>}
        {!loading&&archived.length===0&&(
          <div style={{textAlign:"center",padding:"60px 20px"}}>
            <div style={{fontSize:"40px",marginBottom:"12px"}}>📦</div>
            <div style={{color:T.gold,fontSize:"16px",fontWeight:"700",marginBottom:"8px"}}>Noch keine archivierten Turniere</div>
            <div style={{color:T.muted,fontSize:"13px"}}>Beende ein aktives Turnier um es hier zu speichern</div>
          </div>
        )}
        {archived.map(entry=>{
          const isOpen=expanded===entry._id;
          const stats=entry.days?calcTournament(entry.days):null;
          return(
            <div key={entry._id} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",marginBottom:"12px",overflow:"hidden"}}>
              <div style={{padding:"12px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:"12px"}} onClick={()=>setExpanded(isOpen?null:entry._id)}>
                <div style={{fontSize:"28px"}}>🏆</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"13px",fontWeight:"700",color:T.gold}}>{entry.t1Name} vs {entry.t2Name}</div>
                  <div style={{fontSize:"11px",color:T.muted,marginTop:"2px"}}>{entry.archivedAtLabel||"—"} · {entry.days?.length||0} Tage · {entry.days?.reduce((s,d)=>s+d.matches.length,0)||0} Matches</div>
                  {stats&&<div style={{fontSize:"11px",marginTop:"4px"}}><span style={{color:T.blue,fontWeight:"700"}}>{fmt(stats.t1Confirmed)}</span><span style={{color:T.muted}}> : </span><span style={{color:T.red,fontWeight:"700"}}>{fmt(stats.t2Confirmed)}</span></div>}
                </div>
                <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                  <button onClick={e=>{e.stopPropagation();setConfirmDelete(entry);}} style={{padding:"6px 8px",background:"transparent",border:"1px solid #E0525244",borderRadius:"6px",color:"#E05252",cursor:"pointer"}}><IconTrash size={13} color="#E05252"/></button>
                  <div style={{fontSize:"18px",color:T.faint,transform:isOpen?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.2s"}}>›</div>
                </div>
              </div>
              {isOpen&&entry.days&&(
                <div style={{borderTop:`1px solid ${T.border}`,padding:"12px 14px"}}>
                  {entry.days.map((day,di)=>{
                    const course=COURSES[day.courseKey]||Object.values(COURSES)[0];
                    let dayT1=0,dayT2=0;day.matches.forEach(m=>{[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);const p=getPoints(rs);if(p){dayT1+=p.t1;dayT2+=p.t2;}});});
                    return(
                      <div key={di} style={{marginBottom:"12px"}}>
                        <div style={{fontSize:"11px",color:T.gold,fontWeight:"700",marginBottom:"8px"}}>{day.label} – <span style={{color:T.blue}}>{fmt(dayT1)}</span> : <span style={{color:T.red}}>{fmt(dayT2)}</span></div>
                        {day.matches.map(m=>{
                          const r1=calcRoundStatus(m.scores,course.par,0,9);const r2=calcRoundStatus(m.scores,course.par,9,18);
                          const p1=getPoints(r1);const p2=getPoints(r2);
                          return(
                            <div key={m.id} style={{background:T.isDark?"#0A2014":T.elevated,borderRadius:"8px",padding:"8px 10px",marginBottom:"6px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div>
                                <div style={{fontSize:"11px",fontWeight:"700",color:T.cream}}>{m.name}</div>
                                <div style={{fontSize:"10px",color:T.blue}}>{(m.t1Pair||[]).join(" & ")}</div>
                                <div style={{fontSize:"10px",color:T.red}}>{(m.t2Pair||[]).join(" & ")}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                {[["R1",p1],["R2",p2]].map(([lbl,pts])=>(
                                  <div key={lbl} style={{fontSize:"10px",color:T.muted}}>{lbl}: {pts?<><span style={{color:T.blue}}>{pts.t1}</span>–<span style={{color:T.red}}>{pts.t2}</span></>:"laufend"}</div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {confirmDelete&&<ResetConfirm title="Archiveintrag löschen?" message={`"${confirmDelete.t1Name} vs ${confirmDelete.t2Name}" wird dauerhaft gelöscht.`} onConfirm={()=>deleteEntry(confirmDelete._id)} onClose={()=>setConfirmDelete(null)} T={T}/>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN MENU + ROOT APP
// ══════════════════════════════════════════════════════════════════════════════
function AdminMenu({config,onSelect,onBack,theme,onThemeToggle,T}){
  const hasConfig=!!config;
  const menuItems=[
    {key:"players",icon:"👤",label:"Spielerverwaltung",desc:"Spieler erstellen & verwalten",available:true,color:T.blue},
    {key:"planning",icon:"📋",label:"Turnierplanung",desc:"Spieltage, Matches & Spielerzuordnung",available:true,color:T.gold},
    {key:"game",icon:"⛳",label:"Turnier Durchführung",desc:hasConfig?"Scores eintragen & live verfolgen":"Zuerst Turnier planen",available:hasConfig,color:T.muted},
    {key:"archive",icon:"📦",label:"Match Archiv",desc:"Abgeschlossene Turniere einsehen",available:true,color:T.faint},
  ];
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Header title="Ryder Cup" subtitle="ADMIN BEREICH" onBack={onBack} backLabel="Login" theme={theme} onThemeToggle={onThemeToggle} T={T}/>
      <div style={{padding:"20px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.elevated,border:`1px solid ${T.gold}44`,borderRadius:"10px",padding:"12px 16px",marginBottom:"20px",display:"flex",alignItems:"center",gap:"10px"}}>
          <span style={{fontSize:"20px"}}>👑</span>
          <div><div style={{fontSize:"12px",fontWeight:"700",color:T.gold}}>Administrator</div><div style={{fontSize:"11px",color:T.muted}}>Vollzugriff auf alle Bereiche</div></div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:hasConfig?"#4CAF50":"#C9A84C"}}/><div style={{fontSize:"10px",color:T.faint}}>{hasConfig?"Aktiv":"Kein Turnier"}</div></div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          {menuItems.map(item=>(
            <button key={item.key} onClick={()=>item.available&&onSelect(item.key)}
              style={{width:"100%",background:T.cardBg,border:`2px solid ${item.available?item.color+"55":T.border}`,borderRadius:"14px",padding:"16px 18px",cursor:item.available?"pointer":"not-allowed",textAlign:"left",display:"flex",alignItems:"center",gap:"14px",opacity:item.available?1:0.5}}>
              <div style={{width:"48px",height:"48px",borderRadius:"12px",background:item.color+"22",border:`1px solid ${item.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"22px",flexShrink:0}}>{item.icon}</div>
              <div style={{flex:1}}><div style={{fontSize:"14px",fontWeight:"900",color:item.available?item.color:T.muted,fontFamily:"'Arial Black',sans-serif"}}>{item.label}</div><div style={{fontSize:"11px",color:T.faint,marginTop:"2px"}}>{item.desc}</div></div>
              <div style={{fontSize:"18px",color:item.available?item.color:T.border,opacity:0.6}}>›</div>
            </button>
          ))}
        </div>
        {hasConfig&&(
          <div style={{marginTop:"18px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px"}}>
            <div style={{fontSize:"10px",color:T.gold,letterSpacing:"1px",marginBottom:"8px",textTransform:"uppercase"}}>Aktives Turnier</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px"}}><span style={{color:T.blue}}>🔵 {config.t1Name}</span><span style={{color:T.muted}}>vs</span><span style={{color:T.red}}>🔴 {config.t2Name}</span></div>
            <div style={{fontSize:"11px",color:T.faint,marginTop:"6px"}}>{config.days?.length||0} Spieltage · {config.days?.reduce((s,d)=>s+d.matches.length,0)||0} Matches</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Viewer Archive access (non-admin sees archive too) ────────────────────────
function ViewerArchive({onBack,T,theme,onThemeToggle}){
  return<MatchArchive onBack={onBack} T={T} theme={theme} onThemeToggle={onThemeToggle}/>;
}

export default function App(){
  const [phase,setPhase]=useState("login");
  const [adminSection,setAdminSection]=useState(null);
  const [config,setConfig]=useState(null);
  const [role,setRole]=useState(null);
  const [loading,setLoading]=useState(false);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem("ryder_theme")||"light";}catch(e){return"light";}});
  // Warn when planning over existing tournament
  const [showOverwriteWarn,setShowOverwriteWarn]=useState(false);
  const [pendingNewTournament,setPendingNewTournament]=useState(false);

  const changeTheme=t=>{setTheme(t);try{localStorage.setItem("ryder_theme",t);}catch(e){}};
  const toggleTheme=()=>changeTheme(theme==="dark"?"light":"dark");
  const goToLogin=()=>{setPhase("login");setConfig(null);setRole(null);setAdminSection(null);};
  const goToAdminMenu=()=>setAdminSection(null);

  const handleLogin=async r=>{
    setRole(r);setLoading(true);
    try{
      const s=await getDoc(doc(db,"tournaments","ryder2024"));
      if(s.exists()&&s.data()?.phase==="game"){setConfig(s.data());if(r==="admin")setPhase("adminMenu");else setPhase("game");}
      else{if(r==="admin")setPhase("adminMenu");else setPhase("waiting");}
    }catch(e){if(r==="admin")setPhase("adminMenu");else setPhase("waiting");}
    setLoading(false);
  };

  const handleSelectSection=s=>{
    if(s==="planning"&&config){setShowOverwriteWarn(true);}
    else setAdminSection(s);
  };

  const handleEndTournament=async cfg=>{
    await archiveTournament(cfg);
    // Clear active tournament
    await saveTournament({...cfg,phase:"archived"});
    setConfig(null);setAdminSection(null);
  };

  const handleNewTournamentConfirmed=async()=>{
    // Archive current if it exists
    if(config){await archiveTournament(config);}
    setShowOverwriteWarn(false);setAdminSection("planning");
  };

  useEffect(()=>{
    const needsLive=(phase==="game")||(phase==="adminMenu"&&adminSection==="game");
    if(!needsLive)return;
    const u=onSnapshot(doc(db,"tournaments","ryder2024"),s=>{if(s.exists()&&s.data()?.phase==="game")setConfig(s.data());});
    return()=>u();
  },[phase,adminSection]);

  const T=THEMES[theme];

  if(phase==="login")return<Login onLogin={handleLogin} theme={theme} onThemeToggle={toggleTheme}/>;
  if(loading)return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>⛳</div><div style={{color:T.muted,fontSize:"14px",letterSpacing:"2px"}}>Lade...</div></div>
    </div>
  );
  if(phase==="waiting")return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
      <Header title="Ryder Cup" onBack={goToLogin} backLabel="Login" theme={theme} onThemeToggle={toggleTheme} T={T}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 60px)",padding:"20px",gap:"16px"}}>
        <div style={{textAlign:"center"}}><div style={{fontSize:"40px",marginBottom:"12px"}}>⏳</div><div style={{color:T.gold,fontSize:"16px",fontWeight:"700",marginBottom:"8px"}}>Turnier noch nicht gestartet</div><div style={{color:T.muted,fontSize:"13px",marginBottom:"12px"}}>Der Admin muss zuerst das Turnier einrichten.</div><RoleBadge role={role} T={T}/></div>
        <button onClick={()=>setPhase("viewerArchive")} style={{padding:"10px 20px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"12px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px"}}>
          <IconArchive size={14} color={T.muted}/> Match Archiv ansehen
        </button>
      </div>
    </div>
  );
  if(phase==="viewerArchive")return<ViewerArchive onBack={()=>setPhase("waiting")} T={T} theme={theme} onThemeToggle={toggleTheme}/>;

  if(phase==="adminMenu"){
    if(showOverwriteWarn)return(
      <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"Georgia,serif"}}>
        <Header title="Ryder Cup" T={T} theme={theme} onThemeToggle={toggleTheme}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"calc(100vh - 60px)",padding:"20px"}}>
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px",padding:"24px 20px",maxWidth:"300px",width:"100%",textAlign:"center"}}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>⚠️</div>
            <div style={{fontSize:"15px",fontWeight:"700",color:T.cream,marginBottom:"8px"}}>Aktives Turnier vorhanden!</div>
            <div style={{fontSize:"12px",color:T.muted,marginBottom:"20px"}}>Das laufende Turnier <strong style={{color:T.gold}}>{config?.t1Name} vs {config?.t2Name}</strong> wird zuerst archiviert, bevor ein neues geplant werden kann.</div>
            <button style={{width:"100%",padding:"11px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:"#0D2B1A",fontSize:"13px",fontWeight:"700",cursor:"pointer",marginBottom:"8px"}} onClick={handleNewTournamentConfirmed}>Archivieren & Neu planen</button>
            <button style={{width:"100%",padding:"11px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={()=>setShowOverwriteWarn(false)}>Abbrechen</button>
          </div>
        </div>
      </div>
    );
    if(!adminSection)return<AdminMenu config={config} onSelect={handleSelectSection} onBack={goToLogin} theme={theme} onThemeToggle={toggleTheme} T={T}/>;
    if(adminSection==="players")return<PlayerManager onBack={goToAdminMenu} T={T} theme={theme} onThemeToggle={toggleTheme}/>;
    if(adminSection==="planning")return<TournamentPlanning onStart={cfg=>{setConfig(cfg);setAdminSection("game");}} onBack={goToAdminMenu} T={T} theme={theme} onThemeToggle={toggleTheme}/>;
    if(adminSection==="archive")return<MatchArchive onBack={goToAdminMenu} T={T} theme={theme} onThemeToggle={toggleTheme}/>;
    if(adminSection==="game"){
      if(!config)return<AdminMenu config={config} onSelect={handleSelectSection} onBack={goToLogin} theme={theme} onThemeToggle={toggleTheme} T={T}/>;
      return<Dashboard config={config} role="admin" onBack={goToAdminMenu} onEndTournament={handleEndTournament} theme={theme} onThemeToggle={toggleTheme}/>;
    }
  }

  if(!config)return null;
  return<Dashboard config={config} role={role} onBack={goToLogin} onEndTournament={()=>{}} theme={theme} onThemeToggle={toggleTheme}/>;
}
