/**
 * Which request header, if any, carries the client's address.
 *
 * A client can send any header it likes, including X-Forwarded-For, and
 * `next start` keeps a client-sent X-Forwarded-For as it is. So no header
 * is trusted by default: the per-address sign-in limit is off and the
 * limits that cannot be dodged with a header (per email, and site wide)
 * apply. Behind a proxy that overwrites the header with the real address
 * (Vercel, Cloudflare, a configured nginx), set:
 *
 *   AUTH_CLIENT_IP_HEADER  the header the proxy sets, e.g. x-forwarded-for,
 *                          x-real-ip or cf-connecting-ip
 *   AUTH_TRUSTED_PROXIES   optional, comma separated addresses or CIDR ranges
 *                          of proxies that append to X-Forwarded-For; the
 *                          rightmost address not in this list is the client
 */
export interface ClientIpOptions {
  ipAddressHeaders?: string[];
  trustedProxies?: string[];
  disableIpTracking?: boolean;
}

const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

export function clientIpOptions(env: Record<string, string | undefined> = process.env): ClientIpOptions {
  const header = env.AUTH_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!header) return { disableIpTracking: true };
  if (!HEADER_NAME.test(header)) throw new Error("AUTH_CLIENT_IP_HEADER must be a header name, such as x-forwarded-for.");
  const proxies = (env.AUTH_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return proxies.length > 0 ? { ipAddressHeaders: [header], trustedProxies: proxies } : { ipAddressHeaders: [header] };
}

/**
 * The client's address for the app's own per-address limits (the demo),
 * read the way the auth limits read it. Null when no header is trusted:
 * those limits are then off and only the site-wide ones apply. With
 * AUTH_TRUSTED_PROXIES, the rightmost address not listed is the client
 * (exact addresses only here); without it, the first address.
 */
export function clientAddress(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  const options = clientIpOptions(env);
  const header = options.ipAddressHeaders?.[0];
  if (!header) return null;
  const addresses = (headers.get(header) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (addresses.length === 0) return null;
  const proxies = new Set(options.trustedProxies ?? []);
  if (proxies.size === 0) return addresses[0];
  return [...addresses].reverse().find((address) => !proxies.has(address)) ?? null;
}
