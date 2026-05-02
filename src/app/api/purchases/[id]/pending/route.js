import {
  findById,
  updatePurchaseFields,
} from '../../../../../lib/purchases/purchases.js';

export const maxDuration = 30;

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const existing = await findById(id);
    if (!existing) {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }
    const updated = await updatePurchaseFields(id, {
      approval_status: 'pending',
      approved_by: '',
      approved_at: '',
    });
    return Response.json({ ok: true, purchase: updated });
  } catch (e) {
    console.error('pending:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
