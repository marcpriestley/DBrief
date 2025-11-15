// Service Worker for Push Notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || 'Time to log your daily scores and continue your streak!',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.tag || 'daily-reminder',
    data: { 
      url: data.url || '/',
      timestamp: Date.now()
    },
    actions: [
      { action: 'open', title: 'Open DBrief' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: false,
    vibrate: [200, 100, 200],
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || '🔔 Daily Reminder',
      options
    )
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data?.url || '/')
    );
  }
});

// Handle push subscription changes
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription.options.applicationServerKey
    })
    .then((subscription) => {
      return fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
    })
  );
});
