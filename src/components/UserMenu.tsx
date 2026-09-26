import { useEffect, useRef, useState } from "react";
import { CircleUserRound, LoaderCircle, LogOut, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { User } from "../types";

interface UserMenuProps {
  user: User | null;
  email: string;
  compact?: boolean;
}

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

export function UserMenu({ user, email, compact = false }: UserMenuProps) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayName = user?.name?.trim() || email || "Your account";

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setOpen(false);
    }
  };

  return (
    <div
      className={`user-menu${compact ? " user-menu--compact" : ""}`}
      ref={containerRef}
    >
      <button
        className="user-menu__trigger"
        data-testid="user-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {user?.avatar ? (
          <img className="user-menu__avatar" src={user.avatar} alt="" />
        ) : (
          <span className="user-menu__avatar user-menu__avatar--fallback" aria-hidden="true">
            {user?.name ? getInitials(user.name) : <CircleUserRound size={compact ? 20 : 24} />}
          </span>
        )}
        <span className="user-menu__copy">
          {!compact ? <span className="user-menu__eyebrow">Signed in as</span> : null}
          <strong>{displayName}</strong>
        </span>
        <span className="user-menu__chevron" aria-hidden="true" />
      </button>

      {open ? (
        <div className="user-menu__panel" role="menu" aria-label="Account">
          <div className="user-menu__panel-head">
            <strong>{displayName}</strong>
            <span>{email || "Signed in"}</span>
          </div>
          <Link className="user-menu__item" to="/profile" role="menuitem" onClick={() => setOpen(false)}>
            <CircleUserRound size={16} aria-hidden="true" /> Your profile
          </Link>
          <Link className="user-menu__item" to="/safety" role="menuitem" onClick={() => setOpen(false)}>
            <ShieldCheck size={16} aria-hidden="true" /> Safety center
          </Link>
          <button
            className="user-menu__item user-menu__item--danger"
            data-testid="user-menu-signout"
            type="button"
            role="menuitem"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
          >
            {signingOut ? (
              <LoaderCircle className="spin" size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default UserMenu;
