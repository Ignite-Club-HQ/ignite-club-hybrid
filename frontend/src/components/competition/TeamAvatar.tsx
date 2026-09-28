interface TeamAvatarProps {
  name: string;
  logoUrl?: string | null;
  initials: string;
  size?: number;
}

export function TeamAvatar({ name, logoUrl, initials, size = 32 }: TeamAvatarProps) {
  const dim = { width: size, height: size };
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        loading="lazy"
        decoding="async"
        style={dim}
        className="rounded-full object-cover bg-muted shrink-0 ring-1 ring-border/40"
      />
    );
  }
  return (
    <div
      style={dim}
      className="rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0"
    >
      {initials || "?"}
    </div>
  );
}
