import { put } from '@vercel/blob';

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 });

    const blob = await put(`bills/${Date.now()}-${file.name}`, file, { access: 'public' });
    return Response.json({ url: blob.url });
  } catch (e) {
    console.error('upload-bill-photo error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
