import { TABS, readRows, appendRow, appendRows, updateRow } from './sheets.js';
import {
  isCategory,
  makeId,
  normalizeSupplier,
  supplierKey,
  validatePurchase,
} from './schema.js';
import { classify } from './classifier.js';
import { bumpVendor } from './vendors.js';

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

// Build a fully-formed purchase record from raw input — no I/O.
// Returns { purchase, items, supplier_key, userPicked } where:
//   purchase    — the normalized object ready to write (minus classification)
//   items       — parsed items[] (used for classification)
//   supplier_key — normalized supplier key (also used for vendor bump)
//   userPicked  — true if input.user_category should override the classifier
export function buildPurchaseRecord(input, { savedBy } = {}) {
  const supplier_original = String(
    input.supplier_original || input.supplier || '',
  ).trim();
  const supplier = normalizeSupplier(supplier_original);
  const supplier_key = supplierKey(supplier_original);
  const source = input.source || 'manual';
  const bill_no = pickBillNo(input);
  const id = makeId(input.company_id, source, bill_no, input.date);

  const items = Array.isArray(input.items) ? input.items : null;
  const is_matched_with_tally = !!input.is_matched_with_tally;
  const approval_status =
    source === 'invoice' && !is_matched_with_tally ? 'pending' : '';

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
    is_matched_with_tally,
    verified: input.verified || '',
    mismatches: input.mismatches || '',
    saved_by: savedBy || input.saved_by || '',
    saved_at: new Date().toISOString(),
    user_corrected: false,
    previous_category: '',
    approval_status,
    approved_by: '',
    approved_at: '',
    gst_amount: input.gst_amount || '',
    gst_details: input.gst_details
      ? (typeof input.gst_details === 'string' ? input.gst_details : JSON.stringify(input.gst_details))
      : '',
  };
  validatePurchase(purchase);

  const userPicked = !!(input.user_category && isCategory(input.user_category));
  return { purchase, items, supplier_key, userPicked, userCategory: input.user_category, subcategory: input.subcategory };
}

export async function ingestPurchase(input, { savedBy } = {}) {
  const { purchase, items, supplier_key, userPicked, userCategory, subcategory } =
    buildPurchaseRecord(input, { savedBy });

  const existing = await findById(purchase.id);
  if (existing) {
    return { id: purchase.id, status: 'duplicate', purchase: existing };
  }

  let c;
  if (userPicked) {
    c = {
      category: userCategory,
      subcategory: subcategory || '',
      confidence: 1.0,
      classified_by: 'user',
      reasons: ['user-picked at ingest'],
    };
  } else {
    c = await classify({
      company_id: purchase.company_id,
      supplier: purchase.supplier,
      description: purchase.description,
      items,
      amount: purchase.amount,
    });
  }
  purchase.category = c.category;
  purchase.subcategory = c.subcategory;
  purchase.confidence = c.confidence;
  purchase.classified_by = c.classified_by;

  await appendRow(TABS.purchases, purchase);

  if (userPicked && supplier_key) {
    try {
      await bumpVendor({
        company_id: purchase.company_id,
        supplier_key,
        category: purchase.category,
        amount: purchase.amount,
      });
    } catch (e) {
      console.error('bumpVendor failed at ingest:', e);
    }
  }

  return { id: purchase.id, status: 'created', purchase, classification: c };
}

// Single-pass bulk ingest. One Sheets read for dedupe, classification
// runs in parallel chunks, one Sheets append for everything new.
//
// Steps:
//   1. Build all purchase records in memory (no I/O).
//   2. Read PURCHASES_V2 once → set of existing ids.
//   3. Filter out duplicates and de-dupe within this batch.
//   4. Classify in parallel chunks (concurrency capped to avoid AI rate limits).
//   5. One batch append of all new rows.
//   6. Bump vendor memory for user-picked rows (best-effort, sequential).
export async function ingestPurchasesBulk(inputs, { savedBy, concurrency = 5 } = {}) {
  const t0 = Date.now();
  const total = inputs.length;
  const results = [];
  const built = [];
  const errors = [];

  for (const input of inputs) {
    try {
      built.push(buildPurchaseRecord({ ...input, saved_by: input.saved_by || savedBy }, { savedBy: input.saved_by || savedBy }));
    } catch (e) {
      errors.push({ status: 'error', error: e.message });
    }
  }

  // Read existing ids ONCE.
  const existing = await readRows(TABS.purchases);
  const existingIds = new Set(existing.map((r) => r.id));

  const seenInBatch = new Set();
  const fresh = [];
  let duplicate = 0;
  for (const b of built) {
    if (existingIds.has(b.purchase.id) || seenInBatch.has(b.purchase.id)) {
      duplicate++;
      results.push({ id: b.purchase.id, status: 'duplicate' });
      continue;
    }
    seenInBatch.add(b.purchase.id);
    fresh.push(b);
  }

  // Classify with bounded concurrency. Capped at 5 to avoid hammering
  // the AI fallback while still cutting the 76-row run from ~60s
  // sequential to ~15s wall time.
  const tClassifyStart = Date.now();
  for (let i = 0; i < fresh.length; i += concurrency) {
    const chunk = fresh.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (b) => {
      try {
        let c;
        if (b.userPicked) {
          c = { category: b.userCategory, subcategory: b.subcategory || '', confidence: 1.0, classified_by: 'user' };
        } else {
          c = await classify({
            company_id: b.purchase.company_id,
            supplier: b.purchase.supplier,
            description: b.purchase.description,
            items: b.items,
            amount: b.purchase.amount,
          });
        }
        b.purchase.category = c.category;
        b.purchase.subcategory = c.subcategory;
        b.purchase.confidence = c.confidence;
        b.purchase.classified_by = c.classified_by;
      } catch (e) {
        // Classifier failure shouldn't drop the row — fall back to misc.
        b.purchase.category = 'misc';
        b.purchase.subcategory = '';
        b.purchase.confidence = 0.2;
        b.purchase.classified_by = 'ai';
        console.error('classify failed for', b.purchase.id, e.message);
      }
    }));
  }
  const classifyMs = Date.now() - tClassifyStart;

  // Single batch append for ALL fresh rows.
  const tAppendStart = Date.now();
  if (fresh.length > 0) {
    await appendRows(TABS.purchases, fresh.map((b) => b.purchase));
  }
  const appendMs = Date.now() - tAppendStart;

  for (const b of fresh) results.push({ id: b.purchase.id, status: 'created' });

  // Bump vendor memory for user-picked rows. Sequential to avoid cache
  // races; failures are tolerated.
  for (const b of fresh) {
    if (b.userPicked && b.supplier_key) {
      try {
        await bumpVendor({
          company_id: b.purchase.company_id,
          supplier_key: b.supplier_key,
          category: b.purchase.category,
          amount: b.purchase.amount,
        });
      } catch (e) {
        console.error('bumpVendor failed for', b.purchase.id, e.message);
      }
    }
  }

  const summary = {
    total,
    created: fresh.length,
    duplicate,
    errors: errors.length,
    classifyMs,
    appendMs,
    totalMs: Date.now() - t0,
  };
  console.log('ingestPurchasesBulk:', summary);
  return { summary, results, errors };
}

export async function updatePurchaseFields(id, partial) {
  const row = await findById(id);
  if (!row) return null;
  await updateRow(TABS.purchases, row._row, partial);
  return { ...row, ...partial };
}

