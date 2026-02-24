/**
 * storage.js
 * Centralized chrome.storage access so every script calls consistent, resilient
 * data helpers. Communicates with background, popup, dashboard, and content
 * scripts that import these functions to avoid repetitive Storage API code.
 */

// WHY: const keeps key names immutable across imports to prevent typo bugs.
const STORAGE_KEYS = {
  VIDEOS: 'videos',
  SETTINGS: 'settings',
  REPORT: 'reportCache'
};

const DEFAULT_SETTINGS = {
  minWatchPercent: 40,
  minWatchTimeSeconds: 300,
  trackAutoplay: true,
  countHiddenTime: false,
  dataRetention: 'all',
  openRouterApiKey: '',
  aiFeaturesEnabled: true,
  trackingEnabled: true
};

// PATTERN: Defensive storage — always watch quota to warn users before writes fail.
const warnIfStorageLarge = async () => {
  try {
    const bytes = await chrome.storage.local.getBytesInUse(null);
    if (bytes >= 4 * 1024 * 1024) {
      console.warn('storage nearing 4MB quota; consider exporting/deleting data');
    }
  } catch (error) {
    console.error('storage.getBytesInUse failed', error);
  }
};

const getVideos = async () => {
  try {
    const result = await chrome.storage.local.get({ [STORAGE_KEYS.VIDEOS]: [] });
    return Array.isArray(result[STORAGE_KEYS.VIDEOS]) ? result[STORAGE_KEYS.VIDEOS] : [];
  } catch (error) {
    console.error('storage.getVideos failed', error);
    return [];
  }
};

const setVideos = async (videos) => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.VIDEOS]: videos });
    await warnIfStorageLarge();
  } catch (error) {
    console.error('storage.setVideos failed', error);
  }
};

/**
 * @returns {Promise<object>} saved settings merged with defaults
 */
export const getSettings = async () => {
  try {
    const result = await chrome.storage.local.get({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
  } catch (error) {
    console.error('getSettings failed', error);
    return { ...DEFAULT_SETTINGS };
  }
};

/**
 * @param {object} newSettings
 * @returns {Promise<void>} persist merged settings safely
 */
export const saveSettings = async (newSettings) => {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...newSettings };
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });
  } catch (error) {
    console.error('saveSettings failed', error);
  }
};

/**
 * @param {object} video
 * @returns {Promise<object>} saved video echo so callers can chain logic
 */
export const saveVideo = async (video) => {
  try {
    const videos = await getVideos();
    const existingIndex = videos.findIndex((item) => item.videoId === video.videoId);
    if (existingIndex >= 0) {
      const existing = videos[existingIndex];
      videos[existingIndex] = {
        ...existing,
        ...video,
        rewatchCount: (existing.rewatchCount || 1) + 1,
        watchedAt: video.watchedAt
      };
    } else {
      videos.push({ ...video, rewatchCount: video.rewatchCount || 1 });
    }
    await setVideos(videos);
    return video;
  } catch (error) {
    console.error('saveVideo failed', error);
    throw error;
  }
};

/**
 * @returns {Promise<object[]>} entire watch history array
 */
export const getHistory = async () => getVideos();

/**
 * PATTERN: Storage abstraction — UIs call this instead of chrome.storage.
 * @param {string} videoId
 * @param {object} updates
 * @returns {Promise<void>} video entry updated in-place
 */
export const updateVideo = async (videoId, updates) => {
  try {
    const videos = await getVideos();
    const index = videos.findIndex((video) => video.videoId === videoId);
    if (index === -1) return;
    videos[index] = { ...videos[index], ...updates };
    await setVideos(videos);
  } catch (error) {
    console.error('updateVideo failed', error);
  }
};

/**
 * @param {string} videoId
 * @returns {Promise<void>} removes the target video completely
 */
export const deleteVideo = async (videoId) => {
  try {
    const videos = await getVideos();
    const filtered = videos.filter((video) => video.videoId !== videoId);
    await setVideos(filtered);
  } catch (error) {
    console.error('deleteVideo failed', error);
  }
};

/**
 * @returns {Promise<void>} wipes stored videos + cached reports
 */
export const clearAll = async () => {
  try {
    await chrome.storage.local.remove([STORAGE_KEYS.VIDEOS, STORAGE_KEYS.REPORT]);
  } catch (error) {
    console.error('clearAll failed', error);
  }
};

/**
 * @returns {Promise<object>} aggregate stats for dashboard cards
 */
export const getStats = async () => {
  try {
    const videos = await getVideos();
    if (!videos.length) {
      return {
        totalVideos: 0,
        totalWatchSeconds: 0,
        avgWatchPercent: 0,
        mostRewatched: null
      };
    }
    const totalWatchSeconds = videos.reduce((sum, video) => sum + (video.watchedDuration || 0), 0);
    const avgWatchPercent = videos.reduce((sum, video) => sum + (video.watchPercent || 0), 0) / videos.length;
    const mostRewatched = [...videos].sort((a, b) => (b.rewatchCount || 0) - (a.rewatchCount || 0))[0];
    return {
      totalVideos: videos.length,
      totalWatchSeconds,
      avgWatchPercent,
      mostRewatched
    };
  } catch (error) {
    console.error('getStats failed', error);
    return {
      totalVideos: 0,
      totalWatchSeconds: 0,
      avgWatchPercent: 0,
      mostRewatched: null
    };
  }
};

/**
 * @returns {Promise<object|null>} cached AI report metadata
 */
export const getCachedReport = async () => {
  try {
    const result = await chrome.storage.local.get({ [STORAGE_KEYS.REPORT]: null });
    return result[STORAGE_KEYS.REPORT];
  } catch (error) {
    console.error('getCachedReport failed', error);
    return null;
  }
};

/**
 * @param {object} report
 * @returns {Promise<void>} persists the latest AI report
 */
export const saveReport = async (report) => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.REPORT]: report });
  } catch (error) {
    console.error('saveReport failed', error);
  }
};

/**
 * @param {object[]} videos
 * @returns {Promise<void>} replaces entire watch history (used for retention/import)
 */
export const replaceHistory = async (videos) => {
  try {
    await setVideos(videos);
  } catch (error) {
    console.error('replaceHistory failed', error);
  }
};

/**
 * @returns {Promise<object[]>} shallow copy for export flows
 */
export const exportHistory = async () => {
  const videos = await getVideos();
  return [...videos];
};

/**
 * @param {object[]} importedVideos
 * @returns {Promise<void>} merges imported videos with existing history
 */
export const importHistory = async (importedVideos = []) => {
  try {
    if (!Array.isArray(importedVideos)) {
      throw new Error('Imported data must be an array');
    }
    const current = await getVideos();
    const mergedMap = new Map(current.map((video) => [video.videoId, video]));
    importedVideos.forEach((video) => {
      if (!video?.videoId) return;
      const existing = mergedMap.get(video.videoId);
      if (existing) {
        mergedMap.set(video.videoId, {
          ...existing,
          ...video,
          rewatchCount: Math.max(existing.rewatchCount || 1, video.rewatchCount || 1)
        });
      } else {
        mergedMap.set(video.videoId, video);
      }
    });
    await setVideos(Array.from(mergedMap.values()));
  } catch (error) {
    console.error('importHistory failed', error);
    throw error;
  }
};

/**
 * @returns {Promise<number>} count of videos watched today for popup stats
 */
export const getTodayCount = async () => {
  const videos = await getVideos();
  const todayKey = new Date().toISOString().slice(0, 10);
  return videos.filter((video) => (video.watchedAt || '').startsWith(todayKey)).length;
};
