import React, { useRef } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import type { Movie } from "../api";
import MovieCard from "../components/MovieCard";
import { colors, font, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, t } from "../i18n";

interface Props {
  lang: Lang;
  watchLater: Movie[];
  history: Movie[];
  onSelect: (movie: Movie) => void;
}

const RAIL_TOP_PADDING = 28;

// Watch Later and Watch History used to be two separate sidebar sections/screens for what is,
// from the viewer's point of view, the same idea: "things I've already engaged with". One
// screen with both rails stacked (same rail layout HomeScreen already uses) reads as a single
// library instead of two half-empty screens to check separately.
export default function LibraryScreen({ lang, watchLater, history, onSelect }: Props) {
  // Jumps this screen to reveal a whole rail the instant focus enters it, in one press either
  // direction - the same "drive the scroll ourselves instead of trusting Android's own minimal
  // auto-adjust" fix HomeScreen's own rails already rely on (see its scrollToRail), applied here
  // since this screen's two rails used to rely entirely on that default behavior instead.
  const scrollRef = useRef<any>(null);
  const railOffsets = useRef<number[]>([]);
  const lastScrolledTo = useRef<string | null>(null);
  const scrollToRail = (index: number) => {
    const name = `rail-${index}`;
    if (lastScrolledTo.current === name) return;
    lastScrolledTo.current = name;
    const y = railOffsets.current[index];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - RAIL_TOP_PADDING), animated: true });
  };

  return (
    <ScrollView ref={scrollRef} style={styles.root} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} scrollsChildToFocus={false}>
      <Text style={styles.pageTitle}>{t("library", lang)}</Text>

      <Rail
        title={t("favorites", lang)}
        items={watchLater}
        emptyLabel={t("emptyWatchLater", lang)}
        lang={lang}
        onSelect={onSelect}
        onLayout={(y) => { railOffsets.current[0] = y; }}
        onFocusChange={() => scrollToRail(0)}
      />
      <Rail
        title={t("history", lang)}
        items={history}
        emptyLabel={t("emptyHistory", lang)}
        lang={lang}
        onSelect={onSelect}
        onLayout={(y) => { railOffsets.current[1] = y; }}
        onFocusChange={() => scrollToRail(1)}
      />
    </ScrollView>
  );
}

function Rail({
  title,
  items,
  emptyLabel,
  lang,
  onSelect,
  onLayout,
  onFocusChange,
}: {
  title: string;
  items: Movie[];
  emptyLabel: string;
  lang: Lang;
  onSelect: (movie: Movie) => void;
  onLayout: (y: number) => void;
  onFocusChange: () => void;
}) {
  return (
    <View style={styles.railBlock} onLayout={(e) => onLayout(e.nativeEvent.layout.y)}>
      <View style={styles.railTitleRow}>
        <View style={styles.railTitleBar} />
        <Text style={styles.railTitle}>{title}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      ) : (
        <View style={styles.railClip}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
            {items.map((movie) => (
              <MovieCard key={movie.id} movie={movie} lang={lang} onSelect={onSelect} onFocusChange={(f) => f && onFocusChange()} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // paddingTop lowered (was 44) - per explicit request, to match BrowseScreen's own headerRow
  // level (see its own comment) - keeps every sidebar-adjacent screen's title at the same height.
  content: { paddingTop: s(30), paddingBottom: s(40) },
  pageTitle: { color: "#fff", fontSize: fs(24), fontFamily: font.black, marginLeft: spacing.contentStart, marginBottom: s(28) },
  railBlock: { marginBottom: s(30) },
  railTitleRow: { flexDirection: "row", alignItems: "center", gap: s(8), marginLeft: spacing.contentStart, marginBottom: s(10) },
  railTitleBar: { width: s(5), height: s(15), borderRadius: 3, backgroundColor: "#fff" },
  railTitle: { color: "#fff", fontSize: fs(15), fontFamily: font.bold },
  railClip: { marginLeft: spacing.sidebarWidth, overflow: "hidden" },
  railContent: { paddingLeft: spacing.contentStart - spacing.sidebarWidth, paddingRight: s(24), paddingVertical: s(16) },
  emptyText: { color: colors.textMuted, fontSize: fs(14), fontFamily: font.semiBold, marginLeft: spacing.contentStart },
});
