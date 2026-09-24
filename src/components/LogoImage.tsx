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
export default function LogoImage({ uri: markedUri, height, maxWidth, style }: Props) {
  const hashAt = markedUri.indexOf("#");
  const uri = hashAt >= 0 ? markedUri.slice(0, hashAt) : markedUri;
  const isDark = hashAt >= 0 && markedUri.slice(hashAt + 1) === "dark";
  const [width, setWidth] = useState(maxWidth);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (naturalW, naturalH) => {
        if (cancelled || !naturalH) return;
        setWidth(Math.min(maxWidth, height * (naturalW / naturalH)));
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [uri, height, maxWidth]);

  return (
    <View style={[{ alignSelf: "flex-start" }, style]}>
      <Image source={{ uri }} style={[{ width, height }, isDark && styles.whiteTint]} resizeMode="contain" fadeDuration={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  whiteTint: { tintColor: "#fff" },
});
