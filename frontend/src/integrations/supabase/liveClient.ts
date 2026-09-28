import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getActiveSupabaseTarget } from "@/live/targetRegistry";

const target = getActiveSupabaseTarget();

export const supabase = createClient<Database>(target.url, target.anonKey);
