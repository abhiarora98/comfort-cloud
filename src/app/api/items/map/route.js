import {
  addAlias,
  ensureRawMaterial,
} from '../../../../lib/purchases/items.js';

export const maxDuration = 30;

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      company_id,
      raw_name,
      canonical_name,
      source = 'user_picked',
      mapped_by = '',
      category = '',
      unit = '',
      notes = '',
    } = body || {};

    if (!company_id || !raw_name || !canonical_name) {
      return Response.json(
        { ok: false, error: 'company_id, raw_name, canonical_name required' },
        { status: 400 },
      );
    }

    // create_new also seeds RAW_MATERIALS so the canonical becomes
    // selectable from the dropdown for future mappings.
    if (source === 'create_new') {
      await ensureRawMaterial({
        company_id,
        canonical_name,
        category,
        unit,
        notes,
        created_by: mapped_by,
      });
    }
    await addAlias({ company_id, raw_name, canonical_name, source, mapped_by });

    return Response.json({ ok: true, canonical_name });
  } catch (e) {
    console.error('POST /api/items/map:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
