import { createServer, connect, type Server, type Socket } from "node:net";

/**
 * What the proxy does with a connection to the relay: pass it on, hold it open without a word (a
 * network that blocks it), or close it at once (no relay there).
 */
type RelayMode = "pass" | "silent" | "refuse";

export type RelayProxy = {
  /** The proxy's origin, which the page is loaded from, so its relay is the proxy too. */
  origin: string;
  setMode(mode: RelayMode): void;
  /** Closes every connection to the relay that is open now. */
  dropRelay(): void;
  /** How many connections to the relay have come in. */
  countRelayConnections(): number;
  close(): Promise<void>;
};

/**
 * Whether a connection's first bytes ask for the relay, with or without a query. A WebSocket gets a
 * connection of its own.
 */
const isRelayRequest = (chunk: Buffer): boolean =>
  /^GET \/relay[ ?]/u.test(chunk.toString("latin1", 0, 12));

/**
 * A TCP proxy in front of the server, for the transport's browser tests: Playwright can't route a
 * worker's WebSockets, so the page is loaded through this, and it decides what happens to the
 * relay's connections. Everything else passes through unchanged.
 *
 * @param target - The server's port on 127.0.0.1.
 */
export async function startRelayProxy(target: number): Promise<RelayProxy> {
  let mode: RelayMode = "pass";
  let relayConnections = 0;
  const relaySockets = new Set<Socket>();
  const sockets = new Set<Socket>();

  const handle = (client: Socket): void => {
    sockets.add(client);
    client.on("close", () => {
      sockets.delete(client);
    });
    client.once("data", (first: Buffer) => {
      const isRelay = isRelayRequest(first);
      if (isRelay) relayConnections += 1;

      if (isRelay && mode === "silent") return;

      if (isRelay && mode === "refuse") {
        client.destroy();
        return;
      }

      const upstream = connect(target, "127.0.0.1");
      sockets.add(upstream);
      if (isRelay) relaySockets.add(client);

      upstream.write(first);
      client.pipe(upstream).pipe(client);
      const end = (): void => {
        relaySockets.delete(client);
        client.destroy();
        upstream.destroy();
      };
      client.on("error", end).on("close", end);
      upstream.on("error", end).on("close", end);
    });
  };

  const server: Server = createServer(handle);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the proxy has no port");

  return {
    origin: `http://127.0.0.1:${address.port}`,
    setMode(next) {
      mode = next;
    },
    dropRelay() {
      for (const socket of relaySockets) socket.destroy();
    },
    countRelayConnections: () => relayConnections,
    async close() {
      for (const socket of sockets) socket.destroy();

      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
