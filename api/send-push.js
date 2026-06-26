// Vercel Serverless Function – verschickt FCM Push an alle registrierten Tokens
// Der Service Account Key kommt aus der Vercel Umgebungsvariable FIREBASE_SERVICE_ACCOUNT

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { getFirestore } = require('firebase-admin/firestore');

function initAdmin() {
  if (getApps().length > 0) return;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}

module.exports = async function handler(req, res) {
  // Nur POST erlaubt
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    initAdmin();
    const db = getFirestore();
    const messaging = getMessaging();

    const { title, body, tag, winnerTeam, senderToken, category } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }

    const tokensSnap = await db.collection('fcm_tokens').get();
    const pushTag = tag || 'ryder-push';
    const cat = category || 'matchDecision';

    // v3.13: filter out sender's own token + check per-user push prefs
    const eligibleTokens = [];
    tokensSnap.docs.forEach(d => {
      const data = d.data();
      if (!data.token) return;
      // Skip sender's own token
      if (senderToken && data.token === senderToken) return;
      // Check push prefs (if saved). Default: matchDecision=true, others=false
      const prefs = data.prefs || { matchDecision: true, leadChange: false, everyMessage: false };
      if (cat === 'everyMessage' && !prefs.everyMessage) return;
      if (cat === 'leadChange' && !prefs.leadChange && !prefs.everyMessage) return;
      if (cat === 'matchDecision' && !prefs.matchDecision && !prefs.everyMessage) return;
      eligibleTokens.push(data.token);
    });

    if (eligibleTokens.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No eligible tokens' });
    }

    const response = await messaging.sendEachForMulticast({
      tokens: eligibleTokens,
      data: { title, body, tag: pushTag, winnerTeam: winnerTeam || '' },
    });

    // Ungültige Tokens löschen
    const deletePromises = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const token = eligibleTokens[idx];
        deletePromises.push(db.collection('fcm_tokens').doc(token).delete());
      }
    });
    await Promise.all(deletePromises);

    return res.status(200).json({
      sent: response.successCount,
      failed: response.failureCount,
    });

  } catch (error) {
    console.error('Push error:', error);
    return res.status(500).json({ error: error.message });
  }
};
