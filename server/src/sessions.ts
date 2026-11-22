import crypto from 'node:crypto';
import { config } from './config.js';

// Tokens are encrypted at rest (AES-256-GCM) and never leave the server.
const key = crypto.createHash('sha256').update(config.sessionSecret).digest();
const enc = (t: string) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(t, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
};
const dec = (s: string) => {
  const b = Buffer.from(s, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

export interface User { login: string; avatar: string }
const store = new Map<string, { tokenEnc: string; user: User; exp: number }>();
const TTL = 8 * 3600 * 1000;

export const createSession = (token: string, user: User) => {
  const sid = crypto.randomBytes(32).toString('hex');
  store.set(sid, { tokenEnc: enc(token), user, exp: Date.now() + TTL });
  return sid;
};
export const getSession = (sid?: string) => {
  const s = sid ? store.get(sid) : undefined;
  if (!s || s.exp < Date.now()) { if (sid) store.delete(sid); return null; }
  return { token: dec(s.tokenEnc), user: s.user };
};
export const destroySession = (sid?: string) => { if (sid) store.delete(sid); };
