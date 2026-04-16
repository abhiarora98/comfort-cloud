import { google } from 'googleapis';

export const maxDuration = 15;

const PROD_SHEET_ID = '1mBIQJPWcbs9EpI1-sptKlOGkRIO04GG0aKBLUHMONQg';
const SHEET_NAME = 'Sheet1';

const MIXING_ALL = ['PVC','SCRAP','CALCIUM','DOP','CPW','ADIL','EPOXY','STERIC ACID','FINOWAX','TITANIUM','HEAT STB.'];
const MIXING_GLUE = ['PVC PASTE','DOP','CPW','MTO','DBP','D80'];
const MIXING_SHEET = ['SCRAP','CALCIUM','DOP','STERIC ACID','CPW'];

async function getSheets() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  let key;
  try { key = JSON.parse(raw); } catch { key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaders(sheets) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PROD_SHEET_ID,
      range: `${SHEET_NAME}!A1:F1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: PROD_SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['Date', 'Time', 'Section', 'Material', 'Quantity (kg)', 'Entered By']] },
      });
    }
  } catch {
    await sheets.spreadsheets.values.update({
      spreadsheetId: PROD_SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Time', 'Section', 'Material', 'Quantity (kg)', 'Entered By']] },
    });
  }
}

// POST — save entries
export async function POST(req) {
  try {
    const { entries, user } = await req.json();
    if (!entries || !entries.length) {
      return Response.json({ error: 'No entries' }, { status: 400 });
    }

    const sheets = await getSheets();
    await ensureHeaders(sheets);

    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const userName = user || 'unknown';

    const rows = entries
      .filter(e => e.qty > 0)
      .map(e => [date, time, e.section, e.material, e.qty, userName]);

    if (rows.length === 0) {
      return Response.json({ error: 'No quantities entered' }, { status: 400 });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: PROD_SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    return Response.json({ ok: true, saved: rows.length });
  } catch (err) {
    console.error('Production save error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET — read all entries for insights
export async function GET() {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: PROD_SHEET_ID,
      range: `${SHEET_NAME}!A:F`,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return Response.json({ entries: [], materials: { all: MIXING_ALL, glue: MIXING_GLUE, sheet: MIXING_SHEET } });
    }

    const entries = rows.slice(1).map(r => ({
      date: r[0] || '',
      time: r[1] || '',
      section: r[2] || '',
      material: r[3] || '',
      qty: parseFloat(r[4]) || 0,
      user: r[5] || '',
    }));

    return Response.json({
      entries,
      materials: { all: MIXING_ALL, glue: MIXING_GLUE, sheet: MIXING_SHEET },
    });
  } catch (err) {
    console.error('Production read error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
