import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req) {
  try {
    const { imageBase64, mediaType, form } = await req.json();
    if (!imageBase64) return Response.json({ error: 'No image' }, { status: 400 });

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 },
          },
          {
            type: 'text',
            text: `Compare the bill/invoice in the image against the details entered by the user.

User entered:
- Supplier: ${form.supplier || '(empty)'}
- Bill No: ${form.billNo || '(empty)'}
- Date: ${form.date || '(empty)'}
- Amount: ${form.amount || '(empty)'}

Check each field against what's visible in the bill. Return ONLY valid JSON:
{
  "match": true/false,
  "mismatches": [
    { "field": "field name", "entered": "what user typed", "onBill": "what bill shows" }
  ]
}
Only include fields in mismatches where there is a clear discrepancy. If a field is empty or not visible on the bill, do not flag it. Return match: true if no discrepancies found.`,
          },
        ],
      }],
    });

    const text = msg.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ match: true, mismatches: [] });
    return Response.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    console.error('verify-bill error:', e);
    return Response.json({ match: true, mismatches: [] }); // fail open
  }
}
