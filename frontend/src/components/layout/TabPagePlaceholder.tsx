import { useLocation, useNavigate } from "react-router-dom";
import { ClubUpgradePending } from "@/components/subscription/ClubUpgradePending";

const titles: Record<string, string> = {
  "/": "Home", "/messages": "Messages", "/events": "Schedule", "/media": "Media",
};

/** Destination chrome paints even when its code is still downloading. */
export function TabPagePlaceholder() {
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  if (/^\/clubs\/[^/]+\/upgrade$/.test(pathname)) {
    const label = state?.upgradeClubLabel;
    const name = pathname === `/clubs/${label?.id}/upgrade` && typeof label?.name === "string" ? label.name : undefined;
    return <ClubUpgradePending name={name} onBack={() => navigate(-1)} />;
  }
  const title = titles[pathname];
  return (
    <section aria-busy="true" aria-label={title ?? "Opening page"} className="py-6 space-y-6">
      {title && <h1 className="text-2xl font-bold">{title}</h1>}
      <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
        <div className="h-10 w-full rounded-md bg-muted" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-24 w-full rounded-md bg-muted" />
        ))}
      </div>
    </section>
  );
}