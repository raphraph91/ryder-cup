# Ryder Cup Friends Edition

## Deploy auf Vercel

### 1. GitHub
- Alle Dateien in dein `ryder-cup` GitHub Repo hochladen (drag & drop)
- **WICHTIG:** Die firebase-adminsdk JSON Datei NICHT hochladen!

### 2. Umgebungsvariable in Vercel setzen
Das ist der wichtigste Schritt für Push-Benachrichtigungen:

1. Vercel Dashboard → dein Projekt → **Settings** → **Environment Variables**
2. Name: `FIREBASE_SERVICE_ACCOUNT`
3. Value: Den gesamten Inhalt der firebase-adminsdk JSON Datei einfügen
4. **Save** klicken
5. Projekt neu deployen: **Deployments** → **Redeploy**

### 3. Fertig!
URL per WhatsApp teilen → alle öffnen im iPhone Safari →
Teilen → Zum Homescreen → App öffnen → Benachrichtigungen erlauben

## Zugangscodes
| Code | Rolle |
|------|-------|
| RYDER-ADMIN | Admin |
| RYDER2024 | Zuschauer |
| MATCH1–MATCH8 | Spieler |

## Push-Benachrichtigungen
Nur als PWA (Homescreen installiert) auf iOS 16.4+
