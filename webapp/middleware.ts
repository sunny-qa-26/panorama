import { NextRequest, NextResponse } from 'next/server';

const REALM = 'Panorama (internal)';

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}"` }
  });
}

export function middleware(req: NextRequest): NextResponse | undefined {
  // Skip when basic auth not configured (e.g. local dev where envs are unset).
  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASS;
  if (!expectedUser || !expectedPass) return NextResponse.next();

  // Skip health check so K8s probes don't need creds.
  if (req.nextUrl.pathname === '/api/health') return NextResponse.next();

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Basic ')) return unauthorized();

  let decoded: string;
  try { decoded = atob(auth.slice('Basic '.length)); }
  catch { return unauthorized(); }

  const [user, pass] = decoded.split(':');
  if (user !== expectedUser || pass !== expectedPass) return unauthorized();

  return NextResponse.next();
}

export const config = {
  // Apply to everything except Next.js internals + static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
