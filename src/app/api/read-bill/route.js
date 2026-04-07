import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req) {
  try {
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) return Response.json({ error: 'No image provided' }, { status: 400 });

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
            text: `You are reading a purchase bill/invoice. Extract the following fields and return ONLY valid JSON, no explanation:
{
  "supplier": "supplier or vendor name",
  "billNo": "invoice or bill number",
  "date": "date in YYYY-MM-DD format",
  "amount": "total amount as a number string, no currency symbol",
  "notes": "any item description or notes (brief, max 100 chars)"
}
If a field is not found, use an empty string. For date, convert any format to YYYY-MM-DD.`,
          },
        ],
      }],
    });

    const text = msg.content[0].text.trim();
    // Extract JSON even if wrapped in markdown code block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return Response.json({ error: 'Could not parse response' }, { status: 500 });
    const data = JSON.parse(jsonMatch[0]);
    return Response.json(data);
  } catch (e) {
    console.error('read-bill error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
