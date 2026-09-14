const { extractJsonObject } = require('./jsonExtract');
const { enqueueGeminiRequest } = require('./geminiQueue');

const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
const DEFAULT_BASE =
  process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
const USE_INTERACTIONS =
  process.env.GEMINI_USE_INTERACTIONS == null ||
  process.env.GEMINI_USE_INTERACTIONS === '' ||
  process.env.GEMINI_USE_INTERACTIONS === '1' ||
  process.env.GEMINI_USE_INTERACTIONS.toLowerCase() === 'true';

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

function geminiEnabled(flagEnv, defaultOn = false) {
  if (!isGeminiConfigured()) return false;
  const raw = process.env[flagEnv];
  if (raw == null || raw === '') return defaultOn;
  return raw === '1' || raw.toLowerCase() === 'true';
}

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL ?? 'gemini-3.6-flash';

function modelUnavailableError(status, msg) {
  return status === 404 || /no longer available/i.test(msg ?? '');
}

function quotaExceededError(status, msg, data) {
  if (status !== 429) return false;
  const text = `${msg ?? ''} ${JSON.stringify(data?.error ?? {})}`.toLowerCase();
  return text.includes('quota') || text.includes('rate limit');
}

function buildInputText(opts) {
  if (!opts.systemInstruction) return opts.userText;
  return `${opts.systemInstruction}\n\n---\n\n${opts.userText}`;
}

/**
 * Interactions API — supported combo of google_search + JSON (Gemini 3+).
 */
async function interactionsGenerateOnce(opts, model) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const url = `${DEFAULT_BASE}/interactions`;

  const body = {
    model,
    input: buildInputText(opts),
  };

  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) =>
      t.google_search != null ? { type: 'google_search' } : t
    );
  }

  if (opts.jsonMode) {
    body.response_format = {
      type: 'text',
      mime_type: 'application/json',
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    const err = new Error(`Gemini interactions failed (${res.status}): ${msg}`);
    err.status = res.status;
    err.raw = data;
    throw err;
  }

  const text =
    data.output_text ??
    data.outputs?.[data.outputs.length - 1]?.text ??
    data.steps?.find((s) => s.type === 'text' || s.text)?.text ??
    '';

  return { text, grounding: data.grounding_metadata ?? null, raw: data, model, api: 'interactions' };
}

/**
 * @param {{ systemInstruction?: string, userText: string, jsonMode?: boolean, tools?: object[], model: string }} opts
 */
async function generateContentOnce(opts) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const model = opts.model;
  const useTools = Boolean(opts.tools?.length);
  const useJson = Boolean(opts.jsonMode);

  if (USE_INTERACTIONS && useTools) {
    return interactionsGenerateOnce(opts, model);
  }

  const url = `${DEFAULT_BASE}/models/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: buildInputText(opts) }] }],
  };

  // Legacy generateContent: JSON mime type + tools together is often rejected (400) or flaky.
  if (useJson && !useTools) {
    body.generationConfig = { responseMimeType: 'application/json' };
  }

  if (useTools) {
    body.tools = opts.tools;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? res.statusText;
    const err = new Error(`Gemini request failed (${res.status}): ${msg}`);
    err.status = res.status;
    err.raw = data;
    throw err;
  }

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('');
  const grounding = data?.candidates?.[0]?.groundingMetadata ?? null;

  return { text, grounding, raw: data, model, api: 'generateContent' };
}

/**
 * @param {{ systemInstruction?: string, userText: string, jsonMode?: boolean, tools?: object[], model?: string }} opts
 */
async function generateContent(opts) {
  const primary = opts.model ?? DEFAULT_MODEL;
  return enqueueGeminiRequest(`generateContent:${primary}`, async () => {
    try {
      return await generateContentOnce({ ...opts, model: primary });
    } catch (err) {
      const allowFallback = process.env.GEMINI_MODEL_FALLBACK_ON_404 !== 'false';
      if (
        allowFallback &&
        primary !== FALLBACK_MODEL &&
        modelUnavailableError(err.status, err.message) &&
        !quotaExceededError(err.status, err.message, err.raw)
      ) {
        console.warn(`[gemini] Model ${primary} unavailable, retrying with ${FALLBACK_MODEL}`);
        return generateContentOnce({ ...opts, model: FALLBACK_MODEL });
      }
      throw err;
    }
  });
}

/**
 * @param {Parameters<typeof generateContent>[0]} opts
 */
async function generateJson(opts) {
  const { text, grounding, raw } = await generateContent({ ...opts, jsonMode: true });
  let parsed = extractJsonObject(text);
  if (!parsed) {
    throw new Error('Gemini response did not contain valid JSON');
  }
  return { data: parsed, grounding, raw };
}

module.exports = {
  isGeminiConfigured,
  geminiEnabled,
  generateContent,
  generateJson,
  DEFAULT_MODEL,
  USE_INTERACTIONS,
};
