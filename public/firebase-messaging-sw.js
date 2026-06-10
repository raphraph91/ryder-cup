importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBLlzavBNImCRG0JacPZWdVIxezxKiqHcc",
  authDomain: "rydercup-6f9d1.firebaseapp.com",
  projectId: "rydercup-6f9d1",
  storageBucket: "rydercup-6f9d1.firebasestorage.app",
  messagingSenderId: "198567886432",
  appId: "1:198567886432:web:e02904e589913db76c4d05"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
  });
});
