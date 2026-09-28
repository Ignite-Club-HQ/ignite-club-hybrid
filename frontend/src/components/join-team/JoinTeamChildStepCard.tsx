import { CheckCircle, Loader2, Plus, Sparkles, UserCheck, Users } from "lucide-react";

import { InviteFlowProgress } from "@/components/InviteFlowProgress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ExistingTeamChild = {
  id: string;
  name: string;
  year_of_birth: number | null;
};

type InviteStep = "view" | "install" | "auth" | "profile" | "done";

export function JoinTeamChildStepCard({
  currentStep,
  isExistingUser,
  inviteEntityName,
  addedChildren,
  existingTeamChildren,
  linkExistingChildId,
  childName,
  childYearOfBirth,
  canAddChild,
  addingChild,
  showSkipConfirm,
  onToggleExistingChild,
  onChildNameChange,
  onChildYearOfBirthChange,
  onAddChild,
  onFinish,
  onOpenSkipConfirmChange,
  onSkipConfirm,
}: {
  currentStep: InviteStep;
  isExistingUser: boolean;
  inviteEntityName: string;
  addedChildren: string[];
  existingTeamChildren: ExistingTeamChild[];
  linkExistingChildId: string | null;
  childName: string;
  childYearOfBirth: string;
  canAddChild: boolean;
  addingChild: boolean;
  showSkipConfirm: boolean;
  onToggleExistingChild: (childId: string) => void;
  onChildNameChange: (value: string) => void;
  onChildYearOfBirthChange: (value: string) => void;
  onAddChild: () => void;
  onFinish: () => void;
  onOpenSkipConfirmChange: (open: boolean) => void;
  onSkipConfirm: () => void;
}) {
  const hasAdded = addedChildren.length > 0;

  return (
    <>
      <div className="min-h-screen flex flex-col bg-background">
        <InviteFlowProgress
          currentStep={currentStep}
          isExistingUser={isExistingUser}
          className="fixed top-0 left-0 right-0"
        />
        <div className="flex-1 flex items-center justify-center p-4 pt-16">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center space-y-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-xl">
                {hasAdded ? "Add another child?" : `Link your child to ${inviteEntityName}`}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {hasAdded
                  ? "Add a sibling, or tap Done to finish."
                  : "This is how the team knows which player you're the parent of. You can add more than one."}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasAdded && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-medium text-primary uppercase tracking-wide">
                    <Sparkles className="h-3.5 w-3.5" />
                    Added
                  </div>
                  {addedChildren.map((name, index) => (
                    <div key={`${name}-${index}`} className="flex items-center gap-2 text-sm">
                      <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium">{name}</span>
                    </div>
                  ))}
                </div>
              )}

              {!hasAdded && (
                <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                  {existingTeamChildren.length > 0
                    ? "If your child is already on the team roster, tap their name to claim them. Otherwise add them below."
                    : "Add your child's name so the coach can connect you to them on the team sheet."}
                </div>
              )}

              {!hasAdded && existingTeamChildren.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Don't see your child? They may already be linked to another parent — ask your coach to add you instead of creating a duplicate.
                </p>
              )}

              {existingTeamChildren.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Link to existing child on team</Label>
                  <div className="space-y-1">
                    {existingTeamChildren.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => onToggleExistingChild(child.id)}
                        className={`w-full flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                          linkExistingChildId === child.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm">{child.name}</span>
                        {child.year_of_birth && (
                          <span className="text-xs text-muted-foreground ml-auto">{child.year_of_birth}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Don't see your child? They may already be linked to another parent — ask your coach to add you instead of creating a duplicate.
                  </p>
                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">or add new</span>
                    </div>
                  </div>
                </div>
              )}

              {!linkExistingChildId && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="child-name" className="text-sm">Child's Name</Label>
                    <Input
                      id="child-name"
                      value={childName}
                      onChange={(event) => onChildNameChange(event.target.value)}
                      placeholder="Enter child's name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="child-yob" className="text-sm">Year of Birth (optional)</Label>
                    <Input
                      id="child-yob"
                      type="number"
                      value={childYearOfBirth}
                      onChange={(event) => onChildYearOfBirthChange(event.target.value)}
                      placeholder="e.g. 2015"
                      min={1940}
                      max={new Date().getFullYear()}
                    />
                  </div>
                </div>
              )}

              {!canAddChild && (
                <p className="text-sm text-muted-foreground text-center">
                  This invite isn't linked to a team yet — ask your club admin to add your child.
                </p>
              )}
              <Button
                className="w-full"
                onClick={onAddChild}
                disabled={!canAddChild || addingChild || (!childName.trim() && !linkExistingChildId)}
              >
                {addingChild ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {linkExistingChildId
                  ? "Link Child"
                  : hasAdded
                    ? "Add Another Child"
                    : "Add Child"}
              </Button>

              {hasAdded ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={onFinish}
                  disabled={addingChild}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Done
                </Button>
              ) : (
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => onOpenSkipConfirmChange(true)}
                    disabled={addingChild}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
                  >
                    I'll do this later
                  </button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={showSkipConfirm} onOpenChange={onOpenSkipConfirmChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip linking your child?</AlertDialogTitle>
            <AlertDialogDescription>
              Without a linked child you won't see team sheets, RSVPs or match notifications for your player. A team admin will need to link them manually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={onSkipConfirm}>
              Skip anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
