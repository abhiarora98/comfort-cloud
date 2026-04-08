import { google } from 'googleapis';

const SHEET_ID = '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';
const SHEET_NAME = 'PURCHASES';

async function getSheets() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeader(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SHEET_NAME}!A1:G1` });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Supplier', 'Bill No', 'Amount', 'Notes', 'Saved By', 'Saved At']] },
    });
  }
}

export async function POST(req) {
  try {
    const d = await req.json();
    const sheets = await getSheets();
    await ensureHeader(sheets);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[d.date, d.supplier, d.billNo, d.amount, d.notes, d.savedBy, d.savedAt]] },
    });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('save-purchase error:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
