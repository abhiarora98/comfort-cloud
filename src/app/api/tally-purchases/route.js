import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { Agent } from 'https';

export const maxDuration = 30;

const TALLY_URL = process.env.TALLY_URL || 'http://localhost:9000';

const http11Agent = new Agent({ ALPNProtocols: ['http/1.1'] });

function getPurchaseXML(fromDate, toDate) {
  return `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>${fromDate}</SVFROMDATE><SVTODATE>${toDate}</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
}

function getTallyDates() {
  // Tally runs in IST — use IST "today" regardless of server timezone
  const ist = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  const [y, m, d] = ist.split('-');
  const from = `${y}${m}01`;
  const to = `${y}${m}${d}`;
  return { from, to };
}

function doRequest(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(body, 'utf8');
    const isHttps = u.protocol === 'https:';
    const opts = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname || '/',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Content-Length': buf.length,
        'Connection': 'close',
        'ngrok-skip-browser-warning': 'true',
      },
      agent: isHttps ? http11Agent : undefined,
    };
    const req = (isHttps ? httpsRequest : httpRequest)(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        // Tally appends \x04 (EOT) and may embed other control chars — strip them
        const raw = Buffer.concat(chunks).toString('utf8');
        const text = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
        resolve({ status: res.statusCode, text });
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Tally request timed out')); });
    req.write(buf);
    req.end();
  });
}

function parseVouchers(xml) {
  const vouchers = [];
  const voucherRegex = /<VOUCHER\b[^>]*>([\s\S]*?)<\/VOUCHER>/g;
  let match;
  while ((match = voucherRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}\\b[^>]*>([^<]*)<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : '';
    };
    const vtype = get('VOUCHERTYPENAME');
    if (!vtype.toLowerCase().includes('purchase')) continue;
    const date = get('DATE');
    const voucherNo = get('VOUCHERNUMBER') || get('BILLNO');
    const partyName = get('PARTYLEDGERNAME');
    const amount = get('AMOUNT');
    if (!partyName) continue;
    const fmtDate = date.length === 8 ? `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}` : date;
    vouchers.push({
      date: fmtDate,
      supplier: partyName,
      billNo: voucherNo,
      amount: Math.abs(parseFloat(amount) || 0).toString(),
      source: 'tally',
    });
  }
  return vouchers;
}

export async function GET() {
  try {
    const { from, to } = getTallyDates();
    const body = getPurchaseXML(from, to);
    const { status, text: xml } = await doRequest(TALLY_URL, body);

    if (status !== 200) throw new Error(`Tally returned ${status}`);

    if (xml.includes('LINEERROR') || xml.includes('ERRORS')) {
      const errMatch = xml.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/);
      throw new Error('Tally error: ' + (errMatch ? errMatch[1].trim() : xml.slice(0, 200)));
    }

    const vouchers = parseVouchers(xml);
    const debug = vouchers.length === 0 ? xml.slice(0, 2000) : null;
    return Response.json({ ok: true, vouchers, count: vouchers.length, debug });
  } catch (e) {
    console.error('tally-purchases error:', e);
    return Response.json({ ok: false, error: e.message, vouchers: [] }, { status: 500 });
  }
}
