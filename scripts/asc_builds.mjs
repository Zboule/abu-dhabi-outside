// The app's latest TestFlight builds: number, processing state, beta state.
//   ASC_KEY_PATH=... ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/asc_builds.mjs
import { asc } from './asc.mjs';

const b = await asc('GET', '/v1/builds?filter[app]=6827433728&sort=-uploadedDate&limit=3&include=buildBetaDetail');
for (const d of b.data) {
  const beta = b.included?.find((x) => x.type === 'buildBetaDetails' && x.id === d.relationships.buildBetaDetail.data?.id);
  console.log(d.attributes.version, d.attributes.processingState, beta?.attributes.internalBuildState ?? '', d.attributes.uploadedDate);
}
