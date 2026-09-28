export function HomeMyTeamsSkeleton() {
  return (
    <section className="space-y-2.5" aria-hidden="true">
      <h2 className="text-xl font-bold px-1 tracking-tight">My Teams</h2>
      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 pb-2 pr-4">
          {[1, 2].map((index) => (
            <div
              key={index}
              className="shrink-0 w-[85vw] max-w-[320px] h-[212px] rounded-lg bg-card border border-border/60 p-4 space-y-3 animate-pulse"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted/80" />
                </div>
              </div>
              <div className="rounded-md bg-muted/40 h-[62px] p-3 space-y-2">
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="h-3 w-3/5 rounded bg-muted/80" />
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-border/40 h-[36px]">
                <div className="h-7 w-7 rounded-full bg-muted" />
                <div className="h-3 w-24 rounded bg-muted/80" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HomeInitialSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-6 w-24 rounded bg-muted animate-pulse" />
          <div className="h-4 w-16 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-[340px] overflow-hidden rounded-lg bg-card border border-border/50 p-4 space-y-3 animate-pulse">
          <div className="ml-auto h-5 w-16 rounded-full bg-muted" />
          <div className="h-7 w-2/3 rounded bg-muted" />
          <div className="h-4 w-4/5 rounded bg-muted/80" />
          <div className="h-4 w-3/5 rounded bg-muted/80" />
          <div className="h-4 w-full rounded bg-muted/70" />
          <div className="pt-28 space-y-2">
            <div className="h-4 w-1/2 rounded bg-muted/70" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-9 rounded-full bg-muted" />
              <div className="h-9 rounded-full bg-muted" />
              <div className="h-9 rounded-full bg-muted" />
            </div>
            <div className="h-12 rounded-xl bg-muted/50" />
          </div>
        </div>
        <div className="h-[24px]" aria-hidden="true" />
      </section>
      <HomeMyTeamsSkeleton />
    </div>
  );
}
