import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { buildWelcomeEmail, sendWithResend } from "../_shared/welcomeEmail.ts";

type ScopeKind = "team" | "competition";

interface WelcomeEmailRequest {
  scopeKind?: ScopeKind;
  scopeId?: string;
  recipientUserId?: string;
}

interface ScopeDetails {
  teamName: string;
  clubName: string;
  competitionName: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getScopeDetails(
  admin: ReturnType<typeof createClient>,
  kind: ScopeKind,
  scopeId: string,
): Promise<ScopeDetails> {
  if (kind === "team") {
    const { data: team, error } = await admin
      .from("teams")
      .select("name, clubs:club_id(name)")
      .eq("id", scopeId)
      .maybeSingle();
    if (error) throw error;
    if (!team) throw new Error("Team not found");
    const club = Array.isArray(team.clubs) ? team.clubs[0] : team.clubs;
    return { teamName: team.name, clubName: club?.name ?? "your club", competitionName: "" };
  }

  const { data: competition, error } = await admin
    .from("competitions")
    .select("name, organizer:organizer_club_id(name)")
    .eq("id", scopeId)
    .maybeSingle();
  if (error) throw error;
  if (!competition) throw new Error("Competition not found");
  const organizer = Array.isArray(competition.organizer) ? competition.organizer[0] : competition.organizer;
  return {
    teamName: "",
    clubName: organizer?.name ?? "your club",
    competitionName: competition.name,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("WELCOME_EMAIL_FROM");

  if (!authorization?.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !resendApiKey || !from) {
    console.error("[send-welcome-email] Required mail settings are not configured");
    return json({ error: "Welcome email delivery is not configured" }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let deliveryId: string | null = null;
  try {
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const body = (await request.json()) as WelcomeEmailRequest;
    const { scopeKind, scopeId, recipientUserId } = body;
    if (
      (scopeKind !== "team" && scopeKind !== "competition")
      || !scopeId || !UUID.test(scopeId)
      || !recipientUserId || !UUID.test(recipientUserId)
      || recipientUserId !== authData.user.id
    ) {
      return json({ error: "Invalid welcome email request" }, 400);
    }

    const { data: eligible, error: eligibilityError } = await userClient.rpc("is_welcome_email_recipient", {
      _scope_kind: scopeKind,
      _scope_id: scopeId,
      _recipient_user_id: recipientUserId,
    });
    if (eligibilityError) throw eligibilityError;
    if (!eligible) return json({ error: "You are not eligible for this welcome email" }, 403);

    const scopeColumn = scopeKind === "team" ? "team_id" : "competition_id";
    const { data: settings, error: settingsError } = await admin
      .from("welcome_email_settings")
      .select("enabled, subject, message")
      .eq(scopeColumn, scopeId)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings?.enabled) return json({ sent: false, reason: "disabled" });

    const dedupeKey = `welcome:${scopeKind}:${scopeId}:${recipientUserId}`;
    const { data: claim, error: claimError } = await admin.rpc("claim_welcome_email_delivery", {
      _dedupe_key: dedupeKey,
      _scope_kind: scopeKind,
      _scope_id: scopeId,
      _recipient_user_id: recipientUserId,
    });
    if (claimError) throw claimError;
    deliveryId = typeof claim === "string" ? claim : null;
    if (!deliveryId) return json({ sent: false, reason: "already_sent_or_processing" });

    const [{ data: account, error: accountError }, profileResult, details] = await Promise.all([
      admin.auth.admin.getUserById(recipientUserId),
      admin.from("profiles").select("display_name").eq("id", recipientUserId).maybeSingle(),
      getScopeDetails(admin, scopeKind, scopeId),
    ]);
    if (accountError) throw accountError;
    const email = account.user?.email;
    if (!email) throw new Error("The recipient account has no email address");

    const values = {
      teamName: details.teamName,
      clubName: details.clubName,
      competitionName: details.competitionName,
      recipientName: profileResult.data?.display_name || email.split("@")[0],
    };
    const { subject, text, html } = buildWelcomeEmail(settings, values);
    const providerMessageId = await sendWithResend(resendApiKey, {
      from,
      to: email,
      subject,
      text,
      html,
      idempotencyKey: dedupeKey,
    });

    const { error: finishError } = await admin.rpc("finish_welcome_email_delivery", {
      _delivery_id: deliveryId,
      _sent: true,
      _provider_message_id: providerMessageId,
      _error: null,
    });
    if (finishError) throw finishError;
    return json({ sent: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Welcome email delivery failed";
    if (deliveryId) {
      await admin.rpc("finish_welcome_email_delivery", {
        _delivery_id: deliveryId,
        _sent: false,
        _provider_message_id: null,
        _error: message,
      }).catch(() => undefined);
    }
    console.error("[send-welcome-email] delivery failed", error);
    return json({ error: "Welcome email could not be sent" }, 502);
  }
});