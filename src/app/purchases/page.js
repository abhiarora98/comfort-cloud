'use client';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect, useCallback } from 'react';

const MN = "'DM Mono', monospace";
const SN = "'Instrument Sans', sans-serif";
const SHEET_ID = '1CQS5w9VLTjHcZ9Gzw3P6wGgZ0K6YDKuL1Ux42LQeRSQ';
const PURCHASES_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=PURCHASES`;

function useW(){const[w,setW]=useState(typeof window!=='undefined'?window.innerWidth:1200);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);return w;}

function parsePurchasesCSV(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    // Robust CSV split: handle quoted fields
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur);
    const clean = c => (c || '').replace(/^"|"$/g, '').trim();
    return { date: clean(cols[0]), supplier: clean(cols[1]), billNo: clean(cols[2]), amount: clean(cols[3]), notes: clean(cols[4]), savedBy: clean(cols[5]), savedAt: clean(cols[6]), photoUrl: clean(cols[7]), category: clean(cols[8]), verified: clean(cols[9]), mismatches: clean(cols[10]) };
  }).filter(r => r.supplier || r.billNo);
}

export default function PurchasesPage() {
  const { user, isLoaded } = useUser();
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [form, setForm] = useState({ supplier: '', billNo: '', date: '', amount: '', notes: '', category: '' });
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [mismatchWarning, setMismatchWarning] = useState(null); // null | { mismatches: [] }
  const [selectedBill, setSelectedBill] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [bills, setBills] = useState([]);
  const [loadingBills, setLoadingBills] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [view, setView] = useState('history'); // 'history' | 'form' | 'insights'
  const w = useW();
  const mob = w < 768;

  const fetchBills = useCallback(async () => {
    setLoadingBills(true);
    try {
      const r = await fetch(PURCHASES_URL);
      const text = await r.text();
      setBills(parsePurchasesCSV(text).reverse()); // newest first
    } catch { setBills([]); }
    finally { setLoadingBills(false); }
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const syncTally = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const r = await fetch('/api/tally-purchases');
      const data = await r.json();
      if (!data.ok) throw new Error(data.error);
      const existingBillNos = new Set(bills.map(b => b.billNo));
      const newOnes = data.vouchers.filter(v => !existingBillNos.has(v.billNo));
      for (const v of newOnes) {
        await fetch('/api/save-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...v, savedBy: 'Tally Sync', savedAt: new Date().toISOString(), verified: 'tally', mismatches: '', photoUrl: '', notes: '', category: '' }),
        });
      }
      if (newOnes.length > 0) await fetchBills();
      setSyncMsg(`✓ ${newOnes.length} new bills synced from Tally`);
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

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    // Resize and store base64 for AI verification on save
    try {
      const base64 = await new Promise((res, rej) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          const MAX = 1024;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          res(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
        };
        img.onerror = rej;
        img.src = url;
      });
      setPhotoBase64(base64);
    } catch { /* ignore */ }
    // Upload photo to Vercel Blob
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/upload-bill-photo', { method: 'POST', body: fd });
      const upData = await up.json();
      if (upData.url) setPhotoUrl(upData.url);
    } catch { /* photo upload failed silently */ }
  };

  const doSave = async (mismatches) => {
    setSaving(true);
    setSaveError('');
    setMismatchWarning(null);
    try {
      const verified = !photoBase64 ? 'no-photo' : mismatches && mismatches.length > 0 ? 'mismatch' : 'ok';
      const mismatchText = mismatches && mismatches.length > 0 ? mismatches.map(m => `${m.field}: entered "${m.entered}" but bill shows "${m.onBill}"`).join('; ') : '';
      const payload = { ...form, photoUrl, savedBy: `${user.firstName} ${user.lastName}`.trim(), savedAt: new Date().toISOString(), verified, mismatches: mismatchText };
      const resp = await fetch('/api/save-purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      await fetchBills();
      setView('history');
      setPhoto(null); setPhotoPreview(null); setPhotoUrl(''); setPhotoBase64('');
      setForm({ supplier: '', billNo: '', date: '', amount: '', notes: '', category: '' });
      setScanError('');
    } catch (err) {
      setSaveError(err.message || 'Failed to save. Try again.');
    } finally { setSaving(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // If photo exists, verify before saving
    if (photoBase64) {
      setVerifying(true);
      try {
        const resp = await fetch('/api/verify-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: photoBase64, mediaType: 'image/jpeg', form }),
        });
        const result = await resp.json();
        if (!result.match && result.mismatches && result.mismatches.length > 0) {
          setMismatchWarning(result.mismatches);
          setVerifying(false);
          return;
        }
      } catch { /* verify failed, proceed with save */ }
      setVerifying(false);
    }
    await doSave([]);
  };


  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
  const input = { width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, fontFamily: SN, outline: 'none', color: '#1e293b', boxSizing: 'border-box' };
  const labelStyle = { fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6, display: 'block' };

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
            {['history','insights'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{ background: view===v ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer' }}>
                {v==='history' ? `History (${bills.length})` : 'Insights'}
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
          {['history','insights'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ flex: 1, padding: '12px', border: 'none', background: 'none', fontFamily: MN, fontSize: 12, fontWeight: view===v ? 700 : 500, color: view===v ? '#0f172a' : '#94a3b8', borderBottom: view===v ? '2px solid #d97706' : '2px solid transparent', cursor: 'pointer' }}>
              {v==='history' ? `History (${bills.length})` : 'Insights'}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: mob ? '16px' : '24px 28px', maxWidth: 900, margin: '0 auto' }}>

        {/* History view */}
        {view === 'history' && (
          <div style={card}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>Bill History</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {syncMsg && <div style={{ fontFamily: MN, fontSize: 10, color: syncMsg.startsWith('✓') ? '#059669' : '#dc2626' }}>{syncMsg}</div>}
                <button onClick={syncTally} disabled={syncing} style={{ background: syncing ? '#94a3b8' : '#0f172a', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: 6, fontFamily: MN, fontSize: 10, fontWeight: 700, cursor: syncing ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {syncing ? <><span style={{ display: 'inline-block', width: 8, height: 8, border: '1.5px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Syncing</> : '⟳ Tally'}
                </button>
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
                  <div key={i} onClick={() => setSelectedBill(b)} style={{ padding: '12px 16px', borderBottom: i < bills.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                    {b.photoUrl
                      ? <img src={b.photoUrl} alt="Bill" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0', flexShrink: 0 }} />
                      : <div style={{ width: 44, height: 44, borderRadius: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧾</div>
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.supplier || '—'}</div>
                        {b.verified === 'mismatch' && <span title={b.mismatches} style={{ fontSize: 14, flexShrink: 0 }}>⚠️</span>}
                      </div>
                      <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>{b.billNo} · {b.date}</div>
                      {b.verified === 'mismatch' && b.mismatches && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.mismatches}</div>}
                      {b.verified !== 'mismatch' && b.notes && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.notes}</div>}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {b.amount && <div style={{ fontFamily: MN, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>₹{Number(b.amount).toLocaleString('en-IN')}</div>}
                      <div style={{ fontFamily: MN, fontSize: 9, color: '#cbd5e1', marginTop: 2 }}>{b.savedBy}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Form view */}
        {view === 'form' && (
          <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr', gap: 16 }}>

            {/* Photo upload */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ ...card, padding: 16 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Bill Photo</div>
                {photoPreview ? (
                  <div style={{ position: 'relative' }}>
                    <img src={photoPreview} alt="Bill" style={{ width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', maxHeight: mob ? 260 : 340, objectFit: 'contain' }} />
                    <button onClick={() => { setPhoto(null); setPhotoPreview(null); }} style={{ position: 'absolute', top: 8, right: 8, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                ) : (
                  <label style={{ display: 'block', border: '2px dashed #e2e8f0', borderRadius: 10, padding: mob ? '32px 16px' : '40px 20px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}>
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
                    <div style={{ fontSize: 36, marginBottom: 10 }}>📷</div>
                    <div style={{ fontFamily: MN, fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Take or Upload Photo</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Tap to use camera or choose file</div>
                  </label>
                )}
                {photo && <div style={{ marginTop: 10, fontFamily: MN, fontSize: 10, color: '#059669', textAlign: 'center' }}>✓ Photo attached — fill details below</div>}
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>

              {!mob && <div style={{ ...card, padding: 16 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Buying Pattern</div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '24px 16px', textAlign: 'center', border: '1px dashed #e2e8f0' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📊</div>
                  <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Connect Tally to see history</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Previous purchases, frequency & amounts will appear here</div>
                </div>
              </div>}
            </div>

            {/* Form */}
            <div style={{ ...card, padding: 16 }}>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 20 }}>Bill Details</div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ position: 'relative' }}>
                  <label style={labelStyle}>Supplier Name</label>
                  <input style={input} placeholder="e.g. Ravi Textiles" value={form.supplier} onChange={e => {
                    const val = e.target.value;
                    setForm(f => {
                      const match = bills.find(b => b.supplier.toLowerCase() === val.toLowerCase());
                      return { ...f, supplier: val, category: match ? match.category : f.category };
                    });
                  }} required list="supplier-list" />
                  <datalist id="supplier-list">
                    {[...new Set(bills.map(b => b.supplier).filter(Boolean))].map(s => <option key={s} value={s} />)}
                  </datalist>
                  {form.supplier && bills.find(b => b.supplier.toLowerCase() === form.supplier.toLowerCase()) &&
                    <div style={{ fontFamily: MN, fontSize: 10, color: '#059669', marginTop: 4 }}>✓ Known supplier — category pre-filled</div>}
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
                  <select style={input} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} required>
                    <option value="">Select category...</option>
                    <option value="Raw Material">Raw Material</option>
                    <option value="Consumables">Consumables</option>
                    <option value="Hardware">Hardware</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="Any additional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                {saveError && <div style={{ fontFamily: MN, fontSize: 11, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>{saveError}</div>}
                <button type="submit" disabled={saving || verifying} style={{ background: (saving || verifying) ? '#94a3b8' : 'linear-gradient(135deg,#0c1222,#1a2744)', color: '#fff', border: 'none', padding: '13px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 700, cursor: (saving || verifying) ? 'not-allowed' : 'pointer', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {verifying ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Verifying...</>
                  : saving ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Saving...</>
                  : 'Save Bill'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Insights view */}
        {view === 'insights' && (() => {
          const CATS = ['Raw Material', 'Consumables', 'Hardware', 'Other'];
          const CAT_COLORS = { 'Raw Material': '#3b82f6', 'Consumables': '#10b981', 'Hardware': '#f59e0b', 'Other': '#8b5cf6' };
          const catTotals = CATS.map(cat => {
            const catBills = bills.filter(b => b.category === cat);
            const total = catBills.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);
            const vendors = [...new Set(catBills.map(b => b.supplier).filter(Boolean))];
            return { cat, total, vendors, count: catBills.length };
          });
          const grandTotal = catTotals.reduce((s, c) => s + c.total, 0);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Summary bar */}
              <div style={{ ...card, padding: 16 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Spend by Category</div>
                <div style={{ display: 'flex', height: 12, borderRadius: 8, overflow: 'hidden', marginBottom: 16, gap: 2 }}>
                  {catTotals.filter(c => c.total > 0).map(c => (
                    <div key={c.cat} style={{ flex: c.total / grandTotal, background: CAT_COLORS[c.cat], borderRadius: 4 }} />
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12 }}>
                  {catTotals.map(c => (
                    <div key={c.cat} style={{ padding: '10px 12px', borderRadius: 10, background: CAT_COLORS[c.cat] + '12', border: '1px solid ' + CAT_COLORS[c.cat] + '30' }}>
                      <div style={{ fontFamily: MN, fontSize: 9, fontWeight: 700, color: CAT_COLORS[c.cat], textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{c.cat}</div>
                      <div style={{ fontFamily: MN, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>₹{c.total.toLocaleString('en-IN')}</div>
                      <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{c.count} bills · {c.vendors.length} vendors</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Vendor breakdown per category */}
              {catTotals.filter(c => c.vendors.length > 0).map(c => (
                <div key={c.cat} style={{ ...card, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: CAT_COLORS[c.cat] }} />
                    <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#475569' }}>{c.cat}</div>
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

      {/* Mismatch warning modal */}
      {mismatchWarning && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 420, width: '100%', overflow: 'hidden' }}>
            <div style={{ background: '#fef3c7', padding: '14px 16px', borderBottom: '1px solid #fde68a', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 20 }}>⚠️</div>
              <div>
                <div style={{ fontFamily: MN, fontSize: 12, fontWeight: 700, color: '#92400e' }}>Data Mismatch Detected</div>
                <div style={{ fontSize: 12, color: '#78350f', marginTop: 2 }}>The entered details don't match the bill photo.</div>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {mismatchWarning.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, padding: '10px 12px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
                  <div style={{ fontFamily: MN, fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>{m.field}</div>
                  <div style={{ fontSize: 12 }}>Entered: <strong>{m.entered}</strong></div>
                  <div style={{ fontSize: 12 }}>On bill: <strong>{m.onBill}</strong></div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button onClick={() => setMismatchWarning(null)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontFamily: MN, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#0f172a' }}>Fix Details</button>
                <button onClick={() => doSave(mismatchWarning)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontFamily: MN, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save Anyway</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo modal */}
      {selectedBill && (
        <div onClick={() => setSelectedBill(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', maxWidth: 500, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{selectedBill.supplier}</div>
                <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8' }}>{selectedBill.billNo} · {selectedBill.date}</div>
              </div>
              <button onClick={() => setSelectedBill(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', padding: 4 }}>×</button>
            </div>
            {selectedBill.photoUrl
              ? <img src={selectedBill.photoUrl} alt="Bill" style={{ width: '100%', objectFit: 'contain', maxHeight: 'calc(90vh - 60px)' }} />
              : <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontFamily: MN, fontSize: 12 }}>No photo attached to this bill</div>
            }
          </div>
        </div>
      )}
    </div>
  );
}
