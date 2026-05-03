import { ingestPurchasesBulk } from '../../../../lib/purchases/purchases.js';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(items)) {
      return Response.json(
        { ok: false, error: 'expected array body or { items: [] }' },
        { status: 400 },
      );
    }
    const savedBy = body && !Array.isArray(body) ? body.saved_by : undefined;
    const { summary, results, errors } = await ingestPurchasesBulk(items, { savedBy });
    return Response.json({ ok: true, summary, results, errors });
  } catch (e) {
    console.error('POST /api/purchases/bulk:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
