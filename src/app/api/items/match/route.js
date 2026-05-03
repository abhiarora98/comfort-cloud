import Anthropic from '@anthropic-ai/sdk';
import {
  findAlias,
  normRawKey,
} from '../../../../lib/purchases/items.js';
import { getProductionMaterials } from '../../../../lib/purchases/productionMaterials.js';

export const maxDuration = 30;

let _client;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function POST(req) {
  try {
    const { company_id, raw_name } = await req.json();
    if (!company_id || !raw_name) {
      return Response.json({ ok: false, error: 'company_id and raw_name required' }, { status: 400 });
    }

    // Already-mapped items short-circuit (no AI call).
    const existing = await findAlias(company_id, raw_name);
    if (existing) {
      return Response.json({
        ok: true,
        already_mapped: true,
        canonical_name: existing.canonical_name,
        suggestions: [{ canonical_name: existing.canonical_name, confidence: 1, reason: 'previously mapped' }],
      });
    }

    const { materials } = await getProductionMaterials();
    if (!materials || materials.length === 0) {
      return Response.json({ ok: true, suggestions: [], reason: 'no production materials found' });
    }

    // Cheap exact-normalized match before falling back to the AI.
    const rawKey = normRawKey(raw_name);
    const exact = materials.find((m) => normRawKey(m) === rawKey);
    if (exact) {
      return Response.json({
        ok: true,
        suggestions: [{ canonical_name: exact, confidence: 0.99, reason: 'exact normalized match' }],
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ ok: true, suggestions: [], reason: 'no ANTHROPIC_API_KEY' });
    }

    const list = materials.map((m) => `- ${m}`).join('\n');
    const prompt = `Match a noisy purchase item name to a raw material from the production list. Return up to 3 best matches, ordered by confidence. If nothing matches with reasonable confidence, return an empty array.

Raw item name from invoice: "${raw_name}"

Production raw materials:
${list}

Return ONLY valid JSON in this shape:
{"suggestions": [{"canonical_name": "<exact name from list>", "confidence": <0..1>, "reason": "<short>"}]}`;

    const msg = await client().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0].text.trim();
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = { suggestions: [] };
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* fall through */ }
    }
    const validNames = new Set(materials);
    const suggestions = (parsed.suggestions || [])
      .filter((s) => s && validNames.has(s.canonical_name))
      .slice(0, 3)
      .map((s) => ({
        canonical_name: s.canonical_name,
        confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0)),
        reason: String(s.reason || '').slice(0, 100),
      }));
    return Response.json({ ok: true, suggestions });
  } catch (e) {
    console.error('POST /api/items/match:', e);
    return Response.json({ ok: false, error: e.message, suggestions: [] }, { status: 500 });
  }
}
