export async function POST(req) {
  try {
    const body = await req.json();
    const scriptUrl = process.env.PURCHASES_SCRIPT_URL;
    if (!scriptUrl) return Response.json({ error: 'PURCHASES_SCRIPT_URL not set' }, { status: 500 });

    const resp = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    try {
      return Response.json(JSON.parse(text));
    } catch {
      return Response.json({ ok: true });
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
