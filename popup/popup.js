/**
 * popup.js
 * Popup UI controller showing quick stats, a tracking toggle, and latest videos.
 * Communicates with background/service-worker via chrome.runtime messaging and
 * reads storage through helper requests instead of touching chrome.storage here.
 */

import {
  getHistory,
  getSettings,
  saveSettings,
  getTodayCount
} from '../utils/storage.js';

const MESSAGE_TYPES = {
  GENERATE_WEEKLY_REPORT: 'GENERATE_WEEKLY_REPORT'
};

const subscribeToStorage = () => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.videos) {
      loadHistory();
    }
    if (changes.settings) {
      loadSettings();
    }
  });
};

const state = {
  trackingEnabled: true,
  aiActive: false
};

const init = async () => {
  await loadSettings();
  await loadHistory();
  bindEvents();
  subscribeToStorage();
};

const loadSettings = async () => {
  try {
    const settings = await getSettings();
    state.trackingEnabled = !!settings.trackingEnabled;
    state.aiActive = Boolean(settings.aiFeaturesEnabled && settings.openRouterApiKey);
    updateToggle();
    updateAiStatus();
  } catch (error) {
    console.error('popup.loadSettings failed', error);
  }
};

const loadHistory = async () => {
  try {
    const history = await getHistory();
    const todayCount = await getTodayCount();
    renderRecent(history.slice(-5).reverse());
    document.getElementById('todayCount').textContent = todayCount;
    document.getElementById('recentCount').textContent = Math.min(history.length, 5);
  } catch (error) {
    console.error('popup.loadHistory failed', error);
  }
};

const bindEvents = () => {
  document.getElementById('openDashboard')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  document.getElementById('trackingToggle')?.addEventListener('click', async () => {
    state.trackingEnabled = !state.trackingEnabled;
    try {
      await saveSettings({ trackingEnabled: state.trackingEnabled });
      updateToggle();
    } catch (error) {
      console.error('popup.saveSettings failed', error);
    }
  });
};

const updateToggle = () => {
  const toggle = document.getElementById('trackingToggle');
  if (!toggle) return;
  toggle.classList.toggle('toggle--off', !state.trackingEnabled);
  toggle.setAttribute('aria-pressed', String(state.trackingEnabled));
  toggle.querySelector('.toggle__text').textContent = state.trackingEnabled ? 'On' : 'Off';
};

const updateAiStatus = () => {
  const aiStatus = document.getElementById('aiStatus');
  if (!aiStatus) return;
  aiStatus.textContent = state.aiActive ? 'AI Active ✓' : 'AI Off — Add key in settings';
  aiStatus.style.color = state.aiActive ? 'var(--success)' : 'var(--danger)';
};

const renderRecent = (videos) => {
  const list = document.getElementById('recentList');
  if (!list) return;
  list.textContent = '';
  videos.forEach((video) => {
    const li = document.createElement('li');
    li.className = 'recent__item';
    li.innerHTML = `
      <img src="${video.thumbnail}" alt="${video.title}" class="recent__thumb" />
      <div class="recent__meta">
        <p class="recent__title">${video.title}</p>
        <p class="recent__channel">${video.channelName} · ${video.watchPercent}%</p>
        ${video.aiCategory ? `<span class="badge category-badge">${video.aiCategory}</span>` : ''}
      </div>
    `;
    list.appendChild(li);
  });
};

init();
