export const maxDuration = 30;

const TALLY_URL = process.env.TALLY_URL || 'https://oxide-tomato-fiscal-ends.trycloudflare.com';

const COMPANY = process.env.TALLY_COMPANY || 'Comfort Industries';

const PURCHASE_XML = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Purchase Register</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
          <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
          <SVFROMDATE>$$MonthStart:$$MachineDate</SVFROMDATE>
          <SVTODATE>$$MachineDate</SVTODATE>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

function parseVouchers(xml) {
  const vouchers = [];
  const voucherRegex = /<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/g;
  let match;
  while ((match = voucherRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const date = get('DATE');
    const voucherNo = get('VOUCHERNUMBER');
    const partyName = get('PARTYLEDGERNAME');
    const amount = get('AMOUNT');
    if (!partyName) continue;
    // Format date from YYYYMMDD to YYYY-MM-DD
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
    const resp = await fetch(TALLY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: PURCHASE_XML,
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) throw new Error(`Tally returned ${resp.status}`);
    const xml = await resp.text();

    if (xml.includes('LINEERROR') || xml.includes('ERRORS')) {
      throw new Error('Tally returned an error — check if Purchase Register is accessible');
    }

    const vouchers = parseVouchers(xml);
    // Return first 500 chars of raw XML for debugging if no vouchers found
    const debug = vouchers.length === 0 ? xml.slice(0, 500) : null;
    return Response.json({ ok: true, vouchers, count: vouchers.length, debug });
  } catch (e) {
    console.error('tally-purchases error:', e);
    return Response.json({ ok: false, error: e.message, vouchers: [] }, { status: 500 });
  }
}
