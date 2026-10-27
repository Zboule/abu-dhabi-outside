// Is the App Store Connect API key good? Signs a token with it and lists the account's apps.
//   ASC_KEY_PATH=... ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/asc_check.mjs
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
const key = createPrivateKey(readFileSync(ASC_KEY_PATH));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
const r = await fetch('https://api.appstoreconnect.apple.com/v1/apps?limit=200', { headers: { authorization: `Bearer ${head}.${body}.${sig}` } });
const j = await r.json();
if (!r.ok) {
  console.error(r.status, JSON.stringify(j.errors));
  process.exit(1);
}
console.log(`key OK; apps: ${j.data.map((a) => a.attributes.bundleId).join(', ') || 'none yet'}`);
