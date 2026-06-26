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

    const { title, body, tag, winnerTeam, senderUid } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }

    const tokensSnap = await db.collection('fcm_tokens').get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No tokens registered' });
    }

    // v3.11: pure data-only. senderUid passed so clients can skip own pushes.
    const pushTag = tag || 'ryder-push';

    const response = await messaging.sendEachForMulticast({
      tokens,
      data: { title, body, tag: pushTag, winnerTeam: winnerTeam || '', senderUid: senderUid || '' },
    });

    // Ungültige Tokens löschen
    const deletePromises = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const token = tokens[idx];
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
