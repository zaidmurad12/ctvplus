// Custom-rendered subtitles (see VideoPlayer.tsx) instead of react-native-video's built-in
// textTrack pipeline, which hands rendering off to the OS's own subtitle view - a fixed
// white-on-black style with no font/color/size hook exposed through react-native-video's own
// props in the first place. Owning the rendering ourselves is what makes any of this
// selectable at all.

export type SubtitleFontKey = "cairo" | "amiri" | "tajawal" | "system";
export type SubtitleSizeKey = "small" | "medium" | "large";

// Regular weight, not Bold - subtitles read as too thick/heavy on screen at full bold,
// especially at the larger sizes below.
export const SUBTITLE_FONTS: { key: SubtitleFontKey; family: string | undefined; labelAr: string; labelEn: string }[] = [
  { key: "cairo", family: "Cairo-Regular", labelAr: "كايرو", labelEn: "Cairo" },
  { key: "amiri", family: "Amiri-Regular", labelAr: "أميري", labelEn: "Amiri" },
  { key: "tajawal", family: "Tajawal-Regular", labelAr: "تجوال", labelEn: "Tajawal" },
  // undefined = platform default font - a safe, always-available fourth option that needs no
  // bundled file at all.
  { key: "system", family: undefined, labelAr: "افتراضي", labelEn: "Default" },
];

// `percent` is display-only (the in-player panel's size slider shows it the way a real
// percentage-based size control would, e.g. "100%") - medium is the baseline 100%, small/large
// are its actual fontSize ratio rounded to the nearest 10.
export const SUBTITLE_SIZES: { key: SubtitleSizeKey; fontSize: number; percent: number; labelAr: string; labelEn: string }[] = [
  { key: "small", fontSize: 16, percent: 70, labelAr: "صغير", labelEn: "Small" },
  { key: "medium", fontSize: 22, percent: 100, labelAr: "متوسط", labelEn: "Medium" },
  { key: "large", fontSize: 28, percent: 130, labelAr: "كبير", labelEn: "Large" },
];

export const SUBTITLE_COLORS: string[] = ["#ffffff", "#f5c518", "#4ade80", "#38bdf8", "#f87171"];

export type SubtitleLanguage = "ar" | "en";

export interface SubtitleSettings {
  enabled: boolean;
  font: SubtitleFontKey;
  size: SubtitleSizeKey;
  color: string;
  background: boolean;
  // Which language of subtitle to prefer when a title carries both (the other one is used only when
  // the preferred one is missing).
  language: SubtitleLanguage;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  enabled: true,
  font: "cairo",
  size: "medium",
  color: "#ffffff",
  background: false,
  language: "ar",
};

export function subtitleFontFamily(key: SubtitleFontKey): string | undefined {
  return SUBTITLE_FONTS.find((f) => f.key === key)?.family;
}

export function subtitleFontSize(key: SubtitleSizeKey): number {
  return SUBTITLE_SIZES.find((s) => s.key === key)?.fontSize ?? 22;
}

// Sources label a track however they like ("ar", "Arabic", "العربية", "English", ...) - this reads the
// two languages we care about out of any of those spellings.
export function subtitleTrackLanguage(label: string | undefined): SubtitleLanguage | null {
  const value = (label ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "ar" || value.startsWith("ar-") || value.includes("arab") || value.includes("عرب")) return "ar";
  if (value === "en" || value.startsWith("en-") || value.includes("engl") || value.includes("انج") || value.includes("إنج")) return "en";
  return null;
}

// The track to show: the preferred language if the title has it, else the other of the two, else
// whatever single track exists.
export function pickSubtitleTrack<T extends { language: string }>(tracks: T[] | undefined, preferred: SubtitleLanguage | undefined): T | undefined {
  if (!tracks?.length) return undefined;
  const want = preferred ?? "ar";
  const other: SubtitleLanguage = want === "ar" ? "en" : "ar";
  return (
    tracks.find((t) => subtitleTrackLanguage(t.language) === want) ??
    tracks.find((t) => subtitleTrackLanguage(t.language) === other) ??
    tracks[0]
  );
}
