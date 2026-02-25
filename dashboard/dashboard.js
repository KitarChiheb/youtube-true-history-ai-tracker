/**
 * dashboard.js
 * Drives the full-dashboard experience: filters, stats, AI sidebar/panel,
 * settings management, import/export, and report generation. Talks to storage
 * helpers for persistence and message-passes to the service worker for AI ops.
 */

import {
  getHistory,
  updateVideo,
  deleteVideo,
  getStats,
  getSettings,
  saveSettings,
  exportHistory,
  importHistory,
  getCachedReport,
  replaceHistory
} from '../utils/storage.js';
import {
  VIDEO_CATEGORIES,
  CATEGORY_COLOR_MAP,
  formatDuration,
  formatDate,
  formatPercent,
  calculateTopChannels,
  calculateCategoryBreakdown,
  calculateDailyActivity,
  buildCsv,
  searchVideos,
  sortVideos,
  filterByDateRange,
  toHoursMinutes
} from '../utils/helpers.js';

const MESSAGE_TYPES = {
  GENERATE_WEEKLY_REPORT: 'GENERATE_WEEKLY_REPORT',
  CATEGORIZE_PENDING: 'CATEGORIZE_PENDING'
};

const FORM_DEFAULTS = {
  minWatchPercent: 40,
  minWatchTimeSeconds: 300,
  trackAutoplay: true,
  countHiddenTime: true,
  dataRetention: 'all',
  aiFeaturesEnabled: true,
  openRouterApiKey: '',
  trackingEnabled: true
};

const RETENTION_OPTIONS = new Set(['all', '3m', '6m', '1y']);

const clampNumber = (value, min, max, fallback) => {
  if (Number.isFinite(value) && value >= min && value <= max) {
    return value;
  }
  return fallback;
};

const ensureSeconds = (value, fallback) => {
  if (Number.isFinite(value) && value >= 60) {
    return value;
  }
  return fallback;
};

const parseBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const sanitizeSettings = (input = {}, base = FORM_DEFAULTS) => {
  const fallback = {
    minWatchPercent: clampNumber(base.minWatchPercent, 10, 80, FORM_DEFAULTS.minWatchPercent),
    minWatchTimeSeconds: ensureSeconds(base.minWatchTimeSeconds, FORM_DEFAULTS.minWatchTimeSeconds),
    trackAutoplay: parseBoolean(base.trackAutoplay, FORM_DEFAULTS.trackAutoplay),
    countHiddenTime: parseBoolean(base.countHiddenTime, FORM_DEFAULTS.countHiddenTime),
    dataRetention: RETENTION_OPTIONS.has(base.dataRetention) ? base.dataRetention : FORM_DEFAULTS.dataRetention,
    aiFeaturesEnabled: parseBoolean(base.aiFeaturesEnabled, FORM_DEFAULTS.aiFeaturesEnabled),
    openRouterApiKey: typeof base.openRouterApiKey === 'string' ? base.openRouterApiKey : FORM_DEFAULTS.openRouterApiKey,
    trackingEnabled: parseBoolean(base.trackingEnabled, FORM_DEFAULTS.trackingEnabled)
  };

  return {
    ...base,
    minWatchPercent: clampNumber(Number(input.minWatchPercent), 10, 80, fallback.minWatchPercent),
    minWatchTimeSeconds: ensureSeconds(Number(input.minWatchTimeSeconds), fallback.minWatchTimeSeconds),
    trackAutoplay: parseBoolean(input.trackAutoplay, fallback.trackAutoplay),
    countHiddenTime: parseBoolean(input.countHiddenTime, fallback.countHiddenTime),
    dataRetention: RETENTION_OPTIONS.has(input.dataRetention) ? input.dataRetention : fallback.dataRetention,
    aiFeaturesEnabled: parseBoolean(input.aiFeaturesEnabled, fallback.aiFeaturesEnabled),
    openRouterApiKey: typeof input.openRouterApiKey === 'string' ? input.openRouterApiKey.trim() : fallback.openRouterApiKey,
    trackingEnabled: parseBoolean(input.trackingEnabled, fallback.trackingEnabled)
  };
};

const areSettingsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const refreshHistoryFromStorage = async () => {
  try {
    const history = await getHistory();
    state.history = history;
    applyFilters();
    renderAll();
  } catch (error) {
    console.error('dashboard.refreshHistoryFromStorage failed', error);
  }
};

const refreshSettingsFromStorage = async () => {
  try {
    const storedSettings = await getSettings();
    state.settings = sanitizeSettings(storedSettings, FORM_DEFAULTS);
    populateSettingsForm();
  } catch (error) {
    console.error('dashboard.refreshSettingsFromStorage failed', error);
  }
};

const subscribeToStorage = () => {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.videos) {
      refreshHistoryFromStorage();
    }
    if (changes.settings) {
      refreshSettingsFromStorage();
    }
    if (changes.reportCache) {
      loadReportCache();
    }
  });
};

const state = {
  history: [],
  filtered: [],
  settings: {},
  filters: {
    search: '',
    channel: 'all',
    category: 'all',
    dateStart: '',
    dateEnd: '',
    minPercent: 0,
    showAutoplay: true,
    showUncategorized: true,
    sort: 'recent'
  },
  report: null,
  reportLoading: false
};

const init = async () => {
  await loadInitialData();
  initFilters();
  bindEvents();
  renderAll();
  await loadReportCache();
  subscribeToStorage();
};

const loadInitialData = async () => {
  try {
    const [history, storedSettings] = await Promise.all([getHistory(), getSettings()]);
    state.history = history;
    const sanitizedSettings = sanitizeSettings(storedSettings, FORM_DEFAULTS);
    if (!areSettingsEqual(sanitizedSettings, storedSettings)) {
      await saveSettings(sanitizedSettings);
    }
    state.settings = sanitizedSettings;
    applyFilters();
    populateSettingsForm();
  } catch (error) {
    console.error('dashboard.loadInitialData failed', error);
  }
};

const initFilters = () => {
  populateChannelFilter();
  populateCategoryFilter();
  document.getElementById('percentSlider').value = state.filters.minPercent;
  document.getElementById('percentValue').textContent = `${state.filters.minPercent}%`;
};

const populateChannelFilter = () => {
  const select = document.getElementById('channelFilter');
  if (!select) return;
  const channels = Array.from(new Set(state.history.map((video) => video.channelName || 'Unknown'))).sort();
  select.innerHTML = '<option value="all">All channels</option>' + channels.map((channel) => `<option value="${channel}">${channel}</option>`).join('');
};

const populateCategoryFilter = () => {
  const select = document.getElementById('categoryFilter');
  if (!select) return;
  select.innerHTML = '<option value="all">All categories</option>' + VIDEO_CATEGORIES.map((category) => `<option value="${category}">${category}</option>`).join('');
};

const bindEvents = () => {
  document.getElementById('searchInput')?.addEventListener('input', (event) => {
    state.filters.search = event.target.value;
    refreshHistory();
  });

  document.getElementById('channelFilter')?.addEventListener('change', (event) => {
    state.filters.channel = event.target.value;
    refreshHistory();
  });

  document.getElementById('categoryFilter')?.addEventListener('change', (event) => {
    state.filters.category = event.target.value;
    refreshHistory();
  });

  document.getElementById('dateStart')?.addEventListener('change', (event) => {
    state.filters.dateStart = event.target.value;
    refreshHistory();
  });

  document.getElementById('dateEnd')?.addEventListener('change', (event) => {
    state.filters.dateEnd = event.target.value;
    refreshHistory();
  });

  document.getElementById('percentSlider')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    state.filters.minPercent = value;
    document.getElementById('percentValue').textContent = `${value}%`;
    refreshHistory();
  });

  document.getElementById('toggleAutoplay')?.addEventListener('change', (event) => {
    state.filters.showAutoplay = event.target.checked;
    refreshHistory();
  });

  document.getElementById('toggleUncategorized')?.addEventListener('change', (event) => {
    state.filters.showUncategorized = event.target.checked;
    refreshHistory();
  });

  document.getElementById('sortSelect')?.addEventListener('change', (event) => {
    state.filters.sort = event.target.value;
    refreshHistory();
  });

  document.getElementById('categorizePending')?.addEventListener('click', async () => {
    await handleCategorizePending();
  });

  document.getElementById('generateReport')?.addEventListener('click', () => handleGenerateReport(false));
  document.getElementById('regenerateReport')?.addEventListener('click', () => handleGenerateReport(true));
  document.getElementById('closeReport')?.addEventListener('click', () => toggleReportPanel(false));

  document.getElementById('exportJson')?.addEventListener('click', exportJson);
  document.getElementById('exportCsv')?.addEventListener('click', exportCsv);
  document.getElementById('importInput')?.addEventListener('change', handleImport);

  document.getElementById('videoGrid')?.addEventListener('click', handleVideoGridClick);
  document.getElementById('categorySidebar')?.addEventListener('click', handleCategorySidebarClick);

  document.getElementById('settingsForm')?.addEventListener('submit', handleSettingsSubmit);
  document.getElementById('toggleKey')?.addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('testApiKey')?.addEventListener('click', testApiKeyConnection);
  document.getElementById('clearData')?.addEventListener('click', handleClearData);
};

const handleVideoGridClick = (event) => {
  const { target } = event;
  const card = target.closest('[data-video-id]');
  if (!card) return;
  const videoId = card.dataset.videoId;
  if (target.matches('[data-action="delete"]')) {
    deleteVideoEntry(videoId);
    return;
  }
  if (target.matches('[data-action="rewatch"]')) {
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
  }
};

const handleCategorySidebarClick = (event) => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  const category = button.dataset.category;
  state.filters.category = category === 'all' ? 'all' : category;
  const categorySelect = document.getElementById('categoryFilter');
  if (categorySelect) {
    categorySelect.value = state.filters.category;
  }
  refreshHistory();
};

const handleCategorizePending = async () => {
  try {
    setButtonLoading('categorizePending', true, 'Categorizing…');
    const response = await sendMessage({ type: MESSAGE_TYPES.CATEGORIZE_PENDING });
    const queued = response?.data?.queued ?? 0;
    showToast(`Queued ${queued} video(s) for categorization.`);
  } catch (error) {
    console.error('categorizePending failed', error);
    showToast('Unable to queue categorization. Check console.', true);
  } finally {
    setButtonLoading('categorizePending', false);
  }
};

const handleGenerateReport = async (force) => {
  if (state.reportLoading) return;
  state.reportLoading = true;
  setButtonLoading('generateReport', true, 'Analyzing…');
  setButtonLoading('regenerateReport', true, 'Analyzing…');
  try {
    if (!force && state.report) {
      toggleReportPanel(true);
      return;
    }
    const response = await sendMessage({ type: MESSAGE_TYPES.GENERATE_WEEKLY_REPORT });
    if (!response?.success) {
      throw new Error(response?.error || 'Failed to generate report');
    }
    state.report = response.data;
    renderReportPanel();
    toggleReportPanel(true);
  } catch (error) {
    console.error('generateReport failed', error);
    showToast(error.message || 'Report failed', true);
  } finally {
    state.reportLoading = false;
    setButtonLoading('generateReport', false);
    setButtonLoading('regenerateReport', false);
  }
};

const handleSettingsSubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const minutes = Number(formData.get('settingWatchMinutes'));
  const rawSettings = {
    minWatchPercent: Number(formData.get('settingWatchPercent')),
    minWatchTimeSeconds: Number.isFinite(minutes) ? minutes * 60 : NaN,
    trackAutoplay: formData.get('settingTrackAutoplay'),
    countHiddenTime: formData.get('settingHiddenTime'),
    dataRetention: formData.get('settingRetention'),
    aiFeaturesEnabled: formData.get('settingAiEnabled'),
    openRouterApiKey: formData.get('settingApiKey'),
    trackingEnabled: state.settings.trackingEnabled
  };
  try {
    const sanitized = sanitizeSettings(rawSettings, state.settings);
    await saveSettings(sanitized);
    state.settings = sanitized;
    populateSettingsForm();
    showToast('Settings saved.');
  } catch (error) {
    console.error('saveSettings failed', error);
    showToast('Failed to save settings', true);
  }
};

const toggleApiKeyVisibility = () => {
  const input = document.getElementById('settingApiKey');
  const button = document.getElementById('toggleKey');
  if (!input || !button) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  button.textContent = isPassword ? 'Hide' : 'Show';
};

const testApiKeyConnection = async () => {
  try {
    setButtonLoading('testApiKey', true, 'Testing…');
    const key = document.getElementById('settingApiKey').value.trim();
    if (!key) {
      showToast('Enter a key first.', true);
      return;
    }
    const response = await sendMessage({
      type: 'TEST_API_KEY',
      apiKey: key
    });
    if (response?.success && response.data) {
      showToast('Key works!');
    } else {
      const errorMessage = response?.error ? `Key test failed: ${response.error}` : 'Key test failed. Check console.';
      showToast(errorMessage, true);
    }
  } catch (error) {
    console.error('testApiKeyConnection failed', error);
    showToast('Key test errored', true);
  } finally {
    setButtonLoading('testApiKey', false);
  }
};

const handleClearData = async () => {
  if (!confirm('This deletes all stored history and reports. Continue?')) return;
  try {
    await replaceHistory([]);
    state.history = [];
    refreshHistory();
    showToast('Data cleared.');
  } catch (error) {
    console.error('clearData failed', error);
    showToast('Failed to clear data', true);
  }
};

const handleImport = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    await importHistory(parsed);
    await loadInitialData();
    renderAll();
    showToast('Import complete.');
  } catch (error) {
    console.error('import failed', error);
    showToast('Import failed. Ensure JSON is valid.', true);
  } finally {
    event.target.value = '';
  }
};

const exportJson = async () => {
  const data = await exportHistory();
  downloadFile(JSON.stringify(data, null, 2), 'yt-true-history.json', 'application/json');
};

const exportCsv = async () => {
  const data = await exportHistory();
  const csv = buildCsv(data, ['videoId', 'title', 'channelName', 'watchedAt', 'watchedDuration', 'totalDuration', 'watchPercent', 'aiCategory']);
  downloadFile(csv, 'yt-true-history.csv', 'text/csv');
};

const downloadFile = (content, filename, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const deleteVideoEntry = async (videoId) => {
  try {
    await deleteVideo(videoId);
    state.history = state.history.filter((video) => video.videoId !== videoId);
    refreshHistory();
    showToast('Video removed.');
  } catch (error) {
    console.error('deleteVideoEntry failed', error);
    showToast('Unable to delete video.', true);
  }
};

const refreshHistory = () => {
  applyFilters();
  renderHistory();
  renderCategorySidebar();
  renderStats();
};

const applyFilters = () => {
  const { filters } = state;
  let videos = [...state.history];
  if (!filters.showAutoplay) {
    videos = videos.filter((video) => !video.autoplay);
  }
  if (!filters.showUncategorized) {
    videos = videos.filter((video) => video.aiCategory && video.aiCategory !== 'Uncategorized');
  }
  videos = filterByDateRange(videos, filters.dateStart, filters.dateEnd);
  if (filters.channel !== 'all') {
    videos = videos.filter((video) => (video.channelName || 'Unknown') === filters.channel);
  }
  if (filters.category !== 'all') {
    videos = videos.filter((video) => (video.aiCategory || 'Uncategorized') === filters.category);
  }
  if (filters.minPercent > 0) {
    videos = videos.filter((video) => (video.watchPercent || 0) >= filters.minPercent);
  }
  videos = searchVideos(videos, filters.search);
  state.filtered = sortVideos(videos, filters.sort);
};

const renderAll = () => {
  renderHistory();
  renderCategorySidebar();
  renderStats();
};

const renderHistory = () => {
  const grid = document.getElementById('videoGrid');
  const count = document.getElementById('historyCount');
  if (!grid || !count) return;
  grid.textContent = '';
  if (!state.filtered.length) {
    grid.innerHTML = '<p class="empty">No videos match your filters.</p>';
  } else {
    const fragment = document.createDocumentFragment();
    state.filtered.forEach((video) => {
      fragment.appendChild(buildVideoCard(video));
    });
    grid.appendChild(fragment);
  }
  count.textContent = `${state.filtered.length} videos`;
};

const buildVideoCard = (video) => {
  const card = document.createElement('article');
  card.className = 'video-card';
  card.dataset.videoId = video.videoId;
  const category = video.aiCategory || 'Uncategorized';
  const color = CATEGORY_COLOR_MAP[category] || '#888';
  card.innerHTML = `
    <div class="video-card__thumb">
      <img src="${video.thumbnail}" alt="${video.title}" />
      <button class="video-card__watch" data-action="rewatch">Watch again</button>
      ${video.autoplay ? '<span class="badge badge--warning">Autoplay</span>' : ''}
      ${video.rewatchCount > 1 ? `<span class="badge badge--info">Rewatched ×${video.rewatchCount}</span>` : ''}
    </div>
    <div class="video-card__body">
      <div class="video-card__row">
        <h3>${video.title}</h3>
        <button class="icon-btn" data-action="delete" aria-label="Delete video">✕</button>
      </div>
      <p class="video-card__channel">${video.channelName || 'Unknown'} · ${formatDate(video.watchedAt)}</p>
      <div class="progress">
        <div class="progress__bar" style="width:${video.watchPercent}%"></div>
        <span>${formatPercent(video.watchPercent)}</span>
      </div>
      <div class="video-card__meta">
        <span>${formatDuration(video.watchedDuration || 0)} watched</span>
        <span>${formatDuration(video.totalDuration || 0)} total</span>
      </div>
      <span class="category-chip" style="--chip-color:${color}">${category}</span>
    </div>
  `;
  return card;
};

const renderCategorySidebar = () => {
  const container = document.getElementById('categorySidebar');
  if (!container) return;
  const breakdown = calculateCategoryBreakdown(state.history);
  const entries = Array.from(breakdown.entries()).sort((a, b) => b[1].count - a[1].count);
  container.innerHTML = `
    <div class="category-panel__header">
      <p class="eyebrow">Categories</p>
      <button data-category="all" class="btn btn--ghost">Reset</button>
    </div>
    <div class="category-panel__list">
      ${entries.map(([category, data]) => {
        const color = CATEGORY_COLOR_MAP[category] || '#777';
        return `<button data-category="${category}" class="category-pill" style="--pill-color:${color}">
          <span>${category}</span>
          <span>${data.count}</span>
        </button>`;
      }).join('')}
    </div>
    ${entries.some(([category]) => category === 'Uncategorized') ? '<button class="btn btn--outline" id="sidebarCategorize">Categorize uncategorized</button>' : ''}
  `;
  document.getElementById('sidebarCategorize')?.addEventListener('click', handleCategorizePending);
};

const renderStats = async () => {
  const totalsCard = document.getElementById('totalsCard');
  const topChannelsList = document.getElementById('topChannels');
  const categoryBars = document.getElementById('categoryBars');
  const activityChart = document.getElementById('activityChart');
  if (!totalsCard || !topChannelsList || !categoryBars || !activityChart) return;
  const stats = await getStats();
  const { hours, minutes } = toHoursMinutes(stats.totalWatchSeconds);
  totalsCard.innerHTML = `
    <h3>Total insight</h3>
    <p class="stat">${stats.totalVideos} videos</p>
    <p class="muted">${hours}h ${minutes}m intentional watch time</p>
    <p class="muted">Avg completion ${formatPercent(stats.avgWatchPercent)}</p>
    ${stats.mostRewatched ? `<p class="muted">Most rewatched: ${stats.mostRewatched.title}</p>` : ''}
  `;

  const topChannels = calculateTopChannels(state.history);
  topChannelsList.innerHTML = topChannels.length ? topChannels.map((entry) => `<li><span>${entry.channel}</span><span>${formatDuration(entry.watchTime)}</span></li>`).join('') : '<li class="muted">No data yet.</li>';

  const breakdown = calculateCategoryBreakdown(state.history);
  const totalVideos = Math.max(1, state.history.length);
  categoryBars.innerHTML = Array.from(breakdown.entries()).map(([category, data]) => {
    const percent = Math.round((data.count / totalVideos) * 100);
    const color = CATEGORY_COLOR_MAP[category] || '#555';
    return `<div class="category-bar">
      <div class="category-bar__fill" style="width:${percent}%; background:${color}"></div>
      <div class="category-bar__label">
        <span>${category}</span>
        <span>${percent}%</span>
      </div>
    </div>`;
  }).join('');

  const activity = calculateDailyActivity(state.history);
  activityChart.innerHTML = activity.map((day) => {
    const height = Math.min(100, (day.totalWatch / 3600) * 20);
    return `<div class="activity-bar" title="${day.dateKey}: ${formatDuration(day.totalWatch)}" style="height:${height}px"></div>`;
  }).join('');
};

const loadReportCache = async () => {
  try {
    const cached = await getCachedReport();
    if (cached) {
      state.report = cached;
      renderReportPanel();
    }
  } catch (error) {
    console.error('loadReportCache failed', error);
  }
};

const renderReportPanel = () => {
  if (!state.report) return;
  document.getElementById('reportMeta').textContent = `Last generated: ${formatDate(state.report.generatedAt)}`;
  document.getElementById('reportContent').innerHTML = markdownToHtml(state.report.content);
};

const toggleReportPanel = (show) => {
  document.getElementById('reportPanel').classList.toggle('report-panel--open', show);
};

const markdownToHtml = (text = '') => {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const paragraphs = bolded.split(/\n{2,}/).map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
  return paragraphs;
};

const setButtonLoading = (id, loading, label) => {
  const button = document.getElementById(id);
  if (!button) return;
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  if (loading) {
    button.classList.add('btn--loading');
    button.textContent = label || 'Working…';
    button.disabled = true;
  } else {
    button.classList.remove('btn--loading');
    button.textContent = button.dataset.originalText;
    button.disabled = false;
  }
};

const showToast = (message, error = false) => {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${error ? 'toast--error' : ''}`;
  toast.classList.add('toast--visible');
  setTimeout(() => toast.classList.remove('toast--visible'), 3000);
};

const populateSettingsForm = () => {
  state.settings = sanitizeSettings(state.settings, FORM_DEFAULTS);
  const settings = state.settings;
  const percentInput = document.getElementById('settingWatchPercent');
  const minutesInput = document.getElementById('settingWatchMinutes');
  const trackSelect = document.getElementById('settingTrackAutoplay');
  const hiddenSelect = document.getElementById('settingHiddenTime');
  const retentionSelect = document.getElementById('settingRetention');
  const aiSelect = document.getElementById('settingAiEnabled');
  const apiInput = document.getElementById('settingApiKey');

  if (percentInput) percentInput.value = settings.minWatchPercent;
  if (minutesInput) minutesInput.value = Math.round((settings.minWatchTimeSeconds || FORM_DEFAULTS.minWatchTimeSeconds) / 60);
  if (trackSelect) trackSelect.value = String(settings.trackAutoplay);
  if (hiddenSelect) hiddenSelect.value = String(settings.countHiddenTime);
  if (retentionSelect) retentionSelect.value = settings.dataRetention;
  if (aiSelect) aiSelect.value = String(settings.aiFeaturesEnabled);
  if (apiInput) apiInput.value = settings.openRouterApiKey || '';
};

const sendMessage = (payload) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage(payload, (response) => {
    if (chrome.runtime.lastError) {
      reject(chrome.runtime.lastError);
      return;
    }
    resolve(response);
  });
});

init();
