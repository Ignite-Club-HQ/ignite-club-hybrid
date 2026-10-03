path = "frontend/src/components/event/EventDetailHeader.tsx"
with open(path, "r") as f:
    lines = f.readlines()

new_lines = []
skip = False
for i in range(len(lines)):
    if 'resolveAuthBackend() !== "icp" && isUpcoming && (' in lines[i] and i + 1 < len(lines) and '{isUpcoming && (' in lines[i+1]:
        new_lines.append(lines[i])
        skip = True
        continue
    if skip and '{isUpcoming && (' in lines[i]:
        skip = False
        continue
    new_lines.append(lines[i])

with open(path, "w") as f:
    f.writelines(new_lines)
