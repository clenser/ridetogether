import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

/**
 * "Continue with Google", shared by the login and sign-up screens so the OAuth
 * flow, its button state and its error handling only exist once.
 *
 * The Google mark is an inline SVG rather than a remote image: it keeps the
 * button working offline and avoids depending on a third-party asset that could
 * change or fail to load.
 */
const GoogleMark = () => (
  <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.715v2.259h2.909c1.703-1.568 2.684-3.879 2.684-6.614Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.181l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.584-5.037-3.711H.957v2.332A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.963 10.708A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.281-1.708V4.96H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.04l3.006-2.332Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.581c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.463.892 11.426 0 9 0A9 9 0 0 0 .957 4.96l3.006 2.332C4.672 5.165 6.656 3.581 9 3.581Z"
    />
  </svg>
);

interface GoogleSignInButtonProps {
  /** "signin" or "signup" so the label matches the surrounding screen. */
  mode: "signin" | "signup";
  onError: (message: string) => void;
}

export function GoogleSignInButton({ mode, onError }: GoogleSignInButtonProps) {
  const { signInWithGoogle, googleSignInAvailable } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!googleSignInAvailable) return null;

  const label = mode === "signin" ? "Continue with Google" : "Sign up with Google";

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithGoogle();
      // No navigation here on purpose: the browser is leaving for Google's
      // consent screen. If it comes back the session arrives via the auth
      // listener and the route guard moves the member on.
    } catch (error) {
      onError(error instanceof Error ? error.message : "We could not start Google sign-in.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rt-auth__divider">
        <span>or</span>
      </div>
      <button
        className="rt-auth__google"
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <GoogleMark />
        )}
        {busy ? "Opening Google…" : label}
      </button>
    </>
  );
}

export default GoogleSignInButton;
