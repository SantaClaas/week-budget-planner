// Adapted from SantaClaas/flashcut (src/db/client.ts): the same Web Locks leader election and
// BroadcastChannel RPC, serving Drizzle's sqlite-proxy calls instead of plain row objects.
import { connect } from "@tursodatabase/database-wasm/vite";

import { consume, provide, ProviderChangedError } from "../lib/broadcast-service";
import { localQueryService, type QueryService, type TursoConnection } from "./connection";
import { createDb, type Db } from "./drizzle";
import { runMigrations } from "./migrations";

export const DB_FILE = "week-budget-planner.db";
const LOCK_NAME = "week-budget-planner-db-leader";
const CHANNEL_NAME = "week-budget-planner-db";
const SCOPE = "db";

/**
 * Multi-tab model: the OPFS sync access handle allows only one open database per origin, so tabs
 * elect a leader with the Web Locks API. The leader opens the real database, runs migrations, and
 * provides `DbService` over a BroadcastChannel; every other tab proxies its calls to the leader.
 * When the leader tab closes, the lock is released and a surviving tab is promoted seamlessly.
 */
export type DbService = QueryService & {
  /** Checkpoints the WAL, briefly closes the database, and returns the raw SQLite file bytes. */
  exportFile(): Promise<Uint8Array>;
  /** Replaces the database file and reloads every tab. Destructive. */
  importFile(bytes: Uint8Array): Promise<void>;
  /** Deletes the database files entirely and reloads every tab. Destructive. */
  wipe(): Promise<void>;
};

let channel: BroadcastChannel | undefined;
let consumer: ReturnType<typeof consume<DbService>> | undefined;
let isLeader = false;
let localDb: Promise<TursoConnection> | undefined;
let electionStarted = false;

async function open(): Promise<TursoConnection> {
  const connection = (await connect(DB_FILE)) as unknown as TursoConnection;
  await runMigrations(connection);
  return connection;
}

function getLocal(): Promise<TursoConnection> {
  localDb ??= open();
  return localDb;
}

async function readFileBytes(): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DB_FILE);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

function broadcastReload(): void {
  // Every tab must restart on the new data; the poster doesn't receive its own broadcast, so the
  // leader reloads itself explicitly.
  channel?.postMessage({ scope: SCOPE, kind: "reload" });
  location.reload();
}

/** The leader-side implementation working on the locally opened database. */
const localService: DbService = {
  ...localQueryService(getLocal),

  async exportFile() {
    const db = await getLocal();
    await db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytesAfterClose = (async () => {
      await db.close();
      return readFileBytes();
    })();
    // Queue every later call behind the reopen so the closed window stays private.
    localDb = bytesAfterClose.then(open);
    return bytesAfterClose;
  },

  async importFile(bytes) {
    const db = await getLocal();
    await db.close();
    localDb = undefined;
    const root = await navigator.storage.getDirectory();
    // Drop a stale WAL so it cannot be replayed over the imported file.
    await root.removeEntry(`${DB_FILE}-wal`).catch(() => undefined);
    const handle = await root.getFileHandle(DB_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
    broadcastReload();
  },

  async wipe() {
    const db = await getLocal();
    await db.close();
    localDb = undefined;
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`${DB_FILE}-wal`).catch(() => undefined);
    await root.removeEntry(DB_FILE).catch(() => undefined);
    broadcastReload();
  },
};

function setUp(): { channel: BroadcastChannel; consumer: ReturnType<typeof consume<DbService>> } {
  if (!channel || !consumer) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    consumer = consume<DbService>(channel, SCOPE);
    channel.addEventListener("message", (event: MessageEvent<{ scope?: string; kind?: string }>) => {
      if (event.data?.scope === SCOPE && event.data.kind === "reload") location.reload();
    });
  }
  return { channel, consumer };
}

function startElection(): void {
  if (electionStarted) return;
  electionStarted = true;
  const { channel, consumer } = setUp();
  void navigator.locks.request(LOCK_NAME, async () => {
    isLeader = true;
    consumer.handlePromotion();
    await getLocal();
    provide(channel, SCOPE, localService);
    console.debug("[db] acquired leader lock, serving the database");
    // Hold the lock, and with it leadership, until this tab dies.
    await new Promise<never>(() => {});
  });
}

/** Runs `operation` locally when leader, otherwise through the leader tab. */
async function callService<T>(operation: (service: DbService) => Promise<T>): Promise<T> {
  startElection();
  const { consumer } = setUp();
  while (true) {
    if (isLeader) return operation(localService);
    try {
      return await operation(consumer.proxy);
    } catch (error) {
      // Promoted mid-wait: the call was never sent, safe to redispatch locally.
      if (error instanceof ProviderChangedError) continue;
      throw error;
    }
  }
}

/** Role-independent `DbService`: local on the leader, proxied elsewhere. */
export const dbService: DbService = {
  query: (sql, params, method) => callService((service) => service.query(sql, params, method)),
  batch: (statements) => callService((service) => service.batch(statements)),
  exportFile: () => callService((service) => service.exportFile()),
  importFile: (bytes) => callService((service) => service.importFile(bytes)),
  wipe: () => callService((service) => service.wipe()),
};

let db: Db | undefined;

/** The app's Drizzle database as seen from this tab. */
export function getDb(): Db {
  db ??= createDb(dbService);
  return db;
}
