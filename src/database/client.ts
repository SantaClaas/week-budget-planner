// Adapted from SantaClaas/flashcut (src/database/client.ts): the same Web Locks leader election and
// BroadcastChannel RPC, serving Drizzle's sqlite-proxy calls instead of plain row objects.
import { connect } from "@tursodatabase/database-wasm/vite";

import { PROTOCOL_VERSION } from "../broadcast/protocol/index.ts";
import {
  consume,
  NewerProtocolError,
  provide,
  ProviderChangedError,
  type Consumer,
  type ServiceMessage,
} from "../broadcast/service.ts";
import { createLocalQueryService, type QueryService, type TursoConnection } from "./connection.ts";
import { createDatabase, type Database } from "./drizzle.ts";
import { NewerDatabaseError, runMigrations } from "./migration.ts";
import { loadPlan } from "./plan-repository.ts";
import { randomIds } from "../plan/id.ts";
import type { Result } from "../result.ts";

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
  exportFile(): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Replaces the database file and reloads every tab. Destructive. Leaves the database as it was
   * and returns "invalid-file" when the file isn't a database this app can open, or
   * "newer-version" when a newer version of the app made it.
   */
  importFile(bytes: Uint8Array<ArrayBuffer>): Promise<Result<"imported", ImportProblem>>;
  /** Deletes the database files entirely and reloads every tab. Destructive. */
  wipe(): Promise<void>;
};

let channel: BroadcastChannel | undefined;
let consumer: Consumer<DatabaseService> | undefined;
let isLeader = false;
let localDatabase: Promise<TursoConnection> | undefined;
let isElectionStarted = false;

/**
 * Set once another tab runs a newer version of the app. This tab then takes no part in the
 * election and refuses every call, so only the newer tab opens and migrates the database (see
 * "Tabs on different versions" in docs/spec/persistence.md).
 */
let isOutdated = false;
/** Aborted when this tab steps down: it leaves the lock queue, or ends its leadership. */
const election = new AbortController();
const newerVersionListeners = new Set<() => void>();

/**
 * Set when a broken database should be deleted. The engine keeps a file it failed to open locked
 * until the page reloads, so the deletion happens at the next start, before anything opens it.
 */
const REMOVAL_KEY = "week-budget-planner.remove-database";

/** Opens a database file in OPFS through the engine, typed as the part of its API this app uses. */
function connectFile(path: string): Promise<TursoConnection> {
  return connect(path);
}

async function open(): Promise<TursoConnection> {
  if (readRemovalRequest()) {
    await removeDatabaseFiles();
    localStorage.removeItem(REMOVAL_KEY);
  }
  await removeImportLeftovers();
  const connection = await connectFile(DATABASE_FILE);
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

/** Closes the database for the newer tab to open. Later calls are refused (see callService). */
async function closeForNewerVersion(): Promise<void> {
  const opening = localDatabase;
  localDatabase = waitForReload;
  if (opening === undefined) return;
  let database: TursoConnection;
  try {
    database = await opening;
  } catch {
    // It never opened, so there's nothing to close.
    return;
  }
  // Folds the WAL into the file, so the newer tab reads everything this one wrote.
  await database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  await database.close();
}

/** Steps down for a tab on a newer version, once, and tells whoever listens. */
function giveWayToNewerVersion(): void {
  if (isOutdated) return;
  isOutdated = true;
  console.info("[database] a newer version of the app runs in another tab, so this one steps down");
  election.abort();
  for (const listener of newerVersionListeners) listener();
}

/** Resolves when the signal aborts, at once if it already has. */
function waitForAbort(signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) resolve();
  signal.addEventListener(
    "abort",
    () => {
      resolve();
    },
    { once: true },
  );
  return promise;
}

/**
 * Calls back once this tab learns that another runs a newer version of the app, and has stepped
 * down for it.
 * @mustUse Gives back the function that stops listening.
 */
export function onNewerVersion(listener: () => void): () => void {
  newerVersionListeners.add(listener);
  return () => {
    newerVersionListeners.delete(listener);
  };
}

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
async function writeFile(
  root: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const handle = await root.getFileHandle(name, { create: true });
  await using writing = await startWriting(handle);
  await writing.write(bytes);
  await writing.commit();
}

/** A file being written: commit() keeps what was written, and disposing it uncommitted drops it. */
type Writing = AsyncDisposable & {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  commit(): Promise<void>;
};

/**
 * Starts writing a file in OPFS. Declared with `await using`, the write is aborted however the
 * scope ends, unless commit() ran first, so the file stays as it was.
 */
async function startWriting(handle: FileSystemFileHandle): Promise<Writing> {
  const writable = await handle.createWritable();
  let isCommitted = false;
  return {
    write: (bytes) => writable.write(bytes),
    async commit() {
      // Closing is what replaces the file with what was written.
      await writable.close();
      isCommitted = true;
    },
    async [Symbol.asyncDispose]() {
      if (isCommitted) return;
      await writable.abort();
    },
  };
}

/** Removes copies left from earlier imports. One still locked by this page waits for the next open. */
async function removeImportLeftovers(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) {
    if (!name.startsWith(IMPORT_FILE_PREFIX)) continue;
    await root.removeEntry(name).catch((error: unknown) => {
      console.debug("[database] kept a locked import copy", name, error);
    });
  }
}

async function readFileBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(DATABASE_FILE);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

const hasSqliteHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= SQLITE_HEADER.length &&
  SQLITE_HEADER.every((byte, index) => bytes[index] === byte);

/** Why a file can't be imported. */
type ImportProblem = "invalid-file" | "newer-version";

/**
 * Whether the file is a database this app can open: it has the SQLite header, and a copy of it
 * opens, migrates and holds a readable plan. The copy is deleted again either way.
 */
async function checkImport(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Result<"importable", ImportProblem>> {
  if (!hasSqliteHeader(bytes)) return "invalid-file";
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(removeImportLeftovers);
  const name = `${IMPORT_FILE_PREFIX}${crypto.randomUUID()}.db`;
  await writeFile(await navigator.storage.getDirectory(), name, bytes);
  try {
    await readCopy(name);
  } catch (error) {
    if (error instanceof NewerDatabaseError) return "newer-version";
    console.warn("[database] the imported file can't be opened", error);
    return "invalid-file";
  }
  return "importable";
}

/** Opens the copy of an imported database, migrates it and reads its plan. Throws when it can't. */
async function readCopy(name: string): Promise<void> {
  await using resources = new AsyncDisposableStack();
  const connection = resources.adopt(await connectFile(name), (opened) => opened.close());
  await runMigrations(connection);
  const database = createDatabase(createLocalQueryService(() => Promise.resolve(connection)));
  await loadPlan(database, randomIds);
}

function broadcastReload(): void {
  // Every tab must restart on the new data; the poster doesn't receive its own broadcast, so the
  // leader reloads itself explicitly.
  channel?.postMessage({
    protocolVersion: PROTOCOL_VERSION,
    scope: SCOPE,
    type: "reload",
  } satisfies ServiceMessage);
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
    const check = await checkImport(bytes);
    if (check !== "importable") return check;
    await closeForReload();
    try {
      await replaceDatabaseFile(bytes);
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

async function replaceDatabaseFile(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const root = await navigator.storage.getDirectory();
  // Drop the WAL so it cannot be replayed over the imported file.
  await removeFile(root, `${DATABASE_FILE}-wal`);
  await writeFile(root, DATABASE_FILE, bytes);
}

async function removeDatabaseFiles(): Promise<void> {
  const root = await navigator.storage.getDirectory();
  await removeFile(root, `${DATABASE_FILE}-wal`);
  await removeFile(root, DATABASE_FILE);
}

/** Whether this browser has a database file, so a failure to open it means it's broken. */
export async function hasDatabaseFile(): Promise<boolean> {
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    // The browser refused OPFS, as in some private windows, so there's no file either.
    return false;
  }
  try {
    await root.getFileHandle(DATABASE_FILE);
  } catch {
    return false;
  }
  return true;
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
    consumer = consume<DatabaseService>(channel, SCOPE, { onNewerVersion: giveWayToNewerVersion });
    channel.addEventListener("message", (event: MessageEvent<ServiceMessage>) => {
      const message = event.data;
      if (message.protocolVersion !== PROTOCOL_VERSION || message.scope !== SCOPE) return;
      if (message.type === "reload") location.reload();
    });
  }
  return { channel, consumer };
}

function startElection(): void {
  if (isElectionStarted) return;
  isElectionStarted = true;
  const connected = setUp();
  navigator.locks
    .request(LOCK_NAME, { signal: election.signal }, async () => {
      isLeader = true;
      connected.consumer.handlePromotion();
      // Serve right away: calls wait for the database inside the service, and the other tabs see
      // this tab answering while the engine loads (see "Calls between tabs" in
      // docs/spec/persistence.md).
      const stopServing = provide(connected.channel, SCOPE, localService, {
        onNewerVersion: giveWayToNewerVersion,
      });
      console.debug("[database] acquired leader lock, serving the database");
      // A failure to open shows up again on every call, so here it only must not end the lock.
      await getLocalConnection().catch(() => {});
      // Hold the lock, and with it leadership, until this tab dies or steps down for a newer one.
      await waitForAbort(election.signal);
      stopServing();
      await closeForNewerVersion();
    })
    .catch((error: unknown) => {
      // Stepping down while still waiting for the lock leaves the queue, which rejects the request.
      if (error instanceof DOMException && error.name === "AbortError") return;
      console.error("[database] the leader election failed", error);
    });
}

/** Runs `operation` locally when leader, otherwise through the leader tab. */
async function callService<T>(operation: (service: DatabaseService) => Promise<T>): Promise<T> {
  if (isOutdated) throw new NewerDatabaseError("A newer version of the app runs in another tab.");
  startElection();
  const leader = setUp().consumer;
  while (true) {
    if (isLeader) return operation(localService);
    try {
      // oxlint-disable-next-line no-await-in-loop -- tried again only after a promotion, so this runs at most twice.
      return await operation(leader.proxy);
    } catch (error) {
      // Promoted mid-wait: the call was never sent, safe to redispatch locally.
      if (error instanceof ProviderChangedError) continue;
      if (error instanceof NewerProtocolError) {
        throw new NewerDatabaseError("A newer version of the app runs in another tab.", {
          cause: error,
        });
      }
      throw error;
    }
  }
}

/** Role-independent `DatabaseService`: local on the leader, proxied elsewhere. */
export const databaseService: DatabaseService = {
  query: (sql, parameters, method) =>
    callService((service) => service.query(sql, parameters, method)),
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
