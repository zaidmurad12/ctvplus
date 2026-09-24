import type { Lang } from "./i18n";
import { NativeModules } from "react-native";

// Shared by streamSelect.ts (server ordering), VideoPlayer's quality picker, and api.ts (the
// movie-summary "available resolution" badge) - kept in its own module instead of living in
// streamSelect.ts so api.ts can use it too without a circular import (streamSelect.ts already
// imports StreamServer from api.ts).
export function qualityRank(quality: string): number {
  const match = /(\d+)/.exec(quality);
  if (!match) return 0;
  const n = Number(match[1]);
  // "4k"/"2160p" naming is inconsistent across sources, but the digits alone already sort
  // correctly against "1080"/"720"/etc. without needing special-casing.
  return n;
}

// A human label for one quality value - "4K" for anything 2160p+ (sources name this
// inconsistently: "4k", "2160p", "2160"), "1080p"/"720p"/etc. for anything else with a real
// number, and the raw string as a last resort for a quality value with no digits in it at all.
export function qualityLabel(quality: string, lang: Lang = "en"): string {
  const rank = qualityRank(quality);
  if (rank >= 2160) return "4K";
  if (rank > 0) return `${rank}p`;
  return quality || (lang === "ar" ? "غير معروف" : "Unknown");
}

// The global starting point before the viewer has ever picked a quality themselves (see
// storageKeys.preferredQuality) - matched against each title's own qualityLabel() when a fresh
// play starts, falling back to whichever server pickBestServers ranked first when this exact
// label isn't actually available for that title.
export const DEFAULT_PREFERRED_QUALITY = "1080p";

// Whether this device has a hardware decoder for 2160p (see VideoCapsModule.kt). Probed once per
// app run and cached; resolves true when the native module is missing or the probe fails, so 4K
// is only ever held back on a real "no".
let can4KPromise: Promise<boolean> | null = null;
export function canDecode4K(): Promise<boolean> {
  if (!can4KPromise) {
    const { VideoCaps } = NativeModules;
    can4KPromise = VideoCaps?.canDecode4K ? VideoCaps.canDecode4K().catch(() => true) : Promise.resolve(true);
  }
  return can4KPromise!;
}
