import { Loader2, Timer, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TeamJoinRole = "player" | "parent" | "coach" | "team_admin";

export const teamJoinRoleOptions: { value: TeamJoinRole; label: string }[] = [
  { value: "player", label: "Player" },
  { value: "parent", label: "Parent" },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Team Admin" },
];

interface TeamChildOption {
  children: { id: string; name: string } | null;
}

interface TeamJoinRequestCardProps {
  teamName: string;
  existingRequest: { role: string } | undefined;
  selectedRole: TeamJoinRole;
  onSelectedRoleChange: (role: TeamJoinRole) => void;
  teamChildren: TeamChildOption[];
  selectedChildForLink: string;
  onSelectedChildForLinkChange: (value: string) => void;
  newChildName: string;
  onNewChildNameChange: (value: string) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
}

export function TeamJoinRequestCard({
  teamName,
  existingRequest,
  selectedRole,
  onSelectedRoleChange,
  teamChildren,
  selectedChildForLink,
  onSelectedChildForLinkChange,
  newChildName,
  onNewChildNameChange,
  isSubmitting,
  onSubmit,
}: TeamJoinRequestCardProps) {
  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
      <CardContent className="p-5 sm:p-6">
        {existingRequest ? (
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="rounded-full bg-warning/10 p-3">
              <Timer className="h-6 w-6 text-warning" />
            </div>
            <div className="space-y-1">
              <Badge variant="secondary" className="bg-warning/20 text-warning border-warning/30">
                Request Pending
              </Badge>
              <p className="text-sm text-muted-foreground mt-2">
                Your request to join as{" "}
                <span className="font-medium text-foreground">
                  {existingRequest.role.replace("_", " ")}
                </span>{" "}
                is awaiting approval.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-2.5 shrink-0">
                <UserPlus className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base">Join {teamName}</h3>
                <p className="text-sm text-muted-foreground">
                  Select your role and request to become a team member
                </p>
              </div>
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">What's your role?</Label>
              <div className="grid grid-cols-2 gap-2">
                {teamJoinRoleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selectedRole === opt.value}
                    onClick={() => onSelectedRoleChange(opt.value)}
                    className={`
                      p-3 rounded-lg border-2 text-left transition-all min-h-[44px]
                      ${
                        selectedRole === opt.value
                          ? "border-primary bg-primary/10 ring-1 ring-primary/20"
                          : "border-border hover:border-primary/50 hover:bg-muted/50"
                      }
                    `}
                  >
                    <span
                      className={`text-sm font-medium ${selectedRole === opt.value ? "text-primary" : ""}`}
                    >
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Child selection — required for parent role */}
            {selectedRole === "parent" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Which child are you the parent of?</Label>
                {teamChildren.length > 0 ? (
                  <Select
                    value={selectedChildForLink || ""}
                    onValueChange={(v) => {
                      onSelectedChildForLinkChange(v);
                      if (v !== "__new__") onNewChildNameChange("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select your child" />
                    </SelectTrigger>
                    <SelectContent>
                      {teamChildren.map((c) => (
                        <SelectItem key={c.children!.id} value={c.children!.id}>
                          {c.children!.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Add a new child</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {(teamChildren.length === 0 || selectedChildForLink === "__new__") && (
                  <Input
                    placeholder="Child's full name"
                    value={newChildName}
                    onChange={(e) => onNewChildNameChange(e.target.value.slice(0, 100))}
                    maxLength={100}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Admins need to know who your child is to approve your request.
                </p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              className="w-full"
              size="lg"
              onClick={onSubmit}
              disabled={
                isSubmitting ||
                (selectedRole === "parent" &&
                  !(
                    (selectedChildForLink && selectedChildForLink !== "__new__") ||
                    newChildName.trim().length > 0
                  ))
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Request to Join as {selectedRole.replace("_", " ")}
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              A team admin will review your request
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
