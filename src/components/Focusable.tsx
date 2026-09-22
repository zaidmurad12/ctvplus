import React, { useCallback, useMemo, useRef, useState } from "react";
import { Animated, Pressable, PressableProps, StyleSheet, View, ViewStyle } from "react-native";

// Module-level constant, not a fresh object literal per render - every Focusable instance in the
// app (there can easily be 100+ simultaneously mounted across Home's rails) shares this exact
// same reference, one fewer small allocation per instance per render.
const TRANSPARENT_RIPPLE = { color: "transparent" };

interface Props extends Omit<PressableProps, "children"> {
  scaleTo?: number;
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  style?: ViewStyle | ViewStyle[];
  onFocusChange?: (focused: boolean) => void;
  // Only needed when `children` is the render-prop form and the shape/borderRadius actually
  // rendered lives on a View built *inside* that callback (e.g. `{(focused) => <View
  // style={styles.pill}>...}`) rather than on this component's own `style` prop - Focusable has
  // no way to see into that callback's return value ahead of time, so it can't infer the radius
  // to clip its own focus-highlight suppression to on its own in that case. See the borderRadius
  // comment below for why this matters at all.
  focusRadius?: number;
  // Opt-in, not the default - see its own comment where it's actually applied below for why.
  clipFocusOverflow?: boolean;
  // Android TV-only native View focus-routing props - not in RN's PressableProps typings,
  // declared here once so call sites don't each need their own @ts-ignore.
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
}

// Shared focus-animation primitive: every card/button in the app scales in with a spring
// on focus instead of snapping instantly. Only `transform` (scale) is animated - never
// width/height/border-width - so it stays GPU-composited on weak Android TV hardware (see
// the vercel-react-native-skills animation-gpu-properties rule this project installed).
// Uses core Animated + useNativeDriver, not Reanimated, to avoid a second animation
// library/babel plugin for a same-day design pass.
//
// Forwards its ref to the underlying Pressable's host node - needed so callers can wire
// explicit nextFocusUp/Down/Left/Right props (native Android view-to-view focus routing)
// pointing directly at another Focusable, instead of trusting Android's geometric nearest-
// neighbor guess, which is what produced the sidebar's unpredictable wrap-around.
const Focusable = React.forwardRef<View, Props>(function Focusable(
  { scaleTo = 1.06, children, style, focusRadius, clipFocusOverflow, onFocus, onBlur, onFocusChange, ...rest },
  ref
) {
  const scale = useRef(new Animated.Value(1)).current;
  const [focused, setFocused] = useState(false);

  // Most call sites pass their visual box straight as `style`, which StyleSheet.flatten can read
  // ahead of time - but the render-prop form (see focusRadius's own comment on Props) builds that
  // box *inside* the callback below, invisible to this component until it's actually invoked with
  // a `focused` value we don't have yet at this point. `focusRadius` is the explicit escape hatch
  // for exactly that case; a call site using the render-prop form without passing it just doesn't
  // get this suppression (falls back to a plain 0/undefined radius, i.e. the old square behavior).
  const borderRadius = focusRadius ?? StyleSheet.flatten(style)?.borderRadius;

  const animateTo = useCallback(
    (value: number, focusedNow: boolean) => {
      setFocused(focusedNow);
      onFocusChange?.(focusedNow);
      // scaleTo === 1 means this call site never wants a scale effect at all (see MovieCard's own
      // comment on why it dropped its scale) - skipping the spring entirely here, not just
      // animating between two equal values, is what actually saves the work on every single focus
      // change, since `value` is always 1 in that case regardless of focus state.
      if (scaleTo === 1) return;
      Animated.spring(scale, {
        toValue: value,
        useNativeDriver: true,
        speed: 24,
        bounciness: 6,
      }).start();
    },
    [onFocusChange, scale, scaleTo]
  );

  const handleFocus = useCallback(
    (e: any) => {
      animateTo(scaleTo, true);
      onFocus?.(e);
    },
    [animateTo, scaleTo, onFocus]
  );
  const handleBlur = useCallback(
    (e: any) => {
      animateTo(1, false);
      onBlur?.(e);
    },
    [animateTo, onBlur]
  );

  // Memoized (not a fresh object literal every render) - this Pressable's own style rarely
  // actually changes (borderRadius/clipFocusOverflow are effectively static per call site), so
  // there's no reason to hand it a "new" style object on every focus-driven re-render.
  const pressableStyle = useMemo(
    () => ({
      backgroundColor: "transparent" as const,
      borderRadius,
      ...(clipFocusOverflow ? { overflow: "hidden" as const } : null),
    }),
    [borderRadius, clipFocusOverflow]
  );

  return (
    <Pressable
      ref={ref as any}
      // Android draws *something* focus-related on this exact native view with square corners
      // regardless of the rounded look every call site's own `focused && ...` child style paints
      // on top - reported as still visible at the edges on a real device even after three
      // different suppression attempts (a theme-level android:defaultFocusHighlightEnabled=false
      // override; giving this Pressable a real-if-transparent backgroundColor instead of leaving
      // it null; and matching this Pressable's own borderRadius to its child's, relying on
      // Android to confine background/outline-based painting - ripple or default highlight,
      // whichever it actually is - to that radius the way it would for a plain rounded background
      // fill). None of those reliably suppressed or clipped it on the reporting device. `overflow:
      // hidden` is the blunter, more reliably-enforced version of that last idea: an actual canvas
      // clip at this ViewGroup, rather than trusting an outline-based clip some renderer/GPU
      // driver combination isn't honoring for whatever's drawing this. The tradeoff is that it
      // also clips the child's own focus-scale transform right at this box's static (pre-scale)
      // bounds, and - more importantly - would clip a `focusShadow`/`focusShadowTight` glow many
      // other call sites paint intentionally *past* their own edges, so this stays opt-in
      // (`clipFocusOverflow`) rather than the default for every Focusable in the app: turned on
      // only where the square-highlight artifact has actually been reported and the plain
      // borderRadius-matching attempt above didn't fix it, not rolled out blind everywhere.
      style={pressableStyle}
      android_ripple={TRANSPARENT_RIPPLE}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {typeof children === "function" ? children(focused) : children}
      </Animated.View>
    </Pressable>
  );
});

export default Focusable;
