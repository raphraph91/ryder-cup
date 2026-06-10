import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, getDoc } from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

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

async function saveTournament(data) {
  await setDoc(doc(db, "tournaments", "ryder2024"), data);
}

// Save FCM token to Firestore so server can send pushes
async function registerFCMToken() {
  if (!messaging) return null;
  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      // Store token in Firestore tokens collection
      await setDoc(doc(db, "fcm_tokens", token), {
        token,
        createdAt: Date.now(),
      });
      return token;
    }
  } catch(e) {
    console.warn("FCM token error:", e);
  }
  return null;
}

// Send push notification via Firestore trigger (we'll use a notifications collection
// that a Cloud Function would normally process — here we use FCM HTTP API directly)
async function sendPushToAll(title, body) {
  try {
    await fetch('/api/send-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
  } catch(e) {
    console.warn("Push send error:", e);
  }
}

// ── Access Codes ──────────────────────────────────────────────────────────────
const ADMIN_CODE  = "RYDER-ADMIN";
const VIEWER_CODE = "RYDER2024";
function resolveRole(code) {
  const c = code.trim().toUpperCase();
  if (c === ADMIN_CODE)  return "admin";
  if (c === VIEWER_CODE) return "viewer";
  const m = c.match(/^MATCH(\d+)$/);
  if (m) return `match-${parseInt(m[1])-1}`;
  return null;
}

// ── Course Data ───────────────────────────────────────────────────────────────
const COURSES = {
  riedhof: {
    name:"GC München-Riedhof", shortName:"Riedhof", location:"Egling",
    par:[4,3,4,5,3,4,3,4,4, 4,3,5,4,5,4,5,4,4],
  },
  bergkramerhof: {
    name:"Golfclub Bergkramerhof", shortName:"Bergkramerhof", location:"Wolfratshausen",
    par:[4,5,3,4,4,3,5,3,5, 4,3,4,3,5,4,5,4,4],
  },
};

// ── Matchplay Logic ───────────────────────────────────────────────────────────
function calcRoundStatus(scores, pars, startHole, endHole) {
  let diff=0, holesPlayed=0;
  const totalHoles = endHole-startHole;
  for (let i=startHole; i<endHole; i++) {
    const s=scores[i];
    if (s.team1!==null&&s.team2!==null) {
      holesPlayed++;
      if (s.team1<s.team2) diff++;
      else if (s.team2<s.team1) diff--;
    }
  }
  const holesLeft = totalHoles-holesPlayed;
  let won=false, label="AS";
  if (holesLeft===0) { won=true; label=diff>0?"1UP":diff<0?"1UP":"AS"; }
  else if (Math.abs(diff)>holesLeft) { won=true; label=`${Math.abs(diff)}&${holesLeft}`; }
  else if (diff!==0) { label=`${Math.abs(diff)} UP`; }
  return { diff, holesPlayed, holesLeft, label, won };
}
function getPoints(rs) {
  if (rs.won||rs.holesLeft===0) {
    if (rs.diff>0) return {t1:1,t2:0};
    if (rs.diff<0) return {t1:0,t2:1};
    return {t1:0.5,t2:0.5};
  }
  return null;
}
function projectedPoints(rs) {
  if (rs.won||rs.holesLeft===0) return getPoints(rs);
  const adv=rs.diff/18;
  return {t1:0.5+adv*0.4,t2:0.5-adv*0.4};
}
function calcTournament(days) {
  let t1Confirmed=0,t2Confirmed=0,t1Projected=0,t2Projected=0,totalPoints=0;
  days.forEach(day=>{
    const course=COURSES[day.courseKey];
    day.matches.forEach(m=>{
      totalPoints+=2;
      [0,1].forEach(r=>{
        const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);
        const conf=getPoints(rs),proj=projectedPoints(rs);
        if(conf){t1Confirmed+=conf.t1;t2Confirmed+=conf.t2;}
        t1Projected+=proj.t1;t2Projected+=proj.t2;
      });
    });
  });
  const total=t1Projected+t2Projected;
  return {
    t1Confirmed,t2Confirmed,
    t1Projected:Math.round(t1Projected*10)/10,
    t2Projected:Math.round(t2Projected*10)/10,
    t1WinProb:total>0?Math.round((t1Projected/total)*100):50,
    t2WinProb:total>0?Math.round((t2Projected/total)*100):50,
    totalPoints,needed:totalPoints/2+0.5,
  };
}
function emptyScores() {
  return Array.from({length:18},()=>({team1:null,team2:null}));
}

// Detect point changes between old and new config
function detectPointChange(oldDays, newDays, t1Name, t2Name) {
  if (!oldDays) return null;
  for (let di=0; di<newDays.length; di++) {
    const oldDay=oldDays[di], newDay=newDays[di];
    if (!oldDay) continue;
    const course=COURSES[newDay.courseKey];
    for (let mi=0; mi<newDay.matches.length; mi++) {
      const oldM=oldDay.matches[mi], newM=newDay.matches[mi];
      if (!oldM) continue;
      for (let r=0; r<2; r++) {
        const oldRs=calcRoundStatus(oldM.scores,course.par,r*9,r*9+9);
        const newRs=calcRoundStatus(newM.scores,course.par,r*9,r*9+9);
        const oldPts=getPoints(oldRs), newPts=getPoints(newRs);
        // Point just got awarded
        if (!oldPts && newPts) {
          const runde = r===0?"Runde 1":"Runde 2";
          const winner = newPts.t1>newPts.t2 ? t1Name : newPts.t2>newPts.t1 ? t2Name : null;
          const score = `${newPts.t1}:${newPts.t2}`;
          return {
            title: winner ? `🏆 ${winner} gewinnt ${runde}!` : `🤝 ${runde} endet Unentschieden`,
            body: `${newM.name} · ${runde} abgeschlossen · ${score} Punkte`,
          };
        }
      }
    }
  }
  return null;
}

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#0D2B1A",surface:"#0F2D1A",elevated:"#1A4D2E",
  border:"#2D6B40",borderFaint:"#1A4030",
  gold:"#C9A84C",cream:"#F2EDD7",muted:"#8BAF7C",faint:"#4A7A5C",
  blue:"#4A9EFF",red:"#FF6B6B",
  par3bg:"#2D1A4D",par3fg:"#B39DDB",
  par4bg:"#333333",par4fg:"#AAAAAA",
  par5bg:"#1A3D30",par5fg:"#80CBC4",
};
const parBg=p=>p===3?C.par3bg:p===5?C.par5bg:C.par4bg;
const parFg=p=>p===3?C.par3fg:p===5?C.par5fg:C.par4fg;
const fmt=v=>v%1===0?v:v.toFixed(1);

const S = {
  app:{minHeight:"100vh",background:C.bg,color:C.cream,fontFamily:"'Georgia',serif"},
  header:{background:`linear-gradient(135deg,#0A2014,#1A4D2E)`,borderBottom:`2px solid ${C.gold}`,padding:"14px 20px",textAlign:"center"},
  headerTitle:{fontSize:"20px",fontWeight:"900",letterSpacing:"3px",color:C.gold,textTransform:"uppercase",margin:0,fontFamily:"'Arial Black',sans-serif"},
  headerSub:{fontSize:"10px",color:C.muted,letterSpacing:"2px",marginTop:"3px",textTransform:"uppercase"},
  body:{padding:"14px",maxWidth:"480px",margin:"0 auto"},
  card:{background:`linear-gradient(180deg,${C.elevated} 0%,#0F3320 100%)`,border:`1px solid ${C.border}`,borderRadius:"12px",padding:"14px",marginBottom:"14px"},
  matchCard:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"10px",marginBottom:"12px",overflow:"hidden"},
  btn:{width:"100%",padding:"13px",background:`linear-gradient(135deg,${C.gold},#A07830)`,border:"none",borderRadius:"8px",color:"#0D2B1A",fontSize:"14px",fontWeight:"900",letterSpacing:"2px",textTransform:"uppercase",cursor:"pointer"},
  btnGhost:{width:"100%",padding:"10px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:"8px",color:C.muted,fontSize:"13px",cursor:"pointer",marginBottom:"8px"},
  input:{width:"100%",padding:"10px 12px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:"8px",color:C.cream,fontSize:"14px",boxSizing:"border-box",outline:"none"},
  label:{fontSize:"10px",color:C.muted,letterSpacing:"2px",textTransform:"uppercase",marginBottom:"6px",display:"block"},
  pill:{display:"inline-flex",alignItems:"center",gap:"5px",background:C.elevated,border:`1px solid ${C.border}`,borderRadius:"20px",padding:"3px 9px",margin:"3px",fontSize:"12px"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100},
  modal:{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"16px 16px 0 0",padding:"22px 18px 30px",width:"100%",maxWidth:"480px"},
  tab:{flex:1,padding:"10px 6px",background:"#0A2014",border:`1px solid ${C.border}`,color:C.muted,cursor:"pointer",fontSize:"11px",letterSpacing:"1px",textTransform:"uppercase",textAlign:"center"},
  tabActive:{background:C.elevated,color:C.gold,borderColor:C.gold},
};

// ── Push Permission Banner ────────────────────────────────────────────────────
function PushBanner({ onDismiss }) {
  const [state, setState] = useState("idle"); // idle | requesting | granted | denied | unsupported

  const request = async () => {
    setState("requesting");
    if (!("Notification" in window) || !messaging) {
      setState("unsupported"); return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        await registerFCMToken();
        setState("granted");
        setTimeout(onDismiss, 2000);
      } else {
        setState("denied");
      }
    } catch(e) {
      setState("denied");
    }
  };

  if (state === "granted") return (
    <div style={{ background:"#1A4D2E",border:`1px solid ${C.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px",display:"flex",alignItems:"center",gap:"10px" }}>
      <span style={{fontSize:"20px"}}>✅</span>
      <div style={{fontSize:"12px",color:C.muted}}>Push-Benachrichtigungen aktiviert!</div>
    </div>
  );

  if (state === "denied" || state === "unsupported") return (
    <div style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"12px 14px",marginBottom:"14px" }}>
      <div style={{fontSize:"12px",color:"#E05252",marginBottom:"4px"}}>
        {state==="unsupported" ? "❌ Push nicht unterstützt auf diesem Gerät" : "❌ Benachrichtigungen blockiert"}
      </div>
      <div style={{fontSize:"11px",color:C.faint}}>
        {state==="denied" ? "Geh zu Einstellungen → Safari → Benachrichtigungen → ryder-cup erlauben" : "Installiere die App zuerst als PWA (Teilen → Zum Homescreen)"}
      </div>
      <button style={{...S.btnGhost,marginTop:"8px",marginBottom:0}} onClick={onDismiss}>Schließen</button>
    </div>
  );

  return (
    <div style={{ background:`linear-gradient(135deg,#1A3D2E,#0F2D1A)`,border:`1px solid ${C.gold}55`,borderRadius:"10px",padding:"14px",marginBottom:"14px" }}>
      <div style={{display:"flex",alignItems:"flex-start",gap:"10px",marginBottom:"10px"}}>
        <span style={{fontSize:"24px"}}>🔔</span>
        <div>
          <div style={{fontSize:"13px",fontWeight:"700",color:C.gold,marginBottom:"3px"}}>Push-Benachrichtigungen</div>
          <div style={{fontSize:"11px",color:C.muted}}>
            Erhalte eine Benachrichtigung wenn ein Team einen Punkt gewinnt – auch wenn die App im Hintergrund ist.
          </div>
          <div style={{fontSize:"10px",color:C.faint,marginTop:"4px"}}>
            ⚠️ Nur als PWA installiert (Homescreen) auf iOS 16.4+
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:"8px"}}>
        <button style={{...S.btn,flex:1,padding:"10px",fontSize:"12px"}} onClick={request} disabled={state==="requesting"}>
          {state==="requesting" ? "Warte..." : "🔔 Aktivieren"}
        </button>
        <button style={{padding:"10px 14px",background:"transparent",border:`1px solid ${C.border}`,borderRadius:"8px",color:C.muted,fontSize:"12px",cursor:"pointer"}} onClick={onDismiss}>
          Später
        </button>
      </div>
    </div>
  );
}

// ── In-App Toast ──────────────────────────────────────────────────────────────
function Toast({ message, onDismiss }) {
  useEffect(()=>{
    const t = setTimeout(onDismiss, 5000);
    return ()=>clearTimeout(t);
  },[]);
  if (!message) return null;
  return (
    <div style={{ position:"fixed", top:"16px", left:"50%", transform:"translateX(-50%)", zIndex:200, background:`linear-gradient(135deg,#1A4D2E,#0F3320)`, border:`1px solid ${C.gold}`, borderRadius:"12px", padding:"12px 18px", maxWidth:"340px", width:"90%", boxShadow:"0 4px 20px rgba(0,0,0,0.5)", display:"flex", alignItems:"center", gap:"10px" }}
      onClick={onDismiss}>
      <span style={{fontSize:"20px"}}>🏆</span>
      <div>
        <div style={{fontSize:"13px",fontWeight:"700",color:C.gold}}>{message.title}</div>
        <div style={{fontSize:"11px",color:C.muted,marginTop:"2px"}}>{message.body}</div>
      </div>
    </div>
  );
}

// ── Role Badge ────────────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  const isAdmin=role==="admin", isViewer=role==="viewer";
  const matchNum=!isAdmin&&!isViewer?parseInt(role.split("-")[1])+1:null;
  const label=isAdmin?"👑 Admin":isViewer?"👁 Zuschauer":`⛳ Match ${matchNum}`;
  const color=isAdmin?C.gold:isViewer?C.muted:C.blue;
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:"4px",background:color+"22",border:`1px solid ${color}55`,borderRadius:"20px",padding:"3px 10px",fontSize:"10px",color,letterSpacing:"1px"}}>
      {label}
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const [code,setCode]=useState("");
  const [error,setError]=useState("");
  const check=()=>{
    const role=resolveRole(code);
    if(role) onLogin(role);
    else setError("Ungültiger Code");
  };
  return (
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:"320px",textAlign:"center"}}>
        <div style={{fontSize:"56px",marginBottom:"10px"}}>⛳</div>
        <div style={{fontSize:"26px",fontWeight:"900",color:C.gold,letterSpacing:"4px",textTransform:"uppercase",fontFamily:"'Arial Black',sans-serif"}}>Ryder Cup</div>
        <div style={{fontSize:"11px",color:C.muted,letterSpacing:"2px",marginBottom:"28px"}}>Friends Edition · 2 Spieltage</div>
        <input style={{...S.input,fontSize:"20px",letterSpacing:"6px",textAlign:"center",marginBottom:"10px",padding:"14px"}}
          placeholder="CODE EINGEBEN" value={code}
          onChange={e=>{setCode(e.target.value.toUpperCase());setError("");}}
          onKeyDown={e=>e.key==="Enter"&&check()} />
        {error&&<div style={{color:"#E05252",fontSize:"12px",marginBottom:"10px"}}>{error}</div>}
        <button style={S.btn} onClick={check}>Eintreten</button>
        <div style={{marginTop:"16px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"12px",textAlign:"left"}}>
          <div style={{fontSize:"10px",color:C.gold,letterSpacing:"1px",marginBottom:"8px"}}>ZUGANGSCODES</div>
          {[["👑 Admin","RYDER-ADMIN"],["👁 Zuschauer","RYDER2024"],["⛳ Spieler","MATCH1 – MATCH8"]].map(([r,c])=>(
            <div key={r} style={{display:"flex",justifyContent:"space-between",fontSize:"11px",marginBottom:"4px"}}>
              <span style={{color:C.muted}}>{r}</span>
              <span style={{color:C.cream,fontFamily:"monospace"}}>{c}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Admin Setup ───────────────────────────────────────────────────────────────
function AdminSetup({ onStart }) {
  const [t1Name,setT1Name]=useState("Team Europa");
  const [t2Name,setT2Name]=useState("Team USA");
  const [t1Players,setT1Players]=useState(["Max","Felix","Jonas","Tom","Lars","Kai","Nico","Ben"]);
  const [t2Players,setT2Players]=useState(["Luca","Paul","Tim","Jan","Sven","Ole","Erik","Mark"]);
  const [newP,setNewP]=useState(["",""]);
  const [saving,setSaving]=useState(false);

  const addPlayer=(t,name)=>{
    if(!name.trim()) return;
    if(t===0) setT1Players(p=>[...p,name.trim()]);
    else setT2Players(p=>[...p,name.trim()]);
    setNewP(prev=>{const n=[...prev];n[t]="";return n;});
  };

  const buildMatches=(p1,p2)=>{
    const count=Math.min(Math.floor(p1.length/2),Math.floor(p2.length/2),4);
    return Array.from({length:count},(_,i)=>({
      id:i, name:`Match ${i+1}`, pin:`MATCH${i+1}`,
      t1Pair:[p1[i*2]||"",p1[i*2+1]||""],
      t2Pair:[p2[i*2]||"",p2[i*2+1]||""],
      scores:emptyScores(),
    }));
  };

  const start=async()=>{
    setSaving(true);
    const day1=buildMatches(t1Players,t2Players);
    const day2=day1.map((m,i)=>({...m,id:i+4,name:`Match ${i+5}`,pin:`MATCH${i+5}`,scores:emptyScores()}));
    const days=[
      {id:0,label:"Tag 1 – Riedhof",courseKey:"riedhof",matches:day1},
      {id:1,label:"Tag 2 – Bergkramerhof",courseKey:"bergkramerhof",matches:day2},
    ];
    const config={t1Name,t2Name,t1Players,t2Players,days,phase:"game"};
    await saveTournament(config);
    onStart(config);
  };

  const preview=buildMatches(t1Players,t2Players);

  return (
    <div style={S.app}>
      <div style={S.header}>
        <div style={S.headerTitle}>⛳ Admin Setup</div>
        <div style={S.headerSub}>Tag 1: Riedhof · Tag 2: Bergkramerhof</div>
      </div>
      <div style={S.body}>
        {[0,1].map(t=>{
          const name=t===0?t1Name:t2Name;
          const players=t===0?t1Players:t2Players;
          const setPlayers=t===0?setT1Players:setT2Players;
          const color=t===0?C.blue:C.red;
          return (
            <div key={t} style={{...S.card,borderColor:color+"55"}}>
              <span style={{...S.label,color}}>{t===0?"🔵":"🔴"} Teamname</span>
              <input style={{...S.input,marginBottom:"12px"}} value={name}
                onChange={e=>t===0?setT1Name(e.target.value):setT2Name(e.target.value)} />
              <span style={S.label}>Spieler (je 2 = 1 Match)</span>
              <div style={{marginBottom:"8px"}}>
                {players.map((p,i)=>(
                  <span key={i} style={S.pill}>{p}
                    <span style={{cursor:"pointer",color:"#E05252",fontWeight:"700"}}
                      onClick={()=>setPlayers(prev=>prev.filter((_,j)=>j!==i))}>×</span>
                  </span>
                ))}
              </div>
              <div style={{display:"flex",gap:"8px"}}>
                <input style={{...S.input,flex:1}} placeholder="Spieler hinzufügen"
                  value={newP[t]} onChange={e=>setNewP(prev=>{const n=[...prev];n[t]=e.target.value;return n;})}
                  onKeyDown={e=>e.key==="Enter"&&addPlayer(t,newP[t])} />
                <button style={{padding:"8px 14px",background:C.elevated,border:`1px solid ${C.border}`,borderRadius:"6px",color:C.gold,cursor:"pointer",fontSize:"16px"}}
                  onClick={()=>addPlayer(t,newP[t])}>+</button>
              </div>
            </div>
          );
        })}

        <div style={{...S.card,background:C.surface}}>
          <div style={{fontSize:"11px",color:C.gold,fontWeight:"700",letterSpacing:"1px",marginBottom:"10px"}}>📋 MATCH-PINS</div>
          {preview.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:"#0A2014",borderRadius:"6px",marginBottom:"6px"}}>
              <div>
                <div style={{fontSize:"11px",color:C.gold,fontWeight:"700"}}>{m.name}</div>
                <div style={{fontSize:"10px",color:C.faint,marginTop:"2px"}}>
                  <span style={{color:C.blue}}>{m.t1Pair.join(" & ")}</span>
                  <span style={{color:C.muted}}> vs </span>
                  <span style={{color:C.red}}>{m.t2Pair.join(" & ")}</span>
                </div>
              </div>
              <div style={{background:C.elevated,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"4px 10px",fontSize:"13px",fontWeight:"700",color:C.cream,fontFamily:"monospace"}}>
                {m.pin}
              </div>
            </div>
          ))}
          <div style={{fontSize:"10px",color:C.faint,marginTop:"8px"}}>Tag 2 bekommt MATCH5–MATCH8</div>
        </div>

        <button style={S.btn} onClick={start} disabled={saving}>
          {saving?"Speichere...":"Turnier starten 🏌️"}
        </button>
      </div>
    </div>
  );
}

// ── Score Modal ───────────────────────────────────────────────────────────────
function ScoreModal({ match, holeIndex, t1Name, t2Name, existing, par, onSave, onClose }) {
  const [t1,setT1]=useState(existing?.team1??"");
  const [t2,setT2]=useState(existing?.team2??"");
  const holePar=par[holeIndex];
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:"900",color:C.gold,textTransform:"uppercase",letterSpacing:"1px"}}>
              Loch {holeIndex+1} · {match.name}
            </div>
            <div style={{fontSize:"11px",color:C.muted,marginTop:"2px"}}>
              {holeIndex<9?"Runde 1 (Loch 1–9)":"Runde 2 (Loch 10–18)"} · Scramble
            </div>
          </div>
          <div style={{textAlign:"center",background:parBg(holePar),border:`1px solid ${C.border}`,borderRadius:"8px",padding:"6px 12px"}}>
            <div style={{fontSize:"9px",color:C.muted}}>PAR</div>
            <div style={{fontSize:"22px",fontWeight:"900",color:parFg(holePar),fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{holePar}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"12px",marginBottom:"16px"}}>
          {[{name:t1Name,val:t1,set:setT1,color:C.blue},{name:t2Name,val:t2,set:setT2,color:C.red}].map((item,i)=>(
            <div key={i} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:"11px",color:item.color,letterSpacing:"1px",textTransform:"uppercase",marginBottom:"6px"}}>{item.name}</div>
              <input type="number" min="1" max="12"
                style={{width:"100%",fontSize:"36px",fontWeight:"900",background:"#0A2014",border:`2px solid ${C.border}`,borderRadius:"8px",color:C.cream,textAlign:"center",padding:"8px 0",outline:"none",boxSizing:"border-box",fontFamily:"'Arial Black',sans-serif"}}
                value={item.val} onChange={e=>item.set(e.target.value)} autoFocus={i===0} />
            </div>
          ))}
        </div>
        <button style={S.btn} onClick={()=>{if(t1!==""&&t2!=="")onSave(Number(t1),Number(t2));}}>Speichern</button>
        <button style={{...S.btnGhost,marginTop:"8px"}} onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  );
}

// ── 9-Hole Grid ───────────────────────────────────────────────────────────────
function NineHoleGrid({ scores, pars, startHole, matchId, onHoleClick, canEdit }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px"}}>
      {scores.slice(startHole,startHole+9).map((s,i)=>{
        const holeNum=startHole+i, p=pars[holeNum];
        const played=s.team1!==null&&s.team2!==null;
        let bg=parBg(p),color=parFg(p)+"88",border=`1px solid ${C.border}`;
        if(played){
          border="none";
          if(s.team1<s.team2){bg=C.blue+"30";color=C.blue;}
          else if(s.team2<s.team1){bg=C.red+"30";color=C.red;}
          else{bg="#2D6B40";color=C.cream;}
        }
        return (
          <div key={i}
            style={{borderRadius:"4px",cursor:canEdit?"pointer":"default",background:bg,color,border,userSelect:"none",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"2px 0",minHeight:"32px",opacity:canEdit?1:0.85}}
            onClick={()=>canEdit&&onHoleClick(matchId,holeNum)}>
            <div style={{fontSize:"9px",fontWeight:"700",lineHeight:1}}>{startHole+i+1}</div>
            <div style={{fontSize:"7px",opacity:0.7,lineHeight:1}}>P{p}</div>
            {played&&<div style={{fontSize:"8px",fontWeight:"900",lineHeight:1}}>{s.team1}:{s.team2}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Match Card ────────────────────────────────────────────────────────────────
function MatchCard({ match, pars, t1Name, t2Name, canEdit, onHoleClick }) {
  const r1=calcRoundStatus(match.scores,pars,0,9);
  const r2=calcRoundStatus(match.scores,pars,9,18);

  const RoundBadge=({rs,pts,label,range})=>{
    const color=rs.diff>0?C.blue:rs.diff<0?C.red:C.cream;
    const rPar=pars.slice(range[0],range[1]).reduce((a,b)=>a+b,0);
    return (
      <div style={{flex:1,background:"#0A2014",borderRadius:"6px",padding:"6px 8px",textAlign:"center"}}>
        <div style={{fontSize:"9px",color:C.faint}}>{label}</div>
        <div style={{fontSize:"9px",color:C.faint+"88",marginBottom:"3px"}}>Par {rPar}</div>
        <div style={{fontSize:"14px",fontWeight:"900",color,fontFamily:"'Arial Black',sans-serif"}}>
          {rs.holesPlayed===0?"—":rs.label}
        </div>
        {(rs.won||rs.holesLeft===0)&&pts&&(
          <div style={{fontSize:"9px",color:C.muted,marginTop:"2px"}}>{pts.t1}–{pts.t2} Pts</div>
        )}
        {!rs.won&&rs.holesLeft>0&&rs.holesPlayed>0&&(
          <div style={{fontSize:"9px",color:C.faint,marginTop:"2px"}}>{rs.holesLeft} left</div>
        )}
      </div>
    );
  };

  return (
    <div style={{...S.matchCard,borderColor:canEdit?C.gold+"88":C.border}}>
      <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${C.borderFaint}`,background:"#0A2014"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
            <div style={{fontSize:"12px",fontWeight:"700",color:C.gold,letterSpacing:"1px",textTransform:"uppercase"}}>{match.name}</div>
            {canEdit&&<div style={{fontSize:"9px",background:C.gold+"22",color:C.gold,border:`1px solid ${C.gold}55`,borderRadius:"4px",padding:"1px 6px"}}>✏️ Dein Match</div>}
          </div>
          <div style={{fontSize:"10px",color:C.faint,marginTop:"2px"}}>
            <span style={{color:C.blue}}>🔵 {(match.t1Pair||[]).join(" & ")}</span>
            <span style={{color:C.muted}}> vs </span>
            <span style={{color:C.red}}>🔴 {(match.t2Pair||[]).join(" & ")}</span>
          </div>
        </div>
        {match.pin&&<div style={{fontSize:"10px",color:C.faint,fontFamily:"monospace"}}>{match.pin}</div>}
      </div>
      <div style={{padding:"10px 14px"}}>
        <div style={{display:"flex",gap:"6px",marginBottom:"10px"}}>
          <RoundBadge rs={r1} pts={getPoints(r1)} label="Runde 1 (L. 1–9)" range={[0,9]} />
          <RoundBadge rs={r2} pts={getPoints(r2)} label="Runde 2 (L. 10–18)" range={[9,18]} />
        </div>
        <div style={{fontSize:"9px",color:C.faint,letterSpacing:"1px",marginBottom:"3px"}}>RUNDE 1</div>
        <NineHoleGrid scores={match.scores} pars={pars} startHole={0} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} />
        <div style={{fontSize:"9px",color:C.faint,letterSpacing:"1px",margin:"6px 0 3px"}}>RUNDE 2</div>
        <NineHoleGrid scores={match.scores} pars={pars} startHole={9} matchId={match.id} onHoleClick={onHoleClick} canEdit={canEdit} />
        {!canEdit&&<div style={{marginTop:"8px",fontSize:"10px",color:C.faint,textAlign:"center"}}>🔒 Nur lesbar</div>}
      </div>
    </div>
  );
}

// ── Day Summary ───────────────────────────────────────────────────────────────
function DaySummary({ day, t1Name, t2Name }) {
  const course=COURSES[day.courseKey];
  let t1Pts=0,t2Pts=0;
  day.matches.forEach(m=>{
    [0,1].forEach(r=>{
      const rs=calcRoundStatus(m.scores,course.par,r*9,r*9+9);
      const pts=getPoints(rs);
      if(pts){t1Pts+=pts.t1;t2Pts+=pts.t2;}
    });
  });
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div>
        <div style={{fontSize:"11px",color:C.gold,fontWeight:"700"}}>{day.label}</div>
        <div style={{fontSize:"10px",color:C.faint}}>{course.shortName} · {day.matches.length} Matches</div>
      </div>
      <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
        <span style={{color:C.blue,fontWeight:"700",fontSize:"16px"}}>{fmt(t1Pts)}</span>
        <span style={{color:C.muted,fontSize:"11px"}}>:</span>
        <span style={{color:C.red,fontWeight:"700",fontSize:"16px"}}>{fmt(t2Pts)}</span>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ config, role }) {
  const { t1Name, t2Name, days } = config;
  const [modal,setModal]=useState(null);
  const [activeDay,setActiveDay]=useState(0);
  const [saving,setSaving]=useState(false);
  const [showPushBanner,setShowPushBanner]=useState(true);
  const [toast,setToast]=useState(null);
  const prevDaysRef=useRef(null);

  const isAdmin=role==="admin", isViewer=role==="viewer";
  const editableMatchIds=isAdmin?"all":isViewer?[]:(() => {
    const idx=parseInt(role.split("-")[1]);
    const all=[]; days.forEach(d=>d.matches.forEach(m=>all.push(m.id)));
    const perDay=days[0]?.matches.length||4;
    return [all[idx],all[idx+perDay]].filter(id=>id!==undefined);
  })();
  const canEdit=matchId=>editableMatchIds==="all"||editableMatchIds.includes(matchId);

  // Foreground push handler
  useEffect(()=>{
    if(!messaging) return;
    const unsub=onMessage(messaging,(payload)=>{
      setToast({ title:payload.notification?.title, body:payload.notification?.body });
    });
    return ()=>unsub();
  },[]);

  // Detect point change for in-app toast (when others score)
  useEffect(()=>{
    if(prevDaysRef.current) {
      const change=detectPointChange(prevDaysRef.current, days, t1Name, t2Name);
      if(change) setToast(change);
    }
    prevDaysRef.current=days;
  },[days]);

  const stats=calcTournament(days);
  const t1Width=Math.max(5,Math.min(95,stats.t1WinProb));

  const saveScore=async(dayId,matchId,holeIndex,t1Score,t2Score)=>{
    setSaving(true);
    const newDays=days.map(day=>{
      if(day.id!==dayId) return day;
      return {...day,matches:day.matches.map(m=>{
        if(m.id!==matchId) return m;
        const newScores=[...m.scores];
        newScores[holeIndex]={team1:t1Score,team2:t2Score};
        return {...m,scores:newScores};
      })};
    });

    // Check if a point was just awarded → send push
    const change=detectPointChange(days,newDays,t1Name,t2Name);
    if(change) await sendPushToAll(change.title, change.body);

    await saveTournament({...config,days:newDays});
    setSaving(false);
    setModal(null);
  };

  const currentDay=days[activeDay];
  const course=COURSES[currentDay.courseKey];
  const modalMatch=modal?days.find(d=>d.id===modal.dayId)?.matches.find(m=>m.id===modal.matchId):null;
  const modalDay=modal?days.find(d=>d.id===modal.dayId):null;

  // Check if push already granted
  const pushAlreadyGranted = typeof Notification!=="undefined"&&Notification.permission==="granted";

  return (
    <div style={S.app}>
      {toast&&<Toast message={toast} onDismiss={()=>setToast(null)} />}
      <div style={S.header}>
        <div style={S.headerTitle}>⛳ Ryder Cup</div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",marginTop:"4px"}}>
          <RoleBadge role={role} />
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}>
            <div style={{width:"6px",height:"6px",borderRadius:"50%",background:saving?C.gold:"#4CAF50"}} />
            <div style={S.headerSub}>{saving?"Speichert...":"Live"}</div>
          </div>
        </div>
      </div>
      <div style={S.body}>

        {/* Push Banner */}
        {showPushBanner&&!pushAlreadyGranted&&(
          <PushBanner onDismiss={()=>setShowPushBanner(false)} />
        )}

        {/* Gesamtstand */}
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"10px"}}>
            <div>
              <div style={{fontSize:"12px",fontWeight:"700",color:C.blue,textTransform:"uppercase",letterSpacing:"1px"}}>🔵 {t1Name}</div>
              <div style={{fontSize:"42px",fontWeight:"900",color:C.blue,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t1Confirmed)}</div>
              <div style={{fontSize:"10px",color:C.faint}}>proj. {stats.t1Projected} Pts</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:"9px",color:C.muted}}>ZIEL</div>
              <div style={{fontSize:"20px",fontWeight:"900",color:C.gold}}>{stats.needed}</div>
              <div style={{fontSize:"9px",color:C.faint}}>von {stats.totalPoints}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:"12px",fontWeight:"700",color:C.red,textTransform:"uppercase",letterSpacing:"1px"}}>🔴 {t2Name}</div>
              <div style={{fontSize:"42px",fontWeight:"900",color:C.red,fontFamily:"'Arial Black',sans-serif",lineHeight:1}}>{fmt(stats.t2Confirmed)}</div>
              <div style={{fontSize:"10px",color:C.faint,textAlign:"right"}}>proj. {stats.t2Projected} Pts</div>
            </div>
          </div>
          <div style={{height:"18px",borderRadius:"9px",overflow:"hidden",display:"flex",margin:"4px 0"}}>
            <div style={{width:`${t1Width}%`,background:C.blue,transition:"width 0.6s ease"}} />
            <div style={{flex:1,background:C.red}} />
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:"10px",color:C.muted}}>
            <span>{stats.t1WinProb}% Sieg</span>
            <span>{stats.t2WinProb}% Sieg</span>
          </div>
          <div style={{marginTop:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
            {days.map(d=><DaySummary key={d.id} day={d} t1Name={t1Name} t2Name={t2Name} />)}
          </div>
        </div>

        {/* Day tabs */}
        <div style={{display:"flex",marginBottom:"14px",borderRadius:"8px",overflow:"hidden",border:`1px solid ${C.border}`}}>
          {days.map((d,i)=>(
            <button key={d.id} style={{...S.tab,...(activeDay===i?S.tabActive:{}),...(i>0?{borderLeft:`1px solid ${C.border}`}:{})}}
              onClick={()=>setActiveDay(i)}>{d.label}</button>
          ))}
        </div>

        {/* Course header */}
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:"8px",padding:"10px 14px",marginBottom:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
            <div>
              <div style={{fontSize:"13px",fontWeight:"700",color:C.cream}}>{course.name}</div>
              <div style={{fontSize:"11px",color:C.faint}}>{course.location}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:"10px",color:C.muted}}>Par</div>
              <div style={{fontSize:"18px",fontWeight:"900",color:C.gold}}>
                {course.par.slice(0,9).reduce((a,b)=>a+b,0)} / {course.par.slice(9).reduce((a,b)=>a+b,0)}
              </div>
            </div>
          </div>
          {[0,1].map(r=>(
            <div key={r} style={{display:"grid",gridTemplateColumns:"repeat(9,1fr)",gap:"3px",marginBottom:r===0?"3px":"0"}}>
              {course.par.slice(r*9,r*9+9).map((p,i)=>(
                <div key={i} style={{textAlign:"center",fontSize:"9px",padding:"2px 0",borderRadius:"3px",background:parBg(p),color:parFg(p)}}>
                  <div style={{opacity:0.6}}>{r*9+i+1}</div>
                  <div style={{fontWeight:"700"}}>P{p}</div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Match Cards */}
        {currentDay.matches.map(m=>(
          <MatchCard key={m.id} match={m} pars={course.par} t1Name={t1Name} t2Name={t2Name}
            canEdit={canEdit(m.id)}
            onHoleClick={(matchId,holeIndex)=>setModal({dayId:currentDay.id,matchId,holeIndex})} />
        ))}
      </div>

      {modal&&modalMatch&&modalDay&&(
        <ScoreModal
          match={modalMatch} holeIndex={modal.holeIndex}
          t1Name={t1Name} t2Name={t2Name}
          par={COURSES[modalDay.courseKey].par}
          existing={modalMatch.scores[modal.holeIndex]}
          onSave={(t1,t2)=>saveScore(modal.dayId,modal.matchId,modal.holeIndex,t1,t2)}
          onClose={()=>setModal(null)} />
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [phase,setPhase]=useState("login");
  const [config,setConfig]=useState(null);
  const [role,setRole]=useState(null);
  const [loading,setLoading]=useState(false);

  const handleLogin=async(resolvedRole)=>{
    setRole(resolvedRole);
    setLoading(true);
    try {
      const snap=await getDoc(doc(db,"tournaments","ryder2024"));
      if(snap.exists()){setConfig(snap.data());setPhase("game");}
      else setPhase(resolvedRole==="admin"?"setup":"waiting");
    } catch(e){
      setPhase(resolvedRole==="admin"?"setup":"waiting");
    }
    setLoading(false);
  };

  useEffect(()=>{
    if(phase!=="game") return;
    const unsub=onSnapshot(doc(db,"tournaments","ryder2024"),(snap)=>{
      if(snap.exists()) setConfig(snap.data());
    });
    return ()=>unsub();
  },[phase]);

  if(phase==="login") return <Login onLogin={handleLogin} />;
  if(loading) return (
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"40px",marginBottom:"12px"}}>⛳</div>
        <div style={{color:C.muted,fontSize:"14px",letterSpacing:"2px"}}>Lade Turnier...</div>
      </div>
    </div>
  );
  if(phase==="waiting") return (
    <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"20px"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:"40px",marginBottom:"12px"}}>⏳</div>
        <div style={{color:C.gold,fontSize:"16px",fontWeight:"700",marginBottom:"8px"}}>Turnier noch nicht gestartet</div>
        <div style={{color:C.muted,fontSize:"13px",marginBottom:"12px"}}>Der Admin muss zuerst das Turnier einrichten.</div>
        <RoleBadge role={role} />
      </div>
    </div>
  );
  if(phase==="setup"&&role==="admin") return <AdminSetup onStart={cfg=>{setConfig(cfg);setPhase("game");}} />;
  if(!config) return null;
  return <Dashboard config={config} role={role} />;
}
