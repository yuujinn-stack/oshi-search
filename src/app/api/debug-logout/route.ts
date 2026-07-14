import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Temporary diagnostic endpoint — publicly accessible, reveals ONLY cookie presence (no values).
// Not under /api/admin/ so the proxy does NOT intercept it.
// Use after logout to verify the admin-session cookie was removed.
// Remove once logout is confirmed working in production.
export async function GET(req: NextRequest) {
  const rawCookieHeader = req.headers.get('cookie') ?? '';

  // Count how many admin-session= tokens appear — multiple means duplicate cookies at different paths
  const matches = rawCookieHeader.match(/(?:^|;\s*)admin-session=/g);
  const cookieCount = matches ? matches.length : 0;
  const cookiePresent = cookieCount > 0;

  return NextResponse.json({
    cookiePresent,
    cookieCount,
    vercelEnv: process.env.VERCEL_ENV ?? 'local',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  });
}
