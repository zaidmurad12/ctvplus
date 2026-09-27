import React, { useEffect, useRef } from "react";
import { NativeModules, StyleProp, View, ViewStyle, findNodeHandle } from "react-native";

interface Props {
  blocked: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

// A screen kept mounted underneath another one (a title's details page under the artist page
// opened from it) is still on screen as far as Android's focus search is concerned - the D-pad
// could land on its invisible buttons, and control was "lost". While `blocked`, nothing inside can
// take focus (KeyEventBridge.setFocusBlocked - React Native has no prop for this).
export default function FocusBlockView({ blocked, style, children }: Props) {
  const ref = useRef<any>(null);
  useEffect(() => {
    const tag = findNodeHandle(ref.current);
    if (tag != null) NativeModules.KeyEventBridge?.setFocusBlocked(tag, blocked, -1);
  }, [blocked]);
  return (
    <View ref={ref} collapsable={false} style={style} pointerEvents={blocked ? "none" : "auto"}>
      {children}
    </View>
  );
}
