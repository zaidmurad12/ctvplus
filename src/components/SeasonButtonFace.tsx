import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import type { Season } from "../api";
import { Lang, pickText } from "../i18n";
import { colors, font, radius } from "../theme";
import { s, fs } from "../scale";

// The season's own name when it has a real one ("Book One: Water"), otherwise "موسم 2" /
// "Season 2" in the app's language - catalog names are often just a generic "Season 2" or
// "الموسم 2" in one language, which read wrong once the app's language was switched.
const GENERIC_SEASON_NAME = /^\s*(season|series|specials|الموسم|موسم)\s*\d*\s*$/i;
function seasonLabel(season: Season, lang: Lang): string {
  const name = pickText(season.titleAr, season.titleEn, lang)?.trim();
  if (name && !GENERIC_SEASON_NAME.test(name) && !/^\d+$/.test(name)) return name;
  if (season.number === 0) return lang === "ar" ? "حلقات خاصة" : "Specials";
  return `${lang === "ar" ? "موسم" : "Season"} ${season.number}`;
}

// How the season button looks, on the details page and in the player's episode row alike: `focused`
// lights its outline, `active` (pressed - up/down now switch the season) grows it.
export default function SeasonButtonFace({
  season,
  lang,
  focused,
  active,
}: {
  season?: Season;
  lang: Lang;
  focused: boolean;
  active: boolean;
}) {
  const grow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(grow, { toValue: active ? 1.15 : 1, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
  }, [active, grow]);

  const label = season ? seasonLabel(season, lang) : "";
  const labelParts = /^(.*\s)(\d+)$/.exec(label);
  const arrowColor = active ? "#fff" : colors.textMuted;
  // Beside the season number: Arabic "موسم 2" shows its number on the left, English "Season 2" on
  // the right.
  const arrows = (
    <View style={styles.arrows}>
      <ChevronUp size={s(12)} color={arrowColor} strokeWidth={2.5} />
      <ChevronDown size={s(12)} color={arrowColor} strokeWidth={2.5} />
    </View>
  );
  return (
    <Animated.View style={[styles.button, focused && styles.buttonFocused, { transform: [{ scale: grow }] }]}>
      {/* Word and number as separate pieces with a clear gap, the number bigger. */}
      {labelParts ? (
        lang === "ar" ? (
          <>
            {arrows}
            <Text style={styles.number}>{labelParts[2]}</Text>
            <Text style={styles.text}>{labelParts[1].trim()}</Text>
          </>
        ) : (
          <>
            <Text style={styles.text}>{labelParts[1].trim()}</Text>
            <Text style={styles.number}>{labelParts[2]}</Text>
            {arrows}
          </>
        )
      ) : (
        <>
          {lang === "ar" && arrows}
          <Text style={styles.text}>{label}</Text>
          {lang !== "ar" && arrows}
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    marginEnd: s(4),
    paddingHorizontal: s(26),
    paddingVertical: s(14),
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: "rgba(24,24,27,0.6)",
    borderColor: "rgba(255,255,255,0.2)",
  },
  buttonFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.12)" },
  arrows: { alignItems: "center", marginVertical: -s(4) },
  text: { color: "#fff", fontSize: fs(13), fontFamily: font.extraBold },
  // Its line box trimmed to the digits themselves: the bigger number's default line height made
  // the button taller than its neighbours on the details page.
  number: { color: "#fff", fontSize: fs(19), lineHeight: fs(17), fontFamily: font.black, includeFontPadding: false, marginVertical: -s(2) },
});
