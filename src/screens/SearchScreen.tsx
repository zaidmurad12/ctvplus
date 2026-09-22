import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, Dimensions, ActivityIndicator, StyleSheet } from "react-native";
import { Search as SearchIcon } from "lucide-react-native";
import type { Movie } from "../api";
import { searchMovies } from "../api";
import MovieCard, { CARD_TOTAL_WIDTH } from "../components/MovieCard";
import VirtualKeyboard from "../components/VirtualKeyboard";
import Focusable from "../components/Focusable";
import { colors, font, radius, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, t } from "../i18n";

// Matches the search bar's own width above it (see searchBar.maxWidth) - sharing one constant
// makes that alignment deliberate instead of coincidental. The results grid gets whatever width
// is left, not the other way around, since the keyboard's own layout is fixed while the grid's
// column count already adapts to any width.
// Rows are 10 keys wide (see VirtualKeyboard), the whole keyboard 36% of the screen. The search bar above is exactly as wide as the keyboard under
// it, so the two read as one block.
const KEYBOARD_COL_WIDTH = Math.round(Dimensions.get("window").width * 0.36);
const SEARCH_BAR_WIDTH = KEYBOARD_COL_WIDTH;
const GRID_END_PADDING = s(24);
const GRID_GAP = s(32);
// body's own `gap` now separates three children (keyboardCol, the divider line, resultsCol),
// not two - it applies twice, plus the divider's own 1px width, so both have to come off here
// too or the grid's column count would be computed one column too generous.
const NUM_COLUMNS = Math.max(
  2,
  Math.floor((Dimensions.get("window").width - spacing.contentStart - KEYBOARD_COL_WIDTH - GRID_GAP * 2 - GRID_END_PADDING) / CARD_TOTAL_WIDTH)
);
const ROW_GAP = s(30);

type TypeFilter = "all" | "movie" | "series";

// A one/two-letter query matches a huge slice of the catalog; mounting every match at once (each a
// full poster card) is what froze the D-pad after typing a character or two. Only the first
// screenful renders immediately, the rest of a capped list follows a moment later, so focus and
// key presses stay responsive while results appear.
const MAX_RESULTS = 60;
const FIRST_PAINT_COUNT = 12;

interface Props {
  lang: Lang;
  onSelect: (movie: Movie) => void;
}

// Side-by-side layout (keyboard fixed on one side, results scrolling beside it) instead of
// everything stacked in one column - the keyboard and search bar stay in place; only the
// results themselves ever scroll, in their own FlatList, not the page as a whole.
export default function SearchScreen({ lang, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(FIRST_PAINT_COUNT);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  // See BrowseScreen's own identical rebuild for the full reasoning - rebuilt on the same proven
  // shape HomeScreen's own rails use (plain ScrollView, each row's absolute position measured
  // directly via its own onLayout, reactive scrollTo, no interception of up/down at all) instead
  // of a FlatList in numColumns mode with a reactive scrollToOffset correction or explicit
  // nextFocusUp routing, both of which left up/down between rows needing an extra press.
  const gridScrollRef = useRef<any>(null);
  const rowOffsets = useRef<number[]>([]);
  const lastScrolledRow = useRef<number | null>(null);
  const scrollToRow = useCallback((row: number) => {
    if (lastScrolledRow.current === row) return;
    lastScrolledRow.current = row;
    const y = rowOffsets.current[row];
    if (y != null) gridScrollRef.current?.scrollTo({ y: Math.max(0, y - ROW_GAP), animated: true });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const myId = ++requestId.current;
      try {
        const items = await searchMovies(trimmed);
        if (myId === requestId.current) {
          // A transition, so committing a big result list never pre-empts the next key press.
          startTransition(() => {
            setVisibleCount(FIRST_PAINT_COUNT);
            setResults(items.slice(0, MAX_RESULTS));
          });
        }
      } catch (err) {
        console.error("[Search] failed:", err);
      } finally {
        if (myId === requestId.current) setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (results.length <= FIRST_PAINT_COUNT) return;
    const timer = setTimeout(() => setVisibleCount(MAX_RESULTS), 400);
    return () => clearTimeout(timer);
  }, [results]);

  const filtered = useMemo(() => {
    const list = typeFilter === "all" ? results : results.filter((m) => m.type === typeFilter);
    return list.slice(0, visibleCount);
  }, [results, typeFilter, visibleCount]);

  const filterLabels: Record<TypeFilter, string> = {
    all: lang === "ar" ? "الكل" : "All",
    movie: t("movies", lang),
    series: t("series", lang),
  };

  // Chunked into rows once here - see BrowseScreen's own identical `rows` for why.
  const rows = useMemo(() => {
    const out: Movie[][] = [];
    for (let i = 0; i < filtered.length; i += NUM_COLUMNS) out.push(filtered.slice(i, i + NUM_COLUMNS));
    return out;
  }, [filtered]);

  const handleCardFocusChange = useCallback(
    (rowIndex: number, focused: boolean) => {
      if (!focused) return;
      scrollToRow(rowIndex);
    },
    [scrollToRow]
  );
  const onRowLayout = useCallback((rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => {
    rowOffsets.current[rowIndex] = e.nativeEvent.layout.y;
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
      <View style={styles.searchBar}>
        <SearchIcon size={s(16)} color={colors.textMuted} />
        {/* showSoftInputOnFocus=false: this used to bring up the OS's own on-screen keyboard,
            which has no guaranteed Arabic layout (or a remote-friendly one) on every TV box.
            The custom VirtualKeyboard below drives `query` directly instead - this TextInput
            is now just a styled display of it (with a real blinking caret), not an editable
            field the system keyboard attaches to. */}
        <TextInput
          value={query}
          editable={false}
          showSoftInputOnFocus={false}
          placeholder={t("searchPlaceholder", lang)}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
      </View>
        <View style={styles.filterRow}>
          {(["all", "movie", "series"] as TypeFilter[]).map((k) => (
            <Focusable key={k} onPress={() => setTypeFilter(k)} scaleTo={1.05}>
              {(focused: boolean) => (
                // No focusShadowTight - filterPillFocused already turns this solid white, and
                // a white glow behind an already-white fill is redundant at best (rendered as
                // a visible hatch artifact on at least one real device).
                <View style={[styles.filterPill, typeFilter === k && !focused && styles.filterPillActive, focused && styles.filterPillFocused]}>
                  <Text style={[styles.filterPillText, typeFilter === k && styles.filterPillTextActive, focused && styles.filterPillTextFocused]}>
                    {filterLabels[k]}
                  </Text>
                </View>
              )}
            </Focusable>
          ))}
        </View>

      </View>

      <View style={styles.body}>
        <View style={styles.keyboardCol}>
          <VirtualKeyboard
            onKey={(ch) => setQuery((q) => q + ch)}
            onSpace={() => setQuery((q) => q + " ")}
            onBackspace={() => setQuery((q) => q.slice(0, -1))}
          />
        </View>

        <View style={styles.resultsCol}>
          {loading && filtered.length === 0 && (
            <View style={styles.centerBox}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.hintText}>{t("searching", lang)}</Text>
            </View>
          )}

          {!loading && query.trim().length === 0 && (
            <View style={styles.centerBox}>
              <Text style={styles.hintText}>{t("searchHint", lang)}</Text>
            </View>
          )}

          {!loading && query.trim().length > 0 && filtered.length === 0 && (
            <View style={styles.centerBox}>
              <Text style={styles.hintText}>{t("searchEmpty", lang)}</Text>
            </View>
          )}

          {filtered.length > 0 && (
            <ScrollView
              ref={gridScrollRef}
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              scrollsChildToFocus={false}
              style={loading ? styles.gridLoading : undefined}
            >
              {rows.map((rowItems, rowIndex) => (
                <Row
                  key={rowIndex}
                  items={rowItems}
                  rowIndex={rowIndex}
                  lang={lang}
                  onSelect={onSelect}
                  onCardFocusChange={handleCardFocusChange}
                  onRowLayout={onRowLayout}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </View>
  );
}

// See BrowseScreen's own identical Row component for the full reasoning.
const Row = React.memo(function Row({
  items,
  rowIndex,
  lang,
  onSelect,
  onCardFocusChange,
  onRowLayout,
}: {
  items: Movie[];
  rowIndex: number;
  lang: Lang;
  onSelect: (movie: Movie) => void;
  onCardFocusChange: (rowIndex: number, focused: boolean) => void;
  onRowLayout: (rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => void;
}) {
  return (
    <View style={styles.row} onLayout={(e) => onRowLayout(rowIndex, e)}>
      {items.map((movie) => (
        <MovieCard key={movie.id} movie={movie} lang={lang} onSelect={onSelect} onFocusChange={(f) => onCardFocusChange(rowIndex, f)} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  // paddingTop lowered (was 40) - per explicit request, to match BrowseScreen's own headerRow
  // level (see its own comment) - keeps every sidebar-adjacent screen's title at the same height.
  root: { flex: 1, backgroundColor: colors.bg, paddingLeft: spacing.contentStart, paddingTop: s(40) },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    // No fill: just a dark-gray outline.
    borderRadius: radius.pill,
    paddingHorizontal: s(14),
    paddingVertical: s(11),
    width: SEARCH_BAR_WIDTH,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  input: { flex: 1, color: "#fff", fontSize: fs(13), fontFamily: font.semiBold, padding: 0 },
  // The keyboard column has a fixed width and never scrolls; only resultsCol's own FlatList
  // does - flex:1 on this row plus flex:1 on resultsCol is what lets that FlatList size itself
  // to (and scroll within) the remaining space instead of pushing the whole page taller.
  body: { flex: 1, flexDirection: "row", marginTop: s(28), gap: GRID_GAP * 2 },
  keyboardCol: { width: KEYBOARD_COL_WIDTH },
  resultsCol: { flex: 1, paddingRight: GRID_END_PADDING },
  topRow: { flexDirection: "row", alignItems: "center" },
  // Same level as the search bar; the left margin lines the pills up with the results column below.
  filterRow: { flexDirection: "row", gap: s(10), marginLeft: GRID_GAP * 2 },
  filterPill: {
    paddingHorizontal: s(16),
    paddingVertical: s(9),
    borderRadius: radius.pill,
    // No fill - a dark-gray outline like the search bar; the selected pill just gets a lighter outline.
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  filterPillActive: { borderColor: "#7a7a7a" },
  filterPillFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  filterPillText: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold },
  filterPillTextActive: { color: "#fff" },
  filterPillTextFocused: { color: "#000" },
  centerBox: { marginTop: s(60), alignItems: "center", gap: s(10) },
  hintText: { color: colors.textFaint, fontSize: fs(14), fontFamily: font.semiBold },
  grid: { paddingBottom: s(40), paddingTop: s(4) },
  gridLoading: { opacity: 0.55 },
  row: { flexDirection: "row", marginBottom: ROW_GAP },
});
