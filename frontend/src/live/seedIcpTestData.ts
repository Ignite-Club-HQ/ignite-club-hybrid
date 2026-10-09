/**
 * Admin-only synthetic test data for ICP mode: creates a fresh club with
 * teams, events, long chat histories (for virtualized scroll testing) and
 * generated photos — all written as the signed-in admin. Loaded lazily.
 */
import { Principal } from "@icp-sdk/core/principal";
import { candidOpt } from "./features/candid";
import { createLiveClub, saveLiveTeam } from "./features/club";
import { addLiveRoleGrant } from "./features/membership";
import { sendLiveMessage } from "./features/messaging";
import { createLiveEvent } from "./features/events";
import { registerLiveAsset, setLiveAssetScope } from "./features/media";
import { tryUploadMediaToBlobStore } from "./mediaUpload";
import { connectLiveMessagingDomain } from "./domains";
import { icpCtx } from "@/lib/icpClubTeamLookup";

export interface SeedOptions {
  clubName: string;
  messagesPerTeamChat: number;
  clubChatMessages: number;
  photos: number;
  onProgress: (label: string, done: number, total: number) => void;
}

const TEAMS = ["U8 Rockets", "U10 Hawks", "U12 Lions"];
const ADDRESSES = [
  "Adelaide Oval, War Memorial Dr, North Adelaide SA 5006",
  "Unley Oval, Trevelyan St, Unley SA 5061",
  "Norwood Oval, The Parade, Norwood SA 5067",
  "Glenelg Oval, Brighton Rd, Glenelg East SA 5045",
];
const LINES = [
  "Training is on tonight, bring water bottles 💧",
  "Can someone grab the cones from the shed?",
  "Great effort on the weekend everyone!",
  "Who's free to help with the BBQ on Saturday?",
  "Reminder: uniforms need to be returned by Friday.",
  "Running 5 mins late, start the warm up without me.",
  "👍",
  "Thanks!",
  "Photos from the game are up in Media 📸",
  "Does anyone have a spare pair of size 3 boots?",
];
const LONG =
  "Quick update for the season: we'll keep training on Tuesdays and Thursdays. Please arrive 10 minutes early so we can start on time, bring a full water bottle, shin pads and a jumper as it's getting cold. If your child can't make it, please RSVP in the app so coaches can plan drills. Thanks for all your support so far!";

async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i).catch((e) => console.warn("[seed] step failed", e));
      }
    }),
  );
}

function makePhoto(label: string, hue: number): Promise<File> {
  const c = document.createElement("canvas");
  c.width = 960;
  c.height = 720;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 960, 720);
  grad.addColorStop(0, `hsl(${hue} 70% 45%)`);
  grad.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 960, 720);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "bold 64px sans-serif";
  g.textAlign = "center";
  g.fillText(label, 480, 380);
  return new Promise((res) =>
    c.toBlob((b) => res(new File([b!], `${label}.jpg`, { type: "image/jpeg" })), "image/jpeg", 0.8),
  );
}

export async function seedIcpTestData(opts: SeedOptions): Promise<{ clubId: string }> {
  const ctx = await icpCtx();
  const me: Principal = ctx.identity.getPrincipal();
  const step = opts.onProgress;

  step("Creating club", 0, 1);
  const club = await createLiveClub(
    ctx,
    crypto.randomUUID(),
    opts.clubName,
    `${opts.clubName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
    "Synthetic club for testing",
    "soccer",
    "AU",
  );
  const clubId = club.id as string;

  const teamIds: string[] = [];
  for (let i = 0; i < TEAMS.length; i++) {
    step("Creating teams", i, TEAMS.length);
    const team = await saveLiveTeam(ctx, {
      id: crypto.randomUUID(), club_id: clubId, name: TEAMS[i],
      age_group: candidOpt(TEAMS[i].split(" ")[0]), description: candidOpt(null), logo_url: candidOpt(null),
      division: [], gender: [], team_type: [], folder_id: [], is_active: true, archived: false,
      deleted_at_ms: [], is_shell: false, shell_invited_by: [], shell_contact_name: [], shell_contact_email: [],
      shell_claim_token: [], shell_claimed_at_ms: [], shell_claimed_by: [], playhq_team_id: [],
      playhq_competition_id: [], playhq_auto_create_events: false,
    } as any);
    await addLiveRoleGrant(ctx, me, clubId, "team_admin", team.id);
    teamIds.push(team.id as string);
  }
  try {
    const { ensureLiveDefaultClubChats } = await import("./defaultClubChats");
    await ensureLiveDefaultClubChats(ctx, clubId, { force: true });
  } catch (e) {
    console.warn("[seed] default chats failed", e);
  }

  // Events: one training + one game per team per week for 4 weeks.
  const now = new Date();
  now.setHours(17, 30, 0, 0);
  const events = teamIds.flatMap((teamId, t) =>
    Array.from({ length: 8 }, (_, k) => {
      const start = new Date(now.getTime() + (Math.floor(k / 2) * 7 + (k % 2 ? 4 : 1) + t) * 86_400_000);
      if (k % 2) start.setHours(9, 0, 0, 0);
      return { teamId, start, game: k % 2 === 1, k };
    }),
  );
  let evDone = 0;
  await pool(events, 6, async (e) => {
    await createLiveEvent(ctx, {
      clubId, teamId: e.teamId,
      title: e.game ? `Game vs Opponent ${e.k}` : "Training",
      description: e.game ? "Arrive 30 minutes before kick-off." : " ",
      eventType: e.game ? "game" : "training",
      location: null, opponent: e.game ? `Opponent ${e.k}` : null,
      address: ADDRESSES[e.k % ADDRESSES.length], miniLeagueId: null,
      startsAtMs: e.start.getTime(), endsAtMs: e.start.getTime() + 3_600_000,
    } as any);
    step("Creating events", ++evDone, events.length);
  });

  // Chats.
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const convo = async (teamId: string | null) => {
    const r: any = await actor.ensure_conversation(clubId, candidOpt(teamId), [me]);
    if ("Err" in r) throw new Error(r.Err);
    return r.Ok.id as string;
  };
  const chats: Array<{ id: string; count: number }> = [
    { id: await convo(null), count: opts.clubChatMessages },
    ...(await Promise.all(teamIds.map(async (t) => ({ id: await convo(t), count: opts.messagesPerTeamChat })))),
  ];
  const msgs = chats.flatMap((c) =>
    Array.from({ length: c.count }, (_, i) => ({
      convo: c.id,
      body: i % 25 === 0 ? `${LONG} (#${i + 1})` : `${LINES[i % LINES.length]} (#${i + 1})`,
    })),
  );
  let mDone = 0;
  // Sequential per chat keeps message order; chats run in parallel.
  await Promise.all(
    chats.map(async (c) => {
      for (const m of msgs.filter((x) => x.convo === c.id)) {
        await sendLiveMessage(ctx, m.convo, m.body, crypto.randomUUID()).catch((e) => console.warn("[seed] msg", e));
        step("Sending chat messages", ++mDone, msgs.length);
      }
    }),
  );

  // Photos.
  for (let i = 0; i < opts.photos; i++) {
    step("Uploading photos", i, opts.photos);
    try {
      const file = await makePhoto(`Test photo ${i + 1}`, (i * 47) % 360);
      const storagePath = `clubs/${clubId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      const up = await tryUploadMediaToBlobStore({ storagePath, file, mime: "image/jpeg" });
      if (!up) throw new Error("Media upload canisters are not configured");
      const asset = await registerLiveAsset(ctx, {
        clubId, kind: "photo", mime: "image/jpeg", checksum: up.blobRef.content_hash,
        storagePath: up.blobRef.path, visibility: "club", contentLength: file.size, blobRef: up.blobRef,
      });
      await setLiveAssetScope(ctx, asset.id, {
        teamId: teamIds[i % teamIds.length], miniLeagueId: null, competitionId: null, eventId: null,
        caption: `Synthetic photo ${i + 1}`, albumId: null,
      }).catch(() => {});
    } catch (e) {
      console.warn("[seed] photo failed", e);
    }
  }
  step("Done", 1, 1);
  return { clubId };
}
