// Shared by the page (main.js) and the worker (worker.js): loads the
// WebAssembly module, binds an iroh endpoint behind our relay and echoes
// bytes with the native server node. Every step is timed.

import init, { Node } from "./pkg/spike_browser.js";

let initialized;

export async function bind(relayUrl) {
  const times = {};
  const start = performance.now();
  initialized ??= init();
  await initialized;
  times.instantiateMs = Math.round(performance.now() - start);
  const node = await Node.spawn(relayUrl);
  times.onlineMs = Math.round(performance.now() - start);
  return { node, times, start };
}

// Against n0's public relays: bind with iroh's defaults and dial the server
// by its public key alone, so its relay comes from pkarr address lookup.
export async function runPublic({ serverId, isWithoutTrailingDot }) {
  const times = {};
  const start = performance.now();
  initialized ??= init();
  await initialized;
  times.instantiateMs = Math.round(performance.now() - start);
  console.info(`stage: instantiated after ${times.instantiateMs} ms`);
  const node = await Node.spawnPublic(isWithoutTrailingDot);
  times.onlineMs = Math.round(performance.now() - start);
  console.info(`stage: online after ${times.onlineMs} ms, home relay ${node.relayUrl()}`);
  const payload = new TextEncoder().encode(`hello from ${self.constructor.name} via n0`);
  const answer = await node.echoById(serverId, payload);
  times.firstEchoMs = Math.round(performance.now() - start);
  const secondStart = performance.now();
  await node.echoById(serverId, payload);
  times.secondEchoMs = Math.round(performance.now() - secondStart);
  return {
    endpointId: node.endpointId(),
    homeRelay: node.relayUrl(),
    answer: new TextDecoder().decode(answer),
    times,
    node,
  };
}

export async function run({ relayUrl, serverId }) {
  if (relayUrl.startsWith("public")) {
    return runPublic({ serverId, isWithoutTrailingDot: relayUrl === "public-without-dot" });
  }
  const { node, times, start } = await bind(relayUrl);
  const payload = new TextEncoder().encode(`hello from ${self.constructor.name}`);
  const answer = await node.echo(serverId, payload);
  times.firstEchoMs = Math.round(performance.now() - start);
  const secondStart = performance.now();
  await node.echo(serverId, payload);
  times.secondEchoMs = Math.round(performance.now() - secondStart);
  return {
    endpointId: node.endpointId(),
    answer: new TextDecoder().decode(answer),
    times,
    node,
  };
}
