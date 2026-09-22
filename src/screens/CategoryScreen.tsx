import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Dimensions, ActivityIndicator } from "react-native";
import type { Category, Movie } from "../api";
import MovieCard, { CARD_TOTAL_WIDTH } from "../components/MovieCard";
import { colors, font, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, pickText } from "../i18n";
import { pushBackHandler } from "../backStack";

// Same full-width grid maths as PersonScreen/BrowseScreen: as many columns as the screen actually fits.
const GRID_END_PADDING = s(24);
const NUM_COLUMNS = Math.max(
  4,
  Math.floor((Dimensions.get("window").width - spacing.contentStart - GRID_END_PADDING) / CARD_TOTAL_WIDTH)
);
const ROW_GAP = s(26);
// Only the rows near the focused one decode their poster (the grid itself keeps every row mounted so
// D-pad navigation stays exact - see PersonScreen/BrowseScreen for why the scroll container is never virtualised).
const IMAGE_REVEAL_RADIUS = 3;

interface Props {
  category: Category;
  lang: Lang;
  onSelectMovie: (movie: Movie) => void;
  onBack: () => void;
}

// The "View more" screen behind a home row: every title in that list, as a grid. Built exactly like
// PersonScreen's filmography grid - a plain ScrollView of measured rows, a scrollTo that follows focus,
// and no interception of the D-pad at all.
export default function CategoryScreen({ category, lang, onSelectMovie, onBack }: Props) {
  // A row that already carries all its items shows them at once; a built-in row starts from the head it
  // already has and swaps in the fuller list once that arrives.
  const [items, setItems] = useState<Movie[]>(category.items);
  const [loading, setLoading] = useState(!!category.loadAll);
  const [focusedRow, setFocusedRow] = useState(0);

  useEffect(() => {
    if (!category.loadAll) return;
    let cancelled = false;
    category
      .loadAll()
      .then((all) => {
        if (!cancelled && all.length > 0) setItems(all);
      })
      .catch((err) => console.error("[CategoryScreen] loadAll failed:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  useEffect(() => {
    return pushBackHandler(() => {
      onBack();
      return true;
    }, "CategoryScreen");
  }, [onBack]);

  const gridScrollRef = useRef<any>(null);
  const rowOffsets = useRef<number[]>([]);
  const lastScrolledRow = useRef<number | null>(null);
  const scrollToRow = useCallback((row: number) => {
    if (lastScrolledRow.current === row) return;
    lastScrolledRow.current = row;
    setFocusedRow(row);
    const y = rowOffsets.current[row];
    if (y != null) gridScrollRef.current?.scrollTo({ y: Math.max(0, y - ROW_GAP), animated: true });
  }, []);
  const onRowLayout = useCallback((rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => {
    rowOffsets.current[rowIndex] = e.nativeEvent.layout.y;
  }, []);
  const handleCardFocusChange = useCallback(
    (rowIndex: number, focused: boolean) => {
      if (focused) scrollToRow(rowIndex);
    },
    [scrollToRow]
  );

  const rows = useMemo(() => {
    const out: Movie[][] = [];
    for (let i = 0; i < items.length; i += NUM_COLUMNS) out.push(items.slice(i, i + NUM_COLUMNS));
    return out;
  }, [items]);

  return (
    <View style={styles.root}>
      <ScrollView ref={gridScrollRef} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.titleBar} />
          <Text style={styles.title}>{pickText(category.titleAr, category.titleEn, lang)}</Text>
          <Text style={styles.count}>{lang === "ar" ? `${items.length} عمل` : `${items.length} titles`}</Text>
          {loading && <ActivityIndicator color="#fff" size="small" />}
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
            revealImages={Math.abs(rowIndex - focusedRow) <= IMAGE_REVEAL_RADIUS}
            firstRow={rowIndex === 0}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const Row = React.memo(function Row({
  items,
  rowIndex,
  lang,
  onSelect,
  onCardFocusChange,
  onRowLayout,
  revealImages,
  firstRow,
}: {
  items: Movie[];
  rowIndex: number;
  lang: Lang;
  onSelect: (movie: Movie) => void;
  onCardFocusChange: (rowIndex: number, focused: boolean) => void;
  onRowLayout: (rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => void;
  revealImages: boolean;
  firstRow: boolean;
}) {
  return (
    <View style={styles.row} onLayout={(e) => onRowLayout(rowIndex, e)}>
      {items.map((movie, i) => (
        <MovieCard
          key={movie.id}
          movie={movie}
          lang={lang}
          onSelect={onSelect}
          onFocusChange={(f) => onCardFocusChange(rowIndex, f)}
          showImage={revealImages}
          hasTVPreferredFocus={firstRow && i === 0}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingRight: s(24), paddingBottom: s(40) },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
    paddingTop: s(48),
    paddingLeft: spacing.contentStart,
    marginBottom: s(20),
  },
  titleBar: { width: s(5), height: s(24), borderRadius: 3, backgroundColor: "#fff" },
  title: { color: "#fff", fontSize: fs(24), fontFamily: font.black },
  count: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold, marginLeft: s(8) },
  row: { flexDirection: "row", paddingLeft: spacing.contentStart, marginBottom: ROW_GAP },
});
