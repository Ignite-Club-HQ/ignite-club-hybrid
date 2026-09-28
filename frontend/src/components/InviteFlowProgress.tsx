import { cn } from "@/lib/utils";

export type InviteStep = 
  | "view" 
  | "install" 
  | "auth" 
  | "profile" 
  | "done";

interface InviteFlowProgressProps {
  currentStep: InviteStep;
  isIOS?: boolean;
  isExistingUser?: boolean;
  className?: string;
}

// Steps for new users (need to create account)
const NEW_USER_STEPS: InviteStep[] = ["view", "install", "auth", "profile", "done"];
// Steps for new users on iOS (skip install step - no programmatic prompt)
const NEW_USER_STEPS_IOS: InviteStep[] = ["view", "auth", "profile", "done"];
// Steps for existing users (already logged in)
const EXISTING_USER_STEPS: InviteStep[] = ["view", "done"];

const STEP_LABELS: Record<InviteStep, string> = {
  "view": "View Invite",
  "install": "Download App",
  "auth": "Create Account",
  "profile": "Complete Profile",
  "done": "Done"
};

// Storage key for invite flow context - use localStorage to persist across browser close/PWA open
export const INVITE_FLOW_KEY = "inviteFlowContext";

export interface InviteFlowContext {
  active: boolean;
  clubName?: string;
  clubLogoUrl?: string;
  teamName?: string;
  role?: string;
  inviteToken?: string;
  isIOS?: boolean;
  currentStep?: InviteStep; // Track current step to resume properly
  /** Epoch ms when this flow was last touched — used to expire stale banners. */
  updatedAt?: number;
}

/**
 * An invite flow that hasn't progressed within this window is stale: the user
 * has almost certainly finished (or abandoned) it. Without expiry, re-opening
 * the app days later still showed "Create Account • 2 steps remaining".
 */
const INVITE_FLOW_TTL_MS = 6 * 60 * 60 * 1000;

export function setInviteFlowContext(context: InviteFlowContext) {
  try {
    // Use localStorage to persist across browser close/PWA open
    localStorage.setItem(
      INVITE_FLOW_KEY,
      JSON.stringify({ ...context, updatedAt: Date.now() }),
    );
  } catch {
    // localStorage not available
  }
}

export function getInviteFlowContext(): InviteFlowContext | null {
  try {
    const stored = localStorage.getItem(INVITE_FLOW_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as InviteFlowContext;
      const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
      // Missing/old timestamp => stale from a previous session, drop it.
      if (!updatedAt || Date.now() - updatedAt > INVITE_FLOW_TTL_MS) {
        clearInviteFlowContext();
        return null;
      }
      return parsed;
    }
  } catch {
    // localStorage not available or invalid JSON
  }
  return null;
}


export function clearInviteFlowContext() {
  try {
    localStorage.removeItem(INVITE_FLOW_KEY);
  } catch {
    // localStorage not available
  }
}

// Mark a specific user's profile as completed
export function markProfileCompleted(userId: string) {
  try {
    localStorage.setItem(`profileCompleted_${userId}`, "true");
  } catch {
    // localStorage not available
  }
}

// Check if profile has been completed for a specific user
export function hasCompletedProfile(userId?: string): boolean {
  // If no userId provided, can't check - assume not completed (show dots)
  if (!userId) return false;
  try {
    return localStorage.getItem(`profileCompleted_${userId}`) === "true";
  } catch {
    return false;
  }
}

export function InviteFlowProgress({ 
  currentStep, 
  isIOS = false,
  isExistingUser = false,
  className 
}: InviteFlowProgressProps) {
  // Determine which steps to show based on user type and platform
  // iOS users skip install step since there's no programmatic prompt
  const steps = isExistingUser 
    ? EXISTING_USER_STEPS 
    : (isIOS ? NEW_USER_STEPS_IOS : NEW_USER_STEPS);
  
  const currentIndex = steps.indexOf(currentStep);
  
  // Don't render if step not found or if done (success screen handles it)
  if (currentIndex === -1) return null;

  const stepsRemaining = steps.length - currentIndex - 1;

  return (
    <div className={cn("w-full bg-background/95 backdrop-blur-sm border-b border-border py-3 px-4 z-50", className)} style={{ paddingTop: `max(0.75rem, env(safe-area-inset-top))` }}>
      <div className="max-w-md mx-auto">
        {/* Step dots with connector lines */}
        <div className="flex items-center justify-center gap-1.5 mb-2">
          {steps.map((step, index) => {
            const isActive = index === currentIndex;
            const isCompleted = index < currentIndex;
            
            return (
              <div key={step} className="flex items-center">
                <div
                  className={cn(
                    "rounded-full transition-all duration-300",
                    isActive && "w-6 h-2.5 bg-primary",
                    isCompleted && "w-2.5 h-2.5 bg-primary/60",
                    !isActive && !isCompleted && "w-2.5 h-2.5 bg-muted-foreground/30"
                  )}
                />
                {/* Connector line between dots */}
                {index < steps.length - 1 && (
                  <div 
                    className={cn(
                      "w-3 h-0.5 mx-0.5 transition-colors duration-300",
                      isCompleted ? "bg-primary/60" : "bg-muted-foreground/20"
                    )} 
                  />
                )}
              </div>
            );
          })}
        </div>
        
        {/* Current step label and remaining count */}
        <div className="text-center">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{STEP_LABELS[currentStep]}</span>
            {stepsRemaining > 0 && (
              <span className="ml-1.5">
                • {stepsRemaining} step{stepsRemaining > 1 ? 's' : ''} remaining
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// Compact version for inline use within cards
export function InviteFlowProgressCompact({ 
  currentStep, 
  isExistingUser = false,
  className 
}: Omit<InviteFlowProgressProps, 'isIOS'>) {
  const steps = isExistingUser ? EXISTING_USER_STEPS : NEW_USER_STEPS;
  const currentIndex = steps.indexOf(currentStep);
  
  if (currentIndex === -1) return null;

  return (
    <div className={cn("flex items-center justify-center gap-1.5", className)}>
      {steps.map((step, index) => {
        const isActive = index === currentIndex;
        const isCompleted = index < currentIndex;
        
        return (
          <div
            key={step}
            className={cn(
              "rounded-full transition-all duration-300",
              isActive && "w-5 h-2 bg-primary",
              isCompleted && "w-2 h-2 bg-primary/60",
              !isActive && !isCompleted && "w-2 h-2 bg-muted-foreground/30"
            )}
          />
        );
      })}
    </div>
  );
}
