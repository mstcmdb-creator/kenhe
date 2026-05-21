import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import webpush from 'web-push';
import { db } from './db.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// Gerenciamento de conexões WebSocket mapeado por houseSlug
// Map<houseSlug, Set<WebSocket>>
const wsClients = new Map();

// Helper para enviar dados via WebSocket
function sendToHouseClients(houseSlug, data) {
  const clients = wsClients.get(houseSlug);
  if (clients) {
    const payload = JSON.stringify(data);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}

// Configuração do WebSocket Server
wss.on('connection', (ws) => {
  ws.isAlive = true;
  let clientHouseSlug = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'register' && data.houseSlug) {
        clientHouseSlug = data.houseSlug.toLowerCase().trim();
        
        if (!wsClients.has(clientHouseSlug)) {
          wsClients.set(clientHouseSlug, new Set());
        }
        wsClients.get(clientHouseSlug).add(ws);
        
        // Enviar confirmação de conexão
        ws.send(JSON.stringify({ type: 'registered', status: 'connected' }));
      }
    } catch (err) {
      console.error('Erro ao processar mensagem WebSocket:', err);
    }
  });

  ws.on('close', () => {
    if (clientHouseSlug && wsClients.has(clientHouseSlug)) {
      const clients = wsClients.get(clientHouseSlug);
      clients.delete(ws);
      if (clients.size === 0) {
        wsClients.delete(clientHouseSlug);
      }
    }
  });
});

// Ping interval para limpar conexões mortas
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Inicialização das chaves VAPID do Web Push
let vapidKeys = null;
async function initWebPush() {
  try {
    vapidKeys = await db.getConfig('vapidKeys');
    if (!vapidKeys) {
      vapidKeys = webpush.generateVAPIDKeys();
      await db.setConfig('vapidKeys', vapidKeys);
      console.log('Chaves VAPID criadas e salvas com sucesso.');
    } else {
      console.log('Chaves VAPID carregadas do banco de dados.');
    }
    webpush.setVapidDetails(
      'mailto:suporte@kenhe.app',
      vapidKeys.publicKey,
      vapidKeys.privateKey
    );
  } catch (err) {
    console.error('Erro ao inicializar chaves VAPID:', err);
  }
}

// ROTA VISITANTE: Direciona URLs do tipo /casa/:slug para visitor.html
app.get('/casa/:slug', (req, res) => {
  res.sendFile(path.resolve('./public/visitor.html'));
});

// API: Retornar chave pública VAPID
app.get('/api/push/vapid-public-key', (req, res) => {
  if (!vapidKeys) {
    return res.status(500).json({ error: 'Chaves VAPID não configuradas.' });
  }
  res.json({ publicKey: vapidKeys.publicKey });
});

// API: Obter dados públicos de uma casa para o visitante
app.get('/api/house/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase().trim();
  const house = await db.getHouse(slug);
  if (!house) {
    return res.status(404).json({ error: 'Casa não encontrada.' });
  }
  // Retorna apenas dados públicos
  res.json({
    slug: house.slug,
    name: house.name,
    active: house.active
  });
});

// API: Criar nova casa
app.post('/api/house', async (req, res) => {
  const { slug, name, pin } = req.body;
  if (!slug || !name || !pin) {
    return res.status(400).json({ error: 'Campos slug, name e pin são obrigatórios.' });
  }
  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();
  if (cleanSlug.length < 3) {
    return res.status(400).json({ error: 'O link da casa deve ter no mínimo 3 caracteres alfanuméricos.' });
  }
  try {
    const existing = await db.getHouse(cleanSlug);
    if (existing) {
      return res.status(400).json({ error: 'Este link da casa já está em uso.' });
    }
    const newHouse = await db.createHouse(cleanSlug, name, pin);
    res.status(201).json({ slug: newHouse.slug, name: newHouse.name, active: newHouse.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Autenticar / Login da casa
app.post('/api/house/login', async (req, res) => {
  const { slug, pin } = req.body;
  if (!slug || !pin) {
    return res.status(400).json({ error: 'Campos slug e pin são obrigatórios.' });
  }
  const cleanSlug = slug.toLowerCase().trim();
  const house = await db.getHouse(cleanSlug);
  if (!house || house.pin !== pin) {
    return res.status(401).json({ error: 'Identificador ou PIN incorretos.' });
  }
  res.json({ slug: house.slug, name: house.name, active: house.active });
});

// API: Ativar/desativar campainha (notificações)
app.post('/api/house/:slug/toggle', async (req, res) => {
  const slug = req.params.slug.toLowerCase().trim();
  const { pin, active } = req.body;
  
  const house = await db.getHouse(slug);
  if (!house || house.pin !== pin) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  const updatedHouse = await db.updateHouse(slug, { active: !!active });
  
  // Sincronizar todos os outros painéis abertos da mesma casa
  sendToHouseClients(slug, { type: 'config_sync', active: updatedHouse.active });

  res.json({ slug: updatedHouse.slug, name: updatedHouse.name, active: updatedHouse.active });
});

// API: Histórico de visitas
app.get('/api/visits/:slug', async (req, res) => {
  const slug = req.params.slug.toLowerCase().trim();
  const { pin } = req.query;

  const house = await db.getHouse(slug);
  if (!house || house.pin !== pin) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  const visits = await db.getVisits(slug);
  res.json({ visits });
});

// API: Inscrever dispositivo para Web Push
app.post('/api/push/subscribe', async (req, res) => {
  const { houseSlug, subscription, pin } = req.body;
  if (!houseSlug || !subscription) {
    return res.status(400).json({ error: 'Parâmetros inválidos.' });
  }

  const slug = houseSlug.toLowerCase().trim();
  const house = await db.getHouse(slug);
  if (!house || house.pin !== pin) {
    return res.status(401).json({ error: 'Acesso não autorizado.' });
  }

  await db.addPushSubscription(slug, subscription);
  res.status(201).json({ success: true });
});

// API: Desinscrever dispositivo do Web Push
app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint não fornecido.' });
  }
  await db.removePushSubscription(endpoint);
  res.json({ success: true });
});

// API principal de acionamento: TOCAR CAMPAINHA
app.post('/api/ring', async (req, res) => {
  const { houseSlug, visitorName, visitorPhone } = req.body;
  if (!houseSlug || !visitorName) {
    return res.status(400).json({ error: 'Dados do visitante incompletos.' });
  }

  const slug = houseSlug.toLowerCase().trim();
  const house = await db.getHouse(slug);
  if (!house) {
    return res.status(404).json({ error: 'Campainha inexistente.' });
  }

  // Registrar a visita no histórico
  const visit = await db.addVisit(slug, visitorName.trim(), visitorPhone ? visitorPhone.trim() : null);

  // 1. Notificar em tempo real via WebSocket para dispositivos online (primeiro plano)
  sendToHouseClients(slug, {
    type: 'ring',
    visit: visit
  });

  // 2. Se a campainha estiver ativada nas configurações da casa, envia Web Push para os offline
  if (house.active) {
    const subscriptions = await db.getPushSubscriptions(slug);
    const notificationPayload = JSON.stringify({
      title: 'Kenhê 🔔',
      body: `${visit.visitorName} está tocando a campainha!`,
      data: {
        url: `/`,
        timestamp: visit.timestamp,
        houseSlug: slug
      }
    });

    const pushPromises = subscriptions.map(sub => {
      // Formato exigido pelo web-push
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: sub.keys
      };
      
      return webpush.sendNotification(pushSubscription, notificationPayload)
        .catch(async (err) => {
          // Se a subscrição expirou ou não é mais válida, removemos do banco
          if (err.statusCode === 404 || err.statusCode === 410) {
            console.log(`Removendo subscrição expirada: ${sub.endpoint}`);
            await db.removePushSubscription(sub.endpoint);
          } else {
            console.error('Erro ao enviar push notification:', err);
          }
        });
    });

    // Executar disparos em segundo plano
    Promise.all(pushPromises);
  }

  res.json({ success: true, visit });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  await initWebPush();
});
