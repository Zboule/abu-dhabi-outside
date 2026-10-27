// The App Store provisioning profiles for the app and its widget: made through the API when
// missing (or when one predates the App Group), then installed where Xcode looks for them.
// The profiles are not secrets; the distribution certificate they name is (DIST_CERT_P12).
//   ASC_*=... DIST_CERT_ID=... node scripts/asc_profiles.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { asc } from './asc.mjs';

const GROUP = 'group.io.github.zboule.abudhabioutside';
// the names are what project.yml's PROVISIONING_PROFILE_SPECIFIER and ExportOptions.plist use
const WANT = [
  { bundle: 'io.github.zboule.abudhabioutside', name: 'Abu Dhabi Outside App Store' },
  { bundle: 'io.github.zboule.abudhabioutside.widget', name: 'Abu Dhabi Outside Widget App Store' },
];
const cert = process.env.DIST_CERT_ID;
if (!cert) throw new Error('DIST_CERT_ID is not set');

const dirs = [
  join(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles'),
  join(homedir(), 'Library/MobileDevice/Provisioning Profiles'),
];
dirs.forEach((d) => mkdirSync(d, { recursive: true }));

for (const w of WANT) {
  const ids = await asc('GET', `/v1/bundleIds?filter[identifier]=${w.bundle}&limit=5`);
  const bundle = ids.data.find((b) => b.attributes.identifier === w.bundle);
  if (!bundle) throw new Error(`bundle ID ${w.bundle} is not registered`);

  const found = await asc('GET', `/v1/profiles?filter[name]=${encodeURIComponent(w.name)}&limit=10`);
  let profile = found.data.find((p) => p.attributes.name === w.name && p.attributes.profileState === 'ACTIVE');
  // the plist inside the signed profile is plain text: it must carry the App Group
  const hasGroup = (p) => Buffer.from(p.attributes.profileContent, 'base64').toString('latin1').includes(GROUP);
  if (profile && !hasGroup(profile)) {
    console.log(`${w.name}: made before the App Group was assigned, remaking it`);
    await asc('DELETE', `/v1/profiles/${profile.id}`);
    profile = null;
  }
  if (!profile) {
    const made = await asc('POST', '/v1/profiles', {
      data: {
        type: 'profiles',
        attributes: { name: w.name, profileType: 'IOS_APP_STORE' },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundle.id } },
          certificates: { data: [{ type: 'certificates', id: cert }] },
        },
      },
    });
    profile = made.data;
    if (!hasGroup(profile)) throw new Error(`${w.name}: no App Group in the profile; assign ${GROUP} to ${w.bundle} in the developer portal`);
    console.log(`${w.name}: made`);
  }
  const body = Buffer.from(profile.attributes.profileContent, 'base64');
  for (const d of dirs) writeFileSync(join(d, `${profile.attributes.uuid}.mobileprovision`), body);
  console.log(`${w.name}: installed (${profile.attributes.uuid}, expires ${profile.attributes.expirationDate})`);
}
