# ⛳ Ryder Cup Friends Edition

Eine PWA (Progressive Web App) für euren privaten Ryder Cup – mit Live-Scores, Matchplay-Auswertung und Push-Benachrichtigungen.

---

## 📁 Projektstruktur

```
ryder-cup/
├── public/
│   ├── icon-192.svg               # App-Icon (klein)
│   ├── icon-512.svg               # App-Icon (groß)
│   ├── manifest.json              # PWA Manifest
│   └── firebase-messaging-sw.js  # Service Worker für Push
├── src/
│   ├── App.jsx                    # Haupt-App-Komponente
│   └── main.jsx                   # React Entry Point
├── api/
│   └── send-push.js               # Vercel Serverless Function (FCM Push)
├── index.html
├── vite.config.js
├── package.json
├── vercel.json
└── .gitignore
```

---

## 🚀 Deploy auf Vercel

### Schritt 1: GitHub
1. Neues Repository anlegen: `ryder-cup`
2. Alle Dateien hochladen (Drag & Drop im Browser)
3. **WICHTIG:** Die `firebase-adminsdk-*.json` Datei **NICHT** hochladen!

### Schritt 2: Vercel verbinden
1. [vercel.com](https://vercel.com) → **New Project** → GitHub Repo auswählen
2. Framework: **Vite** (wird automatisch erkannt)
3. Direkt auf **Deploy** klicken

### Schritt 3: Umgebungsvariable setzen (für Push-Benachrichtigungen)
1. Vercel Dashboard → dein Projekt → **Settings** → **Environment Variables**
2. Name: `FIREBASE_SERVICE_ACCOUNT`
3. Value: Den **kompletten Inhalt** der `firebase-adminsdk-*.json` Datei einfügen
4. **Save** klicken
5. Neu deployen: **Deployments** → **Redeploy**

### Schritt 4: App teilen
- URL per WhatsApp verschicken
- Alle öffnen im **iPhone Safari** → **Teilen** → **Zum Home-Bildschirm**
- App öffnen → Benachrichtigungen erlauben ✅

---

## 🔑 Zugangscodes

| Code | Rolle |
|------|-------|
| `RYDER-ADMIN` | 👑 Administrator |
| `RYDER2024` | 👁 Zuschauer |
| `MATCH1` | ⛳ Spieler Match 1 |
| `MATCH2` | ⛳ Spieler Match 2 |
| `MATCH3` | ⛳ Spieler Match 3 |
| `MATCH4` | ⛳ Spieler Match 4 |
| `MATCH5` – `MATCH8` | ⛳ weitere Matches |

---

## 👑 Admin-Bereich

Nach dem Login mit `RYDER-ADMIN` erscheint das Admin-Hauptmenü:

1. **👤 Spielerverwaltung** – Spieler erstellen & verwalten *(in Entwicklung)*
2. **📋 Turnierplanung** – Teams benennen, Spieler anlegen, Matches & Spielmodi festlegen, Spieler den Matches zuordnen
3. **⛳ Turnier Durchführung** – Live-Scoreboard, Scores eintragen, Statistiken

---

## 🏌️ Spielmodi

| Modus | Beschreibung |
|-------|-------------|
| Scramble | 2v2 · Bestes Team-Ergebnis |
| Singles | 1v1 · Individuell |
| Foursomes | 2v2 · Abwechselnd schlagen |
| Four-Ball | 2v2 · Bester Ball zählt |

---

## 🔔 Push-Benachrichtigungen

- Nur als PWA (Homescreen installiert) auf **iOS 16.4+** / Android
- Benachrichtigung wird gesendet wenn eine Runde endet (Punkt vergeben)
- Technologie: Firebase Cloud Messaging (FCM)

---

## 🛠 Lokale Entwicklung

```bash
npm install
npm run dev
```

App läuft dann auf `http://localhost:5173`

---

## 🔧 Firebase Setup (falls eigenes Projekt)

1. [Firebase Console](https://console.firebase.google.com) → Neues Projekt
2. Firestore Database aktivieren (Produktionsmodus)
3. Web-App hinzufügen → Config in `src/App.jsx` und `public/firebase-messaging-sw.js` eintragen
4. Cloud Messaging aktivieren → VAPID Key in `src/App.jsx` eintragen
5. Service Account Key generieren → Als `FIREBASE_SERVICE_ACCOUNT` Env-Variable in Vercel
