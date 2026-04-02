'use client';
import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg,#0c1222 0%,#1a2744 60%,#2a1f0e 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: 24,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <div style={{
          background: '#fff',
          borderRadius: 16,
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <img src="/logo.png" alt="Comfort Mats" style={{ height: 56, width: 'auto' }} />
        </div>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', textTransform: 'uppercase', marginTop: 4 }}>
          Cloud Dashboard
        </div>
      </div>
      <SignIn />
    </div>
  );
}
