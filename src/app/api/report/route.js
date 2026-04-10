import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';

export const maxDuration = 30;

const MAIN_SHEET_ID = '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';
const DATA_SHEET = 'APP_DATA';
const USAGE_SHEET = 'AI_USAGE';
const HAIKU_INPUT_RATE = 1.0 / 1000000;   // $1 per 1M tokens
const HAIKU_OUTPUT_RATE = 5.0 / 1000000;  // $5 per 1M tokens
const DAILY_LIMIT = 10;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Google Sheets auth ---
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

// --- Ensure usage sheet exists ---
async function ensureUsageSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === USAGE_SHEET);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: MAIN_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: USAGE_SHEET } } }] },
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${USAGE_SHEET}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Time', 'User', 'Question', 'Type', 'Model', 'Input Tokens', 'Output Tokens', 'Cost USD', 'Cost INR', 'Response Time (s)']] },
    });
  }
}

// --- Check daily usage for rate limiting ---
async function getDailyUsage(sheets, userEmail) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${USAGE_SHEET}!A:C`,
    });
    const rows = res.data.values || [];
    return rows.filter(r => r[0] === today && r[2] === userEmail).length;
  } catch {
    return 0;
  }
}

// --- Log usage ---
async function logUsage(sheets, { user, question, type, inputTokens, outputTokens, costUSD, responseTime }) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const costINR = (costUSD * 83.5).toFixed(4);

  await sheets.spreadsheets.values.append({
    spreadsheetId: MAIN_SHEET_ID,
    range: `${USAGE_SHEET}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[date, time, user, question, type, 'claude-haiku-4-5', inputTokens, outputTokens, costUSD.toFixed(6), costINR, responseTime.toFixed(1)]],
    },
  });
}

// --- Fetch order data from sheet ---
async function fetchOrderData() {
  const url = `https://docs.google.com/spreadsheets/d/${MAIN_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${DATA_SHEET}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch sheet data');
  const csv = await res.text();

  // Parse and summarize
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { summary: 'No data available', rawCount: 0 };

  const orders = [];
  const partyTotals = {};
  const catTotals = {};
  const pocTotals = {};
  let totalValue = 0, totalQty = 0, approvedCount = 0, pendingCount = 0;

  lines.slice(1).forEach(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    if (cols.length < 10) return;

    const party = (cols[2] || '').replace(/^"|"$/g, '').trim();
    if (!party || party === 'PARTY NAME') return;

    const qty = parseInt(cols[5]) || 0;
    const value = parseFloat((cols[13] || '0').replace(/[₹,]/g, '')) || 0;
    const category = cols[6] || 'Other';
    const poc = cols[3] || '';
    const approvalDate = (cols[14] || '').replace(/^"|"$/g, '').trim();
    const piDate = cols[4] || '';
    const dispatchStatus = (cols[16] || '').replace(/^"|"$/g, '').trim().toLowerCase();

    if (dispatchStatus === 'dispatched') return;

    totalValue += value;
    totalQty += qty;
    if (approvalDate) approvedCount++; else pendingCount++;

    partyTotals[party] = (partyTotals[party] || 0) + value;
    catTotals[category] = (catTotals[category] || 0) + qty;
    pocTotals[poc] = (pocTotals[poc] || 0) + value;

    orders.push({ party, qty, value, category, poc, piDate, approvalDate, dispatchStatus });
  });

  // Build compact summary for Claude
  const topParties = Object.entries(partyTotals).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, val]) => `${name}: ₹${Math.round(val).toLocaleString('en-IN')}`).join('\n');

  const catBreakdown = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
    .map(([cat, qty]) => `${cat}: ${qty} units`).join('\n');

  const pocBreakdown = Object.entries(pocTotals).sort((a, b) => b[1] - a[1])
    .map(([poc, val]) => `${poc}: ₹${Math.round(val).toLocaleString('en-IN')}`).join('\n');

  // Compute overdue
  const now = new Date();
  const overdue = orders.filter(o => {
    if (!o.approvalDate) return false;
    try {
      const p = o.approvalDate.split('/');
      const d = new Date(+p[2], +p[1] - 1, +p[0]);
      return (now - d) / (1000 * 60 * 60 * 24) > 7;
    } catch { return false; }
  });

  const summary = `ORDERS SUMMARY (as of ${now.toLocaleDateString('en-IN')}):
Total pending orders: ${orders.length}
Total value: ₹${Math.round(totalValue).toLocaleString('en-IN')}
Total quantity: ${totalQty}
Approved (ready to dispatch): ${approvedCount}
Pending approval: ${pendingCount}
Overdue (approved >7 days, not shipped): ${overdue.length}

TOP PARTIES BY PENDING VALUE:
${topParties}

CATEGORY BREAKDOWN:
${catBreakdown}

SALES POC BREAKDOWN:
${pocBreakdown}

OVERDUE ORDERS:
${overdue.slice(0, 10).map(o => `${o.party} - ${o.category} - ₹${Math.round(o.value).toLocaleString('en-IN')} - approved ${o.approvalDate}`).join('\n') || 'None'}`;

  return { summary, rawCount: orders.length };
}

// --- Main handler ---
export async function POST(req) {
  const startTime = Date.now();

  try {
    const { question, user } = await req.json();
    if (!question || !question.trim()) {
      return Response.json({ error: 'No question provided' }, { status: 400 });
    }

    const userEmail = user || 'anonymous';
    const sheets = await getSheets();

    // Ensure usage sheet exists
    await ensureUsageSheet(sheets);

    // Rate limit check
    const todayUsage = await getDailyUsage(sheets, userEmail);
    if (todayUsage >= DAILY_LIMIT) {
      return Response.json({
        error: 'Daily limit reached',
        message: `You've used all ${DAILY_LIMIT} reports for today. Try again tomorrow.`,
        remaining: 0,
      }, { status: 429 });
    }

    // Fetch and summarize data
    const { summary, rawCount } = await fetchOrderData();

    if (rawCount === 0) {
      return Response.json({
        report: { title: 'No Data', body: 'No active orders found in the system.', generatedAt: new Date().toISOString() },
        remaining: DAILY_LIMIT - todayUsage,
      });
    }

    // Call Claude Haiku
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `You are a business analyst for a carpet/mat manufacturing company called Comfort Mats.

The user wants a report. Generate a clear, structured business report based on the data below.

DATA:
${summary}

USER'S REPORT REQUEST:
"${question.trim()}"

RULES:
- Give a clear report title
- Write 2-4 concise paragraphs
- Include specific numbers (₹ values, quantities, percentages)
- End with 1 actionable recommendation
- Keep it under 200 words
- Use simple business English
- Do NOT say "based on the data provided" or similar filler
- Format: Start with TITLE: on first line, then the report body`
      }],
    });

    const responseTime = (Date.now() - startTime) / 1000;
    const text = response.content[0].text;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const costUSD = inputTokens * HAIKU_INPUT_RATE + outputTokens * HAIKU_OUTPUT_RATE;

    // Parse title from response
    let title = 'Report';
    let body = text;
    if (text.startsWith('TITLE:')) {
      const split = text.indexOf('\n');
      title = text.substring(6, split).trim();
      body = text.substring(split + 1).trim();
    }

    // Log usage to Google Sheets
    await logUsage(sheets, {
      user: userEmail,
      question: question.trim().substring(0, 200),
      type: 'custom',
      inputTokens,
      outputTokens,
      costUSD,
      responseTime,
    });

    return Response.json({
      report: {
        title,
        body,
        generatedAt: new Date().toISOString(),
        tokens: { input: inputTokens, output: outputTokens },
        cost: { usd: costUSD.toFixed(4), inr: (costUSD * 83.5).toFixed(2) },
      },
      remaining: DAILY_LIMIT - todayUsage - 1,
    });

  } catch (err) {
    console.error('Report error:', err);
    return Response.json({ error: 'Failed to generate report', message: err.message }, { status: 500 });
  }
}
