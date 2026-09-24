'use strict';

const settingsForm = document.getElementById('settings-form');
const settingsCancel = document.getElementById('settings-cancel');
const queueFilterList = document.getElementById('queue-filter-list');
const agentFilterList = document.getElementById('agent-filter-list');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderFilterList(container, groupName, names, selected) {
  if (!names || names.length === 0) return;
  const isFiltered = Array.isArray(selected) && selected.length > 0;
  container.innerHTML = names.map((name) => {
    const checked = !isFiltered || selected.includes(name);
    return `
      <label class="checkbox-row">
        <input type="checkbox" class="filter-checkbox" name="${groupName}" value="${escapeHtml(name)}" ${checked ? 'checked' : ''} />
        ${escapeHtml(name)}
      </label>`;
  }).join('');
}

async function loadIntoForm() {
  const cfg = await window.ringcx.getConfig();
  for (const [key, value] of Object.entries(cfg)) {
    const field = settingsForm.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value ?? '';
  }

  const [queueNames, agentNames] = await Promise.all([
    window.ringcx.getQueueNames(),
    window.ringcx.getAgentNames(),
  ]);
  renderFilterList(queueFilterList, 'QUEUE_FILTER_ITEM', queueNames, cfg.QUEUE_FILTER);
  renderFilterList(agentFilterList, 'AGENT_FILTER_ITEM', agentNames, cfg.AGENT_FILTER);
}

settingsCancel.addEventListener('click', () => window.ringcx.closeSettingsWindow());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.ringcx.closeSettingsWindow();
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  const cfg = Object.fromEntries(formData.entries());

  settingsForm.querySelectorAll('input[type="checkbox"]:not(.filter-checkbox)').forEach((el) => {
    cfg[el.name] = el.checked;
  });

  const allQueueBoxes = settingsForm.querySelectorAll('input[name="QUEUE_FILTER_ITEM"]');
  const checkedQueues = formData.getAll('QUEUE_FILTER_ITEM');
  cfg.QUEUE_FILTER = checkedQueues.length === allQueueBoxes.length ? [] : checkedQueues;

  const allAgentBoxes = settingsForm.querySelectorAll('input[name="AGENT_FILTER_ITEM"]');
  const checkedAgents = formData.getAll('AGENT_FILTER_ITEM');
  cfg.AGENT_FILTER = checkedAgents.length === allAgentBoxes.length ? [] : checkedAgents;

  delete cfg.QUEUE_FILTER_ITEM;
  delete cfg.AGENT_FILTER_ITEM;

  await window.ringcx.saveConfig(cfg);
  window.ringcx.closeSettingsWindow();
});

loadIntoForm();
