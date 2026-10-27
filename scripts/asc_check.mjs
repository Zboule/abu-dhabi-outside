// Is the App Store Connect API key good? Lists the account's apps with it.
//   ASC_KEY_PATH=... ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/asc_check.mjs
import { asc } from './asc.mjs';

const apps = await asc('GET', '/v1/apps?limit=200');
console.log(`key OK; apps: ${apps.data.map((a) => a.attributes.bundleId).join(', ') || 'none yet'}`);
