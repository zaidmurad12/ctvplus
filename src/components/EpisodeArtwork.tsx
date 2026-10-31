import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { posterUrl } from "../api";
import { s } from "../scale";

// An episode's own still, or - when it has none, or it fails to load - the title's horizontal
// artwork, blurred under a black shade so it reads as a placeholder rather than as a real still.
// Shared by the details page and the player's episode row.
export default function EpisodeArtwork({
  thumbnail,
  backdrop,
  poster,
}: {
  thumbnail?: string;
  backdrop?: string;
  poster?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  useEffect(() => setFailed([]), [thumbnail, backdrop, poster]);

  const still = thumbnail ? posterUrl(thumbnail, "w342") : undefined;
  const fallbacks = [backdrop, poster].filter((uri): uri is string => !!uri).map((uri) => posterUrl(uri, "w342"));
  const uri = [still, ...fallbacks].find((candidate) => !!candidate && !failed.includes(candidate));
  if (!uri) return null;
  const isStill = uri === still;

  return (
    <>
      <Image
        source={{ uri }}
        style={styles.image}
        resizeMode="cover"
        blurRadius={isStill ? 0 : s(14)}
        fadeDuration={0}
        onError={() => setFailed((current) => [...current, uri])}
      />
      {!isStill && <View style={styles.shade} pointerEvents="none" />}
    </>
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: "100%" },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.5)" },
});
