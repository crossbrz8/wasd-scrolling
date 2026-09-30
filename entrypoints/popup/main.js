import { browser } from 'wxt/browser';

// popup.js (WXT)

(async function () {
  const toggleEl = document.getElementById('toggle');
  const speedEl = document.getElementById('speed');
  const speedValEl = document.getElementById('speedVal');
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const keys = ['kW', 'kA', 'kS', 'kD'];

  async function getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function syncUI(on) {
    // Badge
    statusBadge.className = `badge ${on ? 'on' : 'off'}`;
    statusText.textContent = on ? 'on' : 'off';
    // Keys
    keys.forEach((id) => {
      document.getElementById(id).classList.toggle('active', on);
    });
  }

  async function loadState() {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      const resp = await browser.tabs.sendMessage(tab.id, { type: 'GET_STATE' });
      if (resp) {
        toggleEl.checked = resp.enabled;
        speedEl.value = resp.speed;
        speedValEl.textContent = `${resp.speed} px/f`;
        syncUI(resp.enabled);
      }
    } catch {
      /* extension inactive on this page */
    }
  }

  toggleEl.addEventListener('change', async () => {
    syncUI(toggleEl.checked);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      await browser.tabs.sendMessage(tab.id, { type: 'SET_ENABLED', value: toggleEl.checked });
    } catch {}
  });

  speedEl.addEventListener('input', async () => {
    const val = parseFloat(speedEl.value);
    speedValEl.textContent = `${val} px/f`;
    try {
      const tab = await getActiveTab();
      if (!tab?.id) return;
      await browser.tabs.sendMessage(tab.id, { type: 'SET_SPEED', value: val });
    } catch {}
  });

  await loadState();
})();
