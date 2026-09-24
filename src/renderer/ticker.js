'use strict';

const queueSection = document.getElementById('queue-section');
const agentSection = document.getElementById('agent-section');
const queueTrack = document.getElementById('queue-track');
const agentTrack = document.getElementById('agent-track');
const connState = document.getElementById('conn-state');
const lastUpdateEl = document.getElementById('last-update');
const errorBanner = document.getElementById('error-banner');

const overlay = document.getElementById('settings-overlay');
const settingsForm = document.getElementById('settings-form');
const settingsBtn = document.getElementById('settings-btn');
const settingsCancel = document.getElementById('settings-cancel');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');

let scrollSpeed = 70;

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
  return `
    <div class="ticker-item">
      ${arrow}
      <span class="ti-name">${escapeHtml(row.name)}</span>
      <span class="ti-state ${cls}">${escapeHtml(row.state)}</span>
      <span class="ti-metrics">
        <span>OFF <b>${row.offered}</b></span>
        <span>CALLS <b>${row.calls}</b></span>
        <span>ABN <b>${row.abn}</b></span>
        <span>QUEUED <b class="${queuedCls}">${row.queued}</b></span>
        <span>Ø TALK <b>${formatDuration(row.avg)}</b></span>
        <span>LONGEST WAIT <b>${formatDuration(row.lngQueue)}</b></span>
      </span>
    </div>`;
}

function agentItemHtml(agent) {
  const cls = stateClass(agent.state);
  return `
    <div class="ticker-item">
      <span class="ti-name">${escapeHtml(agent.name)}</span>
      <span class="ti-state ${cls}">${escapeHtml(agent.state)}</span>
      <span class="ti-metrics">
        <span>ACD <b>${escapeHtml(String(agent.acd))}</b></span>
        <span>RONA <b>${escapeHtml(String(agent.rna))}</b></span>
        <span>TALK <b>${formatDuration(agent.agn_talk_time)}</b></span>
        <span>STATUS <b>${formatDuration(agent.statusTime)}</b></span>
      </span>
    </div>`;
}

function renderTrack(trackEl, items, itemHtmlFn) {
  if (!items || items.length === 0) {
    trackEl.style.animation = 'none';
    trackEl.innerHTML = '<div class="ticker-item"><span class="ti-name">Keine Daten</span></div>';
    return;
  }
  const html = items.map(itemHtmlFn).join('');
  // Inhalt doppelt rendern für nahtlose Endlos-Schleife (Animation läuft bis -50%)
  trackEl.innerHTML = html + html;

  const singleWidth = trackEl.scrollWidth / 2;
  const duration = Math.max(4, singleWidth / scrollSpeed);
  trackEl.style.animation = 'none';
  trackEl.style.setProperty('--scroll-duration', `${duration}s`);
  // Reflow erzwingen, damit die Animation mit neuer Dauer neu startet
  void trackEl.offsetWidth;
  trackEl.style.animation = '';
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
  renderTrack(queueTrack, payload.queues, queueItemHtml);
  renderTrack(agentTrack, payload.agents, agentItemHtml);
});

window.ringcx.onError((message) => {
  setConnectionState('error', 'Fehler');
  showError(message);
});

window.ringcx.onConfigMissing(() => {
  openSettings();
});

function applyLocalConfig(cfg) {
  scrollSpeed = Math.max(1, parseInt(cfg.SCROLL_SPEED, 10) || 70);
  const borderless = !!cfg.BORDERLESS;
  minimizeBtn.hidden = !borderless;
  closeBtn.hidden = !borderless;
  queueSection.hidden = cfg.SHOW_QUEUES === false;
  agentSection.hidden = cfg.SHOW_AGENTS === false;
}

async function openSettings() {
  const cfg = await window.ringcx.getConfig();
  for (const [key, value] of Object.entries(cfg)) {
    const field = settingsForm.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value ?? '';
  }
  overlay.hidden = false;
}

function closeSettings() {
  overlay.hidden = true;
}

settingsBtn.addEventListener('click', openSettings);
settingsCancel.addEventListener('click', closeSettings);
minimizeBtn.addEventListener('click', () => window.ringcx.minimizeWindow());
closeBtn.addEventListener('click', () => window.ringcx.closeWindow());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !overlay.hidden) closeSettings();
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  const cfg = Object.fromEntries(formData.entries());
  cfg.BORDERLESS = settingsForm.elements.namedItem('BORDERLESS').checked;
  cfg.ALWAYS_ON_TOP = settingsForm.elements.namedItem('ALWAYS_ON_TOP').checked;
  cfg.SHOW_QUEUES = settingsForm.elements.namedItem('SHOW_QUEUES').checked;
  cfg.SHOW_AGENTS = settingsForm.elements.namedItem('SHOW_AGENTS').checked;
  const saved = await window.ringcx.saveConfig(cfg);
  applyLocalConfig(saved);
  closeSettings();
  setConnectionState('unknown', 'verbinde…');
});

(async () => {
  const cfg = await window.ringcx.getConfig();
  applyLocalConfig(cfg);
  const complete = await window.ringcx.isConfigComplete();
  if (!complete) openSettings();
})();
