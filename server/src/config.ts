import 'dotenv/config';
const req = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};
const MB = 1024 * 1024;
export const config = {
  port: Number(process.env.PORT ?? 8787),
  baseUrl: req('APP_BASE_URL'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  clientId: req('GITHUB_CLIENT_ID'),
  clientSecret: req('GITHUB_CLIENT_SECRET'),
  sessionSecret: (() => {
    const v = req('SESSION_SECRET');
    if (v.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters (try: openssl rand -hex 32)');
    return v;
  })(),
  trustProxy: process.env.TRUST_PROXY === '1',
  prod: process.env.NODE_ENV === 'production',
  limits: { zipBytes: 200 * MB, extractedBytes: 500 * MB, files: 20000, fileBytes: 100 * MB }
};
