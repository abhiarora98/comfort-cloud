import { addAlias } from '../../../../lib/purchases/items.js';
import { getProductionMaterials } from '../../../../lib/purchases/productionMaterials.js';

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
    } = body || {};

    if (!company_id || !raw_name || !canonical_name) {
      return Response.json(
        { ok: false, error: 'company_id, raw_name, canonical_name required' },
        { status: 400 },
      );
    }

    // No free text — canonical must come from the production materials list.
    const { materials } = await getProductionMaterials();
    if (!materials.includes(canonical_name)) {
      return Response.json(
        { ok: false, error: `canonical_name "${canonical_name}" is not a known production material` },
        { status: 400 },
      );
    }

    await addAlias({ company_id, raw_name, canonical_name, source, mapped_by });
    return Response.json({ ok: true, canonical_name });
  } catch (e) {
    console.error('POST /api/items/map:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
