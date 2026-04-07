'use client';
import { useUser } from '@clerk/nextjs';
import { useState, useEffect } from 'react';

const MN = "'DM Mono', monospace";
const SN = "'Instrument Sans', sans-serif";

function useW(){const[w,setW]=useState(typeof window!=='undefined'?window.innerWidth:1200);useEffect(()=>{const h=()=>setW(window.innerWidth);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);return w;}

export default function PurchasesPage() {
  const { user, isLoaded } = useUser();
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [form, setForm] = useState({ supplier: '', billNo: '', date: '', notes: '' });
  const [submitted, setSubmitted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const w = useW();
  const mob = w < 768;

  if (!isLoaded) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MN, color: '#94a3b8' }}>
      Loading...
    </div>
  );

  const role = user?.publicMetadata?.role;
  if (role !== 'admin') return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: MN }}>
      <div style={{ fontSize: 32 }}>🔒</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Access Restricted</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>You don't have permission to view this page.</div>
      <a href="/" style={{ marginTop: 8, fontSize: 12, color: '#d97706', fontWeight: 600 }}>← Back to Dashboard</a>
    </div>
  );

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setScanError('');
    setScanning(true);
    try {
      // Resize image to max 1024px before sending (phone photos are 3-5MB)
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
      const resp = await fetch('/api/read-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: 'image/jpeg' }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setForm(f => ({
        supplier: data.supplier || f.supplier,
        billNo: data.billNo || f.billNo,
        date: data.date || f.date,
        notes: data.notes || f.notes,
        amount: data.amount || f.amount,
      }));
    } catch (err) {
      setScanError('Could not read bill. Please fill in manually.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const reset = () => { setPhoto(null); setPhotoPreview(null); setForm({ supplier: '', billNo: '', date: '', notes: '', amount: '' }); setSubmitted(false); setScanError(''); };

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
        {!mob && <div style={{ fontFamily: MN, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{user?.firstName} {user?.lastName}</div>}
      </div>

      <div style={{ padding: mob ? '16px' : '24px 28px', maxWidth: 900, margin: '0 auto' }}>
        {submitted ? (
          <div style={{ ...card, padding: mob ? 32 : 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
            <div style={{ fontFamily: MN, fontSize: 16, fontWeight: 700, color: '#059669', marginBottom: 8 }}>Bill Saved</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
              <strong>{form.supplier}</strong> · {form.billNo} · {form.date}
            </div>
            <button onClick={reset} style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add Another Bill</button>
          </div>
        ) : (
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
                {scanning && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: MN, fontSize: 11, color: '#d97706' }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #d97706', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    Reading bill...
                  </div>
                )}
                {!scanning && scanError && <div style={{ marginTop: 10, fontFamily: MN, fontSize: 10, color: '#dc2626', textAlign: 'center' }}>{scanError}</div>}
                {!scanning && !scanError && photo && <div style={{ marginTop: 10, fontFamily: MN, fontSize: 10, color: '#059669', textAlign: 'center' }}>✓ Bill scanned — check details below</div>}
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>

              {/* Buying pattern — hide on mobile to reduce scroll */}
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
                <div>
                  <label style={labelStyle}>Supplier Name</label>
                  <input style={input} placeholder="e.g. Ravi Textiles" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} required />
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
                  <input style={input} placeholder="e.g. 15000" value={form.amount||''} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Notes</label>
                  <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="Any additional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Saving to</div>
                  <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#475569' }}>Google Sheet · PURCHASES tab <span style={{ color: '#94a3b8', fontWeight: 400 }}>(coming soon)</span></div>
                </div>
                <button type="submit" style={{ background: 'linear-gradient(135deg,#0c1222,#1a2744)', color: '#fff', border: 'none', padding: '13px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>
                  Save Bill
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
