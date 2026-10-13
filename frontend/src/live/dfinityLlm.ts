import { Actor, AnonymousIdentity, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";

/**
 * Minimal anonymous client for DFINITY's publicly hosted LLM canister
 * (https://internetcomputer.org/docs — "LLM canister"). No cycles, no
 * Internet Identity: the canister accepts anonymous calls, so this never
 * goes through the app's signed-in Internet Identity agent/target config.
 *
 * The IDL below is hand-written against the single method this app uses:
 *   v0_chat : (record { model: text; messages: vec record { role: variant
 *     { user; system; assistant }; content: text } }) -> (text);
 */
export const DFINITY_LLM_CANISTER_ID = "w36hm-eqaaa-aaaal-qr76a-cai";
const DFINITY_LLM_HOST = "https://icp-api.io";

export type DfinityLlmRole = "user" | "system" | "assistant";

export interface DfinityLlmMessage {
  role: DfinityLlmRole;
  content: string;
}

interface DfinityLlmCandidMessage {
  role: { user: null } | { system: null } | { assistant: null };
  content: string;
}

interface DfinityLlmActor {
  v0_chat: (request: { model: string; messages: DfinityLlmCandidMessage[] }) => Promise<string>;
}

const llmIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const Role = IDL.Variant({ user: IDL.Null, system: IDL.Null, assistant: IDL.Null });
  const ChatMessage = IDL.Record({ role: Role, content: IDL.Text });
  const ChatRequest = IDL.Record({ model: IDL.Text, messages: IDL.Vec(ChatMessage) });
  return IDL.Service({ v0_chat: IDL.Func([ChatRequest], [IDL.Text], []) });
};

export function dfinityLlmRoleToCandid(role: DfinityLlmRole): DfinityLlmCandidMessage["role"] {
  switch (role) {
    case "user":
      return { user: null };
    case "system":
      return { system: null };
    case "assistant":
      return { assistant: null };
  }
}

// One anonymous agent for the lifetime of the tab; anonymous agents have no
// identity to rotate, unlike the signed-in-identity cache in icpAgent.ts.
let anonymousLlmAgent: Promise<HttpAgent> | null = null;

function getAnonymousLlmAgent(): Promise<HttpAgent> {
  if (!anonymousLlmAgent) {
    anonymousLlmAgent = HttpAgent.create({
      host: DFINITY_LLM_HOST,
      identity: new AnonymousIdentity(),
      shouldSyncTime: true,
      retryTimes: 2,
    });
    anonymousLlmAgent.catch(() => {
      anonymousLlmAgent = null;
    });
  }
  return anonymousLlmAgent;
}

async function createAnonymousLlmActor(): Promise<DfinityLlmActor> {
  const agent = await getAnonymousLlmAgent();
  return Actor.createActor<DfinityLlmActor>(llmIdlFactory, {
    agent,
    canisterId: Principal.fromText(DFINITY_LLM_CANISTER_ID),
  });
}

/** Calls the DFINITY LLM canister's `v0_chat` anonymously and returns its text reply. */
export async function callDfinityLlmChat(model: string, messages: DfinityLlmMessage[]): Promise<string> {
  const actor = await createAnonymousLlmActor();
  return actor.v0_chat({
    model,
    messages: messages.map((m) => ({ role: dfinityLlmRoleToCandid(m.role), content: m.content })),
  });
}
