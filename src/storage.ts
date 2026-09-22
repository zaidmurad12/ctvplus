import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  lang: "cinemana.lang",
  subtitleSettings: "cinemana.subtitleSettings",
  watchLater: "cinemana.watchLater",
  watchHistory: "cinemana.watchHistory",
  watchedEpisodes: "cinemana.watchedEpisodes",
  uiScale: "cinemana.uiScale",
  // A global preference, not per-title - picking a quality in the player's own quality panel
  // (see VideoPlayer.tsx's QualityPanel) is meant to "stick" for every title played after that,
  // the same way subtitleSettings already does, not just the one currently open.
  preferredQuality: "cinemana.preferredQuality",
  // Keyed by movie/episode id -> subtitleDelayMs (see VideoPlayer.tsx) - a sync fix (manual or
  // via the auto-sync button) is specific to that one title's particular file/rip, not a global
  // preference, so it's saved per-id instead of alongside SubtitleSettings.
  subtitleDelays: "cinemana.subtitleDelays",
  // Keyed by movie/episode id -> {positionSeconds, durationSeconds, updatedAt} (see
  // VideoPlayer.tsx) - lets a title resume from where playback last stopped instead of always
  // restarting from zero.
  watchProgress: "cinemana.watchProgress",
  // Movies/Series browse filters (genre, language, sort) - one entry per type, suffixed ".movie"/".series".
  browseFilters: "cinemana.browseFilters",
} as const;

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (err) {
    console.error(`[storage] Failed to load "${key}":`, err);
    return fallback;
  }
}

// loadJson collapses "never saved" and "saved as the fallback value" into the same return value
// - not enough to tell whether this is a genuinely first launch (see App.tsx's uiScale loading,
// which needs exactly that to know whether it's safe to seed a device-specific default instead
// of DEFAULT_UI_SCALE).
async function hasStoredValue(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) != null;
  } catch {
    return false;
  }
}

function saveJson(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch((err) =>
    console.error(`[storage] Failed to save "${key}":`, err)
  );
}

export const storageKeys = KEYS;
export { loadJson, saveJson, hasStoredValue };
