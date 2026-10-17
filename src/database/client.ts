// Adapted from SantaClaas/flashcut (src/database/client.ts): the same Web Locks leader election and
// BroadcastChannel RPC, serving Drizzle's sqlite-proxy calls instead of plain row objects.
import { connect } from "@tursodatabase/database-wasm/vite";

import { consume, provide, ProviderChangedError, type Consumer } from "../broadcast/service";
import { createLocalQueryService, type QueryService, type TursoConnection } from "./connection";
import { createDatabase, type Database } from "./drizzle";
import { runMigrations } from "./migrations";
import { loadPlan } from "./plan-repository";

const DATABASE_FILE = "week-budget-planner.db";
/**
 * Imported files are tried out in a copy named with this prefix and a random part. When a copy
 * fails to open, the engine keeps its file locked until the page reloads, so every try gets a new
 * name and the leader removes leftovers when it opens the database.
 */
const IMPORT_FILE_PREFIX = "week-budget-planner.import-";
/** The first 16 bytes of every SQLite database file. */
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");
const LOCK_NAME = "week-budget-planner-database-leader";
const CHANNEL_NAME = "week-budget-planner-database";
const SCOPE = "database";

/**
 * Multi-tab model: the OPFS sync access handle allows only one open database per origin, so tabs
 * elect a leader with the Web Locks API. The leader opens the real database, runs migrations, and
 * provides `DatabaseService` over a BroadcastChannel; every other tab proxies its calls to the leader.
 * When the leader tab closes, the lock is released and a surviving tab is promoted seamlessly.
 */
type DatabaseService = QueryService & {
  /** Checkpoints the WAL, briefly closes the database, and returns the raw SQLite file bytes. */
  exportFile(): Promise<Uint8Array>;
  /**
   * Replaces the database file and reloads every tab. Destructive. Leaves the database as it was
   * and returns "invalid-file" when the file isn't a database this app can open.
   */
  importFile(bytes: Uint8Array): Promise<"imported" | "invalid-file">;
  /** Deletes the database files entirely and reloads every tab. Destructive. */
  wipe(): Promise<void>;
};

let channel: BroadcastChannel | undefined;
let consumer: Consumer<DatabaseService> | undefined;
let isLeader = false;
let localDatabase: Promise<TursoConnection> | undefined;
let isElectionStarted = false;

/**
 * Set when a broken database should be deleted. The engine keeps a file it failed to open locked
 * until the page reloads, so the deletion happens at the next start, before anything opens it.
 */
const REMOVAL_KEY = "week-budget-planner.remove-database";

async function open(): Promise<TursoConnection> {
  if (readRemovalRequest()) {
    await removeDatabaseFiles();
    localStorage.removeItem(REMOVAL_KEY);
  }
  await removeImportLeftovers();
  const connection = (await connect(DATABASE_FILE)) as unknown as TursoConnection;
  await runMigrations(connection);
  return connection;
}

function getLocalConnection(): Promise<TursoConnection> {
  localDatabase ??= open();
  return localDatabase;
}

/**
 * Never settles. While the database is closed for an import or a delete, calls wait on this
 * instead of reopening the file, until every tab reloads.
 */
const waitForReload = new Promise<never>(() => {});

/** Closes the database so its files can be replaced. Later calls wait for the reload. */
async function closeForReload(): Promise<void> {
  const database = await getLocalConnection();
  localDatabase = waitForReload;
  // Folds the WAL into the file, so removing the WAL loses nothing if the action fails later.
  await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await database.close();
}

/** Deletes a file in OPFS. A file that doesn't exist is fine; any other error is thrown. */
async function removeFile(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await root.removeEntry(name);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}

/** Writes a whole file in OPFS. The file only changes when the write completes. */
async function writeFile(root: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

/** Removes copies left from earlier imports. One still locked by this page waits for the next open. */
async function removeImportLeftovers(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) {
    if (!name.startsWith(IMPORT_FILE_PREFIX)) continue;
    await root.removeEntry(name).catch((error: unknown) => console.debug("[database] kept a locked import copy", name, error));
  }
}

async function readFileBytes(): Promise<Uint8Array> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DATABASE_FILE);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

const hasSqliteHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= SQLITE_HEADER.length && SQLITE_HEADER.every((byte, index) => bytes[index] === byte);

/**
 * Whether the file is a database this app can open: it has the SQLite header, and a copy of it
 * opens, migrates and holds a readable plan. The copy is deleted again either way.
 */
async function isImportable(bytes: Uint8Array): Promise<boolean> {
  if (!hasSqliteHeader(bytes)) return false;
  const root = await navigator.storage.getDirectory();
  const name = `${IMPORT_FILE_PREFIX}${crypto.randomUUID()}.db`;
  await writeFile(root, name, bytes);
  let connection: TursoConnection | undefined;
  try {
    connection = (await connect(name)) as unknown as TursoConnection;
    await runMigrations(connection);
    const opened = connection;
    await loadPlan(createDatabase(createLocalQueryService(async () => opened)));
    return true;
  } catch (error) {
    console.warn("[database] the imported file can't be opened", error);
    return false;
  } finally {
    await connection?.close();
    await removeImportLeftovers();
  }
}

function broadcastReload(): void {
  // Every tab must restart on the new data; the poster doesn't receive its own broadcast, so the
  // leader reloads itself explicitly.
  channel?.postMessage({ scope: SCOPE, kind: "reload" });
  location.reload();
}

/** The leader-side implementation working on the locally opened database. */
const localService: DatabaseService = {
  ...createLocalQueryService(getLocalConnection),

  async exportFile() {
    const database = await getLocalConnection();
    await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const bytesAfterClose = (async () => {
      await database.close();
      return readFileBytes();
    })();
    // Queue every later call behind the reopen so the closed window stays private. Reopen even
    // when reading failed, or every later call would fail too.
    localDatabase = bytesAfterClose.then(open, open);
    return bytesAfterClose;
  },

  async importFile(bytes) {
    if (!(await isImportable(bytes))) return "invalid-file";
    await closeForReload();
    try {
      const root = await navigator.storage.getDirectory();
      // Drop the WAL so it cannot be replayed over the imported file.
      await removeFile(root, `${DATABASE_FILE}-wal`);
      await writeFile(root, DATABASE_FILE, bytes);
    } catch (error) {
      localDatabase = open();
      throw error;
    }
    broadcastReload();
    return "imported";
  },

  async wipe() {
    await closeForReload();
    try {
      await removeDatabaseFiles();
    } catch (error) {
      localDatabase = open();
      throw error;
    }
    broadcastReload();
  },
};

async function removeDatabaseFiles(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await removeFile(root, `${DATABASE_FILE}-wal`);
  await removeFile(root, DATABASE_FILE);
}

/** Whether this browser has a database file, so a failure to open it means it's broken. */
export async function hasDatabaseFile(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle(DATABASE_FILE);
    return true;
  } catch {
    return false;
  }
}

function readRemovalRequest(): boolean {
  try {
    return localStorage.getItem(REMOVAL_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Deletes a database that fails to open: every tab reloads, and the next leader deletes the files
 * before opening the database (see {@link REMOVAL_KEY}). Throws when localStorage is blocked.
 */
export function removeBrokenDatabase(): void {
  localStorage.setItem(REMOVAL_KEY, Temporal.Now.instant().toString());
  broadcastReload();
}

function setUp(): { channel: BroadcastChannel; consumer: Consumer<DatabaseService> } {
  if (!channel || !consumer) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    consumer = consume<DatabaseService>(channel, SCOPE);
    channel.addEventListener("message", (event: MessageEvent<{ scope?: string; kind?: string }>) => {
      if (event.data?.scope === SCOPE && event.data.kind === "reload") location.reload();
    });
  }
  return { channel, consumer };
}

function startElection(): void {
  if (isElectionStarted) return;
  isElectionStarted = true;
  const { channel, consumer } = setUp();
  void navigator.locks.request(LOCK_NAME, async () => {
    isLeader = true;
    consumer.handlePromotion();
    // Serve right away: calls wait for the database inside the service, and the other tabs see
    // this tab answering while the engine loads (see "Calls between tabs" in docs/SPEC.md).
    provide(channel, SCOPE, localService);
    console.debug("[database] acquired leader lock, serving the database");
    await getLocalConnection().catch(() => undefined);
    // Hold the lock, and with it leadership, until this tab dies.
    await new Promise<never>(() => {});
  });
}

/** Runs `operation` locally when leader, otherwise through the leader tab. */
async function callService<T>(operation: (service: DatabaseService) => Promise<T>): Promise<T> {
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

/** Role-independent `DatabaseService`: local on the leader, proxied elsewhere. */
export const databaseService: DatabaseService = {
  query: (sql, parameters, method) => callService((service) => service.query(sql, parameters, method)),
  batch: (statements) => callService((service) => service.batch(statements)),
  exportFile: () => callService((service) => service.exportFile()),
  importFile: (bytes) => callService((service) => service.importFile(bytes)),
  wipe: () => callService((service) => service.wipe()),
};

let database: Database | undefined;

/** The app's Drizzle database as seen from this tab. */
export function getDatabase(): Database {
  database ??= createDatabase(databaseService);
  return database;
}
