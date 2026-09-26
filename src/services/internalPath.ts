/**
 * Guards for values that are about to become a URL we navigate to.
 *
 * `useNavigate` and `<Link to>` treat a few shapes as absolute, so a string that
 * looks like a path can still leave the app:
 *
 *   //evil.com     protocol-relative, becomes https://evil.com
 *   /\evil.com     backslashes are normalised to slashes by the browser
 *   https://evil.com  plainly external
 *
 * A redirect target only ever comes from our own router (`location.pathname`),
 * but a member can arrive on such a path from a crafted link, and the value then
 * survives a round trip through `location.state`. Constraining it to a single
 * leading slash followed by something that cannot start a host keeps the
 * post-sign-in hop inside the app no matter what is passed in.
 */
export const isInternalPath = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  // "/" is valid (the app root), so only the second character is a concern.
  return value.length === 1 || !/[/\\]/.test(value[1]);
};

/**
 * Returns `value` when it is a safe in-app path, otherwise `fallback`.
 */
export const safeInternalPath = (value: unknown, fallback = "/"): string =>
  isInternalPath(value) ? value : fallback;
