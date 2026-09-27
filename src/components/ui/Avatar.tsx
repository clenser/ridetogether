export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

interface AvatarProps {
  name?: string | null;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
}

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: "ds-avatar--xs",
  sm: "ds-avatar--sm",
  md: "",
  lg: "ds-avatar--lg",
  xl: "ds-avatar--xl",
};

/**
 * Up to two letters from the name, so a member without a photo is still
 * identified rather than shown as a broken image.
 */
function initialsOf(name?: string | null): string {
  const parts = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

export function Avatar({ name, src, size = "md", className = "" }: AvatarProps) {
  const classes = ["ds-avatar", SIZE_CLASS[size], className].filter(Boolean).join(" ");
  const initials = initialsOf(name);

  /* The image is decorative here: the name is always rendered as text beside
     the avatar, so announcing it twice would be noise. If the image fails to
     load, the initials behind it become the visible fallback. */
  if (src) {
    return (
      <span className={classes} aria-hidden="true">
        {initials}
        <img src={src} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }

  return (
    <span className={classes} aria-hidden="true">
      {initials}
    </span>
  );
}

interface AvatarGroupProps {
  people: Array<{ id: string; name?: string | null; src?: string | null }>;
  size?: AvatarSize;
  /** How many avatars to show before collapsing into a "+n" chip. */
  max?: number;
}

export function AvatarGroup({ people, size = "sm", max = 4 }: AvatarGroupProps) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span className="ds-avatar-group" role="group" aria-label={`${people.length} people`}>
      {shown.map((person) => (
        <Avatar key={person.id} name={person.name} src={person.src} size={size} />
      ))}
      {overflow > 0 ? (
        <span className={`ds-avatar ${SIZE_CLASS[size]} ds-avatar-group__more`} aria-hidden="true">
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export type { AvatarGroupProps, AvatarProps };
export default Avatar;
