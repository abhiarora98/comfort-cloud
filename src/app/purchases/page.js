'use client';
import { useUser } from '@clerk/nextjs';
import { useState } from 'react';

const MN = "'DM Mono', monospace";
const SN = "'Instrument Sans', sans-serif";

export default function PurchasesPage() {
  const { user, isLoaded } = useUser();
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [form, setForm] = useState({ supplier: '', billNo: '', date: '', notes: '' });
  const [submitted, setSubmitted] = useState(false);

  if (!isLoaded) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MN, color: '#94a3b8' }}>
      Loading...
    </div>
  );

  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
  if (fullName !== 'Abhi Arora') return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, fontFamily: MN }}>
      <div style={{ fontSize: 32 }}>🔒</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Access Restricted</div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>You don't have permission to view this page.</div>
      <a href="/" style={{ marginTop: 8, fontSize: 12, color: '#d97706', fontWeight: 600 }}>← Back to Dashboard</a>
    </div>
  );

  const handlePhoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Save to sheet — wired later
    setSubmitted(true);
  };

  const reset = () => { setPhoto(null); setPhotoPreview(null); setForm({ supplier: '', billNo: '', date: '', notes: '' }); setSubmitted(false); };

  const card = { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
  const input = { width: '100%', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', fontSize: 13, fontFamily: SN, outline: 'none', color: '#1e293b', boxSizing: 'border-box' };
  const label = { fontFamily: MN, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 6, display: 'block' };

  return (
    <div style={{ fontFamily: SN, background: '#f1f5f9', minHeight: '100vh', fontSize: 13, color: '#1e293b' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0c1222 0%,#1a2744 60%,#2a1f0e 100%)', color: '#fff', padding: '0 28px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #d97706' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', padding: '5px 12px', borderRadius: 8, fontSize: 11, fontFamily: MN, cursor: 'pointer', textDecoration: 'none' }}>← Dashboard</a>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ fontFamily: MN, fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Purchases</div>
        </div>
        <div style={{ fontFamily: MN, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{fullName}</div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>
        {submitted ? (
          <div style={{ ...card, padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
            <div style={{ fontFamily: MN, fontSize: 16, fontWeight: 700, color: '#059669', marginBottom: 8 }}>Bill Saved</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
              <strong>{form.supplier}</strong> · {form.billNo} · {form.date}
            </div>
            <button onClick={reset} style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add Another Bill</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Left — Photo upload */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ ...card, padding: 20 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Bill Photo</div>
                {photoPreview ? (
                  <div style={{ position: 'relative' }}>
                    <img src={photoPreview} alt="Bill" style={{ width: '100%', borderRadius: 8, border: '1px solid #e2e8f0', maxHeight: 340, objectFit: 'contain' }} />
                    <button onClick={() => { setPhoto(null); setPhotoPreview(null); }} style={{ position: 'absolute', top: 8, right: 8, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                  </div>
                ) : (
                  <label style={{ display: 'block', border: '2px dashed #e2e8f0', borderRadius: 10, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', background: '#f8fafc' }}>
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ display: 'none' }} />
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📷</div>
                    <div style={{ fontFamily: MN, fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Take or Upload Photo</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Tap to use camera or choose file</div>
                  </label>
                )}
                {photo && <div style={{ marginTop: 10, fontFamily: MN, fontSize: 10, color: '#94a3b8', textAlign: 'center' }}>AI bill reading — coming soon</div>}
              </div>

              {/* Buying pattern placeholder */}
              <div style={{ ...card, padding: 20 }}>
                <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 14 }}>Buying Pattern</div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '24px 16px', textAlign: 'center', border: '1px dashed #e2e8f0' }}>
                  <div style={{ fontSize: 22, marginBottom: 8 }}>📊</div>
                  <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Connect Tally to see history</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Previous purchases, frequency & amounts will appear here</div>
                </div>
              </div>
            </div>

            {/* Right — Form */}
            <div style={{ ...card, padding: 20 }}>
              <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8', marginBottom: 20 }}>Bill Details</div>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <label style={label}>Supplier Name</label>
                  <input style={input} placeholder="e.g. Ravi Textiles" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} required />
                </div>
                <div>
                  <label style={label}>Bill Number</label>
                  <input style={input} placeholder="e.g. INV-2024-001" value={form.billNo} onChange={e => setForm(f => ({ ...f, billNo: e.target.value }))} required />
                </div>
                <div>
                  <label style={label}>Bill Date</label>
                  <input type="date" style={input} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label style={label}>Notes</label>
                  <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} placeholder="Any additional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
                <div style={{ marginTop: 8, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontFamily: MN, fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>Saving to</div>
                  <div style={{ fontFamily: MN, fontSize: 11, fontWeight: 600, color: '#475569' }}>Google Sheet · PURCHASES tab <span style={{ color: '#94a3b8', fontWeight: 400 }}>(coming soon)</span></div>
                </div>
                <button type="submit" style={{ background: 'linear-gradient(135deg,#0c1222,#1a2744)', color: '#fff', border: 'none', padding: '12px', borderRadius: 8, fontFamily: MN, fontSize: 12, fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>
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
