/**
 * helpers.js
 * Shared utility helpers for formatting, sorting, and domain math so UI, storage,
 * and background logic can stay focused on their responsibilities. Communicates
 * indirectly with every module that imports these pure functions.
 */

// WHY: const keeps foundational lookup tables immutable across imports.
export const VIDEO_CATEGORIES = [
  'Technology',
  'Programming',
  'Gaming',
  'Music',
  'Education',
  'Science',
  'Finance',
  'Health',
  'Comedy',
  'News',
  'Sports',
  'Cooking',
  'Travel',
  'Art',
  'Productivity',
  'Philosophy',
  'Politics',
  'History',
  'Other',
  'Uncategorized'
];

// WHY: const ensures retention windows stay stable for consistent cleanup rules.
export const CATEGORY_COLOR_MAP = {
  Technology: '#64d2ff',
  Programming: '#ff8f66',
  Gaming: '#a366ff',
  Music: '#ff66b3',
  Education: '#66ffc2',
  Science: '#5cd6ff',
  Finance: '#ffc766',
  Health: '#66ff9c',
  Comedy: '#ffd966',
  News: '#ff6f6f',
  Sports: '#66b2ff',
  Cooking: '#ffb366',
  Travel: '#66ffe3',
  Art: '#ff66d9',
  Productivity: '#7c8cff',
  Philosophy: '#c2a1ff',
  Politics: '#ff6666',
  History: '#ad8b73',
  Other: '#9aa7b8',
  Uncategorized: '#666b7a'
};

export const RETENTION_WINDOWS = {
  all: null,
  '3m': 90,
  '6m': 182,
  '1y': 365
};

/**
 * PATTERN: Promises — delay uses a Promise to pause async workflows (AI queue)
 * without blocking the service worker's single-threaded event loop.
 */
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const formatDuration = (totalSeconds = 0) => {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);
  if (hours) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const formatDate = (isoString) => {
  if (!isoString) return 'Unknown';
  return new Date(isoString).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

export const formatDay = (isoString) => {
  if (!isoString) return 'Unknown day';
  return new Date(isoString).toLocaleDateString(undefined, { weekday: 'long' });
};

export const formatHour = (isoString) => {
  if (!isoString) return '00';
  return new Date(isoString).getHours().toString().padStart(2, '0');
};

export const formatPercent = (value) => `${Math.round(value)}%`;

export const getDateKey = (isoString) => new Date(isoString).toISOString().slice(0, 10);

export const getLastNDays = (days) => {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    result.push(date.toISOString().slice(0, 10));
  }
  return result;
};

export const sum = (items, selector) => items.reduce((acc, item) => acc + selector(item), 0);

export const groupBy = (items, selector) => {
  const map = new Map();
  items.forEach((item) => {
    const key = selector(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(item);
  });
  return map;
};

export const calculateTopChannels = (history, limit = 5) => {
  const channelMap = groupBy(history, (video) => video.channelName || 'Unknown');
  const ranked = Array.from(channelMap.entries()).map(([channel, videos]) => ({
    channel,
    watchTime: sum(videos, (video) => video.watchedDuration || 0)
  }));
  ranked.sort((a, b) => b.watchTime - a.watchTime);
  return ranked.slice(0, limit);
};

export const calculateCategoryBreakdown = (history) => {
  const map = new Map();
  history.forEach((video) => {
    const category = video.aiCategory || 'Uncategorized';
    const entry = map.get(category) || { count: 0, watchTime: 0 };
    entry.count += 1;
    entry.watchTime += video.watchedDuration || 0;
    map.set(category, entry);
  });
  return map;
};

export const calculateDailyActivity = (history, days = 30) => {
  const lastDays = getLastNDays(days);
  const activity = lastDays.map((dateKey) => ({
    dateKey,
    totalWatch: 0,
    count: 0
  }));
  const activityMap = new Map(activity.map((entry) => [entry.dateKey, entry]));
  history.forEach((video) => {
    const key = getDateKey(video.watchedAt);
    if (activityMap.has(key)) {
      const bucket = activityMap.get(key);
      bucket.totalWatch += video.watchedDuration || 0;
      bucket.count += 1;
    }
  });
  return activity;
};

export const toHoursMinutes = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return { hours, minutes };
};

export const safeMarkdown = (text = '') => {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

export const buildCsv = (rows, headers) => {
  const headerRow = headers.join(',');
  const lines = rows.map((row) => headers.map((key) => {
    const value = row[key] ?? '';
    const safe = typeof value === 'string' ? value.replace(/"/g, '""') : value;
    return `"${safe}"`;
  }).join(','));
  return [headerRow, ...lines].join('\n');
};

export const filterByDateRange = (history, startDate, endDate) => {
  if (!startDate && !endDate) return history;
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;
  return history.filter((video) => {
    const watched = new Date(video.watchedAt);
    if (start && watched < start) return false;
    if (end && watched > end) return false;
    return true;
  });
};

export const sortVideos = (videos, sortKey) => {
  const cloned = [...videos];
  switch (sortKey) {
    case 'rewatch':
      cloned.sort((a, b) => (b.rewatchCount || 0) - (a.rewatchCount || 0));
      break;
    case 'duration':
      cloned.sort((a, b) => (b.watchedDuration || 0) - (a.watchedDuration || 0));
      break;
    case 'category':
      cloned.sort((a, b) => (a.aiCategory || '').localeCompare(b.aiCategory || ''));
      break;
    default:
      cloned.sort((a, b) => new Date(b.watchedAt) - new Date(a.watchedAt));
  }
  return cloned;
};

export const searchVideos = (videos, query) => {
  if (!query) return videos;
  const lower = query.toLowerCase();
  return videos.filter((video) => (
    video.title?.toLowerCase().includes(lower) ||
    video.channelName?.toLowerCase().includes(lower)
  ));
};
