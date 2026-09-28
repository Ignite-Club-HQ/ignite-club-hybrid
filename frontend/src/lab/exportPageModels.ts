export type AuthFailure = { message?: string } | Error;

export type AuthProvider = {
  signIn(email: string, password: string): Promise<{ error: AuthFailure | null }>;
  signUp(email: string, password: string): Promise<{ error: AuthFailure | null }>;
};

export function classifyAuthFailure(error: AuthFailure | null): string {
  const message = error?.message ?? "";
  if (/invalid login credentials/i.test(message)) {
    return "Invalid email or password. Please try again.";
  }
  if (/network|load failed|fetch/i.test(message)) {
    return "We couldn't reach the server. Check your connection and try again.";
  }
  return message || "Authentication failed. Please try again.";
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isStrongPassword(password: string): boolean {
  return password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

export class LocalAuthFlow {
  private busy = false;

  constructor(private readonly provider: AuthProvider) {}

  async signIn(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    if (this.busy) return { ok: false, message: "Authentication already in progress" };
    if (!isValidEmail(email)) return { ok: false, message: "Please enter a valid email" };
    if (password.length < 6) return { ok: false };

    this.busy = true;
    try {
      const result = await this.provider.signIn(email, password);
      return result.error
        ? { ok: false, message: classifyAuthFailure(result.error) }
        : { ok: true };
    } catch (error) {
      return { ok: false, message: classifyAuthFailure(error as AuthFailure) };
    } finally {
      this.busy = false;
    }
  }

  async signUp(
    email: string,
    password: string,
    confirmation: string,
    acceptedTerms: boolean,
  ): Promise<{ ok: boolean; message?: string }> {
    if (this.busy) return { ok: false, message: "Authentication already in progress" };
    if (!isValidEmail(email)) return { ok: false, message: "Please enter a valid email" };
    if (!isStrongPassword(password)) {
      return { ok: false, message: "Your password needs to be stronger." };
    }
    if (password !== confirmation) {
      return { ok: false, message: "Please ensure both passwords are identical." };
    }
    if (!acceptedTerms) {
      return { ok: false, message: "You must accept the Terms of Service." };
    }

    this.busy = true;
    try {
      const result = await this.provider.signUp(email, password);
      return result.error
        ? { ok: false, message: classifyAuthFailure(result.error) }
        : { ok: true };
    } catch (error) {
      return { ok: false, message: classifyAuthFailure(error as AuthFailure) };
    } finally {
      this.busy = false;
    }
  }
}

export type JoinTeam = { id: string; name: string; administratorId: string };
export type JoinEntry = { teamId: string; status: "accepted" | "pending" | "rejected" | "removed" };
export type JoinTokenSnapshot = {
  status: "active" | "disabled" | "archived" | "unknown";
  competition: { id: string; name: string } | null;
  divisions: Array<{ id: string; name: string }>;
  entered: JoinEntry[];
};

export type JoinActor = {
  listAdministeredTeams(userId: string): Promise<JoinTeam[]>;
  join(token: string, teamId: string, divisionId: string | null): Promise<void>;
};

export function joinStatusMessage(status: JoinTokenSnapshot["status"]): string {
  if (status === "disabled") return "The organiser has disabled this join link.";
  if (status === "archived") return "The competition has been archived.";
  return "This join link isn't recognised.";
}

export function joinFailureMessage(message: string): string {
  const messages: Record<string, string> = {
    not_team_admin: "You don't have admin rights for that team.",
    invalid_token: "This join link is no longer valid.",
    team_not_found: "That team could not be found.",
    auth_required: "Please sign in first.",
  };
  return messages[message] ?? "We couldn't join that competition. Please try again.";
}

export class LocalCompetitionJoinFlow {
  private snapshot: JoinTokenSnapshot | null = null;
  private teams: JoinTeam[] = [];

  constructor(
    private readonly token: string,
    private readonly getSnapshot: (token: string) => Promise<JoinTokenSnapshot>,
    private readonly actor: JoinActor,
    private readonly userId: string | null,
  ) {}

  async load(): Promise<{ ok: boolean; message?: string }> {
    if (!this.token) return { ok: false, message: "This join link is missing its token." };
    this.snapshot = await this.getSnapshot(this.token);
    if (this.snapshot.status !== "active" || !this.snapshot.competition) {
      return { ok: false, message: joinStatusMessage(this.snapshot.status) };
    }
    if (this.userId) this.teams = await this.actor.listAdministeredTeams(this.userId);
    return { ok: true };
  }

  signInDestination(storage: StorageLike): string {
    const next = `/competitions/join?token=${encodeURIComponent(this.token)}`;
    storage.setItem("redirectAfterAuth", next);
    const params = new URLSearchParams({ mode: "signup", next, redirect: next });
    return `/auth?${params.toString()}`;
  }

  eligibleTeams(): JoinTeam[] {
    return this.teams;
  }

  hasOnlyAlreadyEnteredTeam(): boolean {
    const entered = new Set(
      (this.snapshot?.entered ?? [])
        .filter(entry => entry.status === "accepted" || entry.status === "pending")
        .map(entry => entry.teamId),
    );
    return this.teams.length > 0 && this.teams.every(team => entered.has(team.id));
  }

  async join(teamId: string, divisionId: string | null): Promise<{ ok: boolean; message?: string }> {
    if (!this.userId) return { ok: false, message: joinFailureMessage("auth_required") };
    try {
      await this.actor.join(this.token, teamId, divisionId);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: joinFailureMessage(error instanceof Error ? error.message : String(error)),
      };
    }
  }
}

export type StorageLike = {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
};

export type CompetitionSettings = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  visibility: string;
  points_win: number;
  points_draw: number;
  points_loss: number;
  organizerClubId: string;
  source: "native" | "playhq";
  associationClub: boolean;
};

export type SettingsActor = {
  updateCompetition(id: string, values: Record<string, unknown>): Promise<void>;
  updateDivision(id: string, hideLadder: boolean): Promise<void>;
  addCoordinator(id: string, userId: string): Promise<void>;
  removeCoordinator(id: string): Promise<void>;
};

export class LocalCompetitionSettingsFlow {
  constructor(
    private readonly competition: CompetitionSettings | null,
    private readonly isLoading: boolean,
    private readonly isAdmin: boolean,
    private readonly hasPro: boolean,
    private readonly actor: SettingsActor,
  ) {}

  view(): "loading" | "not_found" | "denied" | "pro_locked" | "editable" | "read_only" {
    if (this.isLoading) return "loading";
    if (!this.competition) return "not_found";
    if (!this.isAdmin) return "denied";
    if (!this.hasPro) return "pro_locked";
    if (this.competition.source === "playhq" && !this.competition.associationClub) return "read_only";
    return "editable";
  }

  async save(values: { name: string; description: string }): Promise<{ ok: boolean; message?: string }> {
    if (this.view() !== "editable") return { ok: false, message: "Settings are not editable" };
    try {
      await this.actor.updateCompetition(this.competition!.id, {
        name: values.name.trim(),
        description: values.description.trim(),
        status: this.competition!.status,
        visibility: this.competition!.visibility,
        points_win: this.competition!.points_win,
        points_draw: this.competition!.points_draw,
        points_loss: this.competition!.points_loss,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async toggleDivision(id: string, hideLadder: boolean): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.actor.updateDivision(id, hideLadder);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }
}
