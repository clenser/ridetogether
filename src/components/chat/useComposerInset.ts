import { useEffect, useState } from "react";

/**
 * How far the composer has to sit above the bottom of the screen.
 *
 * Two things push it up and they stack. The app's bottom navigation is a fixed
 * element, so on a phone the composer would sit underneath it. And when the
 * soft keyboard opens, the visual viewport shrinks even though the layout
 * viewport does not, so a composer positioned against the layout viewport ends
 * up behind the keyboard.
 *
 * Measuring both and taking the larger number is what keeps the send button
 * reachable in either case. `env(safe-area-inset-bottom)` is read here as a
 * fallback for browsers with no `visualViewport`, which is why the number can be
 * positive even when nothing is on screen.
 */
export function useComposerInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      // No visual viewport to track, so fall back to the CSS safe area.
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);";
      document.body.appendChild(probe);
      setInset(probe.getBoundingClientRect().height);
      return () => probe.remove();
    }

    const measure = () => {
      // The gap between the visual viewport's bottom edge and the layout
      // viewport's bottom edge. This is the keyboard, when it is open.
      const keyboardGap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const safe = readSafeArea();
      setInset(Math.max(safe, keyboardGap));
    };

    measure();
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return inset;
}

function readSafeArea(): number {
  if (typeof getComputedStyle !== "function") return 0;
  // `env()` resolves to 0 in browsers that do not support it, so this is safe to
  // call on every resize rather than guessing at platform support.
  const value = getComputedStyle(document.documentElement).getPropertyValue("--rt-safe-bottom");
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
