import { TABS, readRows, appendRow, updateRow } from './sheets.js';
import {
  makeId,
  normalizeSupplier,
  supplierKey,
  validatePurchase,
} from './schema.js';
import { classify } from './classifier.js';

function pickBillNo(input) {
  return input.bill_no || input.billNo || '';
}

function pickPhotoUrl(input) {
  return input.photo_url || input.photoUrl || '';
}

function pickDescription(input) {
  return input.description || input.notes || '';
}

export async function findById(id) {
  const rows = await readRows(TABS.purchases);
  return rows.find((r) => r.id === id) || null;
}

export async function ingestPurchase(input, { savedBy } = {}) {
  const supplier_original = String(
    input.supplier_original || input.supplier || '',
  ).trim();
  const supplier = normalizeSupplier(supplier_original);
  const supplier_key = supplierKey(supplier_original);
  const source = input.source || 'manual';
  const bill_no = pickBillNo(input);
  const id = makeId(input.company_id, source, bill_no, input.date);

  const existing = await findById(id);
  if (existing) {
    return { id, status: 'duplicate', purchase: existing };
  }

  const items = Array.isArray(input.items) ? input.items : null;

  const purchase = {
    id,
    company_id: input.company_id,
    date: input.date,
    supplier_original,
    supplier,
    supplier_key,
    bill_no,
    amount: input.amount || '',
    items_json: items ? JSON.stringify(items) : '',
    description: pickDescription(input),
    source,
    photo_url: pickPhotoUrl(input),
    is_matched_with_tally: !!input.is_matched_with_tally,
    verified: input.verified || '',
    mismatches: input.mismatches || '',
    saved_by: savedBy || input.saved_by || '',
    saved_at: new Date().toISOString(),
    user_corrected: false,
    previous_category: '',
  };
  validatePurchase(purchase);

  const c = await classify({
    company_id: purchase.company_id,
    supplier: purchase.supplier,
    description: purchase.description,
    items,
    amount: purchase.amount,
  });
  purchase.category = c.category;
  purchase.subcategory = c.subcategory;
  purchase.confidence = c.confidence;
  purchase.classified_by = c.classified_by;

  await appendRow(TABS.purchases, purchase);
  return { id, status: 'created', purchase, classification: c };
}

export async function updatePurchaseFields(id, partial) {
  const row = await findById(id);
  if (!row) return null;
  await updateRow(TABS.purchases, row._row, partial);
  return { ...row, ...partial };
}
