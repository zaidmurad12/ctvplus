import React, { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, NativeEventEmitter, NativeModules, findNodeHandle, Animated, ToastAndroid } from "react-native";
import { WebView } from "react-native-webview";
import LinearGradient from "react-native-linear-gradient";
import Video, { BufferingStrategyType, OnLoadData, OnProgressData, VideoRef } from "react-native-video";
import { Play, Pause, ShieldAlert, Subtitles, Settings, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Check } from "lucide-react-native";
import EpisodeRow from "../components/EpisodeRow";
import type { Movie, Season, Episode, StreamServer } from "../api";
import { posterUrl, youtubeVideoId, youtubeEmbedUrl } from "../api";
import { qualityRank, qualityLabel, canDecode4K } from "../quality";
import Focusable from "../components/Focusable";
import LogoImage from "../components/LogoImage";
import { font, colors, radius } from "../theme";
import { s, fs } from "../scale";
import {
  SubtitleSettings,
  SUBTITLE_FONTS,
  SUBTITLE_SIZES,
  SUBTITLE_COLORS,
  subtitleFontFamily,
  subtitleFontSize,
  pickSubtitleTrack,
} from "../subtitleSettings";
import { parseVtt, activeCueText, SubtitleCue } from "../vtt";
import { decodeSubtitleBytes } from "../subtitleEncoding";
import { isRtlText } from "../rtl";
import { pushBackHandler } from "../backStack";
import { loadJson, saveJson, storageKeys } from "../storage";
import { Lang, ageRatingDescription, ageRatingColor, countryName, languageName, genreName } from "../i18n";

interface Props {
  servers: StreamServer[];
  movie: Movie;
  season?: Season;
  episode?: Episode;
  lang: Lang;
  subtitleSettings: SubtitleSettings;
  onChangeSubtitleSettings: (settings: SubtitleSettings) => void;
  // Global (not per-title) - see storageKeys.preferredQuality's own comment in storage.ts. Used
  // to pick this title's own starting server (matched by qualityLabel, see the playingKey-keyed
  // reset effect below), and updated whenever the viewer manually picks a quality so it carries
  // over to the next title too.
  preferredQuality: string;
  onChangePreferredQuality: (quality: string) => void;
  onExit: () => void;
  // Only relevant for a series (movie.seasons set) - lets the in-player episode row (see
  // EpisodeRow.tsx/openEpisodeRow) switch to a different episode without leaving the player.
  onSelectEpisode?: (episode: Episode, season: Season) => void;
  resolvingEpisodeId?: string | null;
  isEpisodeWatched?: (seasonNumber: number, episodeNumber: number) => boolean;
}

// Persisted per movie/episode id - see subtitleOffsetMs/subtitleSpeed's own comment for why a
// title's sync fix is two numbers, not one. serverOffsetMsAtSave/serverSpeedAtSave record what
// the backend's own default was *at the moment this local value was saved* - see the load effect
// below for why that's what lets a later admin correction (apps/admin's PreviewModal sync tool)
// actually reach a device that already has an older local save for this exact title.
interface SubtitleSyncEntry {
  offsetMs: number;
  speed: number;
  serverOffsetMsAtSave?: number;
  serverSpeedAtSave?: number;
}

// A bare one-shot `.focus()` call right after a view mounts (or right after it's handed focus
// back imperatively, e.g. closing the subtitle panel) has repeatedly proven to lose the race
// against this screen's own layout/mount timing on this Android TV setup - the view is real and
// later responds to presses fine, but the very first focus attempt can land before it's actually
// focusable yet, leaving nothing focused at all (a D-pad press with no visible target - reported
// as the controls "getting lost"). Retrying a few times with backoff is cheap insurance: once
// something is already focused, later `.focus()` calls on the same view are harmless no-ops.
function retryFocus(ref: React.RefObject<any>, attempts = 6, firstDelay = 50, step = 150): () => void {
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tryFocus = () => {
    attempt += 1;
    (ref.current as any)?.focus?.();
    if (attempt < attempts) timer = setTimeout(tryFocus, attempt * step);
  };
  timer = setTimeout(tryFocus, firstDelay);
  return () => {
    if (timer) clearTimeout(timer);
  };
}

const AGE_RATING_DISPLAY_MS = 6000;
// See onError's own comment - how many times a link that already proved it works gets retried
// (with a short pause between attempts) before this actually falls through to the next server /
// the unavailable screen, and how long each pause is.
const MAX_MIDSTREAM_RETRIES = 6;
const MIDSTREAM_RETRY_DELAY_MS = 2000;
// How far the episode row's own dark scrim extends above its measured height (see its own
// comment) - gives the fade-to-transparent room to finish above the season indicator instead of
// still visibly fading right behind it.
// Raised from s(50) with the softer gradient below - the old short band read as a cut-off edge.
const EPISODE_SCRIM_EXTRA_TOP = s(110);
// Repeat delay for press-and-hold seeking - fast enough to read as continuous seeking, not
// individual disconnected 10s jumps.
const HOLD_SEEK_INTERVAL_MS = 350;
// Seconds jumped per tick, indexed by how many ticks the hold has already run for (last value
// repeats once the hold outlasts the array) - see startHoldSeek.
const HOLD_SEEK_STEPS = [10, 10, 10, 20, 20, 30, 30, 45, 60];

function formatTime(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(secs).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// The total duration side specifically - hours and minutes only, no seconds, since a movie's
// overall length was never meaningfully precise to the second the way the *current playback
// position* on the other side of the bar actually is.
function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `0:${String(m).padStart(2, "0")}`;
}

export default function VideoPlayerScreen({
  servers,
  movie,
  season,
  episode,
  lang,
  subtitleSettings,
  onChangeSubtitleSettings,
  preferredQuality,
  onChangePreferredQuality,
  onExit,
  onSelectEpisode,
  resolvingEpisodeId,
  isEpisodeWatched,
}: Props) {
  // Which of `servers` (already ordered by pickBestServers - reachable+highest-quality first,
  // see streamSelect.ts) is actually being attempted right now. A server that was reachable
  // moments ago during that probe can still fail once react-native-video actually tries to
  // decode/stream it for real (a probe is a 2-byte GET, not a real playback session) - onError
  // below advances this instead of just giving up on the first failure, so one bad link doesn't
  // block a movie/episode that has other working ones.
  const [serverIndex, setServerIndex] = useState(0);
  // True once every server in the list has failed - shown instead of the player, which otherwise
  // stayed on a plain black screen forever (onError only ever logged and cleared the spinner, see
  // its own comment below) with nothing telling the viewer why.
  const [unavailable, setUnavailable] = useState(false);
  const url = servers[serverIndex]?.url;
  // One entry per distinct quality (240p/480p/.../4K), keeping whichever server pickBestServers
  // put first for that quality (already reachable-and-highest-priority ordered, see
  // streamSelect.ts) - two mirrors offering the same resolution collapse into one picker row
  // instead of showing as separate, confusingly identical-looking options. Only one entry means
  // nothing to actually pick between, so the quality button itself stays hidden in that case (see
  // its own render site below).
  // False only once the device has confirmed it has no hardware 4K decoder (see canDecode4K).
  const [can4K, setCan4K] = useState(true);
  useEffect(() => {
    let cancelled = false;
    canDecode4K().then((ok) => {
      if (!cancelled) setCan4K(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const qualityOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const options: { serverIndex: number; label: string; rank: number }[] = [];
    servers.forEach((server, index) => {
      const label = qualityLabel(server.quality, lang);
      if (seen.has(label)) return;
      // A device without a hardware 4K decoder plays 4K through a software one that can't keep
      // up - reported as slow, choppy motion - so it isn't offered there at all.
      if (!can4K && qualityRank(server.quality) >= 2160) return;
      seen.add(label);
      options.push({ serverIndex: index, label, rank: qualityRank(server.quality) });
    });
    return options.sort((a, b) => b.rank - a.rank);
  }, [servers, lang, can4K]);
  // Admin-entered per explicit request: a stream URL that's a YouTube link (rather than a direct
  // video file) plays through YouTube's own official embeddable player instead of react-native-
  // video, which has no way to play a YouTube page at all. See the YouTube-branch return below
  // for why this needs its own, much simpler render path - none of the custom controls (seek bar,
  // subtitles, audio sync, episode switching) apply to a player we don't own, only YouTube's own
  // official controls do.
  const youtubeId = youtubeVideoId(url);
  // Selecting a different episode from the episode row (see onSelectEpisode) updates this same
  // mounted screen's props rather than remounting it (App.tsx's <Playing> just changes, it never
  // goes through `null` in between) - unlike subtitleOffsetMs/watch-progress (already keyed on
  // syncStorageKey below), serverIndex/unavailable had no such reset and would otherwise carry
  // over a previous episode's failed-server progress (or its "unavailable" verdict) straight onto
  // a new one that never actually tried playing yet.
  const playingKey = episode?.id ?? movie.id;
  // Set once this exact url has actually loaded successfully - a weak connection stalling mid-
  // playback surfaces to RN Video as the same onError a genuinely dead link would, with nothing
  // in the error itself telling the two apart. Once a link is *proven* to work, onError below
  // retries that same link (see retryTokenRef/MAX_MIDSTREAM_RETRIES) instead of immediately
  // treating the stall as "not available" - that verdict is now reserved for links that never
  // loaded in the first place.
  const hasEverPlayedRef = useRef(false);
  const midstreamRetryCountRef = useRef(0);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => {
    // Starts at whichever server matches the global preferred quality (see this component's own
    // Props comment) for *this* title specifically - falls back to index 0 (pickBestServers' own
    // top pick) when that exact quality isn't actually available here, same as before.
    const preferredIndex = servers.findIndex((server) => qualityLabel(server.quality, lang) === preferredQuality);
    setServerIndex(preferredIndex >= 0 ? preferredIndex : 0);
    setUnavailable(false);
    setRetryToken(0);
    hasEverPlayedRef.current = false;
    midstreamRetryCountRef.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingKey]);
  // Steps a 4K pick (the saved preferred quality, or the error fallback walking the list) down to
  // the best quality this device can actually decode in hardware - see qualityOptions above. Stays
  // on 4K only when nothing else is on offer at all.
  const currentIs4K = qualityRank(servers[serverIndex]?.quality ?? "") >= 2160;
  useEffect(() => {
    if (can4K || !currentIs4K) return;
    const fallback = qualityOptions[0];
    if (!fallback) return;
    setServerIndex(fallback.serverIndex);
    ToastAndroid.show(
      lang === "ar" ? `جهازك لا يدعم تشغيل 4K بسلاسة - تم التشغيل بدقة ${fallback.label}` : `This device can't play 4K smoothly - playing ${fallback.label} instead`,
      ToastAndroid.LONG
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [can4K, currentIs4K, qualityOptions]);
  const hasEpisodesList = !!episode && !!movie.seasons?.length;
  const hasEpisodesListRef = useRef(hasEpisodesList);
  useEffect(() => {
    hasEpisodesListRef.current = hasEpisodesList;
  }, [hasEpisodesList]);
  // The YouTube-style episode row (see EpisodeRow.tsx's own comment) - null means closed. Opening
  // it always jumps straight to the currently-playing episode's season; from there, up/down
  // switch to the adjacent season entirely (replacing this state, not stacking a second row) and
  // left/right move `episodeRowIndex` within whichever season is showing. None of this is real
  // Android focus - same dpadNavActive-routed, JS-owns-the-highlight approach the other three
  // controls already use, extended to a fourth "zone" instead of a fourth persistent button.
  const [episodeRowSeasonNumber, setEpisodeRowSeasonNumber] = useState<number | null>(null);
  const [episodeRowIndex, setEpisodeRowIndex] = useState(0);
  const episodeRowSeasonNumberRef = useRef<number | null>(null);
  const episodeRowIndexRef = useRef(0);
  useEffect(() => {
    episodeRowSeasonNumberRef.current = episodeRowSeasonNumber;
  }, [episodeRowSeasonNumber]);
  useEffect(() => {
    episodeRowIndexRef.current = episodeRowIndex;
  }, [episodeRowIndex]);
  // Mirrors "episodeRowSeasonNumber !== null" for the native nav/OK listeners below (which
  // subscribe once with `[]` deps - same stale-closure reasoning as activeControlRef etc.).
  // Reverted back to this single open/closed flag (an earlier version routed through a 3-level
  // "episodes"/"season"/"seasonAdjust" mode with its own focusable season button) - that read as
  // over-designed and looked worse in practice than just letting UP/DOWN switch seasons directly
  // while browsing, the original, simpler behavior this restores.
  const episodeRowOpenRef = useRef(false);
  useEffect(() => {
    episodeRowOpenRef.current = episodeRowSeasonNumber !== null;
  }, [episodeRowSeasonNumber]);
  // Measured from EpisodeRow's own onLayout (see below) - feeds the shared dark gradient's height
  // (see the JSX below), which needs to grow/shrink smoothly between the control bar's own height
  // and the row's own height as they swap (the bar hides outright while the row is open now -
  // see bottomBar's own comment - rather than the two coexisting side by side).
  const [episodeRowHeight, setEpisodeRowHeight] = useState(s(230));
  // JS-driven (useNativeDriver: false) since it animates a plain `height` style, not a transform -
  // native-driven Animated.Values never propagate to JS-thread listeners at all.
  const episodeRowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(episodeRowAnim, {
      toValue: episodeRowSeasonNumber !== null ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [episodeRowSeasonNumber, episodeRowAnim]);
  // Measured from the bottom control bar's own onLayout - see episodeRowAnim's own comment.
  const [bottomBarHeight, setBottomBarHeight] = useState(s(190));
  const playerRef = useRef<VideoRef>(null);
  const playPauseRef = useRef<View>(null);
  const seekBarRef = useRef<View>(null);
  const subtitlesBtnRef = useRef<View>(null);
  const qualityBtnRef = useRef<View>(null);
  // Which control looks focused - driven explicitly rather than trusting Focusable's own
  // onFocus/onBlur tracking for this. Real D-pad UP/DOWN traversal between play/pause and the
  // seek bar does fire onFocus reliably, but an *imperative* ref.focus() call (used for the
  // initial auto-focus after load, and to route OK back to play/pause) does not appear to on
  // this Android TV setup - the button still genuinely holds focus and responds to presses
  // correctly either way, only the visual highlight was ever missing. Setting this directly
  // wherever focus is meant to land, instead of waiting on a callback that isn't reliably
  // firing, makes the highlight track reality regardless of which path put focus there.
  const [activeControl, setActiveControl] = useState<"playPause" | "seekBar" | "subtitles" | "quality">("playPause");
  // Mirrors activeControl for the native OK-key listener below, which subscribes once ([]
  // deps) and would otherwise only ever see this render's initial (stale) value - same
  // stale-closure shape controlsVisibleRef/currentTimeRef exist to avoid. Needed once OK could
  // mean two different things (toggle play/pause vs open the subtitle panel) depending on which
  // control is actually focused right now.
  const activeControlRef = useRef(activeControl);
  useEffect(() => {
    activeControlRef.current = activeControl;
  }, [activeControl]);
  // nextFocusUp/Down need real Android view-tag numbers (via findNodeHandle), which don't exist
  // until after the first mount - this callback-ref pair forces one extra render once both
  // play/pause and the seek bar have actually mounted, so the handles below resolve to real
  // values instead of undefined forever (same one-shot pattern useFocusClamp uses elsewhere).
  // Both callbacks keep a stable identity (useRef, never redeclared) and only bump once each
  // (bumpedRef guards) - an inline arrow here would get a new identity every render, which React
  // treats as "the ref changed" and re-invokes with the same node on every single render, and an
  // unguarded bump on every truthy call would turn that into an infinite render loop.
  const [focusHandleBump, bumpFocusHandles] = useState(0);
  const bumpedRef = useRef({ playPause: false, seekBar: false, subtitlesBtn: false, qualityBtn: false });
  const setPlayPauseRef = useRef((node: View | null) => {
    playPauseRef.current = node;
    if (node && !bumpedRef.current.playPause) {
      bumpedRef.current.playPause = true;
      bumpFocusHandles((b) => b + 1);
    }
  }).current;
  const setSeekBarRef = useRef((node: View | null) => {
    seekBarRef.current = node;
    if (node && !bumpedRef.current.seekBar) {
      bumpedRef.current.seekBar = true;
      bumpFocusHandles((b) => b + 1);
    }
  }).current;
  const setSubtitlesBtnRef = useRef((node: View | null) => {
    subtitlesBtnRef.current = node;
    if (node && !bumpedRef.current.subtitlesBtn) {
      bumpedRef.current.subtitlesBtn = true;
      bumpFocusHandles((b) => b + 1);
    }
  }).current;
  const setQualityBtnRef = useRef((node: View | null) => {
    qualityBtnRef.current = node;
    if (node && !bumpedRef.current.qualityBtn) {
      bumpedRef.current.qualityBtn = true;
      bumpFocusHandles((b) => b + 1);
    }
  }).current;
  // Resolved once per bump (i.e. essentially once, right after each ref first mounts) instead of
  // via a bare findNodeHandle() inline in JSX on every render - this component re-renders roughly
  // once a second from onProgress alone, and there's no reason for a target that never actually
  // moves to be recomputed that often. Reported intermittently as a control "getting lost" (a
  // D-pad press landing on nothing) - not confirmed as the cause, but a stale/flickering handle
  // recomputed on a fast render cadence is exactly the shape of bug that would only show up
  // "sometimes," and a value resolved once and then left alone removes that whole risk.
  const focusHandles = React.useMemo(
    () => ({
      playPause: findNodeHandle(playPauseRef.current) ?? undefined,
      seekBar: findNodeHandle(seekBarRef.current) ?? undefined,
      subtitlesBtn: findNodeHandle(subtitlesBtnRef.current) ?? undefined,
      qualityBtn: findNodeHandle(qualityBtnRef.current) ?? undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusHandleBump]
  );
  const [paused, setPaused] = useState(false);
  // Exiting tears down the native video surface (stopping playback) and, per App.tsx's own
  // comment on why, remounts Home/Sidebar from scratch rather than just unhiding them - both real
  // work, reported as the app appearing to hang for a moment on the way out with nothing on
  // screen to say otherwise. This overlay paints immediately so there's visible feedback for that
  // gap - see handleExit below for why the actual onExit() call is deferred a beat rather than
  // fired in the same tick (calling both together would let React batch them into one update,
  // removing this component before this state ever got a chance to actually paint first).
  const [exiting, setExiting] = useState(false);
  const handleExit = React.useCallback(() => {
    setExiting((already) => {
      if (!already) {
        // Reported as "exiting takes several seconds, a black screen with the exiting spinner the
        // whole time" - real on-screen timing diagnostics (since removed, their job done) traced
        // this to the active video surface being slow to tear down while still decoding, for both
        // playback paths: YouTube's WebView runs on a hardware-accelerated GPU layer
        // (androidLayerType="hardware" above), and react-native-video's own ExoPlayer surface is
        // equally hardware-accelerated. Explicitly stopping/pausing whichever one is active here -
        // before this component (and its video surface) actually unmounts a moment later - gives
        // the decoder a chance to genuinely wind down ahead of time instead of being torn down
        // mid-decode.
        if (youtubeIdRef.current) ytCommand("player.stopVideo()");
        else playerRef.current?.pause();
        setTimeout(onExit, 60);
      }
      return true;
    });
  }, [onExit]);
  const [progress, setProgress] = useState<OnProgressData | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [showAgeRating, setShowAgeRating] = useState(!!movie.ageRating);
  const [loading, setLoading] = useState(true);
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false);
  // Same floating-button-plus-panel shape as the subtitle settings above, for manually picking a
  // stream quality instead of always taking whichever pickBestServers ordered first - see
  // QualityPanel's own comment for why a plain list needs none of that panel's accordion nesting.
  const [qualityPanelOpen, setQualityPanelOpen] = useState(false);
  // Not part of the persisted SubtitleSettings (font/size/color/background are legitimate
  // global preferences) - a sync fix is specific to *this* one title's particular file/rip.
  // Persisted per movie/episode id (see the load/save effects below), not as a single global
  // value, so a manual fix for one title never silently carries over and breaks a different,
  // already-correctly-synced one.
  //
  // Two numbers, not one: a plain offset (subtitleOffsetMs) can only ever be correct at a single
  // point in the file - reported as "the manual stepper doesn't fully fix it," which is the tell
  // that the real cause on some titles isn't a constant offset at all but a frame-rate mismatch
  // between the video and the subtitle file
  // (e.g. a 23.976fps release timed against a 25fps-authored subtitle) - the gap between them
  // grows the further into the file you go, so no single constant offset can fix more than one
  // moment of it. subtitleSpeed corrects that proportionally; effectiveTime below applies both
  // (speed first, since it's the rate the whole raw timeline runs at, then the constant offset).
  const [subtitleOffsetMs, setSubtitleOffsetMs] = useState(0);
  const [subtitleSpeed, setSubtitleSpeed] = useState(1);
  const syncStorageKey = episode?.id ?? movie.id;
  const syncLoadedRef = useRef(false);
  // Populated below, once subtitleTrack itself is computed further down this function - read
  // through a ref here (not a direct reference) purely because of *source order*, not timing:
  // this effect's own body only ever runs later, asynchronously (after loadJson's own await), by
  // which point every effect from this same render (including the one that fills this ref) has
  // already committed regardless of which one is textually declared first.
  const subtitleTrackDefaultsRef = useRef<{ defaultOffsetMs: number; defaultSpeed: number } | undefined>(undefined);
  useEffect(() => {
    syncLoadedRef.current = false;
    let cancelled = false;
    loadJson<Record<string, SubtitleSyncEntry | number>>(storageKeys.subtitleDelays, {}).then((map) => {
      if (cancelled) return;
      const saved = map[syncStorageKey];
      const serverOffsetMs = subtitleTrackDefaultsRef.current?.defaultOffsetMs ?? 0;
      const serverSpeed = subtitleTrackDefaultsRef.current?.defaultSpeed ?? 1;
      // A saved entry that recorded what the server default was *at save time* (see
      // SubtitleSyncEntry's own comment) and no longer matches the server's current value means
      // an admin has corrected this title's sync (via apps/admin's PreviewModal) since this local
      // save was made - reported as "I saved a correction in the admin panel and the app never
      // picked it up," because a local save, once it existed, used to win unconditionally forever
      // regardless of how stale it got. Falling through to the (now-current) server default here
      // instead of trusting the stale local one is what actually lets a later admin fix land on a
      // device that already has an old save for this exact title. A legacy save with no recorded
      // server-at-save values (plain-number format, or an object saved before this field existed)
      // can't be judged either way, so it's still trusted as-is rather than discarded.
      const isStaleAgainstNewServerDefault =
        saved &&
        typeof saved !== "number" &&
        saved.serverOffsetMsAtSave !== undefined &&
        saved.serverSpeedAtSave !== undefined &&
        (saved.serverOffsetMsAtSave !== serverOffsetMs || saved.serverSpeedAtSave !== serverSpeed);

      if (typeof saved === "number") {
        // The pre-speed-correction save format (just a delay in ms, speed implicitly 1) - read
        // the same way it always behaved instead of discarding it.
        setSubtitleOffsetMs(saved);
        setSubtitleSpeed(1);
      } else if (saved && !isStaleAgainstNewServerDefault) {
        setSubtitleOffsetMs(saved.offsetMs);
        setSubtitleSpeed(saved.speed);
      } else {
        // Either no local override yet for this exact title, or one that turned out to be stale
        // against a newer server default (see isStaleAgainstNewServerDefault above) - start from
        // the backend's own manually-entered default instead of always defaulting to "no
        // correction," so a viewer gets whatever the admin panel already has on file for this
        // title, not silently reset to unsynced.
        setSubtitleOffsetMs(serverOffsetMs);
        setSubtitleSpeed(serverSpeed);
      }
      syncLoadedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [syncStorageKey]);
  useEffect(() => {
    if (!syncLoadedRef.current) return;
    loadJson<Record<string, SubtitleSyncEntry | number>>(storageKeys.subtitleDelays, {}).then((map) => {
      saveJson(storageKeys.subtitleDelays, {
        ...map,
        [syncStorageKey]: {
          offsetMs: subtitleOffsetMs,
          speed: subtitleSpeed,
          // Recorded so a *future* admin correction (see isStaleAgainstNewServerDefault above)
          // can tell this save apart from one that already reflects it.
          serverOffsetMsAtSave: subtitleTrackDefaultsRef.current?.defaultOffsetMs ?? 0,
          serverSpeedAtSave: subtitleTrackDefaultsRef.current?.defaultSpeed ?? 1,
        },
      });
    });
  }, [subtitleOffsetMs, subtitleSpeed, syncStorageKey]);

  const handleManualOffsetChange = (ms: number) => {
    setSubtitleOffsetMs(ms);
  };
  const handleManualSpeedChange = (sp: number) => {
    setSubtitleSpeed(sp);
  };

  // "Continue watching" - resumes from wherever this exact title (movie or episode) last
  // stopped, instead of always restarting from zero. Loaded once per syncStorageKey and consumed
  // by the player's own onLoad below (seeking has to wait for a real duration to sanity-check
  // against - see there); saved periodically from onProgress and once more on unmount so the
  // last few seconds before closing the player aren't lost between saves.
  interface WatchProgressEntry {
    positionSeconds: number;
    durationSeconds: number;
    updatedAt: number;
  }
  const pendingResumeRef = useRef<WatchProgressEntry | null>(null);
  const lastProgressSaveRef = useRef(0);
  // See progressUpdateInterval's own comment below - the *state* update that re-renders the
  // whole screen (seek bar, time labels) stays throttled to roughly once a second through this,
  // even though onProgress itself now fires much more often.
  const lastProgressStateRef = useRef(0);
  // Subtitle cue lookup runs on every onProgress tick (not gated behind the throttle above) -
  // see currentCue's own comment for why cue timing specifically needed the tighter interval.
  const [cueText, setCueText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadJson<Record<string, WatchProgressEntry>>(storageKeys.watchProgress, {}).then((map) => {
      if (cancelled) return;
      pendingResumeRef.current = map[syncStorageKey] ?? null;
    });
    return () => {
      cancelled = true;
    };
  }, [syncStorageKey]);
  const saveWatchProgress = (positionSeconds: number, durationSeconds: number) => {
    // Within the last ~2% or 30s counts as "finished" - clearing it (rather than saving a
    // near-the-end position) is what makes a completed title start over next time instead of
    // resuming one scene from its own credits.
    const nearEnd = durationSeconds > 0 && (positionSeconds > durationSeconds * 0.98 || positionSeconds > durationSeconds - 30);
    loadJson<Record<string, WatchProgressEntry>>(storageKeys.watchProgress, {}).then((map) => {
      const next = { ...map };
      if (nearEnd || positionSeconds < 10) {
        delete next[syncStorageKey];
      } else {
        next[syncStorageKey] = { positionSeconds, durationSeconds, updatedAt: Date.now() };
      }
      saveJson(storageKeys.watchProgress, next);
    });
  };
  useEffect(() => {
    return () => {
      if (currentTimeRef.current > 0) saveWatchProgress(currentTimeRef.current, progress?.seekableDuration ?? 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStorageKey]);

  const subtitlePanelOpenRef = useRef(false);
  useEffect(() => {
    subtitlePanelOpenRef.current = subtitlePanelOpen;
  }, [subtitlePanelOpen]);
  const qualityPanelOpenRef = useRef(false);
  useEffect(() => {
    qualityPanelOpenRef.current = qualityPanelOpen;
  }, [qualityPanelOpen]);

  // Suspends both native key-capture flags (see MainActivity.kt/KeyEventBridgeModule) while the
  // panel is up, handing left/right/OK straight back to Android's normal focus/press engine -
  // exactly what the panel's own plain Focusable buttons need to navigate and select normally.
  // Re-enabling them on close is what makes hold-to-seek, D-pad nav, and the play/pause OK-
  // routing work again once the panel is gone. The actual native flag updates happen in the
  // reactive effect above (keyed on subtitlePanelOpen) - these two just flip the state that
  // drives it.
  const openSubtitlePanel = () => setSubtitlePanelOpen(true);
  // Every previous version of this function fought to land *real* Android focus back on the
  // subtitles button on close - however it closed (the panel's own down-exit chain, the back
  // button, its X), whatever was last focused *inside* the panel was about to be ripped out of
  // the tree, and Android's own "guess something sane to focus next" recovery after that has
  // proven unreliable in every shape it's been tried in (a stale handle, a lost retry race, a bad
  // guess) - reported over and over as control getting lost after closing. None of that chasing
  // is needed any more: real focus among the three main controls is no longer what drives
  // anything (see the onNavKey state machine above and forceFocused on each control) - setting
  // activeControl here is the *entire* fix, independent of wherever real Android focus actually
  // ends up once the panel's own views are gone.
  const closeSubtitlePanel = () => {
    setSubtitlePanelOpen(false);
    setActiveControl("subtitles");
  };
  const openQualityPanel = () => setQualityPanelOpen(true);
  // Same reasoning as closeSubtitlePanel above - setting activeControl is the entire fix,
  // independent of wherever real Android focus inside the panel actually was.
  const closeQualityPanel = () => {
    setQualityPanelOpen(false);
    setActiveControl("quality");
  };

  // Opens straight onto the currently-playing episode's own season/index - "browsing" always
  // starts from "here," matching the reported want, not season 1 regardless of what's playing.
  const openEpisodeRow = () => {
    if (!season) return;
    const idx = movie.seasons?.find((sn) => sn.number === season.number)?.episodes.findIndex((e) => e.id === episode?.id) ?? 0;
    setEpisodeRowIndex(Math.max(0, idx));
    setEpisodeRowSeasonNumber(season.number);
  };
  // Closes it outright (the control bar reappears in its place - see bottomBar's own comment) -
  // there's no separate "focused but still visible" state to fall back to any more.
  const closeEpisodeRow = () => setEpisodeRowSeasonNumber(null);
  // Pressing a card used to call closeEpisodeRow() synchronously, right there in the onPress
  // handler below - that tore the whole row down (the pressed card's own resolving spinner,
  // driven by `resolvingEpisodeId`, included) before a single frame of it could ever paint,
  // reported as the episode list "disappearing immediately" with no loading feedback. Recording
  // which episode was pressed and closing only once `resolvingEpisodeId` (set by App.tsx's
  // selectEpisodeInPlayer, which enforces its own floor - see MIN_RESOLVE_MS there) actually
  // clears again is what lets the spinner show for real before the row goes away.
  const pendingEpisodeSelectRef = useRef<string | null>(null);
  useEffect(() => {
    if (pendingEpisodeSelectRef.current && resolvingEpisodeId == null) {
      pendingEpisodeSelectRef.current = null;
      closeEpisodeRow();
    }
  }, [resolvingEpisodeId]);
  // The onNavKey listener below subscribes once ([] deps, same reasoning as activeControlRef
  // etc.) - keeps it calling whatever the *latest* open/close actually is instead of the stale one
  // closed over at that one-time subscription.
  const openEpisodeRowRef = useRef(openEpisodeRow);
  const closeEpisodeRowRef = useRef(closeEpisodeRow);
  const onSelectEpisodeRef = useRef(onSelectEpisode);
  useEffect(() => {
    openEpisodeRowRef.current = openEpisodeRow;
    closeEpisodeRowRef.current = closeEpisodeRow;
    onSelectEpisodeRef.current = onSelectEpisode;
  });

  const title = episode ? `${movie.titleAr || movie.titleEn} - ${episode.titleAr || episode.titleEn}` : movie.titleAr || movie.titleEn;

  // Pushed onto the shared backStack (see src/backStack.ts's own top comment) instead of calling
  // BackHandler.addEventListener directly - same reasoning as MovieDetailsScreen's identical
  // handler.
  useEffect(() => {
    return pushBackHandler(() => {
      if (subtitlePanelOpenRef.current) {
        closeSubtitlePanel();
        return true;
      }
      if (qualityPanelOpenRef.current) {
        closeQualityPanel();
        return true;
      }
      if (episodeRowOpenRef.current) {
        closeEpisodeRowRef.current();
        return true;
      }
      handleExit();
      return true;
    }, "VideoPlayer");
  }, [handleExit]);

  // hasTVPreferredFocus alone occasionally lost the race against this screen's own initial
  // layout pass (the same class of timing issue documented on the sidebar's home icon) - when
  // that happened literally nothing on screen was focused, so the remote's play/pause/seek
  // presses had no view to land on and did nothing at all - reported as "unstable, takes
  // several presses before the controls respond." A single 300ms retry was one shot at that
  // race, which still isn't enough on a slower box or when the video is slow to start
  // buffering (the layout pass this depends on can land well past 300ms in that case) - retrying
  // several times with backoff, and again once loading actually finishes, covers both a
  // one-off slow layout and a slow-to-buffer stream without needing to know which happened.
  // Calling .focus() on a view that's already focused is a no-op, so retrying is harmless.
  useEffect(() => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryFocus = () => {
      attempt += 1;
      (playPauseRef.current as any)?.focus?.();
      if (attempt < 6) timer = setTimeout(tryFocus, attempt * 250);
    };
    timer = setTimeout(tryFocus, 150);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // react-native-video's own textTracks pipeline hands subtitle rendering off to the OS's
  // subtitle view, which has no font/color/size/background hook exposed through this
  // library's props - there is no way to make the subtitle-style settings below actually do
  // anything through that path. Fetching and rendering the cues ourselves is what makes them
  // configurable at all.
  //
  // Subtitle tracks come straight from the episode (fetched alongside its streams, see
  // fetchEpisodePlayback) or the movie's own detail fetch - both real, admin-managed or
  // OpenSubtitles-resolved links, never a separate lookup of our own. Arabic is preferred,
  // falling back to whatever single track exists otherwise.
  const availableSubtitles = episode?.subtitles?.length ? episode.subtitles : movie.subtitles;
  const subtitleTrack = pickSubtitleTrack(availableSubtitles, subtitleSettings.language);
  useEffect(() => {
    subtitleTrackDefaultsRef.current = subtitleTrack
      ? { defaultOffsetMs: subtitleTrack.defaultOffsetMs, defaultSpeed: subtitleTrack.defaultSpeed }
      : undefined;
  }, [subtitleTrack]);
  useEffect(() => {
    if (!subtitleTrack) {
      setCues([]);
      return;
    }
    let cancelled = false;
    fetch(subtitleTrack.url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Read as raw bytes, not res.text() (which always decodes as UTF-8 with no way to
        // override that) - some admin-added .srt files turn out to actually be Windows-1256, and
        // decoding those bytes as UTF-8 doesn't error, it just silently produces the "unclear
        // symbols" reported: every non-ASCII UTF-8 continuation byte gets reinterpreted as its
        // own unrelated Windows-1256 character. decodeSubtitleBytes tries real UTF-8 first and
        // only falls back once that's proven not to be what the file actually is.
        return res.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setCues(parseVtt(decodeSubtitleBytes(buffer)));
      })
      .catch((err) => console.error("[VideoPlayer] subtitle fetch failed:", err));
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on this one field
  }, [subtitleTrack?.url]);

  useEffect(() => {
    if (!movie.ageRating) return;
    const timer = setTimeout(() => setShowAgeRating(false), AGE_RATING_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [movie.ageRating]);

  // Fades the bars a few seconds after the last real input (a focus change, a press, a seek
  // tick) - reachability is now handled by explicit nextFocusUp/Down plus the raw left/right
  // seek capture below, not by leaving the bars permanently up, so it's safe to hide again.
  // Not gated on `loading`/isBuffering (a stuttering stream flips that rapidly, which would
  // re-arm the timer on every tick and make the overlay read as permanently stuck) - wake()
  // only ever fires from actual viewer input.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors controlsVisible for the native OK-key listener below, which (like the seek listener)
  // subscribes once with `[]` deps and would otherwise only ever see this render's initial
  // (stale) `controlsVisible` value forever - the same stale-closure shape currentTimeRef exists
  // to avoid.
  const controlsVisibleRef = useRef(true);
  const armHideTimer = () => {
    hideTimer.current = setTimeout(() => {
      // Selecting an episode can take well past 4s (pickBestServers probes each server, up to
      // ~4s each - see DetailButton's own comment on the same call in MovieDetailsScreen) with
      // nothing else counting as "real viewer input" to re-wake() in between - the bars (and the
      // episode row's own resolving spinner riding along with them via barsHidden) would
      // otherwise fade out mid-resolve, reported as the row "closing quickly" with no loading
      // feedback ever visible. Re-checking instead of actually hiding while a selection is still
      // in flight (see pendingEpisodeSelectRef) keeps both up for the whole wait.
      // Same idea, for a YouTube-sourced video that's actively rebuffering (see ytBufferingRef's
      // own comment) - per explicit request, the bar was fading out mid-stall with nothing on
      // screen to say the video was still trying to catch up, exactly the "row closing quickly
      // with no loading feedback" problem above, just for a stall instead of an episode select.
      // Also while it's still loading at all (loadingRef) - a slow initial load, or one that
      // outlasted an early impatient keypress that had already armed this same timer, used to be
      // able to expire *before* the video ever actually appeared, so the bar (and, for YouTube
      // specifically, the darkening layers hiding its own logo/overlay) were already hidden the
      // instant real content finally showed - reported as "make the bar show while loading, to
      // hide YouTube's marks." And while explicitly paused (ytPausedRef, YouTube-sourced only) -
      // per explicit request, pausing shouldn't eventually hide the only way back to resuming.
      if (pendingEpisodeSelectRef.current || ytBufferingRef.current || loadingRef.current || (youtubeIdRef.current && ytPausedRef.current)) {
        armHideTimer();
        return;
      }
      controlsVisibleRef.current = false;
      setControlsVisible(false);
      // Was raised from 4000 to 7000 then 10000, but every one of those increases was actually
      // motivated by YouTube-specific problems (mid-buffer fades, hiding YouTube's own logo/
      // overlay marks long enough - see this timer's own callers' comments) - applying that same
      // longer delay to native playback too was just this timer being shared, not something
      // native itself ever needed. Per explicit request, native goes back to the original 4000ms;
      // only YouTube-sourced playback keeps the longer 10000ms.
    }, youtubeIdRef.current ? 10000 : 4000);
  };
  const wake = () => {
    controlsVisibleRef.current = true;
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    armHideTimer();
  };

  // Hoisted out of the EpisodeRow render site's own inline IIFE (see its own comment) so the
  // season lookup and both callback props stay referentially stable across renders instead of a
  // fresh object/closure every time - required for EpisodeRow's own React.memo (see its comment)
  // to actually skip re-rendering on VideoPlayer's ~4x/second cueText-driven re-renders.
  const episodeRowSeason = React.useMemo(
    () => (movie.seasons ?? []).find((sn) => sn.number === episodeRowSeasonNumber) ?? null,
    [movie.seasons, episodeRowSeasonNumber]
  );
  const handleEpisodeRowWatched = React.useCallback(
    (seasonNumber: number, episodeNumber: number) => isEpisodeWatched?.(seasonNumber, episodeNumber) ?? false,
    [isEpisodeWatched]
  );
  const handleEpisodeRowSelect = React.useCallback(
    (ep: Episode) => {
      if (!ep.hasPlayableStream || !episodeRowSeason) return;
      pendingEpisodeSelectRef.current = ep.id;
      wake();
      onSelectEpisode?.(ep, episodeRowSeason);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSelectEpisode, episodeRowSeason]
  );

  // Deliberately NOT "wake() once at mount" - that started the 4s countdown from the moment this
  // screen appeared, regardless of whether the stream had actually buffered in yet. A slow-to-
  // open stream (reported specifically for hero-carousel playback, which has no loading feedback
  // of its own before this screen even mounts - see playOrShowDetails in App.tsx) could hide the
  // controls before the viewer ever saw them, and since nothing else called wake() afterward,
  // they'd stay hidden through the rest of playback. The reveal below (on the loading->false
  // transition) is what actually starts the clock now, so "when it fades" is tied to "since you
  // could actually see anything," not "since this component happened to mount."
  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // YouTube playback bridge (see the youtubeId branch further below) - postMessage-driven play/
  // pause/seek and time-sync, replacing react-native-video's own progress callback + imperative
  // .seek() for this content type. OK toggles play/pause and left/right seeks by a fixed step,
  // reusing the exact same okCaptureActive/leftRightSeekActive native channels the three regular
  // controls already rely on (see their own comment on why real Android focus can't drive this
  // reliably) - there's deliberately no attempt to reconcile this with the native mode's own
  // three-control switching system, since there's only ever one thing to control here.
  // any, not WebView<undefined> - the generic class ref type triggers a TS overload-resolution
  // failure on the JSX element itself (react-native-webview's WebView<P> generic confuses
  // TypeScript's ref inference once P needs resolving) - only .injectJavaScript() is ever called
  // on this anyway, matching the same any-typed-ref convention this app's own scroll refs
  // (HomeScreen/BrowseScreen's scrollRef/gridScrollRef) already use for imperative-only refs.
  const ytWebViewRef = useRef<any>(null);
  const [ytPaused, setYtPaused] = useState(false);
  const [ytCurrentTime, setYtCurrentTime] = useState(0);
  const [ytDuration, setYtDuration] = useState(0);
  // Purely diagnostic - the last "diag:"/"error:" message this page's own WebView bridge reported
  // (see the html script's own comment on why this needed adding at all), shown as a small line on
  // the shared "not available" screen only while this was actually a YouTube playback, specifically
  // so a report of "it just doesn't play" comes with an actual stage/error code attached next time
  // instead of needing a guess-and-rebuild cycle with no visibility into what the WebView itself
  // ever actually saw.
  const [ytDiag, setYtDiag] = useState<string | null>(null);
  // Recomputed on every polled tick regardless of the throttle below - see its own comment,
  // mirrors currentCue's identical reasoning for native playback exactly.
  const [ytCueText, setYtCueText] = useState<string | null>(null);
  const lastYtProgressStateRef = useRef(0);
  const ytPausedRef = useRef(false);
  const ytCurrentTimeRef = useRef(0);
  // Read by armHideTimer above - true only while YT.PlayerState.BUFFERING (3) is the last state
  // reported, set from the "diag:state:" messages already flowing through onMessage below (the
  // shared backend page posts one on every state change regardless of whether anything here was
  // listening for it). Not React state deliberately - this only ever needs to be read once, at
  // the moment the hide timer is about to fire, never something a render needs to react to.
  const ytBufferingRef = useRef(false);
  useEffect(() => {
    ytPausedRef.current = ytPaused;
  }, [ytPaused]);
  useEffect(() => {
    ytCurrentTimeRef.current = ytCurrentTime;
  }, [ytCurrentTime]);
  const ytCommand = (js: string) => ytWebViewRef.current?.injectJavaScript(`${js}; true;`);

  // Read from the shared onNavKey/onOkKey listener below (empty-deps, so only ever a ref can give
  // it this render's real value) to branch its play/pause-toggle and seek-bar-hold handling
  // between this and the native <Video> path, instead of a second, separate set of key listeners.
  // An earlier version of this branch DID register its own separate onOkKey/onSeekKey listeners
  // with their own setLeftRightSeekActive(true) - removed for two real reasons, not just
  // redundancy: (1) KeyEventBridgeModule's own dispatchKeyEvent checks dpadNavActive *before*
  // leftRightSeekActive and returns immediately on a match (see MainActivity.kt) - dpadNavActive
  // is unconditionally on here too (the reactive flag-sync effect below doesn't know or care
  // about youtubeId), so left/right was actually always being routed to the shared onNavKey
  // handler instead, meaning that separate onSeekKey listener this branch registered could never
  // actually fire at all; and (2) leftRightSeekActive staying on for this branch's entire
  // lifetime, independent of subtitlePanelOpen, meant left/right inside the subtitle panel itself
  // (real Android focus, needs these two keys back for its own buttons) would have been silently
  // swallowed too, the moment this branch's own effect had a chance to actually run.
  const youtubeIdRef = useRef<string | null>(null);
  useEffect(() => {
    youtubeIdRef.current = youtubeId;
  }, [youtubeId]);

  // Falls through to the same "not available" screen every other exhausted server already shows
  // if the video never actually reaches PLAYING within a generous window - reported as "the
  // player just shows the bar/play button forever with nothing happening," which used to have no
  // way out at all: this branch has no other server to advance to (see the retryFocus-adjacent
  // reasoning elsewhere in this file for onError's own MAX_MIDSTREAM_RETRIES), and neither
  // WebView's own onError nor the YT player's own onError fire for "the embed silently never
  // started" - only for a hard, explicit failure (removed/private/embedding-disabled). Cleared by
  // the 'playing' message itself (see onMessage below) via loadingRef staying false by then.
  const loadingRef = useRef(loading);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    if (!youtubeId) return;
    // Raised from 15000 - reported as an intermittent "not available" on a device that's
    // otherwise capable of playing the video at all (see androidLayerType="hardware" above),
    // just slow to actually start doing so - a marginal device buffering a YouTube-hosted movie
    // needs meaningfully more headroom than a first pass through this window assumed, and this
    // window only ever costs anything on a title that would have failed anyway (a title that
    // starts within it clears loadingRef before this ever fires, same as before).
    const timer = setTimeout(() => {
      if (loadingRef.current) {
        setYtDiag((prev) => `diag:timeout(last=${prev ?? "none"})`);
        setUnavailable(true);
      }
    }, 30000);
    return () => clearTimeout(timer);
  }, [youtubeId]);

  // Only for the *initial* load, not every rebuffer recovery mid-playback - this used to
  // re-fire on every loading->false transition, including ones well after the video was
  // already playing (any brief rebuffer stall). Each re-focus call was indirectly re-arming
  // the auto-hide timer via CtrlButton's onFocus->wake(), which is exactly what "wake() only
  // fires from real viewer input" (see wake's own comment) was trying to avoid - so a stream
  // that rebuffered even occasionally kept the controls up for the rest of playback, reported
  // as "the bar never disappears" specifically on titles/paths prone to a mid-playback stall.
  // Focus only needs rescuing once, right after the initial buffer-in; after that it's already
  // sitting on play/pause with nothing else to steal it.
  const hasFocusedAfterLoadRef = useRef(false);
  useEffect(() => {
    if (loading || hasFocusedAfterLoadRef.current) return;
    hasFocusedAfterLoadRef.current = true;
    const timer = setTimeout(() => {
      setActiveControl("playPause");
      (playPauseRef.current as any)?.focus?.();
      // This is the very first reveal now (see wake's own mount-effect comment above) - without
      // it here, nothing ever shows the bar at all once the mount-time wake() call was removed.
      wake();
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on this one field
  }, [loading]);

  // Holding rewind/forward repeats a seek every HOLD_SEEK_INTERVAL_MS for as long as it's held -
  // this is the app's only D-pad-native way to reach an arbitrary point at all (see the comment
  // above SeekBar for why a real continuously-dragged scrub thumb isn't possible on this RN
  // version). Two real bugs in how that repeat computed its target were the actual cause of "it
  // jumps and doesn't show where it lands":
  // 1) Each tick recomputed its target from `progress.currentTime`, but that only updates from
  //    the player's own onProgress callback, which fires roughly once a second - far slower
  //    than the 350ms tick. Several ticks in a row would read the same stale value and re-seek
  //    to the exact same spot instead of accumulating, so a hold felt like it randomly "caught
  //    up" in one big leap once onProgress finally fired instead of moving smoothly.
  // 2) The seek bar's thumb is also driven by `progress.currentTime` (see SeekBar), so it was
  //    just as stale - it wouldn't visibly move to reflect where a hold had actually sought to
  //    until that same slow onProgress event arrived, reading as "doesn't show the current
  //    reach point" even though the player itself had already seeked there.
  // The fix for both: track the in-flight target in a ref (accumulated locally every tick,
  // independent of onProgress) and mirror it into `holdSeekPreview` state, which SeekBar prefers
  // over `currentTime` whenever it's non-null - so both the actual seek and the drawn position
  // advance in lockstep with every tick, never waiting on the player to confirm.
  const seekHoldTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const seekHoldTargetRef = useRef<number | null>(null);
  const seekHoldTickRef = useRef(0);
  const [holdSeekPreview, setHoldSeekPreview] = useState<number | null>(null);

  // The native key listener below subscribes once (empty deps - re-subscribing on every
  // progress tick would mean tearing down and rebuilding the native listener 4x/second) and
  // calls startHoldSeek from that *original* closure forever after. Reading `progress` (state)
  // directly here used to mean every single seek attempt, no matter how much later, saw
  // whatever `progress` was at the very first render - null, i.e. 0 - which is exactly why
  // seeking forward always landed a fixed ~10s from zero and never actually advanced. A ref
  // updated every tick is immune to that: `.current` is always the latest value regardless of
  // which render's closure is reading it.
  const currentTimeRef = useRef(0);
  useEffect(() => {
    currentTimeRef.current = progress?.currentTime ?? 0;
  }, [progress?.currentTime]);

  // See onError's own pendingResumeRef usage below - a manual quality switch reloads the <Video>
  // source exactly the same way a fallback-to-next-server does, so it needs the same "remember
  // where we were, seek back to it once onLoad fires" handling, or the viewer would be dropped
  // back to 0:00 every time they picked a different quality.
  const handleSelectQuality = (index: number) => {
    if (index === serverIndex) {
      closeQualityPanel();
      return;
    }
    // A manual pick becomes the new global default for every title played after this one - see
    // this component's own Props comment on preferredQuality/onChangePreferredQuality.
    const server = servers[index];
    if (server) onChangePreferredQuality(qualityLabel(server.quality, lang));
    pendingResumeRef.current = {
      positionSeconds: currentTimeRef.current,
      durationSeconds: progress?.seekableDuration ?? 0,
      updatedAt: Date.now(),
    };
    setServerIndex(index);
    closeQualityPanel();
  };

  // Many TV remotes deliver a held button as a rapid series of discrete down/up pulses rather
  // than one continuous down-state (confirmed on-device: holding right kept re-seeking to the
  // exact same +10s instead of ramping up). Each pulse's "down" was restarting the whole hold
  // from scratch, and since onProgress only reports the real position back about once a
  // second, currentTimeRef hadn't caught up between pulses - every restart recomputed from the
  // same stale base, so it never looked like it moved past the first tick's +10.
  // Fix: an incoming "down" while a hold in the same direction is already running is a no-op
  // (the running interval keeps ramping uninterrupted); an incoming "up" is debounced briefly -
  // if the next pulse's "down" arrives before the debounce fires, the stop is cancelled and the
  // *same* hold continues instead of restarting.
  const activeHoldDirectionRef = useRef<1 | -1 | null>(null);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOLD_STOP_DEBOUNCE_MS = 220;

  const startHoldSeek = (direction: 1 | -1) => {
    if (stopDebounceRef.current) {
      clearTimeout(stopDebounceRef.current);
      stopDebounceRef.current = null;
    }
    if (activeHoldDirectionRef.current === direction && seekHoldTimer.current) {
      return; // Already ramping in this direction - a repeat pulse, not a new press.
    }
    activeHoldDirectionRef.current = direction;
    seekHoldTargetRef.current = youtubeIdRef.current ? ytCurrentTimeRef.current : currentTimeRef.current;
    seekHoldTickRef.current = 0;
    const tick = () => {
      // Ramps from 10s/tick up to 60s/tick the longer it stays held - fine control for a short
      // correction, but covering a long movie's runtime doesn't take forever either.
      const step = HOLD_SEEK_STEPS[Math.min(seekHoldTickRef.current, HOLD_SEEK_STEPS.length - 1)];
      seekHoldTickRef.current += 1;
      const next = Math.max(0, (seekHoldTargetRef.current ?? 0) + direction * step);
      seekHoldTargetRef.current = next;
      wake();
      // YouTube's own 250ms getCurrentTime() poll (see onMessage's own "time" handling) turns out
      // to be exactly as laggy as react-native-video's onProgress here - it kept reporting the
      // pre-seek position for a beat after each seekTo() call, and since that poll unconditionally
      // overwrote ytCurrentTime every 250ms regardless of a hold in progress, the bar snapped back
      // to the old spot and waited for the real position to catch up instead of holding the target
      // (reported as "seeking doesn't stick, it goes back and waits to load"). The exact same
      // pendingSeekTargetRef/holdSeekPreview reconciliation already built for that native-side lag
      // (see its own comment below) fixes this the same way - ytCurrentTime itself is deliberately
      // left untouched here now; the bar reads holdSeekPreview instead until the real polled value
      // actually catches up to it.
      pendingSeekTargetRef.current = next;
      setHoldSeekPreview(next);
      if (youtubeIdRef.current) {
        ytCommand(`player.seekTo(${next}, true)`);
        return;
      }
      playerRef.current?.seek(next);
    };
    tick();
    if (seekHoldTimer.current) clearInterval(seekHoldTimer.current);
    seekHoldTimer.current = setInterval(tick, HOLD_SEEK_INTERVAL_MS);
  };
  const finishHoldSeek = () => {
    if (seekHoldTimer.current) {
      clearInterval(seekHoldTimer.current);
      seekHoldTimer.current = null;
    }
    activeHoldDirectionRef.current = null;
    seekHoldTargetRef.current = null;
    // holdSeekPreview is deliberately left showing here (see pendingSeekTargetRef below) -
    // clearing it the instant the hold stops used to snap the bar straight back to the
    // pre-seek position for however long the player took to actually buffer into the new
    // spot, reported as "the bar goes back and waits to load before moving." The player's own
    // .seek() calls (already issued, once per tick) are unaffected by any of this - only the
    // bar's drawn position was ever wrong.
  };
  const stopHoldSeek = () => {
    if (stopDebounceRef.current) clearTimeout(stopDebounceRef.current);
    stopDebounceRef.current = setTimeout(finishHoldSeek, HOLD_STOP_DEBOUNCE_MS);
  };

  // The last position actually sought to, kept around after the hold itself ends. holdSeekPreview
  // stays pinned here instead of reverting to (stale) progress.currentTime until the player's own
  // onProgress finally reports a real position within range of it - at which point the real value
  // has caught up and it's safe to hand the bar back over to it.
  const pendingSeekTargetRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingSeekTargetRef.current == null || !progress) return;
    if (Math.abs(progress.currentTime - pendingSeekTargetRef.current) < 2) {
      pendingSeekTargetRef.current = null;
      setHoldSeekPreview(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on this one field
  }, [progress?.currentTime]);
  // Same reconciliation as above, for YouTube's own polled ytCurrentTime instead of
  // react-native-video's onProgress - see startHoldSeek's own comment on why this branch turned
  // out to need it too, not just native playback.
  useEffect(() => {
    if (pendingSeekTargetRef.current == null) return;
    if (Math.abs(ytCurrentTime - pendingSeekTargetRef.current) < 2) {
      pendingSeekTargetRef.current = null;
      setHoldSeekPreview(null);
    }
  }, [ytCurrentTime]);

  // The root fix for "control gets lost on the video controls," reported repeatedly across this
  // whole screen's history through several different specific causes (a stale node handle, a
  // lost retryFocus race, Android's own unreliable recovery after a focused view was removed...).
  // Every one of those was really the same underlying problem wearing a different hat: real
  // Android focus (nextFocusUp/Down/Left/Right, imperative .focus(), the whole apparatus needed
  // to keep it pinned to the right place across the controls hiding/showing) is just not
  // trustworthy on this hardware for driving navigation among these three controls. This listener
  // (paired with KeyEventBridgeModule.dpadNavActive, active for as long as it's these three
  // controls' turn to own D-pad input - i.e. never while the subtitle panel itself is open, which
  // still navigates its own controls via ordinary Android focus) captures all four directions and
  // makes activeControl the single, plain-JS source of truth for which of the three is "active" -
  // no view ever has to actually hold real focus for any of this to work correctly, since the
  // visual highlight already reads forceFocused={activeControl === "..."} and OK already routes
  // through onOkKey below by the same activeControlRef, independent of real focus either way.
  useEffect(() => {
    const { KeyEventBridge } = NativeModules;
    const emitter = new NativeEventEmitter(KeyEventBridge);
    const navSub = emitter.addListener("onNavKey", (event: any) => {
      const { direction, action } = event as { direction: "up" | "down" | "left" | "right"; action: "down" | "up" };
      if (!controlsVisibleRef.current) {
        if (action === "down") wake();
        return;
      }
      if (action !== "down") {
        // The seek bar's own hold-to-seek still needs the "up" (key-release) half of a left/right
        // press even while the episode row is open - the row itself has nothing analogous to
        // release-handle, so only forward this when the row isn't the one currently active.
        if (!episodeRowOpenRef.current && activeControlRef.current === "seekBar") {
          if (direction === "left" || direction === "right") stopHoldSeek();
        }
        return;
      }

      // The episode row (see EpisodeRow.tsx/openEpisodeRow) owns all four directions itself while
      // open, entirely separately from the three main controls' own activeControl state machine
      // below - left/right move within whichever season is currently showing, up/down replace it
      // with the adjacent season outright (the original, simpler behavior - a separate focusable
      // season button that had to be selected first, then adjusted, turned out to look and feel
      // worse than just letting up/down switch it directly while browsing).
      if (episodeRowOpenRef.current) {
        const seasons = movie.seasons ?? [];
        const seasonIdx = seasons.findIndex((sn) => sn.number === episodeRowSeasonNumberRef.current);
        const currentSeason = seasons[seasonIdx];
        if (!currentSeason) return;
        wake();
        if (direction === "left") {
          setEpisodeRowIndex((i) => Math.max(0, i - 1));
        } else if (direction === "right") {
          setEpisodeRowIndex((i) => Math.min(currentSeason.episodes.length - 1, i + 1));
        } else if (direction === "down") {
          const next = seasons[seasonIdx + 1];
          if (next) {
            setEpisodeRowIndex(0);
            setEpisodeRowSeasonNumber(next.number);
          }
        } else if (direction === "up") {
          const prev = seasons[seasonIdx - 1];
          if (prev) {
            setEpisodeRowIndex(0);
            setEpisodeRowSeasonNumber(prev.number);
          }
          // Already the first season - stays put rather than closing the row.
        }
        return;
      }

      const current = activeControlRef.current;
      // Real seeking only ever happens while the seek bar itself is the active control -
      // everywhere else left/right just move between play/pause and the subtitles button below.
      if (current === "seekBar" && (direction === "left" || direction === "right")) {
        startHoldSeek(direction === "right" ? 1 : -1);
        return;
      }
      wake();
      if (direction === "up" && current !== "seekBar") setActiveControl("seekBar");
      else if (direction === "down" && current === "seekBar") setActiveControl("playPause");
      // Spatial order left-to-right is playPause, quality, subtitles (see qualityBtnFloat's own
      // comment on why it sits one button-width-plus-gap left of the subtitles button) - left/
      // right walk that same order regardless of which of the three is currently active.
      else if (direction === "left" && current === "subtitles") setActiveControl("quality");
      else if (direction === "left" && current === "quality") setActiveControl("playPause");
      else if (direction === "right" && current === "playPause") setActiveControl("quality");
      else if (direction === "right" && current === "quality") setActiveControl("subtitles");
      // Down from play/pause opens the row instead of being a no-op, exactly like pressing down
      // to reveal a video's description/playlist below it - guarded by hasEpisodesListRef so a
      // movie (no seasons) never does anything on this press.
      else if (direction === "down" && current === "playPause" && hasEpisodesListRef.current) {
        openEpisodeRowRef.current();
      }
    });
    // OK/select, captured the same way and for the same reason as the directions above - a
    // focused Pressable's onPress *should* fire on DPAD_CENTER/ENTER without any of this, but
    // focus on Android TV has repeatedly proven unreliable to keep pinned to the right control
    // across a hidden/visible transition (reported as "can't reach the pause button," "OK does
    // nothing"). This stays active regardless of which control is focused - the reliability
    // problem isn't specific to any one of them.
    const okSub = emitter.addListener("onOkKey", (event: any) => {
      const { action } = event as { action: "down" | "up" };
      if (action !== "down") return;
      if (!controlsVisibleRef.current) {
        wake();
        return;
      }
      // OK while the episode row is open plays whichever card is currently highlighted -
      // episodeRowIndexRef/episodeRowSeasonNumberRef are the same "always read the live value
      // from a one-time subscription" pattern the rest of this listener already relies on.
      if (episodeRowOpenRef.current) {
        const targetSeason = (movie.seasons ?? []).find((sn) => sn.number === episodeRowSeasonNumberRef.current);
        const targetEpisode = targetSeason?.episodes[episodeRowIndexRef.current];
        if (targetSeason && targetEpisode && targetEpisode.hasPlayableStream) {
          closeEpisodeRowRef.current();
          onSelectEpisodeRef.current?.(targetEpisode, targetSeason);
        }
        return;
      }
      // OK while the subtitles button is the one actually focused opens its panel instead of
      // toggling playback - this only ever fires while okCaptureActive is true, which is already
      // turned off for the duration the panel itself is open (see the reactive flag-sync effect
      // below), so there's no risk of this branch re-firing and re-opening it from underneath the
      // panel's own input.
      if (activeControlRef.current === "subtitles") {
        setSubtitlePanelOpen(true);
        return;
      }
      // Same reasoning as the subtitles branch above, for the quality button.
      if (activeControlRef.current === "quality") {
        setQualityPanelOpen(true);
        return;
      }
      // Toggling from here (see the comment above) bypasses RN's normal focus-driven Pressable
      // flow entirely, which is also what normally fires onFocus/onBlur to animate the "focused"
      // look (scale + filled circle) - without it, play/pause responded correctly to every OK
      // press but never visibly looked focused, since the imperative .focus() call below doesn't
      // reliably trigger that callback on this Android TV setup. setActiveControl drives the
      // highlight directly instead of depending on it.
      setActiveControl("playPause");
      (playPauseRef.current as any)?.focus?.();
      // See youtubeIdRef's own comment above onCommand - this branch used to be native-only
      // (setPaused, read by <Video>'s own paused prop); a separate listener toggled ytPaused
      // instead, duplicating everything else this handler already does (activeControl, focus,
      // wake()) for no reason other than which state variable actually needed flipping.
      if (youtubeIdRef.current) {
        const next = !ytPausedRef.current;
        setYtPaused(next);
        ytCommand(next ? "player.pauseVideo()" : "player.playVideo()");
      } else {
        setPaused((p) => !p);
      }
      wake();
    });
    return () => {
      navSub.remove();
      okSub.remove();
      KeyEventBridge?.setDpadNavActive(false);
      KeyEventBridge?.setOkCaptureActive(false);
      stopHoldSeek();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The actual native flag state, kept in sync with whether the panel is open - see the two
  // listeners just above for what each flag gates. Runs on every relevant change (not [] deps
  // like the listener registration above), which is exactly what's needed here: unlike the
  // listeners themselves, there's nothing to tear down/rebuild, just a plain value to push to the
  // native side each time. No longer depends on activeControl at all - dpadNavActive covers all
  // four directions unconditionally now (the onNavKey handler above is what decides seek vs.
  // navigate, based on activeControlRef), not just left/right while the seek bar happens to be
  // active.
  // The episode row deliberately does *not* factor in here - unlike the subtitle panel (real
  // Android focus, needs these native flags off to navigate normally), it's driven entirely
  // through the same onNavKey/onOkKey bridge as the three main controls and needs dpadNavActive
  // to stay *on* the whole time it's open, not off.
  useEffect(() => {
    const { KeyEventBridge } = NativeModules;
    // Either panel owns real Android focus for as long as it's open (see each one's own comment)
    // - both flags stay off while either is up, not just the one whose state this effect used to
    // read alone.
    const anyPanelOpen = subtitlePanelOpen || qualityPanelOpen;
    KeyEventBridge?.setOkCaptureActive(!anyPanelOpen);
    KeyEventBridge?.setDpadNavActive(!anyPanelOpen);
    // This effect had no cleanup at all before - fine for every *internal* transition (the two
    // calls above already push the exact right value on every subtitlePanelOpen change), but
    // exiting the player entirely is *also* an unmount of this same effect, and with nothing here
    // to catch that, whichever value was current at that moment (true, in the overwhelmingly
    // common case of leaving with the subtitle panel closed) stayed on the native side forever -
    // every other screen's own up/down/left/right silently swallowed by a flag only this screen
    // was ever supposed to own, with no way for another screen to know to turn it back off. This
    // was very likely the real cause behind several "navigation is broken" reports elsewhere in
    // the app that never reproduced from a cold app start, only after watching something first.
    return () => {
      KeyEventBridge?.setOkCaptureActive(false);
      KeyEventBridge?.setDpadNavActive(false);
    };
  }, [subtitlePanelOpen, qualityPanelOpen]);

  // Positive subtitleOffsetMs = subtitles were appearing too early, so they need to show *later*
  // - looking them up at an earlier point on the file's own timeline is what pushes their actual
  // on-screen appearance later on the real playback clock (and vice versa for a negative value,
  // "advance"). subtitleSpeed corrects a frame-rate mismatch's proportional drift on top of that
  // - applied to currentTime first (the rate the raw file's own clock runs at relative to real
  // playback time), with the constant offset applied after. See subtitleOffsetMs/subtitleSpeed's
  // own comment above, and the subtitle panel's own offset/speed steppers.
  //
  // Computed from `progress` (React state, throttled to ~1s - see progressUpdateInterval's own
  // comment) it used to mean a cue could show up to a second late even with a perfectly-set
  // offset, reported as subtitles still reading as "not synced" - `cueText` instead is
  // recomputed on every onProgress tick regardless of that throttle (see onProgress below), so a
  // cue change reaches the screen within one tick of the real playback position.
  const currentCue = cueText;
  const duration = progress?.seekableDuration ?? 0;
  const currentTime = progress?.currentTime ?? 0;
  const barsHidden = !controlsVisible;

  // Series only - which episode this is. Movie-level facts (age rating, year, quality,
  // rating) live in their own row on the opposite side of the header instead, so they apply
  // whether or not there's an episode name to show alongside them.
  const metaText = episode
    ? lang === "ar"
      ? `${season ? `الموسم ${season.number} • ` : ""}الحلقة ${episode.number}${episode.titleAr ? ": " + episode.titleAr : ""}`
      : `${season ? `Season ${season.number} • ` : ""}Episode ${episode.number}${episode.titleEn ? ": " + episode.titleEn : ""}`
    : null;

  // !unavailable matters: this branch used to run unconditionally whenever the URL merely
  // *looked like* a YouTube link, regardless of whether playback ever actually succeeded - the
  // shared "not available" screen below (see the plain if(unavailable) branch) could then never
  // actually be reached from here no matter what set `unavailable` (the real YT player onError
  // message, or the load-timeout fallback above), since this branch's own unconditional `return`
  // always ran first. Reported as the player staying visually stuck on the play button/bottom bar
  // forever with literally no way out, even well past the timeout that was supposed to catch
  // exactly that.
  if (youtubeId && !unavailable) {
    // Rounded once here, read from both the solid block and the fade band below it (rather than
    // each dividing bottomBarHeight by 2 independently) - see their own shared comment on why
    // that was leaving a thin see-through seam where the two met.
    const halfBottomBlockHeight = Math.round(bottomBarHeight / 2);
    return (
      <View style={styles.root}>
        {/* Loads a real page hosted on this backend's own domain (youtube-embed - see
            youtubeEmbedUrl's own comment in api.ts) instead of a WebView-local HTML string with a
            faked `baseUrl` - that older trick was the actual root cause of every YouTube embed in
            this app (this player and MovieDetailsScreen's own trailer preview alike) silently
            failing on every device: the origin it faked never actually satisfied the real IFrame
            Player API's own validation. A genuine https:// navigation gives it a real, consistent
            origin to check instead. Everything downstream of that (the `player` global,
            onReady/onStateChange/onError posting back via postMessage, the 250ms time-polling
            interval) is identical to before - only how the page itself gets loaded changed. */}
        <WebView
          ref={ytWebViewRef}
          source={{ uri: youtubeEmbedUrl(youtubeId, { autoplay: true, mute: true, controls: false, unmuteOnPlay: true }) }}
          // Explicit background, not just the transparent default - see the identical fix (and
          // its own comment) in MovieDetailsScreen's own trailer WebView for why the native
          // Android WebView needs this set directly on itself rather than relying on the loading
          // overlay above to always cover the gap in time.
          style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          domStorageEnabled
          // Defaults to "none" (react-native-webview's own default) - a well-documented Android
          // WebView issue on some devices/versions: HTML5 <video> (which YouTube's player renders
          // through internally) never actually decodes a frame under that default layer type,
          // even though everything else on the page (JS, layout, the player's own postMessage
          // events) works completely normally - exactly the "player reaches ready/unstarted and
          // never advances" symptom seen on one specific device. Forcing a real hardware-backed
          // compositing layer is the documented fix.
          androidLayerType="hardware"
          onMessage={(e) => {
            const msg = e.nativeEvent.data;
            if (msg === "playing") {
              setLoading(false);
              return;
            }
            // A per-video error (removed/private/embedding disabled) - reuses the exact same
            // "not available" screen every other server-exhausted case already shows, rather
            // than a second, YouTube-specific error UI.
            if (msg?.startsWith("error:")) {
              setYtDiag(msg);
              setUnavailable(true);
              return;
            }
            if (msg?.startsWith("diag:")) {
              setYtDiag(msg);
              // See ytBufferingRef's own comment - 3 is YT.PlayerState.BUFFERING; any other state
              // (including the 1=PLAYING that follows once it catches back up) clears it.
              if (msg.startsWith("diag:state:")) {
                const stateCode = Number(msg.slice("diag:state:".length));
                ytBufferingRef.current = stateCode === 3;
                if (ytBufferingRef.current) wake();
              }
              return;
            }
            try {
              const data = JSON.parse(msg);
              if (data.type === "time") {
                const t = data.currentTime || 0;
                ytCurrentTimeRef.current = t;
                // Throttled to roughly once a second - see progressUpdateInterval's own comment
                // for native playback (the identical reasoning applies here): this WebView polls
                // and posts a message every 250ms, and re-rendering this whole screen (seek bar,
                // time labels, header, gradients) that often is a real, visible cost on weaker TV
                // hardware - reported as "it plays now but it's slow and stutters" once actual
                // decode (see androidLayerType="hardware" above) started working on one such
                // device. The subtitle cue lookup right below still runs on every tick regardless
                // (see ytCueText's own comment) - only the parts that actually need a full
                // re-render are held back.
                if (Date.now() - lastYtProgressStateRef.current >= 1000) {
                  lastYtProgressStateRef.current = Date.now();
                  setYtCurrentTime(t);
                  setYtDuration(data.duration || 0);
                }
                const nextCue = subtitleSettings.enabled
                  ? activeCueText(cues, (t - subtitleOffsetMs / 1000) / subtitleSpeed)
                  : null;
                setYtCueText((prev) => (prev === nextCue ? prev : nextCue));
              }
            } catch {
              // Not JSON - not one of the messages this bridge sends, ignore.
            }
          }}
          onError={() => setUnavailable(true)}
          onHttpError={() => setUnavailable(true)}
          // Android kills the WebView's renderer process under memory pressure (common on TV
          // boxes); without this the dead WebView just sat there as a frozen black screen.
          onRenderProcessGone={() => setUnavailable(true)}
        />
        {loading && (
          <View style={styles.youtubeLoadingOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" />
          </View>
        )}
        {/* Same top gradient + movie header (logo/title, age rating, year, IMDb rating...) the
            native branch's own topBar shows - reused verbatim (same movie, same styles), not a
            second copy. None of YouTube's own overlays (video title/channel name while playing,
            or its own paused-state "suggested videos" screen) are actually reachable to remove or
            reposition - this WebView loads real youtube.com page content in a cross-origin iframe
            (see youtubeEmbedUrl's own comment), so there's no DOM here this app can strip or move
            a piece of, and YouTube's own logo specifically can't be removed at all regardless
            (their own branding requirement). This app's own header sitting over that same region
            visually replaces it instead - per explicit request, over the transparent-to-dark
            gradient rather than a solid cover, so the video stays visible underneath exactly like
            it does for native playback's own header. */}
        {/* Rendered as independent elements (not nested inside topBar's own fading View below)
            purely so their sizing can be tuned separately from topBar's own content-driven size.
            Solid part now sized to topBar's own top padding specifically - per explicit request,
            reaching exactly down to the movie logo's own top edge (topBar's padding is what pushes
            the logo down from the screen's top edge to begin with) before the gradient take over,
            rather than fading from the very first pixel. Still fades with barsHidden like the rest
            of the controls (an explicit correction after a first attempt left this permanently
            visible - the actual ask was a longer idle timeout before any of it fades, not
            indefinite). */}
        <View
          style={[{ position: "absolute", top: 0, left: 0, right: 0, height: s(32), backgroundColor: "#000" }, barsHidden && styles.hidden]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["#000", "transparent"]}
          style={[{ position: "absolute", top: s(32), left: 0, right: 0, height: s(168) }, barsHidden && styles.hidden]}
          pointerEvents="none"
        />
        <View style={[styles.topBar, barsHidden && styles.hidden]} pointerEvents="box-none">
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              {movie.logoUrl || movie.titleLogo ? (
                <LogoImage uri={posterUrl(movie.logoUrl || movie.titleLogo, "w780")} height={s(50)} maxWidth={s(280)} style={styles.playerLogo} />
              ) : (
                <Text style={styles.title} numberOfLines={1}>{title}</Text>
              )}
            </View>
            <View style={styles.headerRight}>
              {/* Season/episode/title - back above the facts row (age/year/genre/...), its
                  original place, per explicit request reverting an earlier move to under the logo. */}
              {!!metaText && (
                <Text style={styles.metaText} numberOfLines={1}>
                  {metaText}
                </Text>
              )}
              <View style={styles.factsRow}>
                {!!movie.ageRating && (
                  <View style={styles.ageBadge}>
                    <Text style={styles.ageBadgeText}>{movie.ageRating}</Text>
                  </View>
                )}
                {!!movie.year && <Text style={styles.factText}>{movie.year}</Text>}
                {!!movie.country && <Text style={styles.factText}>{countryName(movie.country, lang)}</Text>}
                {!!movie.language && <Text style={styles.factText}>{languageName(movie.language, lang)}</Text>}
                {!!movie.genres?.length && (
                  <Text style={styles.factText} numberOfLines={1}>
                    {movie.genres.map((g) => genreName(g, lang)).join(", ")}
                  </Text>
                )}
                {!!movie.quality && <Text style={styles.factText}>{movie.quality}</Text>}
                {movie.rating != null && (
                  <View style={styles.imdbRow}>
                    <View style={styles.imdbBadgeWhite}>
                      <Text style={styles.imdbBadgeWhiteText}>IMDb</Text>
                    </View>
                    <Text style={styles.factRating}>{movie.rating}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>
        {/* A plain text credit, not a redrawn copy of YouTube's actual logo mark - per explicit
            request, this app's own header/gradients now sit over the region where YouTube's own
            branding would otherwise show, so this is what keeps that branding requirement
            satisfied without reproducing their specific logo graphic. */}
        <View style={[styles.youtubeCredit, barsHidden && styles.hidden]} pointerEvents="none">
          <Text style={styles.youtubeCreditText}>YouTube</Text>
        </View>
        {/* Sized off bottomBarHeight (the bar's own real measured height, from its onLayout below)
            rather than an arbitrary screen-height fraction, at half of it - per explicit request
            to shrink the solid part. The fade band right above reuses that same half-height, and
            both read from the same rounded halfBottomBlockHeight value (not each independently
            dividing the raw float) specifically so they land on the exact same pixel boundary -
            two absolutely-positioned siblings each rounding a fractional height independently can
            each land a pixel apart, showing as a thin see-through seam between them, which is
            exactly what got reported. Not gated on barsHidden/subtitlePanelOpen at all (dropped
            per explicit request) - this used to disappear along with the rest of the controls
            after a few seconds idle, exposing YouTube's own logo/overlay underneath the moment it
            did; hiding that needs to stay true regardless of whether the interactive controls are
            currently shown. Plain opaque fill (no alpha blending, essentially free to composite)
            for the solid part, a small gradient only across the fade band - not one gradient
            spanning a large stretch of the screen, which measurably hurt reliability on the one
            device already marginal for hardware-accelerated WebView video (see
            androidLayerType="hardware" above) when this was first added as one big
            semi-transparent layer. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { top: undefined, bottom: 0, height: halfBottomBlockHeight, backgroundColor: "#000" },
            (barsHidden || subtitlePanelOpen) && styles.hidden,
          ]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={["transparent", "#000"]}
          style={[
            StyleSheet.absoluteFill,
            { top: undefined, bottom: halfBottomBlockHeight, height: halfBottomBlockHeight },
            (barsHidden || subtitlePanelOpen) && styles.hidden,
          ]}
          pointerEvents="none"
        />
        {/* Our own subtitles (never YouTube's - see ytCommand/onMessage's own comment on why
            those two are entirely separate systems now), synced to the polled ytCurrentTime
            instead of react-native-video's own onProgress. Rendered after (so visually above) the
            two darkening layers just above - they used to sit on top of this text instead, per
            explicit report, dimming or hiding it whenever a cue landed inside that region. Reads
            ytCueText (recomputed on every tick in onMessage, not throttled the way ytCurrentTime's
            own state now is - see its own comment) rather than recomputing it here from the
            throttled value, which would otherwise let a cue show up to a second late. Same visual
            style as native playback - see currentCue's own render below for the identical block
            this mirrors. */}
        {!!ytCueText && (
          <View style={styles.subtitleWrap} pointerEvents="none">
            <Text
              style={[
                styles.subtitleText,
                {
                  fontFamily: subtitleFontFamily(subtitleSettings.font),
                  fontSize: subtitleFontSize(subtitleSettings.size),
                  color: subtitleSettings.color,
                  backgroundColor: subtitleSettings.background ? "rgba(0,0,0,0.6)" : "transparent",
                  // Checked against the cue's own text, not the app's current UI language - see
                  // isRtlText's own comment. Left unset (falls back to "auto", which lets Android
                  // silently guess wrong) reads correctly per-word but can flip punctuation like
                  // "-"/"؟" to the wrong visual side within the line - reported exactly as
                  // "reversed marks in some subtitles."
                  writingDirection: isRtlText(ytCueText) ? "rtl" : "ltr",
                },
              ]}
            >
              {ytCueText}
            </Text>
          </View>
        )}
        {/* This app's own bar (was YouTube's, per explicit request) - fades with the same
            controlsVisible/wake() timer the native player's own bar already uses (see wake's own
            comment), so pressing OK/left/right here reveals it and resets the same 4s countdown
            rather than needing a second, separate visibility system. Reuses the exact same
            FocusableSeekBar/CtrlButton the native branch's own bar renders (see their own
            components below) instead of a second, hand-built copy of the same bar/track/thumb
            markup - activeControl/startHoldSeek/the shared onNavKey+onOkKey handler already treat
            this branch's own state (ytPaused/ytCurrentTime/ytCommand) as just another target to
            drive, branched on youtubeIdRef - see their own comments. Seek bar now sits above the
            play/pause button (was below) - per explicit request. */}
        <Animated.View
          style={[styles.bottomBar, (barsHidden || subtitlePanelOpen) && styles.hidden]}
          onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
          pointerEvents="box-none"
        >
          <FocusableSeekBar
            ref={setSeekBarRef}
            currentTime={holdSeekPreview ?? ytCurrentTime}
            duration={ytDuration}
            isSeeking={holdSeekPreview != null}
            focusable={!subtitlePanelOpen}
            forceFocused={activeControl === "seekBar"}
            onFocus={() => {
              setActiveControl("seekBar");
              wake();
            }}
            onPress={() => {
              setActiveControl("playPause");
              wake();
              (playPauseRef.current as any)?.focus?.();
            }}
          />
          <View style={styles.controlsRow}>
            <CtrlButton
              ref={setPlayPauseRef}
              Icon={ytPaused ? Play : Pause}
              iconFill
              big
              hasTVPreferredFocus
              focusable={!subtitlePanelOpen}
              forceFocused={activeControl === "playPause"}
              onFocus={() => {
                setActiveControl("playPause");
                wake();
              }}
              onPress={() => {
                if (!controlsVisible) {
                  wake();
                  return;
                }
                const next = !ytPausedRef.current;
                setYtPaused(next);
                ytCommand(next ? "player.pauseVideo()" : "player.playVideo()");
                wake();
              }}
            />
          </View>
        </Animated.View>

        {/* Same floating subtitles button (and same panel) the native branch's own bottom bar
            uses - see its own comment on why this sits outside controlsRow entirely. Opening it
            here works exactly the same way as native playback: the panel's own font/size/color/
            background settings and manual offset/speed steppers all apply identically, since both
            branches draw the exact same custom subtitle overlay from the exact same `cues`/
            subtitleOffsetMs/subtitleSpeed. */}
        <Animated.View style={[styles.subtitlesBtnFloat, barsHidden && styles.hidden]}>
          <CtrlButton
            ref={setSubtitlesBtnRef}
            Icon={Subtitles}
            forceFocused={activeControl === "subtitles"}
            onFocus={() => {
              if (subtitlePanelOpenRef.current) {
                closeSubtitlePanel();
                return;
              }
              setActiveControl("subtitles");
              wake();
            }}
            onPress={() => {
              if (!controlsVisible) {
                wake();
                return;
              }
              openSubtitlePanel();
            }}
          />
        </Animated.View>

        {subtitlePanelOpen && (
          <SubtitlePanel
            lang={lang}
            settings={subtitleSettings}
            onChangeSettings={onChangeSubtitleSettings}
            offsetMs={subtitleOffsetMs}
            onChangeOffset={handleManualOffsetChange}
            speed={subtitleSpeed}
            onChangeSpeed={handleManualSpeedChange}
            exitDownHandle={focusHandles.subtitlesBtn}
          />
        )}
        {exiting && (
          <View style={styles.exitOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.exitOverlayText}>{lang === "ar" ? "جارٍ الخروج..." : "Exiting..."}</Text>
          </View>
        )}
      </View>
    );
  }

  if (unavailable) {
    return (
      <View style={[styles.root, styles.unavailableWrap]}>
        <ShieldAlert size={s(40)} color={colors.textMuted} />
        <Text style={styles.unavailableTitle}>
          {lang === "ar"
            ? episode
              ? "هذه الحلقة غير متوفرة حاليًا"
              : "هذا الفيلم غير متوفر حاليًا"
            : episode
              ? "This episode isn't available right now"
              : "This movie isn't available right now"}
        </Text>
        <Text style={styles.unavailableDesc}>
          {lang === "ar"
            ? "تعذّر تشغيل جميع روابط التشغيل المتاحة. حاول مرة أخرى لاحقًا."
            : "Every available playback link failed. Please try again later."}
        </Text>
        {/* See ytDiag's own comment above - only ever set while this failure came from the
            YouTube branch, so this stays empty/absent for every other kind of playback failure. */}
        {!!ytDiag && <Text style={styles.unavailableDesc}>{ytDiag}</Text>}
        <Focusable onPress={handleExit} hasTVPreferredFocus scaleTo={1.05} focusRadius={radius.pill} clipFocusOverflow>
          {(focused: boolean) => (
            <View style={[styles.unavailableBackBtn, focused && styles.segmentItemFocused]}>
              <Text style={[styles.unavailableBackBtnText, focused && styles.segmentTextFocused]}>
                {lang === "ar" ? "رجوع" : "Back"}
              </Text>
            </View>
          )}
        </Focusable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Video
        key={`${url}#${retryToken}`}
        ref={playerRef}
        source={{ uri: url }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        paused={paused}
        onProgress={(data) => {
          currentTimeRef.current = data.currentTime;
          const now = Date.now();
          // The state update that re-renders the whole screen (seek bar, time labels, etc.)
          // stays throttled to roughly once a second - see progressUpdateInterval's own comment
          // on why re-rendering all of that 4x/second is itself a real cost on weaker TV
          // hardware. onProgress now fires much more often than that purely so the subtitle cue
          // lookup right below can run at the tighter interval, without also dragging the rest
          // of the screen along with it on every tick.
          if (now - lastProgressStateRef.current >= 1000) {
            lastProgressStateRef.current = now;
            setProgress(data);
          }
          // Recomputed on every tick (not gated behind the throttle above) - see currentCue's
          // own comment. setCueText is a no-op re-render whenever the cue hasn't actually
          // changed (the common case, several times a second), since React bails out on an
          // identical primitive value.
          const nextCue = subtitleSettings.enabled
            ? activeCueText(cues, (data.currentTime - subtitleOffsetMs / 1000) / subtitleSpeed)
            : null;
          setCueText((prev) => (prev === nextCue ? prev : nextCue));
          // Throttled to roughly once every 10s of real time, independent of how often
          // onProgress itself now fires - far more often than a resume point needs to be this
          // fresh for.
          if (now - lastProgressSaveRef.current >= 10000) {
            lastProgressSaveRef.current = now;
            saveWatchProgress(data.currentTime, data.seekableDuration);
          }
        }}
        onLoadStart={() => setLoading(true)}
        onLoad={(data: OnLoadData) => {
          setLoading(false);
          hasEverPlayedRef.current = true;
          // A stall that needed a retry has now genuinely recovered - back to a full retry
          // budget for the *next* one, rather than a stall an hour into a movie being limited by
          // retries that already got used up and reset by a totally separate stall earlier on.
          midstreamRetryCountRef.current = 0;
          // Waits for the player's own reported duration (not just "a saved position exists")
          // before seeking - sanity-checking against it is what lets saveWatchProgress's own
          // near-the-end/finished logic actually mean something on the way back in too, not just
          // on the way out.
          const resume = pendingResumeRef.current;
          pendingResumeRef.current = null;
          if (resume && data.duration > 0 && resume.positionSeconds > 10 && resume.positionSeconds < data.duration - 30) {
            playerRef.current?.seek(resume.positionSeconds);
          }
        }}
        onBuffer={({ isBuffering }) => setLoading(isBuffering)}
        // Used to just log and clear the spinner, leaving a plain black screen with no
        // explanation for however long the viewer waited before giving up themselves - this now
        // actually falls through to the next server in the (already best-first, see
        // pickBestServers) list, and only shows the "not available" screen once none are left.
        //
        // But only once this exact link has never proven itself at all (see hasEverPlayedRef) -
        // an error on a link that *had* already been playing fine is far more likely a weak
        // connection stalling than the link actually being gone (reported as "buffers briefly,
        // then jumps straight to 'link not available' "), so that case retries the same link
        // several times first (remembering the last playback position via pendingResumeRef, the
        // same field onLoad above already uses to resume a saved position) before ever falling
        // through to the next server or the unavailable screen.
        onError={(err: any) => {
          console.error("[VideoPlayer] playback error:", JSON.stringify(err?.error ?? err).slice(0, 200));
          if (hasEverPlayedRef.current && midstreamRetryCountRef.current < MAX_MIDSTREAM_RETRIES) {
            midstreamRetryCountRef.current += 1;
            pendingResumeRef.current = {
              positionSeconds: currentTimeRef.current,
              durationSeconds: progress?.seekableDuration ?? 0,
              updatedAt: Date.now(),
            };
            setLoading(true);
            setTimeout(() => setRetryToken((t) => t + 1), MIDSTREAM_RETRY_DELAY_MS);
            return;
          }
          if (serverIndex + 1 < servers.length) {
            setServerIndex((i) => i + 1);
          } else {
            setLoading(false);
            setUnavailable(true);
          }
        }}
        // The native player surface sits full-screen *underneath* the controls in the JSX,
        // but Android's own initial-focus search doesn't know that - a focusable video
        // surface was as valid a candidate as the play/pause button, and winning that race
        // meant the remote had nothing wired to it at all. Removing it from focus search
        // entirely leaves the controls below as the only candidates.
        focusable={false}
        // Playback itself (not API calls - the movie plays directly from a CDN URL, never
        // through this app's own server) was reported as stuttering here specifically while
        // staying smooth elsewhere - the web app's plain HTML5 <video> and this screen go
        // through very different playback stacks for the exact same CDN URL. ExoPlayer's
        // (react-native-video's Android backend) *default* buffer thresholds are tuned for
        // typical phone/app playback, not a TV pulling a large HLS/mp4 stream over what may be
        // a slower or less consistent connection - raising them gives it more room to buffer
        // ahead before playback starts and enough of a cushion after a rebuffer that a brief
        // dip in throughput doesn't immediately stall it again.
        // Raised again (was 15000/50000/2500/5000) - still not enough headroom on a genuinely
        // weak connection specifically for the *rebuffer* case (bufferForPlaybackAfterRebufferMs):
        // a mid-playback stall was reaching ExoPlayer's own timeout and surfacing as onError
        // (see its own comment below, and MAX_MIDSTREAM_RETRIES/hasEverPlayedRef) well before a
        // link that was genuinely still working, just slow to catch back up, got the chance to.
        // ROOT CAUSE of "the app exits when a movie starts loading" (an out-of-memory kill): buffering
        // was bounded only by TIME (60s ahead), not by size - a high-bitrate source (1080p remux, 4K)
        // needs 150MB+ for that much video, which is more than the Java heap on many TV boxes (a 256MB
        // heap is common), so ExoPlayer's own allocations ran the process out of memory while loading.
        // DependingOnMemory + maxHeapAllocationPercent caps the buffer to a share of this device's
        // real heap limit (memoryClass), so a heavy stream just buffers fewer seconds instead of
        // killing the app; a normal-bitrate one still gets the full time window below.
        bufferingStrategy={BufferingStrategyType.DEPENDING_ON_MEMORY}
        bufferConfig={{
          minBufferMs: 15000,
          maxBufferMs: 45000,
          // 4K moves several times the data per second of 1080p - a bigger cushion before starting
          // and after a stall keeps a brief throughput dip from turning into stutter.
          bufferForPlaybackMs: currentIs4K ? 6000 : 2500,
          bufferForPlaybackAfterRebufferMs: currentIs4K ? 12000 : 7000,
          maxHeapAllocationPercent: 0.45,
        }}
        // Was 1000 (once a second) - re-rendering the whole screen (seek bar, header,
        // everything) at whatever rate this fires is still only actually done once a second,
        // throttled inside onProgress itself (see lastProgressStateRef there), so raising the
        // native firing rate back up doesn't reintroduce that per-tick full-screen re-render
        // cost. What it does buy: subtitle cue lookup (see cueText/currentCue above) now runs
        // against a currentTime that's at most ~250ms stale instead of up to a full second -
        // reported as subtitles still reading as "not synced" even with a correct offset, since
        // a cue could sit on screen up to a second past where it should have already changed.
        progressUpdateInterval={250}
        // The real streaming URLs are HLS (.m3u8, see server.ts's getRealStreamingServers) -
        // if that playlist actually offers more than one rendition, ExoPlayer's default
        // adaptive selection can pick one higher than this device's decoder or the network can
        // sustain in real time, which shows up as exactly this kind of stutter. Capping it is a
        // no-op if the stream only has a single rendition to begin with (nothing to cap), and a
        // real fix if it doesn't - can't tell which from here without the device's own logs.
        maxBitRate={4000000}
      />

      {loading && (
        <View style={styles.loadingWrap} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {!!currentCue && (
        <View style={styles.subtitleWrap} pointerEvents="none">
          <Text
            style={[
              styles.subtitleText,
              {
                fontFamily: subtitleFontFamily(subtitleSettings.font),
                fontSize: subtitleFontSize(subtitleSettings.size),
                color: subtitleSettings.color,
                backgroundColor: subtitleSettings.background ? "rgba(0,0,0,0.6)" : "transparent",
                // See the identical fix (and its own fuller comment) on the YouTube branch's own
                // subtitle Text above.
                writingDirection: isRtlText(currentCue) ? "rtl" : "ltr",
              },
            ]}
          >
            {currentCue}
          </Text>
        </View>
      )}

      {showAgeRating && !!movie.ageRating && (
        <View style={styles.ageRatingWrap} pointerEvents="none">
          <View style={styles.ageRatingBanner}>
            {/* A colored stripe on the leading edge instead of a plain flat card - the color
                itself carries the severity tier (green/blue/orange/red) at a glance, the same
                idea as a movie-rating chip, rather than every rating looking identical. */}
            <View style={[styles.ageRatingStripe, { backgroundColor: ageRatingColor(movie.ageRating) }]} />
            <View>
              <Text style={styles.ageRatingCode}>{movie.ageRating}</Text>
              <Text style={styles.ageRatingDesc}>{ageRatingDescription(movie.ageRating, lang)}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Both bars are always mounted, only ever faded via opacity - this used to be a
          conditional `{controlsVisible && <View>...}`, which *unmounts* the whole button row
          (including whichever button currently has focus) the moment the 4s idle timer fires.
          Once that happens Android has nothing focused at all, and there is no view left for
          the next remote press to land on - not even the one meant to bring the controls back.
          Opacity-only hides the pixels, not the focus.
          Split into its own top bar (title/info, pushed up near the top of the screen) and
          bottom bar (seek bar + controls) - each with its own soft gradient scrim fading into
          the video instead of one flat semi-transparent rectangle covering the whole lower
          half of the screen. */}
      <View style={[styles.topBar, barsHidden && styles.hidden]} pointerEvents="box-none">
        <LinearGradient colors={["rgba(0,0,0,0.7)", "transparent"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {movie.logoUrl || movie.titleLogo ? (
              <LogoImage uri={posterUrl(movie.logoUrl || movie.titleLogo, "w780")} height={s(50)} maxWidth={s(280)} style={styles.playerLogo} />
            ) : (
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            {/* Season/episode/title - back above the facts row, its original place, per explicit
                request reverting an earlier move to under the logo. */}
            {!!metaText && (
              <Text style={styles.metaText} numberOfLines={1}>
                {metaText}
              </Text>
            )}
            {/* Everything folds into this single second line - age rating included, right next
                to year+country (kept adjacent per request) rather than off on its own. */}
            <View style={styles.factsRow}>
              {!!movie.ageRating && (
                <View style={styles.ageBadge}>
                  <Text style={styles.ageBadgeText}>{movie.ageRating}</Text>
                </View>
              )}
              {!!movie.year && <Text style={styles.factText}>{movie.year}</Text>}
              {!!movie.country && <Text style={styles.factText}>{countryName(movie.country, lang)}</Text>}
              {!!movie.language && <Text style={styles.factText}>{languageName(movie.language, lang)}</Text>}
              {!!movie.genres?.length && (
                <Text style={styles.factText} numberOfLines={1}>
                  {movie.genres.map((g) => genreName(g, lang)).join(", ")}
                </Text>
              )}
              {!!movie.quality && <Text style={styles.factText}>{movie.quality}</Text>}
              {movie.rating != null && (
                <View style={styles.imdbRow}>
                  {/* Same IMDb badge used elsewhere in the app, just recolored white instead
                      of the brand yellow to match this screen's own black/white palette. */}
                  <View style={styles.imdbBadgeWhite}>
                    <Text style={styles.imdbBadgeWhiteText}>IMDb</Text>
                  </View>
                  <Text style={styles.factRating}>{movie.rating}</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Only exists while the episode row is actually open - the normal control bar has its own
          plain gradient below instead (see bottomBar's own LinearGradient), since this taller
          scrim behind nothing at all (once the row closes) read as a stray leftover shadow with
          no content in it. Extends EPISODE_SCRIM_EXTRA_TOP above the row's own measured top so
          the fade to transparent has room to finish *above* the season indicator instead of
          still visibly fading right behind it. */}
      {episodeRowSeasonNumber !== null && (
        <Animated.View
          style={[
            styles.bottomScrim,
            {
              height: episodeRowAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [bottomBarHeight, episodeRowHeight + EPISODE_SCRIM_EXTRA_TOP],
              }),
            },
          ]}
          pointerEvents="none"
        >
          <LinearGradient
            // A long, gradual fade (was solid 0.85 by 22% of the height) so the top edge blends
            // into the video instead of reading as a cut-off dark block.
            colors={["transparent", "rgba(5,5,7,0.35)", "rgba(5,5,7,0.75)", "rgba(5,5,7,0.92)"]}
            locations={[0, 0.3, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      <Animated.View
        style={[
          styles.bottomBar,
          // Hides outright while the episode row is open instead of rising to coexist above it -
          // the row takes over this same bottom-of-screen space instead of squeezing in beside
          // it, matching the reported want for a plainer swap over a "make room" animation.
          (barsHidden || episodeRowSeasonNumber !== null) && styles.hidden,
        ]}
        pointerEvents="box-none"
        onLayout={(e) => setBottomBarHeight(e.nativeEvent.layout.height)}
      >
        {/* Normal-playback backdrop, independent of the episode row's own (taller) scrim above -
            always present behind the seek bar/controls regardless of whether the row has ever
            been opened this session. */}
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <FocusableSeekBar
          ref={setSeekBarRef}
          currentTime={holdSeekPreview ?? currentTime}
          duration={duration}
          isSeeking={holdSeekPreview != null}
          focusable={!subtitlePanelOpen && !qualityPanelOpen}
          forceFocused={activeControl === "seekBar"}
          onFocus={() => {
            setActiveControl("seekBar");
            wake();
          }}
          // The seek bar has no action of its own (real seeking is the raw left/right capture
          // above, independent of focus) - OK here always routes back to play/pause instead of
          // doing nothing, so a press here can never leave the viewer with no visible way back.
          onPress={() => {
            setActiveControl("playPause");
            wake();
            (playPauseRef.current as any)?.focus?.();
          }}
        />

        <View style={styles.controlsRow}>
          <CtrlButton
            ref={setPlayPauseRef}
            Icon={paused ? Play : Pause}
            iconFill
            big
            hasTVPreferredFocus
            focusable={!subtitlePanelOpen && !qualityPanelOpen}
            forceFocused={activeControl === "playPause"}
            onFocus={() => {
              setActiveControl("playPause");
              wake();
            }}
            onPress={() => {
              // First OK press while hidden only reveals the bar (focus is already resting
              // here) - it doesn't also toggle playback on that same press. `controlsVisible`
              // here reflects its value from before this press (this closure was created at
              // last render, i.e. pre-press), which is exactly the check needed.
              if (!controlsVisible) {
                wake();
                return;
              }
              setPaused((p) => !p);
              wake();
            }}
          />
        </View>
        {/* Blinking hint that episodes are one DOWN-press away - the only affordance for this now
            that there's no persistent button (see EpisodeRow's own comment). Hidden the moment
            the row has actually been opened once, since its own visible cards take over as the
            cue from then on. */}
        {hasEpisodesList && episodeRowSeasonNumber === null && <EpisodeHint />}
      </Animated.View>

      {/* Floating at the screen's own right edge, independent of the play/pause cluster
          entirely - not a member of controlsRow, not centered alongside anything. Still fades
          with the rest of the controls (barsHidden) since it's still one of them. Navigation
          between this and the other two controls is entirely JS-driven now (see the onNavKey
          state machine above) - real Android focus is no longer what connects it to the rest of
          the chain.
          Stays focusable even while the panel is open (the only one of the three player controls
          that does - see focusable={!subtitlePanelOpen} on the other two): the panel's own last
          row still points its real nextFocusDown here specifically, since landing real focus
          back on this exact button, from any path *inside the panel*, is still the signal that
          closes it - see onFocus below. That's the one place in this screen real Android focus
          still does meaningful work, since it's about exiting the panel's own real-focus-driven
          navigation, not about moving between the three main controls. */}
      <Animated.View
        style={[
          styles.subtitlesBtnFloat,
          (barsHidden || episodeRowSeasonNumber !== null) && styles.hidden,
        ]}
      >
        <CtrlButton
          ref={setSubtitlesBtnRef}
          Icon={Subtitles}
          forceFocused={activeControl === "subtitles"}
          focusable={!qualityPanelOpen}
          onFocus={() => {
            if (subtitlePanelOpenRef.current) {
              closeSubtitlePanel();
              return;
            }
            setActiveControl("subtitles");
            wake();
          }}
          onPress={() => {
            if (!controlsVisible) {
              wake();
              return;
            }
            openSubtitlePanel();
          }}
        />
      </Animated.View>

      {/* Same floating treatment as the subtitles button above, one button-width-plus-gap to its
          left (see qualityBtnFloat) - manual quality picking, same reasoning throughout for why
          this stays JS-nav-driven and only this button itself keeps real focus while its own
          panel is open. Shown for any title with at least one real playback link of our own (even
          just a single quality - the panel then just confirms which one, per explicit request) -
          only hidden for a YouTube-embedded title, which has no `servers` list to begin with. */}
      {qualityOptions.length > 0 && (
        <Animated.View
          style={[
            styles.qualityBtnFloat,
            (barsHidden || episodeRowSeasonNumber !== null) && styles.hidden,
          ]}
        >
          <CtrlButton
            ref={setQualityBtnRef}
            Icon={Settings}
            forceFocused={activeControl === "quality"}
            focusable={!subtitlePanelOpen}
            onFocus={() => {
              if (qualityPanelOpenRef.current) {
                closeQualityPanel();
                return;
              }
              setActiveControl("quality");
              wake();
            }}
            onPress={() => {
              if (!controlsVisible) {
                wake();
                return;
              }
              openQualityPanel();
            }}
          />
        </Animated.View>
      )}

      {/* No button at all - opened by pressing down from play/pause (see onNavKey above),
          literally the same "down reveals what's below the player" gesture YouTube uses, not a
          persistent fourth control. Takes over the bottom bar's own space while open (see
          bottomBar's own comment) rather than coexisting with it. */}
      {episodeRowSeasonNumber !== null && episodeRowSeason && (
        <EpisodeRow
          season={episodeRowSeason}
          activeIndex={episodeRowIndex}
          hidden={barsHidden}
          currentEpisodeId={episode?.id}
          resolvingEpisodeId={resolvingEpisodeId ?? null}
          isEpisodeWatched={handleEpisodeRowWatched}
          lang={lang}
          onHeightChange={setEpisodeRowHeight}
          onSelectEpisode={handleEpisodeRowSelect}
        />
      )}

      {subtitlePanelOpen && (
        <SubtitlePanel
          lang={lang}
          settings={subtitleSettings}
          onChangeSettings={onChangeSubtitleSettings}
          offsetMs={subtitleOffsetMs}
          onChangeOffset={handleManualOffsetChange}
          speed={subtitleSpeed}
          onChangeSpeed={handleManualSpeedChange}
          exitDownHandle={focusHandles.subtitlesBtn}
        />
      )}
      {qualityPanelOpen && (
        <QualityPanel
          options={qualityOptions}
          currentIndex={serverIndex}
          onSelect={handleSelectQuality}
          exitDownHandle={focusHandles.qualityBtn}
        />
      )}
      {exiting && (
        <View style={styles.exitOverlay} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.exitOverlayText}>{lang === "ar" ? "جارٍ الخروج..." : "Exiting..."}</Text>
        </View>
      )}
    </View>
  );
}

// Mirrors SettingsScreen's own card/segmented/toggle/swatch design language (see its `card`,
// `segmented`/`segmentItem`, `toggleTrack`/`toggleKnob`, `swatch` styles) rather than inventing a
// separate look for this one screen - condensed into a single small card instead of that
// screen's full-page stack of them, since this is a quick in-player adjustment, not a
// destination in its own right. Every control here is a plain Focusable navigated with ordinary
// LEFT/RIGHT/UP/DOWN and pressed with OK - none of that goes through the raw native key capture
// the rest of this screen relies on, since both native flags are turned off for as long as this
// is mounted (see the reactive flag-sync effect in VideoPlayerScreen). Font/size/color/background
// persist through onChangeSettings (the same app-wide preference SettingsScreen itself edits);
// the offset/speed steppers are local-only (see subtitleOffsetMs/subtitleSpeed's own comment)
// and aren't part of that object.
function SubtitlePanel({
  lang,
  settings,
  onChangeSettings,
  offsetMs,
  onChangeOffset,
  speed,
  onChangeSpeed,
  exitDownHandle,
}: {
  lang: Lang;
  settings: SubtitleSettings;
  onChangeSettings: (settings: SubtitleSettings) => void;
  offsetMs: number;
  onChangeOffset: (ms: number) => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  // The subtitles button's own node handle - the panel's last row points nextFocusDown here so DOWN off
  // the bottom of the panel exits it instead of going nowhere.
  exitDownHandle?: number;
}) {
  const OFFSET_STEP_MS = 250;
  // Raised from 15s - some real releases (a subtitle file muxed for a different cut/release of
  // the same title) are off by more than that.
  const MAX_OFFSET_MS = 60000;
  const SPEED_STEP = 0.005;
  const MIN_SPEED = 0.85;
  const MAX_SPEED = 1.18;
  const offsetSeconds = (offsetMs / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const offsetLabel = `${offsetMs > 0 ? "+" : ""}${offsetSeconds}`;
  const speedLabel = `${(speed * 100).toFixed(1)}%`;
  const sizeIndex = SUBTITLE_SIZES.findIndex((sz) => sz.key === settings.size);
  // The panel had grown into one long scroll of settings *and* sync controls together (reported
  // as "the subtitle settings list has gotten too long") - split into two collapsible sections,
  // accordion-style (opening one closes the other), each collapsed to just its own header row
  // when not the active one.
  const [openSection, setOpenSection] = useState<"settings" | "sync">("settings");
  // Even with the two sections above collapsed independently, "settings" alone still stacked
  // five rows' worth of controls (two toggles, font, size, color) at once - still reported as
  // "the list is too long." Font/size/color specifically (the ones with a real control body, not
  // just a single-line toggle) now collapse the same way sectionA/B do, one level deeper: each
  // shows only its own name until it's the one that's focused, then expands to reveal its control
  // - moving to a different row's header collapses this one back down automatically, no press
  // needed. Same idea applied to sync's delay/speed rows below.
  const [openSettingRow, setOpenSettingRow] = useState<"language" | "font" | "size" | "color" | null>(null);
  const [openSyncRow, setOpenSyncRow] = useState<"delay" | "speed" | null>(null);

  // hasTVPreferredFocus alone doesn't reliably move real Android focus here: this panel mounts
  // as a *new sibling* next to the subtitles button, which never itself lost focus - there's no
  // "nothing is focused yet" moment for Android's initial-focus search to resolve into this
  // subtree the way that prop assumes. Same fix already used elsewhere in this screen for the
  // same underlying issue (see the play/pause retry-focus effect in VideoPlayerScreen): reach in
  // imperatively and retry a few times with backoff, since a slow first layout pass can still
  // lose the very first attempt.
  const sectionAHeaderRef = useRef<View>(null);
  useEffect(() => retryFocus(sectionAHeaderRef), []);

  // Every row below chained explicitly (not left to Android's own default up/down neighbor
  // search) - reported as focus getting stuck partway down this exact panel (never reaching the
  // delay buttons, and so never reaching the exit-via-down handle past them either), the same
  // class of default-geometry failure already seen elsewhere in this file. One ref per row -
  // only the row's *first* focusable needs one, since that's the only handle a vertical
  // chain between rows actually needs - resolved the same one-shot "bump on mount" way as
  // VideoPlayerScreen's own focusHandles.
  const sectionBHeaderRef = useRef<View>(null);
  const toggle1Ref = useRef<View>(null);
  const toggle2Ref = useRef<View>(null);
  const languageHeaderRef = useRef<View>(null);
  const languageRef = useRef<View>(null);
  const fontHeaderRef = useRef<View>(null);
  const fontRef = useRef<View>(null);
  const sizeHeaderRef = useRef<View>(null);
  const colorHeaderRef = useRef<View>(null);
  const swatchRef = useRef<View>(null);
  const delayHeaderRef = useRef<View>(null);
  const offsetLeftRef = useRef<View>(null);
  const offsetRightRef = useRef<View>(null);
  const speedHeaderRef = useRef<View>(null);
  const speedLeftRef = useRef<View>(null);
  const speedRightRef = useRef<View>(null);
  const [panelHandleBump, bumpPanelHandles] = useState(0);
  useEffect(() => {
    // A single bump right after mount has intermittently missed the *last* row added to this
    // chain (reported as "can't go back up from the last row," while every other already-
    // established hop in this same chain keeps working) - a second bump shortly after gives
    // Android's own layout pass more time to fully settle every ref before nextFocusUp/Down are
    // read off rowHandles one more time, same "first attempt can lose the race" story as
    // retryFocus elsewhere in this file. Re-runs on every openSection/openSettingRow/openSyncRow
    // change too, since expanding/collapsing any of them mounts/unmounts its own rows - the same
    // handles need refreshing exactly like a fresh mount would.
    bumpPanelHandles((b) => b + 1);
    const timer = setTimeout(() => bumpPanelHandles((b) => b + 1), 300);
    return () => clearTimeout(timer);
  }, [openSection, openSettingRow, openSyncRow]);
  const rowHandles = React.useMemo(
    () => ({
      sectionAHeader: findNodeHandle(sectionAHeaderRef.current) ?? undefined,
      sectionBHeader: findNodeHandle(sectionBHeaderRef.current) ?? undefined,
      toggle1: findNodeHandle(toggle1Ref.current) ?? undefined,
      toggle2: findNodeHandle(toggle2Ref.current) ?? undefined,
      languageHeader: findNodeHandle(languageHeaderRef.current) ?? undefined,
      language: findNodeHandle(languageRef.current) ?? undefined,
      fontHeader: findNodeHandle(fontHeaderRef.current) ?? undefined,
      font: findNodeHandle(fontRef.current) ?? undefined,
      sizeHeader: findNodeHandle(sizeHeaderRef.current) ?? undefined,
      colorHeader: findNodeHandle(colorHeaderRef.current) ?? undefined,
      swatch: findNodeHandle(swatchRef.current) ?? undefined,
      delayHeader: findNodeHandle(delayHeaderRef.current) ?? undefined,
      offsetLeft: findNodeHandle(offsetLeftRef.current) ?? undefined,
      offsetRight: findNodeHandle(offsetRightRef.current) ?? undefined,
      speedHeader: findNodeHandle(speedHeaderRef.current) ?? undefined,
      speedLeft: findNodeHandle(speedLeftRef.current) ?? undefined,
      speedRight: findNodeHandle(speedRightRef.current) ?? undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelHandleBump]
  );

  return (
    <View style={styles.subtitlePanelWrap} pointerEvents="box-none">
      <View style={styles.subtitlePanel}>
        <PanelSectionHeader
          ref={sectionAHeaderRef}
          hasTVPreferredFocus
          expanded={openSection === "settings"}
          label={lang === "ar" ? "إعدادات الترجمة" : "Subtitle settings"}
          onPress={() => setOpenSection("settings")}
          nextFocusDown={openSection === "settings" ? rowHandles.toggle1 : rowHandles.sectionBHeader}
        />
        {openSection === "settings" && (
          <>
        <PanelToggleRow
          ref={toggle1Ref}
          nextFocusUp={rowHandles.sectionAHeader}
          nextFocusDown={rowHandles.toggle2}
          label={lang === "ar" ? "تفعيل الترجمة" : "Activate translation"}
          value={settings.enabled}
          onChange={(v) => onChangeSettings({ ...settings, enabled: v })}
        />
        <PanelToggleRow
          ref={toggle2Ref}
          nextFocusUp={rowHandles.toggle1}
          nextFocusDown={rowHandles.languageHeader}
          label={lang === "ar" ? "ظل الترجمة" : "Subtitle shadow"}
          description={lang === "ar" ? "تفعيل أو تعطيل الظل خلف الترجمة." : "Enable or disable shadow behind subtitles."}
          value={settings.background}
          onChange={(v) => onChangeSettings({ ...settings, background: v })}
          divider
        />

        <PanelSectionHeader
          ref={languageHeaderRef}
          expanded={openSettingRow === "language"}
          label={lang === "ar" ? "لغة الترجمة" : "Subtitle language"}
          onPress={() => setOpenSettingRow((r) => (r === "language" ? null : "language"))}
          onFocusChange={(f) => f && setOpenSettingRow("language")}
          nextFocusUp={rowHandles.toggle2}
          nextFocusDown={openSettingRow === "language" ? rowHandles.language : rowHandles.fontHeader}
        />
        {openSettingRow === "language" && (
          <View style={styles.panelSection}>
            <View style={styles.segmented}>
              {([
                { key: "ar", label: "العربية" },
                { key: "en", label: "English" },
              ] as const).map((option, i) => (
                <View key={option.key} style={styles.segmentItemWrap}>
                  <Focusable
                    ref={i === 0 ? languageRef : undefined}
                    nextFocusUp={i === 0 ? rowHandles.languageHeader : undefined}
                    nextFocusDown={rowHandles.fontHeader}
                    onPress={() => onChangeSettings({ ...settings, language: option.key })}
                    style={styles.segmentItemTouch}
                    scaleTo={1.04}
                    focusRadius={radius.pill}
                    clipFocusOverflow
                  >
                    {(focused: boolean) => (
                      <View style={[styles.segmentItem, settings.language === option.key && !focused && styles.segmentItemActive, focused && styles.segmentItemFocused]}>
                        <Text
                          style={[styles.segmentText, settings.language === option.key && styles.segmentTextActive, focused && styles.segmentTextFocused]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                </View>
              ))}
            </View>
          </View>
        )}

        <PanelSectionHeader
          ref={fontHeaderRef}
          expanded={openSettingRow === "font"}
          label={lang === "ar" ? "الخط" : "Font"}
          onPress={() => setOpenSettingRow((r) => (r === "font" ? null : "font"))}
          onFocusChange={(f) => f && setOpenSettingRow("font")}
          nextFocusUp={openSettingRow === "language" ? rowHandles.language : rowHandles.languageHeader}
          nextFocusDown={openSettingRow === "font" ? rowHandles.font : rowHandles.sizeHeader}
        />
        {openSettingRow === "font" && (
          <View style={styles.panelSection}>
            <View style={styles.segmented}>
              {SUBTITLE_FONTS.map((f, i) => (
                // A plain flex:1 View wrapper, not flex:1 on Focusable's own rendered child -
                // Focusable's `style` prop only ever reaches its *inner* Animated.View, never the
                // Pressable actually sitting in this row (same issue VirtualKeyboard's own keys
                // ran into), so flex:1 on that inner View had no properly-sized flex parent to
                // resolve against and collapsed to ~zero width - reported as the font options (and
                // the delay buttons below, same pattern) simply not showing at all.
                <View key={f.key} style={styles.segmentItemWrap}>
                  <Focusable
                    ref={i === 0 ? fontRef : undefined}
                    nextFocusUp={i === 0 ? rowHandles.fontHeader : undefined}
                    nextFocusDown={rowHandles.sizeHeader}
                    onPress={() => onChangeSettings({ ...settings, font: f.key })}
                    style={styles.segmentItemTouch}
                    scaleTo={1.04}
                    focusRadius={radius.pill}
                    clipFocusOverflow
                  >
                    {(focused: boolean) => (
                      <View style={[styles.segmentItem, settings.font === f.key && !focused && styles.segmentItemActive, focused && styles.segmentItemFocused]}>
                        {/* Plain panel font, not each option's own typeface - a per-option preview
                            looked nice but rendered completely blank on at least one real device
                            (reported as "the font types don't show at all"), which is worse than
                            losing the preview. */}
                        <Text
                          style={[styles.segmentText, settings.font === f.key && styles.segmentTextActive, focused && styles.segmentTextFocused]}
                          numberOfLines={1}
                        >
                          {lang === "ar" ? f.labelAr : f.labelEn}
                        </Text>
                      </View>
                    )}
                  </Focusable>
                </View>
              ))}
            </View>
          </View>
        )}

        <PanelSectionHeader
          ref={sizeHeaderRef}
          expanded={openSettingRow === "size"}
          label={lang === "ar" ? "حجم الخط" : "Font size"}
          onPress={() => setOpenSettingRow((r) => (r === "size" ? null : "size"))}
          onFocusChange={(f) => f && setOpenSettingRow("size")}
          nextFocusUp={rowHandles.fontHeader}
          nextFocusDown={rowHandles.colorHeader}
          onSeekKey={(direction) => {
            const delta = direction === "right" ? 1 : -1;
            const next = Math.max(0, Math.min(SUBTITLE_SIZES.length - 1, sizeIndex + delta));
            if (next !== sizeIndex) onChangeSettings({ ...settings, size: SUBTITLE_SIZES[next].key });
          }}
        />
        {openSettingRow === "size" && (
          <View style={styles.panelSection}>
            <Text style={[styles.panelValueText, { marginBottom: s(6) }]}>{SUBTITLE_SIZES[sizeIndex].percent}%</Text>
            {/* Plain visual now, not a second focusable row - see PanelSectionHeader's own
                onSeekKey comment above for why left/right on the header itself (reached the
                instant this section opens, no further "reach the slider" hop needed) replaces
                what used to be a separate StepSlider one nextFocusDown further down. */}
            <View style={styles.sizeSliderTrack}>
              <View style={styles.sizeSliderTrackBg} pointerEvents="none" />
              <View
                style={[styles.sizeSliderTrackFill, { width: `${SUBTITLE_SIZES.length > 1 ? (sizeIndex / (SUBTITLE_SIZES.length - 1)) * 100 : 0}%` }]}
                pointerEvents="none"
              />
              <View
                style={[styles.sizeSliderThumb, { left: `${SUBTITLE_SIZES.length > 1 ? (sizeIndex / (SUBTITLE_SIZES.length - 1)) * 100 : 0}%` }]}
                pointerEvents="none"
              />
            </View>
          </View>
        )}

        <PanelSectionHeader
          ref={colorHeaderRef}
          expanded={openSettingRow === "color"}
          label={lang === "ar" ? "لون الخط" : "Font color"}
          onPress={() => setOpenSettingRow((r) => (r === "color" ? null : "color"))}
          onFocusChange={(f) => f && setOpenSettingRow("color")}
          nextFocusUp={rowHandles.sizeHeader}
          nextFocusDown={openSettingRow === "color" ? rowHandles.swatch : rowHandles.sectionBHeader}
        />
        {openSettingRow === "color" && (
          <View style={styles.panelSection}>
            <View style={styles.panelSwatchRow}>
              {SUBTITLE_COLORS.map((c, i) => (
                <Focusable
                  key={c}
                  ref={i === 0 ? swatchRef : undefined}
                  nextFocusUp={i === 0 ? rowHandles.colorHeader : undefined}
                  nextFocusDown={rowHandles.sectionBHeader}
                  onPress={() => onChangeSettings({ ...settings, color: c })}
                  scaleTo={1.1}
                  focusRadius={s(12)}
                >
                  {(focused: boolean) => (
                    <View style={[styles.panelSwatch, { backgroundColor: c }, focused && styles.panelSwatchFocused]}>
                      {settings.color === c && <Check size={s(12)} color="#000" strokeWidth={3.5} />}
                    </View>
                  )}
                </Focusable>
              ))}
            </View>
          </View>
        )}
          </>
        )}

        <PanelSectionHeader
          ref={sectionBHeaderRef}
          expanded={openSection === "sync"}
          label={lang === "ar" ? "مزامنة الترجمة" : "Subtitle sync"}
          onPress={() => setOpenSection("sync")}
          nextFocusUp={openSection === "settings" ? rowHandles.colorHeader : rowHandles.sectionAHeader}
          nextFocusDown={openSection === "sync" ? rowHandles.delayHeader : exitDownHandle}
        />
        {openSection === "sync" && (
          <>

        <PanelSectionHeader
          ref={delayHeaderRef}
          expanded={openSyncRow === "delay"}
          label={lang === "ar" ? "توقيت الترجمة" : "Subtitle delay"}
          onPress={() => setOpenSyncRow((r) => (r === "delay" ? null : "delay"))}
          onFocusChange={(f) => f && setOpenSyncRow("delay")}
          nextFocusUp={rowHandles.sectionBHeader}
          nextFocusDown={openSyncRow === "delay" ? rowHandles.offsetLeft : rowHandles.speedHeader}
        />
        {openSyncRow === "delay" && (
        <View style={styles.panelSection}>
          {/* Centered as one compact group (not stretched edge-to-edge) and each button a plain
              fixed-size box, not flex:1 on Focusable's own rendered child - same collapsed-width
              issue as the font row above (see its own comment): a flex value there has no
              properly-sized parent to resolve against, since the Pressable it actually sits on
              shrink-wraps to content instead of adopting it. */}
          <View style={[styles.panelStepperRow, styles.panelStepperRowSpaced]}>
            <Focusable
              ref={offsetLeftRef}
              nextFocusUp={rowHandles.delayHeader}
              nextFocusDown={rowHandles.speedHeader}
              onPress={() => onChangeOffset(Math.min(MAX_OFFSET_MS, offsetMs + OFFSET_STEP_MS))}
              style={styles.delayStepTouch}
              scaleTo={1.05}
              focusRadius={s(10)}
              clipFocusOverflow
            >
              {(focused: boolean) => (
                <View style={[styles.delayStepBtn, focused && styles.segmentItemFocused]}>
                  <ChevronLeft size={s(18)} color={focused ? "#000" : "#fff"} />
                  <Text style={[styles.delayStepLabel, focused && styles.segmentTextFocused]}>{lang === "ar" ? "تأخير" : "Later"}</Text>
                </View>
              )}
            </Focusable>
            <View style={styles.delayValueBox}>
              <Text style={styles.panelDelayText}>{offsetLabel}</Text>
              <Text style={styles.delayValueUnit}>{lang === "ar" ? "ث" : "s"}</Text>
            </View>
            {/* Both buttons in this row get the same explicit nextFocusDown, since which one
                currently has focus depends on the viewer's own last press and either should
                continue to the next row the same way. */}
            <Focusable
              ref={offsetRightRef}
              nextFocusUp={rowHandles.delayHeader}
              nextFocusDown={rowHandles.speedHeader}
              onPress={() => onChangeOffset(Math.max(-MAX_OFFSET_MS, offsetMs - OFFSET_STEP_MS))}
              style={styles.delayStepTouch}
              scaleTo={1.05}
              focusRadius={s(10)}
              clipFocusOverflow
            >
              {(focused: boolean) => (
                <View style={[styles.delayStepBtn, focused && styles.segmentItemFocused]}>
                  <Text style={[styles.delayStepLabel, focused && styles.segmentTextFocused]}>{lang === "ar" ? "تقديم" : "Earlier"}</Text>
                  <ChevronRight size={s(18)} color={focused ? "#000" : "#fff"} />
                </View>
              )}
            </Focusable>
          </View>
        </View>
        )}

        {/* A plain constant offset can only ever be correct at one point in the file - this
            corrects a frame-rate mismatch's proportional drift on top of that (see
            subtitleOffsetMs/subtitleSpeed's own comment in VideoPlayerScreen). */}
        <PanelSectionHeader
          ref={speedHeaderRef}
          expanded={openSyncRow === "speed"}
          label={lang === "ar" ? "سرعة الترجمة" : "Subtitle speed"}
          onPress={() => setOpenSyncRow((r) => (r === "speed" ? null : "speed"))}
          onFocusChange={(f) => f && setOpenSyncRow("speed")}
          nextFocusUp={rowHandles.delayHeader}
          nextFocusDown={openSyncRow === "speed" ? rowHandles.speedLeft : exitDownHandle}
        />
        {openSyncRow === "speed" && (
        <View style={styles.panelSection}>
          <View style={[styles.panelStepperRow, styles.panelStepperRowSpaced]}>
            <Focusable
              ref={speedLeftRef}
              nextFocusUp={rowHandles.speedHeader}
              nextFocusDown={exitDownHandle}
              onPress={() => onChangeSpeed(Math.min(MAX_SPEED, Math.round((speed + SPEED_STEP) * 1000) / 1000))}
              style={styles.delayStepTouch}
              scaleTo={1.05}
              focusRadius={s(10)}
              clipFocusOverflow
            >
              {(focused: boolean) => (
                <View style={[styles.delayStepBtn, focused && styles.segmentItemFocused]}>
                  <ChevronLeft size={s(18)} color={focused ? "#000" : "#fff"} />
                  <Text style={[styles.delayStepLabel, focused && styles.segmentTextFocused]}>{lang === "ar" ? "أبطأ" : "Slower"}</Text>
                </View>
              )}
            </Focusable>
            <View style={styles.delayValueBox}>
              <Text style={styles.panelDelayText}>{speedLabel}</Text>
            </View>
            <Focusable
              ref={speedRightRef}
              nextFocusUp={rowHandles.speedHeader}
              nextFocusDown={exitDownHandle}
              onPress={() => onChangeSpeed(Math.max(MIN_SPEED, Math.round((speed - SPEED_STEP) * 1000) / 1000))}
              style={styles.delayStepTouch}
              scaleTo={1.05}
              focusRadius={s(10)}
              clipFocusOverflow
            >
              {(focused: boolean) => (
                <View style={[styles.delayStepBtn, focused && styles.segmentItemFocused]}>
                  <Text style={[styles.delayStepLabel, focused && styles.segmentTextFocused]}>{lang === "ar" ? "أسرع" : "Faster"}</Text>
                  <ChevronRight size={s(18)} color={focused ? "#000" : "#fff"} />
                </View>
              )}
            </Focusable>
          </View>
        </View>
        )}
          </>
        )}
      </View>
    </View>
  );
}

// Same card/header/close-button chrome as SubtitlePanel above (see styles.subtitlePanel/
// panelHeader/panelCloseBtn, all reused directly, not redeclared), but none of that panel's own
// accordion nesting - a quality list has no sub-settings to collapse into, so it's just a flat,
// already-sorted stack of rows using the exact same panelSectionHeader row look every collapsed
// section header in the subtitle panel already uses (label left, one trailing indicator right),
// with a checkmark standing in for that row's chevron to mark whichever quality is live now.
function QualityPanel({
  options,
  currentIndex,
  onSelect,
  exitDownHandle,
}: {
  options: { serverIndex: number; label: string; rank: number }[];
  currentIndex: number;
  onSelect: (index: number) => void;
  // The quality button's own node handle - this panel's last row points nextFocusDown here so
  // DOWN off the bottom exits it, same exitDownHandle idea as SubtitlePanel's own prop.
  exitDownHandle?: number;
}) {
  const currentLabel = options.find((o) => o.serverIndex === currentIndex)?.label;

  // One handle per row, chained vertically (every row's nextFocusUp/Down points at its immediate
  // neighbor) - same "never trust Android's own default focus geometry here" reasoning as every
  // other row in this screen's panels, see SubtitlePanel's own rowHandles comment for the full
  // history of why.
  const rowRefs = useRef<Array<View | null>>([]);
  const firstRowRef = useRef<View>(null);
  useEffect(() => retryFocus(firstRowRef), []);
  const [handleBump, bumpHandles] = useState(0);
  useEffect(() => {
    bumpHandles((b) => b + 1);
    const timer = setTimeout(() => bumpHandles((b) => b + 1), 300);
    return () => clearTimeout(timer);
  }, [options.length]);
  const rowHandles = React.useMemo(
    () => options.map((_, i) => findNodeHandle(rowRefs.current[i]) ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleBump, options.length]
  );

  return (
    <View style={styles.qualityPanelWrap} pointerEvents="box-none">
      <View style={[styles.subtitlePanel, styles.qualityPanelCard]}>
        {options.map((option, i) => (
          <Focusable
            key={option.label}
            ref={(node: View | null) => {
              rowRefs.current[i] = node;
              if (i === 0) (firstRowRef as React.MutableRefObject<View | null>).current = node;
            }}
            hasTVPreferredFocus={i === 0}
            nextFocusUp={i === 0 ? undefined : rowHandles[i - 1]}
            nextFocusDown={i === options.length - 1 ? exitDownHandle : rowHandles[i + 1]}
            onPress={() => onSelect(option.serverIndex)}
            style={{ width: "100%" }}
            scaleTo={1.02}
            focusRadius={s(10)}
            clipFocusOverflow
          >
            {(focused: boolean) => (
              <View style={[styles.panelSectionHeader, focused && styles.panelSectionHeaderFocused]}>
                <Text style={[styles.panelSectionHeaderText, focused && styles.segmentTextFocused]}>{option.label}</Text>
                {option.label === currentLabel && <Check size={s(14)} color={focused ? "#000" : "#fff"} strokeWidth={3} />}
              </View>
            )}
          </Focusable>
        ))}
      </View>
    </View>
  );
}

const PanelToggleRow = React.forwardRef<
  View,
  {
    label: string;
    description?: string;
    value: boolean;
    onChange: (v: boolean) => void;
    hasTVPreferredFocus?: boolean;
    divider?: boolean;
    nextFocusUp?: number;
    nextFocusDown?: number;
  }
>(function PanelToggleRow({ label, description, value, onChange, hasTVPreferredFocus, divider, nextFocusUp, nextFocusDown }, ref) {
  return (
    <View style={[styles.panelRowBetween, styles.panelToggleRow, divider && styles.panelRowDivider]}>
      <View style={styles.panelToggleTextCol}>
        <Text style={styles.panelRowLabel}>{label}</Text>
        {!!description && <Text style={styles.panelRowDesc}>{description}</Text>}
      </View>
      <Focusable
        ref={ref}
        hasTVPreferredFocus={hasTVPreferredFocus}
        nextFocusUp={nextFocusUp}
        nextFocusDown={nextFocusDown}
        onPress={() => onChange(!value)}
        scaleTo={1.04}
        focusRadius={s(12)}
      >
        {(focused: boolean) => (
          <View style={[styles.toggleFocusRing, focused && styles.toggleFocusRingFocused]}>
            <View style={[styles.toggleTrack, value && styles.toggleTrackActive]}>
              <View style={[styles.toggleKnob, value && styles.toggleKnobActive]} />
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );
});

// One of the panel's two collapsible sections (settings / sync) - accordion-style, so opening
// one always closes the other (see openSection in SubtitlePanel). Collapsed, this row is the
// *entire* section: just its own title and a chevron: expanded, its rows render below it. The
// whole row (not just a chevron icon) is the Focusable/press target, since a real remote can't
// aim at a small icon precisely the way a cursor can.
const PanelSectionHeader = React.forwardRef<
  View,
  {
    label: string;
    expanded: boolean;
    onPress: () => void;
    hasTVPreferredFocus?: boolean;
    nextFocusUp?: number;
    nextFocusDown?: number;
    // The two top-level sections still only open on press - this is for the rows nested one
    // level inside them (font/size/color, delay/speed), which open as soon as they're *reached*
    // instead, no OK press needed. Optional so PanelSectionHeader keeps working unchanged for
    // sectionA/B above.
    onFocusChange?: (focused: boolean) => void;
    // Only passed by the "size" row below - reported as "can't reach the button to increase the
    // subtitle size," which traces back to the same class of bug BrowseScreen's own grid rebuild
    // ran into this session: this whole panel already documents (see rowHandles' own comment
    // further up) that Android's default focus search kept getting "stuck partway down" this
    // exact panel, which is why every row here is already chained with explicit nextFocusUp/Down
    // node handles instead of trusting that search - but a *second* real Pressable (the old
    // StepSlider) one more nextFocusDown hop below this header is still one more place that same
    // resolution can fail, worse here since it's the one control actually needed to change the
    // value, not just to reach a sibling. Capturing left/right raw on this header itself instead
    // (the same one-Focusable-instead-of-a-handoff-between-siblings fix already proven for
    // BrowseScreen's own filter row) removes that hop entirely - nothing to "reach" once this
    // header itself is focused and expanded.
    onSeekKey?: (direction: "left" | "right") => void;
  }
>(function PanelSectionHeader({ label, expanded, onPress, hasTVPreferredFocus, nextFocusUp, nextFocusDown, onFocusChange, onSeekKey }, ref) {
  const [rowFocused, setRowFocused] = useState(false);
  useEffect(() => {
    if (!onSeekKey || !rowFocused) return;
    const { KeyEventBridge } = NativeModules;
    KeyEventBridge?.setLeftRightSeekActive(true);
    const emitter = new NativeEventEmitter(KeyEventBridge);
    const sub = emitter.addListener("onSeekKey", (event: any) => {
      const { direction, action } = event as { direction: "left" | "right"; action: "down" | "up" };
      if (action === "down") onSeekKey(direction);
    });
    return () => {
      sub.remove();
      KeyEventBridge?.setLeftRightSeekActive(false);
    };
  }, [rowFocused, onSeekKey]);

  const handleFocusChange = (f: boolean) => {
    setRowFocused(f);
    onFocusChange?.(f);
  };

  return (
    <Focusable
      ref={ref}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      onPress={onPress}
      onFocusChange={handleFocusChange}
      style={{ width: "100%" }}
      scaleTo={1.02}
      focusRadius={s(10)}
      clipFocusOverflow
    >
      {(focused: boolean) => (
        <View style={[styles.panelSectionHeader, focused && styles.panelSectionHeaderFocused]}>
          <Text style={[styles.panelSectionHeaderText, focused && styles.segmentTextFocused]}>{label}</Text>
          {expanded ? (
            <ChevronUp size={s(16)} color={focused ? "#000" : colors.textMuted} />
          ) : (
            <ChevronDown size={s(16)} color={focused ? "#000" : colors.textMuted} />
          )}
        </View>
      )}
    </Focusable>
  );
});

// Replaced by PanelSectionHeader's own onSeekKey (see its comment) - the size row's header now
// captures left/right directly instead of needing a second focusable slider row reached via one
// more nextFocusDown hop underneath it.

// Real seeking is the raw left/right capture above (see KeyEventBridgeModule/MainActivity.kt) -
// stock React Native ships no JS-level TVEventHandler (confirmed via `grep -rl "TVEventHandler"
// node_modules/react-native/` returning nothing), so that's still the only way to tell a real
// "seek" signal apart from ordinary focus movement. Unlike the very first version of this, it's
// deliberately *not* independent of focus any more - left/right only mean seek while this bar
// itself is the one focused (see the reactive flag-sync effect in VideoPlayerScreen), so the bar
// being focusable is both what makes seeking reachable at all and, via its own nextFocusUp/Down,
// the resting place OK/up/down land on to get there.
// A small looping opacity pulse under the play/pause button - the sole discoverability cue for
// the episode row now that there's no persistent button (see EpisodeRow.tsx's own comment on why
// that was rejected). Only ever rendered while the row hasn't been opened yet this session.
function EpisodeHint() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.episodeHint, { opacity: pulse }]} pointerEvents="none">
      <ChevronDown size={s(20)} color="#fff" />
    </Animated.View>
  );
}

const FocusableSeekBar = React.forwardRef<View, {
  currentTime: number;
  duration: number;
  isSeeking: boolean;
  onFocus?: () => void;
  onPress?: () => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  // Overrides the highlight regardless of Focusable's own tracked focus state - see
  // activeControl's own comment in VideoPlayerScreen for why that tracked state alone isn't
  // reliable here.
  forceFocused?: boolean;
  // False while the subtitle panel is open - see the panel's own containment comment in
  // VideoPlayerScreen.
  focusable?: boolean;
}>(function FocusableSeekBar({ currentTime, duration, isSeeking, onFocus, onPress, nextFocusUp, nextFocusDown, forceFocused, focusable }, ref) {
  const playedPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <Focusable
      ref={ref}
      onPress={onPress}
      onFocusChange={(focused) => focused && onFocus?.()}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      focusable={focusable}
      scaleTo={1}
    >
      {(trackedFocused: boolean) => {
        const focused = trackedFocused || !!forceFocused;
        return (
          <View style={styles.seekRow}>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
            <View style={styles.seekTrack}>
              <View style={styles.seekTrackBg} pointerEvents="none" />
              <View style={[styles.seekTrackFill, focused && styles.seekTrackFillFocused, { width: `${playedPct}%` }]} pointerEvents="none" />
              {isSeeking && (
                <View style={[styles.seekBubble, { left: `${playedPct}%` }]} pointerEvents="none">
                  <Text style={styles.seekBubbleText}>{formatTime(currentTime)}</Text>
                </View>
              )}
              <View
                style={[styles.seekThumb, (isSeeking || focused) && styles.seekThumbActive, { left: `${playedPct}%` }]}
                pointerEvents="none"
              />
            </View>
            <Text style={styles.timeText}>{formatDuration(duration)}</Text>
          </View>
        );
      }}
    </Focusable>
  );
});

const CtrlButton = React.forwardRef<View, {
  Icon: typeof Play;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  big?: boolean;
  iconFill?: boolean;
  // Overrides the highlight regardless of Focusable's own tracked focus state - see
  // activeControl's own comment in VideoPlayerScreen for why that tracked state alone isn't
  // reliable here.
  forceFocused?: boolean;
  // False while the subtitle panel is open, for the two of these three controls it should fully
  // contain focus away from - see the panel's own containment comment in VideoPlayerScreen.
  focusable?: boolean;
}>(function CtrlButton(
  { Icon, onPress, onPressIn, onPressOut, onFocus, hasTVPreferredFocus, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight, big, iconFill, forceFocused, focusable },
  ref
) {
  return (
    <Focusable
      ref={ref}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onFocusChange={(focused) => focused && onFocus?.()}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      focusable={focusable}
      scaleTo={1.1}
      focusRadius={big ? s(34) : s(26)}
      clipFocusOverflow
    >
      {(trackedFocused: boolean) => {
        const focused = trackedFocused || !!forceFocused;
        return (
          // No focusShadow - ctrlBtnFocused already turns this solid white, and a white glow
          // behind an already-white fill is redundant at best (rendered as a visible hatch
          // artifact on at least one real device).
          <View style={[styles.ctrlBtn, big && styles.ctrlBtnBig, focused && styles.ctrlBtnFocused]}>
            <Icon size={big ? s(28) : s(22)} color={focused ? "#000" : "#fff"} fill={iconFill ? (focused ? "#000" : "#fff") : "none"} />
          </View>
        );
      }}
    </Focusable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  // See handleExit's own comment above - covers the real teardown/remount work on the way out
  // with visible feedback instead of an apparent freeze.
  exitOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "#000", alignItems: "center", justifyContent: "center", gap: s(14), zIndex: 999 },
  exitOverlayText: { color: "#fff", fontSize: fs(14), fontFamily: font.semiBold },
  // Shown only until the YouTube iframe API actually reports PLAYING - covers the WebView's own
  // load + YouTube's own player bootstrap, which otherwise briefly shows a plain black screen.
  youtubeLoadingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  // See its own render-site comment - a plain text credit (not a redrawn copy of YouTube's actual
  // logo), positioned clear of both the movie header above and the bottom control bar below.
  youtubeCredit: { position: "absolute", top: s(24), right: s(24) },
  youtubeCreditText: { color: "rgba(255,255,255,0.55)", fontSize: fs(11), fontFamily: font.bold, letterSpacing: 0.3 },
  unavailableWrap: { alignItems: "center", justifyContent: "center", gap: s(12), paddingHorizontal: s(60) },
  unavailableTitle: { color: "#fff", fontSize: fs(18), fontFamily: font.bold, textAlign: "center" },
  unavailableDesc: { color: colors.textMuted, fontSize: fs(13), fontFamily: font.regular, textAlign: "center" },
  unavailableBackBtn: {
    marginTop: s(10),
    paddingHorizontal: s(28),
    paddingVertical: s(11),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  unavailableBackBtnText: { color: "#fff", fontSize: fs(13), fontFamily: font.bold },
  loadingWrap: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  subtitleWrap: { position: "absolute", left: 0, right: 0, bottom: s(130), alignItems: "center", paddingHorizontal: s(40) },
  subtitleText: {
    textAlign: "center",
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    // Square corners on the background box (was borderRadius 6), per request.
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Floats above the bottom bar now (was pinned to the top-right screen corner) - anchored to
  // one side (not centered) per request, still clear of any screen edge. s(180) clears the
  // bottom bar's own height (padding + seek row + big control button) with room to spare.
  ageRatingWrap: { position: "absolute", left: 0, right: 0, bottom: s(180), alignItems: "flex-end", paddingRight: s(32) },
  ageRatingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    backgroundColor: "rgba(0,0,0,0.8)",
    // Sharp on the stripe's own side (left), rounded on the other - a flat accent edge reads
    // better meeting the colored stripe than a rounded corner clipping it.
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    borderTopRightRadius: s(12),
    borderBottomRightRadius: s(12),
    overflow: "hidden",
    paddingHorizontal: s(20),
    paddingVertical: s(13),
  },
  // Absolutely positioned rather than a plain leading child, so its height always matches the
  // banner's own (however tall the two-line description makes it) instead of only the row's
  // cross-axis alignment guessing at it.
  ageRatingStripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: s(5) },
  ageRatingCode: { color: "#fff", fontSize: fs(15), fontFamily: font.black },
  ageRatingDesc: { color: "#d4d4d8", fontSize: fs(12.5), fontFamily: font.semiBold, marginTop: s(2) },
  // Raised up near the very top of the screen (was bunched together with the controls at the
  // bottom) with its own soft top-down gradient instead of sharing one flat rectangle with
  // everything else.
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    padding: s(32),
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: s(32),
    paddingTop: s(48),
    gap: s(16),
  },
  // See the shared-gradient comment above where this is rendered - one continuous scrim behind
  // both the control bar and (once open) the episode row, instead of each drawing its own.
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  hidden: { opacity: 0 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: s(20) },
  headerLeft: { flex: 1 },
  headerRight: { alignItems: "flex-end", gap: s(6), maxWidth: "60%" },
  playerLogo: { marginBottom: s(4) },
  // Stands in for a missing title logo (s(50) tall) - enlarged from fs(18), then 26, then 30, per request.
  title: { color: "#fff", fontSize: fs(32), fontFamily: font.extraBold },
  metaText: { color: "#d4d4d8", fontSize: fs(13), fontFamily: font.semiBold, textAlign: "right" },
  // More items land in this one line now (age rating, year, country, language, genres,
  // quality, rating) - wraps rather than overflowing the screen edge or squeezing the title
  // on a narrower device, and stays right-aligned on every wrapped line to match headerRight.
  factsRow: { flexDirection: "row", flexWrap: "wrap", gap: s(10), alignItems: "center", justifyContent: "flex-end" },
  ageBadge: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)", borderRadius: 4, paddingHorizontal: s(6), paddingVertical: s(1) },
  ageBadgeText: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
  factText: { color: "#d4d4d8", fontSize: fs(12), fontFamily: font.bold },
  imdbRow: { flexDirection: "row", gap: s(5), alignItems: "center" },
  // Same badge used across the app, just recolored (white instead of the IMDb-brand yellow)
  // to sit better against this screen's own black/white control palette.
  imdbBadgeWhite: { backgroundColor: "#fff", borderRadius: 3, paddingHorizontal: s(5), paddingVertical: s(1) },
  imdbBadgeWhiteText: { color: "#000", fontSize: fs(9), fontFamily: font.black },
  factRating: { color: "#fff", fontSize: fs(13), fontFamily: font.black },
  seekRow: { flexDirection: "row", alignItems: "center", gap: s(12) },
  timeText: { color: "#fff", fontSize: fs(12), fontFamily: font.semiBold, width: s(54), textAlign: "center" },
  seekTrack: { flex: 1, height: s(24), justifyContent: "center" },
  // Track thickens and the fill glows a bit brighter while the bar itself has focus - the only
  // visual cue (besides the bigger thumb below) that D-pad input lands here now that it's a
  // real control, not just a display.
  seekTrackFocused: { height: s(28) },
  seekTrackBg: { position: "absolute", left: 0, right: 0, height: s(4), borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)" },
  seekTrackFill: { position: "absolute", left: 0, height: s(4), borderRadius: 2, backgroundColor: "#fff" },
  seekTrackFillFocused: { height: s(6), shadowColor: "#fff", shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  // Single sliding thumb instead of a row of visible dots - sits at the live playback position
  // while idle, and jumps to preview whichever stop currently has focus (see focusedStop
  // above). marginLeft is a fixed pixel offset (half the thumb's own width) atop a percentage
  // `left`, which is what actually centers it on that fraction point - RN's transform doesn't
  // support percentage values, so this is the usual way to center something positioned with a
  // percentage offset.
  seekThumb: {
    position: "absolute",
    top: "50%",
    marginTop: -s(7),
    marginLeft: -s(7),
    width: s(14),
    height: s(14),
    borderRadius: s(7),
    backgroundColor: "#fff",
  },
  seekThumbActive: { width: s(18), height: s(18), borderRadius: s(9), marginTop: -s(9), marginLeft: -s(9) },
  seekBubble: {
    position: "absolute",
    bottom: "100%",
    marginBottom: s(10),
    marginLeft: -s(24),
    width: s(48),
    paddingVertical: s(4),
    borderRadius: 6,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  seekBubbleText: { color: "#000", fontSize: fs(11), fontFamily: font.black },
  controlsRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: s(4) },
  episodeHint: { alignItems: "center", marginTop: s(2) },
  // Pinned to the screen's own right edge (not centered alongside play/pause, not floating mid-
  // screen) but at the same height as it - bottomBar's own bottom padding (s(32)) plus half of
  // play/pause's big circle (s(34)) is how far up from the screen's bottom edge that circle's
  // center sits; this button's own (smaller, non-big) half-height (s(26)) is subtracted back off
  // so its center lands on that same line instead of its top edge.
  subtitlesBtnFloat: { position: "absolute", right: s(24), bottom: s(32) + s(34) - s(26) },
  // One button-width-plus-gap to the left of the subtitles button (which sits at s(24)) - same
  // row, same floating/independent treatment.
  qualityBtnFloat: { position: "absolute", right: s(24) + s(52) + s(12), bottom: s(32) + s(34) - s(26) },
  ctrlBtn: {
    width: s(52),
    height: s(52),
    borderRadius: s(26),
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlBtnBig: { width: s(68), height: s(68), borderRadius: s(34) },
  ctrlBtnFocused: { borderColor: "#fff", backgroundColor: "#fff" },
  // Anchored to open *upward* from the floating subtitles button (same height as play/pause, see
  // subtitlesBtnFloat) rather than centered/full-screen - a real modal would need its own
  // dismiss-on-outside-press handling and would fight the underlying player's own bars for
  // attention; a docked panel reads as "adjusting a setting while watching," which is the point.
  // `bottom` here clears the button's own full height (see subtitlesBtnFloat's own math) plus a
  // small gap, so the panel's content (bottom-aligned via flex-end) grows up and away from it
  // instead of overlapping it.
  subtitlePanelWrap: { position: "absolute", right: s(24), top: s(32), bottom: s(32) + s(34) - s(26) + s(52) + s(8), justifyContent: "flex-end" },
  // Same anchoring as subtitlePanelWrap, just lined up over qualityBtnFloat instead - opens
  // upward from the quality button the same way the subtitle panel does from its own button.
  qualityPanelWrap: { position: "absolute", right: s(24) + s(52) + s(12), top: s(32), bottom: s(32) + s(34) - s(26) + s(52) + s(8), justifyContent: "flex-end" },
  // Same fill/border/radius recipe as SettingsScreen's own `card`, but noticeably more see-
  // through - a page-level card can afford to be a near-opaque surface; a panel sitting on top
  // of the video itself reads better staying visibly a layer *over* the picture, not a solid
  // block hiding it. Sized closer to a real settings surface now (was a much smaller compact
  // version) to actually fit the fuller set of controls below with room to breathe.
  // Narrower and less padded than before (was 340/18, then 300/14) - per-row collapsing (see
  // openSettingRow/openSyncRow above) already did most of the work of shrinking this panel; this
  // trims the remaining chrome around it further to match, per explicit follow-up request.
  subtitlePanel: {
    width: s(270),
    backgroundColor: "rgba(15,15,17,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: s(14),
    padding: s(12),
  },
  // Narrower than the subtitle panel it otherwise shares chrome with (was that same s(270)) - a
  // quality list is only a few short labels. No header/close button either: Back already closes it.
  qualityPanelCard: { width: s(150) },
  panelSection: { paddingVertical: s(8) },
  panelRowLabel: { color: "#fff", fontSize: fs(12), fontFamily: font.regular },
  panelRowDesc: { color: colors.textMuted, fontSize: fs(10), fontFamily: font.regular, marginTop: s(3), maxWidth: s(200) },
  panelValueText: { color: colors.textMuted, fontSize: fs(11), fontFamily: font.regular },
  // Rows that pair a label with one compact control on the trailing edge - same "label left,
  // control right" shape as SettingsRow.
  panelRowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelToggleRow: { paddingVertical: s(10) },
  panelToggleTextCol: { flex: 1, paddingRight: s(14) },
  // The panel's two collapsible section headers (settings/sync) - a slightly raised surface (not
  // just plain text) so a collapsed section still reads as a real, pressable row on its own,
  // not just a stray label floating in the panel.
  panelSectionHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(9),
    paddingVertical: s(7),
    borderRadius: s(8),
    backgroundColor: "rgba(255,255,255,0.06)",
    marginVertical: s(3),
  },
  panelSectionHeaderFocused: { backgroundColor: "#fff" },
  panelSectionHeaderText: { color: "#fff", fontSize: fs(12), fontFamily: font.semiBold },
  // A thin, plainly-gray line (not a low-alpha white tint) - reads as a deliberate divider at a
  // glance instead of nearly disappearing against this panel's own dark fill.
  panelRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#4b4b52" },
  // Same recipe as SettingsScreen's `segmented`/`segmentItem` - a pill-track wrapper with each
  // option sized by flex instead of its own padding, so 3-4 options always split this panel's
  // fixed width evenly instead of wrapping or overflowing at different label lengths.
  segmented: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radius.pill,
    padding: s(4),
    gap: s(3),
    marginTop: s(8),
  },
  // flex:1 lives on segmentItemWrap (a plain View, sized by the row) - see the map() call site's
  // own comment for why this View, not this one, is what needs it.
  segmentItemWrap: { flex: 1 },
  segmentItemTouch: { width: "100%" },
  segmentItem: { height: s(32), borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentItemActive: { backgroundColor: "rgba(255,255,255,0.22)" },
  segmentItemFocused: { backgroundColor: "#fff" },
  segmentText: { color: colors.textSecondary, fontSize: fs(11.5), fontFamily: font.regular },
  segmentTextActive: { color: "#fff" },
  segmentTextFocused: { color: "#000" },
  panelSwatchRow: { flexDirection: "row", gap: s(10), marginTop: s(8) },
  panelSwatch: {
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  panelSwatchFocused: { borderColor: "#fff", transform: [{ scale: 1.15 }] },
  // A ring *around* the track (not a border on the track itself) - the track's own fill turns
  // solid white when active (see toggleTrackActive), and a white focus border painted directly
  // on that same white fill was invisible in exactly that state. Drawn on this panel's own dark
  // background instead, the ring stays visible regardless of whether the toggle is on or off.
  toggleFocusRing: { borderRadius: s(16), borderWidth: 2, borderColor: "transparent", padding: s(3) },
  toggleFocusRingFocused: { borderColor: "#fff" },
  // Same real sliding-knob switch as SettingsScreen's own toggleTrack/toggleKnob.
  toggleTrack: {
    width: s(40),
    height: s(23),
    borderRadius: s(12),
    backgroundColor: "rgba(255,255,255,0.15)",
    padding: s(3),
    justifyContent: "center",
  },
  toggleTrackActive: { backgroundColor: "#fff" },
  toggleKnob: { width: s(17), height: s(17), borderRadius: s(8.5), backgroundColor: "#fff", alignSelf: "flex-start" },
  toggleKnobActive: { backgroundColor: "#000", alignSelf: "flex-end" },
  // The font-size slider - a track + a thumb positioned by percent, same visual language as the
  // seek bar/StopsSlider elsewhere in the app.
  sizeSliderTrack: { height: s(20), justifyContent: "center", marginTop: s(8) },
  sizeSliderTrackBg: { position: "absolute", left: 0, right: 0, height: s(4), borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  sizeSliderTrackFill: { position: "absolute", left: 0, height: s(4), borderRadius: 2, backgroundColor: "#fff" },
  sizeSliderThumb: {
    position: "absolute",
    top: "50%",
    marginTop: -s(7),
    marginLeft: -s(7),
    width: s(14),
    height: s(14),
    borderRadius: s(7),
    backgroundColor: "#fff",
  },
  sizeSliderThumbFocused: { width: s(18), height: s(18), borderRadius: s(9), marginTop: -s(9), marginLeft: -s(9) },
  // A read-only version of the same track/thumb shape for the delay row (see StepSlider's own
  // comment on why this one isn't itself interactive), plus a center tick marking "0".
  // Centered as one compact group, not stretched to the panel's own edges - the two buttons
  // and the value between them read as a single control this way instead of a wide,
  // oddly-spaced row.
  panelStepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: s(10) },
  panelStepperRowSpaced: { marginTop: s(8) },
  // A plain fixed-width touch target (see the map() call site's own comment on why fixed instead
  // of flex - a Focusable's `style` never reaches the Pressable actually occupying this row).
  delayStepTouch: { width: s(96) },
  // Bigger and more clearly a button (real border, taller) than this row's other siblings -
  // reported as hard to reach/press, and a small low-contrast target is exactly what makes a
  // D-pad row feel unreliable even when the focus chain itself is fine.
  delayStepBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(6),
    height: s(38),
    borderRadius: s(10),
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  delayStepLabel: { color: colors.textSecondary, fontSize: fs(12.5), fontFamily: font.regular },
  delayValueBox: { flexDirection: "row", alignItems: "baseline", gap: s(2), minWidth: s(56), justifyContent: "center" },
  panelDelayText: { color: "#fff", fontSize: fs(17), fontFamily: font.semiBold },
  delayValueUnit: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.regular },
});
