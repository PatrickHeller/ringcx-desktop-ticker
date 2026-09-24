'use strict';

const settingsForm = document.getElementById('settings-form');
const settingsCancel = document.getElementById('settings-cancel');

async function loadIntoForm() {
  const cfg = await window.ringcx.getConfig();
  for (const [key, value] of Object.entries(cfg)) {
    const field = settingsForm.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = !!value;
    else field.value = value ?? '';
  }
}

settingsCancel.addEventListener('click', () => window.ringcx.closeSettingsWindow());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.ringcx.closeSettingsWindow();
});

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  const cfg = Object.fromEntries(formData.entries());
  cfg.BORDERLESS = settingsForm.elements.namedItem('BORDERLESS').checked;
  cfg.ALWAYS_ON_TOP = settingsForm.elements.namedItem('ALWAYS_ON_TOP').checked;
  cfg.SHOW_QUEUES = settingsForm.elements.namedItem('SHOW_QUEUES').checked;
  cfg.SHOW_AGENTS = settingsForm.elements.namedItem('SHOW_AGENTS').checked;
  await window.ringcx.saveConfig(cfg);
  window.ringcx.closeSettingsWindow();
});

loadIntoForm();
