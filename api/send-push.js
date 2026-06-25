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

    const { title, body, tag, winnerTeam } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body required' });
    }

    // Alle FCM Tokens aus Firestore laden
    const tokensSnap = await db.collection('fcm_tokens').get();
    const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);

    if (tokens.length === 0) {
      return res.status(200).json({ sent: 0, message: 'No tokens registered' });
    }

    // Fix 5 (v3.02): tag = dedupeKey so iOS replaces same-tag notifications
    // instead of stacking; pass winnerTeam through data for colored border.
    const pushTag = tag || 'ryder-push';
    const teamColor = winnerTeam === 't1' ? '#185FA5' : winnerTeam === 't2' ? '#A32D2D' : '#C9A84C';

    // Multicast Push verschicken
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { winnerTeam: winnerTeam || '', teamColor },
      webpush: {
        notification: {
          title,
          body,
          icon: '/icon-192.svg',
          badge: '/icon-192.svg',
          vibrate: [200, 100, 200],
          requireInteraction: false,
          tag: pushTag,
          renotify: false,
        },
        fcmOptions: { link: '/' },
      },
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
