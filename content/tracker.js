/**
 * tracker.js
 * Runs on youtube.com/watch pages only. Detects intentional watches, tracks
 * completion while respecting user settings, and sends structured watch events
 * to the background service worker via chrome.runtime messaging.
 */

const MESSAGE_TYPES = {
  VIDEO_WATCHED: 'VIDEO_WATCHED',
  GET_SETTINGS: 'GET_SETTINGS'
};

const DEFAULT_THRESHOLDS = {
  minWatchPercent: 40,
  minWatchTimeSeconds: 300,
  trackAutoplay: true,
  countHiddenTime: false,
  trackingEnabled: true
};

const POLL_INTERVAL_MS = 1000;
const AUTOPLAY_WINDOW_MS = 2000;

let settings = { ...DEFAULT_THRESHOLDS };
let currentVideoId = null;
let watchTimer = null;
let player = null;
let watchedSeconds = 0;
let hasRecorded = false;
let autoplayDetected = false;
let interactionCaptured = false;
let videoStartTimestamp = performance.now();

const init = async () => {
  await loadSettings();
  observeUrlChanges();
  setupInteractionTracking();
  detectVideo();
};

const loadSettings = async () => {
  // PATTERN: Message Passing — content script requests settings from worker.
  try {
    const response = await sendMessage({ type: MESSAGE_TYPES.GET_SETTINGS });
    if (response?.success && response.data) {
      settings = { ...settings, ...response.data };
    }
  } catch (error) {
    console.error('tracker.loadSettings failed', error);
  }
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

const observeUrlChanges = () => {
  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      detectVideo();
    }
  });
  observer.observe(document, { subtree: true, childList: true });
};

const setupInteractionTracking = () => {
  const markInteracted = () => {
    interactionCaptured = true;
  };
  window.addEventListener('pointerdown', markInteracted, { passive: true });
  window.addEventListener('keydown', markInteracted, { passive: true });
};

const detectVideo = () => {
  const url = new URL(window.location.href);
  const videoId = url.searchParams.get('v');
  if (!videoId) {
    resetTracking();
    return;
  }
  if (videoId === currentVideoId) return;
  currentVideoId = videoId;
  waitForPlayer();
};

const waitForPlayer = () => {
  resetTracking();
  const attempt = () => {
    player = document.querySelector('video');
    if (player && player.duration) {
      setupPlayerListeners();
    } else {
      requestAnimationFrame(attempt);
    }
  };
  attempt();
};

const resetTracking = () => {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  watchedSeconds = 0;
  hasRecorded = false;
  autoplayDetected = false;
  videoStartTimestamp = performance.now();
};

const setupPlayerListeners = () => {
  if (!player) return;
  player.removeEventListener('playing', evaluateAutoplay);
  player.addEventListener('playing', evaluateAutoplay, { once: true });
  player.addEventListener('ended', () => {
    if (!hasRecorded) {
      evaluateAndSend();
    }
  });
  watchTimer = setInterval(trackWatchTime, POLL_INTERVAL_MS);
};

const evaluateAutoplay = () => {
  if (interactionCaptured) return;
  if (performance.now() - videoStartTimestamp <= AUTOPLAY_WINDOW_MS) {
    autoplayDetected = true;
  }
};

const trackWatchTime = () => {
  if (!player || player.paused || player.ended || !player.duration) {
    return;
  }
  if (!settings.countHiddenTime && document.hidden) {
    return; // WHY: Page Visibility API prevents counting hidden tab time.
  }
  watchedSeconds += POLL_INTERVAL_MS / 1000;
  evaluateAndSend();
};

const evaluateAndSend = () => {
  if (hasRecorded || !player) return;
  if (!settings.trackingEnabled) return;
  const duration = Math.floor(player.duration || 0);
  if (!duration) return;
  const percentWatched = Math.min(100, (player.currentTime / duration) * 100);
  const percentThreshold = settings.minWatchPercent ?? DEFAULT_THRESHOLDS.minWatchPercent;
  const timeThreshold = settings.minWatchTimeSeconds ?? DEFAULT_THRESHOLDS.minWatchTimeSeconds;
  const watchedEnough = percentWatched >= percentThreshold || watchedSeconds >= timeThreshold;
  if (!watchedEnough) return;
  hasRecorded = true;
  sendVideoRecord({ percentWatched, duration });
};

const sendVideoRecord = async ({ percentWatched, duration }) => {
  const payload = await buildVideoPayload({ percentWatched, duration });
  try {
    const response = await sendMessage({
      type: MESSAGE_TYPES.VIDEO_WATCHED,
      payload
    });
    if (!response?.success) {
      console.warn('Video watch save failed', response?.error);
    }
  } catch (error) {
    console.error('Failed to send video record', error);
  }
};

const buildVideoPayload = async ({ percentWatched, duration }) => {
  const title = document.querySelector('h1.title')?.innerText?.trim() || document.title || 'Unknown title';
  const channelLink = document.querySelector('#owner-name a, ytd-channel-name a');
  const channelName = channelLink?.textContent?.trim() || 'Unknown channel';
  const channelUrl = channelLink?.href || '';
  const channelIdMatch = channelUrl.match(/channel\/([^/?]+)/);
  const channelId = channelIdMatch ? channelIdMatch[1] : channelUrl;
  const thumbnail = `https://i.ytimg.com/vi/${currentVideoId}/hqdefault.jpg`;

  return {
    videoId: currentVideoId,
    title,
    channelName,
    channelId,
    thumbnail,
    watchedAt: new Date().toISOString(),
    watchedDuration: Math.min(Math.floor(player.currentTime || watchedSeconds), duration),
    totalDuration: duration,
    watchPercent: Math.round(percentWatched),
    autoplay: autoplayDetected,
    rewatchCount: 1,
    aiCategory: null,
    aiCategoryConfidence: null
  };
};

init();
