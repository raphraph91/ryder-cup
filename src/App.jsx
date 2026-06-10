import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const VERSION = "6";

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

async function saveTournament(data) { await setDoc(doc(db,"tournaments","ryder2024"),data); }
async function registerFCMToken() {
  if(!messaging)return null;
  try { const t=await getToken(messaging,{vapidKey:VAPID_KEY}); if(t){await setDoc(doc(db,"fcm_tokens",t),{token:t,createdAt:Date.now()});return t;} } catch(e){}
  return null;
}
async function sendPushToAll(title,body) {
  try { await fetch('/api/send-push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,body})}); } catch(e){}
}

// ── Access ────────────────────────────────────────────────────────────────────
const ADMIN_CODE="RYDER-ADMIN", VIEWER_CODE="RYDER2024";
function resolveRole(code) {
  const c=code.trim().toUpperCase();
  if(c===ADMIN_CODE)return"admin"; if(c===VIEWER_CODE)return"viewer";
  const m=c.match(/^MATCH(\d+)$/); if(m)return`match-${parseInt(m[1])-1}`;
  return null;
}

// ── Courses ───────────────────────────────────────────────────────────────────
const COURSES = {
  riedhof:{name:"GC München-Riedhof",shortName:"Riedhof",location:"Egling",par:[4,3,4,5,3,4,3,4,4,4,3,5,4,5,4,5,4,4]},
  bergkramerhof:{name:"Golfclub Bergkramerhof",shortName:"Bergkramerhof",location:"Wolfratshausen",par:[4,5,3,4,4,3,5,3,5,4,3,4,3,5,4,5,4,4]},
};

// ── HCP ───────────────────────────────────────────────────────────────────────
function calcTeamHcp(h1,h2){const lo=Math.min(h1,h2),hi=Math.max(h1,h2);return Math.round((lo*0.35+hi*0.15)*10)/10;}

// ── Matchplay ─────────────────────────────────────────────────────────────────
function calcRoundStatus(scores,pars,s,e){
  let diff=0,played=0;
  for(let i=s;i<e;i++){const h=scores[i];if(h.team1!==null&&h.team2!==null){played++;if(h.team1<h.team2)diff++;else if(h.team2<h.team1)diff--;}}
  const left=e-s-played;let won=false,label="AS";
  if(left===0){won=true;label=diff>0?"1UP":diff<0?"1UP":"AS";}
  else if(Math.abs(diff)>left){won=true;label=`${Math.abs(diff)}&${left}`;}
  else if(diff!==0){label=`${Math.abs(diff)} UP`;}
  return{diff,holesPlayed:played,holesLeft:left,label,won};
}
function getPoints(rs){
  if(rs.won||rs.holesLeft===0){if(rs.diff>0)return{t1:1,t2:0};if(rs.diff<0)return{t1:0,t2:1};return{t1:0.5,t2:0.5};}
  return null;
}
function projectedPoints(rs){
  if(rs.won||rs.holesLeft===0)return getPoints(rs);
  const a=rs.diff/18;return{t1:0.5+a*0.4,t2:0.5-a*0.4};
}
function calcTournament(days){
  let t1c=0,t2c=0,t1p=0,t2p=0,total=0;
  days.forEach(day=>{const c=COURSES[day.courseKey];day.matches.forEach(m=>{total+=2;[0,1].forEach(r=>{const rs=calcRoundStatus(m.scores,c.par,r*9,r*9+9);const conf=getPoints(rs),proj=projectedPoints(rs);if(conf){t1c+=conf.t1;t2c+=conf.t2;}t1p+=proj.t1;t2p+=proj.t2;});});});
  const s=t1p+t2p;
  return{t1Confirmed:t1c,t2Confirmed:t2c,t1Projected:Math.round(t1p*10)/10,t2Projected:Math.round(t2p*10)/10,t1WinProb:s>0?Math.round((t1p/s)*100):50,t2WinProb:s>0?Math.round((t2p/s)*100):50,totalPoints:total,needed:total/2+0.5};
}
function emptyScores(){return Array.from({length:18},()=>({team1:null,team2:null}));}
function detectPointChange(oldDays,newDays,t1Name,t2Name){
  if(!oldDays)return null;
  for(let di=0;di<newDays.length;di++){
    const od=oldDays[di],nd=newDays[di];if(!od)continue;
    const c=COURSES[nd.courseKey];
    for(let mi=0;mi<nd.matches.length;mi++){
      const om=od.matches[mi],nm=nd.matches[mi];if(!om)continue;
      for(let r=0;r<2;r++){
        const ors=calcRoundStatus(om.scores,c.par,r*9,r*9+9),nrs=calcRoundStatus(nm.scores,c.par,r*9,r*9+9);
        const op=getPoints(ors),np=getPoints(nrs);
        if(!op&&np){const runde=r===0?"Runde 1":"Runde 2";const winner=np.t1>np.t2?t1Name:np.t2>np.t1?t2Name:null;
          return{title:winner?`🏆 ${winner} gewinnt ${runde}!`:`🤝 ${runde} Unentschieden`,body:`${nm.name} · ${runde} · ${np.t1}:${np.t2} Punkte`,winner,matchName:nm.name,runde};}
      }
    }
  }
  return null;
}

// ── Statistics ────────────────────────────────────────────────────────────────
function calcStats(days,t1Name,t2Name){
  const pairStats={};
  let t1TotalHoles=0,t2TotalHoles=0;
  const holeWins={t1:Array(18).fill(0),t2:Array(18).fill(0),tie:Array(18).fill(0)};

  days.forEach((day,di)=>{
    const course=COURSES[day.courseKey];
    day.matches.forEach(m=>{
      const key1=m.t1Pair.join(" & "),key2=m.t2Pair.join(" & ");
      if(!pairStats[key1])pairStats[key1]={name:key1,team:"t1",pts:0,holesWon:0,rounds:0,matchesPlayed:0};
      if(!pairStats[key2])pairStats[key2]={name:key2,team:"t2",pts:0,holesWon:0,rounds:0,matchesPlayed:0};

      let matchHasData=false;
      [0,1].forEach(r=>{
        const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);
        const pts=getPoints(rs);
        if(rs.holesPlayed>0){
          pairStats[key1].rounds++;pairStats[key2].rounds++;
          matchHasData=true;
          // count holes won in this round
          for(let i=r*9;i<r*9+9;i++){
            const s=m.scores[i];
            if(s.team1!==null&&s.team2!==null){
              if(s.team1<s.team2){pairStats[key1].holesWon++;t1TotalHoles++;holeWins.t1[i]++;}
              else if(s.team2<s.team1){pairStats[key2].holesWon++;t2TotalHoles++;holeWins.t2[i]++;}
              else{holeWins.tie[i]++;}
            }
          }
        }
        if(pts){
          pairStats[key1].pts+=pts.t1;pairStats[key2].pts+=pts.t2;
        }
      });
      if(matchHasData){pairStats[key1].matchesPlayed++;pairStats[key2].matchesPlayed++;}
    });
  });

  // Best performers
  const allPairs=Object.values(pairStats);
  const t1Pairs=allPairs.filter(p=>p.team==="t1").sort((a,b)=>b.pts-a.pts);
  const t2Pairs=allPairs.filter(p=>p.team==="t2").sort((a,b)=>b.pts-a.pts);

  // Hole difficulty (most contested)
  const hotHoles=holeWins.t1.map((_,i)=>({hole:i+1,t1:holeWins.t1[i],t2:holeWins.t2[i],tie:holeWins.tie[i],total:holeWins.t1[i]+holeWins.t2[i]+holeWins.tie[i]})).filter(h=>h.total>0).sort((a,b)=>b.total-a.total);

  return{t1Pairs,t2Pairs,t1TotalHoles,t2TotalHoles,holeWins,hotHoles,allPairs};
}

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES={
  dark:{bg:"#0D2B1A",surface:"#0F2D1A",elevated:"#1A4D2E",border:"#2D6B40",borderFaint:"#1A4030",gold:"#C9A84C",cream:"#F2EDD7",muted:"#8BAF7C",faint:"#4A7A5C",blue:"#4A9EFF",red:"#FF6B6B",holeBg:"#1A3D25",holeText:"#4A7A5C",headerBg:"linear-gradient(135deg,#0A2014,#1A4D2E)",cardBg:"linear-gradient(180deg,#1A4D2E 0%,#0F3320 100%)",isDark:true},
  light:{bg:"#F4F6F4",surface:"#FFFFFF",elevated:"#EEF2EE",border:"#D0DDD0",borderFaint:"#E0E8E0",gold:"#2E7D32",cream:"#1A1A1A",muted:"#5A7A5A",faint:"#8A9A8A",blue:"#1565C0",red:"#C62828",holeBg:"#F0F4F0",holeText:"#AAAAAA",headerBg:"linear-gradient(135deg,#1B5E20,#2E7D32)",cardBg:"#FFFFFF",isDark:false},
};
const fmt=v=>v%1===0?v:v.toFixed(1);

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IconReset=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const IconSettings=({size=18,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
const IconBack=({size=14,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>;
const IconChart=({size=16,color="currentColor"})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;

// ── Confetti Animation ────────────────────────────────────────────────────────
function Confetti({ active, onDone }) {
  const canvasRef=useRef(null);
  useEffect(()=>{
    if(!active)return;
    const canvas=canvasRef.current; if(!canvas)return;
    const ctx=canvas.getContext("2d");
    canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const pieces=Array.from({length:120},()=>({
      x:Math.random()*canvas.width, y:-20,
      w:8+Math.random()*8, h:8+Math.random()*8,
      r:Math.random()*Math.PI*2,
      dr:(Math.random()-0.5)*0.2,
      dx:(Math.random()-0.5)*4,
      dy:3+Math.random()*4,
      color:["#C9A84C","#4A9EFF","#FF6B6B","#8BAF7C","#F2EDD7","#FFD700"][Math.floor(Math.random()*6)],
      opacity:1,
    }));
    let frame,start=null;
    const draw=(ts)=>{
      if(!start)start=ts;
      const elapsed=ts-start;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      pieces.forEach(p=>{
        p.x+=p.dx; p.y+=p.dy; p.r+=p.dr;
        if(elapsed>2000)p.opacity=Math.max(0,p.opacity-0.02);
        ctx.save(); ctx.globalAlpha=p.opacity;
        ctx.translate(p.x,p.y); ctx.rotate(p.r);
        ctx.fillStyle=p.color;
        ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);
        ctx.restore();
      });
      if(elapsed<3500)frame=requestAnimationFrame(draw);
      else{ctx.clearRect(0,0,canvas.width,canvas.height);onDone();}
    };
    frame=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frame);};
  },[active]);
  if(!active)return null;
  return<canvas ref={canvasRef} style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:500}}/>;
}

// ── Win Banner ────────────────────────────────────────────────────────────────
function WinBanner({ event, onDone }) {
  useEffect(()=>{ if(!event)return; const t=setTimeout(onDone,4000); return()=>clearTimeout(t); },[event]);
  if(!event)return null;
  const isDraw=!event.winner;
  return(
    <div style={{position:"fixed",top:"80px",left:"50%",transform:"translateX(-50%)",zIndex:501,textAlign:"center",pointerEvents:"none",width:"90%",maxWidth:"360px",animation:"slideDown 0.4s ease"}}>
      <style>{`@keyframes slideDown{from{transform:translateX(-50%) translateY(-30px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}`}</style>
      <div style={{background:isDraw?"linear-gradient(135deg,#2D6B40,#1A4D2E)":"linear-gradient(135deg,#C9A84C,#A07830)",borderRadius:"16px",padding:"18px 24px",boxShadow:"0 8px 32px rgba(0,0,0,0.5)",border:"2px solid rgba(255,255,255,0.2)"}}>
        <div style={{fontSize:"36px",marginBottom:"6px"}}>{isDraw?"🤝":"🏆"}</div>
        <div style={{fontSize:"18px",fontWeight:"900",color:isDraw?"#F2EDD7":"#0D2B1A",fontFamily:"'Arial Black',sans-serif",letterSpacing:"1px"}}>{event.title}</div>
        <div style={{fontSize:"12px",color:isDraw?"#8BAF7C":"rgba(0,0,0,0.6)",marginTop:"4px"}}>{event.body}</div>
      </div>
    </div>
  );
}

// ── Statistics Tab ────────────────────────────────────────────────────────────
function StatsTab({ days, t1Name, t2Name, T }) {
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
    <div style={{padding:"0 0 20px"}}>

      {/* Holes Won Overview */}
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        <div style={{fontSize:"11px",color:T.muted,letterSpacing:"1px",marginBottom:"10px",textTransform:"uppercase"}}>Gewonnene Löcher gesamt</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:"8px"}}>
          <div><div style={{fontSize:"11px",color:T.blue,fontWeight:"700"}}>🔵 {t1Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t1TotalHoles}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:"10px",color:T.faint}}>Löcher</div><div style={{fontSize:"13px",color:T.muted}}>gespielt</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:T.red,fontWeight:"700"}}>🔴 {t2Name}</div><div style={{fontSize:"32px",fontWeight:"900",color:T.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{stats.t2TotalHoles}</div></div>
        </div>
        <div style={{height:"12px",borderRadius:"6px",overflow:"hidden",display:"flex"}}>
          <div style={{width:`${t1HolePct}%`,background:T.blue,transition:"width 0.6s ease"}}/>
          <div style={{flex:1,background:T.red}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:T.muted,marginTop:"4px"}}>
          <span>{t1HolePct}%</span><span>{100-t1HolePct}%</span>
        </div>
      </div>

      {/* Per-Pair Stats */}
      <SectionTitle>🔵 {t1Name} – Paarungen</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.t1Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t1Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT1}/>)}
      </div>

      <SectionTitle>🔴 {t2Name} – Paarungen</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.t2Pairs.length===0?<div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>:stats.t2Pairs.map((p,i)=><PairRow key={i} pair={p} maxPts={maxT2}/>)}
      </div>

      {/* Hole by Hole */}
      <SectionTitle>Loch-Statistik</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
        {stats.hotHoles.length===0?(
          <div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine Daten</div>
        ):(
          <>
            <div style={{display:"grid",gridTemplateColumns:"30px 1fr 30px",gap:"4px",marginBottom:"8px"}}>
              <div style={{fontSize:"9px",color:T.blue,textAlign:"center"}}>🔵</div>
              <div style={{fontSize:"9px",color:T.faint,textAlign:"center",letterSpacing:"1px"}}>LOCH</div>
              <div style={{fontSize:"9px",color:T.red,textAlign:"center"}}>🔴</div>
            </div>
            {stats.hotHoles.slice(0,9).map((h,i)=>{
              const tot=h.t1+h.t2+h.tie||1;
              const t1w=(h.t1/tot)*100,t2w=(h.t2/tot)*100;
              return(
                <div key={i} style={{marginBottom:"8px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"30px 1fr 30px",gap:"4px",alignItems:"center",marginBottom:"3px"}}>
                    <div style={{fontSize:"11px",color:T.blue,textAlign:"center",fontWeight:"700"}}>{h.t1}</div>
                    <div style={{fontSize:"10px",color:T.muted,textAlign:"center"}}>Loch {h.hole}</div>
                    <div style={{fontSize:"11px",color:T.red,textAlign:"center",fontWeight:"700"}}>{h.t2}</div>
                  </div>
                  <div style={{display:"flex",height:"6px",borderRadius:"3px",overflow:"hidden",background:T.elevated}}>
                    <div style={{width:`${t1w}%`,background:T.blue}}/>
                    <div style={{width:`${(h.tie/tot)*100}%`,background:T.border}}/>
                    <div style={{width:`${t2w}%`,background:T.red}}/>
                  </div>
                </div>
              );
            })}
            <div style={{display:"flex",gap:"12px",justifyContent:"center",marginTop:"8px",fontSize:"9px",color:T.muted}}>
              <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"8px",height:"8px",background:T.blue,borderRadius:"2px",display:"inline-block"}}/>{t1Name}</span>
              <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"8px",height:"8px",background:T.border,borderRadius:"2px",display:"inline-block"}}/>Unentschieden</span>
              <span style={{display:"flex",alignItems:"center",gap:"4px"}}><span style={{width:"8px",height:"8px",background:T.red,borderRadius:"2px",display:"inline-block"}}/>{t2Name}</span>
            </div>
          </>
        )}
      </div>

      {/* Best Performer */}
      <SectionTitle>🌟 Top Performer</SectionTitle>
      <div style={{background:T.isDark?T.cardBg:T.surface,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px"}}>
        {stats.allPairs.filter(p=>p.pts>0).length===0?(
          <div style={{fontSize:"12px",color:T.faint,textAlign:"center"}}>Noch keine abgeschlossenen Runden</div>
        ):(
          stats.allPairs.filter(p=>p.pts>0).sort((a,b)=>b.pts-a.pts).slice(0,3).map((p,i)=>{
            const color=p.team==="t1"?T.blue:T.red;
            const medals=["🥇","🥈","🥉"];
            return(
              <div key={i} style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px",background:T.elevated,borderRadius:"8px",marginBottom:"8px",border:`1px solid ${color}33`}}>
                <div style={{fontSize:"20px"}}>{medals[i]||"⛳"}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:"12px",fontWeight:"700",color}}>{p.name}</div>
                  <div style={{fontSize:"10px",color:T.faint}}>{p.team==="t1"?t1Name:t2Name} · {p.holesWon} Löcher gewonnen</div>
                </div>
                <div style={{fontSize:"20px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>{fmt(p.pts)}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
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
            <button key={k} onClick={()=>onThemeChange(k)} style={{flex:1,padding:"14px 10px",borderRadius:"10px",border:`2px solid ${currentTheme===k?T.gold:T.border}`,background:currentTheme===k?T.gold+"22":T.elevated,color:currentTheme===k?T.gold:T.muted,fontSize:"13px",cursor:"pointer",fontWeight:currentTheme===k?"700":"400"}}>
              {l}
            </button>
          ))}
        </div>
        <button style={{width:"100%",padding:"12px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"8px",color:T.muted,fontSize:"13px",cursor:"pointer"}} onClick={onClose}>Schließen</button>
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

// ── Push Banner ───────────────────────────────────────────────────────────────
function PushBanner({onDismiss,T}){
  const [state,setState]=useState("idle");
  const req=async()=>{setState("requesting");if(!("Notification"in window)||!messaging){setState("unsupported");return;}try{const p=await Notification.requestPermission();if(p==="granted"){await registerFCMToken();setState("granted");setTimeout(onDismiss,2000);}else setState("denied");}catch(e){setState("denied");}};
  if(state==="granted")return<div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px"}}><span style={{fontSize:"20px"}}>✅</span><div style={{fontSize:"12px",color:T.muted}}>Push-Benachrichtigungen aktiviert!</div></div>;
  if(state==="denied"||state==="unsupported")return<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px"}}><div style={{fontSize:"12px",color:"#E05252",marginBottom:"4px"}}>{state==="unsupported"?"❌ Bitte App als PWA installieren":"❌ Benachrichtigungen blockiert"}</div><button style={{width:"100%",padding:"8px",background:"transparent",border:`1px solid ${T.border}`,borderRadius:"6px",color:T.muted,fontSize:"12px",cursor:"pointer",marginTop:"8px"}} onClick={onDismiss}>Schließen</button></div>;
  return(
    <div style={{background:T.isDark?"linear-gradient(135deg,#1A3D2E,#0F2D1A)":T.elevated,border:`1px solid ${T.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"10px"}}>
        <span style={{fontSize:"22px"}}>🔔</span>
        <div><div style={{fontSize:"13px",fontWeight:"700",color:T.gold,marginBottom:"3px"}}>Push-Benachrichtigungen</div><div style={{fontSize:"11px",color:T.muted}}>Erhalte eine Benachrichtigung wenn ein Team einen Punkt gewinnt.</div><div style={{fontSize:"10px",color:T.faint,marginTop:"4px"}}>⚠️ Nur als PWA (Homescreen) auf iOS 16.4+</div></div>
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

// ── Admin Setup Steps ─────────────────────────────────────────────────────────
function SetupStep1({onNext,onBack,T}){
  const [t1Name,setT1Name]=useState("Team Europa"),[t2Name,setT2Name]=useState("Team USA"),[mc,setMc]=useState(4);
  const inp={width:"100%",padding:"10px 12px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"8px",color:T.cream,fontSize:"14px",boxSizing:"border-box",outline:"none"};
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup · 1/3</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>TEAMS & MATCHES</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"10px",color:T.blue,letterSpacing:"2px",marginBottom:"6px"}}>🔵 TEAM 1</div>
          <input style={{...inp,marginBottom:"14px"}} value={t1Name} onChange={e=>setT1Name(e.target.value)}/>
          <div style={{fontSize:"10px",color:T.red,letterSpacing:"2px",marginBottom:"6px"}}>🔴 TEAM 2</div>
          <input style={inp} value={t2Name} onChange={e=>setT2Name(e.target.value)}/>
        </div>
        <div style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
          <div style={{fontSize:"10px",color:T.muted,letterSpacing:"2px",marginBottom:"12px"}}>MATCHES PRO TAG</div>
          <div style={{display:"flex",gap:"8px"}}>
            {[2,3,4].map(n=><button key={n} onClick={()=>setMc(n)} style={{flex:1,padding:"16px",borderRadius:"10px",border:`2px solid ${mc===n?T.gold:T.border}`,background:mc===n?T.gold+"22":T.elevated,color:mc===n?T.gold:T.muted,fontSize:"22px",fontWeight:"900",cursor:"pointer",fontFamily:"'Arial Black',sans-serif"}}>{n}</button>)}
          </div>
          <div style={{fontSize:"11px",color:T.faint,marginTop:"8px",textAlign:"center"}}>{mc} Matches × 2 Runden × 2 Tage = <span style={{color:T.gold,fontWeight:"700"}}>{mc*4} Punkte</span></div>
        </div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"}} onClick={()=>onNext({t1Name,t2Name,matchCount:mc})}>Weiter → Spieler</button>
      </div>
    </div>
  );
}

function SetupStep2({t1Name,t2Name,matchCount,onNext,onBack,T}){
  const mk=n=>Array.from({length:n*2},(_,i)=>({id:i,firstName:"",lastName:"",hcp:""}));
  const [t1,setT1]=useState(mk(matchCount)),[t2,setT2]=useState(mk(matchCount));
  const upd=(team,idx,f,v)=>{const s=team===1?setT1:setT2;s(p=>p.map((x,i)=>i===idx?{...x,[f]:v}:x));};
  const add=team=>{const s=team===1?setT1:setT2;s(p=>[...p,{id:p.length,firstName:"",lastName:"",hcp:""}]);};
  const rem=(team,idx)=>{const s=team===1?setT1:setT2;s(p=>p.filter((_,i)=>i!==idx));};
  const ok=arr=>arr.every(p=>p.firstName.trim()&&p.lastName.trim()&&p.hcp!=="");
  const inp={background:T.surface,border:`1px solid ${T.border}`,borderRadius:"6px",color:T.cream,fontSize:"12px",padding:"7px 8px",outline:"none",boxSizing:"border-box"};
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup · 2/3</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>SPIELER & HANDICAP</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        {[[t1,1,t1Name,T.blue],[t2,2,t2Name,T.red]].map(([players,team,name,color])=>(
          <div key={team} style={{background:T.cardBg,border:`2px solid ${color}33`,borderRadius:"12px",padding:"14px",marginBottom:"14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
              <div style={{fontSize:"12px",fontWeight:"700",color,textTransform:"uppercase",letterSpacing:"1px"}}>{team===1?"🔵":"🔴"} {name}</div>
              <div style={{fontSize:"10px",color:T.faint}}>{players.length} Spieler</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 56px 20px",gap:"4px",marginBottom:"6px"}}>
              {["Vorname","Nachname","HCP",""].map((h,i)=><div key={i} style={{fontSize:"9px",color:T.faint,letterSpacing:"1px"}}>{h}</div>)}
            </div>
            {players.map((p,i)=>(
              <div key={p.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 56px 20px",gap:"4px",marginBottom:"6px",alignItems:"center"}}>
                <input style={inp} placeholder="Vorname" value={p.firstName} onChange={e=>upd(team,i,"firstName",e.target.value)}/>
                <input style={inp} placeholder="Nachname" value={p.lastName} onChange={e=>upd(team,i,"lastName",e.target.value)}/>
                <input style={{...inp,textAlign:"center"}} type="number" step="0.1" min="-5" max="54" placeholder="0.0" value={p.hcp} onChange={e=>upd(team,i,"hcp",e.target.value)}/>
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#E05252"}} onClick={()=>rem(team,i)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </div>
              </div>
            ))}
            <button style={{width:"100%",padding:"8px",background:"transparent",border:`1px dashed ${color}55`,borderRadius:"6px",color,fontSize:"12px",cursor:"pointer",marginTop:"4px"}} onClick={()=>add(team)}>+ Spieler hinzufügen</button>
          </div>
        ))}
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:(ok(t1)&&ok(t2))?1:0.4}} onClick={()=>(ok(t1)&&ok(t2))&&onNext({t1Players:t1,t2Players:t2})}>Weiter → Paarungen</button>
        {!(ok(t1)&&ok(t2))&&<div style={{fontSize:"11px",color:T.faint,textAlign:"center",marginTop:"8px"}}>Bitte alle Felder ausfüllen</div>}
      </div>
    </div>
  );
}

function SetupStep3({t1Name,t2Name,matchCount,t1Players,t2Players,onStart,onBack,T}){
  const [pairings,setPairings]=useState(Array.from({length:matchCount},(_,i)=>({id:i,t1p1:"",t1p2:"",t2p1:"",t2p2:""})));
  const [saving,setSaving]=useState(false);
  const upd=(idx,f,v)=>setPairings(p=>p.map((x,i)=>i===idx?{...x,[f]:v}:x));
  const findP=(arr,id)=>arr.find(p=>`${p.firstName}_${p.lastName}`===id);
  const getHcp=(arr,id1,id2)=>{const p1=findP(arr,id1),p2=findP(arr,id2);if(!p1||!p2||p1.hcp===""||p2.hcp==="")return null;return calcTeamHcp(parseFloat(p1.hcp),parseFloat(p2.hcp));};
  const allPaired=pairings.every(p=>p.t1p1&&p.t1p2&&p.t2p1&&p.t2p2);
  const sel={width:"100%",padding:"8px 10px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:"6px",color:T.cream,fontSize:"12px",outline:"none",boxSizing:"border-box",appearance:"none"};
  const Sel=({players,value,onChange,exclude})=>(
    <select value={value} onChange={e=>onChange(e.target.value)} style={sel}>
      <option value="">Spieler wählen...</option>
      {players.map(p=>{const id=`${p.firstName}_${p.lastName}`;if(exclude&&exclude!==value&&id===exclude)return null;return<option key={id} value={id}>{p.firstName} {p.lastName} (HCP {p.hcp})</option>;})}
    </select>
  );
  const start=async()=>{
    if(!allPaired)return;setSaving(true);
    const buildM=(p,i,offset=0)=>{
      const t1p1=findP(t1Players,p.t1p1),t1p2=findP(t1Players,p.t1p2),t2p1=findP(t2Players,p.t2p1),t2p2=findP(t2Players,p.t2p2);
      return{id:i+offset,name:`Match ${i+1+offset}`,pin:`MATCH${i+1+offset}`,t1Pair:[`${t1p1.firstName} ${t1p1.lastName}`,`${t1p2.firstName} ${t1p2.lastName}`],t2Pair:[`${t2p1.firstName} ${t2p1.lastName}`,`${t2p2.firstName} ${t2p2.lastName}`],teamHcp1:t1p1&&t1p2?calcTeamHcp(parseFloat(t1p1.hcp),parseFloat(t1p2.hcp)):null,teamHcp2:t2p1&&t2p2?calcTeamHcp(parseFloat(t2p1.hcp),parseFloat(t2p2.hcp)):null,scores:emptyScores()};
    };
    const days=[{id:0,label:"Tag 1 – Riedhof",courseKey:"riedhof",matches:pairings.map((p,i)=>buildM(p,i,0))},{id:1,label:"Tag 2 – Bergkramerhof",courseKey:"bergkramerhof",matches:pairings.map((p,i)=>buildM(p,i,matchCount))}];
    const config={t1Name,t2Name,t1Players,t2Players,days,phase:"game"};
    await saveTournament(config);onStart(config);
  };
  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <div style={{background:T.headerBg,borderBottom:`2px solid ${T.gold}`,padding:"14px 20px",textAlign:"center",position:"relative"}}>
        <BackButton onConfirm={onBack} T={T}/>
        <div style={{fontSize:"18px",fontWeight:"900",letterSpacing:"2px",color:T.gold,textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Setup · 3/3</div>
        <div style={{fontSize:"10px",color:"rgba(255,255,255,0.5)",letterSpacing:"2px",marginTop:"3px"}}>PAARUNGEN & TEAM-HCP</div>
      </div>
      <div style={{padding:"14px",maxWidth:"480px",margin:"0 auto"}}>
        <div style={{background:T.elevated,border:`1px solid ${T.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"11px",color:T.muted}}>
          💡 Team-HCP Scramble: <span style={{color:T.gold,fontWeight:"700"}}>35% niedrigerer + 15% höherer HCP</span>
        </div>
        {pairings.map((p,i)=>{
          const hcp1=getHcp(t1Players,p.t1p1,p.t1p2),hcp2=getHcp(t2Players,p.t2p1,p.t2p2);
          return(
            <div key={i} style={{background:T.cardBg,border:`1px solid ${T.border}`,borderRadius:"12px",padding:"14px",marginBottom:"12px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                <div style={{fontSize:"13px",fontWeight:"900",color:T.gold,fontFamily:"'Arial Black',sans-serif"}}>MATCH {i+1}</div>
                <div style={{fontSize:"9px",color:T.faint,fontFamily:"monospace"}}>MATCH{i+1} / MATCH{i+1+matchCount}</div>
              </div>
              <div style={{marginBottom:"10px"}}>
                <div style={{fontSize:"10px",color:T.blue,letterSpacing:"1px",marginBottom:"6px"}}>🔵 {t1Name}</div>
                <div style={{display:"flex",gap:"6px",marginBottom:"6px"}}><Sel players={t1Players} value={p.t1p1} onChange={v=>upd(i,"t1p1",v)} exclude={p.t1p2}/><Sel players={t1Players} value={p.t1p2} onChange={v=>upd(i,"t1p2",v)} exclude={p.t1p1}/></div>
                {hcp1!==null&&<div style={{fontSize:"11px",color:T.blue,background:T.blue+"18",borderRadius:"6px",padding:"4px 10px",display:"inline-block"}}>Team HCP: <strong>{hcp1}</strong></div>}
              </div>
              <div>
                <div style={{fontSize:"10px",color:T.red,letterSpacing:"1px",marginBottom:"6px"}}>🔴 {t2Name}</div>
                <div style={{display:"flex",gap:"6px",marginBottom:"6px"}}><Sel players={t2Players} value={p.t2p1} onChange={v=>upd(i,"t2p1",v)} exclude={p.t2p2}/><Sel players={t2Players} value={p.t2p2} onChange={v=>upd(i,"t2p2",v)} exclude={p.t2p1}/></div>
                {hcp2!==null&&<div style={{fontSize:"11px",color:T.red,background:T.red+"18",borderRadius:"6px",padding:"4px 10px",display:"inline-block"}}>Team HCP: <strong>{hcp2}</strong></div>}
              </div>
            </div>
          );
        })}
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer",opacity:allPaired?1:0.4}} onClick={start} disabled={saving||!allPaired}>{saving?"Speichere...":"Turnier starten 🏌️"}</button>
      </div>
    </div>
  );
}

function AdminSetup({onStart,onBack,T}){
  const [step,setStep]=useState(1),[d1,setD1]=useState(null),[d2,setD2]=useState(null);
  if(step===1)return<SetupStep1 onNext={d=>{setD1(d);setStep(2);}} onBack={onBack} T={T}/>;
  if(step===2)return<SetupStep2 {...d1} onNext={d=>{setD2(d);setStep(3);}} onBack={()=>setStep(1)} T={T}/>;
  return<SetupStep3 {...d1} {...d2} onStart={onStart} onBack={()=>setStep(2)} T={T}/>;
}

// ── Score Modal ───────────────────────────────────────────────────────────────
function ScoreModal({match,holeIndex,t1Name,t2Name,existing,par,onSave,onClose,T}){
  const [t1,setT1]=useState(existing?.team1??""),[t2,setT2]=useState(existing?.team2??"");
  const hp=par[holeIndex];
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}} onClick={onClose}>
      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:"36px",height:"4px",background:T.border,borderRadius:"2px",margin:"0 auto 16px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:"900",color:T.gold,textTransform:"uppercase",letterSpacing:"1px"}}>Loch {holeIndex+1} · {match.name}</div>
            <div style={{fontSize:"11px",color:T.muted,marginTop:"2px"}}>{holeIndex<9?"Runde 1 (Loch 1–9)":"Runde 2 (Loch 10–18)"} · Scramble</div>
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
              <input type="number" min="1" max="12" style={{width:"100%",fontSize:"36px",fontWeight:"900",background:T.isDark?"#0A2014":T.elevated,border:`2px solid ${T.border}`,borderRadius:"8px",color:T.cream,textAlign:"center",padding:"8px 0",outline:"none",boxSizing:"border-box",fontFamily:"'Arial Black',sans-serif"}}
                value={item.val} onChange={e=>item.set(e.target.value)} autoFocus={i===0}/>
            </div>
          ))}
        </div>
        <button style={{width:"100%",padding:"13px",background:`linear-gradient(135deg,${T.gold},#A07830)`,border:"none",borderRadius:"8px",color:T.isDark?"#0D2B1A":"white",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"}} onClick={()=>{if(t1!==""&&t2!=="")onSave(Number(t1),Number(t2));}}>Speichern</button>
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
  const r1=calcRoundStatus(match.scores,pars,0,9),r2=calcRoundStatus(match.scores,pars,9,18);
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
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"6px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <div style={{fontSize:"13px",fontWeight:"900",color:canEdit?T.gold:T.cream,fontFamily:"'Arial Black',sans-serif"}}>{match.name}</div>
              {canEdit&&<div style={{background:T.gold,color:T.isDark?"#0D2B1A":"white",fontSize:"9px",fontWeight:"900",borderRadius:"4px",padding:"2px 8px",letterSpacing:"1px"}}>✏️ DEIN MATCH</div>}
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
  const [activeTab,setActiveTab]=useState("day0"); // day0 | day1 | stats
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

  useEffect(()=>{if(!messaging)return;const u=onMessage(messaging,p=>{setToast({title:p.notification?.title,body:p.notification?.body});});return()=>u();},[]);
  useEffect(()=>{
    if(prevRef.current){
      const change=detectPointChange(prevRef.current,days,t1Name,t2Name);
      if(change){setToast(change);if(change.winner){setWinEvent(change);setConfetti(true);}}
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
    const nd=days.map(day=>{if(day.id!==dayId)return day;return{...day,matches:day.matches.map(m=>{if(m.id!==matchId)return m;const ns=[...m.scores];ns[hi]={team1:t1s,team2:t2s};return{...m,scores:ns};})};});
    const change=detectPointChange(days,nd,t1Name,t2Name);
    if(change){await sendPushToAll(change.title,change.body);}
    await saveTournament({...config,days:nd});setSaving(false);setModal(null);
  };

  const activeDay=activeTab==="day0"?days[0]:activeTab==="day1"?days[1]:null;
  const course=activeDay?COURSES[activeDay.courseKey]:null;
  const mMatch=modal?days.find(d=>d.id===modal.dayId)?.matches.find(m=>m.id===modal.matchId):null;
  const mDay=modal?days.find(d=>d.id===modal.dayId):null;
  const pushGranted=typeof Notification!=="undefined"&&Notification.permission==="granted";

  // Tab definitions
  const tabs=[
    {key:"day0",label:days[0].label.replace("Tag 1 – ","").substring(0,8)+"…"},
    {key:"day1",label:days[1].label.replace("Tag 2 – ","").substring(0,9)+"…"},
    {key:"stats",label:"Statistik",icon:<IconChart size={11} color="currentColor"/>},
  ];

  return(
    <div style={{minHeight:"100vh",background:T.bg,color:T.cream,fontFamily:"'Georgia',serif"}}>
      <Confetti active={confetti} onDone={()=>setConfetti(false)}/>
      <WinBanner event={winEvent} onDone={()=>setWinEvent(null)}/>
      {toast&&<Toast message={toast} onDismiss={()=>setToast(null)}/>}
      {showSettings&&<SettingsPanel T={T} currentTheme={theme} onThemeChange={onThemeChange} onClose={()=>setShowSettings(false)}/>}
      {resetAll&&<ResetConfirm title="Alle Matches zurücksetzen?" message="Wirklich ALLE Scores zurücksetzen? Das kann nicht rückgängig gemacht werden." onConfirm={doResetAll} onClose={()=>setResetAll(false)} T={T}/>}

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

        {/* My Match Banner */}
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

        {/* Tabs: Tag 1 / Tag 2 / Statistik */}
        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${T.border}`}}>
          {tabs.map((tab,i)=>(
            <button key={tab.key} style={{flex:1,padding:"10px 4px",background:activeTab===tab.key?T.elevated:T.isDark?"#0A2014":T.bg,border:"none",borderLeft:i>0?`1px solid ${T.border}`:"none",color:activeTab===tab.key?T.gold:T.muted,cursor:"pointer",fontSize:"10px",letterSpacing:"0.5px",textTransform:"uppercase",fontWeight:activeTab===tab.key?"700":"400",display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"}}
              onClick={()=>setActiveTab(tab.key)}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Stats Tab */}
        {activeTab==="stats"&&<StatsTab days={days} t1Name={t1Name} t2Name={t2Name} T={T}/>}

        {/* Day content */}
        {activeDay&&course&&(
          <>
            {/* Course Header */}
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

            {/* Match Cards */}
            {activeDay.matches.map(m=>(
              <MatchCard key={m.id} match={m} pars={course.par} t1Name={t1Name} t2Name={t2Name}
                canEdit={canEdit(m.id)} isAdmin={isAdmin} T={T}
                onHoleClick={(matchId,hi)=>setModal({dayId:activeDay.id,matchId,holeIndex:hi})}
                onReset={doReset}/>
            ))}

            {/* Admin Reset All */}
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

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [phase,setPhase]=useState("login");
  const [config,setConfig]=useState(null);
  const [role,setRole]=useState(null);
  const [loading,setLoading]=useState(false);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem("ryder_theme")||"dark";}catch(e){return"dark";}});

  const changeTheme=t=>{setTheme(t);try{localStorage.setItem("ryder_theme",t);}catch(e){}};
  const goToLogin=()=>{setPhase("login");setConfig(null);setRole(null);};

  const handleLogin=async r=>{
    setRole(r);setLoading(true);
    try{const s=await getDoc(doc(db,"tournaments","ryder2024"));if(s.exists()){setConfig(s.data());setPhase("game");}else setPhase(r==="admin"?"setup":"waiting");}
    catch(e){setPhase(r==="admin"?"setup":"waiting");}
    setLoading(false);
  };

  useEffect(()=>{
    if(phase!=="game")return;
    const u=onSnapshot(doc(db,"tournaments","ryder2024"),s=>{if(s.exists())setConfig(s.data());});
    return()=>u();
  },[phase]);

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
  if(phase==="setup"&&role==="admin")return<AdminSetup onStart={cfg=>{setConfig(cfg);setPhase("game");}} onBack={goToLogin} T={T}/>;
  if(!config)return null;
  return<Dashboard config={config} role={role} onBack={goToLogin} theme={theme} onThemeChange={changeTheme}/>;
}
