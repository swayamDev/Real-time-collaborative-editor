/**
 * The sync server refused this tab's bundle as older than the document's
 * schema (close code 4426). Fetch the new service worker and reload, after
 * every queued edit is written to the device, so offline edits survive and
 * are sent by the new bundle.
 *
 * Never loops: if this tab already reloaded for an update in the last two
 * minutes and is still refused, it asks the user to reload instead.
 */
const LAST_RELOAD_KEY = "brahma:update-reload-at";
export const RELOAD_WINDOW_MS = 120_000;
const WORKER_UPDATE_TIMEOUT_MS = 3_000;

export interface ReloadEnvironment {
  now(): number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  updateServiceWorker(): Promise<void>;
  reload(): void;
}

export function browserReloadEnvironment(): ReloadEnvironment {
  let storage: Storage | null = null;
  try {
    storage = sessionStorage;
  } catch {
    storage = null;
  }
  return {
    now: () => Date.now(),
    storage,
    updateServiceWorker: async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
    },
    reload: () => window.location.reload(),
  };
}

export async function reloadForUpdate(
  waitForDevice: () => Promise<void>,
  environment: ReloadEnvironment = browserReloadEnvironment(),
): Promise<"reloading" | "already-tried"> {
  const last = Number(environment.storage?.getItem(LAST_RELOAD_KEY) ?? 0);
  if (environment.now() - last < RELOAD_WINDOW_MS) return "already-tried";
  environment.storage?.setItem(LAST_RELOAD_KEY, String(environment.now()));
  await waitForDevice();
  await Promise.race([
    environment.updateServiceWorker().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, WORKER_UPDATE_TIMEOUT_MS)),
  ]);
  environment.reload();
  return "reloading";
}
