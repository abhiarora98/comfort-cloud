import { TABS, readRows, appendRow } from './sheets.js';

// Same normalization the UI uses to compare raw item names. Kept inline so
// this module stays decoupled from the React page.
export function normRawKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const CACHE_MS = 60_000;
let aliasCache = { t: 0, rows: null };

async function allAliases() {
  if (aliasCache.rows && Date.now() - aliasCache.t < CACHE_MS) return aliasCache.rows;
  aliasCache = { t: Date.now(), rows: await readRows(TABS.item_aliases) };
  return aliasCache.rows;
}

function invalidateAliases() { aliasCache = { t: 0, rows: null }; }

export async function listAliases(company_id) {
  const rows = await allAliases();
  return rows.filter((r) => r.company_id === company_id);
}

export async function findAlias(company_id, raw_name) {
  const key = normRawKey(raw_name);
  const rows = await listAliases(company_id);
  return rows.find((r) => normRawKey(r.raw_name) === key) || null;
}

// Append-only: ITEM_ALIASES doubles as audit log.
export async function addAlias({
  company_id,
  raw_name,
  canonical_name,
  source = 'user_picked',
  mapped_by = '',
}) {
  if (!company_id || !raw_name || !canonical_name) {
    throw new Error('company_id, raw_name, canonical_name required');
  }
  await appendRow(TABS.item_aliases, {
    company_id,
    raw_name: String(raw_name).trim(),
    canonical_name: String(canonical_name).trim(),
    source,
    mapped_by,
    mapped_at: new Date().toISOString(),
  });
  invalidateAliases();
}
