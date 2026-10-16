/* eslint-disable @typescript-eslint/no-explicit-any -- untyped Candid/Supabase payloads at this boundary */
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
import { registerLiveVaultFile } from "./features/vault";
import { tryUploadMediaToBlobStore } from "./mediaUpload";
import { connectLiveMessagingDomain } from "./domains";
import { icpCtx } from "@/lib/icpClubTeamLookup";

export interface SeedOptions {
  clubName: string;
  /** Fill this existing club instead of creating a new one. */
  existingClubId?: string | null;
  /** Vault files (small PDFs/CSVs) to upload. */
  files?: number;
  messagesPerTeamChat: number;
  clubChatMessages: number;
  photos: number;
  onProgress: (label: string, done: number, total: number) => void;
}

const TEAMS = ["U8 Rockets", "U10 Hawks", "U12 Lions"];
const REAL_TEAMS = ["U12 Riverdogs", "U14 Riverdogs"];
const OPPONENTS = ["Eagles", "Sharks", "Falcons", "Tigers", "Panthers", "Wolves", "Stingrays", "Bulldogs"];
const REAL_LINES = [
  "Hi everyone, welcome to the new season! 🎉",
  "Training moved to the back oval tonight, front one is being re-turfed.",
  "Can someone bring the oranges for Saturday? 🍊",
  "I can do oranges this week.",
  "Thanks Sarah!",
  "Kick-off is 9am, please be there by 8:30 for warm up.",
  "Great win today team, so proud of the effort in the second half 💪",
  "Who has the spare goalie gloves? Left them at training I think.",
  "Found them, they're in the kit bag.",
  "Reminder: registration fees are due by the end of the month.",
  "Photos from Saturday are up in the gallery 📸",
  "Is training still on with this rain?",
  "Yes, still on unless there's lightning. We'll message if it's cancelled.",
  "Running 10 mins late, sorry!",
  "No worries 👍",
  "BBQ roster for the home game is in the vault, please pop your name down.",
  "Can we carpool to the away game? We have 2 spare seats.",
  "We'd love a lift, thank you!",
  "Uniform pickup is Thursday 5-6pm at the clubrooms.",
  "Does anyone know if the canteen takes card?",
  "Yes it does now 🙌",
  "Coach here: we'll work on passing drills this week, bring a ball each if you can.",
  "Happy birthday Liam! 🎂",
  "Lost property: blue drink bottle with a dinosaur sticker.",
  "That's ours! Thanks, will grab it Tuesday.",
  "Fixture for the next round is out, we're away at Glenelg.",
  "Please RSVP for Saturday so we know numbers.",
  "End of season presentation night is booked for the 14th 🏆",
];
const FILES: Array<{ name: string; kind: "pdf" | "csv"; title: string; lines: string[] }> = [
  { name: "Season Fixture.pdf", kind: "pdf", title: "Riverdogs Season Fixture", lines: ["Round 1 - Home vs Eagles - 9:00am", "Round 2 - Away at Sharks - 10:30am", "Round 3 - Home vs Falcons - 9:00am", "Round 4 - Away at Tigers - 8:30am"] },
  { name: "Code of Conduct.pdf", kind: "pdf", title: "Club Code of Conduct", lines: ["Respect players, coaches, referees and parents.", "Encourage effort over results.", "No abuse of officials.", "Have fun!"] },
  { name: "Canteen Roster.csv", kind: "csv", title: "", lines: ["Date,Family,Shift", "Sat wk1,Smith,8-10am", "Sat wk1,Nguyen,10-12pm", "Sat wk2,Patel,8-10am", "Sat wk2,O'Brien,10-12pm"] },
  { name: "Committee Minutes.pdf", kind: "pdf", title: "Committee Meeting Minutes", lines: ["Attendees: President, Treasurer, Secretary", "Ground lights repaired before round 3.", "New goals ordered for juniors.", "Next meeting first Monday of the month."] },
  { name: "Player Contacts.csv", kind: "csv", title: "", lines: ["Player,Team,Guardian", "Ava,U12,Mia (parent)", "Noah,U12,Jack (parent)", "Leo,U14,Emma (parent)", "Zoe,U14,Liam (parent)"] },
  { name: "First Aid Guide.pdf", kind: "pdf", title: "First Aid Quick Guide", lines: ["Kit is stored in the clubroom cupboard.", "Ice packs are in the canteen freezer.", "Call 000 in an emergency.", "Log every injury with the team manager."] },
];

/** Minimal valid single-page PDF with a title and lines of text. */
function makePdf(title: string, lines: string[]): Blob {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "");
  const text = [`BT /F1 20 Tf 60 760 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 12 Tf 60 ${720 - i * 22} Td (${esc(l)}) Tj ET`)].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}
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

const seedFailures: string[] = [];
function noteFail(what: string, e: unknown) {
  console.warn("[seed]", what, e);
  seedFailures.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
}

async function pool<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i).catch((e) => noteFail("event", e));
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

export async function seedIcpTestData(opts: SeedOptions): Promise<{ clubId: string; failures: string[]; total: number; summary: string }> {
  seedFailures.length = 0;
  const ctx = await icpCtx();
  const me: Principal = ctx.identity.getPrincipal();
  const step = opts.onProgress;

  const real = !!opts.existingClubId;
  const teamNames = real ? REAL_TEAMS : TEAMS;
  const lines = real ? REAL_LINES : LINES;
  let clubId: string;
  if (opts.existingClubId) {
    clubId = opts.existingClubId;
  } else {
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
    clubId = club.id as string;
  }

  const teamIds: string[] = [];
  for (let i = 0; i < teamNames.length; i++) {
    step("Creating teams", i, teamNames.length);
    const team = await saveLiveTeam(ctx, {
      id: crypto.randomUUID(), club_id: clubId, name: teamNames[i],
      age_group: candidOpt(teamNames[i].split(" ")[0]), description: candidOpt(null), logo_url: candidOpt(null),
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
    noteFail("default chats", e);
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
      title: e.game ? `Game vs ${real ? OPPONENTS[(e.k + e.teamId.length) % OPPONENTS.length] : `Opponent ${e.k}`}` : "Training",
      description: e.game ? "Arrive 30 minutes before kick-off." : " ",
      eventType: e.game ? "game" : "training",
      location: null, opponent: e.game ? (real ? OPPONENTS[(e.k + e.teamId.length) % OPPONENTS.length] : `Opponent ${e.k}`) : null,
      address: ADDRESSES[e.k % ADDRESSES.length], miniLeagueId: null,
      startsAtMs: e.start.getTime(), endsAtMs: e.start.getTime() + 3_600_000,
    } as any);
    step("Creating events", ++evDone, events.length);
  });

  // Chats. Each stage is isolated so a chat failure can't skip photos/files.
  let msgs: Array<{ convo: string; body: string }> = [];
  let mOk = 0;
  try {
    const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
    const convo = async (teamId: string | null) => {
      const r: any = await actor.ensure_conversation(clubId, candidOpt(teamId), [me]);
      if ("Err" in r) throw new Error(r.Err);
      return r.Ok.id as string;
    };
    const chats: Array<{ id: string; count: number }> = [];
    for (const t of [null, ...teamIds]) {
      try {
        chats.push({ id: await convo(t), count: t ? opts.messagesPerTeamChat : opts.clubChatMessages });
      } catch (e) {
        noteFail(t ? "team chat" : "club chat", e);
      }
    }
    // Also post a few lines into the club's group chats (Coaches, Team Admins…).
    try {
      const { listLiveGroupsByClub } = await import("./features/messaging");
      const groups = await listLiveGroupsByClub(ctx, clubId);
      for (const g of groups.filter((x: any) => !x.teamId)) chats.push({ id: g.conversationId, count: 5 });
    } catch (e) {
      noteFail("group chats", e);
    }
    msgs = chats.flatMap((c) =>
      Array.from({ length: c.count }, (_, i) => ({
        convo: c.id,
        body: real
          ? (i === 6 ? LONG : lines[(i + c.id.length) % lines.length])
          : i % 25 === 0 ? `${LONG} (#${i + 1})` : `${LINES[i % LINES.length]} (#${i + 1})`,
      })),
    );
    let mDone = 0;
    await Promise.all(
      chats.map(async (c) => {
        for (const m of msgs.filter((x) => x.convo === c.id)) {
          await sendLiveMessage(ctx, m.convo, m.body, crypto.randomUUID())
            .then(() => { mOk++; })
            .catch((e) => noteFail("message", e));
          step("Sending chat messages", ++mDone, msgs.length);
        }
      }),
    );
  } catch (e) {
    noteFail("chats", e);
  }

  // Photos.
  let pOk = 0;
  for (let i = 0; i < opts.photos; i++) {
    step("Uploading photos", i, opts.photos);
    try {
      const file = await makePhoto(real ? (i % 2 ? `Match day vs ${OPPONENTS[i % OPPONENTS.length]}` : `Training ${i + 1}`) : `Test photo ${i + 1}`, (i * 47) % 360);
      const storagePath = `clubs/${clubId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
      const up = await tryUploadMediaToBlobStore({ storagePath, file, mime: "image/jpeg" });
      if (!up) throw new Error("Media upload canisters are not configured");
      const asset = await registerLiveAsset(ctx, {
        clubId, kind: "photo", mime: "image/jpeg", checksum: up.blobRef.content_hash,
        storagePath: up.blobRef.path, visibility: "club", contentLength: file.size, blobRef: up.blobRef,
      });
      await setLiveAssetScope(ctx, asset.id, {
        teamId: teamIds[i % teamIds.length], miniLeagueId: null, competitionId: null, eventId: null,
        caption: real ? (i % 2 ? "Great game today!" : "Training session") : `Synthetic photo ${i + 1}`, albumId: null,
      }).catch(() => {});
      pOk++;
    } catch (e) {
      noteFail("photo", e);
    }
  }
  // Vault files (club-level, staff lock like the vault upload screen).
  let fOk = 0;
  const fileCount = Math.min(opts.files ?? 0, FILES.length);
  for (let i = 0; i < fileCount; i++) {
    step("Uploading files", i, fileCount);
    try {
      const f = FILES[i];
      const blob = f.kind === "pdf" ? makePdf(f.title, f.lines) : new Blob([f.lines.join("\n")], { type: "text/csv" });
      const file = new File([blob], f.name, { type: blob.type });
      const storagePath = `clubs/${clubId}/vault/${Date.now()}-${f.name.replace(/[^A-Za-z0-9.]+/g, "_")}`;
      const up = await tryUploadMediaToBlobStore({ storagePath, file, mime: file.type, lock: "own" });
      if (!up) throw new Error("Media upload canisters are not configured");
      await registerLiveVaultFile(ctx, crypto.randomUUID(), "", clubId, null, f.name, up.url, file.size, file.type, false, up.blobRef as any);
      fOk++;
    } catch (e) {
      noteFail("file", e);
    }
  }
  step("Done", 1, 1);
  const total = events.length + msgs.length + opts.photos + fileCount;
  if (seedFailures.length >= total && total > 0) {
    throw new Error(`Nothing was added. First problem — ${seedFailures[0]}`);
  }
  return { clubId, failures: [...seedFailures], total, summary: `${events.length} events, ${mOk} messages, ${pOk} photos, ${fOk} files added` };
}
