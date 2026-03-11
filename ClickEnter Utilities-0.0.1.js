// ==UserScript==
// @name         ClickEnter Utilities
// @namespace    http://tampermonkey.net/
// @version      0.0.1
// @description  Utilitários refatorados para melhorar a produtividade de atendimento no PipeRun e painel SynSuite
// @author       inaciodinucci
// @match        https://synsuite.clickenter.com.br/*
// @match        https://clickenter.cxm.pipe.run/agent*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  console.log('Userscript carregado: ClickEnter Utilities v2');

  const CONFIG = {
    KEYS: {
      LEMBRETES: 'clickenter_lembretes',
      MENSAGENS: 'clickenter_mensagens',
      AI_PROVIDER: 'clickenter_ai_provider',
      API_KEY_OPENAI: 'clickenter_apikey_openai',
      API_KEY_GEMINI: 'clickenter_apikey_gemini',
      TMA_DATA: 'clickenter_tma_data'
    },
    DOM_IDS: {
      PAINEL: 'painel-extensao-atendente',
      NOME_CLIENTE: 'extensao-nome-cliente',
      CRONOMETRO_STATUS: 'cronometro-status',
      MINUTOS_CUSTOM: 'minutos-custom',
      LEMBRETE_NOVO: 'lembrete-novo',
      LISTA_LEMBRETES: 'lista-lembretes',
      MENSAGEM_NOVA: 'mensagem-nova',
      LISTA_MENSAGENS: 'lista-mensagens',
      ICONE_NAVBAR: 'icone-extensao-atendente',
      ICONE_TALKPANEL: 'icone-flutuante-extensao',
      ICONE_TESTE: 'icone-teste-body',
      AI_OUTPUT: 'ai-relato-output',
      SETTINGS_OVERLAY: 'extensao-settings-overlay'
    },
    SVG_ICON: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 16.5V14a6 6 0 0 0-12 0v2.5"/><path d="M4 16.5C4 15.12 5.12 14 6.5 14S9 15.12 9 16.5 7.88 19 6.5 19 4 17.88 4 16.5z"/><path d="M15 16.5c0-1.38 1.12-2.5 2.5-2.5S20 15.12 20 16.5 18.88 19 17.5 19 15 17.88 15 16.5z"/><path d="M6.5 19v1.5C6.5 21.88 7.62 23 9 23h2"/></svg>`
  };

  // --- Módulos Principais ---

  class StorageManager {
    constructor() { }

    salvar(key, data) {
      localStorage.setItem(key, JSON.stringify(data));
    }

    obter(key, defaultVal = []) {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultVal;
    }
  }

  class TimerModule {
    constructor() {
      this.timers = {};
      this.completedTimers = {};
    }

    iniciar(cliente, minutos, onUpdateUI, onComplete) {
      this.parar(cliente);
      delete this.completedTimers[cliente];
      let tempoRestante = minutos * 60;

      const tick = () => {
        if (!this.timers[cliente]) return;
        const m = Math.floor(tempoRestante / 60);
        const s = tempoRestante % 60;
        const texto = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        const critico = tempoRestante <= 60;
        this.timers[cliente].texto = texto;
        this.timers[cliente].critico = critico;
        if (this.timers[cliente].onUpdateUI) {
          this.timers[cliente].onUpdateUI(cliente, texto, critico);
        }
        if (tempoRestante <= 0) {
          this.completedTimers[cliente] = { time: new Date().toLocaleTimeString(), viewed: false };
          this.parar(cliente);
          if (onComplete) onComplete(cliente);
          return;
        }
        tempoRestante--;
      };

      this.timers[cliente] = { intervalo: null, onUpdateUI, texto: 'Calculando...', critico: false };
      tick();
      this.timers[cliente].intervalo = setInterval(tick, 1000);
    }

    marcarVisualizado(cliente) {
      if (this.completedTimers[cliente]) {
        this.completedTimers[cliente].viewed = true;
      }
    }

    parar(cliente) {
      if (this.timers[cliente] && this.timers[cliente].intervalo) {
        clearInterval(this.timers[cliente].intervalo);
        delete this.timers[cliente];
      }
    }
  }

  // --- Módulo TMA (Tempo Médio de Atendimento) ---

  class TMAModule {
    constructor(storage) {
      this.storage = storage;
      this.atendimentos = this.storage.obter(CONFIG.KEYS.TMA_DATA, {});
      this._limparDadosAntigos();
    }

    registrarOuAtualizar(cliente, containerMensagem = null, sidebarTimestamp = null) {
      if (!cliente || cliente === 'Desconhecido') return;

      // Tentar encontrar timestamp da mensagem de transferência
      let transferTimestamp = null;
      if (containerMensagem) {
        const msgs = containerMensagem.querySelectorAll('.talk-message-text');
        const msgTransf = Array.from(msgs).find(el => el.textContent.includes('Atendimento transferido') || el.textContent.includes('fila'));
        if (msgTransf) {
          const infoEl = msgTransf.parentElement.querySelector('.talk-message-info');
          if (infoEl && infoEl.dataset.datetime) {
            transferTimestamp = this._parseDataPipeRun(infoEl.dataset.datetime);
          }
        }
      }

      // Se já registrado, atualizar apenas se encontrou timestamp de transferência mais preciso
      if (this.atendimentos[cliente]) {
        if (transferTimestamp && !this.atendimentos[cliente].fromTransferMsg) {
          this.atendimentos[cliente].start = transferTimestamp;
          this.atendimentos[cliente].fromTransferMsg = true;
          this.storage.salvar(CONFIG.KEYS.TMA_DATA, this.atendimentos);
        }
        return;
      }

      // Novo registro
      const timestamp = transferTimestamp || sidebarTimestamp || Date.now();
      this.atendimentos[cliente] = { start: timestamp, alerted60: false, fromTransferMsg: !!transferTimestamp };
      this.storage.salvar(CONFIG.KEYS.TMA_DATA, this.atendimentos);
    }

    obterStatus(cliente) {
      const dados = this.atendimentos[cliente];
      if (!dados) return { minutos: 0, alertar: false, critico: false };
      const minutos = Math.floor((Date.now() - dados.start) / 60000);
      return { minutos, alertar: minutos >= 35, critico: minutos >= 60 };
    }

    verificarAlertaGlobal() {
      for (const cliente in this.atendimentos) {
        const status = this.obterStatus(cliente);
        if (status.critico && !this.atendimentos[cliente].alerted60) {
          this._dispararNotificacao(cliente);
          this.atendimentos[cliente].alerted60 = true;
          this.storage.salvar(CONFIG.KEYS.TMA_DATA, this.atendimentos);
        }
      }
    }

    limparClientesAusentes(activeClients) {
      if (!activeClients || activeClients.size === 0) return;
      let mudou = false;
      for (const key in this.atendimentos) {
        if (!activeClients.has(key)) {
          delete this.atendimentos[key];
          mudou = true;
        }
      }
      if (mudou) this.storage.salvar(CONFIG.KEYS.TMA_DATA, this.atendimentos);
    }

    _dispararNotificacao(cliente) {
      const msg = `TMA Excedido: O atendimento de ${cliente} já passou de 1 hora!`;
      new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(() => { });
      if (window.Notification && Notification.permission === 'granted') {
        new Notification('TMA Excedido!', { body: msg, icon: 'https://cdn-icons-png.flaticon.com/512/3030/3030285.png' });
      }
      const originalTitle = document.title;
      document.title = '⚠ ' + msg;
      setTimeout(() => document.title = originalTitle, 5000);
      alert(msg);
    }

    _parseDataPipeRun(dateStr) {
      try {
        const [data, hora] = dateStr.split(' ');
        const [d, m, y] = data.split('/').map(Number);
        const parts = hora.split(':').map(Number);
        const h = parts[0] || 0, min = parts[1] || 0, s = parts[2] || 0;
        const dt = new Date(y, m - 1, d, h, min, s);
        return isNaN(dt.getTime()) ? Date.now() : dt.getTime();
      } catch (e) { return Date.now(); }
    }

    _limparDadosAntigos() {
      const agora = Date.now();
      let mudou = false;
      for (const key in this.atendimentos) {
        if (agora - this.atendimentos[key].start > 86400000) {
          delete this.atendimentos[key];
          mudou = true;
        }
      }
      if (mudou) this.storage.salvar(CONFIG.KEYS.TMA_DATA, this.atendimentos);
    }
  }

  class AIModule {
    async gerarRelato(lembretes, provider, apiKey) {
      if (!apiKey) throw new Error('API Key não configurada. Acesse as configurações (⚙).');

      // Extrair mensagens do chat atual
      const historicoChat = this._extrairHistoricoChat();

      if ((!lembretes || lembretes.length === 0) && historicoChat.length === 0) {
        throw new Error('Adicione ao menos um lembrete ou aguarde carregar as mensagens do chat.');
      }

      let prompt = `Gere um relato técnico de atendimento ao cliente.\n\n`;

      if (lembretes && lembretes.length > 0) {
        prompt += `*Pontos registrados pelo atendente:*\n${lembretes.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n`;
      }

      if (historicoChat.length > 0) {
        prompt += `*Histórico da conversa no chat:*\n`;
        historicoChat.forEach(msg => {
          prompt += `[${msg.hora}] ${msg.autor}: ${msg.texto}\n`;
        });
        prompt += `\n`;
      }

      prompt += `Gere um relato CURTO, DIRETO e OBJETIVO do atendimento, em um único parágrafo, sem o uso de markdown, tópicos ou títulos. O relato deve ir direto ao ponto.
MUITO IMPORTANTE: Escreva o relato na **PRIMEIRA PESSOA DO SINGULAR ("eu fiz", "verifiquei", "orientei")**, pois este texto será copiado e colado pelo atendente (você) no sistema da empresa. Nunca use terceira pessoa como "o atendente fez".
não precisa falar o nome do cliente ou citar o nome dele(a), preferivelmente comece com "O Cliente..."Exemplo do formato exato que eu desejo: "Cliente solicitou troca de senha, fiz a alteração da senha dela e informei sobre ela ser Case Sensitive, ela entendeu e confirmou, e posteriormente disse que iria se conectar quando chegasse em casa, depois disso o atendimento foi encerrado."
Escreva de forma fluida e contínua, descrevendo resumidamente a solicitação inicial do cliente, a ação que foi tomada e a conclusão ou encaminhamento final do chat.`;

      if (provider === 'gemini') return this.chamarGemini(prompt, apiKey);
      return this.chamarChatGPT(prompt, apiKey);
    }

    _extrairHistoricoChat() {
      const msgs = [];
      const container = document.getElementById('talk-panel');
      if (!container) return msgs;

      const elementosMsg = container.querySelectorAll('.talk-message-group');
      elementosMsg.forEach(el => {
        // Extrair mensagens do chat atual
        const infoEl = el.querySelector('.talk-message-info');
        if (!infoEl) return;
        const rawInfo = infoEl.textContent.trim(); // ex: "91985251951 em 10/03/2026 10:56" ou "PipeBot em 10/03..."
        const partesInfo = rawInfo.split(' em ');
        const autor = partesInfo[0] ? partesInfo[0].trim() : 'Desconhecido';
        const hora = partesInfo[1] ? partesInfo[1].trim() : '';

        // Obter o texto da mensagem
        const textEl = el.querySelector('.talk-message-text');
        if (!textEl) return;

        // Pega apenas o texto direto (ignora botões e extras complexos embaixo)
        let texto = textEl.innerText.trim();

        // Pega botões do bot se houver (ex: SIM, NÃO)
        const botoes = el.querySelectorAll('.talk-buttons-content span');
        if (botoes.length > 0) {
          const opcoes = Array.from(botoes).map(b => `[${b.textContent}]`).join(' ');
          texto += ` \n(Opções do Bot: ${opcoes})`;
        }

        if (texto) msgs.push({ autor, hora, texto });
      });

      return msgs;
    }

    async chamarGemini(prompt, apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1alpha/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
      const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: body,
            onload: (res) => {
              if (res.status >= 200 && res.status < 300) {
                try {
                  const data = JSON.parse(res.responseText);
                  resolve(data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta da API.');
                } catch (e) { reject(new Error('Erro ao fazer parse da resposta do Gemini.')); }
              } else {
                reject(new Error(`Gemini API Http ${res.status}: ${res.responseText}`));
              }
            },
            onerror: (err) => reject(new Error('GM_xmlhttpRequest error (Gemini): ' + JSON.stringify(err)))
          });
        } else {
          // Fallback to fetch (Might fail due to CORS on strict pages)
          fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: body
          }).then(async res => {
            if (!res.ok) { const e = await res.text(); throw new Error(`Gemini API erro Http ${res.status}: ${e}`); }
            const data = await res.json();
            resolve(data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta da API.');
          }).catch(err => reject(new Error('Fetch error (Gemini): ' + err.message)));
        }
      });
    }

    async chamarChatGPT(prompt, apiKey) {
      const url = 'https://api.openai.com/v1/chat/completions';
      const body = JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: prompt }], max_tokens: 1024 });

      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'undefined') {
          GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            data: body,
            onload: (res) => {
              if (res.status >= 200 && res.status < 300) {
                try {
                  const data = JSON.parse(res.responseText);
                  resolve(data.choices?.[0]?.message?.content || 'Sem resposta da API.');
                } catch (e) { reject(new Error('Erro ao fazer parse da resposta do ChatGPT.')); }
              } else {
                reject(new Error(`ChatGPT API Http ${res.status}: ${res.responseText}`));
              }
            },
            onerror: (err) => reject(new Error('GM_xmlhttpRequest error (ChatGPT): ' + JSON.stringify(err)))
          });
        } else {
          fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: body
          }).then(async res => {
            if (!res.ok) { const e = await res.text(); throw new Error(`ChatGPT API erro Http ${res.status}: ${e}`); }
            const data = await res.json();
            resolve(data.choices?.[0]?.message?.content || 'Sem resposta da API.');
          }).catch(err => reject(new Error('Fetch error (ChatGPT): ' + err.message)));
        }
      });
    }
  }

  class UIManager {
    constructor(storage, timer, ai, tma) {
      this.storage = storage;
      this.timer = timer;
      this.ai = ai;
      this.tma = tma;
      this.clienteAtual = 'Desconhecido';
      this.settingsVisible = false;
    }

    construirPainel() {
      document.querySelectorAll(`#${CONFIG.DOM_IDS.PAINEL}`).forEach(p => p.remove());
      document.getElementById('ce-panel-styles')?.remove();

      const P = CONFIG.DOM_IDS.PAINEL;
      const painel = document.createElement('div');
      painel.id = P;
      Object.assign(painel.style, {
        position: 'fixed', top: '0', right: '-440px', width: '440px', height: '100%',
        background: '#e4e6e9', // Light Theme BG do PipeRun
        borderLeft: '1px solid #d4dfe3',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        zIndex: '99999',
        transition: 'right 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
        padding: '28px 22px', overflowY: 'auto',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', color: '#393939'
      });

      const style = document.createElement('style');
      style.id = 'ce-panel-styles';
      style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        #${P} * { box-sizing:border-box; }
        #${P} button {
          background:#1D6CAE; color:#fff; /* Azul mais escuro e vibrante */
          border:none; padding:7px 14px; border-radius:4px; cursor:pointer;
          font-weight:600; font-size:13px; letter-spacing:0.2px;
          transition:all 0.2s; box-shadow:0 1px 3px rgba(0,0,0,0.15);
        }
        #${P} button:hover { background:#15548a; transform:translateY(-1px); }
        #${P} button:active { transform:scale(0.98); }
        #${P} button.danger-btn {
          background:#ED5565; padding:4px 9px;
          box-shadow:0 1px 3px rgba(237,85,101,0.3);
        }
        #${P} button.danger-btn:hover { background:#d44d5c; }
        #${P} button.secondary-btn {
          background:#fafafa; border:1px solid #d4dfe3; color:#1D6CAE;
          box-shadow:none; font-weight:500;
        }
        #${P} button.secondary-btn:hover { background:#eaeff2; color:#15548a; }
        #${P} input, #${P} textarea, #${P} select {
          background:#fff; border:1px solid #d5d5d5;
          border-radius:4px; padding:9px 12px; font-family:inherit; font-size:13px;
          color:#393939; transition:all 0.2s;
        }
        #${P} input:focus, #${P} textarea:focus, #${P} select:focus {
          outline:none; border-color:#f59942;
          box-shadow:none;
        }
        #${P} select option { background:#fff; color:#393939; }
        #${P} hr { border:0; height:1px; background:#d4dfe3; margin:18px 0; }
        #${P} h3 { margin-top:0; color:#2679B5; font-size:18px; font-weight:400; font-family:"Helvetica Neue",Helvetica,Arial,sans-serif; }
        #${P} .section-title {
          color:#2f4050; font-size:13px; font-weight:600; text-transform:uppercase;
          letter-spacing:1px; margin-bottom:10px; display:flex; align-items:center; gap:6px;
        }
        #${P} .section-card {
          background:#fff; border:1px solid #e1e6eb;
          border-radius:6px; padding:16px; margin-bottom:12px;
          box-shadow:0 1px 2px rgba(0,0,0,0.05);
        }
        #${P} ul { margin:0; padding:0; list-style:none; }
        #${P} li {
          background:#fafafa; border:1px solid #e1e6eb;
          border-radius:4px; padding:10px 12px; margin-bottom:6px;
        }
        .ce-timer-active-button { border-left: 4px solid #1D6CAE !important; background-color: rgba(29, 108, 174, 0.05) !important; transition: all 0.3s ease; }
        .ce-timer-completed-button { border-left: 4px solid #ED5565 !important; background-color: rgba(237, 85, 101, 0.08) !important; animation: ce-pulse-bg 2s infinite; }
        @keyframes ce-pulse-bg { 0% { background-color: rgba(237, 85, 101, 0.05); } 50% { background-color: rgba(237, 85, 101, 0.15); } 100% { background-color: rgba(237, 85, 101, 0.05); } }
        .ce-tma-border-overlay {
          position: absolute !important; inset: -2px !important;
          border-radius: 6px !important; overflow: hidden !important;
          pointer-events: none !important; z-index: 10 !important;
          padding: 2px !important;
          -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
        }
        .ce-tma-border-spinner {
          position: absolute !important;
          top: 50% !important; left: 50% !important;
          width: 300% !important; height: 300% !important;
        }
        .ce-tma-border-spinner.warning {
          background: conic-gradient(transparent 0deg, transparent 160deg, #ffc10788 180deg, #ffc107 230deg, #ffab00 270deg, #ff9800 310deg, #ff980088 330deg, transparent 340deg, transparent 360deg);
          animation: ce-spin-ccw 2.5s linear infinite;
        }
        .ce-tma-border-spinner.critical {
          background: conic-gradient(transparent 0deg, transparent 160deg, #ff174488 180deg, #ff1744 230deg, #d50000 270deg, #b71c1c 310deg, #b71c1c88 330deg, transparent 340deg, transparent 360deg);
          animation: ce-spin-ccw 1.5s linear infinite;
        }
        @keyframes ce-spin-ccw {
          from { transform: translate(-50%, -50%) rotate(360deg); }
          to { transform: translate(-50%, -50%) rotate(0deg); }
        }

        .ce-alert-icon {
          position: absolute;
          left: 20px; /* Moved further left as requested */
          top: 36px;
          background: #fff;
          border-radius: 50%;
          font-size: 14px;
          line-height: 1;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          z-index: 10;
        }

        #${P} .settings-overlay {
          position:absolute; inset:0; background:rgba(255,255,255,0.95);
          z-index:10; padding:28px 22px; overflow:visible; overflow-y:auto;
          animation:ceFadeIn 0.2s ease;
        }
        @keyframes ceFadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes cePulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .ce-timer-badge {
          display:inline-flex; align-items:center; gap:3px; padding:3px 8px;
          border-radius:12px; font-size:11px; font-weight:600; font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;
          margin-left:6px; vertical-align:middle; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.1);
        }
        .ce-timer-badge.active { background:#1D6CAE; color:#fff; border:1px solid #15548a; }
        .ce-timer-badge.critical { background:#ED5565; color:#fff; border:1px solid #d44d5c; }
        .ce-timer-badge.completed {
          background:#f89406; color:#fff; border:1px solid #c87604;
          cursor:pointer; animation:cePulse 1.5s ease infinite;
        }
      `;
      document.head.appendChild(style);

      // Header
      const header = document.createElement('div');
      Object.assign(header.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' });

      const titleWrap = document.createElement('div');
      titleWrap.style.display = 'flex'; titleWrap.style.alignItems = 'center'; titleWrap.style.gap = '10px';
      const iconH = document.createElement('span');
      iconH.innerHTML = CONFIG.SVG_ICON;
      Object.assign(iconH.style, { width: '26px', height: '26px', color: '#1D6CAE', display: 'flex' });
      const titulo = document.createElement('h3');
      titulo.textContent = 'Atendimento';
      titleWrap.append(iconH, titulo);

      const headerBtns = document.createElement('div');
      headerBtns.style.display = 'flex'; headerBtns.style.gap = '12px'; /* Gap maior para afastar o config para a esquerda */

      const btnConfig = document.createElement('button');
      btnConfig.className = 'secondary-btn';
      btnConfig.innerHTML = '⚙'; btnConfig.title = 'Configurações';
      Object.assign(btnConfig.style, { fontSize: '16px', padding: '4px 8px', lineHeight: '1', marginRight: '6px' });
      btnConfig.addEventListener('click', () => this.toggleSettings());

      const btnFechar = document.createElement('button');
      btnFechar.className = 'secondary-btn';
      btnFechar.innerHTML = '✕'; btnFechar.title = 'Fechar';
      Object.assign(btnFechar.style, { fontSize: '14px', padding: '4px 8px', lineHeight: '1' });
      btnFechar.addEventListener('click', () => this.fecharPainel());

      headerBtns.append(btnConfig, btnFechar);
      header.append(titleWrap, headerBtns);

      const divCliente = document.createElement('div');
      Object.assign(divCliente.style, { marginBottom: '14px', fontSize: '13px' });
      divCliente.innerHTML = `<span style="color:#8089A0;">Cliente:</span> <span id="${CONFIG.DOM_IDS.NOME_CLIENTE}" style="font-weight:600;color:#2f4050;"></span>`;

      const secCronometro = this.construirSecaoCronometro();
      const secLembretes = this.construirSecaoLembretes();
      const secMensagens = this.construirSecaoMensagens();

      painel.append(header, divCliente, document.createElement('hr'),
        secCronometro, document.createElement('hr'),
        secLembretes, document.createElement('hr'),
        secMensagens
      );
      document.body.appendChild(painel);
    }

    toggleSettings() {
      const painel = document.getElementById(CONFIG.DOM_IDS.PAINEL);
      if (!painel) return;
      let overlay = painel.querySelector('.settings-overlay');
      if (overlay) { overlay.remove(); return; }

      overlay = document.createElement('div');
      overlay.className = 'settings-overlay';

      const title = document.createElement('h3');
      title.textContent = 'Configurações';

      const card = document.createElement('div');
      card.className = 'section-card';

      const lbl1 = document.createElement('div');
      lbl1.className = 'section-title'; lbl1.textContent = 'Provedor de IA';
      const sel = document.createElement('select');
      sel.style.width = '100%'; sel.style.marginBottom = '14px';
      sel.innerHTML = '<option value="gemini">Gemini 3 Flash Preview (Gratuito)</option><option value="chatgpt">ChatGPT (OpenAI)</option>';
      sel.value = this.storage.obter(CONFIG.KEYS.AI_PROVIDER, 'gemini');

      const lbl2 = document.createElement('div');
      lbl2.className = 'section-title'; lbl2.textContent = 'API Key - Gemini';
      const inputGemini = document.createElement('input');
      inputGemini.type = 'password'; inputGemini.style.width = '100%'; inputGemini.style.marginBottom = '14px';
      inputGemini.placeholder = 'Cole sua API Key do Gemini...';
      inputGemini.value = this.storage.obter(CONFIG.KEYS.API_KEY_GEMINI, '');

      const lbl3 = document.createElement('div');
      lbl3.className = 'section-title'; lbl3.textContent = 'API Key - OpenAI';
      const inputOpenAI = document.createElement('input');
      inputOpenAI.type = 'password'; inputOpenAI.style.width = '100%'; inputOpenAI.style.marginBottom = '18px';
      inputOpenAI.placeholder = 'Cole sua API Key do OpenAI...';
      inputOpenAI.value = this.storage.obter(CONFIG.KEYS.API_KEY_OPENAI, '');

      const btnSave = document.createElement('button');
      btnSave.textContent = 'Salvar Configurações';
      btnSave.style.width = '100%';
      btnSave.addEventListener('click', () => {
        this.storage.salvar(CONFIG.KEYS.AI_PROVIDER, sel.value);
        this.storage.salvar(CONFIG.KEYS.API_KEY_GEMINI, inputGemini.value);
        this.storage.salvar(CONFIG.KEYS.API_KEY_OPENAI, inputOpenAI.value);
        overlay.remove();
      });

      const btnBack = document.createElement('button');
      btnBack.className = 'secondary-btn';
      btnBack.textContent = '← Voltar';
      btnBack.style.width = '100%'; btnBack.style.marginBottom = '16px';
      btnBack.addEventListener('click', () => overlay.remove());

      card.append(lbl1, sel, lbl2, inputGemini, lbl3, inputOpenAI, btnSave);
      overlay.append(btnBack, title, document.createElement('hr'), card);
      painel.appendChild(overlay);
    }

    construirSecaoCronometro() {
      const wrapper = document.createElement('div');
      wrapper.className = 'section-card';
      const t = document.createElement('div');
      t.className = 'section-title'; t.textContent = 'CRONÔMETRO';
      wrapper.appendChild(t);

      const conteudoBotoes = document.createElement('div');
      Object.assign(conteudoBotoes.style, { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' });

      const criarBtn = (minText, minVal) => {
        const btn = document.createElement('button');
        btn.textContent = minText;
        btn.addEventListener('click', () => this.handleIniciarCronometro(minVal));
        return btn;
      };
      conteudoBotoes.append(criarBtn('5 min', 5), criarBtn('10 min', 10), criarBtn('15 min', 15));

      const inputCustom = document.createElement('input');
      inputCustom.type = 'number'; inputCustom.id = CONFIG.DOM_IDS.MINUTOS_CUSTOM;
      inputCustom.min = '1'; inputCustom.max = '120';
      Object.assign(inputCustom.style, { width: '55px' });

      const btnCustom = document.createElement('button');
      btnCustom.textContent = 'Definir';
      btnCustom.addEventListener('click', () => {
        const min = parseInt(inputCustom.value, 10);
        if (!isNaN(min) && min > 0) this.handleIniciarCronometro(min);
      });

      const status = document.createElement('div');
      status.id = CONFIG.DOM_IDS.CRONOMETRO_STATUS;
      Object.assign(status.style, { marginTop: '10px', fontSize: '22px', fontWeight: '700', fontFamily: 'Inter,monospace', letterSpacing: '1px' });

      const btnStop = document.createElement('button');
      btnStop.textContent = 'Parar';
      btnStop.className = 'danger-btn';
      btnStop.addEventListener('click', () => {
        if (this.clienteAtual) {
          this.timer.parar(this.clienteAtual);
          status.textContent = 'Parado';
          status.style.color = '#94a3b8';
        }
      });
      conteudoBotoes.append(inputCustom, btnCustom, btnStop);
      wrapper.append(conteudoBotoes, status);
      return wrapper;
    }

    construirSecaoLembretes() {
      const wrapper = document.createElement('div');
      wrapper.className = 'section-card';
      const t = document.createElement('div');
      t.className = 'section-title'; t.textContent = 'LEMBRETES';
      wrapper.append(t);

      const divInput = document.createElement('div');
      const textarea = document.createElement('textarea');
      textarea.id = CONFIG.DOM_IDS.LEMBRETE_NOVO;
      textarea.rows = 2; textarea.style.width = '100%'; textarea.style.marginBottom = '8px';
      textarea.style.resize = 'vertical';
      textarea.placeholder = 'Descreva o que foi feito neste atendimento...';

      const btnAdd = document.createElement('button');
      btnAdd.textContent = '+ Adicionar';
      btnAdd.addEventListener('click', () => {
        const txt = textarea.value.trim();
        if (!txt) return;
        const key = `${CONFIG.KEYS.LEMBRETES}_${this.clienteAtual}`;
        const lembretes = this.storage.obter(key);
        lembretes.push(txt);
        this.storage.salvar(key, lembretes);
        textarea.value = '';
        this.renderizarListaLembretes();
      });

      const lista = document.createElement('ul');
      lista.id = CONFIG.DOM_IDS.LISTA_LEMBRETES;
      lista.style.marginTop = '8px';

      divInput.append(textarea, btnAdd);

      // --- AI Report Section ---
      const aiSection = document.createElement('div');
      Object.assign(aiSection.style, { marginTop: '14px', borderTop: '1px solid #d4dfe3', paddingTop: '14px' });
      const aiTitle = document.createElement('div');
      aiTitle.className = 'section-title'; aiTitle.textContent = 'RELATO POR I.A.';

      const aiOutput = document.createElement('textarea');
      aiOutput.id = CONFIG.DOM_IDS.AI_OUTPUT;
      aiOutput.rows = 5; aiOutput.style.width = '100%'; aiOutput.style.marginTop = '8px'; aiOutput.style.resize = 'vertical';
      aiOutput.placeholder = 'O relato gerado pela IA aparecerá aqui...';

      let lastApiLog = '';

      const aiButtons = document.createElement('div');
      Object.assign(aiButtons.style, { display: 'flex', gap: '6px', marginTop: '8px' });

      const btnGerar = document.createElement('button');
      btnGerar.textContent = 'Gerar Relato';
      btnGerar.addEventListener('click', async () => {
        const key = `${CONFIG.KEYS.LEMBRETES}_${this.clienteAtual}`;
        const lembretes = this.storage.obter(key);
        const provider = this.storage.obter(CONFIG.KEYS.AI_PROVIDER, 'gemini');
        const apiKey = provider === 'gemini'
          ? this.storage.obter(CONFIG.KEYS.API_KEY_GEMINI, '')
          : this.storage.obter(CONFIG.KEYS.API_KEY_OPENAI, '');
        btnGerar.disabled = true; btnGerar.textContent = 'Gerando...';
        try {
          const relato = await this.ai.gerarRelato(lembretes, provider, apiKey);
          aiOutput.value = relato;
          lastApiLog = 'Sucesso na última chamada.';
        } catch (e) {
          aiOutput.value = `Erro: ${e.message}\nClique em "Ver Log" para detalhes técnicos.`;
          lastApiLog = e.stack || e.message || JSON.stringify(e);
        }
        btnGerar.disabled = false; btnGerar.textContent = 'Gerar Relato';
      });

      const btnCopy = document.createElement('button');
      btnCopy.className = 'secondary-btn';
      btnCopy.textContent = 'Copiar';
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(aiOutput.value)
          .then(() => { btnCopy.textContent = 'Copiado!'; setTimeout(() => btnCopy.textContent = 'Copiar', 2000); })
          .catch(e => console.error('Erro ao copiar', e));
      });

      const btnLog = document.createElement('button');
      btnLog.className = 'secondary-btn';
      btnLog.textContent = 'Ver Log';
      btnLog.addEventListener('click', () => {
        const textLog = lastApiLog || 'Nenhum log disponível ainda. Rode a IA primeiro.';
        prompt("Log técnico da última requisição para suporte:", textLog);
      });

      aiButtons.append(btnGerar, btnCopy, btnLog);
      aiSection.append(aiTitle, aiOutput, aiButtons);
      wrapper.append(divInput, lista, aiSection);
      return wrapper;
    }

    construirSecaoMensagens() {
      const wrapper = document.createElement('div');
      wrapper.className = 'section-card';
      const t = document.createElement('div');
      t.className = 'section-title'; t.textContent = 'MENSAGENS PRONTAS';
      wrapper.append(t);

      const divInput = document.createElement('div');
      const textarea = document.createElement('textarea');
      textarea.id = CONFIG.DOM_IDS.MENSAGEM_NOVA;
      textarea.rows = 2; textarea.style.width = '100%'; textarea.style.marginBottom = '8px';
      textarea.style.resize = 'vertical';
      textarea.placeholder = 'Digite a mensagem pronta aqui...';

      const btnSalvar = document.createElement('button');
      btnSalvar.textContent = '+ Salvar';
      btnSalvar.addEventListener('click', () => {
        const txt = textarea.value.trim();
        if (!txt) return;
        const mensagens = this.storage.obter(CONFIG.KEYS.MENSAGENS);
        mensagens.push(txt);
        this.storage.salvar(CONFIG.KEYS.MENSAGENS, mensagens);
        textarea.value = '';
        this.renderizarListaMensagens();
      });

      const lista = document.createElement('ul');
      lista.id = CONFIG.DOM_IDS.LISTA_MENSAGENS;
      lista.style.marginTop = '8px';

      divInput.append(textarea, btnSalvar);
      wrapper.append(divInput, lista);
      return wrapper;
    }

    // --- Renderizadores de Lista ---

    renderizarListaLembretes() {
      const ul = document.getElementById(CONFIG.DOM_IDS.LISTA_LEMBRETES);
      if (!ul) return;
      ul.innerHTML = '';

      const key = `${CONFIG.KEYS.LEMBRETES}_${this.clienteAtual}`;
      const lembretes = this.storage.obter(key);
      lembretes.forEach((lb, i) => {
        const li = document.createElement('li');
        Object.assign(li.style, { marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

        const spanTxt = document.createElement('span');
        spanTxt.textContent = lb;

        const btnRemove = document.createElement('button');
        btnRemove.innerHTML = '&times;';
        btnRemove.className = 'danger-btn';
        Object.assign(btnRemove.style, { marginLeft: '12px', fontSize: '15px' });
        btnRemove.addEventListener('click', () => {
          const l = this.storage.obter(key);
          l.splice(i, 1);
          this.storage.salvar(key, l);
          this.renderizarListaLembretes();
        });

        li.append(spanTxt, btnRemove);
        ul.appendChild(li);
      });
    }

    renderizarListaMensagens() {
      const ul = document.getElementById(CONFIG.DOM_IDS.LISTA_MENSAGENS);
      if (!ul) return;
      ul.innerHTML = '';

      const mensagens = this.storage.obter(CONFIG.KEYS.MENSAGENS);
      mensagens.forEach((msg, i) => {
        const li = document.createElement('li');
        Object.assign(li.style, { marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

        const txtResumo = msg.length > 30 ? msg.substring(0, 30) + '...' : msg;

        const spanCopy = document.createElement('span');
        spanCopy.textContent = `[Copiar] ${txtResumo}`;
        spanCopy.title = "Clique para copiar";
        Object.assign(spanCopy.style, { cursor: 'pointer', color: '#428BCA' });

        spanCopy.addEventListener('click', () => {
          navigator.clipboard.writeText(msg)
            .then(() => { spanCopy.textContent = '[Copiado]'; setTimeout(() => spanCopy.textContent = `[Copiar] ${txtResumo}`, 1500); })
            .catch(err => console.error('Erro ao copiar', err));
        });

        const btnRemove = document.createElement('button');
        btnRemove.innerHTML = '&times;';
        btnRemove.className = 'danger-btn';
        Object.assign(btnRemove.style, { marginLeft: '12px', fontSize: '15px' });
        btnRemove.addEventListener('click', () => {
          const m = this.storage.obter(CONFIG.KEYS.MENSAGENS);
          m.splice(i, 1);
          this.storage.salvar(CONFIG.KEYS.MENSAGENS, m);
          this.renderizarListaMensagens();
        });

        li.append(spanCopy, btnRemove);
        ul.appendChild(li);
      });
    }

    // --- Ações / Callbacks ---

    handleIniciarCronometro(minutos) {
      const spanStatus = document.getElementById(CONFIG.DOM_IDS.CRONOMETRO_STATUS);
      if (!spanStatus) return;

      // Solicitar permissão de notificação nativa ao iniciar, se ainda não tiver
      if (window.Notification && Notification.permission !== 'granted') {
        Notification.requestPermission();
      }

      const clienteAgendado = this.clienteAtual;

      this.timer.iniciar(
        clienteAgendado,
        minutos,
        (clienteUpdate, texto, critico) => {
          if (this.clienteAtual === clienteUpdate) {
            spanStatus.textContent = texto;
            spanStatus.style.color = critico ? 'red' : 'black';
          }
        },
        (clienteComplete) => {
          if (this.clienteAtual === clienteComplete && spanStatus) {
            spanStatus.textContent = 'Tempo Esgotado!';
            spanStatus.style.color = 'black';
          }

          const msgAviso = `O tempo de atendimento para ${clienteComplete} encerrou.`;

          // Som de Notificação
          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
          audio.play().catch(e => console.log('Áudio automático bloqueado pelo navegador', e));

          // Notificação de Janela Nativa
          if (window.Notification && Notification.permission === 'granted') {
            new Notification('Cronômetro Esgotado!', {
              body: msgAviso,
              icon: 'https://cdn-icons-png.flaticon.com/512/3030/3030285.png'
            });
          }

          // Fallback (Title Flash / Alert)
          const originalTitle = document.title;
          document.title = '(Alerta) ' + msgAviso;
          setTimeout(() => document.title = originalTitle, 5000);

          alert(msgAviso);
        }
      );
    }

    abrirPainel() {
      if (!document.getElementById(CONFIG.DOM_IDS.PAINEL)) {
        this.construirPainel();
      }

      const paineis = document.querySelectorAll(`#${CONFIG.DOM_IDS.PAINEL}`);
      const isAberto = Array.from(paineis).some(p => p.style.right === '0px');
      if (isAberto) {
        this.fecharPainel();
        return;
      }

      const nomeElement = document.querySelector('#customer-name');
      const nomeCliente = nomeElement ? nomeElement.textContent.trim() : 'Desconhecido';
      this.clienteAtual = nomeCliente;

      const lblExtensao = document.getElementById(CONFIG.DOM_IDS.NOME_CLIENTE);
      if (lblExtensao) lblExtensao.textContent = nomeCliente;

      const spanStatus = document.getElementById(CONFIG.DOM_IDS.CRONOMETRO_STATUS);
      if (spanStatus) {
        if (this.timer.timers[this.clienteAtual]) {
          const t = this.timer.timers[this.clienteAtual];
          spanStatus.textContent = t.texto || 'Calculando...';
          spanStatus.style.color = t.critico ? '#ED5565' : '#1D6CAE';
        } else {
          spanStatus.textContent = 'Parado';
          spanStatus.style.color = '#8089A0';
        }
      }

      paineis.forEach(p => p.style.right = '0px');

      this.renderizarListaLembretes();
      this.renderizarListaMensagens();
    }

    fecharPainel() {
      document.querySelectorAll(`#${CONFIG.DOM_IDS.PAINEL}`).forEach(p => p.style.right = '-440px');
    }

    // --- Injeção Constante na Interface (Navbar, TalkPanel, Ícone Flutuante) ---

    injetarIcones() {
      this._injetarNaNavbar();
      this._injetarNoTalkPanel();
      this._injetarEmFallback();
    }

    _criarIconeBase(id, size) {
      if (document.getElementById(id)) return null;
      const icone = document.createElement('span');
      icone.id = id;
      icone.innerHTML = CONFIG.SVG_ICON;
      icone.title = 'Abrir utilitários de atendimento';
      Object.assign(icone.style, {
        cursor: 'pointer', width: size, height: size,
        color: '#1D6CAE', display: 'flex', alignItems: 'center',
        justifyContent: 'center', userSelect: 'none',
        transition: 'color 0.2s, transform 0.2s'
      });
      icone.addEventListener('mouseenter', () => { icone.style.color = '#15548a'; icone.style.transform = 'scale(1.15)'; });
      icone.addEventListener('mouseleave', () => { icone.style.color = '#1D6CAE'; icone.style.transform = 'scale(1)'; });
      icone.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.abrirPainel(); });
      return icone;
    }

    _injetarNaNavbar() {
      // Procura o local onde estava sendo injetado originalmente (user-info) da barra superior direita
      const userInfo = document.querySelector('.navbar-buttons .user-info')
        || document.querySelector('.user-info')
        || document.querySelector('.navbar-header .user-info')
        || document.querySelector('.navbar .user-info');

      const navbarHeader = document.querySelector('.navbar-header.navbar-agent');

      const icone = this._criarIconeBase(CONFIG.DOM_IDS.ICONE_NAVBAR, '26px');
      if (!icone) return;

      if (userInfo) {
        icone.style.marginLeft = '12px';
        if (userInfo.parentElement) {
          userInfo.parentElement.insertBefore(icone, userInfo.nextSibling);
        } else {
          userInfo.appendChild(icone);
        }
      } else if (navbarHeader) {
        icone.style.marginLeft = '18px';
        icone.style.verticalAlign = 'middle';
        const logo = navbarHeader.querySelector('img');
        if (logo && logo.parentElement) {
          logo.parentElement.appendChild(icone);
        } else {
          navbarHeader.insertBefore(icone, navbarHeader.firstChild);
        }
      }
    }

    _injetarNoTalkPanel() {
      const talkPanel = document.querySelector('#talk-panel') || document.querySelector('.talk-panel') || document.querySelector("[id^='talk-panel']");
      if (!talkPanel) return;

      const iconeContainer = this._criarIconeBase(CONFIG.DOM_IDS.ICONE_TALKPANEL, '24px');
      if (!iconeContainer) return;

      // Transformando o container em uma div flutuante arrastável propriamente
      const divWrapper = document.createElement('div');
      divWrapper.id = CONFIG.DOM_IDS.ICONE_TALKPANEL; // Rouba o ID pra representar o componente
      iconeContainer.id = '';

      Object.assign(divWrapper.style, {
        position: 'absolute', top: '12px', right: '12px', zIndex: '9999',
        cursor: 'grab', background: '#fff',
        borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        border: '1px solid #d4dfe3',
        width: '42px', height: '42px', display: 'flex', alignItems: 'center',
        justifyContent: 'center', transition: 'box-shadow 0.18s, transform 0.18s', userSelect: 'none'
      });

      divWrapper.appendChild(iconeContainer);

      divWrapper.addEventListener('mouseenter', () => { divWrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; divWrapper.style.transform = 'scale(1.05)'; });
      divWrapper.addEventListener('mouseleave', () => { divWrapper.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; divWrapper.style.transform = 'scale(1)'; });

      // Lógica de drag real, encapsulada
      let dragging = false, offsetX, offsetY;
      divWrapper.addEventListener('mousedown', (e) => {
        dragging = true;
        divWrapper.style.cursor = 'grabbing';
        const rect = divWrapper.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;

        const onMouseMove = (ev) => {
          if (!dragging) return;
          const tpRect = talkPanel.getBoundingClientRect();
          let x = ev.clientX - offsetX;
          let y = ev.clientY - offsetY;

          x = Math.max(tpRect.left, Math.min(x, tpRect.right - divWrapper.offsetWidth));
          y = Math.max(tpRect.top, Math.min(y, tpRect.bottom - divWrapper.offsetHeight));

          divWrapper.style.left = (x - tpRect.left) + 'px';
          divWrapper.style.top = (y - tpRect.top) + 'px';
          divWrapper.style.right = 'auto'; // Reseta fallback
        };

        const onMouseUp = () => {
          dragging = false;
          divWrapper.style.cursor = 'grab';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      talkPanel.style.position = 'relative';
      talkPanel.appendChild(divWrapper);
    }

    _injetarEmFallback() {
      setTimeout(() => {
        const existente = document.getElementById(CONFIG.DOM_IDS.ICONE_TESTE);
        if (existente) return;

        const divWrapper = document.createElement('div');
        divWrapper.id = CONFIG.DOM_IDS.ICONE_TESTE;
        const iconeContainer = this._criarIconeBase('fallback-inner-icon', '28px');

        Object.assign(divWrapper.style, {
          position: 'fixed', top: '20px', right: '20px', zIndex: '999999',
          cursor: 'pointer', background: '#fff',
          borderRadius: '50%', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          border: '1px solid #d4dfe3',
          width: '50px', height: '50px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', transition: 'box-shadow 0.18s, transform 0.18s'
        });

        divWrapper.addEventListener('mouseenter', () => { divWrapper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'; divWrapper.style.transform = 'scale(1.08)'; });
        divWrapper.addEventListener('mouseleave', () => { divWrapper.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'; divWrapper.style.transform = 'scale(1)'; });

        divWrapper.appendChild(iconeContainer);
        document.body.appendChild(divWrapper);
      }, 3000);
    }
  }


  class DOMObserver {
    constructor(uiManager) {
      this.ui = uiManager;
      this.lastHtml = '';
    }

    iniciar() {
      const observer = new MutationObserver((mutations) => {
        let changed = false;
        for (const m of mutations) {
          if (m.addedNodes.length > 0) changed = true;
        }
        if (changed) {
          this.ui.injetarIcones();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setInterval(() => this.verificarGradeDias(), 1500);
      setInterval(() => this.injetarTimersNaSidebar(), 1000);
      setInterval(() => this.verificarTMA(), 30000);
    }

    injetarTimersNaSidebar() {
      const talkButtons = document.querySelectorAll('.talk-button');
      if (!talkButtons.length) return;
      const timer = this.ui.timer;

      talkButtons.forEach(btn => {
        const nameEl = btn.querySelector('.talk-customer-name');
        if (!nameEl) return;
        const clientName = nameEl.textContent.trim();
        const pullLeft = btn.querySelector('.pull-left.align-left'); // Assuming this is the correct container

        // Ensure relative positioning on the button so absolute children (avatar icons) map correctly
        if (btn.style.position !== 'relative') btn.style.position = 'relative';

        let alertIcon = btn.querySelector('.ce-alert-icon');

        // Lógica do Timer Ativo
        if (timer.timers[clientName]) {
          btn.classList.add('ce-timer-active-button');
          btn.classList.remove('ce-timer-completed-button');

          if (!alertIcon) {
            alertIcon = document.createElement('div');
            alertIcon.className = 'ce-alert-icon';
            alertIcon.textContent = '⏱️'; // Relógio para indicar timer ativo (usado emoji isolado por ser ícone flutuante)
            alertIcon.style.fontSize = '12px';
            btn.appendChild(alertIcon);
          } else {
            alertIcon.textContent = '⏱️';
          }

          // Restaura o texto do cronômetro ao lado da Urgência
          const t = timer.timers[clientName];
          const novaClasse = `ce-timer-active ce-timer-badge ${t.critico ? 'critical' : 'active'}`;
          const novoTexto = t.texto || '...';

          let badgeLeft = pullLeft.querySelector('.ce-timer-active');
          if (!badgeLeft) {
            badgeLeft = document.createElement('span');
            badgeLeft.className = novaClasse;
            // Ensures inline flow next to the Priority badge without wrapping
            badgeLeft.style.cssText = 'margin-left: 6px; display: inline-block; vertical-align: middle; font-size: 10px; padding: 2px 4px;';
            badgeLeft.textContent = novoTexto;
            pullLeft.appendChild(badgeLeft);
          } else {
            if (badgeLeft.className !== novaClasse) badgeLeft.className = novaClasse;
            if (badgeLeft.textContent !== novoTexto) badgeLeft.textContent = novoTexto;
          }
        }
        // Lógica do Alarme Excedido
        else if (timer.completedTimers[clientName] && !timer.completedTimers[clientName].viewed) {
          btn.classList.remove('ce-timer-active-button');
          btn.classList.add('ce-timer-completed-button');

          let badgeLeft = pullLeft.querySelector('.ce-timer-active');
          if (badgeLeft) badgeLeft.remove();

          if (!alertIcon) {
            alertIcon = document.createElement('div');
            alertIcon.className = 'ce-alert-icon';
            alertIcon.textContent = '⚠️';
            alertIcon.title = 'Tempo Esgotado! Clique no aviso para ocultar.';
            alertIcon.style.cursor = 'pointer';
            alertIcon.addEventListener('click', (e) => {
              e.stopPropagation();
              timer.marcarVisualizado(clientName);
              btn.classList.remove('ce-timer-completed-button');
              alertIcon.remove();
            });
            btn.appendChild(alertIcon);
          } else {
            alertIcon.textContent = '⚠️';
            alertIcon.style.cursor = 'pointer';
            alertIcon.onclick = (e) => {
              e.stopPropagation();
              timer.marcarVisualizado(clientName);
              btn.classList.remove('ce-timer-completed-button');
              alertIcon.remove();
            };
          }
        }
        // Sem timer
        else {
          btn.classList.remove('ce-timer-active-button', 'ce-timer-completed-button');
          if (alertIcon) alertIcon.remove();
          let badgeLeft = pullLeft.querySelector('.ce-timer-active');
          if (badgeLeft) badgeLeft.remove();
        }

        // --- TMA: Borda animada rotativa via overlay (sem alterar layout) ---
        if (this.ui.tma) {
          const statusTMA = this.ui.tma.obterStatus(clientName);
          let overlay = btn.querySelector('.ce-tma-border-overlay');

          if (statusTMA.critico || statusTMA.alertar) {
            if (!overlay) {
              overlay = document.createElement('div');
              overlay.className = 'ce-tma-border-overlay';
              const spinner = document.createElement('div');
              spinner.className = 'ce-tma-border-spinner';
              overlay.appendChild(spinner);
              btn.appendChild(overlay);
            }
            const spinner = overlay.querySelector('.ce-tma-border-spinner');
            spinner.classList.remove('warning', 'critical');
            spinner.classList.add(statusTMA.critico ? 'critical' : 'warning');
          } else {
            if (overlay) overlay.remove();
          }
        }
      });
    }

    verificarTMA() {
      if (!this.ui.tma) return;

      // Escanear sidebar e registrar todos os clientes visíveis
      const talkButtons = document.querySelectorAll('.talk-button');
      const sidebarClients = new Set();

      talkButtons.forEach(btn => {
        const nameEl = btn.querySelector('.talk-customer-name');
        if (!nameEl) return;
        const clientName = nameEl.textContent.trim();
        if (!clientName || clientName === 'Desconhecido') return;
        sidebarClients.add(clientName);

        // Usar datetime da sidebar como fallback para registro inicial
        const timeEl = btn.querySelector('.align-right.smaller-80');
        let sidebarTs = null;
        if (timeEl) {
          sidebarTs = this.ui.tma._parseDataPipeRun(timeEl.textContent.trim());
        }
        this.ui.tma.registrarOuAtualizar(clientName, null, sidebarTs);
      });

      // Registrar TMA para o cliente atualmente aberto (com timestamp preciso da msg de transferência)
      const talkPanel = document.getElementById('talk-panel');
      if (talkPanel) {
        const nomeEl = document.querySelector('.talk-customer-name-header');
        if (nomeEl) {
          const nome = nomeEl.textContent.trim();
          this.ui.tma.registrarOuAtualizar(nome, talkPanel);
        }
      }

      // Limpar clientes que saíram da sidebar
      this.ui.tma.limparClientesAusentes(sidebarClients);

      // Verificar alertas globais de TMA
      this.ui.tma.verificarAlertaGlobal();
    }

    verificarGradeDias() {
      const grid = document.querySelector('div.rt-table, .rt-table');
      if (!grid) return;
      const html = grid.innerHTML;
      if (html === this.lastHtml) return;
      this.lastHtml = html;
      this._processarTextoDiasGrade();
    }

    _processarTextoDiasGrade() {
      const colunas = document.querySelectorAll('div.rt-td');
      colunas.forEach(coluna => {
        coluna.style.whiteSpace = 'normal';
        coluna.style.wordBreak = 'break-word';
      });

      const ps = document.querySelectorAll('p.MuiTypography-body2');
      ps.forEach(p => {
        const texto = p.textContent.trim();
        const match = texto.match(/^há\s*(\d+)\s*dias$/);
        if (match && match[1]) {
          const dias = parseInt(match[1], 10);
          p.textContent = `há ${this._converterDiasEmAnoEMes(dias)}`;
        }
      });
    }

    _converterDiasEmAnoEMes(dias) {
      const anos = Math.floor(dias / 365);
      const meses = Math.floor((dias % 365) / 30);
      let partes = [];
      if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
      if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
      if (partes.length === 0) return dias === 1 ? '1 dia' : `${dias} dias`;
      return partes.join(' e ');
    }
  }

  // --- Inicialização Core ---

  class ClickEnterExtension {
    constructor() {
      this.storage = new StorageManager();
      this.timer = new TimerModule();
      this.tma = new TMAModule(this.storage);
      this.ai = new AIModule();
      this.ui = new UIManager(this.storage, this.timer, this.ai, this.tma);
      this.observer = new DOMObserver(this.ui);
    }

    boot() {
      this.ui.construirPainel();
      this.ui.injetarIcones();
      this.observer.iniciar();
    }
  }

  // Bootstrap do aplicativo
  const app = new ClickEnterExtension();
  app.boot();

})();
