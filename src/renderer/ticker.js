'use strict';

const queueSection = document.getElementById('queue-section');
const agentSection = document.getElementById('agent-section');
const connState = document.getElementById('conn-state');
const lastUpdateEl = document.getElementById('last-update');
const errorBanner = document.getElementById('error-banner');

const settingsBtn = document.getElementById('settings-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');

let scrollSpeed = 70;
let queueFilter = [];
let agentFilter = [];
let lastPayload = null;
let kpiConfig = {
  queue: {
    OFFERED: true, CALLS: true, ABN: true, DISCONNECT: true, QUEUED: true,
    TOTAL_TALK: true, AVG_TALK: true, TOTAL_QUEUE: true, AVG_QUEUE: true, LONGEST_WAIT: true,
  },
  agent: { ACD: true, RNA: true, TALK: true, STATUS: true },
};

// Steuert einen Ticker-Track per requestAnimationFrame statt CSS-Animation,
// damit er per Maus/Touch gegriffen und geschoben werden kann. Der Inhalt
// wird doppelt gerendert; der Offset wird immer auf (-singleWidth, 0]
// normalisiert, sodass der Übergang nahtlos bleibt, egal in welche
// Richtung gezogen wird.
class Ticker {
  constructor(viewportEl, trackEl) {
    this.viewportEl = viewportEl;
    this.trackEl = trackEl;
    this.offset = 0;
    this.singleWidth = 0;
    this.dragging = false;
    this.dragMoved = false;
    this.startX = 0;
    this.startOffset = 0;

    viewportEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    viewportEl.addEventListener('pointermove', (e) => this.onPointerMove(e));
    viewportEl.addEventListener('pointerup', (e) => this.onPointerUp(e));
    viewportEl.addEventListener('pointercancel', (e) => this.onPointerUp(e));
  }

  normalize(offset) {
    if (this.singleWidth <= 0) return 0;
    let o = offset % this.singleWidth;
    if (o > 0) o -= this.singleWidth;
    return o;
  }

  render(items, itemHtmlFn) {
    if (!items || items.length === 0) {
      this.singleWidth = 0;
      this.offset = 0;
      this.trackEl.style.transform = 'translateX(0)';
      this.trackEl.innerHTML = '<div class="ticker-item"><span class="ti-name">Keine Daten</span></div>';
      return;
    }
    const html = items.map(itemHtmlFn).join('');
    this.trackEl.innerHTML = html + html;
    this.singleWidth = this.trackEl.scrollWidth / 2;
    this.offset = this.normalize(this.offset);
  }

  tick(deltaSeconds) {
    if (!this.dragging && this.singleWidth > 0) {
      this.offset = this.normalize(this.offset - scrollSpeed * deltaSeconds);
    }
    this.trackEl.style.transform = `translateX(${this.offset}px)`;
  }

  onPointerDown(e) {
    if (this.singleWidth <= 0) return;
    this.dragging = true;
    this.dragMoved = false;
    this.startX = e.clientX;
    this.startOffset = this.offset;
    this.viewportEl.setPointerCapture(e.pointerId);
    this.viewportEl.classList.add('dragging');
  }

  onPointerMove(e) {
    if (!this.dragging) return;
    const dx = e.clientX - this.startX;
    if (Math.abs(dx) > 3) this.dragMoved = true;
    this.offset = this.normalize(this.startOffset + dx);
  }

  onPointerUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this.viewportEl.classList.remove('dragging');
    try { this.viewportEl.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
}

const queueTicker = new Ticker(document.getElementById('queue-viewport'), document.getElementById('queue-track'));
const agentTicker = new Ticker(document.getElementById('agent-viewport'), document.getElementById('agent-track'));

let lastFrameTime = null;
function animationLoop(now) {
  if (lastFrameTime !== null) {
    const deltaSeconds = Math.min(0.25, (now - lastFrameTime) / 1000);
    queueTicker.tick(deltaSeconds);
    agentTicker.tick(deltaSeconds);
  }
  lastFrameTime = now;
  requestAnimationFrame(animationLoop);
}
requestAnimationFrame(animationLoop);

function formatDuration(totalSeconds) {
  const s = Math.max(0, parseInt(totalSeconds, 10) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function stateClass(state) {
  const s = String(state).toUpperCase();
  if (s.includes('OPEN') || s.includes('AVAILABLE') || s.includes('VERFÜGBAR')) return 'open';
  if (s.includes('NICHT ANGEMELDET') || s.includes('OFFLINE') || s.includes('LOGGED OUT')) return 'offline';
  if (s.includes('CLOSED')) return 'closed';
  return 'busy';
}

function queueItemHtml(row) {
  const cls = stateClass(row.state);
  const queuedCls = row.queued > 0 ? 'queued-alert' : '';
  const arrow = row.queued > 0
    ? '<span class="ti-arrow up">▲</span>'
    : '<span class="ti-arrow down">▼</span>';
  const k = kpiConfig.queue;
  const metrics = [];
  if (k.OFFERED) metrics.push(`<span>OFF <b>${row.offered}</b></span>`);
  if (k.CALLS) metrics.push(`<span>CALLS <b>${row.calls}</b></span>`);
  if (k.ABN) metrics.push(`<span>ABN <b>${row.abn}</b></span>`);
  if (k.DISCONNECT) metrics.push(`<span>DISC <b>${row.disconnect}</b></span>`);
  if (k.QUEUED) metrics.push(`<span>QUEUED <b class="${queuedCls}">${row.queued}</b></span>`);
  if (k.TOTAL_TALK) metrics.push(`<span>TOTAL TALK <b>${formatDuration(row.talk)}</b></span>`);
  if (k.AVG_TALK) metrics.push(`<span>Ø TALK <b>${formatDuration(row.avg)}</b></span>`);
  if (k.TOTAL_QUEUE) metrics.push(`<span>TOTAL QUEUE <b>${formatDuration(row.wait)}</b></span>`);
  if (k.AVG_QUEUE) metrics.push(`<span>Ø QUEUE <b>${formatDuration(row.avgQueue)}</b></span>`);
  if (k.LONGEST_WAIT) metrics.push(`<span>LONGEST WAIT <b>${formatDuration(row.lngQueue)}</b></span>`);
  return `
    <div class="ticker-item">
      ${arrow}
      <span class="ti-name">${escapeHtml(row.name)}</span>
      <span class="ti-state ${cls}">${escapeHtml(row.state)}</span>
      <span class="ti-metrics">${metrics.join('')}</span>
    </div>`;
}

function agentItemHtml(agent) {
  const cls = stateClass(agent.state);
  const k = kpiConfig.agent;
  const metrics = [];
  if (k.ACD) metrics.push(`<span>ACD <b>${escapeHtml(String(agent.acd))}</b></span>`);
  if (k.RNA) metrics.push(`<span>RONA <b>${escapeHtml(String(agent.rna))}</b></span>`);
  if (k.TALK) metrics.push(`<span>TALK <b>${formatDuration(agent.agn_talk_time)}</b></span>`);
  if (k.STATUS) metrics.push(`<span>STATUS <b>${formatDuration(agent.statusTime)}</b></span>`);
  return `
    <div class="ticker-item">
      <span class="ti-name">${escapeHtml(agent.name)}</span>
      <span class="ti-state ${cls}">${escapeHtml(agent.state)}</span>
      <span class="ti-metrics">${metrics.join('')}</span>
    </div>`;
}

function renderTickers() {
  if (!lastPayload) return;
  const queues = queueFilter.length === 0
    ? lastPayload.queues
    : lastPayload.queues.filter((q) => queueFilter.includes(q.name));
  const agents = agentFilter.length === 0
    ? lastPayload.agents
    : lastPayload.agents.filter((a) => agentFilter.includes(a.name));
  queueTicker.render(queues, queueItemHtml);
  agentTicker.render(agents, agentItemHtml);
}

function setConnectionState(state, label) {
  connState.className = `conn-state conn-${state}`;
  connState.textContent = label;
}

function showError(message) {
  errorBanner.hidden = false;
  errorBanner.textContent = message;
}

function clearError() {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

window.ringcx.onData((payload) => {
  clearError();
  setConnectionState('ok', 'verbunden');
  lastUpdateEl.textContent = new Date(payload.lastUpdate).toLocaleTimeString('de-DE');
  lastPayload = payload;
  renderTickers();
});

window.ringcx.onError((message) => {
  setConnectionState('error', 'Fehler');
  showError(message);
});

window.ringcx.onConfigUpdated((cfg) => {
  applyLocalConfig(cfg);
  setConnectionState('unknown', 'verbinde…');
});

function applyLocalConfig(cfg) {
  const parsedSpeed = parseInt(cfg.SCROLL_SPEED, 10);
  scrollSpeed = Number.isNaN(parsedSpeed) ? 70 : Math.max(0, parsedSpeed);
  const fontSize = Math.max(6, parseInt(cfg.FONT_SIZE, 10) || 15);
  document.documentElement.style.setProperty('--ticker-font-size', `${fontSize}px`);
  const borderless = !!cfg.BORDERLESS;
  minimizeBtn.hidden = !borderless;
  closeBtn.hidden = !borderless;
  queueSection.hidden = cfg.SHOW_QUEUES === false;
  agentSection.hidden = cfg.SHOW_AGENTS === false;

  kpiConfig = {
    queue: {
      OFFERED: cfg.KPI_QUEUE_OFFERED !== false,
      CALLS: cfg.KPI_QUEUE_CALLS !== false,
      ABN: cfg.KPI_QUEUE_ABN !== false,
      DISCONNECT: cfg.KPI_QUEUE_DISCONNECT !== false,
      QUEUED: cfg.KPI_QUEUE_QUEUED !== false,
      TOTAL_TALK: cfg.KPI_QUEUE_TOTAL_TALK !== false,
      AVG_TALK: cfg.KPI_QUEUE_AVG_TALK !== false,
      TOTAL_QUEUE: cfg.KPI_QUEUE_TOTAL_QUEUE !== false,
      AVG_QUEUE: cfg.KPI_QUEUE_AVG_QUEUE !== false,
      LONGEST_WAIT: cfg.KPI_QUEUE_LONGEST_WAIT !== false,
    },
    agent: {
      ACD: cfg.KPI_AGENT_ACD !== false,
      RNA: cfg.KPI_AGENT_RNA !== false,
      TALK: cfg.KPI_AGENT_TALK !== false,
      STATUS: cfg.KPI_AGENT_STATUS !== false,
    },
  };
  queueFilter = Array.isArray(cfg.QUEUE_FILTER) ? cfg.QUEUE_FILTER : [];
  agentFilter = Array.isArray(cfg.AGENT_FILTER) ? cfg.AGENT_FILTER : [];
  renderTickers();
}

settingsBtn.addEventListener('click', () => window.ringcx.openSettings());
minimizeBtn.addEventListener('click', () => window.ringcx.minimizeWindow());
closeBtn.addEventListener('click', () => window.ringcx.closeWindow());

// Passt die Fensterhöhe automatisch an den tatsächlich benötigten Platz an
// (Anzahl sichtbarer Zeilen, Fehlerbanner, Schriftgröße), statt fixer Höhe.
const appEl = document.querySelector('.app');
let heightSyncScheduled = false;
function syncWindowHeight() {
  if (heightSyncScheduled) return;
  heightSyncScheduled = true;
  requestAnimationFrame(() => {
    heightSyncScheduled = false;
    window.ringcx.setContentHeight(appEl.scrollHeight);
  });
}
new ResizeObserver(syncWindowHeight).observe(appEl);

(async () => {
  const cfg = await window.ringcx.getConfig();
  applyLocalConfig(cfg);
  const complete = await window.ringcx.isConfigComplete();
  if (!complete) window.ringcx.openSettings();
  const version = await window.ringcx.getVersion();
  document.getElementById('app-version').textContent = `v${version}`;
})();
