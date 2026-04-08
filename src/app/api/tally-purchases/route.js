export const maxDuration = 30;

const TALLY_URL = process.env.TALLY_URL || 'https://oxide-tomato-fiscal-ends.trycloudflare.com';

const COMPANY = process.env.TALLY_COMPANY || 'Comfort Industries';

function getPurchaseXML(fromDate, toDate) {
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>DAYBOOK</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
          <SVFROMDATE>${fromDate}</SVFROMDATE>
          <SVTODATE>${toDate}</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function getTallyDates() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const from = `${y}${m}01`;
  const to = `${y}${m}${d}`;
  return { from, to };
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
    // Only include purchase vouchers
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
    const resp = await fetch(TALLY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: getPurchaseXML(from, to),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) throw new Error(`Tally returned ${resp.status}`);
    const xml = await resp.text();

    if (xml.includes('LINEERROR') || xml.includes('ERRORS')) {
      throw new Error('Tally returned an error — check if Purchase Register is accessible');
    }

    const vouchers = parseVouchers(xml);
    const debug = vouchers.length === 0 ? xml.slice(0, 1000) : null;
    return Response.json({ ok: true, vouchers, count: vouchers.length, debug });
  } catch (e) {
    console.error('tally-purchases error:', e);
    return Response.json({ ok: false, error: e.message, vouchers: [] }, { status: 500 });
  }
}
