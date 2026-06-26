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
  // v3.09: pure data-only messages — title/body come from payload.data
  self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const appFocused=clients.some(c=>c.focused);
    if(appFocused)return; // App is open and focused — skip, onMessage handles it
    const title=payload.data?.title||'Ryder Cup';
    const body=payload.data?.body||'';
    const tag=payload.data?.tag||'ryder-push';
    self.registration.showNotification(title,{
      body,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag,
      renotify: false,
    });
  });
});


// v3.13: Click notification → open app in Chat tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
      // If app is already open, focus it and navigate to chat
      for(const c of clients){
        if(c.url.includes(self.registration.scope)){
          c.focus();
          c.postMessage({type:'openChat'});
          return;
        }
      }
      // Otherwise open new window with chat tab
      return self.clients.openWindow('/?tab=chat');
    })
  );
});
