import React from "react";
import { View, Image, ActivityIndicator, StyleSheet } from "react-native";
import type { Movie } from "../api";
import { posterUrl } from "../api";
import { s } from "../scale";
import Logo from "../components/Logo";

interface Props {
  posters: Movie[];
}

export default function SplashScreen({ posters }: Props) {
  const collage = posters.filter((m) => !!m.poster).slice(0, 12);

  return (
    <View style={styles.root}>
      {collage.length > 0 && (
        <View style={styles.grid}>
          {collage.map((m) => (
            <Image key={m.id} source={{ uri: posterUrl(m.poster, "w342") }} style={styles.tile} />
          ))}
        </View>
      )}
      <View style={styles.dim} />
      <View style={styles.center}>
        <Logo height={56} />
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  grid: { ...StyleSheet.absoluteFill, flexDirection: "row", flexWrap: "wrap" },
  tile: { width: "16.66%", aspectRatio: 2 / 3, opacity: 0.22 },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.8)" },
  center: { alignItems: "center", gap: s(18) },
});
