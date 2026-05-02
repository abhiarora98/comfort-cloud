import {
  findById,
  updatePurchaseFields,
} from '../../../../lib/purchases/purchases.js';
import { isCategory } from '../../../../lib/purchases/schema.js';
import { recordCorrection } from '../../../../lib/purchases/corrections.js';
import { bumpVendor } from '../../../../lib/purchases/vendors.js';

export const maxDuration = 30;

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const existing = await findById(id);
    if (!existing) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }

    const allowed = [
      'date',
      'supplier_original',
      'supplier',
      'supplier_key',
      'bill_no',
      'amount',
      'description',
      'photo_url',
      'category',
      'subcategory',
      'is_matched_with_tally',
      'verified',
      'mismatches',
    ];
    const partial = {};
    for (const k of allowed) {
      if (k in body) partial[k] = body[k];
    }

    const categoryChanged =
      'category' in partial && partial.category !== existing.category;

    if (categoryChanged) {
      if (!isCategory(partial.category)) {
        return Response.json(
          { ok: false, error: `invalid category: ${partial.category}` },
          { status: 400 },
        );
      }
      partial.user_corrected = true;
      partial.classified_by = 'user';
      partial.confidence = 1.0;
      partial.previous_category = existing.category;
    }

    const updated = await updatePurchaseFields(id, partial);

    if (categoryChanged) {
      await recordCorrection({
        company_id: existing.company_id,
        purchase_id: id,
        supplier_key: existing.supplier_key,
        original_category: existing.category,
        original_classified_by: existing.classified_by,
        corrected_category: partial.category,
        corrected_by: body.corrected_by || '',
      });
      await bumpVendor({
        company_id: existing.company_id,
        supplier_key: existing.supplier_key,
        category: partial.category,
        amount: existing.amount,
      });
    }

    return Response.json({ ok: true, purchase: updated, learned: categoryChanged });
  } catch (e) {
    console.error('PATCH /api/purchases/[id]:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
