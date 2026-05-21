// Estado global da aplicação
let currentHouse = null;
let currentPin = null;
let socket = null;
let wsReconnectTimer = null;
let pushSubscription = null;

// Sound Engine usando Web Audio API
class SoundEngine {
  constructor() {
    this.ctx = null;
  }
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  playDingDong() {
    try {
      this.init();
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      
      const now = this.ctx.currentTime;
      
      // NOTA 1: DING (Tom mais agudo, ex: D5)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(587.33, now + 0.6);
      
      gain1.gain.setValueAtTime(0, now);
      gain1.gain.linearRampToValueAtTime(0.7, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      
      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 1.5);
      
      // NOTA 2: DONG (Tom mais grave atrasado, ex: A4)
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(440.00, now + 0.45); // A4
      osc2.frequency.exponentialRampToValueAtTime(440.00, now + 1.1);
      
      gain2.gain.setValueAtTime(0, now + 0.45);
      gain2.gain.linearRampToValueAtTime(0.7, now + 0.49);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      
      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.45);
      osc2.stop(now + 2.2);
      
      // Feedback táctil se suportado (vibração suave no morador caso esteja com cel aberto)
      if ('vibrate' in navigator) {
        navigator.vibrate([150, 100, 150]);
      }
    } catch (e) {
      console.warn('Não foi possível reproduzir som digital:', e);
    }
  }
}

const audio = new SoundEngine();

// Desbloquear áudio em qualquer clique na página inicial
document.body.addEventListener('click', () => {
  audio.init();
});

// Inicialização automática ao carregar
window.addEventListener('load', () => {
  setupPWA();
  checkAutoLogin();
});

// Registrar Service Worker para PWA e Push
async function setupPWA() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      console.log('Service Worker registrado:', reg);
      
      // Verificar se já temos inscrição de push ativa
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        pushSubscription = sub;
        updatePushButtonState(true);
      }
    } catch (err) {
      console.error('Falha ao registrar Service Worker:', err);
    }
  } else {
    document.getElementById('push-activation-card').style.display = 'none';
  }
}

// Alternar entre Entrar e Cadastrar
function switchAuthTab(type) {
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (type === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.style.display = 'block';
    formRegister.style.display = 'none';
  } else {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.style.display = 'block';
    formLogin.style.display = 'none';
  }
}

// Verificar dados no LocalStorage para Login Automático
async function checkAutoLogin() {
  const slug = localStorage.getItem('kenhe_slug');
  const pin = localStorage.getItem('kenhe_pin');

  if (slug && pin) {
    try {
      const response = await fetch('/api/house/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, pin })
      });
      if (response.ok) {
        const data = await response.json();
        loginSuccess(data, pin);
      } else {
        // Limpar dados corrompidos ou alterados no servidor
        handleLogout();
      }
    } catch (e) {
      console.error('Erro de conexão ao tentar login automático:', e);
      showStatusOffline();
    }
  }
}

// Executar login
async function handleLogin(event) {
  event.preventDefault();
  const slug = document.getElementById('login-slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();
  const pin = document.getElementById('login-pin').value.trim();

  try {
    const response = await fetch('/api/house/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, pin })
    });

    const data = await response.json();
    if (response.ok) {
      loginSuccess(data, pin);
    } else {
      alert(data.error || 'Falha na autenticação.');
    }
  } catch (err) {
    alert('Erro de conexão ao tentar fazer login.');
  }
}

// Executar cadastro
async function handleRegister(event) {
  event.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const slug = document.getElementById('reg-slug').value.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();
  const pin = document.getElementById('reg-pin').value.trim();

  try {
    const response = await fetch('/api/house', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, pin })
    });

    const data = await response.json();
    if (response.ok) {
      loginSuccess(data, pin);
    } else {
      alert(data.error || 'Falha ao registrar a casa.');
    }
  } catch (err) {
    alert('Erro de conexão ao criar a campainha.');
  }
}

// Sucesso ao entrar
function loginSuccess(house, pin) {
  currentHouse = house;
  currentPin = pin;

  localStorage.setItem('kenhe_slug', house.slug);
  localStorage.setItem('kenhe_pin', pin);

  // Mudar de tela
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-dashboard').classList.add('active');

  // Preencher dados no painel
  document.getElementById('dash-house-name').textContent = house.name;
  
  const shareUrl = `${window.location.origin}/casa/${house.slug}`;
  const shareLinkElem = document.getElementById('dash-house-url');
  shareLinkElem.textContent = shareUrl.replace(/^https?:\/\//, '');
  shareLinkElem.href = shareUrl;
  
  document.getElementById('share-url-text').textContent = shareUrl.replace(/^https?:\/\//, '');

  document.getElementById('toggle-campainha').checked = house.active;

  // Gerar QR Code
  generateQRCode(shareUrl);

  // Conectar WebSocket
  connectWebSocket();

  // Carregar histórico
  loadHistory();
}

// Logout
function handleLogout() {
  localStorage.removeItem('kenhe_slug');
  localStorage.removeItem('kenhe_pin');
  currentHouse = null;
  currentPin = null;

  if (socket) {
    socket.close();
  }
  clearTimeout(wsReconnectTimer);

  document.getElementById('screen-dashboard').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');
  showStatusOffline();
  
  // Limpar formulários
  document.getElementById('form-login').reset();
  document.getElementById('form-register').reset();
}

// Gerar QR Code na tela
function generateQRCode(url) {
  const canvas = document.getElementById('qr-canvas');
  QRCode.toCanvas(canvas, url, {
    width: 200,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  }, (error) => {
    if (error) console.error('Erro ao gerar QR Code:', error);
  });
}

// Baixar QR Code gerado
function downloadQRCode() {
  const canvas = document.getElementById('qr-canvas');
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `kenhe_qrcode_${currentHouse.slug}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Copiar link de compartilhamento
function copyShareLink() {
  const url = `${window.location.origin}/casa/${currentHouse.slug}`;
  navigator.clipboard.writeText(url).then(() => {
    alert('Link copiado para a área de transferência!');
  }).catch(err => {
    console.error('Erro ao copiar link:', err);
  });
}

// Conectar ao canal WebSocket em tempo real
function connectWebSocket() {
  if (!currentHouse) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('Conexão WebSocket ativa.');
    showStatusConnected();
    // Registrar esta sessão no servidor sob a casa correta
    socket.send(JSON.stringify({
      type: 'register',
      houseSlug: currentHouse.slug
    }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'ring') {
        // Tocou a campainha!
        triggerBellRing(data.visit);
      } else if (data.type === 'config_sync') {
        // Outro dispositivo alterou o estado de ativo/inativo da campainha
        document.getElementById('toggle-campainha').checked = data.active;
        currentHouse.active = data.active;
      }
    } catch (err) {
      console.error('Erro ao processar mensagem do servidor:', err);
    }
  };

  socket.onclose = () => {
    console.log('Conexão WebSocket fechada. Tentando reconectar...');
    showStatusOffline();
    wsReconnectTimer = setTimeout(connectWebSocket, 5000);
  };

  socket.onerror = (err) => {
    console.error('Erro no WebSocket:', err);
    socket.close();
  };
}

// Alterar visual para conectado
function showStatusConnected() {
  const badge = document.getElementById('connection-status-badge');
  badge.className = 'badge badge-success';
  badge.innerHTML = '<span class="status-dot">●</span> Ligado';
}

// Alterar visual para desconectado
function showStatusOffline() {
  const badge = document.getElementById('connection-status-badge');
  badge.className = 'badge badge-danger';
  badge.innerHTML = '<span class="status-dot">●</span> Offline';
}

// Ativar/Desativar campainha nas definições
async function toggleCampainhaState(isActive) {
  if (!currentHouse) return;

  try {
    const response = await fetch(`/api/house/${currentHouse.slug}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentPin, active: isActive })
    });

    if (response.ok) {
      const data = await response.json();
      currentHouse.active = data.active;
    } else {
      // Reverter se der erro
      document.getElementById('toggle-campainha').checked = !isActive;
      alert('Falha ao atualizar estado da campainha.');
    }
  } catch (err) {
    document.getElementById('toggle-campainha').checked = !isActive;
    alert('Erro de conexão ao alterar estado da campainha.');
  }
}

// Carregar histórico de visitas do servidor
async function loadHistory() {
  if (!currentHouse) return;

  try {
    const response = await fetch(`/api/visits/${currentHouse.slug}?pin=${currentPin}`);
    if (response.ok) {
      const data = await response.json();
      renderHistory(data.visits);
    }
  } catch (err) {
    console.error('Erro ao buscar histórico de visitas:', err);
  }
}

// Renderizar histórico no DOM
function renderHistory(visits) {
  const container = document.getElementById('history-container');
  const countBadge = document.getElementById('visit-count-badge');
  
  countBadge.textContent = `${visits.length} ${visits.length === 1 ? 'toque' : 'toques'}`;

  if (visits.length === 0) {
    container.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">🔔</div>
        <p>Nenhum visitante tocou a sua campainha até agora.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = visits.map(v => {
    const date = new Date(v.timestamp);
    const timeFormatted = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = date.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
    const relativeTime = getRelativeTimeString(date);

    const phoneHTML = v.visitorPhone 
      ? `<span class="visitor-phone">
          <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>
          ${v.visitorPhone}
         </span>`
      : '';

    return `
      <div class="history-item">
        <div class="visitor-details">
          <span class="visitor-name">${escapeHTML(v.visitorName)}</span>
          ${phoneHTML}
        </div>
        <div class="visit-time">
          <span class="visit-date">${dateFormatted} às ${timeFormatted}</span>
          <span class="visit-relative">${relativeTime}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Disparar o toque da campainha e exibir modal nativo na aba ativa
function triggerBellRing(visit) {
  // 1. Tocar som via Web Audio
  audio.playDingDong();

  // 2. Preencher dados do modal
  document.getElementById('modal-visitor-name').textContent = visit.visitorName;
  
  const phoneText = visit.visitorPhone ? `Telefone: ${visit.visitorPhone}` : 'Telefone: Não informado';
  document.getElementById('modal-visitor-phone').textContent = phoneText;
  
  const date = new Date(visit.timestamp);
  const timeFormatted = date.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('modal-visitor-time').textContent = `Hoje às ${timeFormatted}`;

  // 3. Exibir o modal com classe ativa
  document.getElementById('ring-overlay').classList.add('active');

  // 4. Recarregar o histórico para incluir o novo toque no topo
  loadHistory();
}

// Fechar modal de alerta
function dismissActiveRing() {
  document.getElementById('ring-overlay').classList.remove('active');
}

// Solicitar permissão de push e registrar subscrição no backend
async function requestPushPermission() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('As notificações Push não são suportadas neste navegador.');
    return;
  }

  const btn = document.getElementById('btn-enable-push');
  btn.disabled = true;
  btn.textContent = 'Ativando...';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Permissão de notificações negada pelo utilizador.');
      updatePushButtonState(false);
      return;
    }

    // Obter chave pública VAPID
    const keyResponse = await fetch('/api/push/vapid-public-key');
    const keyData = await keyResponse.json();
    const applicationServerKey = urlB64ToUint8Array(keyData.publicKey);

    // Obter ou registrar subscrição
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey
    });

    pushSubscription = sub;

    // Enviar inscrição para o backend
    const subResponse = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        houseSlug: currentHouse.slug,
        subscription: sub,
        pin: currentPin
      })
    });

    if (subResponse.ok) {
      updatePushButtonState(true);
      alert('Notificações push configuradas com sucesso para este telemóvel!');
    } else {
      throw new Error('Falha ao salvar inscrição no servidor.');
    }
  } catch (err) {
    console.error('Erro ao configurar push notifications:', err);
    alert('Ocorreu um erro ao ativar notificações. Tente novamente.');
    updatePushButtonState(false);
  }
}

// Atualizar estilo do botão de push conforme estado de ativação
function updatePushButtonState(isSubscribed) {
  const btn = document.getElementById('btn-enable-push');
  if (isSubscribed) {
    btn.className = 'btn btn-secondary';
    btn.disabled = true;
    btn.style.borderColor = 'var(--color-success)';
    btn.style.color = 'var(--color-success)';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" style="fill: currentColor; margin-right: 0.25rem;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
      Notificações Ativadas
    `;
  } else {
    btn.className = 'btn btn-secondary';
    btn.disabled = false;
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" style="fill: currentColor; margin-right: 0.25rem;"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/></svg>
      Ativar Notificações no Telemóvel
    `;
  }
}

// Converte VAPID key String Base64 para Uint8Array
function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Helpers Utilitários
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function getRelativeTimeString(date) {
  const delta = Math.round((new Date() - date) / 1000);
  const minute = 60;
  const hour = minute * 60;
  const day = hour * 24;

  if (delta < 30) {
    return 'agora mesmo';
  } else if (delta < minute) {
    return `há ${delta} segundos`;
  } else if (delta < 2 * minute) {
    return 'há 1 minuto';
  } else if (delta < hour) {
    return `há ${Math.floor(delta / minute)} minutos`;
  } else if (delta < 2 * hour) {
    return 'há 1 hora';
  } else if (delta < day) {
    return `há ${Math.floor(delta / hour)} horas`;
  } else {
    return `há ${Math.floor(delta / day)} dias`;
  }
}
