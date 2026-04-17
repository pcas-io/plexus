/**
 * Session cookie helpers — read, set, clear plexus_session cookie.
 */

import type { Context } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

export const SESSION_COOKIE = 'plexus_session';

const EIGHT_HOURS = 8 * 60 * 60;

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: EIGHT_HOURS,
  });
}

export function readSessionCookie(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}
