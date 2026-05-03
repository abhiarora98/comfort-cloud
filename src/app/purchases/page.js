'use client';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect, useCallback, useRef } from 'react';

const MN = "'DM Mono', monospace";
const SN = "'Instrument Sans', sans-serif";
const SHEET_ID = '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';
const PURCHASES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=PURCHASES_V2`;
const ITEM_ALIASES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=ITEM_ALIASES`;

const COMPANY_ID = 'comfort';
const CATEGORIES = ['raw_materials', 'consumables', 'packaging', 'services', 'capex', 'misc'];
const CATEGORY_LABELS = {
  raw_materials: 'Raw Materials',
  consumables: 'Consumables',
  packaging: 'Packaging',
  services: 'Services',
  capex: 'Capex',
  misc: 'Misc',
};
const CAT_COLORS = {
  raw_materials: '#3b82f6',
  consumables: '#10b981',
  packaging: '#f59e0b',
  services: '#8b5cf6',
  capex: '#ef4444',
  misc: '#94a3b8',
};

// Priority is derived from amount alone — no backend storage.
const PRIORITY = {
  high:   { label: 'High',   color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
  medium: { label: 'Medium', color: '#b45309', bg: '#ffedd5', border: '#fed7aa' },
  low:    { label: 'Low',    color: '#0369a1', bg: '#dbeafe', border: '#bfdbfe' },
};
function priorityFor(amount) {
  const n = Number(amount) || 0;
  if (n >= 50000) return 'high';
  if (n >= 10000) return 'medium';
  return 'low';
}

const PENDING_REASON = 'No matching entry found in Tally';

// --- Manual Tally upload parser (CSV/Excel) -----------------------------
const COL_ALIASES = {
  date:     ['date', 'voucherdate', 'billdate', 'invoicedate', 'supplierinvoicedate', 'dated'],
  supplier: ['supplier', 'party', 'partyname', 'partyledger', 'partyledgername', 'vendor', 'name'],
  bill_no:  ['supplierinvoiceno', 'supplierinvoicenumber', 'invoiceno', 'invoicenumber', 'billno', 'billnumber', 'voucherno', 'vouchernumber', 'reference', 'refno', 'ref'],
  description: ['narration', 'description', 'remarks'],
  // Optional GST columns — pulled if present, never required.
  gst_amount: ['gstamount', 'taxamount', 'totaltax', 'gst', 'tax', 'gsttotal'],
  cgst:       ['cgst', 'cgstamount'],
  sgst:       ['sgst', 'sgstamount'],
  igst:       ['igst', 'igstamount'],
  gst_number: ['gstnumber', 'gstin', 'gstinuin', 'gstno', 'partygstin', 'partygst'],
  hsn:        ['hsn', 'hsncode', 'hsnno', 'hsnsac'],
  // Optional item-level columns. When present, rows are grouped by bill_no
  // into a single bill with an items[] array. "Particulars" is included as
  // a fallback for Tally Columnar Purchase Register exports where stock
  // items appear in that column alongside a separate Supplier column.
  item:       ['stockitem', 'itemname', 'productname', 'product', 'particulars'],
  qty:        ['quantity', 'qty', 'billedquantity'],
  rate:       ['rate', 'unitrate', 'unitprice'],
  item_value: ['itemvalue', 'lineamount', 'linetotal', 'value'],
  item_gst_pct: ['gstpercent', 'gstrate', 'taxrate'],
};
// Try in order; first non-zero per row wins. Order matters: in Tally
// Columnar Purchase Register the bill total lives in "Gross Total" and is
// repeated on every line, while "Value" is per-item value.
const AMOUNT_CANDIDATES = ['grosstotal', 'grossamount', 'netamount', 'amount', 'total', 'amountrs', 'credit', 'debit', 'value'];

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/[\s_\-./]/g, '').trim();
}

function findCol(normHeaders, aliases) {
  for (const a of aliases) {
    const i = normHeaders.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

function toIsoDate(v) {
  if (v === '' || v == null) return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY or DD-MM-YYYY (Indian/Tally default)
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    let yy = dmy[3];
    if (yy.length === 2) yy = (parseInt(yy, 10) < 50 ? '20' : '19') + yy;
    return `${yy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

async function parseTallyFile(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], error: 'No sheet in file' };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
  if (aoa.length < 2) return { rows: [], error: 'No data rows' };
  let headerIdx = aoa.findIndex(r => r.filter(c => String(c).trim()).length >= 3);
  if (headerIdx < 0) headerIdx = 0;
  const normHeaders = aoa[headerIdx].map(normHeader);

  const ix = {};
  for (const [k, aliases] of Object.entries(COL_ALIASES)) {
    ix[k] = findCol(normHeaders, aliases);
  }
  const missing = ['date', 'supplier', 'bill_no'].filter(k => ix[k] < 0);
  if (missing.length) return { rows: [], error: `Missing columns: ${missing.join(', ')}` };
  const amtIdxs = AMOUNT_CANDIDATES.map(a => normHeaders.indexOf(a)).filter(i => i >= 0);
  if (!amtIdxs.length) return { rows: [], error: 'No amount column (try Total, Amount, Credit, Debit, or Value)' };

  const num = (v) => parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')) || 0;
  const get = (r, c) => c >= 0 ? r[c] : undefined;
  const text = (r, c) => String(get(r, c) ?? '').trim();
  const moneyStr = (n) => Math.abs(n) > 0 ? Math.abs(n).toString() : '';

  const groups = new Map();
  let skipped = 0;
  let parsedInvoices = 0;

  // Detect a new voucher row by Voucher No / Bill No OR Supplier presence —
  // never just by Date, because Tally exports sometimes leave Date blank on
  // a voucher row and that used to make the row's items merge into the
  // previous voucher.
  let parent = null;
  let voucherIdx = 0;

  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const r = aoa[i];
    const rowSupplier = text(r, ix.supplier);
    const rowBillNo   = text(r, ix.bill_no);
    const rowDate     = toIsoDate(get(r, ix.date));
    const itemName    = text(r, ix.item);
    const isVoucherRow = !!(rowBillNo || rowSupplier);

    if (isVoucherRow) {
      voucherIdx++;
      parent = {
        idx: voucherIdx,
        supplier: rowSupplier || (parent && parent.supplier) || '',
        bill_no: rowBillNo || `auto-r${i + 1}`,
        bill_no_real: !!rowBillNo,
        date: rowDate || (parent && parent.date) || '',
      };
      parsedInvoices++;
      groups.set(parent.idx, {
        date: parent.date,
        supplier_original: parent.supplier,
        bill_no: parent.bill_no,
        amount: 0, gst_amount: 0, gstObj: {}, items: [],
        description: '',
      });
    } else if (!parent) {
      skipped++;
      continue;
    } else if (!itemName) {
      // No identifiers AND no item — likely a totals/separator row. Skip.
      skipped++;
      continue;
    }

    // Pick first non-zero amount candidate.
    let amount = 0;
    for (const ai of amtIdxs) {
      const v = num(r[ai]);
      if (Math.abs(v) > 0) { amount = Math.abs(v); break; }
    }

    const cgst = Math.abs(num(get(r, ix.cgst)));
    const sgst = Math.abs(num(get(r, ix.sgst)));
    const igst = Math.abs(num(get(r, ix.igst)));
    const gstTotal = Math.abs(num(get(r, ix.gst_amount))) || (cgst + sgst + igst);
    const gstNumber = text(r, ix.gst_number);
    const hsn = text(r, ix.hsn);

    let item = null;
    // Item rows only: a row that did NOT start a new voucher and has an
    // item name. Defensive: skip if the item name matches the voucher's
    // supplier (Tally sometimes writes the supplier name in Particulars
    // on a continuation row).
    const isItemRow = !isVoucherRow && itemName;
    const looksLikeSupplier = isItemRow && parent && parent.supplier
      && normItemKey(itemName) === normItemKey(parent.supplier);
    if (isItemRow && !looksLikeSupplier) {
      // Item amount: prefer the explicit per-line column ("Value" / "Item
      // Value" / "Line Amount"). If missing, scan the row for the largest
      // numeric cell — but skip the bill-total columns (those carry the
      // grand total, repeated on every row) and obvious non-amount cells.
      let itemAmt = Math.abs(num(get(r, ix.item_value)));
      if (!itemAmt) {
        const skipIdxs = new Set([
          ...amtIdxs,
          ix.cgst, ix.sgst, ix.igst, ix.gst_amount, ix.qty, ix.rate,
        ].filter(i => i >= 0));
        let max = 0;
        for (let ci = 0; ci < r.length; ci++) {
          if (skipIdxs.has(ci)) continue;
          const v = Math.abs(num(r[ci]));
          if (v > max) max = v;
        }
        itemAmt = max;
      }
      item = {
        name: itemName,
        qty: text(r, ix.qty),
        rate: moneyStr(num(get(r, ix.rate))),
        amount: itemAmt ? itemAmt.toString() : '',
        gst_pct: text(r, ix.item_gst_pct),
        hsn,
      };
    }
    const description = text(r, ix.description);

    // Each voucher gets its own group keyed by its monotonic index.
    // No merging across voucher boundaries.
    const g = groups.get(parent.idx);
    if (amount > g.amount) g.amount = amount;
    if (gstTotal > g.gst_amount) g.gst_amount = gstTotal;
    if (cgst && !g.gstObj.cgst) g.gstObj.cgst = String(cgst);
    if (sgst && !g.gstObj.sgst) g.gstObj.sgst = String(sgst);
    if (igst && !g.gstObj.igst) g.gstObj.igst = String(igst);
    if (gstNumber && !g.gstObj.gst_number) g.gstObj.gst_number = gstNumber;
    if (hsn && !g.gstObj.hsn) g.gstObj.hsn = hsn;
    if (description && !g.description) g.description = description;
    if (item) g.items.push(item);
  }

  const rows = [];
  let zeroAmount = 0;
  let itemLines = 0;
  let billsWithItems = 0;
  // Detect duplicate ingest-keys (supplier|bill_no|date) — these are real
  // collisions that the bulk endpoint will dedupe, NOT parser-side merging.
  const idSeen = new Map();
  let duplicateBillIds = 0;
  for (const g of groups.values()) {
    let amount = g.amount;
    if (!amount && g.items.length) {
      amount = g.items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
    }
    if (!amount) zeroAmount++;
    if (g.items.length) { itemLines += g.items.length; billsWithItems++; }
    const gst_details = Object.keys(g.gstObj).length ? JSON.stringify(g.gstObj) : '';
    const idKey = `${g.supplier_original}|${g.bill_no}|${g.date}`;
    const occ = (idSeen.get(idKey) || 0) + 1;
    idSeen.set(idKey, occ);
    if (occ > 1) duplicateBillIds++;
    rows.push({
      date: g.date,
      supplier_original: g.supplier_original,
      bill_no: g.bill_no,
      amount: amount ? amount.toString() : '',
      gst_amount: g.gst_amount ? g.gst_amount.toString() : '',
      gst_details,
      description: g.description || '',
      items: g.items.length ? g.items : undefined,
    });
  }

  const totalRows = aoa.length - headerIdx - 1;
  const result = {
    rows, skipped, zeroAmount, itemLines, billsWithItems,
    totalRows, parsedInvoices, duplicateBillIds,
    error: null,
  };
  console.log('parseTallyFile:', {
    totalRows, parsedInvoices, skipped,
    zeroAmount, itemLines, billsWithItems, duplicateBillIds,
  });
  return result;
}
// ------------------------------------------------------------------------

// --- Items aggregation (client-side) ------------------------------------

function normItemKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function avgIntervalDays(dates) {
  // dates: array of YYYY-MM-DD strings (already filtered to non-empty).
  const uniq = [...new Set(dates)].sort();
  if (uniq.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < uniq.length; i++) {
    const a = new Date(uniq[i - 1] + 'T00:00:00');
    const b = new Date(uniq[i] + 'T00:00:00');
    sum += (b - a) / (1000 * 60 * 60 * 24);
  }
  return sum / (uniq.length - 1);
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function aggregateItems(bills) {
  // groups: key → { display_name, lines: [{bill, line}] }
  const groups = new Map();
  for (const b of bills) {
    if (!b.items_json) continue;
    let items;
    try { items = JSON.parse(b.items_json); } catch { continue; }
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      if (!it || !it.name) continue;
      const key = normItemKey(it.name);
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, { key, display_name: String(it.name).trim(), lines: [] });
      }
      groups.get(key).lines.push({ bill: b, line: it });
    }
  }

  const result = [];
  for (const g of groups.values()) {
    // Sort lines by bill date, oldest → newest. Missing dates last.
    const sorted = g.lines.slice().sort((a, b) => {
      const da = a.bill.date || '9999-99-99';
      const db = b.bill.date || '9999-99-99';
      return da.localeCompare(db);
    });
    const total_qty = sorted.reduce((s, l) => s + (parseFloat(l.line.qty) || 0), 0);
    const total_spend = sorted.reduce((s, l) => s + (parseFloat(l.line.amount) || 0), 0);
    const billIds = new Set(sorted.map(l => l.bill.id || `${l.bill.supplier_key}|${l.bill.bill_no}|${l.bill.date}`));
    const last = sorted[sorted.length - 1];
    const last_date = last?.bill.date || '';
    const last_rate = parseFloat(last?.line.rate) || 0;
    const last_vendor = last?.bill.supplier || last?.bill.supplier_original || '';

    // Rate change vs the most recent prior purchase that has a rate.
    let prev_rate = 0;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const r = parseFloat(sorted[i].line.rate) || 0;
      if (r > 0) { prev_rate = r; break; }
    }
    const rate_change_pct = (prev_rate > 0 && last_rate > 0)
      ? ((last_rate - prev_rate) / prev_rate) * 100
      : null;

    // Distinct vendors, ordered by recency (most recent first).
    const seen = new Set();
    const vendors_recent = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const v = sorted[i].bill.supplier || sorted[i].bill.supplier_original;
      if (!v || seen.has(v)) continue;
      seen.add(v);
      vendors_recent.push(v);
    }
    const other_vendors = vendors_recent.slice(1, 3); // up to 2 beyond last_vendor
    const more_vendors = Math.max(0, vendors_recent.length - 1 - other_vendors.length);

    const dates = sorted.map(l => l.bill.date).filter(Boolean);
    const avg_interval_days = avgIntervalDays(dates);
    const days_since_last = daysSince(last_date);

    let reorder = null;
    if (avg_interval_days != null && avg_interval_days >= 7 && days_since_last != null) {
      if (days_since_last > 2 * avg_interval_days) reorder = 'overdue';
      else if (days_since_last > 1.5 * avg_interval_days) reorder = 'due';
    }

    result.push({
      key: g.key,
      display_name: g.display_name,
      total_qty, total_spend,
      bills_count: billIds.size,
      last_date, last_rate, last_vendor,
      other_vendors, more_vendors,
      avg_interval_days, days_since_last,
      rate_change_pct, reorder,
    });
  }
  return result;
}
// ------------------------------------------------------------------------

function useW(){const[w,setW]=useState(typeof window!=='undefined'?window.innerWidth:1200);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);return w;}

function parseCSVLine(line) {
  // Handles RFC-4180-style escaping: cells with comma/quote/newline are
  // wrapped in "...", and an inner " is escaped as "" — gviz CSV does
  // exactly this, and items_json cells contain plenty of inner quotes.
  const cols = [];
  let cur = '', inQ = false, i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cur += c; i++; continue;
    }
    if (c === ',') { cols.push(cur); cur = ''; i++; continue; }
    if (c === '"' && cur === '') { inQ = true; i++; continue; }
    cur += c; i++;
  }
  cols.push(cur);
  return cols;
}

function parsePurchasesCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
    return obj;
  }).filter(r => r.supplier || r.bill_no);
}

export default function PurchasesPage() {
  const { user, isLoaded } = useUser();
  const [form, setForm] = useState({ supplier: '', billNo: '', date: '', amount: '', notes: '', category: '' });
  const [formItems, setFormItems] = useState([]); // [{name, qty, rate, gst_pct}]
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [bills, setBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState('history'); // 'history' | 'form' | 'items' | 'insights'
  const [itemSort, setItemSort] = useState('recent'); // 'recent' | 'spend' | 'name' | 'stale'
  const [suggestion, setSuggestion] = useState(null); // { category, confidence, classified_by, reasons }
  const [classifying, setClassifying] = useState(false);
  const [editingCatId, setEditingCatId] = useState(null);
  const [recentlyApprovedId, setRecentlyApprovedId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [productionMaterials, setProductionMaterials] = useState([]); // string[]
  const [aliases, setAliases] = useState([]);           // [{raw_name, canonical_name, ...}]
  const [mappingKey, setMappingKey] = useState(null);   // normalized item key currently being mapped
  const [mapState, setMapState] = useState({ loading: false, suggestions: [] });
  const [mapSaving, setMapSaving] = useState(false);
  const classifyTimer = useRef(null);
  const w = useW();
  const mob = w < 768;

  const fetchBills = useCallback(async () => {
    setLoadingBills(true);
    try {
      const r = await fetch(PURCHASES_URL, { cache: 'no-store' });
      const text = await r.text();
      setBills(parsePurchasesCSV(text).reverse());
    } catch { setBills([]); }
    finally { setLoadingBills(false); }
  }, []);

  const fetchMappings = useCallback(async () => {
    try {
      const [matsRes, aliasCsv] = await Promise.all([
        fetch('/api/production-materials', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ materials: [] })),
        fetch(ITEM_ALIASES_URL, { cache: 'no-store' }).then(r => r.text()).catch(() => ''),
      ]);
      const parseLoose = (csv) => {
        const lines = (csv || '').trim().split('\n');
        if (lines.length < 2) return [];
        const headers = parseCSVLine(lines[0]).map(h => h.trim());
        return lines.slice(1).map(line => {
          const cols = parseCSVLine(line);
          const obj = {};
          headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim(); });
          return obj;
        });
      };
      setProductionMaterials(Array.isArray(matsRes.materials) ? matsRes.materials : []);
      setAliases(parseLoose(aliasCsv).filter(r => r.raw_name && r.canonical_name));
    } catch {
      setProductionMaterials([]); setAliases([]);
    }
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);
  useEffect(() => { fetchMappings(); }, [fetchMappings]);

  useEffect(() => {
    if (!recentlyApprovedId) return;
    const t = setTimeout(() => setRecentlyApprovedId(null), 2500);
    return () => clearTimeout(t);
  }, [recentlyApprovedId]);

  // Live category preview — debounced classify call as the user types.
  useEffect(() => {
    if (view !== 'form') return;
    if (!form.supplier && !form.notes) { setSuggestion(null); return; }
    if (classifyTimer.current) clearTimeout(classifyTimer.current);
    classifyTimer.current = setTimeout(async () => {
      setClassifying(true);
      try {
        const r = await fetch('/api/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company_id: COMPANY_ID,
            supplier: form.supplier,
            description: form.notes,
            amount: form.amount,
          }),
        });
        const data = await r.json();
        if (data.ok) setSuggestion({
          category: data.category,
          confidence: data.confidence,
          classified_by: data.classified_by,
          reasons: data.reasons,
        });
      } catch {}
      finally { setClassifying(false); }
    }, 600);
    return () => { if (classifyTimer.current) clearTimeout(classifyTimer.current); };
  }, [form.supplier, form.notes, form.amount, view]);

  const handleTallyUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setSyncMsg('');
    try {
      const parsed = await parseTallyFile(file);
      const { rows, error, skipped, zeroAmount, itemLines, billsWithItems, totalRows, parsedInvoices, duplicateBillIds } = parsed;
      if (error) throw new Error(error);
      if (rows.length === 0) throw new Error('No valid rows found');
      const items = rows.map(r => ({
        ...r,
        company_id: COMPANY_ID,
        source: 'tally',
        verified: 'tally',
        saved_by: 'Tally Upload',
      }));
      const resp = await fetch('/api/purchases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, saved_by: 'Tally Upload' }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Bulk save failed');
      const { created, duplicate, errors } = data.summary;
      if (created > 0) await fetchBills();
      console.log('Upload summary:', { totalRows, parsedInvoices, created, duplicate, errors, duplicateBillIds, skipped });
      const skipNote = skipped ? ` · ${skipped} skipped` : '';
      const zeroNote = zeroAmount ? ` · ${zeroAmount} no-amount` : '';
      const itemNote = itemLines ? ` · ${itemLines} items in ${billsWithItems} bills` : ' · 0 items';
      const dupNote = duplicateBillIds ? ` · ⚠ ${duplicateBillIds} dup ID` : '';
      setSyncMsg(`✓ ${parsedInvoices} invoices from ${totalRows} rows · ${created} new · ${duplicate} dup · ${errors} err${dupNote}${skipNote}${zeroNote}${itemNote}`);
    } catch (err) {
      setSyncMsg('⚠ ' + (err.message || 'Upload failed'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const syncTally = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await fetch('/api/tally-purchases');
      const data = await r.json();
      if (!data.ok) throw new Error(data.error);
      if (data.count === 0) {
        setSyncMsg(`⚠ Tally returned 0 vouchers${data.debug ? ': ' + data.debug.slice(0, 80) : ''}`);
        setSyncing(false); return;
      }
      const payload = data.vouchers.map(v => ({
        company_id: COMPANY_ID,
        date: v.date,
        supplier_original: v.supplier,
        bill_no: v.billNo,
        amount: v.amount,
        source: 'tally',
        verified: 'tally',
        saved_by: 'Tally Sync',
      }));
      const resp = await fetch('/api/purchases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload, saved_by: 'Tally Sync' }),
      });
      const result = await resp.json();
      if (!result.ok) throw new Error(result.error || 'Bulk save failed');
      const { created, duplicate, errors } = result.summary;
      if (created > 0) await fetchBills();
      setSyncMsg(`✓ ${created} new · ${duplicate} dup${errors ? ' · ' + errors + ' err' : ''}`);
    } catch (e) {
      setSyncMsg('⚠ ' + (e.message || 'Could not connect to Tally'));
    } finally { setSyncing(false); }
  };

  if (!isLoaded) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MN, color: '#94a3b8' }}>Loading...</div>
  );

  const role = user?.publicMetadata?.role;
  if (role !== 'admin') return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: MN }}>
      <div style={{ fontSize: 32 }}>🔒</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Access Restricted</div>
      <a href="/" style={{ marginTop: 8, fontSize: 12, color: '#d97706', fontWeight: 600 }}>← Back</a>
    </div>
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const cleanItems = formItems
        .map(it => ({
          name: (it.name || '').trim(),
          qty: (it.qty || '').trim(),
          rate: (it.rate || '').trim(),
          gst_pct: (it.gst_pct || '').trim(),
          amount: ((parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0)).toString().replace(/^0$/, ''),
        }))
        .filter(it => it.name);
      const payload = {
        company_id: COMPANY_ID,
        date: form.date,
        supplier_original: form.supplier,
        bill_no: form.billNo,
        amount: form.amount,
        description: form.notes,
        source: 'invoice',
        saved_by: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        user_category: form.category || undefined,
        items: cleanItems.length ? cleanItems : undefined,
      };
      const resp = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');
      await fetchBills();
      setView('history');
      setForm({ supplier: '', billNo: '', date: '', amount: '', notes: '', category: '' });
      setFormItems([]);
      setSuggestion(null);
    } catch (err) {
      setSaveError(err.message || 'Failed to save. Try again.');
    } finally { setSaving(false); }
  };

  const setApproval = async (bill, action) => {
    if (!bill.id) return;
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
    const optimistic = {
      approve: { approval_status: 'approved', approved_by: userName, approved_at: new Date().toISOString() },
      reject:  { approval_status: 'rejected', approved_by: userName, approved_at: new Date().toISOString() },
    }[action];
    setBills(prev => prev.map(b => b.id === bill.id ? { ...b, ...optimistic } : b));
    try {
      const resp = await fetch(`/api/purchases/${encodeURIComponent(bill.id)}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_by: userName }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || `${action} failed`);
      if (action === 'approve') setRecentlyApprovedId(bill.id);
    } catch (e) {
      console.error(`${action} bill:`, e);
      await fetchBills();
    }
  };

  const updateBillCategory = async (bill, newCategory) => {
    setEditingCatId(null);
    if (!bill.id || newCategory === bill.category) return;
    // Optimistic update so the UI feels instant.
    setBills(prev => prev.map(b => b.id === bill.id
      ? { ...b, category: newCategory, classified_by: 'user', confidence: '1', user_corrected: 'TRUE', previous_category: b.category }
      : b));
    try {
      const resp = await fetch(`/api/purchases/${encodeURIComponent(bill.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: newCategory,
          corrected_by: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Update failed');
    } catch (e) {
      console.error('updateBillCategory:', e);
      // Revert on error.
      await fetchBills();
    }
  };

  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
  const input = { width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, fontFamily: SN, outline: 'none', color: '#1e293b', boxSizing: 'border-box' };
  const labelStyle = { fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6, display: 'block' };

  // Build alias index once per render (small data, fine to recompute).
  const aliasIndex = (() => {
    const m = new Map();
    for (const a of aliases) {
      if (!a.raw_name || !a.canonical_name) continue;
      m.set(normItemKey(a.raw_name), a.canonical_name);
    }
    return m;
  })();

  const openMappingPicker = async (item) => {
    setMappingKey(item.key);
    setMapState({ loading: true, suggestions: [] });
    try {
      const r = await fetch('/api/items/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: COMPANY_ID, raw_name: item.display_name }),
      });
      const data = await r.json();
      setMapState({ loading: false, suggestions: data.suggestions || [] });
    } catch {
      setMapState({ loading: false, suggestions: [] });
    }
  };

  const closeMappingPicker = () => {
    setMappingKey(null);
    setMapState({ loading: false, suggestions: [] });
  };

  const confirmMapping = async (rawName, canonical, source = 'user_picked') => {
    if (!canonical) return;
    setMapSaving(true);
    try {
      const r = await fetch('/api/items/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: COMPANY_ID,
          raw_name: rawName,
          canonical_name: canonical,
          source,
          mapped_by: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Mapping failed');
      await fetchMappings();
      closeMappingPicker();
    } catch (e) {
      console.error('confirmMapping:', e);
    } finally { setMapSaving(false); }
  };

  const renderBillDetails = (b) => {
    const fmtDate = (s) => {
      if (!s) return '—';
      const d = new Date(s);
      return isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    };
    let items = [];
    try { if (b.items_json) items = JSON.parse(b.items_json); } catch {}
    if (!Array.isArray(items)) items = [];
    let gst = {};
    try { if (b.gst_details) gst = JSON.parse(b.gst_details); } catch {}
    if (!gst || typeof gst !== 'object') gst = {};

    const conf = parseFloat(b.confidence || '0');
    const catColor = CAT_COLORS[b.category] || '#94a3b8';
    const grand = parseFloat(b.amount || '0') || 0;
    const cgst = parseFloat(gst.cgst) || 0;
    const sgst = parseFloat(gst.sgst) || 0;
    const igst = parseFloat(gst.igst) || 0;
    const gstAmt = parseFloat(b.gst_amount || '0') || (cgst + sgst + igst);
    const subtotal = grand && gstAmt ? grand - gstAmt : grand;
    const matchedTally = String(b.is_matched_with_tally).toUpperCase() === 'TRUE';
    const isPending = b.approval_status === 'pending';
    const wasCorrected = String(b.user_corrected).toUpperCase() === 'TRUE';

    const sectionLabel = { fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 10 };
    const cellTh = { fontFamily: MN, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', background: '#f8fafc' };
    const cellTd = { fontSize: 13, color: '#0f172a', padding: '10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' };
    const sumRow = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontFamily: MN, fontSize: 12, color: '#64748b' };

    return (
      <div style={{ padding: mob ? '20px 16px' : '24px 28px', background: '#fff', borderTop: '1px solid #e2e8f0' }}>

        {/* 1. Header */}
        <div style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 6, lineHeight: 1.3 }}>
            {b.supplier_original || b.supplier || '—'}
          </div>
          <div style={{ fontFamily: MN, fontSize: 11, color: '#64748b', display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
            {gst.gst_number && <span><span style={{ color: '#94a3b8' }}>GSTIN</span> <span style={{ color: '#0f172a' }}>{gst.gst_number}</span></span>}
            <span><span style={{ color: '#94a3b8' }}>Bill No</span> <span style={{ color: '#0f172a', fontWeight: 600 }}>{b.bill_no || '—'}</span></span>
            <span><span style={{ color: '#94a3b8' }}>Date</span> <span style={{ color: '#0f172a', fontWeight: 600 }}>{b.date || '—'}</span></span>
          </div>
        </div>

        {/* 2. Items */}
        <div style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Items{items.length ? ` (${items.length})` : ''}</div>
          {items.length > 0 ? (
            <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={cellTh}>#</th>
                    <th style={cellTh}>Item</th>
                    <th style={{ ...cellTh, textAlign: 'right' }}>Qty</th>
                    <th style={{ ...cellTh, textAlign: 'right' }}>Rate</th>
                    <th style={{ ...cellTh, textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td style={{ ...cellTd, color: '#94a3b8', fontFamily: MN, fontSize: 11, width: 32 }}>{idx + 1}</td>
                      <td style={cellTd}>
                        <div style={{ fontWeight: 500 }}>{it.name || '—'}</div>
                        {(it.hsn || it.gst_pct) && (
                          <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                            {it.hsn && <span>HSN {it.hsn}</span>}
                            {it.hsn && it.gst_pct && <span> · </span>}
                            {it.gst_pct && <span>GST {it.gst_pct}%</span>}
                          </div>
                        )}
                      </td>
                      <td style={{ ...cellTd, textAlign: 'right', fontFamily: MN }}>{it.qty || '—'}</td>
                      <td style={{ ...cellTd, textAlign: 'right', fontFamily: MN }}>{it.rate ? `₹${Number(it.rate).toLocaleString('en-IN')}` : '—'}</td>
                      <td style={{ ...cellTd, textAlign: 'right', fontFamily: MN, fontWeight: 700 }}>{it.amount ? `₹${Number(it.amount).toLocaleString('en-IN')}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '14px 16px', background: '#f8fafc', border: '1px dashed #e2e8f0', borderRadius: 8, fontFamily: MN, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
              No item-level breakdown for this bill
            </div>
          )}
        </div>

        {/* 3. Summary */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <div style={{ minWidth: mob ? '100%' : 280 }}>
            {(gstAmt > 0 || cgst > 0 || sgst > 0 || igst > 0) && (
              <div style={sumRow}>
                <span>Subtotal</span>
                <span style={{ color: '#0f172a' }}>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            )}
            {cgst > 0 && <div style={sumRow}><span>CGST</span><span style={{ color: '#0f172a' }}>₹{cgst.toLocaleString('en-IN')}</span></div>}
            {sgst > 0 && <div style={sumRow}><span>SGST</span><span style={{ color: '#0f172a' }}>₹{sgst.toLocaleString('en-IN')}</span></div>}
            {igst > 0 && <div style={sumRow}><span>IGST</span><span style={{ color: '#0f172a' }}>₹{igst.toLocaleString('en-IN')}</span></div>}
            {!cgst && !sgst && !igst && gstAmt > 0 && (
              <div style={sumRow}><span>GST</span><span style={{ color: '#0f172a' }}>₹{gstAmt.toLocaleString('en-IN')}</span></div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 4px', borderTop: '1px solid #e2e8f0', marginTop: 6, fontFamily: MN, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              <span>Total</span>
              <span>{grand ? `₹${grand.toLocaleString('en-IN')}` : '—'}</span>
            </div>
          </div>
        </div>

        {/* 4. Intelligence */}
        <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>Category</div>
            <select
              value={b.category || ''}
              onChange={(e) => updateBillCategory(b, e.target.value)}
              style={{ padding: '5px 10px', fontFamily: MN, fontSize: 11, fontWeight: 700, color: catColor, background: catColor + '12', border: `1px solid ${catColor}40`, borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', outline: 'none' }}
            >
              <option value="" disabled>—</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </select>
            {b.classified_by && (
              <div style={{ fontFamily: MN, fontSize: 11, color: '#64748b' }}>
                via {b.classified_by}{conf ? ` · ${Math.round(conf * 100)}%` : ''}
                {wasCorrected && b.previous_category && (
                  <span style={{ color: '#94a3b8' }}> · was {CATEGORY_LABELS[b.previous_category] || b.previous_category}</span>
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, fontFamily: MN, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
            {matchedTally ? (
              <><span style={{ color: '#16a34a' }}>✓</span><span style={{ color: '#166534' }}>Matched with Tally</span></>
            ) : b.source === 'invoice' ? (
              <><span style={{ color: '#d97706' }}>⚠</span><span style={{ color: '#a16207' }}>No matching entry in Tally</span></>
            ) : (
              <><span style={{ color: '#94a3b8' }}>·</span><span style={{ color: '#94a3b8' }}>Source: {b.source || '—'}</span></>
            )}
          </div>
        </div>

        {/* 5. Actions */}
        {isPending ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={() => setApproval(b, 'approve')} style={{ padding: '10px 20px', fontFamily: MN, fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✓ Approve</button>
            <button onClick={() => setApproval(b, 'reject')} style={{ padding: '10px 20px', fontFamily: MN, fontSize: 11, fontWeight: 700, borderRadius: 8, border: '1px solid #dc2626', background: '#fff', color: '#dc2626', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>✗ Reject</button>
          </div>
        ) : b.approval_status ? (
          <div style={{ marginBottom: 16, fontFamily: MN, fontSize: 11, color: '#64748b' }}>
            <span style={{ fontWeight: 700, textTransform: 'uppercase', color: b.approval_status === 'approved' ? '#166534' : '#991b1b' }}>{b.approval_status}</span>
            {b.approved_by && <span> by {b.approved_by}</span>}
            {b.approved_at && <span style={{ color: '#94a3b8' }}> · {fmtDate(b.approved_at)}</span>}
          </div>
        ) : null}

        {/* 6. Advanced (collapsed) */}
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', userSelect: 'none', listStyle: 'none', padding: '6px 0' }}>
            <span>Advanced ▾</span>
          </summary>
          <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 12px', fontFamily: MN, fontSize: 11 }}>
            <span style={{ color: '#94a3b8' }}>Source</span>
            <span style={{ color: '#0f172a' }}>{b.source || '—'}</span>
            <span style={{ color: '#94a3b8' }}>Saved by</span>
            <span style={{ color: '#0f172a' }}>{b.saved_by || '—'}</span>
            <span style={{ color: '#94a3b8' }}>Saved at</span>
            <span style={{ color: '#0f172a' }}>{fmtDate(b.saved_at)}</span>
            {b.description && <>
              <span style={{ color: '#94a3b8' }}>Notes</span>
              <span style={{ fontFamily: SN, fontSize: 12, color: '#0f172a' }}>{b.description}</span>
            </>}
            {b.mismatches && <>
              <span style={{ color: '#94a3b8' }}>Mismatches</span>
              <span style={{ color: '#dc2626' }}>{b.mismatches}</span>
            </>}
            <span style={{ color: '#94a3b8' }}>ID</span>
            <span style={{ color: '#94a3b8', wordBreak: 'break-all' }}>{b.id || '—'}</span>
          </div>
        </details>
      </div>
    );
  };

  const renderCategoryChip = (b, { interactive }) => {
    const cat = b.category;
    const conf = parseFloat(b.confidence || '0');
    const lowConf = cat && conf < 0.6;
    const color = CAT_COLORS[cat] || '#94a3b8';
    const label = CATEGORY_LABELS[cat] || cat || '—';
    const tooltip = cat
      ? `${b.classified_by || '—'} · ${conf ? Math.round(conf * 100) + '%' : '?'}${b.user_corrected === 'TRUE' ? ' · corrected' : ''}`
      : 'Uncategorized';
    if (interactive && editingCatId === b.id) {
      return (
        <select
          autoFocus
          value={cat || ''}
          onChange={(e) => updateBillCategory(b, e.target.value)}
          onBlur={() => setEditingCatId(null)}
          onClick={(e) => e.stopPropagation()}
          style={{ padding: '4px 6px', fontFamily: MN, fontSize: 10, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#0f172a' }}
        >
          <option value="" disabled>—</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
      );
    }
    return (
      <button
        title={tooltip}
        onClick={interactive ? (e) => { e.stopPropagation(); setEditingCatId(b.id); } : undefined}
        disabled={!interactive}
        style={{
          fontFamily: MN, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
          padding: '3px 8px', borderRadius: 999,
          background: color + '18', color, border: `1px solid ${color}40`,
          cursor: interactive ? 'pointer' : 'default',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {label}
        {lowConf && <span style={{ color: '#dc2626', fontSize: 10 }}>?</span>}
      </button>
    );
  };

  return (
    <div style={{ fontFamily: SN, background: '#f1f5f9', minHeight: '100vh', fontSize: 13, color: '#1e293b' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0c1222 0%,#1a2744 60%,#2a1f0e 100%)', color: '#fff', padding: mob ? '0 16px' : '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #d97706' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer', textDecoration: 'none' }}>← Back</a>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ fontFamily: MN, fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Purchases</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!mob && <>
            {['history','items','insights'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{ background: view===v ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer' }}>
                {v==='history' ? `History (${bills.length})` : v==='items' ? 'Items' : 'Insights'}
              </button>
            ))}
            <button onClick={() => setView('form')} style={{ background: '#d97706', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer', fontWeight: 700 }}>+ Add Bill</button>
          </>}
          {mob && <button onClick={() => setView('form')} style={{ background: '#d97706', border: 'none', color: '#fff', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer', fontWeight: 700 }}>+ Add Bill</button>}
        </div>
      </div>

      {/* Mobile tab bar */}
      {mob && view !== 'form' && (
        <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff' }}>
          {['history','items','insights'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ flex: 1, padding: '12px', border: 'none', background: 'none', fontFamily: MN, fontSize: 12, fontWeight: view===v ? 700 : 500, color: view===v ? '#0f172a' : '#94a3b8', borderBottom: view===v ? '2px solid #d97706' : '2px solid transparent', cursor: 'pointer' }}>
              {v==='history' ? `History (${bills.length})` : v==='items' ? 'Items' : 'Insights'}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: mob ? '16px' : '24px 28px', maxWidth: 900, margin: '0 auto' }}>

        {/* History view */}
        {view === 'history' && (() => {
          const pending = bills.filter(b => b.approval_status === 'pending');
          const pendingCount = pending.length;
          const highCount = pending.filter(b => priorityFor(b.amount) === 'high').length;
          return (
          <>
          {pendingCount > 0 && (
            <div style={{ ...card, padding: '12px 16px', marginBottom: 12, background: '#fef3c7', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>⏳</span>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {pendingCount} {pendingCount === 1 ? 'invoice needs' : 'invoices need'} approval
              </div>
              {highCount > 0 && (
                <span style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: PRIORITY.high.bg, color: PRIORITY.high.color, border: `1px solid ${PRIORITY.high.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {highCount} high
                </span>
              )}
              <div style={{ fontFamily: MN, fontSize: 10, color: '#a16207', marginLeft: 'auto' }}>
                Review below
              </div>
            </div>
          )}
          <div style={card}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>Bill History</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {syncMsg && <div style={{ fontFamily: MN, fontSize: 10, color: syncMsg.startsWith('✓') ? '#059669' : '#dc2626' }}>{syncMsg}</div>}
                <button onClick={syncTally} disabled={syncing || uploading} style={{ background: (syncing || uploading) ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, fontFamily: MN, fontSize: 10, fontWeight: 700, cursor: (syncing || uploading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {syncing ? <><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Syncing</> : '⟳ Tally'}
                </button>
                <label style={{ background: uploading ? '#94a3b8' : '#475569', color: '#fff', padding: '5px 10px', borderRadius: 6, fontFamily: MN, fontSize: 10, fontWeight: 700, cursor: (uploading || syncing) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="file" accept=".csv,.xlsx,.xls" onChange={handleTallyUpload} disabled={uploading || syncing} style={{ display: 'none' }} />
                  {uploading ? <><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Uploading</> : '⬆ Upload'}
                </label>
                <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>{bills.length} bills</div>
              </div>
            </div>
            {loadingBills ? (
              <div style={{ padding: 32, textAlign: 'center', fontFamily: MN, fontSize: 12, color: '#94a3b8' }}>Loading...</div>
            ) : bills.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div style={{ fontFamily: MN, fontSize: 12, color: '#94a3b8' }}>No bills saved yet</div>
              </div>
            ) : (
              <div>
                {bills.map((b, i) => (
                  <div key={b.id || i} style={{ borderBottom: i < bills.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: b.approval_status === 'pending' ? '#fffbeb' : 'transparent' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧾</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <button onClick={() => setExpandedId(prev => prev === b.id ? null : b.id)} title="Show / hide details" style={{ background: 'none', border: 'none', padding: 0, fontWeight: 600, fontSize: 13, color: '#0f172a', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%', textDecoration: 'underline', textDecorationColor: '#cbd5e1', textUnderlineOffset: 3, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', transform: expandedId === b.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block' }}>▸</span>
                          {b.supplier || b.supplier_original || '—'}
                        </button>
                        {b.verified === 'mismatch' && <span title={b.mismatches} style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>}
                        {b.approval_status === 'pending' && <span style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Pending</span>}
                        {b.approval_status === 'pending' && (() => {
                          const p = PRIORITY[priorityFor(b.amount)];
                          return <span title={`Priority: ${p.label}`} style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: p.bg, color: p.color, border: `1px solid ${p.border}`, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{p.label}</span>;
                        })()}
                        {b.approval_status === 'approved' && <span title={`Approved by ${b.approved_by || '—'}`} style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Approved</span>}
                        {b.approval_status === 'rejected' && <span title={`Rejected by ${b.approved_by || '—'}`} style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>Rejected</span>}
                      </div>
                      {b.approval_status === 'pending' && (
                        <div style={{ fontFamily: MN, fontSize: 10, color: '#a16207', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {PENDING_REASON}
                        </div>
                      )}
                      <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>{b.bill_no} · {b.date}</div>
                      {b.verified === 'mismatch' && b.mismatches && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.mismatches}</div>}
                      {b.verified !== 'mismatch' && b.approval_status !== 'pending' && b.description && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.description}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                      {b.amount && <div style={{ fontFamily: MN, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>₹{Number(b.amount).toLocaleString('en-IN')}</div>}
                      {renderCategoryChip(b, { interactive: true })}
                      {b.approval_status === 'pending' ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={(e) => { e.stopPropagation(); setApproval(b, 'approve'); }} title="Approve" style={{ padding: '3px 8px', fontFamily: MN, fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #16a34a', background: '#16a34a', color: '#fff', cursor: 'pointer' }}>✓ Approve</button>
                          <button onClick={(e) => { e.stopPropagation(); setApproval(b, 'reject'); }} title="Reject" style={{ padding: '3px 8px', fontFamily: MN, fontSize: 10, fontWeight: 700, borderRadius: 6, border: '1px solid #dc2626', background: '#fff', color: '#dc2626', cursor: 'pointer' }}>✗ Reject</button>
                        </div>
                      ) : (
                        <div style={{ fontFamily: MN, fontSize: 9, color: '#cbd5e1' }}>{b.saved_by}</div>
                      )}
                    </div>
                  </div>
                  {recentlyApprovedId === b.id && (
                    <div style={{ padding: '8px 16px', background: '#dcfce7', fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>✓</span>
                      <span>Saved. Future invoices from this vendor will improve.</span>
                    </div>
                  )}
                  {expandedId === b.id && renderBillDetails(b)}
                  </div>
                ))}
              </div>
            )}
          </div>
          </>
          );
        })()}

        {/* Form view */}
        {view === 'form' && (
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 20 }}>Bill Details</div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ position: 'relative' }}>
                  <label style={labelStyle}>Supplier Name</label>
                  <input style={input} placeholder="e.g. Ravi Textiles" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} required list="supplier-list" />
                  <datalist id="supplier-list">
                    {[...new Set(bills.map(b => b.supplier).filter(Boolean))].map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
                <div>
                  <label style={labelStyle}>Bill Number</label>
                  <input style={input} placeholder="e.g. INV-2024-001" value={form.billNo} onChange={e => setForm(f => ({ ...f, billNo: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>Bill Date</label>
                  <input type="date" style={input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label style={labelStyle}>Total Amount (₹)</label>
                  <input style={input} placeholder="e.g. 15000" value={form.amount || ''} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select style={input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                    <option value="">Auto (let system decide)</option>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                  {!form.category && (
                    <div style={{ marginTop: 6, minHeight: 18, fontFamily: MN, fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {classifying && <span>Classifying…</span>}
                      {!classifying && suggestion && (
                        <>
                          <span>Suggested:</span>
                          <span style={{ fontWeight: 700, color: CAT_COLORS[suggestion.category] || '#0f172a' }}>
                            {CATEGORY_LABELS[suggestion.category] || suggestion.category}
                          </span>
                          <span style={{ color: '#94a3b8' }}>
                            · {suggestion.classified_by} · {Math.round((suggestion.confidence || 0) * 100)}%
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Items <span style={{ textTransform: 'none', color: '#cbd5e1', fontWeight: 500 }}>(optional)</span></label>
                    <button type="button" onClick={() => setFormItems(prev => [...prev, { name: '', qty: '', rate: '', gst_pct: '' }])} style={{ background: 'none', border: '1px solid #e2e8f0', color: '#475569', padding: '3px 10px', borderRadius: 6, fontFamily: MN, fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>+ Add</button>
                  </div>
                  {formItems.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <datalist id="item-name-list">
                        {[...new Set(bills.flatMap(b => {
                          try { const xs = JSON.parse(b.items_json || '[]'); return Array.isArray(xs) ? xs.map(x => x.name).filter(Boolean) : []; }
                          catch { return []; }
                        }))].map(n => <option key={n} value={n} />)}
                      </datalist>
                      {formItems.map((it, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 80px 60px 28px', gap: 6, alignItems: 'center' }}>
                          <input list="item-name-list" placeholder="Item name" value={it.name} onChange={e => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ ...input, padding: '6px 10px', fontSize: 12 }} />
                          <input placeholder="Qty" value={it.qty} onChange={e => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} style={{ ...input, padding: '6px 10px', fontSize: 12, fontFamily: MN, textAlign: 'right' }} />
                          <input placeholder="Rate ₹" value={it.rate} onChange={e => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} style={{ ...input, padding: '6px 10px', fontSize: 12, fontFamily: MN, textAlign: 'right' }} />
                          <input placeholder="GST %" value={it.gst_pct} onChange={e => setFormItems(prev => prev.map((x, j) => j === i ? { ...x, gst_pct: e.target.value } : x))} style={{ ...input, padding: '6px 10px', fontSize: 12, fontFamily: MN, textAlign: 'right' }} />
                          <button type="button" onClick={() => setFormItems(prev => prev.filter((_, j) => j !== i))} title="Remove" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="Any additional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                {saveError && <div style={{ fontFamily: MN, fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>{saveError}</div>}
                <button type="submit" disabled={saving} style={{ background: saving ? '#94a3b8' : 'linear-gradient(135deg,#0c1222,#1a2744)', color: '#fff', border: 'none', padding: '13px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {saving ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Saving...</> : 'Save Bill'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Items view */}
        {view === 'items' && (() => {
          const items = aggregateItems(bills);
          const sorted = items.slice().sort((a, b) => {
            if (itemSort === 'name') return a.display_name.localeCompare(b.display_name);
            if (itemSort === 'spend') return (b.total_spend || 0) - (a.total_spend || 0);
            if (itemSort === 'stale') return (b.days_since_last ?? -1) - (a.days_since_last ?? -1);
            // 'recent' default — newest purchase first
            return (b.last_date || '').localeCompare(a.last_date || '');
          });
          const dueCount = items.filter(i => i.reorder).length;
          const overdueCount = items.filter(i => i.reorder === 'overdue').length;
          const sortBtn = (key, label) => (
            <button key={key} onClick={() => setItemSort(key)} style={{ background: itemSort === key ? '#0f172a' : 'transparent', color: itemSort === key ? '#fff' : '#475569', border: '1px solid #e2e8f0', padding: '4px 10px', borderRadius: 6, fontFamily: MN, fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</button>
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {dueCount > 0 && (
                <div style={{ ...card, padding: '12px 16px', background: overdueCount > 0 ? '#fee2e2' : '#fef3c7', border: `1px solid ${overdueCount > 0 ? '#fecaca' : '#fde68a'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⏳</span>
                  <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, color: overdueCount > 0 ? '#991b1b' : '#92400e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {dueCount} {dueCount === 1 ? 'item' : 'items'} due to reorder{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
                  </div>
                </div>
              )}
              {(() => {
                const unmapped = items.filter(it => !aliasIndex.get(it.key)).length;
                return unmapped > 0 ? (
                  <div style={{ ...card, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🔗</span>
                    <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {unmapped} {unmapped === 1 ? 'item is' : 'items are'} unmapped
                    </div>
                    <div style={{ fontFamily: MN, fontSize: 10, color: '#3b82f6', marginLeft: 'auto' }}>Click any item to map</div>
                  </div>
                ) : null;
              })()}
              <div style={{ ...card, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginRight: 4 }}>Sort</div>
                {sortBtn('recent', 'Most Recent')}
                {sortBtn('spend', 'Top Spend')}
                {sortBtn('stale', 'Stalest')}
                {sortBtn('name', 'Name A-Z')}
                <div style={{ marginLeft: 'auto', fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>{items.length} items</div>
              </div>
              {items.length === 0 ? (
                <div style={{ ...card, padding: 48, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                  <div style={{ fontFamily: MN, fontSize: 12, color: '#94a3b8' }}>No item-level data yet</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Upload a Tally Columnar Purchase Register that includes Stock Item / Particulars columns.</div>
                </div>
              ) : (
                <div style={{ ...card, overflow: 'hidden' }}>
                  {sorted.map((it, i) => {
                    const reorderPill = it.reorder === 'overdue'
                      ? { label: 'Overdue',     bg: '#fee2e2', color: '#991b1b', border: '#fecaca' }
                      : it.reorder === 'due'
                        ? { label: 'Reorder due', bg: '#fef3c7', color: '#92400e', border: '#fde68a' }
                        : null;
                    const canonical = aliasIndex.get(it.key) || null;
                    const isOpen = mappingKey === it.key;
                    return (
                      <div key={it.key} style={{ borderBottom: i < sorted.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                      <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: isOpen ? '#f8fafc' : 'transparent' }}>
                        <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📦</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{it.display_name}</div>
                            {(() => {
                              if (!canonical) {
                                return <button onClick={() => isOpen ? closeMappingPicker() : openMappingPicker(it)} style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: isOpen ? '#0f172a' : '#eff6ff', color: isOpen ? '#fff' : '#1e40af', border: `1px solid ${isOpen ? '#0f172a' : '#bfdbfe'}`, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0, cursor: 'pointer' }}>{isOpen ? 'Cancel' : 'Map →'}</button>;
                              }
                              const tier = it.bills_count >= 5 ? 'silent' : it.bills_count >= 3 ? 'auto' : 'provisional';
                              const palette = tier === 'provisional'
                                ? { bg: '#fef3c7', color: '#92400e', border: '#fde68a', sym: '~', word: 'Suggested' }
                                : { bg: '#dcfce7', color: '#166534', border: '#bbf7d0', sym: '→', word: 'Mapped' };
                              const ttl = `${palette.word}: ${canonical} · ${it.bills_count} ${it.bills_count === 1 ? 'use' : 'uses'}${tier === 'silent' ? ' · auto' : ''} · click Change to override`;
                              return (
                                <span title={ttl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                  <span style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: palette.bg, color: palette.color, border: `1px solid ${palette.border}`, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{palette.sym} {canonical}</span>
                                  {tier === 'silent' && <span title="auto-mapped" style={{ fontFamily: MN, fontSize: 9, color: '#94a3b8' }}>·auto</span>}
                                  <button onClick={() => isOpen ? closeMappingPicker() : openMappingPicker(it)} style={{ background: 'none', border: 'none', padding: tier === 'silent' ? '0 2px' : '0 4px', fontFamily: MN, fontSize: 9, fontWeight: 700, color: tier === 'provisional' ? '#92400e' : '#64748b', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isOpen ? 'Cancel' : 'Change'}</button>
                                </span>
                              );
                            })()}
                            {reorderPill && <span title={`Avg ${it.avg_interval_days?.toFixed(0)} days · last ${it.days_since_last} days ago`} style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: reorderPill.bg, color: reorderPill.color, border: `1px solid ${reorderPill.border}`, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>{reorderPill.label}</span>}
                          </div>
                          <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>
                            Last: {it.last_date || '—'}{it.days_since_last != null ? ` · ${it.days_since_last}d ago` : ''}
                            {it.avg_interval_days != null && ` · every ~${it.avg_interval_days.toFixed(0)}d`}
                            {' · '}{it.bills_count} {it.bills_count === 1 ? 'bill' : 'bills'}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.last_vendor || '—'}
                            {it.other_vendors.length > 0 && (
                              <span style={{ color: '#94a3b8' }}> · also {it.other_vendors.join(', ')}{it.more_vendors > 0 ? ` +${it.more_vendors} more` : ''}</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                          <div style={{ fontFamily: MN, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>₹{it.total_spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                          {it.total_qty > 0 && <div style={{ fontFamily: MN, fontSize: 10, color: '#64748b' }}>{it.total_qty.toLocaleString('en-IN')} units</div>}
                          {it.last_rate > 0 && (
                            <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>@ ₹{it.last_rate.toLocaleString('en-IN')}</span>
                              {it.rate_change_pct != null && Math.abs(it.rate_change_pct) >= 0.5 && (
                                <span style={{ color: it.rate_change_pct > 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>
                                  {it.rate_change_pct > 0 ? '↑' : '↓'}{Math.abs(it.rate_change_pct).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {isOpen && (
                        <div style={{ padding: '12px 16px 16px', background: '#f8fafc', borderTop: '1px dashed #e2e8f0' }}>
                          <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 10 }}>
                            {canonical ? (
                              <>Change &ldquo;<span style={{ color: '#0f172a', fontWeight: 700 }}>{it.display_name}</span>&rdquo; from <span style={{ color: '#166534', fontWeight: 700 }}>{canonical}</span> to:</>
                            ) : (
                              <>Map &ldquo;<span style={{ color: '#0f172a', fontWeight: 700 }}>{it.display_name}</span>&rdquo; to:</>
                            )}
                          </div>
                          {mapState.loading ? (
                            <div style={{ fontFamily: MN, fontSize: 11, color: '#94a3b8' }}>Looking up suggestions…</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {mapState.suggestions.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {mapState.suggestions.map((s, idx) => {
                                    const isCurrent = canonical === s.canonical_name;
                                    const isHero = idx === 0 && !canonical; // first suggestion only "hero" when nothing is mapped yet
                                    return (
                                      <button key={s.canonical_name} disabled={mapSaving || isCurrent} onClick={() => confirmMapping(it.display_name, s.canonical_name, 'ai_suggested')} title={isCurrent ? 'Current mapping' : s.reason} style={{ background: isCurrent ? '#e2e8f0' : isHero ? '#dcfce7' : '#fff', color: isCurrent ? '#475569' : isHero ? '#166534' : '#0f172a', border: `1px solid ${isCurrent ? '#cbd5e1' : isHero ? '#bbf7d0' : '#e2e8f0'}`, padding: '6px 12px', borderRadius: 999, fontFamily: MN, fontSize: 11, fontWeight: 700, cursor: (mapSaving || isCurrent) ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        {isCurrent ? <span>•</span> : isHero ? <span>✓</span> : null}
                                        <span>{s.canonical_name}</span>
                                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>{isCurrent ? 'current' : `${Math.round((s.confidence || 0) * 100)}%`}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {productionMaterials.length > 0 ? (
                                <select style={{ ...input, padding: '8px 12px', fontSize: 12 }} defaultValue="" onChange={(e) => { if (e.target.value && e.target.value !== canonical) confirmMapping(it.display_name, e.target.value, 'user_picked'); }}>
                                  <option value="">{canonical ? 'Or pick a different material…' : 'Pick from production materials…'}</option>
                                  {productionMaterials.map(m => (
                                    <option key={m} value={m} disabled={m === canonical}>
                                      {m}{m === canonical ? '  (current)' : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>No production materials available yet.</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Insights view */}
        {view === 'insights' && (() => {
          const catTotals = CATEGORIES.map(cat => {
            const catBills = bills.filter(b => b.category === cat);
            const total = catBills.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
            const vendors = [...new Set(catBills.map(b => b.supplier).filter(Boolean))];
            return { cat, total, vendors, count: catBills.length };
          });
          const grandTotal = catTotals.reduce((s, c) => s + c.total, 0);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ ...card, padding: 16 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Spend by Category</div>
                <div style={{ display: 'flex', height: 12, borderRadius: 8, overflow: 'hidden', marginBottom: 16, gap: 2 }}>
                  {catTotals.filter(c => c.total > 0).map(c => (
                    <div key={c.cat} style={{ flex: c.total / grandTotal, background: CAT_COLORS[c.cat], borderRadius: 4 }} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr 1fr' : 'repeat(3,1fr)', gap: 12 }}>
                  {catTotals.map(c => (
                    <div key={c.cat} style={{ padding: '10px 12px', borderRadius: 10, background: CAT_COLORS[c.cat] + '12', border: '1px solid ' + CAT_COLORS[c.cat] + '30' }}>
                      <div style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, color: CAT_COLORS[c.cat], textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{CATEGORY_LABELS[c.cat]}</div>
                      <div style={{ fontFamily: MN, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>₹{c.total.toLocaleString('en-IN')}</div>
                      <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{c.count} bills · {c.vendors.length} vendors</div>
                    </div>
                  ))}
                </div>
              </div>
              {catTotals.filter(c => c.vendors.length > 0).map(c => (
                <div key={c.cat} style={{ ...card, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[c.cat] }} />
                    <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#475569' }}>{CATEGORY_LABELS[c.cat]}</div>
                  </div>
                  {c.vendors.map(v => {
                    const vBills = bills.filter(b => b.supplier === v && b.category === c.cat);
                    const vTotal = vBills.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
                    const pct = c.total > 0 ? Math.round(vTotal / c.total * 100) : 0;
                    return (
                      <div key={v} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                          <div style={{ fontFamily: MN, fontSize: 11, color: '#475569' }}>₹{vTotal.toLocaleString('en-IN')} <span style={{ color: '#94a3b8' }}>({pct}%)</span></div>
                        </div>
                        <div style={{ height: 4, background: '#f1f5f9', borderRadius: 4 }}>
                          <div style={{ height: '100%', width: pct + '%', background: CAT_COLORS[c.cat], borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
