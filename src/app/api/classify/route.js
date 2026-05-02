import { classify } from '../../../lib/purchases/classifier.js';

export const maxDuration = 30;

export async function POST(req) {
  try {
    const body = await req.json();
    const result = await classify({
      company_id: body.company_id,
      supplier: body.supplier,
      description: body.description,
      items: body.items,
      amount: body.amount,
    });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error('POST /api/classify:', e);
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
