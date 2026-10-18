// Welcome email for an accepted Internet Identity team invite. verify_jwt is
// off (see config.toml): ICP users have no Supabase session, so the only input
// is the invite id and every fact is re-read from the club_domain canister.
//
// Required secrets: RESEND_API_KEY, WELCOME_EMAIL_FROM, CLUB_DOMAIN_CANISTER_ID,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: ICP_HOST.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Actor, HttpAgent } from "npm:@icp-sdk/core@5/agent";
import { IDL } from "npm:@icp-sdk/core@5/candid";
import { corsHeaders } from "../_shared/cors.ts";
import { buildWelcomeEmail, sendWithResend } from "../_shared/welcomeEmail.ts";

interface WelcomeJob {
  invite_id: string;
  to: string;
  subject: string;
  message: string;
  team_name: string;
  club_name: string;
}

type JobResult = { Ok: WelcomeJob } | { Err: string };

const INVITE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const idlFactory = ({ IDL }: { IDL: typeof import("npm:@icp-sdk/core@5/candid").IDL }) => {
  const Job = IDL.Record({
    invite_id: IDL.Text,
    to: IDL.Text,
    subject: IDL.Text,
    message: IDL.Text,
    team_name: IDL.Text,
    club_name: IDL.Text,
  });
  return IDL.Service({
    get_welcome_email_job: IDL.Func([IDL.Text], [IDL.Variant({ Ok: Job, Err: IDL.Text })], ["query"]),
  });
};

interface CompetitionWelcomeJob {
  competition_id: string;
  to: string;
  subject: string;
  message: string;
  competition_name: string;
}

type CompetitionJobResult = { Ok: CompetitionWelcomeJob } | { Err: string };

const competitionIdlFactory = ({ IDL }: { IDL: typeof import("npm:@icp-sdk/core@5/candid").IDL }) => {
  const Job = IDL.Record({
    competition_id: IDL.Text,
    to: IDL.Text,
    subject: IDL.Text,
    message: IDL.Text,
    competition_name: IDL.Text,
  });
  return IDL.Service({
    get_competition_welcome_email_job: IDL.Func([IDL.Text], [IDL.Variant({ Ok: Job, Err: IDL.Text })], ["query"]),
  });
};

async function loadCompetitionJob(canisterId: string, token: string): Promise<CompetitionJobResult> {
  const agent = await HttpAgent.create({ host: Deno.env.get("ICP_HOST") ?? "https://icp-api.io" });
  const actor = Actor.createActor(competitionIdlFactory, { agent, canisterId }) as {
    get_competition_welcome_email_job: (token: string) => Promise<CompetitionJobResult>;
  };
  return actor.get_competition_welcome_email_job(token);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadJob(canisterId: string, inviteId: string): Promise<JobResult> {
  const agent = await HttpAgent.create({ host: Deno.env.get("ICP_HOST") ?? "https://icp-api.io" });
  const actor = Actor.createActor(idlFactory, { agent, canisterId }) as {
    get_welcome_email_job: (id: string) => Promise<JobResult>;
  };
  return actor.get_welcome_email_job(inviteId);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("WELCOME_EMAIL_FROM");
  const canisterId = Deno.env.get("CLUB_DOMAIN_CANISTER_ID");
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !from || !canisterId) {
    console.error("[send-welcome-email-icp] Required settings are not configured");
    return json({ error: "Welcome email delivery is not configured" }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let claimedInviteId: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { inviteId?: unknown; competitionWelcomeToken?: unknown };
    const competitionToken = typeof body.competitionWelcomeToken === "string" ? body.competitionWelcomeToken : "";

    if (competitionToken) {
      // Competition official welcome: recipient and message come from the
      // competition canister, keyed by the unguessable invite token.
      const competitionCanisterId = Deno.env.get("COMPETITION_DOMAIN_CANISTER_ID");
      if (!competitionCanisterId) return json({ error: "Welcome email delivery is not configured" }, 503);
      if (!INVITE_ID.test(competitionToken)) return json({ error: "Invalid welcome email request" }, 400);
      const result = await loadCompetitionJob(competitionCanisterId, competitionToken);
      if ("Err" in result) return json({ sent: false, reason: result.Err });
      const job = result.Ok;
      const claimId = `competition:${competitionToken}`;
      const { data: claimed, error: claimError } = await admin.rpc("claim_icp_welcome_email", { _invite_id: claimId });
      if (claimError) throw claimError;
      if (!claimed) return json({ sent: false, reason: "already_sent_or_processing" });
      claimedInviteId = claimId;
      const { subject, text, html } = buildWelcomeEmail(
        { subject: job.subject, message: job.message },
        { teamName: "", clubName: "", competitionName: job.competition_name, recipientName: job.to.split("@")[0] },
      );
      const providerMessageId = await sendWithResend(resendApiKey, {
        from,
        to: job.to,
        subject,
        text,
        html,
        idempotencyKey: `icp-welcome:${claimId}`,
      });
      const { error: finishError } = await admin.rpc("finish_icp_welcome_email", {
        _invite_id: claimId,
        _sent: true,
        _provider_message_id: providerMessageId,
        _error: null,
      });
      if (finishError) throw finishError;
      return json({ sent: true });
    }

    const inviteId = typeof body.inviteId === "string" ? body.inviteId : "";
    if (!INVITE_ID.test(inviteId)) return json({ error: "Invalid welcome email request" }, 400);

    const result = await loadJob(canisterId, inviteId);
    if ("Err" in result) return json({ sent: false, reason: result.Err });
    const job = result.Ok;

    const { data: claimed, error: claimError } = await admin.rpc("claim_icp_welcome_email", { _invite_id: inviteId });
    if (claimError) throw claimError;
    if (!claimed) return json({ sent: false, reason: "already_sent_or_processing" });
    claimedInviteId = inviteId;

    const { subject, text, html } = buildWelcomeEmail(job, {
      teamName: job.team_name,
      clubName: job.club_name,
      competitionName: "",
      recipientName: job.to.split("@")[0],
    });
    const providerMessageId = await sendWithResend(resendApiKey, {
      from,
      to: job.to,
      subject,
      text,
      html,
      idempotencyKey: `icp-welcome:${inviteId}`,
    });

    const { error: finishError } = await admin.rpc("finish_icp_welcome_email", {
      _invite_id: inviteId,
      _sent: true,
      _provider_message_id: providerMessageId,
      _error: null,
    });
    if (finishError) throw finishError;
    return json({ sent: true });
  } catch (error) {
    if (claimedInviteId) {
      await admin.rpc("finish_icp_welcome_email", {
        _invite_id: claimedInviteId,
        _sent: false,
        _provider_message_id: null,
        _error: error instanceof Error ? error.message : "Delivery failed",
      }).catch(() => undefined);
    }
    console.error("[send-welcome-email-icp] delivery failed", error);
    return json({ error: "Welcome email could not be sent" }, 502);
  }
});
