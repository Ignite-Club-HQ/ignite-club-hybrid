import { ArrowLeft, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLUB_PRICING, CLUB_PLAN_NAMES, CLUB_PLAN_ORDER } from "@/lib/subscriptionPlans";

/** Read-only offer preview: no cached label or price grants purchase access. */
export function ClubUpgradePending({ name, onBack }: { name?: string; onBack: () => void }) {
  return (
    <section className="py-6 space-y-6" aria-busy="true">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Go back"><ArrowLeft className="h-5 w-5" /></Button>
        <Crown className="h-7 w-7 text-primary" />
        <div><h1 className="text-2xl font-bold">Club Pro Plans</h1>{name && <p className="text-muted-foreground">{name}</p>}</div>
      </div>
      <dl className="divide-y divide-border">
        {CLUB_PLAN_ORDER.map((plan) => (
          <div key={plan} className="flex items-center justify-between gap-4 py-4">
            <dt>{CLUB_PLAN_NAMES[plan]}</dt>
            <dd className="text-right">USD {CLUB_PRICING.pro[plan].monthly}<span className="text-muted-foreground"> / month</span></dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">Checking your club’s subscription and purchase access…</p>
    </section>
  );
}