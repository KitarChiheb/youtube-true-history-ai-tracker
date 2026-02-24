/**
 * openrouter-self-test.js
 * Temporary diagnostic script that calls OpenRouter with a tiny prompt so we can
 * verify that the current API key, model IDs, and headers are valid outside the
 * extension. Run with `node diagnostics/openrouter-self-test.js sk-or-XXXX` or by
 * setting the OPENROUTER_API_KEY environment variable.
 */

const fetch = globalThis.fetch;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_PRIMARY = 'mistralai/mistral-nemo';
const MODEL_FALLBACK = 'google/gemma-3-12b-it';

const apiKey = process.argv[2] || process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error('Usage: node diagnostics/openrouter-self-test.js <OPENROUTER_KEY>');
  process.exit(1);
}

const callModel = async (model) => {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'chrome-extension://diagnostic-test',
      'X-Title': 'YT True History - Diagnostics'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a health-check bot that answers with one word.' },
        { role: 'user', content: 'Respond with "OK" if you received this.' }
      ],
      temperature: 0,
      stream: false
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Model ${model} failed (${response.status}): ${text}`);
  }
  return { model, text };
};

(async () => {
  try {
    const primaryResult = await callModel(MODEL_PRIMARY);
    console.log(`[PRIMARY ${primaryResult.model}]`, primaryResult.text);
  } catch (primaryError) {
    console.warn('Primary model failed, attempting fallback:', primaryError.message);
    try {
      const fallbackResult = await callModel(MODEL_FALLBACK);
      console.log(`[FALLBACK ${fallbackResult.model}]`, fallbackResult.text);
    } catch (fallbackError) {
      console.error('Fallback model also failed:', fallbackError.message);
      process.exit(3);
    }
  }
})();
