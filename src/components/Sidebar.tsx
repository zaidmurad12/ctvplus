import React, { useRef, useState } from "react";
import { View, StyleSheet, findNodeHandle } from "react-native";
import { Home, Search, Tv, Film, Bookmark, Settings } from "lucide-react-native";
import Focusable from "./Focusable";
import Logo from "./Logo";
import { colors } from "../theme";
import { s } from "../scale";
import { registerSidebarHome } from "../focusRefs";

// "favorites" (Watch Later) and "history" (Watch History) used to be two separate icons/
// screens here - merged into one "library" entry/screen since they're both just "things this
// viewer has already engaged with", and having them side by side in one place is more useful
// than hunting between two icons for the same viewing session.
export type Section = "home" | "movies" | "series" | "library" | "search" | "settings";

const ITEMS: { section: Section; Icon: typeof Home }[] = [
  { section: "home", Icon: Home },
  { section: "search", Icon: Search },
  { section: "series", Icon: Tv },
  { section: "movies", Icon: Film },
  { section: "library", Icon: Bookmark },
  { section: "settings", Icon: Settings },
];

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
}

export default function Sidebar({ active, onSelect }: Props) {
  const itemRefs = useRef<Array<View | null>>([]);
  // Refs aren't known until after the first mount, so nextFocusUp/Down (which need a real
  // node handle, not a ref object) can't be set on that first render - this just forces one
  // extra render once every icon has mounted, so the second render has real handles to give.
  const [, forceRerender] = useState(0);
  const hasTriggeredRerender = useRef(false);

  // `ref={(node) => ...}` written inline would build a brand-new function every render,
  // and React detaches+reattaches a ref whenever its identity changes - on *every* render,
  // not just mount. That called forceRerender on every single render unconditionally,
  // which is an infinite render loop: the crash-on-launch this replaces (Sidebar mounts the
  // instant "continue as guest" is pressed, so it happened almost immediately). Building
  // each callback once and reusing the same function identity every render means React only
  // calls it on genuine mount/unmount, and the trigger-once guard makes the extra render
  // fire exactly once even then.
  const setRefFns = useRef<Array<(node: View | null) => void> | null>(null);
  if (setRefFns.current === null) {
    setRefFns.current = ITEMS.map((_, i) => (node: View | null) => {
      itemRefs.current[i] = node;
      if (i === 0) registerSidebarHome(node);
      if (i === ITEMS.length - 1 && node && !hasTriggeredRerender.current) {
        hasTriggeredRerender.current = true;
        forceRerender((t) => t + 1);
      }
    });
  }

  const handleOf = (i: number) => {
    const node = itemRefs.current[i];
    return node ? findNodeHandle(node) ?? undefined : undefined;
  };

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.logo}>
        <Logo height={32} />
      </View>
      <View style={styles.iconsWrap}>
        {ITEMS.map(({ section, Icon }, i) => (
          <Focusable
            key={section}
            ref={setRefFns.current![i]}
            scaleTo={1.12}
            onPress={() => onSelect(section)}
            style={styles.btn}
            // Explicit vertical routing instead of Android's geometric guess - the sidebar's
            // 6 icons are close enough together that nearest-neighbor sometimes picked a
            // non-adjacent one (reported as "up" from the 2nd icon landing on the last one).
            // Clamped at both ends (self-reference) so up from the top / down from the bottom
            // is a no-op instead of wrapping around.
            nextFocusUp={i > 0 ? handleOf(i - 1) : handleOf(0)}
            nextFocusDown={i < ITEMS.length - 1 ? handleOf(i + 1) : handleOf(ITEMS.length - 1)}
            focusRadius={s(12)}
            clipFocusOverflow
          >
            {(focused: boolean) => (
              // No focusShadowTight - btnFocused already turns this solid white, and a white
              // glow behind an already-white fill is redundant at best (rendered as a visible
              // hatch artifact on at least one real device).
              <View
                style={[
                  styles.btnInner,
                  active === section && !focused && styles.btnActiveInner,
                  focused && styles.btnFocused,
                ]}
              >
                <Icon size={s(20)} color={focused ? "#000" : active === section ? "#fff" : colors.textMuted} strokeWidth={2.25} />
              </View>
            )}
          </Focusable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: s(88),
    zIndex: 40,
    alignItems: "center",
  },
  // Fixed at the top of the sidebar's own column, independent of the icon stack below - the
  // icons stay centered on the full column height exactly as before; this doesn't compete
  // with that centering for space. Lowered (was 24, then 36) - per explicit follow-up request,
  // to land level with "أفلام"/"مسلسلات"/"إعدادات" 's own title (and the filter row beside it on
  // that same line), which sit at paddingTop 40-44 across every sidebar-adjacent screen (see
  // BrowseScreen's own headerRow comment) - this Logo's own fixed 32px height (unlike everything
  // else here, not run through s()) means its exact centered position shifts slightly relative to
  // scaled text as the UI-scale setting changes, so this may need one more nudge at a different
  // scale than the default (0.9) this was tuned against.
  logo: { position: "absolute", top: s(40) },
  iconsWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: s(16) },
  btn: { width: s(44), height: s(44) },
  btnActiveInner: { backgroundColor: "rgba(38,38,38,0.9)" },
  btnInner: {
    width: s(44),
    height: s(44),
    borderRadius: s(12),
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  btnFocused: { backgroundColor: "#fff" },
});
