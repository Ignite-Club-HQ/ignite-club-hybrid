import { useLocation } from "react-router-dom";

const titles: Record<string, string> = {
  "/": "Home", "/messages": "Messages", "/events": "Schedule", "/media": "Media",
};

/** Destination chrome paints even when its code is still downloading. */
export function TabPagePlaceholder() {
  const { pathname } = useLocation();
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