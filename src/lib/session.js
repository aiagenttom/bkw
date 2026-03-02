import { randomUUID } from 'crypto';
import db from './db.js';

const MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export function getSession(cookies) {
  const sid = cookies.get('bkw_sid');
  if (!sid) return null;
  const row = db.prepare(
    "SELECT sess FROM sessions WHERE sid = ? AND expired > datetime('now')"
  ).get(sid);
  return row ? JSON.parse(row.sess) : null;
}

export function createSession(cookies, data) {
  const sid     = randomUUID();
  const expires = new Date(Date.now() + MAX_AGE * 1000)
    .toISOString().replace('T',' ').substring(0,19);
  db.prepare('INSERT INTO sessions (sid, sess, expired) VALUES (?,?,?)')
    .run(sid, JSON.stringify(data), expires);
  cookies.set('bkw_sid', sid, { path: '/', maxAge: MAX_AGE, httpOnly: true, sameSite: 'lax' });
  return sid;
}

export function destroySession(cookies) {
  const sid = cookies.get('bkw_sid');
  if (sid) db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  cookies.delete('bkw_sid', { path: '/' });
}

// Prune expired sessions (called occasionally)
export function pruneSessions() {
  db.prepare("DELETE FROM sessions WHERE expired <= datetime('now')").run();
}
