#!/usr/bin/env node
/** One Gemini request to verify key, model, and quota. Usage: node scripts/gemini-ping.js */
require('dotenv').config();

const { generateContent, DEFAULT_MODEL, USE_INTERACTIONS } = require('../src/services/gemini/geminiClient');

async function main() {
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error('GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  console.log(`Model: ${process.env.GEMINI_MODEL ?? DEFAULT_MODEL}`);
  console.log(`Interactions API when using search: ${USE_INTERACTIONS}`);
  console.log('Sending a single small request…');

  try {
    const { text, api, model } = await generateContent({
      userText: 'Reply with exactly: {"ok":true}',
      jsonMode: false,
    });
    console.log(`Success via ${api} (${model}):`, text.slice(0, 200));
  } catch (err) {
    console.error('Failed:', err.message);
    if (err.status === 429) {
      console.error(
        '\n429 on a single ping usually means daily free-tier quota is exhausted for this key,\n' +
          'not that the project is misconfigured. Check https://ai.dev/rate-limit and wait for reset,\n' +
          'or enable billing on the Google AI project. Keys should come from https://aistudio.google.com/apikey'
      );
    }
    process.exit(1);
  }
}

main();
