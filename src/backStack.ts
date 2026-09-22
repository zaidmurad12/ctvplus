// The root fix for a recurring class of bug: "pressing back on screen X sometimes exits the app,
// sometimes does nothing" - reported repeatedly (movie details, after returning from playback,
// after several other unrelated changes) despite each individual screen's own BackHandler effect
// looking correct in isolation. The real problem was architectural, not any one screen's code:
// every screen that needs to consume back independently called
// `BackHandler.addEventListener("hardwareBackPress", ...)`, so *how many* native listeners exist
// at any moment, and *which one* actually receives a given press, depended on React's own
// effect-scheduling order across an arbitrary number of components mounting/unmounting/
// re-subscribing (a fresh `onBack` reference, a parent re-render, a lazy-loaded screen still
// resolving) - a fragile, hard-to-reason-about race that kept resurfacing in new shapes no matter
// how carefully any single screen's own effect was written.
//
// This replaces that entirely: exactly ONE native BackHandler listener exists for the app's whole
// lifetime (registered once in App.tsx, never removed), which always defers to this plain, in-
// memory stack instead. A screen that wants to own back pushes its own handler on mount and it's
// automatically popped on unmount (via the cleanup function `pushBackHandler` returns) - ordinary
// React effect cleanup, but now only ever mutating a plain array, never touching the native side.
// "Which handler wins" is just "whatever's on top of the stack", deterministic and inspectable,
// with no native listener add/remove churn ever happening after the very first one at app boot.
type BackHandlerFn = () => boolean;
interface StackEntry {
  fn: BackHandlerFn;
  label: string;
}

const stack: StackEntry[] = [];

// Returns an unsubscribe function - call it from the same effect's cleanup, exactly like the
// `sub.remove()` this replaces. `label` identifies which screen owns each entry - not read
// anywhere at runtime, but what let a live device test pin down the exact "SettingsScreen ends up
// on top after returning from the player" bug (see SettingsScreen.tsx's own comment) instead of
// guessing blind, so it stays here for the next time a stack-ordering bug like that needs it.
export function pushBackHandler(fn: BackHandlerFn, label = "unlabeled"): () => void {
  const entry: StackEntry = { fn, label };
  stack.push(entry);
  return () => {
    const index = stack.indexOf(entry);
    if (index !== -1) stack.splice(index, 1);
  };
}

// Called by the single app-wide listener in App.tsx. Whatever was pushed most recently (the
// screen actually on top, regardless of which component tree it lives in) always gets first
// refusal; only true if it consumed the press (matching BackHandler's own "did anyone handle
// this" contract), so the native default (finish the Activity) still applies when the stack is
// empty - same behavior as before, just resolved through one call instead of an active listener.
export function dispatchBack(): boolean {
  if (stack.length === 0) return false;
  const top = stack[stack.length - 1];
  return top.fn();
}
