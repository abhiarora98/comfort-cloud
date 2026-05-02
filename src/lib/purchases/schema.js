export const CATEGORIES = [
  'raw_materials',
  'consumables',
  'packaging',
  'services',
  'capex',
  'misc',
];

export const SOURCES = ['tally', 'invoice', 'manual'];

export function isCategory(c) {
  return CATEGORIES.includes(c);
}

export function isSource(s) {
  return SOURCES.includes(s);
}

export function normalizeSupplier(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

export function supplierKey(name) {
  return normalizeSupplier(name).toLowerCase();
}

// Combined text used for keyword matching: supplier + description + item names.
export function searchText({ supplier, description, items }) {
  const parts = [supplier || '', description || ''];
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it && typeof it === 'object' && it.name) parts.push(String(it.name));
    }
  }
  return parts.join(' ').toLowerCase();
}

function compactDate(date) {
  return String(date || '').replace(/-/g, '').slice(0, 8);
}

export function makeId(company_id, source, billNo, date) {
  return `${company_id}:${source}:${billNo}:${compactDate(date)}`;
}

export function validatePurchase(p) {
  if (!p.company_id) throw new Error('company_id required');
  if (!isSource(p.source)) throw new Error(`invalid source: ${p.source}`);
  if (!p.date) throw new Error('date required');
  if (!p.supplier_original) throw new Error('supplier_original required');
  if (!p.bill_no) throw new Error('bill_no required');
}
