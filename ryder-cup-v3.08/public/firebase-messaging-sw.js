importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAUT_w03rbgMPtEkz_fxwXv0rRdqx10OLA",
  authDomain: "pin-high-fcd1b.firebaseapp.com",
  projectId: "pin-high-fcd1b",
  storageBucket: "pin-high-fcd1b.firebasestorage.app",
  messagingSenderId: "554970406618",
  appId: "1:554970406618:web:569e0a8f2b92d5e8558fe3"
});

const messaging = firebase.messaging();

// Fix 3: Only show background notification when app is NOT in foreground
// When app is open, the onMessage handler in App.jsx handles it — no double push
messaging.onBackgroundMessage((payload) => {
  // Check if any client (app window) is currently focused
  self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const appFocused=clients.some(c=>c.focused);
    if(appFocused)return; // App is open and focused — skip, onMessage handles it
    self.registration.showNotification(
      payload.notification?.title||payload.data?.title||'Ryder Cup',
      {
        body: payload.notification?.body||payload.data?.body||'',
        icon: '/icon-192.svg',
        badge: '/icon-192.svg',
        tag: payload.fcmOptions?.tag||payload.data?.tag||payload.notification?.tag||'ryder-push', // same tag = replace, not stack
        renotify: false,
      }
    );
  });
});

