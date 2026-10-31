import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import type { Episode, Movie, Season } from "../api";
import { Lang, countryName, genreName, pickText } from "../i18n";
import { font } from "../theme";
import { s, fs } from "../scale";

const GENERIC_EPISODE_TITLE = /^\s*(episode|الحلقة|حلقة)\s*\d*\s*$/i;

// What's playing, shown large above the seek bar while the video is paused, over a black fade.
function PlayerPauseInfo({
  movie,
  season,
  episode,
  lang,
  bottomOffset,
}: {
  movie: Movie;
  season?: Season;
  episode?: Episode;
  lang: Lang;
  bottomOffset: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [opacity]);

  const ar = lang === "ar";
  const episodeTitle = episode ? pickText(episode.titleAr, episode.titleEn, lang)?.trim() : "";
  const episodeLine = episode
    ? [
        season ? `${ar ? "الموسم" : "Season"} ${season.number}` : "",
        `${ar ? "الحلقة" : "Episode"} ${episode.number}`,
        episodeTitle && !GENERIC_EPISODE_TITLE.test(episodeTitle) ? episodeTitle : "",
      ]
        .filter(Boolean)
        .join("  •  ")
    : "";
  const facts = [
    movie.year ? String(movie.year) : "",
    episode?.duration || movie.duration || "",
    movie.genres?.length ? movie.genres.slice(0, 3).map((g) => genreName(g, lang)).join("، ") : "",
    movie.country ? countryName(movie.country, lang) : "",
  ].filter(Boolean);
  const story = pickText(episode?.storyAr || movie.storyAr, episode?.storyEn || movie.storyEn, lang);
  const align = ar ? styles.alignEnd : styles.alignStart;
  const textAlign = { textAlign: ar ? ("right" as const) : ("left" as const) };

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity }]} pointerEvents="none">
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.88)", "rgba(0,0,0,0.96)"]}
        locations={[0, 0.3, 0.62, 1]}
        style={styles.fade}
      />
      <View style={[styles.content, align, { bottom: bottomOffset }]}>
        <Text style={[styles.title, textAlign]} numberOfLines={2}>
          {pickText(movie.titleAr, movie.titleEn, lang)}
        </Text>
        {!!episodeLine && (
          <Text style={[styles.episode, textAlign]} numberOfLines={1}>
            {episodeLine}
          </Text>
        )}
        <View style={[styles.factsRow, ar && styles.factsRowEnd]}>
          {!!movie.ageRating && (
            <View style={styles.ageBadge}>
              <Text style={styles.ageText}>{movie.ageRating}</Text>
            </View>
          )}
          {movie.rating ? (
            <View style={styles.ratingRow}>
              <View style={styles.imdbBadge}>
                <Text style={styles.imdbText}>IMDb</Text>
              </View>
              <Text style={styles.rating}>{movie.rating.toFixed(1)}</Text>
            </View>
          ) : null}
          {!!facts.length && <Text style={styles.facts}>{facts.join("  •  ")}</Text>}
        </View>
        {!!story && (
          <Text style={[styles.story, textAlign]} numberOfLines={4}>
            {story}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

export default React.memo(PlayerPauseInfo);

const styles = StyleSheet.create({
  fade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "88%" },
  content: { position: "absolute", left: s(56), right: s(56), gap: s(10) },
  alignEnd: { alignItems: "flex-end" },
  alignStart: { alignItems: "flex-start" },
  title: { color: "#fff", fontSize: fs(42), lineHeight: fs(58), fontFamily: font.black, maxWidth: "85%" },
  episode: { color: "#fff", fontSize: fs(23), lineHeight: fs(34), fontFamily: font.bold, maxWidth: "85%" },
  factsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: s(14) },
  factsRowEnd: { justifyContent: "flex-end" },
  facts: { color: "#e4e4e7", fontSize: fs(17), fontFamily: font.semiBold },
  ageBadge: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.65)", borderRadius: s(4), paddingHorizontal: s(8), paddingVertical: s(1) },
  ageText: { color: "#fff", fontSize: fs(14), fontFamily: font.black },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: s(7) },
  imdbBadge: { backgroundColor: "#fff", borderRadius: s(3), paddingHorizontal: s(6), paddingVertical: s(1) },
  imdbText: { color: "#000", fontSize: fs(12), fontFamily: font.black },
  rating: { color: "#fff", fontSize: fs(18), fontFamily: font.black },
  story: { color: "#d4d4d8", fontSize: fs(17), lineHeight: fs(29), fontFamily: font.regular, maxWidth: "74%" },
});
