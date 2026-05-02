import { TABS, readRows } from './sheets.js';

const CACHE_MS = 5 * 60_000;
let cache = { t: 0, rows: null };

export async function loadKeywords(company_id) {
  if (!cache.rows || Date.now() - cache.t > CACHE_MS) {
    cache = { t: Date.now(), rows: await readRows(TABS.keywords) };
  }
  return cache.rows.filter((r) => r.company_id === company_id);
}

export function invalidateKeywords() {
  cache = { t: 0, rows: null };
}
