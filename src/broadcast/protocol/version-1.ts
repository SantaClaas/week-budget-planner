// The messages between tabs as protocol version 1 defines them. Never edit this file: tabs that run
// this version keep sending and reading exactly these shapes, whatever the code here becomes. The
// compatibility test checks the current messages against them (see ./index.ts).

export type ServiceMessage = { protocolVersion: number; scope: string } & (
  | { type: "call"; id: string; property: string; parameters: unknown[] }
  | { type: "result"; id: string; result: unknown }
  | { type: "error"; id: string; error: unknown; name?: string }
  | { type: "provider-ready"; providerId: string }
  | { type: "provider-query" }
  | { type: "reload" }
);

export type BroadcastMessage = { protocolVersion: number; type: "plan-changed" };
