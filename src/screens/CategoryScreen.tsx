import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { Category, Movie } from "../api";
import MovieCard from "../components/MovieCard";
import { colors, font, SIDEBAR_LOGO } from "../theme";
import { GRID_START, NUM_COLUMNS, CARD_WIDTH_FILL } from "../gridLayout";
import { useSidebarHomeHandle } from "../focusRefs";
import { s, fs } from "../scale";
import { Lang, pickText } from "../i18n";
import { pushBackHandler } from "../backStack";

// Same grid as Movies/Series (gridLayout.ts): same column count and card size, filling the row.
const ROW_GAP = s(26);
// Only the rows near the focused one decode their poster (the grid itself keeps every row mounted so
// D-pad navigation stays exact - see PersonScreen/BrowseScreen for why the scroll container is never virtualised).
const IMAGE_REVEAL_RADIUS = 3;
// See renderedRowCount's own comment below - same fix, same reasoning as BrowseScreen's identical constants.
const INITIAL_ROWS = 6;
const ROWS_PER_BATCH = 6;
const SCROLL_END_THRESHOLD = 1200;

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
  // The sidebar stays visible next to this page now (see App.tsx) - LEFT from the first column
  // goes to it, same as Movies/Series.
  const homeHandle = useSidebarHomeHandle();

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

  // `items` can jump from a short head (~20) to the full list (up to 100) in one synchronous state
  // update the instant loadAll() resolves - up to ~17 rows' worth of real MovieCard components
  // (Focusable + gradient + Image each) mounting all at once, reported as the app freezing and
  // exiting outright right after this screen was added. Same fix, same reasoning as BrowseScreen's
  // own renderedRowCount: cap how many rows actually mount at first, growing in batches as the
  // viewer scrolls further - it only ever grows, never shrinks, so a row already mounted (and thus
  // already measured via its own onLayout) is never later unmounted from under scrollToRow.
  const [renderedRowCount, setRenderedRowCount] = useState(INITIAL_ROWS);
  useEffect(() => {
    setRenderedRowCount(INITIAL_ROWS);
  }, [category.id]);
  const renderedRows = rows.length > renderedRowCount ? rows.slice(0, renderedRowCount) : rows;
  const onGridScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height < contentSize.height - SCROLL_END_THRESHOLD) return;
    setRenderedRowCount((n) => (n < rows.length ? n + ROWS_PER_BATCH : n));
  }, [rows.length]);

  return (
    <View style={styles.root}>
      <ScrollView
        ref={gridScrollRef}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={onGridScroll}
        scrollEventThrottle={100}
      >
        <View style={styles.header}>
          <View style={styles.titleBar} />
          <Text style={styles.title}>{pickText(category.titleAr, category.titleEn, lang)}</Text>
          <Text style={styles.count}>{lang === "ar" ? `${items.length} عمل` : `${items.length} titles`}</Text>
          {loading && <ActivityIndicator color="#fff" size="small" />}
        </View>
        {renderedRows.map((rowItems, rowIndex) => (
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
            homeHandle={homeHandle}
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
  homeHandle,
}: {
  items: Movie[];
  rowIndex: number;
  lang: Lang;
  onSelect: (movie: Movie) => void;
  onCardFocusChange: (rowIndex: number, focused: boolean) => void;
  onRowLayout: (rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => void;
  revealImages: boolean;
  firstRow: boolean;
  homeHandle: number | null;
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
          width={CARD_WIDTH_FILL}
          nextFocusLeft={i === 0 ? homeHandle ?? undefined : undefined}
        />
      ))}
    </View>
  );
});

const HEADER_H = s(64);

// Laid out like Movies/Series: content starts at GRID_START (clear of the sidebar), header centered
// on the sidebar logo, same title size.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingLeft: GRID_START },
  listContent: { paddingRight: s(24), paddingBottom: s(40) },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
    height: HEADER_H,
    marginTop: s(SIDEBAR_LOGO.top) + SIDEBAR_LOGO.height / 2 - HEADER_H / 2,
    marginBottom: s(10),
  },
  titleBar: { width: s(5), height: s(20), borderRadius: 3, backgroundColor: "#fff" },
  title: { color: "#fff", fontSize: fs(18), fontFamily: font.bold },
  count: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold, marginLeft: s(8) },
  row: { flexDirection: "row", marginBottom: ROW_GAP },
});
