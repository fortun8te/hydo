'use strict';

/**
 * SuperGrok / Grok CLI OIDC lives in ~/.grok/auth.json (same client id Hermes
 * uses for xai-oauth). Hermes chat needs providers.xai-oauth in
 * ~/.hermes/auth.json — not XAI_API_KEY. Import once if Hermes has none.
 * Never log the tokens.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GROK_CLIENT = 'b1a00492-073a-47ea-816f-4c329264a828';

function grokAuthPath() {
  return path.join(os.homedir(), '.grok', 'auth.json');
}

function hermesAuthPath() {
  return path.join(os.homedir(), '.hermes', 'auth.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function grokRecord(store) {
  if (!store || typeof store !== 'object') return null;
  const preferred = store[`https://auth.x.ai::${GROK_CLIENT}`];
  const candidates = [preferred, ...Object.values(store)].filter((v) => v && typeof v === 'object');
  for (const rec of candidates) {
    const access = String(rec.key || rec.access_token || '').trim();
    const refresh = String(rec.refresh_token || '').trim();
    if (access && refresh) return rec;
  }
  return null;
}

function hermesHasXaiOauth(store) {
  if (!store || typeof store !== 'object') return false;
  const state = store.providers && store.providers['xai-oauth'];
  const tokens = state && state.tokens;
  if (tokens && String(tokens.access_token || '').trim() && String(tokens.refresh_token || '').trim()) {
    return true;
  }
  const pool = store.credential_pool && store.credential_pool['xai-oauth'];
  if (Array.isArray(pool)) {
    return pool.some(
      (e) => e && String(e.access_token || '').trim() && String(e.refresh_token || '').trim()
    );
  }
  return false;
}

function writeJsonAtomic(file, obj) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

/** @returns {'ok'|'imported'|'missing-grok'|'has-hermes'|'error'} */
function ensureHermesXaiOauth() {
  try {
    const hermesFile = hermesAuthPath();
    const hermes = readJson(hermesFile) || {};
    if (hermesHasXaiOauth(hermes)) return 'has-hermes';
    const rec = grokRecord(readJson(grokAuthPath()));
    if (!rec) return 'missing-grok';
    const access = String(rec.key || rec.access_token || '').trim();
    const refresh = String(rec.refresh_token || '').trim();
    hermes.providers = hermes.providers && typeof hermes.providers === 'object' ? hermes.providers : {};
    hermes.providers['xai-oauth'] = {
      auth_mode: String(rec.auth_mode || 'oidc'),
      tokens: {
        access_token: access,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_at: rec.expires_at || undefined,
      },
      last_refresh: new Date().toISOString(),
    };
    hermes.updated_at = new Date().toISOString();
    writeJsonAtomic(hermesFile, hermes);
    return 'imported';
  } catch {
    return 'error';
  }
}

module.exports = { ensureHermesXaiOauth, grokAuthPath, hermesAuthPath };
