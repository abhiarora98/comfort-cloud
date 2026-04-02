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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8,
          background: 'linear-gradient(135deg,#d97706,#f59e0b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 700, color: '#0c1222',
        }}>CC</div>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Comfort Cloud
        </div>
      </div>
      <SignIn />
    </div>
  );
}
