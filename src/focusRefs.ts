import { useEffect, useState } from "react";
import { findNodeHandle } from "react-native";

// Holds the Sidebar's "Home" button native node handle once Sidebar mounts, so any screen's
// leftmost-column focusable (hero buttons, a rail's first card, a grid's first column) can
// set nextFocusLeft={sidebarFocus.homeHandle} and reliably land on Home when the user
// presses left/back toward the sidebar - instead of Android's geometric nearest-neighbor
// guess, which was picking whichever icon happened to sit closest to wherever focus already
// was, unpredictably.
export const sidebarFocus: { homeHandle: number | null } = { homeHandle: null };

export function registerSidebarHome(instance: unknown) {
  sidebarFocus.homeHandle = findNodeHandle(instance as any) ?? null;
}

// Sidebar and the screen consuming this both mount in the same commit, so
// sidebarFocus.homeHandle is still null on a consumer's first render. A single 50ms retry used
// to be enough to pick up the handle Sidebar's own ref callback set in the meantime, but under
// real-world load (whatever else is happening on the JS thread right after a screen switch) that
// one attempt can still find it null and this hook never tries again - permanently leaving every
// nextFocusLeft on that screen unset for the rest of its mounted lifetime, silently falling back
// to Android's own unreliable geometric guess (reported as home rows "still linked to each other
// from the left" - LEFT was reaching a neighboring row instead of the sidebar). Retrying several
// times with a real gap between attempts covers a slow mount without waiting forever if the
// sidebar genuinely never registers one.
export function useSidebarHomeHandle(): number | null {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (sidebarFocus.homeHandle != null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // No attempt cap - giving up after a fixed window traded one failure mode (a slow-to-
    // register sidebar) for another (nextFocusLeft permanently unset for the rest of this
    // screen's mounted lifetime, silently falling back to Android's geometric guess - reported
    // as rows escaping into whichever other row happens to sit nearest). Sidebar and this screen
    // are separate lazy-loaded modules resolving on their own schedules; polling costs nothing
    // once the value is found (the timer just stops), so there's no real downside to trying
    // indefinitely instead of guessing how long is "enough".
    const tryAgain = () => {
      if (sidebarFocus.homeHandle != null) {
        rerender((t) => t + 1);
        return;
      }
      timer = setTimeout(tryAgain, 100);
    };
    timer = setTimeout(tryAgain, 100);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);
  return sidebarFocus.homeHandle;
}
