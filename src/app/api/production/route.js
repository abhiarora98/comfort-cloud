import { google } from 'googleapis';

export const maxDuration = 15;

const PROD_SHEET_ID = '1mBIQJPWcbs9EpI1-sptKlOGkRIO04GG0aKBLUHMONQg';
const SECTION_SHEETS = {
  'Mixing': 'Mixing',
  'Mixing (Glue)': 'Mixing (Glue)',
  'Mixing (Sheet)': 'Mixing (Sheet)',
};

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

async function ensureHeaders(sheets, sheetName) {
  // No headers needed — sheet has material names in rows 1-11, data appends after
}

// POST — save entries
export async function POST(req) {
  try {
    const { entries, user } = await req.json();
    if (!entries || !entries.length) {
      return Response.json({ error: 'No entries' }, { status: 400 });
    }

    const sheets = await getSheets();

    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const userName = user || 'unknown';

    const valid = entries.filter(e => e.qty > 0);
    if (valid.length === 0) {
      return Response.json({ error: 'No quantities entered' }, { status: 400 });
    }

    // Group by section → sheet tab
    const bySheet = {};
    valid.forEach(e => {
      const sheetName = SECTION_SHEETS[e.section];
      if (!sheetName) return;
      if (!bySheet[sheetName]) bySheet[sheetName] = [];
      bySheet[sheetName].push([date, time, e.line || '', e.product || '', e.shift || '', e.color || '', e.material, e.qty, userName]);
    });

    let totalSaved = 0;
    for (const [sheetName, rows] of Object.entries(bySheet)) {
      await ensureHeaders(sheets, sheetName);
      await sheets.spreadsheets.values.append({
        spreadsheetId: PROD_SHEET_ID,
        range: `'${sheetName}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
      totalSaved += rows.length;
    }

    return Response.json({ ok: true, saved: totalSaved });
  } catch (err) {
    console.error('Production save error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

// GET — read all entries for insights
export async function GET() {
  try {
    const sheets = await getSheets();
    const allEntries = [];

    for (const [section, sheetName] of Object.entries(SECTION_SHEETS)) {
      try {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: PROD_SHEET_ID,
          range: `'${sheetName}'!A:I`,
        });
        const rows = res.data.values || [];
        if (rows.length === 0) continue;
        // New format: A=Date B=Time C=Line D=Product E=Shift F=Colour G=Material H=Qty I=User
        // Old format: A=Date B=Time C=Line D=Product E=Colour F=Material G=Qty H=User
        rows.forEach(r => {
          const dateVal = (r[0] || '').trim();
          if (!dateVal || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateVal)) return;
          // Detect format: if column E starts with "Day" or "Night", it's new format
          const colE = (r[4] || '').trim();
          const isNewFormat = colE.startsWith('Day') || colE.startsWith('Night');
          let shift = '', color = '', material = '', qty = 0, user = '';
          if (isNewFormat) {
            shift = colE;
            color = (r[5] || '').trim();
            material = (r[6] || '').trim();
            qty = parseFloat(r[7]) || 0;
            user = (r[8] || '').trim();
          } else {
            color = colE;
            material = (r[5] || '').trim();
            qty = parseFloat(r[6]) || 0;
            user = (r[7] || '').trim();
          }
          if (!material) return;
          allEntries.push({
            date: dateVal,
            time: (r[1] || '').trim(),
            section: section,
            line: (r[2] || '').trim(),
            product: (r[3] || '').trim(),
            shift: shift,
            color: color,
            material: material,
            qty: qty,
            user: user,
          });
        });
      } catch {}
    }

    return Response.json({
      entries: allEntries,
      materials: { all: MIXING_ALL, glue: MIXING_GLUE, sheet: MIXING_SHEET },
    });
  } catch (err) {
    console.error('Production read error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
