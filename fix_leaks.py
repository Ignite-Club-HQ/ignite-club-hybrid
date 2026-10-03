import sys

def fix_rsvp_mutations():
    path = "frontend/src/hooks/useEventRsvpMutations.ts"
    with open(path, "r") as f:
        content = f.read()
    
    # Gating saveRsvpNoteMutation
    content = content.replace(
        'mutationFn: async ({ childId, note }: { childId?: string; note: string | null }) => {',
        'mutationFn: async ({ childId, note }: { childId?: string; note: string | null }) => {\n      if (resolveAuthBackend() === "icp") return;'
    )
    
    # Gating togglePaymentMutation
    content = content.replace(
        'mutationFn: async ({ userId, isPaid }: { userId: string; isPaid: boolean }) => {',
        'mutationFn: async ({ userId, isPaid }: { userId: string; isPaid: boolean }) => {\n      if (resolveAuthBackend() === "icp") return;'
    )
    
    with open(path, "w") as f:
        f.write(content)

def fix_reminder_mutations():
    path = "frontend/src/hooks/useEventReminderMutations.ts"
    with open(path, "r") as f:
        content = f.read()
    
    # Already gated correctly in my previous sed? Let's check.
    # Actually I should make sure it is not duplicated.
    if 'if (resolveAuthBackend() === "icp") return 0;' not in content:
         content = content.replace(
            'remindMutation = useMutation({\n    mutationFn: async () => {',
            'remindMutation = useMutation({\n    mutationFn: async () => {\n      if (resolveAuthBackend() === "icp") return 0;'
        )
    
    with open(path, "w") as f:
        f.write(content)

def fix_rsvp_section():
    path = "frontend/src/components/event/EventRsvpResponseSection.tsx"
    with open(path, "r") as f:
        content = f.read()
    
    # Fix the broken sed wrapping
    import re
    
    # Fix first block (child note)
    content = re.sub(
        r'\{childRsvp && \(\s*\{resolveAuthBackend\(\) !== "icp" && \(',
        r'{childRsvp && resolveAuthBackend() !== "icp" && (',
        content
    )
    content = re.sub(
        r'\)\s*\}\s*\}\s*<TrainingDefaultControl',
        r')}\n                <TrainingDefaultControl',
        content
    )

    # Fix second block (self note)
    content = re.sub(
        r'\{resolveAuthBackend\(\) !== "icp" && myRsvp && \(\s*\{myRsvp && \(',
        r'{myRsvp && resolveAuthBackend() !== "icp" && (',
        content
    )
    content = re.sub(
        r'\)\s*\}\s*\}\s*</button>\s*\}',
        r')}',
        content
    )
    # The above regex might be tricky, let's just do a clean replacement of the whole blocks.
    
    with open(path, "w") as f:
        f.write(content)

def fix_detail_header():
    path = "frontend/src/components/event/EventDetailHeader.tsx"
    with open(path, "r") as f:
        content = f.read()
    
    import re
    content = re.sub(
        r'\{resolveAuthBackend\(\) !== "icp" && isUpcoming && \(canSendReminders \? \(\s*\{isUpcoming && \(canSendReminders \? \(',
        r'{resolveAuthBackend() !== "icp" && isUpcoming && (canSendReminders ? (',
        content
    )
    content = re.sub(
        r'\)\)\s*\}\s*\}\s*\{resolveAuthBackend\(\) !== "icp" && isUpcoming && \(\s*\{isUpcoming && \(',
        r'))}\n                {resolveAuthBackend() !== "icp" && isUpcoming && (',
        content
    )
    content = re.sub(
        r'\)\s*\}\s*\}\s*\}\s*<DropdownMenuSeparator />',
        r')}\n                <DropdownMenuSeparator />',
        content
    )

    with open(path, "w") as f:
        f.write(content)

def fix_groups_manager():
    path = "frontend/src/components/EventGroupsManager.tsx"
    with open(path, "r") as f:
        content = f.read()
    
    # Gate MatchDutiesDialog
    content = content.replace(
        '<MatchDutiesDialog',
        '{resolveAuthBackend() !== "icp" && (\n      <MatchDutiesDialog'
    )
    content = content.replace(
        'initialDutyId={quickAssignDutyId}\n      />',
        'initialDutyId={quickAssignDutyId}\n      />\n      )}'
    )
    
    with open(path, "w") as f:
        f.write(content)

fix_rsvp_mutations()
fix_reminder_mutations()
fix_rsvp_section()
fix_detail_header()
fix_groups_manager()
