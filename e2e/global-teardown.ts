import { stopSyncServer } from "./sync-server";

export default async function globalTeardown(): Promise<void> {
  await stopSyncServer();
}
