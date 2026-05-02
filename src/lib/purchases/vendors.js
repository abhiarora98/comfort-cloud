import { TABS, readRows, appendRow, updateRow } from './sheets.js';

const CACHE_MS = 60_000;
let cache = { t: 0, rows: null };

async function allRows() {
  if (cache.rows && Date.now() - cache.t < CACHE_MS) return cache.rows;
  cache = { t: Date.now(), rows: await readRows(TABS.vendors) };
  return cache.rows;
}

function invalidate() {
  cache = { t: 0, rows: null };
}

function isLocked(row) {
  return String(row.locked || '').toUpperCase() === 'TRUE';
}

export async function getVendorRows(company_id, supplier_key) {
  const rows = await allRows();
  return rows.filter(
    (r) => r.company_id === company_id && r.supplier_key === supplier_key,
  );
}

export async function bumpVendor({
  company_id,
  supplier_key,
  category,
  amount,
}) {
  const rows = await allRows();
  const found = rows.find(
    (r) =>
      r.company_id === company_id &&
      r.supplier_key === supplier_key &&
      r.category === category,
  );
  const today = new Date().toISOString().slice(0, 10);
  const inc = Number(amount || 0);
  if (found) {
    await updateRow(TABS.vendors, found._row, {
      count: Number(found.count || 0) + 1,
      last_seen: today,
      total_amount: Number(found.total_amount || 0) + inc,
    });
  } else {
    await appendRow(TABS.vendors, {
      company_id,
      supplier_key,
      category,
      count: 1,
      last_seen: today,
      total_amount: inc,
      locked: false,
      locked_by: '',
      locked_at: '',
    });
  }
  invalidate();
}

export async function lockVendor({
  company_id,
  supplier_key,
  category,
  locked,
  by,
}) {
  const rows = await allRows();
  const found = rows.find(
    (r) =>
      r.company_id === company_id &&
      r.supplier_key === supplier_key &&
      r.category === category,
  );
  const now = new Date().toISOString();
  if (found) {
    await updateRow(TABS.vendors, found._row, {
      locked: !!locked,
      locked_by: locked ? by || '' : '',
      locked_at: locked ? now : '',
    });
  } else {
    await appendRow(TABS.vendors, {
      company_id,
      supplier_key,
      category,
      count: 0,
      last_seen: '',
      total_amount: 0,
      locked: !!locked,
      locked_by: locked ? by || '' : '',
      locked_at: locked ? now : '',
    });
  }
  invalidate();
}

export { isLocked };
