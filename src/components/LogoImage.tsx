import React, { useEffect, useState } from "react";
import { Image, StyleSheet, View, ViewStyle } from "react-native";

interface Props {
  uri: string;
  height: number;
  maxWidth: number;
  style?: ViewStyle;
}

// A plain <Image resizeMode="contain"> stretched to a wide box centers the actual artwork
// inside that box - so a logo meant to sit flush against the start edge (beside the poster,
// aligned with the text below it) visually reads as "centered" instead, since the empty
// space contain() leaves on a non-matching-aspect-ratio image is split evenly on both sides.
// Fetching the real image dimensions once and sizing the box to the logo's own aspect ratio
// (capped at maxWidth) removes that dead space entirely, so flex-start alignment actually
// puts the logo at the edge.
// The backend marks each logo URL with a `#dark`/`#light` fragment (see prisma/backfill-logo-tone.mjs
// there). A near-black logo over this app's dark hero/details/player backgrounds is close to
// unreadable, so a `#dark` one is drawn white instead. The fragment is stripped before loading.
// Sized by area, not by a fixed height: at one fixed height a square or tall logo came out a small
// block next to the wide ones (per request). Every logo now gets about the same visual area - a wide
// one keeps roughly its old size, a square one grows taller (up to MAX_HEIGHT_FACTOR x height) -
// and none ever exceeds maxWidth.
const AREA_FACTOR = 0.9;
const MAX_HEIGHT_FACTOR = 1.8;
function logoBox(aspect: number, height: number, maxWidth: number): { width: number; height: number } {
  const area = height * maxWidth * AREA_FACTOR;
  let h = Math.min(Math.sqrt(area / aspect), height * MAX_HEIGHT_FACTOR);
  let w = h * aspect;
  if (w > maxWidth) {
    w = maxWidth;
    h = w / aspect;
  }
  return { width: Math.round(w), height: Math.round(h) };
}

export default function LogoImage({ uri: markedUri, height, maxWidth, style }: Props) {
  const hashAt = markedUri.indexOf("#");
  const uri = hashAt >= 0 ? markedUri.slice(0, hashAt) : markedUri;
  const isDark = hashAt >= 0 && markedUri.slice(hashAt + 1) === "dark";
  const [box, setBox] = useState({ width: maxWidth, height });
  useEffect(() => {
    setBox({ width: maxWidth, height });
  }, [uri, height, maxWidth]);

  // Sized from the image's own load event: Image.getSize used to download and decode every logo a
  // second time just to learn its dimensions - extra work right when a page is opening.
  return (
    <View style={[{ alignSelf: "flex-start" }, style]}>
      <Image
        source={{ uri }}
        style={[box, isDark && styles.whiteTint]}
        resizeMode="contain"
        fadeDuration={0}
        onLoad={(e) => {
          const { width: naturalW, height: naturalH } = e.nativeEvent.source;
          if (naturalW && naturalH) setBox(logoBox(naturalW / naturalH, height, maxWidth));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  whiteTint: { tintColor: "#fff" },
});
