/**
 * service-worker.js
 * Manifest V3 background service worker coordinating storage, AI traffic, and
 * cross-context messaging. Receives watch events from content scripts and UI
 * requests from popup/dashboard pages, then calls storage + OpenRouter helpers.
 */

import {
  saveVideo,
  updateVideo,
  getSettings,
  getHistory,
  getStats,
  getCachedReport,
  saveReport,
  clearAll,
  replaceHistory
} from '../utils/storage.js';
import {
  categorizeVideoAi,
  generateWeeklyReportAi,
  testOpenRouterKey
} from '../utils/ai.js';
import {
  delay,
  formatDay,
  formatHour,
  calculateTopChannels,
  calculateCategoryBreakdown
} from '../utils/helpers.js';

const MESSAGE_TYPES = {
  VIDEO_WATCHED: 'VIDEO_WATCHED',
  GET_SETTINGS: 'GET_SETTINGS',
  GENERATE_WEEKLY_REPORT: 'GENERATE_WEEKLY_REPORT',
  GET_REPORT_CACHE: 'GET_REPORT_CACHE',
  TEST_API_KEY: 'TEST_API_KEY',
  CATEGORIZE_PENDING: 'CATEGORIZE_PENDING',
  CLEAR_DATA: 'CLEAR_DATA'
};

const AI_RATE_LIMIT_MS = 1000;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// PATTERN: Rate limiting — queue sequential AI jobs to respect free tier caps.
const aiQueue = [];
let queueProcessing = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ success: true, data: result }))
    .catch((error) => {
      console.error('background message failed', error);
      sendResponse({ success: false, error: error.message });
    });
  return true; // WHY: keeps the channel open for async await responses.
});

const handleMessage = async (message) => {
  switch (message?.type) {
    case MESSAGE_TYPES.VIDEO_WATCHED:
      return handleVideoWatched(message.payload);
    case MESSAGE_TYPES.GET_SETTINGS:
      return getSettings();
    case MESSAGE_TYPES.GENERATE_WEEKLY_REPORT:
      return handleWeeklyReport();
    case MESSAGE_TYPES.GET_REPORT_CACHE:
      return getCachedReport();
    case MESSAGE_TYPES.TEST_API_KEY:
      return testOpenRouterKey(message.apiKey);
    case MESSAGE_TYPES.CATEGORIZE_PENDING:
      return enqueuePendingVideos();
    case MESSAGE_TYPES.CLEAR_DATA:
      await clearAll();
      await replaceHistory([]);
      return true;
    default:
      throw new Error('Unknown message type');
  }
};

const handleVideoWatched = async (payload) => {
  // PATTERN: Message Passing — content script sends sanitized video data only.
  if (!payload?.videoId) {
    throw new Error('Missing video id');
  }
  const settings = await getSettings();
  if (!settings.trackingEnabled) {
    return { skipped: true };
  }
  if (payload.autoplay && !settings.trackAutoplay) {
    return { skipped: true };
  }
  await saveVideo(payload);
  await applyRetentionPolicy(settings);
  if (settings.aiFeaturesEnabled && settings.openRouterApiKey) {
    queueCategorizationJob(payload);
  } else {
    await updateVideo(payload.videoId, {
      aiCategory: 'Uncategorized',
      aiCategoryConfidence: 'low'
    });
  }
  return { stored: true };
};

const queueCategorizationJob = (video) => {
  const jobExists = aiQueue.some((job) => job.videoId === video.videoId);
  if (!jobExists) {
    aiQueue.push({
      videoId: video.videoId,
      title: video.title,
      channelName: video.channelName
    });
  }
  processQueueSafely();
};

const enqueuePendingVideos = async () => {
  const history = await getHistory();
  history
    .filter((video) => !video.aiCategory || video.aiCategory === 'Uncategorized')
    .forEach(queueCategorizationJob);
  return { queued: aiQueue.length };
};

const processQueueSafely = async () => {
  if (queueProcessing) return;
  queueProcessing = true;
  while (aiQueue.length) {
    const job = aiQueue.shift();
    try {
      await processSingleJob(job);
      await delay(AI_RATE_LIMIT_MS);
    } catch (error) {
      console.error('AI job failed', error);
    }
  }
  queueProcessing = false;
};

const processSingleJob = async (job) => {
  const settings = await getSettings();
  if (!settings.aiFeaturesEnabled || !settings.openRouterApiKey) {
    await updateVideo(job.videoId, {
      aiCategory: 'Uncategorized',
      aiCategoryConfidence: 'low'
    });
    return;
  }
  const { category, confidence } = await categorizeVideoAi({
    title: job.title,
    channelName: job.channelName,
    apiKey: settings.openRouterApiKey
  });
  await updateVideo(job.videoId, {
    aiCategory: category,
    aiCategoryConfidence: confidence
  });
};

const applyRetentionPolicy = async (settings) => {
  const retentionDays = settings.dataRetention;
  if (retentionDays === 'all') return;
  const daysToKeep = { '3m': 90, '6m': 182, '1y': 365 }[retentionDays];
  if (!daysToKeep) return;
  const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
  const history = await getHistory();
  const filtered = history.filter((video) => new Date(video.watchedAt).getTime() >= cutoff);
  if (filtered.length !== history.length) {
    await replaceHistory(filtered);
  }
};

const handleWeeklyReport = async () => {
  const settings = await getSettings();
  if (!settings.aiFeaturesEnabled || !settings.openRouterApiKey) {
    throw new Error('AI disabled or API key missing');
  }
  const history = await getHistory();
  const recent = history.filter((video) => Date.now() - new Date(video.watchedAt).getTime() <= RECENT_WINDOW_MS);
  if (!recent.length) {
    throw new Error('No watch history in the past 7 days');
  }
  const summaryPayload = buildWeeklySummary(recent);
  const reportContent = await generateWeeklyReportAi({
    summaryPayload,
    apiKey: settings.openRouterApiKey
  });
  const report = {
    content: reportContent,
    generatedAt: new Date().toISOString()
  };
  await saveReport(report);
  return report;
};

const buildWeeklySummary = (videos) => {
  const totalVideos = videos.length;
  const totalWatchSeconds = videos.reduce((sum, video) => sum + (video.watchedDuration || 0), 0);
  const hours = Math.floor(totalWatchSeconds / 3600);
  const minutes = Math.floor((totalWatchSeconds % 3600) / 60);
  const topChannels = calculateTopChannels(videos).map((entry) => `${entry.channel} (${Math.round(entry.watchTime / 60)} min)`);
  const categoryBreakdown = Array.from(calculateCategoryBreakdown(videos).entries()).map(([category, data]) => `${category}: ${data.count} videos`);
  const mostRewatched = [...videos].sort((a, b) => (b.rewatchCount || 0) - (a.rewatchCount || 0))[0];
  const avgPercent = Math.round(videos.reduce((sum, video) => sum + (video.watchPercent || 0), 0) / totalVideos);
  const mostActiveDay = mostFrequentValue(videos.map((video) => formatDay(video.watchedAt)));
  const mostActiveHour = mostFrequentValue(videos.map((video) => formatHour(video.watchedAt)));

  return `Total videos watched: ${totalVideos}\n` +
    `Total watch time: ${hours} hours ${minutes} minutes\n` +
    `Top channels: ${topChannels.join(', ') || 'None'}\n` +
    `Category breakdown: ${categoryBreakdown.join(', ') || 'None'}\n` +
    `Most rewatched video: "${mostRewatched?.title || 'N/A'}" by ${mostRewatched?.channelName || 'Unknown'} (${mostRewatched?.rewatchCount || 1} times)\n` +
    `Average watch completion: ${avgPercent}%\n` +
    `Most active watch day: ${mostActiveDay || 'Unknown'}\n` +
    `Most active watch hour: ${mostActiveHour || '00'}:00`;
};

const mostFrequentValue = (values) => {
  if (!values.length) return null;
  const counts = new Map();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  let mostFrequent = null;
  let max = 0;
  counts.forEach((count, value) => {
    if (count > max) {
      mostFrequent = value;
      max = count;
    }
  });
  return mostFrequent;
};
