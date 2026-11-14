// Generates an Ed25519 key pair for sync tokens.
//
//   pnpm keys:sync
//
// Prints the private key for the Next app (.env.local) and the public key
// set for the sync Worker (workers/sync/.dev.vars, a Worker secret in
// production). Add a new pair with a new kid to rotate: list both public
// keys in the Worker, switch the app's private key, remove the old one later.
import { exportJWK, generateKeyPair } from "jose";

const kid = `sync-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "EdDSA" };
const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "EdDSA", use: "sig" };

console.log("# Next app (.env.local)");
console.log(`SYNC_TOKEN_PRIVATE_KEY='${JSON.stringify(privateJwk)}'`);
console.log("\n# Sync Worker (workers/sync/.dev.vars)");
console.log(`SYNC_TOKEN_PUBLIC_KEYS='${JSON.stringify({ keys: [publicJwk] })}'`);
