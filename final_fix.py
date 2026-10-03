import re

def fix_header():
    path = "frontend/src/components/event/EventDetailHeader.tsx"
    with open(path, "r") as f:
        content = f.read()
    
    # Fix the messy Resend Invites block
    content = re.sub(
        r'\{resolveAuthBackend\(\) !== "icp" && isUpcoming && \(\s*\{isUpcoming && \(',
        r'{resolveAuthBackend() !== "icp" && isUpcoming && (',
        content
    )
    # Ensure there is only one closing parenthesis/brace set
    content = re.sub(
        r'Resend Invites\s*</DropdownMenuItem>\s*\)\s*\}',
        r'Resend Invites\n                  </DropdownMenuItem>\n                )}',
        content
    )
    # The previous regex might have left a trailing )} or something. 
    # Let's just normalize the whole block.
    
    with open(path, "w") as f:
        f.write(content)

fix_header()
