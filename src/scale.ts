import { Dimensions } from "react-native";

// Three different *automatic* device-scaling formulas were tried here (a 960x540 reference, a
// 1920x1080 reference, then a PixelRatio-based dpr correction) and every one of them made some
// real device measurably wrong in some new way - because a single constant genuinely can't
// satisfy two different physical devices that need different values. This is now a manual,
// user-adjustable setting instead (see SettingsScreen's "UI Size" section) - the viewer picks
// whatever looks right on their own device. suggestInitialUIScale() below reuses one of those
// same formulas again, but only ever as a one-time *first-launch* seed the viewer can instantly
// override (see App.tsx) - never re-applied once they've actually picked a value - so a device it
// guesses wrong for is no worse off than the old fixed default was, instead of a value silently
// re-imposed on every cold start.
//
// Every screen's `StyleSheet.create({...})` calls s()/fs() at module-evaluation time (the
// moment that screen is first imported), not on every render - so changing `scale` after any
// screen has already been imported does nothing for that screen's already-built styles. App.tsx
// works around this by lazy-loading every screen (React.lazy) and not rendering *any* of them
// until the persisted UI-scale setting has been loaded and applied here via setUIScale() -
// which is also why changing the setting needs the app reopened to take effect: only a fresh
// launch re-imports (and so re-scales) every screen from scratch.
export const DEFAULT_UI_SCALE = 0.9;
// 0.7 wasn't a low enough floor for every box - Google TV devices reported still-too-large UI
// even at the smallest option that existed. Extended down to 0.5 rather than lowering
// DEFAULT_UI_SCALE itself, since that default is fine on the other devices already tested; this
// only gives Google TV viewers a smaller value to manually pick, same as any other device.
export const UI_SCALE_OPTIONS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2];

let scale = DEFAULT_UI_SCALE;

export function setUIScale(value: number) {
  scale = value;
}

export function getUIScale(): number {
  return scale;
}

export function s(size: number): number {
  return Math.round(size * scale);
}

export function fs(size: number): number {
  return Math.round(size * scale);
}

// Every s()/fs() call in this app assumes roughly a 1920-wide logical (dp) reference - a box
// that reports a much narrower `window` width for the same physical TV screen (bad/misreported
// density is common on cheap Android TV sticks) ends up with fewer, proportionally bigger dp
// units to lay the same sizes out in, which is exactly what "the UI is huge on this box" turns
// out to mean. Only ever called once, for a viewer who has never touched the UI-size setting
// before (see App.tsx) - after that, whatever they picked (or left alone) is respected forever,
// this never overrides a saved choice.
export function suggestInitialUIScale(): number {
  const { width, height } = Dimensions.get("window");
  const longSide = Math.max(width, height);
  if (longSide < 1000) return 0.6;
  if (longSide < 1500) return 0.8;
  return DEFAULT_UI_SCALE;
}
