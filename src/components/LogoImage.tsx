import React, { useEffect, useState } from "react";
import { Image, View, ViewStyle } from "react-native";

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
export default function LogoImage({ uri, height, maxWidth, style }: Props) {
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
      <Image source={{ uri }} style={{ width, height }} resizeMode="contain" fadeDuration={0} />
    </View>
  );
}
