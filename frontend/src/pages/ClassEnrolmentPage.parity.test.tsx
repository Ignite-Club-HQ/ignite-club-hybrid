import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const inserts = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "adult" }, loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "supabase" }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, providers: {supabase:()=>unknown}) => providers.supabase() }));
vi.mock("@/live/features/club", () => ({}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => {
  let writing = false;
  const query: any = {
    select: () => query, eq: () => query, in: () => query, not: () => query, order: () => query, single: () => query,
    insert: (value: unknown) => { writing = true; inserts(value); return query; },
    then: (resolve: (value: unknown) => unknown) => {
      const today = new Date();
      const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][today.getDay()];
      const data = writing ? null : table === "clubs" ? {name:"Classes",class_mode_enabled:true} : table === "terms" ?
        [{id:"term",name:"Current",start_date:`${today.getFullYear()}-01-01`,end_date:`${today.getFullYear()}-12-31`,is_active:true}] :
        table === "teams" ? [{id:"class",name:"Senior skills",team_type:"senior",class_day:day,class_time:"10:00",class_capacity:2,class_duration_minutes:60,level_age:"Adults",logo_url:null}] :
        table === "class_enrolments" ? [{team_id:"class",user_id:"other1",status:"enrolled"},{team_id:"class",user_id:"other2",status:"enrolled"}] : [];
      return Promise.resolve({data,error:null,count:0}).then(resolve);
    },
  };
  return query;
} } }));
import ClassEnrolmentPage from "./ClassEnrolmentPage";

describe("class calendar enrolment parity", () => {
  it("keeps the full class on its waitlist when enrolling from calendar", async () => {
    inserts.mockClear();
    const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/clubs/club/enrol"]}>
      <Routes><Route path="/clubs/:clubId/enrol" element={<ClassEnrolmentPage/>}/></Routes>
    </MemoryRouter></QueryClientProvider>);
    await screen.findByText("Senior skills");
    fireEvent.click(screen.getByRole("button", {name:"Calendar",exact:true}));
    fireEvent.click(await screen.findByRole("button", {name:"Join Waitlist",exact:true}));
    await waitFor(() => expect(inserts).toHaveBeenCalledWith({user_id:"adult",team_id:"class",term_id:"term",status:"waitlisted",waitlist_position:1}));
  });
});