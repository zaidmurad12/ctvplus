import React, { useEffect, useRef } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet, Animated, useWindowDimensions } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Check, Play } from "lucide-react-native";
import type { Episode, Season } from "../api";
import EpisodeArtwork from "./EpisodeArtwork";
import SeasonButtonFace from "./SeasonButtonFace";
import { colors, font } from "../theme";
import { s, fs } from "../scale";
import { Lang, pickText, upcomingLabel } from "../i18n";

export type EpisodeRowZone = "cards" | "seasonButton" | "seasonPicking";

interface Props {
  season: Season;
  backdrop?: string;
  poster?: string;
  // Which card is highlighted - driven entirely by the parent's own JS state (VideoPlayer's
  // dpadNavActive-routed left/right, same philosophy as the player's other three controls), not
  // real Android focus. There is nothing else in this row for Android's own focus engine to find
  // at all - see the screen-level comment on why that's deliberate.
  activeIndex: number;
  // Where the D-pad is inside the row: on the cards, on the season button, or moving between
  // seasons with up/down after pressing it (see VideoPlayer's onNavKey).
  focusZone: EpisodeRowZone;
  // Which way there is a season to move to. With neither, the button stays a plain label.
  hasPreviousSeason: boolean;
  hasNextSeason: boolean;
  // Fades with the rest of the player's bars (see barsHidden) while open, and unmounts outright
  // on close (select/back) - see VideoPlayerScreen's own closeEpisodeRow.
  hidden: boolean;
  currentEpisodeId?: string;
  resolvingEpisodeId: string | null;
  isEpisodeWatched: (seasonNumber: number, episodeNumber: number) => boolean;
  lang: Lang;
  onSelectEpisode: (episode: Episode) => void;
  // Reports this row's own rendered height once measured, so VideoPlayerScreen can size the
  // shared dark scrim to match instead of guessing a fixed value.
  onHeightChange?: (height: number) => void;
}

const CARD_WIDTH = 286;
const CARD_GAP = 14;
// Widened (was 24) - a focused card's own border had nowhere to grow into right at either edge
// of this row, reading as the highlight getting clipped there (the same fix already applied to
// MovieDetailsScreen's own season/episode/cast rows, which don't share this component).
const LIST_PADDING = 36;
// How far the incoming season's content starts offset (then animates to 0) when switching
// seasons - large enough to read as a deliberate slide, not just a fade.
const SEASON_SLIDE_DISTANCE = 36;
// Only the cards around the highlighted one are built - a long season has hundreds, and building
// them all is what made opening the row and switching seasons slow.
const WINDOW_BEFORE = 6;
const WINDOW_AFTER = 8;
const CARD_BORDER = 2;
const CARD_PADDING = 4;

const EpisodeCard = React.memo(function EpisodeCard({
  ep,
  left,
  backdrop,
  poster,
  isActive,
  isPlayingNow,
  watched,
  resolving,
  lang,
  onSelect,
}: {
  ep: Episode;
  left: number;
  backdrop?: string;
  poster?: string;
  isActive: boolean;
  isPlayingNow: boolean;
  watched: boolean;
  resolving: boolean;
  lang: Lang;
  onSelect: (episode: Episode) => void;
}) {
  return (
    <Pressable style={[styles.cardSlot, { left }]} onPress={() => onSelect(ep)}>
      <View style={[styles.card, (isActive || isPlayingNow) && styles.cardFocused]}>
        <View style={styles.thumbBox}>
          <EpisodeArtwork thumbnail={ep.thumbnail} backdrop={backdrop} poster={poster} />
          {/* The bottom-anchored fade keeps the title readable however bright the artwork is. */}
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.9)"]}
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.numberBadge}>
            <Text style={styles.numberText}>{ep.number}</Text>
          </View>
          {watched && !isPlayingNow && (
            <View style={styles.watchedBadge}>
              <Check size={s(12)} color="#000" strokeWidth={3.5} />
            </View>
          )}
          {/* Keyed off which episode is actually resolving, not the highlighted one: a tapped card
              isn't necessarily the D-pad-highlighted one. */}
          {resolving ? (
            <View style={styles.playOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            !isPlayingNow &&
            isActive &&
            ep.hasPlayableStream && (
              <View style={styles.playOverlay}>
                <Play size={s(22)} color="#fff" fill="#fff" />
              </View>
            )
          )}
          <View style={styles.titleOverlay} pointerEvents="none">
            <Text numberOfLines={1} style={styles.titleOverlayText}>
              {pickText(ep.titleAr, ep.titleEn, lang)}
            </Text>
            {isPlayingNow ? (
              <View style={styles.nowPlayingBadge}>
                <Check size={s(12)} color="#000" strokeWidth={3.5} />
              </View>
            ) : !ep.hasPlayableStream ? (
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>
                  {upcomingLabel(ep.airDate, lang) ?? (lang === "ar" ? "قريبًا" : "Coming Soon")}
                </Text>
              </View>
            ) : (
              !!ep.duration && <Text style={styles.durationTextInline}>{ep.duration}</Text>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
});

// One season at a time, replaced wholesale when the viewer picks another with the season button
// above the cards. The darkening behind this is drawn centrally by VideoPlayerScreen (see its own
// bottomScrim comment). Wrapped in React.memo below: nothing about the list changes on the
// player's own periodic re-renders.
function EpisodeRow({
  season,
  backdrop,
  poster,
  activeIndex,
  focusZone,
  hasPreviousSeason,
  hasNextSeason,
  hidden,
  currentEpisodeId,
  resolvingEpisodeId,
  isEpisodeWatched,
  lang,
  onSelectEpisode,
  onHeightChange,
}: Props) {
  const scrollRef = useRef<any>(null);
  const scrollXRef = useRef(0);
  const previousSeasonIdRef = useRef(season.id);
  const { width: viewportWidth } = useWindowDimensions();

  useEffect(() => {
    if (previousSeasonIdRef.current !== season.id) {
      previousSeasonIdRef.current = season.id;
      scrollXRef.current = 0;
      scrollRef.current?.scrollTo({ x: 0, animated: false });
      return;
    }

    const cardLeft = s(LIST_PADDING) + activeIndex * (s(CARD_WIDTH) + s(CARD_GAP));
    const cardRight = cardLeft + s(CARD_WIDTH);
    const visibleLeft = scrollXRef.current + s(LIST_PADDING);
    const visibleRight = scrollXRef.current + viewportWidth - s(LIST_PADDING);
    let nextX = scrollXRef.current;
    if (cardLeft < visibleLeft) nextX = Math.max(0, cardLeft - s(LIST_PADDING));
    else if (cardRight > visibleRight) nextX = cardRight - viewportWidth + s(LIST_PADDING);

    // Keep focus movement inside the visible cards free of scroll animation. Only scroll at the
    // row edges, so held D-pad input doesn't queue a separate full-card animation per press.
    if (nextX !== scrollXRef.current) {
      scrollXRef.current = nextX;
      scrollRef.current?.scrollTo({ x: nextX, animated: true });
    }
  }, [activeIndex, season.id, viewportWidth]);

  // Slides the whole card row in from below (moving to a later/"down" season) or from above
  // (moving to an earlier/"up" one) instead of just hard-cutting to the new season's cards -
  // requested as a smooth, directional transition between seasons.
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevSeasonNumberRef = useRef(season.number);
  useEffect(() => {
    const prev = prevSeasonNumberRef.current;
    prevSeasonNumberRef.current = season.number;
    if (prev === season.number) return;
    const direction = season.number > prev ? 1 : -1;
    slideAnim.setValue(direction * s(SEASON_SLIDE_DISTANCE));
    fadeAnim.setValue(0.3);
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.number]);

  const count = season.episodes.length;
  const step = s(CARD_WIDTH) + s(CARD_GAP);
  const windowStart = Math.max(0, activeIndex - WINDOW_BEFORE);
  const windowEnd = Math.min(count, activeIndex + WINDOW_AFTER + 1);

  return (
    <View
      style={[styles.wrap, hidden && styles.hiddenWrap]}
      pointerEvents={hidden ? "none" : "box-none"}
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
    >
      <View style={styles.seasonPicker} pointerEvents="none">
        <SeasonButtonFace
          season={season}
          lang={lang}
          focused={focusZone !== "cards" && (hasPreviousSeason || hasNextSeason)}
          active={focusZone === "seasonPicking"}
        />
      </View>
      <Animated.View style={{ transform: [{ translateY: slideAnim }], opacity: fadeAnim }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
          contentContainerStyle={styles.list}
        >
          <View style={[styles.track, { width: Math.max(0, count * step - s(CARD_GAP)) }]}>
            {season.episodes.slice(windowStart, windowEnd).map((ep, offset) => {
              const i = windowStart + offset;
              return (
                <EpisodeCard
                  key={ep.id}
                  ep={ep}
                  left={i * step}
                  backdrop={backdrop}
                  poster={poster}
                  isActive={i === activeIndex && focusZone === "cards"}
                  isPlayingNow={ep.id === currentEpisodeId}
                  watched={isEpisodeWatched(season.number, ep.number)}
                  resolving={resolvingEpisodeId === ep.id}
                  lang={lang}
                  onSelect={onSelectEpisode}
                />
              );
            })}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

export default React.memo(EpisodeRow);

const thumbHeight = ((s(CARD_WIDTH) - 2 * (s(CARD_PADDING) + CARD_BORDER)) * 9) / 16;

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: s(38), paddingBottom: s(28), paddingTop: s(28) },
  hiddenWrap: { opacity: 0 },
  seasonPicker: { alignSelf: "flex-start", marginLeft: s(LIST_PADDING), marginBottom: s(16) },
  list: { paddingHorizontal: s(LIST_PADDING) },
  track: { height: thumbHeight + 2 * (s(CARD_PADDING) + CARD_BORDER) },
  cardSlot: { position: "absolute", top: 0 },
  // No gap/padding for a second child anymore - the title used to be a separate line below the
  // thumbnail (this card's own padding gave it room); now everything lives on the thumbnail
  // itself (see thumbBox's own children), so this card is just a bordered frame around it.
  card: {
    width: s(CARD_WIDTH),
    padding: s(CARD_PADDING),
    borderRadius: s(10),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: CARD_BORDER,
    borderColor: "transparent",
  },
  cardFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
  thumbBox: { width: "100%", aspectRatio: 16 / 9, borderRadius: s(6), overflow: "hidden", backgroundColor: "#000" },
  numberBadge: {
    position: "absolute",
    top: s(6),
    left: s(6),
    backgroundColor: "rgba(0,0,0,0.75)",
    minWidth: s(28),
    height: s(28),
    borderRadius: s(14),
    paddingHorizontal: s(4),
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { color: "#fff", fontSize: fs(14), fontFamily: font.black },
  watchedBadge: {
    position: "absolute",
    top: s(6),
    right: s(6),
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  // Plain inline text now (was its own absolutely-positioned corner badge) - it sits in
  // titleOverlay's own row below, beside the title, not floating independently over the artwork.
  durationTextInline: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold },
  // comingSoonBadge/nowPlayingBadge: no longer position:"absolute" (they used to float in their
  // own bottom corner) - both are inline children of titleOverlay's own row now, beside the title
  // text, since that row is where "what's happening with this episode" already lives.
  comingSoonBadge: {
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  comingSoonText: { color: colors.textSecondary, fontSize: fs(10), fontFamily: font.bold },
  playOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  // A compact pill (was a full-width bar across the bottom of the thumbnail, which covered a
  // chunk of the actual image) - filled white to read as "active" the same way cardFocused's own
  // white border and the season indicator's focused fill do.
  nowPlayingBadge: {
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  // Pinned to the thumbnail's own bottom edge (was a separate line of text below the whole card)
  // - see thumbBox's own LinearGradient for the fade this now sits on top of. Title takes
  // whatever width the trailing status (duration/coming-soon/now-playing) doesn't need, so a long
  // title ellipsizes there instead of overlapping it.
  titleOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(6),
    paddingHorizontal: s(8),
    paddingVertical: s(6),
  },
  titleOverlayText: { flex: 1, color: "#fff", fontSize: fs(12), fontFamily: font.bold },
});
