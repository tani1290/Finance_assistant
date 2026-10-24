/**
 * Deterministic unit-test environment.
 *
 * `src/app.js` loads `.env` when the test process starts. A developer machine
 * with live provider keys would therefore make unit tests call Gemini and time
 * out. Blank the key before any module imports; tests that need a fake key set
 * it explicitly in their own setup.
 */
process.env.GEMINI_API_KEY = '';
process.env.AI_LIVE_SMOKE = '0';
