import { getProductionMaterials } from '../../../lib/purchases/productionMaterials.js';

export const maxDuration = 15;

export async function GET() {
  try {
    const data = await getProductionMaterials();
    return Response.json({ ok: true, ...data });
  } catch (e) {
    console.error('GET /api/production-materials:', e);
    return Response.json(
      { ok: false, error: e.message, materials: [], by_section: {} },
      { status: 500 },
    );
  }
}
