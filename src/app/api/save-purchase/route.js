import { google } from 'googleapis';

const SHEET_ID = '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';
const SHEET_NAME = 'PURCHASES';

async function getSheets() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  // Handle base64-encoded or raw JSON
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
  // Fix escaped newlines in private key
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Supplier', 'Bill No', 'Amount', 'Notes', 'Saved By', 'Saved At', 'Photo URL', 'Category', 'Verified', 'Mismatches']] },
    });
  }
}

export async function POST(req) {
  try {
    const d = await req.json();
    const sheets = await getSheets();
    await ensureSheet(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[d.date, d.supplier, d.billNo, d.amount, d.notes, d.savedBy, d.savedAt, d.photoUrl || '', d.category || '', d.verified || '', d.mismatches || '']] },
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('save-purchase error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
