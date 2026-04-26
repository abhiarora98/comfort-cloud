import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)']);
const BYPASS_COOKIE = 'cc-bypass';
const BYPASS_MAX_AGE = 60 * 60 * 24; // 24h

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Bypass for trusted external tools. Set CLERK_BYPASS_TOKEN in Vercel env vars.
  const expected = process.env.CLERK_BYPASS_TOKEN;
  if (expected) {
    // 1) Header bypass (programmatic API calls).
    if (req.headers.get('x-bypass-token') === expected) return;

    // 2) Query-param bypass (shareable link). On match, set a cookie and
    // redirect to a clean URL so the token doesn't linger in the address bar.
    const url = new URL(req.url);
    if (url.searchParams.get('bypass') === expected) {
      url.searchParams.delete('bypass');
      const res = NextResponse.redirect(url);
      res.cookies.set(BYPASS_COOKIE, expected, {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: BYPASS_MAX_AGE,
      });
      return res;
    }

    // 3) Cookie bypass (set by step 2; lets subsequent navigation pass).
    if (req.cookies.get(BYPASS_COOKIE)?.value === expected) return;
  }

  const { userId } = await auth();
  if (!userId) {
    const signInUrl = new URL('/sign-in', req.url);
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
