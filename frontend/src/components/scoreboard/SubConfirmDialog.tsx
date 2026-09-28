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
import { ArrowLeftRight, LogIn, LogOut } from "lucide-react";

export type SubConfirmKind = "sub-on" | "sub-off" | "swap-court" | "swap-bench";

export interface SubConfirmPayload {
  kind: SubConfirmKind;
  /** Player coming on / staying on / being moved. */
  primaryName: string;
  /** Player going off / being swapped with. Optional for direct slot fills. */
  secondaryName?: string;
  /** Position involved (court target). */
  position?: string;
}

interface SubConfirmDialogProps {
  payload: SubConfirmPayload | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared sub/swap confirmation dialog used by both the basketball and
 * netball boards. The coach taps a player + a target — instead of
 * mutating immediately, the board stages a {@link SubConfirmPayload}
 * and shows this dialog so the change is explicit and reversible
 * before it lands on the court.
 *
 * One-tap subs were causing accidental swaps mid-game; this dialog
 * adds a single confirmation step without changing any of the
 * downstream substitution logic.
 */
export default function SubConfirmDialog({
  payload,
  onConfirm,
  onCancel,
}: SubConfirmDialogProps) {
  const open = !!payload;
  const title = (() => {
    if (!payload) return "";
    switch (payload.kind) {
      case "sub-on":
        return "Sub on?";
      case "sub-off":
        return "Sub off?";
      case "swap-court":
        return "Swap positions?";
      case "swap-bench":
        return "Swap players?";
    }
  })();

  const Icon = (() => {
    if (!payload) return ArrowLeftRight;
    if (payload.kind === "sub-on") return LogIn;
    if (payload.kind === "sub-off") return LogOut;
    return ArrowLeftRight;
  })();

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">
            {payload && describePayload(payload)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function describePayload(p: SubConfirmPayload): string {
  switch (p.kind) {
    case "sub-on":
      if (p.secondaryName && p.position) {
        return `Bring ${p.primaryName} on for ${p.secondaryName} at ${p.position}.`;
      }
      if (p.position) return `Bring ${p.primaryName} on at ${p.position}.`;
      return `Bring ${p.primaryName} on.`;
    case "sub-off":
      return `Take ${p.primaryName} off${p.position ? ` (${p.position})` : ""}.`;
    case "swap-court":
      return `Swap ${p.primaryName} with ${p.secondaryName ?? "the other player"} on court.`;
    case "swap-bench":
      return `Swap ${p.primaryName} (bench) with ${p.secondaryName ?? "court player"}.`;
  }
}
