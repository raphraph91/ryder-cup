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
messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: '/icon-192.svg'
  });
});
