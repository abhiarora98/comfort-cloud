import { getSheetsClient } from './sheets.js';

// Lives in a separate spreadsheet from PURCHASES_V2 — that ID is hardcoded
// in src/app/api/production/route.js and we mirror it here.
const PROD_SHEET_ID = '1mBIQJPWcbs9EpI1-sptKlOGkRIO04GG0aKBLUHMONQg';

const SECTION_SHEETS = {
  'Mixing': 'Mixing',
  'Mixing (Glue)': 'Mixing (Glue)',
  'Mixing (Sheet)': 'Mixing (Sheet)',
};

// Master lists — the canonical roster per section. Mirrors the constants in
// production/route.js. Entry rows below contribute any additional materials
// that have actually been used so newly-introduced names show up too.
const MASTERS = {
  'Mixing':         ['PVC', 'SCRAP', 'CALCIUM', 'DOP', 'CPW', 'ADIL', 'EPOXY', 'STERIC ACID', 'FINOWAX', 'TITANIUM', 'HEAT STB.'],
  'Mixing (Glue)':  ['PVC PASTE', 'DOP', 'CPW', 'MTO', 'DBP', 'D80'],
  'Mixing (Sheet)': ['SCRAP', 'CALCIUM', 'DOP', 'STERIC ACID', 'CPW'],
};

let cache = null;
const TTL_MS = 5 * 60 * 1000;

export function clearProductionMaterialsCache() { cache = null; }

export async function getProductionMaterials() {
  if (cache && Date.now() - cache.t < TTL_MS) return cache.data;

  const sheets = await getSheetsClient();
  const all = new Set();
  const bySection = {};

  for (const [section, sheetName] of Object.entries(SECTION_SHEETS)) {
    const seen = new Set();
    for (const m of MASTERS[section] || []) { all.add(m); seen.add(m); }
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: PROD_SHEET_ID,
        range: `'${sheetName}'!A:H`,
      });
      const rows = res.data.values || [];
      for (const r of rows) {
        const dateVal = (r[0] || '').trim();
        if (!dateVal || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateVal)) continue;
        // Same heuristic as production/route.js: column E ("Day"/"Night")
        // distinguishes the new schema where material lives in column G;
        // older rows put it in column F.
        const colE = (r[4] || '').trim();
        const isNew = colE.startsWith('Day') || colE.startsWith('Night');
        const material = isNew ? (r[6] || '').trim() : (r[5] || '').trim();
        if (material) { all.add(material); seen.add(material); }
      }
    } catch (e) {
      console.warn(`production-materials: failed to read ${sheetName}:`, e.message);
    }
    bySection[section] = [...seen].sort();
  }

  const data = { materials: [...all].sort(), by_section: bySection };
  cache = { t: Date.now(), data };
  return data;
}
