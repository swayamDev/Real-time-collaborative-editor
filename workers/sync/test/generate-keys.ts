// Runs in Node when Vitest loads its config: a throwaway Ed25519 pair per run.
const KID = "test-key";

export async function generateTestKeys(): Promise<{ privateJwk: string; publicKeys: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateJwk: JSON.stringify({ ...privateJwk, kid: KID }),
    publicKeys: JSON.stringify({ keys: [{ ...publicJwk, kid: KID, alg: "EdDSA", use: "sig" }] }),
  };
}
