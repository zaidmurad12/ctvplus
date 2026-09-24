import { useRef, useState } from "react";
import { View, findNodeHandle } from "react-native";

// Reaching the last (or first) item in a horizontal row and pressing further in that direction
// used to fall through to Android's own geometric nearest-neighbor guess, which sometimes
// picked an item in a *different* row entirely (the next row down, a season chip, whatever
// happened to sit closest on screen) instead of just stopping - reported as "it should stop at
// the end of a row, only up/down should ever leave it". Explicitly self-referencing
// nextFocusLeft/Right on a row's own first/last item (the same trick Sidebar and FilterDropdown
// already use for their own up/down boundaries) makes that direction a no-op there instead of
// an unpredictable jump - up/down is untouched, so moving to another row still works normally.
//
// Refs aren't known until after the first mount, so the handles this returns start out
// `undefined` and only become real Android view-tag numbers once every item has actually
// mounted - the `bump` counter forces one extra render at that point so a *second* render can
// wire the real handles in, the same one-shot pattern used everywhere else in this app that
// needs native ref handles for nextFocus* props.
export function useFocusClamp(count: number) {
  const itemRefs = useRef<Array<View | null>>([]);
  const [, setBump] = useState(0);
  const triggeredRef = useRef(false);
  // count can change across renders (a filtered/paginated row growing or shrinking) - captured in
  // a ref rather than a plain closure variable so the memoized api object below (built once, see
  // apiRef) can still read whatever the *current* count is instead of freezing the value it
  // happened to see on its first render.
  const countRef = useRef(count);
  countRef.current = count;

  const setRefFns = useRef<Array<(node: View | null) => void> | null>(null);
  if (setRefFns.current === null || setRefFns.current.length !== count) {
    triggeredRef.current = false;
    setRefFns.current = Array.from({ length: count }, (_, i) => (node: View | null) => {
      itemRefs.current[i] = node;
      if (i !== count - 1) return;
      if (node && !triggeredRef.current) {
        triggeredRef.current = true;
        setBump((b) => b + 1);
      } else if (!node) {
        // The row unmounted (e.g. a Settings tab switch) - re-arm so its remount re-renders with
        // the new views' handles instead of keeping ones pointing at views that no longer exist.
        triggeredRef.current = false;
      }
    });
  }

  const handleOf = (i: number): number | undefined => {
    const node = itemRefs.current[i];
    return node ? findNodeHandle(node) ?? undefined : undefined;
  };

  // A stable object identity across every render of the owning component (built once, never
  // reassigned) - every method on it only ever reads from refs at call time, never from a value
  // closed over at definition time, so returning the *same* object forever is safe and loses
  // nothing. This matters because callers pass these straight through as props to memoized list
  // items (MovieCard, RecentCard) - a fresh object every render, even with identical *contents*,
  // would look like a changed prop to React.memo's shallow compare and defeat it, which was
  // exactly the mechanism (per a full re-render audit) behind whole rows/grids of cards
  // re-rendering on every single D-pad press instead of just the one card whose focus changed.
  const apiRef = useRef<{
    setRef: (i: number) => (node: View | null) => void;
    clampLeft: () => number | undefined;
    clampRight: () => number | undefined;
    handleOf: (i: number) => number | undefined;
    focusItem: (i: number) => void;
  } | null>(null);
  if (!apiRef.current) {
    apiRef.current = {
      setRef: (i: number) => setRefFns.current![i],
      // Pass straight into nextFocusLeft on a row's first item and nextFocusRight on its last -
      // self-referencing, so that direction becomes a no-op there instead of escaping the row.
      clampLeft: () => handleOf(0),
      clampRight: () => handleOf(countRef.current - 1),
      // For wiring explicit adjacency *between* items in the row too (not just clamping the
      // ends) - e.g. a fixed 3-button row where the middle item needs nextFocusLeft/Right
      // pointing at its two neighbors, not just relying on Android's geometric guess to find
      // them (the same unreliable-nearest-neighbor problem this whole hook exists to avoid).
      handleOf,
      // Imperatively re-focuses a specific item by index - for the rarer case where a real
      // Android focus target has to be found again after being reached some way *other* than the
      // user's own left/right press through this row (e.g. HomeScreen's own recent strip, which
      // fully unmounts and remounts as its own hero collapses/reopens - a plain nextFocusUp has
      // nothing valid to point at while it's gone, so the screen calls this once it's back
      // instead).
      focusItem: (i: number) => {
        (itemRefs.current[i] as unknown as { focus?: () => void } | null)?.focus?.();
      },
    };
  }

  return apiRef.current;
}
