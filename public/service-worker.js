const CACHE_NAME = 'kenhe-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/visitor.html',
  '/styles.css',
  '/app.js',
  '/visitor.js',
  '/manifest.json'
];

// Instalar e fazer cache dos recursos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Ativar e limpar caches antigos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Interceptar requisições (Network first, fallback para cache)
self.addEventListener('fetch', (event) => {
  // Ignorar requisições de API e Websocket
  if (event.request.url.includes('/api/') || event.request.url.startsWith('ws')) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta for válida, coloca uma cópia no cache
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Ouvir mensagens de Push Notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || 'Kenhê 🔔';
    const options = {
      body: payload.body || 'Alguém está na porta!',
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      vibrate: [300, 100, 300, 100, 400],
      data: payload.data || {},
      tag: 'kenhe-ring', // Evita acumular múltiplas notificações idênticas
      renotify: true,
      requireInteraction: true // Mantém a notificação na tela até interação do usuário
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    console.error('Erro ao processar evento de push:', err);
  }
});

// Ouvir cliques na notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Abrir o app ou focar se já estiver aberto
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.endsWith('/') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
