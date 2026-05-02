import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, supplierKey, searchText } from './schema.js';
import { getVendorRows, isLocked } from './vendors.js';
import { loadKeywords } from './keywords.js';

const PATTERN_MIN_COUNT = 3;
const PATTERN_MIN_SHARE = 0.7;
const AI_CONFIDENCE_CAP = 0.7;

let _client;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function classify({
  company_id,
  supplier,
  description,
  items,
  amount,
}) {
  if (!company_id) throw new Error('company_id required for classification');
  const reasons = [];
  const sk = supplierKey(supplier);

  // 1. Vendor lookup (locked rule, then frequency-based pattern)
  const vrows = sk ? await getVendorRows(company_id, sk) : [];
  const locked = vrows.find(isLocked);
  if (locked) {
    return {
      category: locked.category,
      subcategory: '',
      confidence: 1.0,
      classified_by: 'rule',
      reasons: [`vendor locked → ${locked.category}`],
    };
  }
  if (vrows.length > 0) {
    const total = vrows.reduce((s, r) => s + Number(r.count || 0), 0);
    const top = vrows
      .slice()
      .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
    const topCount = Number(top.count || 0);
    const share = total > 0 ? topCount / total : 0;
    if (topCount >= PATTERN_MIN_COUNT && share >= PATTERN_MIN_SHARE) {
      return {
        category: top.category,
        subcategory: '',
        confidence: Number(share.toFixed(2)),
        classified_by: 'pattern',
        reasons: [`vendor history ${topCount}/${total} → ${top.category}`],
      };
    }
    reasons.push(`vendor history inconclusive (${topCount}/${total})`);
  }

  // 2. Keyword rules (first match on combined supplier+description+items text)
  const text = searchText({ supplier, description, items });
  if (text.trim()) {
    const kws = await loadKeywords(company_id);
    for (const k of kws) {
      const kw = String(k.keyword || '').toLowerCase().trim();
      if (kw && text.includes(kw)) {
        return {
          category: k.category,
          subcategory: k.subcategory || '',
          confidence: 0.7,
          classified_by: 'rule',
          reasons: [...reasons, `keyword "${k.keyword}" → ${k.category}`],
        };
      }
    }
  }

  // 3. AI fallback
  try {
    const ai = await aiClassify({ supplier, description, items, amount });
    if (ai && CATEGORIES.includes(ai.category)) {
      return {
        category: ai.category,
        subcategory: ai.subcategory || '',
        confidence: Math.min(AI_CONFIDENCE_CAP, Number(ai.confidence) || 0.5),
        classified_by: 'ai',
        reasons: [...reasons, `ai: ${ai.reason || 'fallback'}`],
      };
    }
  } catch (e) {
    reasons.push(`ai error: ${e.message}`);
  }

  return {
    category: 'misc',
    subcategory: '',
    confidence: 0.2,
    classified_by: 'ai',
    reasons: [...reasons, 'default → misc'],
  };
}

async function aiClassify({ supplier, description, items, amount }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const itemsText =
    Array.isArray(items) && items.length
      ? items
          .map(
            (it) =>
              `- ${it.name || ''}${it.qty ? ` (qty ${it.qty})` : ''}`,
          )
          .join('\n')
      : '(none)';
  const prompt = `Classify this purchase into ONE of: ${CATEGORIES.join(', ')}.

Supplier: ${supplier || ''}
Amount: ${amount || ''}
Description: ${description || ''}
Items:
${itemsText}

Return ONLY valid JSON:
{"category":"<one of the enum>","subcategory":"<short label>","confidence":<number 0..1>,"reason":"<short>"}`;
  const msg = await client().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content[0].text.trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  return JSON.parse(m[0]);
}
