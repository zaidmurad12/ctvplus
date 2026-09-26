import React, { useEffect, useRef } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, Pressable, StyleSheet, Animated } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { Check, Play, ChevronUp, ChevronDown } from "lucide-react-native";
import type { Episode, Season } from "../api";
import { posterUrl } from "../api";
import { colors, font } from "../theme";
import { s, fs } from "../scale";
import { Lang, pickText, upcomingLabel } from "../i18n";

interface Props {
  season: Season;
  // Which card is highlighted - driven entirely by the parent's own JS state (VideoPlayer's
  // dpadNavActive-routed left/right, same philosophy as the player's other three controls), not
  // real Android focus. There is nothing else in this row for Android's own focus engine to find
  // at all - see the screen-level comment on why that's deliberate.
  activeIndex: number;
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

const CARD_WIDTH = 250;
const CARD_GAP = 14;
// Widened (was 24) - a focused card's own border had nowhere to grow into right at either edge
// of this row, reading as the highlight getting clipped there (the same fix already applied to
// MovieDetailsScreen's own season/episode/cast rows, which don't share this component).
const LIST_PADDING = 36;
// How far the incoming season's content starts offset (then animates to 0) when switching
// seasons - large enough to read as a deliberate slide, not just a fade.
const SEASON_SLIDE_DISTANCE = 36;

// The single always-visible-while-open row this got redesigned into (see VideoPlayer's own
// comment on the season-switching state machine) - literally one season at a time, replaced
// wholesale (not appended below) when the viewer moves to another one via up/down directly (a
// separate focusable season button that had to be selected before it would respond to up/down was
// tried and dropped - it looked and felt worse than just switching immediately). The darkening
// behind this is drawn centrally by VideoPlayerScreen (see its own bottomScrim comment) - one
// continuous scrim, not a separate gradient owned by this component.
// Wrapped in React.memo below - VideoPlayer re-renders roughly 4x/second during normal playback
// (an un-throttled cueText update, for subtitle timing accuracy - see its own comment), which
// without a memo boundary here was fully re-mapping and re-mounting-in-place every episode card
// in this row (Image, LinearGradient, Pressable each) on every one of those ticks whenever the
// episode switcher happened to be open, for no reason - nothing about the episode list itself was
// changing. Real, measurable cost matching "the app became heavy," not a micro-optimization.
function EpisodeRow({
  season,
  activeIndex,
  hidden,
  currentEpisodeId,
  resolvingEpisodeId,
  isEpisodeWatched,
  lang,
  onSelectEpisode,
  onHeightChange,
}: Props) {
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    const x = Math.max(0, LIST_PADDING + activeIndex * (s(CARD_WIDTH) + s(CARD_GAP)) - s(24));
    scrollRef.current?.scrollTo({ x, animated: true });
  }, [activeIndex, season.id]);

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

  return (
    <View
      style={[styles.wrap, hidden && styles.hiddenWrap]}
      pointerEvents={hidden ? "none" : "box-none"}
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
    >
      {/* Purely informational, not itself focusable/selectable - up/down switch the season
          directly while browsing the cards below (see VideoPlayer's onNavKey), this just tells
          the viewer that's possible and which season is currently showing. */}
      <View style={styles.seasonIndicator} pointerEvents="none">
        <ChevronUp size={s(16)} color="#fff" strokeWidth={2.5} />
        <Text style={styles.seasonIndicatorText}>
          {lang === "ar" ? `الموسم ${season.number}` : `Season ${season.number}`}
        </Text>
        <ChevronDown size={s(16)} color="#fff" strokeWidth={2.5} />
      </View>
      <Animated.View style={{ transform: [{ translateY: slideAnim }], opacity: fadeAnim }}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEnabled={false}
          contentContainerStyle={styles.list}
        >
          {season.episodes.map((ep, i) => {
            const isActive = i === activeIndex;
            const isPlayingNow = ep.id === currentEpisodeId;
            const watched = isEpisodeWatched(season.number, ep.number);
            return (
              <Pressable key={ep.id} onPress={() => onSelectEpisode(ep)}>
                <View style={[styles.card, (isActive || isPlayingNow) && styles.cardFocused]}>
                  <View style={styles.thumbBox}>
                    <Image source={{ uri: posterUrl(ep.thumbnail, "w342") }} style={styles.thumb} fadeDuration={0} />
                    {/* The episode title used to be its own line of text below this whole card -
                        merged into the thumbnail itself per explicit request, the same overlay
                        recipe MovieCard/RecentCard's own title treatment already uses elsewhere -
                        a bottom-anchored gradient so the title stays readable over the artwork
                        regardless of how bright it is, rather than a plain title sitting in dead
                        space under the card. */}
                    <LinearGradient
                      colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.9)"]}
                      locations={[0, 0.45, 1]}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                    <View style={styles.numberBadge}>
                      <Text style={styles.numberText}>E{ep.number}</Text>
                    </View>
                    {watched && !isPlayingNow && (
                      <View style={styles.watchedBadge}>
                        <Check size={s(12)} color="#000" strokeWidth={3.5} />
                      </View>
                    )}
                    {/* resolvingEpisodeId is checked before isPlayingNow/isActive - pressing a
                        card is what sets it (see VideoPlayer's selectEpisodeInPlayer), and a
                        tapped card isn't necessarily the D-pad-highlighted one, so the spinner
                        has to key off which episode is actually resolving, not which one merely
                        looks focused right now. */}
                    {resolvingEpisodeId === ep.id ? (
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
                        // A check mark on the episode that's playing (was a "Now Playing" pill), per
                        // request - the same white circle as the watched badge.
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
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

export default React.memo(EpisodeRow);

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: s(28), paddingTop: s(28) },
  hiddenWrap: { opacity: 0 },
  seasonIndicator: { alignItems: "center", marginLeft: s(LIST_PADDING), marginBottom: s(14), gap: s(2) },
  seasonIndicatorText: { color: "#fff", fontSize: fs(13), fontFamily: font.bold, marginVertical: s(1) },
  list: { gap: s(CARD_GAP), paddingHorizontal: s(LIST_PADDING) },
  // No gap/padding for a second child anymore - the title used to be a separate line below the
  // thumbnail (this card's own padding gave it room); now everything lives on the thumbnail
  // itself (see thumbBox's own children), so this card is just a bordered frame around it.
  card: {
    width: s(CARD_WIDTH),
    padding: s(4),
    borderRadius: s(10),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 2,
    borderColor: "transparent",
  },
  cardFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.1)" },
  thumbBox: { width: "100%", aspectRatio: 16 / 9, borderRadius: s(6), overflow: "hidden", backgroundColor: "#000" },
  thumb: { width: "100%", height: "100%" },
  numberBadge: {
    position: "absolute",
    top: s(6),
    left: s(6),
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  numberText: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
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
  durationTextInline: { color: colors.textSecondary, fontSize: fs(11), fontFamily: font.bold },
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
