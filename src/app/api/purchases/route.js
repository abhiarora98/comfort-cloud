import { ingestPurchase } from '../../../lib/purchases/purchases.js';

export const maxDuration = 30;

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await ingestPurchase(body, { savedBy: body.saved_by });
    const status = result.status === 'duplicate' ? 200 : 201;
    return Response.json({ ok: true, ...result }, { status });
  } catch (e) {
    console.error('POST /api/purchases:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
