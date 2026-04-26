import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  // Bypass for trusted external tools (e.g. Claude design previews).
  // Set CLERK_BYPASS_TOKEN in Vercel env vars to enable.
  const expected = process.env.CLERK_BYPASS_TOKEN;
  if (expected && req.headers.get('x-bypass-token') === expected) return;

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
