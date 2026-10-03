import re

def fix_file(path, replacements):
    with open(path, "r") as f:
        content = f.read()
    for old, new in replacements:
        content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)

# EventRsvpResponseSection.tsx
fix_file("frontend/src/components/event/EventRsvpResponseSection.tsx", [
    ('                {childRsvp && resolveAuthBackend() !== "icp" && (\n                  <button', '                {childRsvp && resolveAuthBackend() !== "icp" && (\n                  <button'),
    ('                  </button>\n                )}\n                )}', '                  </button>\n                )}'),
    ('      {myRsvp && resolveAuthBackend() !== "icp" && (\n        <button', '      {myRsvp && resolveAuthBackend() !== "icp" && (\n        <button'),
    ('            {myRsvp.notes || "Add a note…"}\n          </span>\n      )}\n        </button>\n      )}', '            {myRsvp.notes || "Add a note…"}\n          </span>\n        </button>\n      )}'),
])

# EventDetailHeader.tsx
fix_file("frontend/src/components/event/EventDetailHeader.tsx", [
    ('                {resolveAuthBackend() !== "icp" && isUpcoming && (canSendReminders ? (\n                  <DropdownMenuItem onClick={onSendReminders}>\n                    <Bell className="h-4 w-4 mr-2 text-primary" />\n                    Send Reminders\n                  </DropdownMenuItem>\n                ) : !isLoadingHasTeamPro && (\n                  <DropdownMenuItem disabled>\n                    <Bell className="h-4 w-4 mr-2" />\n                    Send Reminders\n                    <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge>\n                  </DropdownMenuItem>\n                ))}\n                ))}', '                {resolveAuthBackend() !== "icp" && isUpcoming && (canSendReminders ? (\n                  <DropdownMenuItem onClick={onSendReminders}>\n                    <Bell className="h-4 w-4 mr-2 text-primary" />\n                    Send Reminders\n                  </DropdownMenuItem>\n                ) : !isLoadingHasTeamPro && (\n                  <DropdownMenuItem disabled>\n                    <Bell className="h-4 w-4 mr-2" />\n                    Send Reminders\n                    <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge>\n                  </DropdownMenuItem>\n                ))}'),
    ('                {resolveAuthBackend() !== "icp" && isUpcoming && (\n                {isUpcoming && (\n                  <DropdownMenuItem onClick={onResendInvites}>\n                    <UserPlus className="h-4 w-4 mr-2 text-primary" />\n                    Resend Invites\n                )}\n                  </DropdownMenuItem>\n                )}', '                {resolveAuthBackend() !== "icp" && isUpcoming && (\n                  <DropdownMenuItem onClick={onResendInvites}>\n                    <UserPlus className="h-4 w-4 mr-2 text-primary" />\n                    Resend Invites\n                  </DropdownMenuItem>\n                )}'),
])
