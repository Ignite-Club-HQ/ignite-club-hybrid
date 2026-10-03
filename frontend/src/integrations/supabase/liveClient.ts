import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getActiveSupabaseTarget } from "@/live/targetRegistry";

// Lazy singleton: the Supabase client (and its target resolution) is only
// constructed on first property access. Under an ICP-only boot no Supabase
// call ever fires (all writes fail closed, reads route to canisters), so the
// client — and its auth/storage setup — is never instantiated at all.
let instance: SupabaseClient<Database> | undefined;

function getSupabase(): SupabaseClient<Database> {
  if (!instance) {
    const target = getActiveSupabaseTarget();
    instance = createClient<Database>(target.url, target.anonKey);
  }
  return instance;
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, _receiver) {
    const client = getSupabase();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
