import { google } from 'googleapis';

const SHEET_ID =
  process.env.PURCHASES_SHEET_ID || '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';

let _client;

export async function getSheetsClient() {
  if (_client) return _client;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    key = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  _client = google.sheets({ version: 'v4', auth });
  return _client;
}

export const TABS = {
  purchases: {
    name: 'PURCHASES_V2',
    headers: [
      'id',
      'company_id',
      'date',
      'supplier_original',
      'supplier',
      'supplier_key',
      'bill_no',
      'amount',
      'items_json',
      'description',
      'source',
      'photo_url',
      'category',
      'subcategory',
      'confidence',
      'classified_by',
      'user_corrected',
      'previous_category',
      'is_matched_with_tally',
      'verified',
      'mismatches',
      'saved_by',
      'saved_at',
      'approval_status',
      'approved_by',
      'approved_at',
    ],
  },
  vendors: {
    name: 'VENDORS',
    headers: [
      'company_id',
      'supplier_key',
      'category',
      'count',
      'last_seen',
      'total_amount',
      'locked',
      'locked_by',
      'locked_at',
    ],
  },
  keywords: {
    name: 'KEYWORDS',
    headers: ['company_id', 'keyword', 'category', 'subcategory'],
  },
  corrections: {
    name: 'CORRECTIONS',
    headers: [
      'company_id',
      'purchase_id',
      'supplier_key',
      'original_category',
      'original_classified_by',
      'corrected_category',
      'corrected_at',
      'corrected_by',
    ],
  },
};

const _ensured = new Set();

async function ensureTab(tab) {
  if (_ensured.has(tab.name)) return;
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = meta.data.sheets.some((s) => s.properties.title === tab.name);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tab.name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [tab.headers] },
    });
  } else {
    // Reconcile: if existing header row is a strict prefix of our headers
    // (i.e. only missing trailing columns), append the new ones. If a user
    // has reordered or renamed headers, leave them alone.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tab.name}!1:1`,
    });
    const existing = (res.data.values?.[0] || []).map((h) =>
      String(h || '').trim(),
    );
    const isPrefix =
      existing.length < tab.headers.length &&
      existing.every((h, i) => h === tab.headers[i]);
    if (isPrefix) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab.name}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [tab.headers] },
      });
    }
  }
  _ensured.add(tab.name);
}

function serializeValue(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function rowToObject(headers, row, sheetRowNumber) {
  const obj = { _row: sheetRowNumber };
  headers.forEach((h, i) => {
    obj[h] = row[i] ?? '';
  });
  return obj;
}

export async function readRows(tab) {
  await ensureTab(tab);
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A1:ZZ`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const [, ...data] = rows;
  return data.map((r, i) => rowToObject(tab.headers, r, i + 2));
}

export async function appendRow(tab, obj) {
  await ensureTab(tab);
  const sheets = await getSheetsClient();
  const row = tab.headers.map((h) => serializeValue(obj[h]));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

export async function updateRow(tab, rowNumber, partial) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A${rowNumber}:ZZ${rowNumber}`,
  });
  const existing = res.data.values?.[0] || [];
  const merged = {};
  tab.headers.forEach((h, i) => {
    merged[h] = existing[i] ?? '';
  });
  Object.assign(merged, partial);
  const row = tab.headers.map((h) => serializeValue(merged[h]));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tab.name}!A${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}
