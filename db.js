import { promises as fs } from 'fs';
import path from 'path';

const DB_DIR = path.resolve('./data');
const DB_FILE = path.join(DB_DIR, 'db.json');

// Estrutura padrão inicial do banco de dados
const initialData = {
  houses: {},         // slug -> { name, pin, active }
  visits: [],         // list of { id, houseSlug, visitorName, visitorPhone, timestamp }
  subscriptions: []   // list of { houseSlug, endpoint, keys }
};

let dbData = { ...initialData };
let isLoaded = false;
let writeQueue = Promise.resolve();

// Inicialização segura do banco
async function init() {
  if (isLoaded) return;
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
    try {
      const content = await fs.readFile(DB_FILE, 'utf-8');
      dbData = JSON.parse(content);
      // Garantir compatibilidade se faltar alguma chave
      dbData.houses = dbData.houses || {};
      dbData.visits = dbData.visits || [];
      dbData.subscriptions = dbData.subscriptions || [];
    } catch (readError) {
      // Se o arquivo não existir ou estiver corrompido, grava o estado inicial
      await save();
    }
    isLoaded = true;
  } catch (err) {
    console.error('Erro ao inicializar o banco de dados:', err);
    throw err;
  }
}

// Salva de forma atômica usando uma fila (queue) para evitar escritas concorrentes corrompendo o JSON
function save() {
  writeQueue = writeQueue.then(async () => {
    try {
      const tempFile = DB_FILE + '.tmp';
      await fs.writeFile(tempFile, JSON.stringify(dbData, null, 2), 'utf-8');
      await fs.rename(tempFile, DB_FILE);
    } catch (err) {
      console.error('Erro ao gravar no banco de dados:', err);
    }
  });
  return writeQueue;
}

export const db = {
  async getHouse(slug) {
    await init();
    return dbData.houses[slug] || null;
  },

  async createHouse(slug, name, pin) {
    await init();
    if (dbData.houses[slug]) {
      throw new Error('Esta casa já existe.');
    }
    dbData.houses[slug] = {
      slug,
      name,
      pin,
      active: true
    };
    await save();
    return dbData.houses[slug];
  },

  async updateHouse(slug, updates) {
    await init();
    if (!dbData.houses[slug]) {
      throw new Error('Casa não encontrada.');
    }
    dbData.houses[slug] = {
      ...dbData.houses[slug],
      ...updates
    };
    await save();
    return dbData.houses[slug];
  },

  async addVisit(houseSlug, visitorName, visitorPhone) {
    await init();
    const visit = {
      id: Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      houseSlug,
      visitorName,
      visitorPhone: visitorPhone || null,
      timestamp: new Date().toISOString()
    };
    dbData.visits.unshift(visit); // Adiciona no início (mais recente primeiro)
    await save();
    return visit;
  },

  async getVisits(houseSlug) {
    await init();
    return dbData.visits.filter(v => v.houseSlug === houseSlug);
  },

  async addPushSubscription(houseSlug, subscription) {
    await init();
    // Evitar duplicatas do mesmo endpoint
    dbData.subscriptions = dbData.subscriptions.filter(
      sub => sub.endpoint !== subscription.endpoint
    );
    dbData.subscriptions.push({
      houseSlug,
      endpoint: subscription.endpoint,
      keys: subscription.keys
    });
    await save();
  },

  async removePushSubscription(endpoint) {
    await init();
    const originalLength = dbData.subscriptions.length;
    dbData.subscriptions = dbData.subscriptions.filter(
      sub => sub.endpoint !== endpoint
    );
    if (dbData.subscriptions.length !== originalLength) {
      await save();
    }
  },

  async getPushSubscriptions(houseSlug) {
    await init();
    return dbData.subscriptions.filter(sub => sub.houseSlug === houseSlug);
  },

  async getConfig(key) {
    await init();
    return dbData[key] || null;
  },

  async setConfig(key, value) {
    await init();
    dbData[key] = value;
    await save();
    return value;
  }
};
