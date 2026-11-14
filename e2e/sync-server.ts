import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import treeKill from "tree-kill";
import { e2eAuthEnv } from "./auth-env";

/**
 * Starts and stops `wrangler dev` for the sync Worker during end-to-end
 * tests. Global setup starts it; a test can stop and restart it to check
 * reconnection. The pid lives in a file because global setup and test
 * workers are separate processes.
 */

export const SYNC_PORT = 8788;
export const SYNC_URL = `http://localhost:${SYNC_PORT}`;
export const SYNC_SECRET = "e2e-secret";

const ROOT = join(__dirname, "..");
const STATE_DIR = join(ROOT, "test-results", "sync-state");
const PID_FILE = join(ROOT, "test-results", "sync-server.pid");
const WORKER_DIR = join(ROOT, "workers", "sync");
const WRANGLER_BIN = join(WORKER_DIR, "node_modules", "wrangler", "bin", "wrangler.js");

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://brahma:brahma@localhost:5432/brahma";
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch(`${SYNC_URL}/health`, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const ENV_FILE = join(ROOT, "test-results", "e2e-worker.env");

/** The Worker's secrets for end-to-end runs, as a dotenv file. */
function writeWorkerEnv(): string {
  mkdirSync(join(ROOT, "test-results"), { recursive: true });
  const vars = {
    DATABASE_URL: databaseUrl(),
    SYNC_INTERNAL_SECRET: SYNC_SECRET,
    SYNC_TOKEN_PUBLIC_KEYS: e2eAuthEnv().publicKeys,
  };
  const lines = Object.entries(vars).map(([key, value]) => `${key}='${value}'`);
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
  return ENV_FILE;
}

/** Start the Worker. Durable Object storage persists in STATE_DIR across restarts. */
export async function startSyncServer({ fresh = false } = {}): Promise<void> {
  if (fresh) rmSync(STATE_DIR, { recursive: true, force: true });
  mkdirSync(STATE_DIR, { recursive: true });

  // Run wrangler's entry point with node directly: no shell and no pnpm in
  // between, so the recorded pid is wrangler itself and killing its tree
  // also stops the workerd it supervises.
  const child: ChildProcess = spawn(
    process.execPath,
    [
      WRANGLER_BIN,
      "dev",
      "--port",
      String(SYNC_PORT),
      "--persist-to",
      STATE_DIR,
      // Its own env file, so a developer's workers/sync/.dev.vars never applies.
      "--env-file",
      writeWorkerEnv(),
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: WORKER_DIR,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
      stdio: "ignore",
      detached: process.platform !== "win32",
    },
  );
  child.unref();
  if (!child.pid) throw new Error("Could not start wrangler dev");
  writeFileSync(PID_FILE, String(child.pid));
  await waitFor(healthy, 60_000, "the sync server to start");
}

/** Start the Worker unless one is already answering. */
export async function ensureSyncServer(): Promise<void> {
  if (!(await healthy())) await startSyncServer();
}

/**
 * Kill any wrangler started for the sync port, by command line. Killing only
 * the port listener is not enough: wrangler restarts workerd when it dies.
 */
function killStrayServers(): void {
  try {
    if (process.platform === "win32") {
      const script =
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'wrangler.*--port " +
        SYNC_PORT +
        "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore" });
    } else {
      execFileSync("pkill", ["-f", `wrangler.*--port ${SYNC_PORT}`], { stdio: "ignore" });
    }
  } catch {
    // Nothing matched.
  }
}

/** Stop the Worker and wait until its port stops answering. */
export async function stopSyncServer(): Promise<void> {
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, "utf8"));
    rmSync(PID_FILE, { force: true });
    await new Promise<void>((resolve) => treeKill(pid, "SIGKILL", () => resolve()));
  }
  killStrayServers();
  await waitFor(async () => !(await healthy()), 20_000, "the sync server to stop");
}
