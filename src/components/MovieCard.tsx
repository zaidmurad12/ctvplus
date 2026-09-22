import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import type { Movie } from "../api";
import { posterUrl } from "../api";
import Focusable from "./Focusable";
import { colors, font, focusShadowTight } from "../theme";
import { s, fs } from "../scale";
import { Lang, pickText } from "../i18n";

const CARD_WIDTH = s(128);

// Card width + its own horizontal margins - grids that need to know how many columns fit a
// given row width (BrowseScreen, SearchScreen) import this instead of guessing/duplicating it.
export const CARD_TOTAL_WIDTH = CARD_WIDTH + s(16);

interface Props {
  movie: Movie;
  lang?: Lang;
  onSelect: (movie: Movie) => void;
  onFocusChange?: (focused: boolean) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  // Lets a long row (see useProgressiveReveal) hold this card's spot - frame, border, focus
  // routing, everything - without yet firing its Image's own network request. Defaults to true
  // so every other call site (grids, single cards) is unaffected.
  showImage?: boolean;
  hasTVPreferredFocus?: boolean;
}

const MovieCard = React.forwardRef<View, Props>(function MovieCard(
  { movie, lang = "ar", onSelect, onFocusChange, nextFocusLeft, nextFocusRight, nextFocusUp, showImage = true, hasTVPreferredFocus },
  ref
) {
  return (
    <Focusable
      ref={ref}
      onPress={() => onSelect(movie)}
      onFocusChange={onFocusChange}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      nextFocusUp={nextFocusUp}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={styles.card}
      // No scale-on-focus (was 1.045) - per explicit request, to cut the animation work this
      // fires on every single focus change while browsing a grid/rail. posterFrameFocused's own
      // white border (below) already carries the focus indicator on its own, same reasoning
      // HomeScreen's own RecentCard already uses for dropping its scale.
      scaleTo={1}
      focusRadius={s(8)}
    >
      {(focused: boolean) => (
        <>
          {/* Border lives on a frame with no clipping of its own - a border drawn on the
              same view as overflow:hidden + borderRadius, combined with the focus scale
              transform, was rendering with one edge missing on some devices (the side the
              transform's rounding happened to shortchange). The image's own rounded clip is
              now a separate inner view that only masks the image, never the border. */}
          <View style={[styles.posterFrame, focused && styles.posterFrameFocused, focused && focusShadowTight]}>
            <View style={styles.posterClip}>
              {showImage && (
                <Image source={{ uri: posterUrl(movie.poster || movie.backdrop, "w342") }} style={styles.poster} fadeDuration={0} />
              )}
              {!!movie.partNumber && (
                <View style={styles.partBadge}>
                  <Text style={styles.partBadgeText}>{movie.partNumber}</Text>
                </View>
              )}
            </View>
          </View>
          <Text numberOfLines={1} style={[styles.title, focused && styles.titleFocused]}>
            {pickText(movie.titleAr, movie.titleEn, lang)}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.imdbBadge}>
              <Text style={styles.imdbBadgeText}>IMDb</Text>
            </View>
            <Text style={styles.rating}>{movie.rating}</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.year}>{movie.year}</Text>
          </View>
        </>
      )}
    </Focusable>
  );
});

const styles = StyleSheet.create({
  // Split evenly (not marginRight-only) so the *first* card in a row also gets a buffer on
  // its own leading edge, not just a gap after it - a scaled-up focused card sitting flush
  // against x=0 with zero margin of its own had nowhere to grow into on that side and read
  // as clipped exactly there, consistently, on every screen with a horizontal card row
  // (rails, grids, filmography). Two adjacent cards' margins don't collapse in RN flexbox
  // the way CSS block margins do, so the *visible gap between* cards is unchanged (8+8=16,
  // same as the old marginRight: 16) - only the outer edges gained breathing room.
  card: { width: CARD_WIDTH, marginHorizontal: s(8) },
  posterFrame: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: s(8),
    borderWidth: 2,
    borderColor: "#0d0d0d",
    backgroundColor: colors.cardBg,
  },
  posterFrameFocused: { borderColor: "#fff" },
  posterClip: { flex: 1, borderRadius: s(6), overflow: "hidden" },
  poster: { width: "100%", height: "100%" },
  // Just the numeral, not a wordy "Part N" pill - that read as clutter on a poster this small.
  // A solid accent-red floating circle (an earlier revision of this exact badge) read as loud
  // and cartoonish rather than "elegant" as explicitly asked for - clashing with accentRed's own
  // established meaning elsewhere (the favorite heart's active state) and sitting oddly detached
  // from the poster itself. A flush corner tag instead - zero-offset into the actual corner,
  // sharing posterClip's own radius on the two outer corners so it reads as part of the image's
  // own frame, not an unrelated sticker floating on top of it - with a neutral dark glass fill
  // (works over any poster's own colors) and only a hairline top+right border to suggest a
  // corner-tag edge instead of a heavy full outline.
  partBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    minWidth: s(22),
    paddingHorizontal: s(7),
    paddingVertical: s(3),
    borderTopRightRadius: s(9),
    borderBottomLeftRadius: s(6),
    backgroundColor: "rgba(0,0,0,0.82)",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  partBadgeText: { color: "#fff", fontSize: fs(12), fontFamily: font.black, letterSpacing: 0.2 },
  title: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.semiBold, marginTop: s(8) },
  titleFocused: { color: "#fff" },
  metaRow: { flexDirection: "row", gap: s(6), marginTop: s(4), alignItems: "center" },
  // paddingVertical: 1 previously made this read as tall/bulky relative to its own text.
  imdbBadge: { backgroundColor: colors.imdbYellow, borderRadius: 3, paddingHorizontal: s(4), paddingVertical: 0 },
  imdbBadgeText: { color: "#000", fontSize: fs(8), fontFamily: font.black, letterSpacing: 0.2, lineHeight: fs(11) },
  rating: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
  dot: { color: colors.border, fontSize: fs(11) },
  year: { color: colors.textMuted, fontSize: fs(11), fontFamily: font.bold },
});

export default React.memo(MovieCard);
