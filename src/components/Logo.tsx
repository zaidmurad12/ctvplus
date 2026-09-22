import React from "react";
import { View, Image, StyleSheet } from "react-native";

// The bundled asset is cropped tight to the actual "ctv" glyphs (plus a small fixed margin) -
// 791x378 for the current Plus Jakarta Sans Medium wordmark, confirmed by sampling the source
// PNG's non-transparent pixel bounds. Padding/frame proportions below are computed from this,
// not guessed, so they hold at any size this component is asked to render at.
const CONTENT_ASPECT = 791 / 378;
// The reference badge is a compact rounded *rectangle* - noticeably taller relative to its
// width than the wordmark's own text ever is on its own, with real corner rounding rather
// than a full stadium/pill - not the wide pill shape tried before.
const FRAME_ASPECT = 1.4;

interface Props {
  // The badge's own height - width follows from FRAME_ASPECT, so this is the one number that
  // actually sets the badge's size.
  height: number;
}

// The reference logo is a solid black badge with the "ctv" wordmark cut into it in white - a
// solid black fill would disappear against this app's own near-black background, so this
// rebuilds the same badge shape as a white outline/frame instead, with the wordmark (already a
// separate white-on-transparent asset - see assets/logo.png) sitting inside it.
export default function Logo({ height }: Props) {
  const frameWidth = height * FRAME_ASPECT;
  const imgWidth = frameWidth * 0.68;
  const imgHeight = imgWidth / CONTENT_ASPECT;
  return (
    <View style={[styles.frame, { width: frameWidth, height, borderRadius: height * 0.22 }]}>
      <Image source={require("../assets/logo.png")} style={{ width: imgWidth, height: imgHeight }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
