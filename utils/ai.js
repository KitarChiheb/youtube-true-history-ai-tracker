/**
 * ai.js
 * Encapsulates all communication with OpenRouter so only the background service
 * worker touches network APIs. Provides categorization, weekly report, and key
 * verification helpers consumed exclusively by background/service-worker.js.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL_PRIMARY = 'mistralai/mistral-nemo';
const AI_MODEL_FALLBACK = 'google/gemma-3-12b-it';

const buildHeaders = (apiKey) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
  'HTTP-Referer': chrome.runtime?.getURL('') || 'chrome-extension://yt-true-history/',
  'X-Title': 'YT True History'
});

const callOpenRouter = async ({ apiKey, messages, model }) => {
  if (!apiKey) {
    throw new Error('Missing OpenRouter API key');
  }
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      stream: false
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }
  return response.json();
};

const parseJsonContent = (content) => {
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}') + 1;
    const jsonSegment = start >= 0 ? content.slice(start, end) : content;
    return JSON.parse(jsonSegment);
  } catch (error) {
    throw new Error('Failed to parse AI JSON');
  }
};

export const categorizeVideoAi = async ({ title, channelName, apiKey }) => {
  try {
    const prompt = `You are a video categorization assistant. Given a YouTube video title and channel name, return a single JSON object with no extra text.\nVideo Title: "${title}"\nChannel Name: "${channelName}"\nReturn exactly this JSON:\n{\n"category": "<one of: Technology, Programming, Gaming, Music, Education, Science, Finance, Health, Comedy, News, Sports, Cooking, Travel, Art, Productivity, Philosophy, Politics, History, Other>",\n"confidence": "<high | medium | low>"\n}`;

    let data;
    try {
      data = await callOpenRouter({
        apiKey,
        model: AI_MODEL_PRIMARY,
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (primaryError) {
      data = await callOpenRouter({
        apiKey,
        model: AI_MODEL_FALLBACK,
        messages: [{ role: 'user', content: prompt }]
      });
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenRouter response missing content');
    }
    const parsed = parseJsonContent(content);
    return {
      category: parsed.category || 'Uncategorized',
      confidence: parsed.confidence || 'low'
    };
  } catch (error) {
    console.error('categorizeVideoAi failed', error);
    return { category: 'Uncategorized', confidence: 'low' };
  }
};

export const generateWeeklyReportAi = async ({ summaryPayload, apiKey }) => {
  try {
    const prompt = `You are a personal media consumption analyst. A user has shared their YouTube watch history for the past 7 days. Analyze their patterns and write a personalized, honest, insightful report in a friendly but direct tone.\n${summaryPayload}\nWrite a report with these 4 sections:\n\nOverview — What kind of content did they consume this week?\nPatterns — What habits or tendencies do you notice?\nHighlights — What stands out as interesting or notable?\nReflection — One honest, non-judgmental observation about their viewing habits.\n\nKeep the entire report under 300 words. Be specific using the actual data provided.`;

    let data;
    try {
      data = await callOpenRouter({
        apiKey,
        model: AI_MODEL_PRIMARY,
        messages: [{ role: 'user', content: prompt }]
      });
    } catch (primaryError) {
      data = await callOpenRouter({
        apiKey,
        model: AI_MODEL_FALLBACK,
        messages: [{ role: 'user', content: prompt }]
      });
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('OpenRouter weekly report missing content');
    }
    return content;
  } catch (error) {
    console.error('generateWeeklyReportAi failed', error);
    throw error;
  }
};

export const testOpenRouterKey = async (apiKey) => {
  try {
    const data = await callOpenRouter({
      apiKey,
      model: AI_MODEL_PRIMARY,
      messages: [{ role: 'user', content: 'Reply with "OK" if you can read this.' }]
    });
    const content = data?.choices?.[0]?.message?.content || '';
    return content.toLowerCase().includes('ok');
  } catch (error) {
    console.error('testOpenRouterKey failed', error);
    return false;
  }
};
