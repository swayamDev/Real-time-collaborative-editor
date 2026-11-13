import { startSyncServer, stopSyncServer } from "./sync-server";

export default async function globalSetup(): Promise<void> {
  await stopSyncServer();
  await startSyncServer({ fresh: true });
}
