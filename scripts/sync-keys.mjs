// Generates an Ed25519 key pair for sync tokens. Prints only; writes nothing.
//
//   pnpm keys:sync                 development (kid sync-...)
//   pnpm keys:sync --production    production (kid prod-...)
//
// Development: the private key goes in .env.local, the public key set in
// workers/sync/.dev.vars. Production: generate a fresh pair (never reuse a
// development or CI key; preflight refuses any kid that is not prod-...),
// put the private key in Vercel's Production environment and the public key
// set in the Worker with `wrangler secret put SYNC_TOKEN_PUBLIC_KEYS --env
// production`, and keep them nowhere else.
//
// Rotation: list the new public key next to the old one in the Worker,
// deploy it, switch the app's private key, and remove the old public key
// after 15 minutes (longer than a token lives).
import { exportJWK, generateKeyPair } from "jose";

const production = process.argv.includes("--production");
const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const kid = `${production ? "prod" : "sync"}-${date}-${Math.random().toString(36).slice(2, 8)}`;
const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "EdDSA" };
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA", use: "sig" };

if (production) {
  console.log("# Production sync token keys. Do not save these to a file or commit them.");
  console.log("# Vercel > Project > Settings > Environment Variables, Production only, Sensitive:");
  console.log(`SYNC_TOKEN_PRIVATE_KEY=${JSON.stringify(privateJwk)}`);
  console.log("\n# Worker: pnpm --filter @brahma/sync exec wrangler secret put SYNC_TOKEN_PUBLIC_KEYS --env production");
  console.log("# and paste:");
  console.log(JSON.stringify({ keys: [publicJwk] }));
} else {
  console.log("# Next app (.env.local)");
  console.log(`SYNC_TOKEN_PRIVATE_KEY='${JSON.stringify(privateJwk)}'`);
  console.log("\n# Sync Worker (workers/sync/.dev.vars)");
  console.log(`SYNC_TOKEN_PUBLIC_KEYS='${JSON.stringify({ keys: [publicJwk] })}'`);
}
