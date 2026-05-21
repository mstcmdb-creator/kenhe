let houseSlug = '';
let houseData = null;

// Extrair o slug da casa a partir da URL
function getHouseSlugFromUrl() {
  const parts = window.location.pathname.split('/');
  // Se a rota for /casa/:slug, a parte final será o slug
  return parts[parts.length - 1] || '';
}

// Inicializar carregando dados públicos da casa
window.addEventListener('load', async () => {
  houseSlug = getHouseSlugFromUrl();
  if (!houseSlug) {
    alert('Link inválido. Redirecionando para a página principal.');
    window.location.href = '/';
    return;
  }

  try {
    const response = await fetch(`/api/house/${houseSlug}`);
    if (response.ok) {
      houseData = await response.json();
      document.getElementById('visitor-house-name').textContent = houseData.name;
      document.getElementById('success-house-name').textContent = houseData.name;
      
      // Armazena no localStorage o último visitante para autopreenchimento útil
      const lastVisitorName = localStorage.getItem('kenhe_last_visitor_name');
      const lastVisitorPhone = localStorage.getItem('kenhe_last_visitor_phone');
      if (lastVisitorName) {
        document.getElementById('visitor-name').value = lastVisitorName;
      }
      if (lastVisitorPhone) {
        document.getElementById('visitor-phone').value = lastVisitorPhone;
      }
    } else {
      alert('Esta campainha digital não está registrada ou foi excluída.');
      window.location.href = '/';
    }
  } catch (err) {
    console.error('Erro de conexão ao carregar a página da campainha:', err);
    document.getElementById('visitor-house-name').textContent = 'Erro ao Carregar';
  }
});

// Ação de TOCAR a campainha
async function handleRing(event) {
  event.preventDefault();
  
  const visitorName = document.getElementById('visitor-name').value.trim();
  const visitorPhone = document.getElementById('visitor-phone').value.trim();
  const btnBell = document.getElementById('btn-bell');
  const pulse = btnBell.querySelector('.pulse-ring');
  
  if (!visitorName) return;

  // Feedback tátil suave no visitante
  if ('vibrate' in navigator) {
    navigator.vibrate(100);
  }

  // Desabilitar botões e entradas
  document.getElementById('visitor-name').disabled = true;
  document.getElementById('visitor-phone').disabled = true;
  btnBell.disabled = true;
  
  // Ativar efeitos visuais de pulso infinito no botão de campainha
  if (pulse) {
    pulse.style.animationPlayState = 'running';
  }

  try {
    const response = await fetch('/api/ring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        houseSlug: houseSlug,
        visitorName: visitorName,
        visitorPhone: visitorPhone || null
      })
    });

    if (response.ok) {
      // Salvar os dados do visitante para preenchimento futuro rápido
      localStorage.setItem('kenhe_last_visitor_name', visitorName);
      if (visitorPhone) {
        localStorage.setItem('kenhe_last_visitor_phone', visitorPhone);
      } else {
        localStorage.removeItem('kenhe_last_visitor_phone');
      }

      // Obter hora exata e formatar
      const now = new Date();
      const timeFormatted = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('success-time').textContent = timeFormatted;

      // Transição suave para a tela de sucesso
      setTimeout(() => {
        document.getElementById('screen-visitor-form').classList.remove('active');
        document.getElementById('screen-visitor-success').classList.add('active');
      }, 800); // Dar tempo do feedback de pulso rodar um pouco
    } else {
      alert('Falha ao acionar a campainha. Tente tocar novamente.');
      resetRingFormState();
    }
  } catch (err) {
    console.error('Erro ao tocar campainha:', err);
    alert('Erro de conexão ao tentar tocar a campainha. Verifique a sua internet.');
    resetRingFormState();
  }
}

// Resetar estado visual do formulário de toque em caso de erro
function resetRingFormState() {
  const btnBell = document.getElementById('btn-bell');
  const pulse = btnBell.querySelector('.pulse-ring');
  
  document.getElementById('visitor-name').disabled = false;
  document.getElementById('visitor-phone').disabled = false;
  btnBell.disabled = false;
  
  if (pulse) {
    pulse.style.animationPlayState = 'paused';
  }
}

// Voltar do sucesso para tocar novamente
function resetRingForm() {
  resetRingFormState();
  
  document.getElementById('screen-visitor-success').classList.remove('active');
  document.getElementById('screen-visitor-form').classList.add('active');
}
