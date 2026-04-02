import './globals.css';
import { ClerkProvider } from '@clerk/nextjs';

export const metadata = {
  title: 'Comfort Cloud Dashboard',
  description: 'Pending Orders, Stock, Dispatch & Production Planning',
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1"/>
          <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
        </head>
        <body style={{ margin: 0, padding: 0 }}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
