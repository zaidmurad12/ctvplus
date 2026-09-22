import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Image, ScrollView, StyleSheet, Dimensions } from "react-native";
import type { Movie } from "../api";
import { posterUrl, fetchByPerson } from "../api";
import MovieCard, { CARD_TOTAL_WIDTH } from "../components/MovieCard";
import Focusable from "../components/Focusable";
import { colors, font, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, t, formatDate } from "../i18n";
import { pushBackHandler } from "../backStack";

// A fixed 6 columns left a wide dead strip on the right on any screen wider than that assumed -
// same fix, same reasoning as BrowseScreen's own NUM_COLUMNS: filling the actual row width,
// whatever it is, is what makes the grid reach the edge of the screen instead of stopping partway
// across, per explicit report that this filmography grid read as "cut off" rather than full width.
const GRID_END_PADDING = s(24);
const NUM_COLUMNS = Math.max(
  4,
  Math.floor((Dimensions.get("window").width - spacing.contentStart - GRID_END_PADDING) / CARD_TOTAL_WIDTH)
);
const ROW_GAP = s(26);

export interface SelectedPerson {
  id: string;
  name: string;
  role?: string;
  photoUrl?: string;
  // Only present once the import system has fetched this person's own TMDB detail record - see
  // CastMember in api.ts. Rendered when available, quietly skipped when not, rather than
  // inventing placeholder copy for a person the catalog never looked up individually.
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  biography?: string;
  biographyAr?: string;
}

interface Props {
  person: SelectedPerson;
  lang: Lang;
  onSelectMovie: (movie: Movie) => void;
  onBack: () => void;
}

// Age as of *now* is only correct for someone still alive - for someone who has died, it needs
// to stop counting at their deathday instead, or it silently reports how old they'd be today
// rather than the age they actually reached.
function calcAge(birthIso: string, deathIso?: string): number | null {
  const d = new Date(birthIso);
  if (isNaN(d.getTime())) return null;
  const end = deathIso ? new Date(deathIso) : new Date();
  if (isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - d.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (365.25 * 24 * 3600 * 1000));
}

type TypeFilter = "movie" | "series";

// This used to call the same /api/movies/search the Search tab uses, which only ever matches
// against title text and genres server-side (see server.ts) - it was never going to find
// anything for a person's *name*. It then moved to filtering a giant client-side "allMovies"
// list the app fetched entirely up front just to make this one lookup work - which is exactly
// the "downloads everything at launch" problem the app-wide move to paginated endpoints fixes.
// /api/movies/by-person runs this same name filter server-side against the *actual* full
// catalog, so this screen no longer needs the whole catalog in memory at all.
export default function PersonScreen({ person, lang, onSelectMovie, onBack }: Props) {
  const [filmography, setFilmography] = useState<Movie[]>([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("movie");
  // See BrowseScreen's own identical rebuild for the full reasoning - this grid used to be a
  // FlatList in numColumns mode with either a reactive scrollToOffset correction or explicit
  // nextFocusUp node routing driving its vertical navigation, both of which left up/down between
  // rows needing an extra press. Rebuilt on the same proven shape HomeScreen's own rails use
  // instead: a plain ScrollView, each row's absolute position measured directly via its own
  // onLayout, a scrollTo triggered reactively from focus, and no interception of the up/down key
  // at all - just Android's own ordinary focus search between rows.
  //
  // The header (photo/name/bio/filter pills) is a normal ScrollView child directly above the
  // mapped rows below, not a FlatList's ListHeaderComponent - since both live in the *same*
  // plain ScrollView now, each row's own onLayout measures its position from that ScrollView's
  // actual top, which already puts the header's real height into every row's offset for free
  // (no separate headerHeightRef bookkeeping needed the way useGridRowScroll's version required).
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
    let cancelled = false;
    fetchByPerson(person.id)
      .then((items) => {
        if (!cancelled) {
          setFilmography(items);
          // Default to whichever tab actually has something to show - defaulting to a fixed
          // "Movies" tab read as broken for a TV-only actor/director with zero movie credits.
          if (items.some((m) => m.type === "movie")) setTypeFilter("movie");
          else if (items.some((m) => m.type === "series")) setTypeFilter("series");
        }
      })
      .catch((err) => console.error("[PersonScreen] fetchByPerson failed:", err));
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  // Pushed onto the shared backStack (see src/backStack.ts's own top comment) instead of calling
  // BackHandler.addEventListener directly - same reasoning as MovieDetailsScreen's identical
  // handler.
  useEffect(() => {
    return pushBackHandler(() => {
      onBack();
      return true;
    }, "PersonScreen");
  }, [onBack]);

  const movieCount = useMemo(() => filmography.filter((m) => m.type === "movie").length, [filmography]);
  const seriesCount = useMemo(() => filmography.filter((m) => m.type === "series").length, [filmography]);
  const filtered = useMemo(() => filmography.filter((m) => m.type === typeFilter), [filmography, typeFilter]);

  const birthDate = person.birthday ? formatDate(person.birthday, lang) : null;
  const deathDate = person.deathday ? formatDate(person.deathday, lang) : null;
  const age = person.birthday ? calcAge(person.birthday, person.deathday) : null;
  // Arabic when the app itself is in Arabic and a translation actually exists - falls back to
  // the English one rather than showing nothing for a person whose bio hasn't been translated
  // yet (translateBiographyToArabic runs server-side per person, not on demand here).
  const bio = (lang === "ar" ? person.biographyAr : null)?.trim() || person.biography?.trim();

  // Chunked into rows once here - see BrowseScreen's own identical `rows` for why (rowOffsets
  // above needs a real component per row to measure its own absolute position from).
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
      {/* The photo/name header used to be a sibling *outside* the scrollable grid, so only the
          grid itself scrolled internally in its own confined area while the header stayed
          pinned in place - it never moved even as the viewer scrolled through the filmography.
          It's a normal child of this same ScrollView now (see gridScrollRef's own comment above
          for why that also removes the need for a separate headerHeightRef), so scrolling
          carries the header away with everything else instead of leaving it fixed. Back is
          handled by the remote's own back button (see the BackHandler above) - no on-screen
          back button needed, matching the details screen. */}
      <ScrollView ref={gridScrollRef} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View>
            <View style={styles.header}>
              <View style={styles.avatar}>
                {person.photoUrl ? (
                  <Image source={{ uri: posterUrl(person.photoUrl, "w342") }} style={styles.avatarImg} fadeDuration={0} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarInitial}>{person.name?.[0] ?? "?"}</Text>
                  </View>
                )}
              </View>
              {/* Name (and facts row) beside the photo instead of centered underneath it. */}
              <View style={styles.headerText}>
                <Text style={styles.name}>{person.name}</Text>
                {(!!birthDate || age != null || !!deathDate || !!person.placeOfBirth || !!person.role) && (
                  <View style={styles.factsRow}>
                    {!!birthDate && (
                      <View style={styles.factPill}>
                        <Text style={styles.factPillText}>{lang === "ar" ? `وُلد في ${birthDate}` : `Born ${birthDate}`}</Text>
                      </View>
                    )}
                    {!!deathDate && (
                      <View style={styles.factPill}>
                        <Text style={styles.factPillText}>{lang === "ar" ? `توفي في ${deathDate}` : `Died ${deathDate}`}</Text>
                      </View>
                    )}
                    {age != null && (
                      <View style={styles.factPill}>
                        <Text style={styles.factPillText}>
                          {deathDate
                            ? lang === "ar" ? `توفي عن عمر ${age} سنة` : `Died at ${age}`
                            : lang === "ar" ? `${age} سنة` : `${age} years old`}
                        </Text>
                      </View>
                    )}
                    {!!person.placeOfBirth && (
                      <View style={styles.factPill}>
                        <Text style={styles.factPillText}>{person.placeOfBirth}</Text>
                      </View>
                    )}
                    {!birthDate && !person.placeOfBirth && !!person.role && (
                      <View style={styles.factPill}>
                        <Text style={styles.factPillText}>{person.role}</Text>
                      </View>
                    )}
                  </View>
                )}
                {!!bio && (
                  <View style={styles.bioBlock}>
                    <Text numberOfLines={bioExpanded ? undefined : 3} style={styles.bioText}>
                      {bio}
                    </Text>
                    <Focusable onPress={() => setBioExpanded((v) => !v)} scaleTo={1.03}>
                      {(focused: boolean) => (
                        <Text style={[styles.readMore, focused && styles.readMoreFocused]}>
                          {bioExpanded ? (lang === "ar" ? "عرض أقل" : "Show Less") : lang === "ar" ? "قراءة المزيد" : "Read More"}
                        </Text>
                      )}
                    </Focusable>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.divider} />
            <View style={styles.filmographyHeader}>
              <View style={styles.sectionTitleRow}>
                <View style={styles.sectionTitleBar} />
                <Text style={styles.sectionTitle}>{lang === "ar" ? "الأعمال" : "Filmography"}</Text>
              </View>
              <View style={styles.typeFilterRow}>
                {movieCount > 0 && (
                  <Focusable onPress={() => setTypeFilter("movie")} scaleTo={1.05} hasTVPreferredFocus={typeFilter === "movie"}>
                    {(focused: boolean) => (
                      // No focusShadowTight - filterPillFocused already turns this solid white,
                      // and a white glow behind an already-white fill is redundant at best
                      // (rendered as a visible hatch artifact on at least one real device).
                      <View style={[styles.filterPill, typeFilter === "movie" && !focused && styles.filterPillActive, focused && styles.filterPillFocused]}>
                        <Text style={[styles.filterPillText, typeFilter === "movie" && styles.filterPillTextActive, focused && styles.filterPillTextFocused]}>
                          {t("movies", lang)}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                )}
                {seriesCount > 0 && (
                  <Focusable onPress={() => setTypeFilter("series")} scaleTo={1.05} hasTVPreferredFocus={typeFilter === "series" && movieCount === 0}>
                    {(focused: boolean) => (
                      <View style={[styles.filterPill, typeFilter === "series" && !focused && styles.filterPillActive, focused && styles.filterPillFocused]}>
                        <Text style={[styles.filterPillText, typeFilter === "series" && styles.filterPillTextActive, focused && styles.filterPillTextFocused]}>
                          {t("series", lang)}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                )}
              </View>
            </View>
        </View>

        {rows.map((rowItems, rowIndex) => (
          <Row
            key={rowIndex}
            items={rowItems}
            rowIndex={rowIndex}
            lang={lang}
            onSelect={onSelectMovie}
            onCardFocusChange={handleCardFocusChange}
            onRowLayout={onRowLayout}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// See BrowseScreen's own identical Row component for the full reasoning (a real component per
// row, not inlined in this screen's own .map(), so onLayout can report that specific row's
// absolute position and so React.memo has stable props to compare against).
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
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingRight: s(24), paddingBottom: s(40) },
  row: { flexDirection: "row", paddingLeft: spacing.contentStart, marginBottom: ROW_GAP },
  // Side-by-side (photo at the edge, name/facts/bio beside it) instead of centered and stacked.
  header: { flexDirection: "row", gap: s(24), paddingTop: s(48), paddingLeft: spacing.contentStart, paddingRight: s(48) },
  headerText: { flex: 1, gap: s(12), paddingTop: s(4) },
  // A perfect circle, matching the referenced design - TMDB headshots are portrait (taller than
  // wide), so a plain `cover` fit inside a square would crop evenly off both top and bottom.
  // Sizing the image *taller* than the circle and pinning it to top:0 (the same trick the
  // HomeScreen hero backdrop uses for its own crop-only-from-the-bottom requirement) biases
  // that crop toward keeping the top of the head instead of losing it evenly with the chin.
  avatar: { width: s(150), height: s(150), borderRadius: s(75), overflow: "hidden", backgroundColor: colors.cardBg, borderWidth: 3, borderColor: "rgba(255,255,255,0.15)" },
  avatarImg: { position: "absolute", top: 0, left: 0, right: 0, width: "100%", aspectRatio: 3 / 4 },
  avatarPlaceholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#27272a" },
  avatarInitial: { color: "#fff", fontSize: fs(44), fontFamily: font.black },
  name: { color: "#fff", fontSize: fs(28), fontFamily: font.black },
  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: s(8) },
  factPill: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 999, paddingHorizontal: s(14), paddingVertical: s(7) },
  factPillText: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold },
  bioBlock: { maxWidth: s(760), gap: s(6), marginTop: s(2) },
  bioText: { color: colors.textSecondary, fontSize: fs(13), lineHeight: fs(20), fontFamily: font.semiBold },
  readMore: { color: colors.textFaint, fontSize: fs(12), fontFamily: font.bold },
  readMoreFocused: { color: "#fff", textDecorationLine: "underline" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginTop: s(32), marginBottom: s(16), marginLeft: spacing.contentStart },
  filmographyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: s(16),
    marginLeft: spacing.contentStart,
    marginRight: s(32),
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: s(8) },
  sectionTitleBar: { width: s(5), height: s(18), borderRadius: 3, backgroundColor: "#fff" },
  sectionTitle: { color: "#fff", fontSize: fs(17), fontFamily: font.bold },
  typeFilterRow: { flexDirection: "row", gap: s(8) },
  filterPill: {
    paddingHorizontal: s(16),
    paddingVertical: s(9),
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
  },
  filterPillActive: { backgroundColor: "rgba(255,255,255,0.14)", borderColor: "rgba(255,255,255,0.3)" },
  filterPillFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  filterPillText: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold },
  filterPillTextActive: { color: "#fff" },
  filterPillTextFocused: { color: "#000" },
});
