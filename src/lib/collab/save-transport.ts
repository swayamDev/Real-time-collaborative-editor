/**
 * Browsers cap the combined body size of in-flight `keepalive` requests at
 * 64 KiB. Anything larger is rejected outright, so on unload we only use
 * keepalive when the pending save fits, and fall back to a normal fetch
 * (which may be cancelled by navigation) otherwise. The beforeunload warning
 * stays in place either way until the server confirms the save.
 */
export const KEEPALIVE_BODY_LIMIT = 64 * 1024;

export type SaveTransport = "keepalive" | "normal";

export function chooseTransport(totalBodyBytes: number, unloading: boolean): SaveTransport {
  return unloading && totalBodyBytes <= KEEPALIVE_BODY_LIMIT ? "keepalive" : "normal";
}
