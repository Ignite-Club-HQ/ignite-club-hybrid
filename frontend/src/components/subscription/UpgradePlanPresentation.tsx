import type { ReactNode } from "react";
import { format } from "date-fns";
import { AlertCircle, ArrowLeft, Check, CreditCard, Flame, Loader2, Ticket } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SubscriptionLegalLinks } from "@/components/SubscriptionLegalLinks";

export type UpgradeProduct = "club" | "team";
export interface UpgradeOfferCardProps {
  header: ReactNode;
  appearance: {
    cardClassName: string;
    checkBackgroundClassName: string;
    checkTextClassName: string;
    subscribeClassName?: string;
  };
  pricing: {
    price: number | null;
    period: "month" | "year";
    isAnnual: boolean;
    onAnnualChange: (isAnnual: boolean) => void;
    annualDisabled?: boolean;
    annualSavings?: number;
    summary: string;
    checkoutSummary: string;
  };
  features: readonly string[];
  checkout: {
    isPending: boolean;
    onSubscribe: () => void;
  };
  promo: {
    id: string;
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
    onApply: () => void;
    isBusy: boolean;
  };
}

export function UpgradeLoadingState() {
  return (
    <div className="py-6 space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function UpgradeNotFoundState({ product }: { product: UpgradeProduct }) {
  return (
    <div className="py-6 text-center">
      <p className="text-muted-foreground">{product === "club" ? "Club" : "Team"} not found</p>
    </div>
  );
}

export function UpgradeAccessDeniedState({
  title,
  description,
  onBack,
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      <Card className="border-destructive/20 bg-destructive/5 max-w-lg mx-auto">
        <CardContent className="p-8 text-center">
          <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto mb-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="font-semibold text-lg mb-2">Admin Access Required</h3>
          <p className="text-muted-foreground text-sm">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export function UpgradeTrialBanner({
  trialEndsAt,
  cancelDescription,
  onCancel,
  isCancelling,
}: {
  trialEndsAt: Date;
  cancelDescription: string;
  onCancel: () => void;
  isCancelling: boolean;
}) {
  return (
    <Card className="border-amber-500/50 bg-amber-500/10 mb-4">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Flame className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Free Trial Active</p>
            <p className="text-sm text-muted-foreground">
              Your trial ends on <strong>{format(trialEndsAt, "dd MMMM yyyy")}</strong>. After the trial, your subscription will begin and you'll be charged.
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full text-destructive border-destructive/30 hover:bg-destructive/10">
              Cancel Subscription
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
              <AlertDialogDescription>{cancelDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={onCancel}
                disabled={isCancelling}
              >
                {isCancelling && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Cancel Subscription
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export function UpgradePricingToggle({
  isAnnual,
  onAnnualChange,
  disabled = false,
}: {
  isAnnual: boolean;
  onAnnualChange: (isAnnual: boolean) => void;
  disabled?: boolean;
}) {
  if (disabled) return null;

  return (
    <div className="space-y-3 mb-4">
      <div className="flex items-center justify-center gap-3">
        <span className={`text-sm ${!isAnnual ? "font-semibold" : "text-muted-foreground"}`}>
          Monthly
        </span>
        <Switch checked={isAnnual} onCheckedChange={onAnnualChange} />
        <span className={`text-sm ${isAnnual ? "font-semibold" : "text-muted-foreground"}`}>
          Annual
        </span>
        {isAnnual && (
          <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-green-500/20">
            Save 20%
          </Badge>
        )}
      </div>
    </div>
  );
}

export function UpgradeOfferCard({
  header,
  appearance,
  pricing,
  features,
  checkout,
  promo,
}: UpgradeOfferCardProps) {
  return (
    <>
      <Card className={appearance.cardClassName}>
        <CardHeader className="text-center pb-2">
          {header}
          <UpgradePricingToggle
            isAnnual={pricing.isAnnual}
            onAnnualChange={pricing.onAnnualChange}
            disabled={pricing.annualDisabled}
          />
          <CardTitle className="text-3xl">
            ${pricing.price}{" "}
            <span className="text-lg font-normal text-muted-foreground">
              AUD/{pricing.period}
            </span>
          </CardTitle>
          {pricing.annualSavings !== undefined && pricing.isAnnual && (
            <p className="text-sm text-green-600 font-medium">
              Save ${pricing.annualSavings} per year
            </p>
          )}
          <p className="text-sm text-muted-foreground">{pricing.summary}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className={`h-5 w-5 rounded-full ${appearance.checkBackgroundClassName} flex items-center justify-center shrink-0`}>
                  <Check className={`h-3 w-3 ${appearance.checkTextClassName}`} />
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Button
              className={`w-full ${appearance.subscribeClassName ?? ""}`}
              size="lg"
              onClick={checkout.onSubscribe}
              disabled={checkout.isPending}
            >
              {checkout.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CreditCard className="h-4 w-4 mr-2" />
              )}
              Subscribe Now
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              {pricing.checkoutSummary} AUD • Cancel anytime
            </p>
            <SubscriptionLegalLinks />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Ticket className="h-5 w-5" />
            Have a Promo Code?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={promo.id}>Enter promo code</Label>
            <div className="flex gap-2">
              <Input
                id={promo.id}
                placeholder={promo.placeholder}
                value={promo.value}
                onChange={(event) => promo.onChange(event.target.value.toUpperCase())}
                className="uppercase"
              />
              <Button onClick={promo.onApply} disabled={!promo.value.trim() || promo.isBusy}>
                {promo.isBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
