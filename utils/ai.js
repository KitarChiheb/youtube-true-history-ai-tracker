/**
 * ai.js
 * Encapsulates all communication with OpenRouter so only the background service
 * worker touches network APIs. Provides categorization, weekly report, and key
 * verification helpers consumed exclusively by background/service-worker.js.
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL_PRIMARY = 'mistralai/mistral-nemo';
const AI_MODEL_FALLBACK = 'google/gemma-3-12b-it';

const KEYWORD_HINTS = [
  { category: 'Gaming', keywords: ['game', 'gaming', 'let\'s play', 'walkthrough', 'speedrun', 'playthrough', 'boss fight'] },
  { category: 'Technology', keywords: ['tech', 'iphone', 'android', 'gadget', 'review', 'unboxing', 'hardware'] },
  { category: 'Programming', keywords: ['javascript', 'python', 'coding', 'tutorial', 'react', 'rust', 'api', 'typescript', 'web dev'] },
  { category: 'Music', keywords: ['music', 'song', 'cover', 'instrumental', 'lyrics', 'band', 'concert'] },
  { category: 'Education', keywords: ['lecture', 'class', 'course', 'study', 'learn', 'lesson'] },
  { category: 'Science', keywords: ['science', 'space', 'experiment', 'physics', 'chemistry', 'biology', 'nasa'] },
  { category: 'Finance', keywords: ['stock', 'crypto', 'invest', 'trading', 'money', 'budget'] },
  { category: 'Health', keywords: ['workout', 'fitness', 'diet', 'health', 'yoga', 'meditation'] },
  { category: 'Comedy', keywords: ['funny', 'comedy', 'skit', 'sketch', 'standup', 'prank'] },
  { category: 'News', keywords: ['news', 'breaking', 'update', 'headline'] },
  { category: 'Sports', keywords: ['match', 'highlights', 'football', 'basketball', 'soccer', 'nfl', 'nba', 'fifa'] },
  { category: 'Cooking', keywords: ['recipe', 'cook', 'kitchen', 'bake', 'chef', 'meal'] },
  { category: 'Travel', keywords: ['travel', 'trip', 'tour', 'destination', 'journey', 'vlog'] },
  { category: 'Art', keywords: ['art', 'drawing', 'painting', 'illustration', 'design'] },
  { category: 'Productivity', keywords: ['productivity', 'habit', 'planner', 'focus', 'time management'] },
  { category: 'Philosophy', keywords: ['philosophy', 'ethics', 'stoic', 'existential'] },
  { category: 'Politics', keywords: ['politics', 'policy', 'election', 'government'] },
  { category: 'History', keywords: ['history', 'historic', 'wwii', 'ancient', 'civilization'] }
];

const inferHeuristicCategory = (title = '', channelName = '') => {
  const haystack = `${title} ${channelName}`.toLowerCase();
  for (const hint of KEYWORD_HINTS) {
    if (hint.keywords.some((keyword) => haystack.includes(keyword))) {
      return hint.category;
    }
  }
  return null;
};

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
    const heuristicCategory = inferHeuristicCategory(title, channelName);
    const heuristicHint = heuristicCategory ? `Heuristic guess based on keywords: ${heuristicCategory}. Only use if it truly fits.` : 'No heuristic guess available.';
    const prompt = `You are a precise YouTube video classifier. Your output MUST be valid JSON with no Markdown or commentary.\n\nAllowed categories: Technology, Programming, Gaming, Music, Education, Science, Finance, Health, Comedy, News, Sports, Cooking, Travel, Art, Productivity, Philosophy, Politics, History, Other.\nConfidence options: high, medium, low.\n\nVideo Title: "${title}"\nChannel Name: "${channelName}"\n${heuristicHint}\n\nRules:\n1. Pick exactly one category from the allowed list.\n2. Prefer the heuristic guess only if it clearly matches.\n3. Never invent a new category.\n4. Respond with JSON only.\n\nReturn: {"category":"<AllowedCategory>","confidence":"<high|medium|low>"}`;

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
    const cleanCategory = typeof parsed.category === 'string' ? parsed.category : 'Uncategorized';
    const normalizedCategory = cleanCategory && cleanCategory !== 'Uncategorized'
      ? cleanCategory
      : (heuristicCategory || 'Uncategorized');
    return {
      category: normalizedCategory,
      confidence: parsed.confidence || (heuristicCategory ? 'medium' : 'low')
    };
  } catch (error) {
    console.error('categorizeVideoAi failed', error);
    const heuristicCategory = inferHeuristicCategory(title, channelName);
    return { category: heuristicCategory || 'Uncategorized', confidence: heuristicCategory ? 'medium' : 'low' };
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
