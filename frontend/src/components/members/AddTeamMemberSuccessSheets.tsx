import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Baby, CheckCircle2, Copy, Mail, MessageSquare, Share2, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { BulkChild } from "@/components/members/ChildAndSecondGuardianFields";

type TriggerVariant = "default" | "icon" | "none";

type ToastOptions = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

export type BulkMemberResult = {
  name: string;
  email: string;
  link: string;
  sent: boolean;
  role?: string;
  childrenCount?: number;
};

function AddTeamMemberTrigger({
  triggerVariant,
  onOpen,
}: {
  triggerVariant: TriggerVariant;
  onOpen: () => void;
}) {
  if (triggerVariant === "none") return null;

  return (
    <SheetTrigger asChild>
      {triggerVariant === "icon" ? (
        <Button variant="ghost" size="icon" className="h-9 w-9" data-invite-trigger onClick={onOpen}>
          <UserPlus className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="sm" data-invite-trigger onClick={onOpen}>
          <UserPlus className="h-4 w-4 mr-2" />
          Invite to Team
        </Button>
      )}
    </SheetTrigger>
  );
}

export function AddTeamMemberBulkSuccessSheet({
  open,
  onOpenChange,
  onTriggerOpen,
  triggerVariant,
  results,
  onAddMore,
  onDone,
  toast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  triggerVariant: TriggerVariant;
  results: BulkMemberResult[];
  onAddMore: () => void;
  onDone: () => void;
  toast: (options: ToastOptions) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <AddTeamMemberTrigger triggerVariant={triggerVariant} onOpen={onTriggerOpen} />
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            {results.length} Member{results.length > 1 ? "s" : ""} Added
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 pb-6">
          {results.map((result, index) => (
            <div key={index} className="p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{result.name}</p>
                  {result.email && <p className="text-xs text-muted-foreground">{result.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {result.sent ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                      <Mail className="h-3 w-3 mr-1" />
                      Sent
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                      {result.email ? "Failed" : "Link only"}
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(result.link);
                        toast({
                          title: "Invite link copied",
                          description: `Share ${result.name}'s invite link wherever you like.`,
                        });
                      } catch {
                        toast({
                          title: "Could not copy link",
                          description: "Please try again.",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copy link
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onAddMore}>
              Add More
            </Button>
            <Button className="flex-1" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AddTeamMemberInviteSuccessSheet({
  open,
  onOpenChange,
  onTriggerOpen,
  triggerVariant,
  name,
  selectedRole,
  children,
  teamName,
  clubName,
  email,
  sharePhone,
  onSharePhoneChange,
  inviteLink,
  shareMessage,
  onAddAnother,
  onDone,
  toast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTriggerOpen: () => void;
  triggerVariant: TriggerVariant;
  name: string;
  selectedRole: string;
  children: BulkChild[];
  teamName: string;
  clubName?: string | null;
  email: string;
  sharePhone: string;
  onSharePhoneChange: (phone: string) => void;
  inviteLink: string;
  shareMessage: string;
  onAddAnother: () => void;
  onDone: () => void;
  toast: (options: ToastOptions) => void;
}) {
  const validChildren = children.filter((child) => child.name.trim());
  const message = shareMessage.trim();
  const cleanedPhone = sharePhone.replace(/[^\d+]/g, "");
  const whatsappPhone = cleanedPhone.replace(/^\+/, "");
  const hasPhone = cleanedPhone.length >= 4;
  const smsHref = hasPhone
    ? `sms:${cleanedPhone}${/android/i.test(navigator.userAgent) ? "?" : "&"}body=${encodeURIComponent(message)}`
    : `sms:?body=${encodeURIComponent(message)}`;
  const whatsappHref = hasPhone
    ? `https://reference.invalid)}`
    : `https://reference.invalid)}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <AddTeamMemberTrigger triggerVariant={triggerVariant} onOpen={onTriggerOpen} />
      <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            Member Added
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-6 pb-6">
          <div className="p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
            <p className="font-medium mb-1">{name}</p>
            {selectedRole === "parent" && validChildren.length > 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Baby className="h-3.5 w-3.5" />
                {validChildren.length === 1
                  ? `${validChildren[0].name.trim()} added to ${teamName || "the team"}`
                  : `${validChildren.map((child) => child.name.trim()).join(", ")} added to ${teamName || "the team"}`}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {email ? `Invite sent to ${email}` : "Invite link created — share it with them"}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-center">Share invite via</p>
            <div className="space-y-1.5">
              <Label htmlFor="share-phone" className="text-xs text-muted-foreground">
                Phone number (optional — opens SMS or WhatsApp)
              </Label>
              <Input
                id="share-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="e.g. +61 412 345 678"
                value={sharePhone}
                onChange={(event) => onSharePhoneChange(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Not saved — used only to open your messaging app.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => { window.location.href = smsHref; }}>
                <MessageSquare className="h-4 w-4 mr-2" />
                SMS
              </Button>
              <Button variant="outline" onClick={() => { window.open(whatsappHref, "_blank"); }}>
                <Share2 className="h-4 w-4 mr-2" />
                WhatsApp
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  if (Capacitor.isNativePlatform()) {
                    try {
                      await Share.share({
                        title: `Join ${clubName || teamName}`,
                        text: message,
                        dialogTitle: "Share invite",
                      });
                      return;
                    } catch {
                      // The native share sheet was cancelled.
                    }
                  }
                  window.open(`https://reference.invalid)}`, "_blank");
                }}
              >
                <Share2 className="h-4 w-4 mr-2" />
                More
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink);
                    toast({ title: "Invite link copied!" });
                  } catch {
                    toast({ title: "Failed to copy link", variant: "destructive" });
                  }
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy Link
              </Button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            When they accept the invite, their name will be pre-filled as "{name}"
          </p>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onAddAnother}>
              Add Another
            </Button>
            <Button className="flex-1" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
