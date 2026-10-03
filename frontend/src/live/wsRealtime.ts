import { Actor, HttpAgent, SignIdentity } from "@dfinity/agent";
import type { Identity as DfinityIdentity, PublicKey } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { IcWebSocket, createWsConfig } from "ic-websocket-js";
import type { Identity } from "@icp-sdk/core/agent";
import { getActiveIcpTarget } from "./targetRegistry";
import { getCurrentInternetIdentity } from "./internetIdentityAuth";
import { isFeatureRoutedToIcp } from "./loadBackendRouting";

/**
 * Live chat realtime for ICP-routed messaging, over IC WebSockets.
 *
 * The app holds one WebSocket to a self-hosted IC WebSocket gateway, signed
 * with the member's Internet Identity delegation (no Supabase involved). The
 * gateway registers the session with messaging_domain and relays "pokes" —
 * conversation id + sequence number only, never message content — which the
 * canister emits on every send and reaction toggle. Listeners react to a poke
 * exactly like a poll tick: they refetch the affected chat through the normal
 * certified query path.
 *
 * Fail-soft by design: when no gateway URL is configured, no messaging_domain
 * canister ID is set, nobody is signed in via Internet Identity, or the
 * gateway is unreachable, this module simply never becomes healthy and the
 * existing adaptive polling (10s visible / 60s hidden) keeps running. Polling
 * ticks skip their invalidation while the socket is healthy, so it drops to a
 * no-op safety net that resumes automatically if the socket drops.
 *
 * Package bridge note: ic-websocket-js is built against the @dfinity/* agent
 * packages while the app uses @icp-sdk/* (the same codebase, rebranded). The
 * two copies are runtime-compatible on the wire, but `instanceof` checks in
 * the client library (SignIdentity, IDL.OptClass) must see ITS OWN package
 * copies, so this module deliberately builds the WS-only actor and identity
 * from @dfinity/* and bridges to the app's identity by delegation.
 */

export type ChatPoke = { conversation_id: string; sequence: bigint };

// Minimal WS-only service surface. The client library only uses the actor to
// extract the application-message IDL (the second argument of ws_message);
// ws_open/ws_message wire calls go through its own agent with its own IDLs,
// and we never send application messages (pokes are server → client only).
const wsIdlFactory = ({ IDL }: { IDL: any }) => {
  const WsAppMessage = IDL.Variant({
    chat_poke: IDL.Record({ conversation_id: IDL.Text, sequence: IDL.Nat64 }),
  });
  const WebsocketMessage = IDL.Record({
    sequence_num: IDL.Nat64,
    content: IDL.Vec(IDL.Nat8),
    client_key: IDL.Record({ client_principal: IDL.Principal, client_nonce: IDL.Nat64 }),
    timestamp: IDL.Nat64,
    is_service_message: IDL.Bool,
  });
  const Result = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  return IDL.Service({
    ws_message: IDL.Func([IDL.Record({ msg: WebsocketMessage }), IDL.Opt(WsAppMessage)], [Result], []),
  });
};

/**
 * Adapts the app's @icp-sdk identity to the @dfinity/agent SignIdentity the
 * client library insists on (it checks `instanceof`). Signing and request
 * transforms are delegated straight through, so II delegations keep working.
 */
class BridgedSignIdentity extends SignIdentity {
  // The app's Identity interface only exposes getPrincipal/transformRequest;
  // II sessions always carry a signing identity, so the extra members are
  // present at runtime and accessed through this structural view.
  private readonly signer: Identity & {
    getPublicKey(): unknown;
    sign(blob: ArrayBuffer): Promise<unknown>;
  };
  constructor(inner: Identity) {
    super();
    this.signer = inner as BridgedSignIdentity["signer"];
  }
  getPublicKey(): PublicKey {
    return this.signer.getPublicKey() as PublicKey;
  }
  getPrincipal(): Principal {
    return Principal.fromText(this.signer.getPrincipal().toText());
  }
  sign(blob: ArrayBuffer): Promise<Uint8Array> {
    return this.signer.sign(blob) as Promise<Uint8Array>;
  }
  transformRequest(request: unknown): Promise<unknown> {
    return (this.signer as unknown as DfinityIdentity).transformRequest(request as never) as Promise<unknown>;
  }
}

const pokeListeners = new Set<(poke: ChatPoke) => void>();
const healthListeners = new Set<(healthy: boolean) => void>();

let socket: IcWebSocket<any> | null = null;
let healthy = false;
let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let connecting = false;

function setHealthy(next: boolean): void {
  if (healthy === next) return;
  healthy = next;
  for (const listener of [...healthListeners]) {
    try {
      listener(next);
    } catch {
      // Listener errors must never take down the socket.
    }
  }
}

/** Registers a poke listener and lazily starts the shared connection. */
export function subscribeChatPokes(listener: (poke: ChatPoke) => void): () => void {
  pokeListeners.add(listener);
  void ensureChatRealtime();
  return () => {
    pokeListeners.delete(listener);
  };
}

export function isChatWsHealthy(): boolean {
  return healthy;
}

/** Health-change subscription for UI that adapts to socket state. */
export function subscribeChatWsHealth(listener: (healthy: boolean) => void): () => void {
  healthListeners.add(listener);
  return () => {
    healthListeners.delete(listener);
  };
}

/**
 * Idempotently starts the shared connection. Safe to call from anywhere;
 * resolves immediately (and stays unhealthy) when realtime is not applicable:
 * messaging not ICP-routed, no gateway URL/canister ID configured, or no II
 * session. Never throws.
 */
export async function ensureChatRealtime(): Promise<void> {
  if (started) return;
  started = true;
  void connect();
}

/** Tears the connection down (sign-out). The next subscription restarts it. */
export function disconnectChatRealtime(): void {
  started = false;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const current = socket;
  socket = null;
  setHealthy(false);
  if (current) {
    try {
      current.close();
    } catch {
      // Closing an already-dead socket is best-effort.
    }
  }
}

async function connect(): Promise<void> {
  if (connecting) return;
  connecting = true;
  try {
    if (!isFeatureRoutedToIcp("messaging")) return;
    const target = getActiveIcpTarget();
    const gatewayUrl = target.wsGatewayUrl;
    const canisterId = target.canisterIds["messaging_domain"];
    // Not configured yet (canisters/gateway undeployed) — stay on polling
    // without retrying; a later ensureChatRealtime() after sign-in or config
    // change can try again.
    if (!gatewayUrl || !canisterId) return;
    const identity = await getCurrentInternetIdentity();
    if (!identity) return;

    const bridged = new BridgedSignIdentity(identity);
    // The actor only feeds application-message IDL extraction; its agent is
    // never used for calls. The client builds its own agent from networkUrl.
    const agent = HttpAgent.createSync({ host: target.host, identity: bridged });
    const actor = Actor.createActor(wsIdlFactory, { agent, canisterId });
    const ws = new IcWebSocket(
      gatewayUrl,
      undefined,
      createWsConfig({
        canisterId,
        canisterActor: actor,
        identity: bridged,
        networkUrl: target.host,
      }),
    );
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return;
      reconnectAttempts = 0;
      setHealthy(true);
    };
    ws.onmessage = (ev: MessageEvent<unknown>) => {
      const poke = (ev.data as { chat_poke?: { conversation_id: string; sequence: bigint } } | null)?.chat_poke;
      if (!poke) return;
      for (const listener of [...pokeListeners]) {
        try {
          listener({ conversation_id: poke.conversation_id, sequence: poke.sequence });
        } catch {
          // Listener errors must never take down the socket.
        }
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      setHealthy(false);
      scheduleReconnect();
    };
    // onerror is always followed by onclose; nothing to do there.
  } catch {
    setHealthy(false);
    scheduleReconnect();
  } finally {
    connecting = false;
  }
}

function scheduleReconnect(): void {
  if (!started || reconnectTimer !== null) return;
  // Exponential backoff, 1s → 30s cap.
  const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}
