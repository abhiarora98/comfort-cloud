import { ingestPurchase } from '../../../../lib/purchases/purchases.js';

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
    const results = [];
    // Sequential — keeps Sheets writes ordered and avoids vendor-cache races.
    for (const input of items) {
      try {
        const r = await ingestPurchase(
          { ...input, saved_by: input.saved_by || savedBy },
          { savedBy: input.saved_by || savedBy },
        );
        results.push({ id: r.id, status: r.status });
      } catch (e) {
        results.push({ status: 'error', error: e.message });
      }
    }
    const summary = {
      created: results.filter((r) => r.status === 'created').length,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      errors: results.filter((r) => r.status === 'error').length,
    };
    return Response.json({ ok: true, summary, results });
  } catch (e) {
    console.error('POST /api/purchases/bulk:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
