import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), storage: vi.fn(), auth: vi.fn() }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, storage: { from: mocks.storage } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: mocks.auth }));
import CompetitionMediaPanel from "./CompetitionMediaPanel";
it("never mounts legacy Supabase media readers or controls for Internet Identity", () => {
  render(<CompetitionMediaPanel competitionId="competition-a" organizerClubId="club-a" canManage />);
  expect(mocks.auth).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.storage).not.toHaveBeenCalled();
});