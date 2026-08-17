import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Captions, ChevronUp, Megaphone, Pause, Play, RotateCcw,
  SkipBack, SkipForward, Volume2, VolumeX,
} from "lucide-react";
import type { Ad, AdsSettings, Episode, Movie } from "../types";
import { FocusNavProvider, useFocusAnyInput, useFocusNavActions, useFocusNode, useFocusZone } from "../hooks/useFocusNav";
import { formatDuration } from "../utils/formatDuration";
import { SubtitlePanel } from "./SubtitlePanel";

const FOCUS_RING = "ring-2 ring-white ring-offset-2 ring-offset-zinc-950";

export interface VideoPlayerProps {
  lang: "ar" | "en";
  playingMovie: Movie;
  activeEpisode: Episode | null;
  adsSettings: AdsSettings | null;
  currentAd: Ad | null;
  isAdPlaying: boolean;
  adTimeRemaining: number;
  canSkipAd: boolean;
  skipOrFinishAd: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  handleTimeUpdate: () => void;
  handleVideoLoaded: () => void;
  playNextMedia: () => void;
  playPrevMedia: () => void;
  isVideoBuffering: boolean;
  setIsVideoBuffering: (v: boolean) => void;
  showQuarterHourOverlay: boolean;
  playerSubtitles: string;
  setPlayerSubtitles: (v: string) => void;
  getSubtitleForTime: (t: number) => string;
  getSubtitleForTimeEn: (t: number) => string;
  subShadow: boolean;
  setSubShadow: (v: boolean) => void;
  subFont: string;
  setSubFont: (v: string) => void;
  subSize: string;
  setSubSize: (v: string) => void;
  subColor: string;
  setSubColor: (v: string) => void;
  controlsVisible: boolean;
  showControlsAndResetTimer: () => void;
  playerProgress: number;
  playerDuration: number;
  saveCurrentProgress: (movie: Movie, currentTimeSec: number, progressPercent: number) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  togglePlay: () => void;
  playerMuted: boolean;
  setPlayerMuted: (v: boolean) => void;
  setPlayerToast: (v: string | null) => void;
  isScrubbingSeek: boolean;
  setIsScrubbingSeek: (v: boolean) => void;
  onClose: () => void;
}

export function VideoPlayer(props: VideoPlayerProps) {
  return (
    <FocusNavProvider dir={props.lang === "ar" ? "rtl" : "ltr"} initialZoneId="player.seek" onUnhandledBack={props.onClose} startUnfocused>
      <VideoPlayerInner {...props} />
    </FocusNavProvider>
  );
}

function VideoPlayerInner(props: VideoPlayerProps) {
  const {
    lang, playingMovie, activeEpisode, adsSettings, currentAd, isAdPlaying, adTimeRemaining, canSkipAd,
    skipOrFinishAd, videoRef, handleTimeUpdate, handleVideoLoaded, playNextMedia, playPrevMedia,
    isVideoBuffering, setIsVideoBuffering, showQuarterHourOverlay, playerSubtitles, getSubtitleForTime,
    getSubtitleForTimeEn, subShadow, subFont, subSize, subColor, controlsVisible, showControlsAndResetTimer,
    playerProgress, playerDuration, saveCurrentProgress, isPlaying, setIsPlaying, togglePlay, playerMuted, setPlayerMuted,
    isScrubbingSeek, setIsScrubbingSeek, onClose,
  } = props;

  const [showSubSettings, setShowSubSettings] = useState(false);
  const [hoverSeekPos, setHoverSeekPos] = useState<{ percent: number; time: number } | null>(null);

  const { setFocus } = useFocusNavActions();

  // Any D-pad activity should keep the control bar visible, just like mouse movement
  // already does — this is what fixes the bar vanishing for good on remote-only input.
  useFocusAnyInput(showControlsAndResetTimer);

  // Tracks the actual previous value (not a "have I run yet" flag) so StrictMode's
  // dev-mode double-invocation of this effect — which re-runs it with an unchanged
  // isAdPlaying — can't misread a repeat call as a real ad-ended transition.
  const prevIsAdPlayingRef = useRef(isAdPlaying);
  useEffect(() => {
    const wasAdPlaying = prevIsAdPlayingRef.current;
    prevIsAdPlayingRef.current = isAdPlaying;
    if (isAdPlaying) {
      setFocus("player.ad", "skip");
    } else if (wasAdPlaying) {
      // Ad just ended (true -> false) — restore focus to the transport.
      setFocus("player.seek", "seek");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdPlaying]);

  const seekBy = (deltaSeconds: number) => {
    if (!videoRef.current) return;
    const target = (videoRef.current.currentTime || 0) + deltaSeconds;
    const duration = videoRef.current.duration;
    if (!isFinite(target)) return;
    videoRef.current.currentTime = deltaSeconds < 0
      ? Math.max(0, target)
      : ((isFinite(duration) && duration > 0) ? Math.min(duration, target) : target);
  };

  useFocusZone({
    id: "player.ad",
    layout: () => [["skip"]],
  });
  const skipNode = useFocusNode({
    zoneId: "player.ad",
    id: "skip",
    onSelect: () => { if (canSkipAd) skipOrFinishAd(); },
    disabled: !canSkipAd,
  });

  useFocusZone({
    id: "player.top",
    layout: () => [["back"]],
    onEdge: (dir) => {
      if (dir === "down") return { zoneId: "player.seek", nodeId: "seek" };
      return;
    },
  });
  const backNode = useFocusNode({ zoneId: "player.top", id: "back", onSelect: onClose });

  useFocusZone({
    id: "player.seek",
    layout: () => [["seek"]],
    onEdge: (dir) => {
      // The seek bar is always a physical left-to-right timeline (it's forced dir="ltr"
      // below, matching the original app), so seeking must use the raw physical key,
      // not the RTL-flipped logical direction every other zone reasons in — undo the
      // flip here specifically.
      const physicalDir = lang === "ar" ? (dir === "left" ? "right" : dir === "right" ? "left" : dir) : dir;
      if (physicalDir === "left") { seekBy(-15); return; }
      if (physicalDir === "right") { seekBy(15); return; }
      if (dir === "down") return { zoneId: "player.controls", nodeId: "playpause" };
      if (dir === "up") return { zoneId: "player.top", nodeId: "back" };
      return;
    },
  });
  const seekNode = useFocusNode({ zoneId: "player.seek", id: "seek", onSelect: togglePlay });

  // Fixed physical/visual order of the three flex groups in the control bar (subtitles
  // group, transport group, mute group) - the row itself is forced dir="ltr" below
  // regardless of app language (same button positions in Arabic as in English), unlike
  // the rest of the player which mirrors with dir. Since useFocusNav's single RTL flip
  // point (physical Left/Right -> logical start/end) still applies uniformly across the
  // whole player, a row that no longer visually mirrors needs its *navigation* layout
  // reversed to compensate, so a logical move still lands on the button that's physically
  // adjacent on screen - see navControlIds below.
  const controlIds = [
    "subtitles",
    ...(playingMovie.type === "series" ? ["prev"] : []),
    "rewind", "playpause",
    ...(playingMovie.type === "series" ? ["next"] : []),
    "mute",
  ];
  const navControlIds = lang === "ar" ? [...controlIds].reverse() : controlIds;
  useFocusZone({
    id: "player.controls",
    layout: () => [navControlIds],
    onEdge: (dir) => {
      if (dir === "up") return { zoneId: "player.seek", nodeId: "seek" };
      return;
    },
  });
  const prevNode = useFocusNode({ zoneId: "player.controls", id: "prev", onSelect: playPrevMedia });
  const rewindNode = useFocusNode({ zoneId: "player.controls", id: "rewind", onSelect: () => seekBy(-15) });
  const playPauseNode = useFocusNode({ zoneId: "player.controls", id: "playpause", onSelect: togglePlay });
  const subtitlesNode = useFocusNode({
    zoneId: "player.controls",
    id: "subtitles",
    onSelect: () => {
      setShowSubSettings(true);
      showControlsAndResetTimer();
      setFocus("player.subtitle-panel");
    },
  });
  const nextNode = useFocusNode({ zoneId: "player.controls", id: "next", onSelect: playNextMedia });
  const muteNode = useFocusNode({ zoneId: "player.controls", id: "mute", onSelect: () => setPlayerMuted(!playerMuted) });

  return (
    <div
      className={`absolute inset-0 bg-black z-[100] select-none transition-all duration-500 ${controlsVisible ? "cursor-default" : "cursor-none"}`}
      onMouseMove={showControlsAndResetTimer}
      onClick={showControlsAndResetTimer}
    >
      {/* Pre-Roll Advertisement Header & Skip Button Overlay */}
      {isAdPlaying && currentAd && (
        <>
          <div className="absolute top-5 inset-x-5 z-[110] flex items-center justify-between pointer-events-none" dir={lang === "ar" ? "rtl" : "ltr"}>
            <div className="flex items-center gap-3 bg-black/80 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-amber-500/40 shadow-xl">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-400 font-extrabold animate-pulse">
                <Megaphone className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-amber-500 text-black font-black text-[9px] uppercase tracking-wider">
                    {lang === "ar" ? "إعلان ترعاه القناة" : "Sponsored Ad"}
                  </span>
                  <span className="text-white font-bold text-xs truncate max-w-[200px]">
                    {(lang === "ar" ? currentAd.sponsorNameAr : currentAd.sponsorNameEn) || currentAd.sponsorNameAr || currentAd.sponsorNameEn || (currentAd as any).sponsorName || (lang === "ar" ? "راعي متميز" : "Featured Sponsor")}
                  </span>
                </div>
                <h4 className="text-zinc-300 font-medium text-[11px] truncate max-w-[280px]">
                  {lang === "ar" ? currentAd.titleAr : currentAd.titleEn}
                </h4>
              </div>
            </div>

            <div className="bg-black/80 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/10 text-white text-xs font-bold font-num flex items-center gap-2 shadow-lg">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>{lang === "ar" ? `ينتهي الإعلان خلال ${adTimeRemaining} ثانية` : `Ad ends in ${adTimeRemaining}s`}</span>
            </div>
          </div>

          <div className="absolute bottom-10 z-[110] pointer-events-auto" style={{ [lang === "ar" ? "left" : "right"]: "2rem" }}>
            {canSkipAd ? (
              <button
                ref={skipNode.ref as React.RefObject<HTMLButtonElement>}
                type="button"
                onClick={skipOrFinishAd}
                className={`px-5 py-3 rounded-2xl font-black text-xs bg-amber-500 hover:bg-amber-400 text-black shadow-2xl flex items-center gap-2 transition-all transform hover:scale-105 active:scale-95 cursor-pointer border border-amber-300 ${skipNode.isFocused ? FOCUS_RING : ""}`}
              >
                <span>{lang === "ar" ? "تخطي الإعلان والبدء بالفيديو" : "Skip Ad & Play Media"}</span>
                <SkipForward className="w-4 h-4" />
              </button>
            ) : (
              <div className="px-4 py-2.5 rounded-2xl font-bold text-xs bg-black/80 backdrop-blur-md text-zinc-300 border border-white/15 shadow-xl flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
                <span>
                  {lang === "ar"
                    ? `يمكنك تخطي الإعلان بعد ${Math.max(1, (currentAd.skipAfterSeconds ?? adsSettings?.globalSkipAfterSeconds ?? 5) - Math.floor(videoRef.current?.currentTime || 0))} ث`
                    : `Skip available in ${Math.max(1, (currentAd.skipAfterSeconds ?? adsSettings?.globalSkipAfterSeconds ?? 5) - Math.floor(videoRef.current?.currentTime || 0))}s`}
                </span>
              </div>
            )}
          </div>
        </>
      )}

      <video
        ref={videoRef as React.RefObject<HTMLVideoElement>}
        className="absolute inset-0 w-full h-full object-contain bg-black"
        autoPlay
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleVideoLoaded}
        onLoadStart={() => setIsVideoBuffering(true)}
        onWaiting={() => setIsVideoBuffering(true)}
        onSeeking={() => setIsVideoBuffering(true)}
        onSeeked={() => setIsVideoBuffering(false)}
        onCanPlay={() => setIsVideoBuffering(false)}
        onPlaying={() => setIsVideoBuffering(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => { if (isAdPlaying) { skipOrFinishAd(); } else { playNextMedia(); } }}
      />

      {isVideoBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-30">
          <div className="w-12 h-12 border-3 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {showQuarterHourOverlay && playingMovie && (
        <div
          className={`absolute top-4 sm:top-5 z-40 max-w-sm sm:max-w-md py-2 sm:py-2.5 px-4 sm:px-6 anim-fade-in pointer-events-none flex flex-col gap-0.5 ${
            lang === "ar"
              ? "right-0 bg-gradient-to-l from-black via-black/90 via-black/55 to-transparent pr-5 sm:pr-8 pl-12 sm:pl-20"
              : "left-0 bg-gradient-to-r from-black via-black/90 via-black/55 to-transparent pl-5 sm:pl-8 pr-12 sm:pr-20"
          }`}
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <h3 className="text-sm sm:text-base font-extrabold text-white truncate leading-tight drop-shadow-md">
            {lang === "ar" ? playingMovie.titleAr : playingMovie.titleEn}
            {activeEpisode && ` - ${lang === "ar" ? `الحلقة ${activeEpisode.number}` : `Episode ${activeEpisode.number}`}`}
          </h3>
          <div className="flex items-center gap-2 text-[11px] sm:text-xs text-white/90 font-medium mt-0.5 flex-wrap">
            <span className="text-white font-bold text-[11px]">
              {playingMovie.type === "series" ? (lang === "ar" ? "مسلسل" : "Series") : (lang === "ar" ? "فيلم" : "Movie")}
            </span>
            <span className="text-white/40">•</span>
            <span className="text-white font-num text-[11px]">{playingMovie.year}</span>
            {playingMovie.rating && (
              <>
                <span className="text-white/40">•</span>
                <span className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-[#f5c518] text-black font-black text-[9px] uppercase tracking-wider leading-none shadow-sm">IMDb</span>
                  <span className="text-white font-num font-bold text-[11px]">{playingMovie.rating}</span>
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {playerSubtitles !== "off" && (
        <div className="absolute bottom-28 inset-x-0 pointer-events-none z-40 flex justify-center px-6">
          {(() => {
            const curTime = videoRef.current?.currentTime || 0;
            const text = playerSubtitles === "ar" ? getSubtitleForTime(curTime) : getSubtitleForTimeEn(curTime);
            if (!text) return null;
            return (
              <div
                className={`text-center px-4 py-1.5 rounded-lg transition-all duration-300 max-w-[80%] ${
                  subShadow ? "bg-black/80 border border-black/20 shadow-2xl" : "bg-transparent border-transparent shadow-none"
                } ${
                  subFont === "Cairo" ? "font-['Cairo']" : subFont === "Tajawal" ? "font-['Tajawal']" : subFont === "Amiri" ? "font-['Amiri']" : "font-mono"
                } ${
                  subSize === "small" ? "text-sm" : subSize === "medium" ? "text-base md:text-lg" : subSize === "large" ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"
                } ${
                  subColor === "yellow" ? "text-yellow-400 font-extrabold" : subColor === "white" ? "text-white font-medium" : subColor === "cyan" ? "text-cyan-400 font-medium" : "text-green-400 font-medium"
                }`}
                style={{ textShadow: subShadow ? "2px 2px 4px rgba(0,0,0,0.95)" : "2px 2px 3px rgba(0,0,0,0.8)", lineHeight: "1.4" }}
              >
                {text}
              </div>
            );
          })()}
        </div>
      )}

      {(
        <div
          className={`absolute top-0 inset-x-0 bg-gradient-to-b from-black/90 via-black/55 to-transparent p-6 z-50 flex items-center justify-between transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <button
            ref={backNode.ref as React.RefObject<HTMLButtonElement>}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className={`flex items-center gap-2 text-white bg-zinc-900/80 hover:bg-zinc-800 border border-white/10 px-4 py-2.5 rounded-xl transition-all cursor-pointer active:scale-95 ${backNode.isFocused ? FOCUS_RING : ""}`}
          >
            <ArrowLeft className={`w-4 h-4 ${lang === "ar" ? "rotate-180" : ""}`} />
            <span className="text-xs font-bold">{lang === "ar" ? "رجوع" : "Back"}</span>
          </button>
          <h2 className="text-white text-sm md:text-base font-black truncate max-w-[60%]">
            {lang === "ar" ? playingMovie.titleAr : playingMovie.titleEn}
            {activeEpisode && ` - ${lang === "ar" ? `الحلقة ${activeEpisode.number}` : `Episode ${activeEpisode.number}`}`}
          </h2>
          <div className="w-24" />
        </div>
      )}

      {(
        <div
          className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent p-6 z-50 flex flex-col gap-4 transition-opacity duration-300 ${controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          dir={lang === "ar" ? "rtl" : "ltr"}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Seek Bar (Enforce LTR direction for standard left-to-right progress bar) */}
          <div className="flex items-center gap-3 w-full" dir="ltr">
            <span className="text-xs text-zinc-300 font-num font-bold min-w-[42px] text-right">
              {formatDuration(videoRef.current?.currentTime || 0)}
            </span>

            <div
              ref={seekNode.ref as React.RefObject<HTMLDivElement>}
              className="flex-1 py-2 cursor-pointer relative group flex items-center rounded-lg"
              onMouseEnter={showControlsAndResetTimer}
              onMouseMove={(e) => {
                showControlsAndResetTimer();
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const duration = videoRef.current?.duration || playerDuration || 0;
                const hoverTime = pos * duration;
                setHoverSeekPos({ percent: pos * 100, time: hoverTime });
                if (isScrubbingSeek && videoRef.current && isFinite(hoverTime)) {
                  videoRef.current.currentTime = hoverTime;
                }
              }}
              onMouseLeave={() => { setHoverSeekPos(null); setIsScrubbingSeek(false); }}
              onMouseUp={() => {
                setIsScrubbingSeek(false);
                if (videoRef.current && playingMovie) {
                  const cur = videoRef.current.currentTime || 0;
                  const dur = videoRef.current.duration || 0;
                  const pct = (isFinite(dur) && dur > 0) ? (cur / dur) * 100 : 0;
                  saveCurrentProgress(playingMovie, cur, pct);
                }
              }}
              onMouseDown={(e) => {
                setIsScrubbingSeek(true);
                if (videoRef.current) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const duration = videoRef.current.duration || playerDuration || 0;
                  const target = pos * duration;
                  if (isFinite(target)) {
                    videoRef.current.currentTime = target;
                  }
                }
              }}
            >
              {hoverSeekPos !== null && (
                <div
                  className="absolute -top-8 -translate-x-1/2 px-2.5 py-1 rounded-lg bg-zinc-950/95 border border-white/30 text-white font-num font-extrabold text-[11px] shadow-[0_4px_15px_rgba(0,0,0,0.85)] pointer-events-none z-50 flex items-center gap-1.5 anim-fade-in"
                  style={{ left: `${hoverSeekPos.percent}%` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span>{formatDuration(hoverSeekPos.time)}</span>
                </div>
              )}

              <div className="w-full h-1 bg-zinc-800 group-hover:h-1.5 rounded-full overflow-visible relative transition-all duration-150">
                <div className="h-full bg-white rounded-full relative" style={{ width: `${playerProgress}%` }}>
                  <div className={`absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.9)] ring-2 ring-zinc-950 transition-transform duration-150 ${seekNode.isFocused ? "scale-125" : "scale-90 group-hover:scale-125"}`}>
                    {hoverSeekPos === null && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-zinc-900 border border-white/30 text-white text-[10px] font-black font-num shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        {formatDuration(videoRef.current?.currentTime || 0)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <span className="text-xs text-zinc-300 font-num font-bold min-w-[42px]">{formatDuration(playerDuration)}</span>
          </div>

          {/* Forced ltr regardless of app language: buttons stay in the same physical
              position in Arabic as in English (matches the seek bar's existing "always
              ltr" precedent above) - navControlIds compensates the keyboard navigation
              for this, see its definition above. */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4" dir="ltr">
            {/* Left: Subtitles Dropdown */}
            <div className="relative flex items-center gap-2.5 w-full sm:w-auto justify-start">
              <div className="relative">
                <button
                  ref={subtitlesNode.ref as React.RefObject<HTMLButtonElement>}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSubSettings(!showSubSettings);
                    showControlsAndResetTimer();
                  }}
                  className={`flex items-center gap-2 px-3.5 py-2 border rounded-xl text-xs font-extrabold cursor-pointer transition-all duration-200 shadow-md ${subtitlesNode.isFocused ? FOCUS_RING : ""} ${
                    showSubSettings ? "bg-white border-white text-zinc-950 shadow-white/25" : "bg-zinc-900/85 hover:bg-zinc-800 border-zinc-800 text-zinc-300 hover:text-white"
                  }`}
                >
                  <Captions className={`w-4 h-4 ${showSubSettings ? "text-zinc-950" : "text-zinc-400"}`} />
                  <span>{lang === "ar" ? "إعدادات الترجمة" : "Subtitle Settings"}</span>
                  <ChevronUp className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-300 ${showSubSettings ? "rotate-180" : ""}`} />
                </button>

                {showSubSettings && (
                  <SubtitlePanel
                    lang={lang}
                    playerSubtitles={playerSubtitles}
                    setPlayerSubtitles={props.setPlayerSubtitles}
                    subColor={subColor}
                    setSubColor={props.setSubColor}
                    subSize={subSize}
                    setSubSize={props.setSubSize}
                    subFont={subFont}
                    setSubFont={props.setSubFont}
                    subShadow={subShadow}
                    setSubShadow={props.setSubShadow}
                    showControlsAndResetTimer={showControlsAndResetTimer}
                    setPlayerToast={props.setPlayerToast}
                    onClose={() => {
                      setShowSubSettings(false);
                      setFocus("player.controls", "subtitles");
                    }}
                  />
                )}
              </div>
            </div>

            {/* Middle: Media control buttons (Episode buttons ONLY for series) */}
            <div className="flex items-center gap-4">
              {playingMovie.type === "series" && (
                <button
                  ref={prevNode.ref as React.RefObject<HTMLButtonElement>}
                  onClick={(e) => { e.stopPropagation(); playPrevMedia(); }}
                  title={lang === "ar" ? "الحلقة السابقة" : "Previous Episode"}
                  className={`p-2.5 bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-850 rounded-xl text-white cursor-pointer transition-all transform active:scale-90 ${prevNode.isFocused ? FOCUS_RING : ""}`}
                >
                  <SkipBack className="w-4.5 h-4.5" />
                </button>
              )}

              <button
                ref={rewindNode.ref as React.RefObject<HTMLButtonElement>}
                onClick={(e) => { e.stopPropagation(); seekBy(-15); }}
                title={lang === "ar" ? "إرجاع 15 ثانية" : "Rewind 15s"}
                className={`p-2.5 bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-850 rounded-xl text-white cursor-pointer transition-all ${rewindNode.isFocused ? FOCUS_RING : ""}`}
              >
                <RotateCcw className="w-4.5 h-4.5" />
              </button>

              <button
                ref={playPauseNode.ref as React.RefObject<HTMLButtonElement>}
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                className={`p-4 bg-white text-black rounded-full hover:scale-110 transition-all cursor-pointer shadow-xl transform active:scale-95 ${playPauseNode.isFocused ? FOCUS_RING : ""}`}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-black text-black" /> : <Play className="w-5 h-5 fill-black text-black ml-0.5" />}
              </button>

              {playingMovie.type === "series" && (
                <button
                  ref={nextNode.ref as React.RefObject<HTMLButtonElement>}
                  onClick={(e) => { e.stopPropagation(); playNextMedia(); }}
                  title={lang === "ar" ? "الحلقة التالية" : "Next Episode"}
                  className={`p-2.5 bg-zinc-900/80 border border-zinc-800 hover:bg-zinc-850 rounded-xl text-white cursor-pointer transition-all transform active:scale-90 ${nextNode.isFocused ? FOCUS_RING : ""}`}
                >
                  <SkipForward className="w-4.5 h-4.5" />
                </button>
              )}
            </div>

            {/* Right: Volume control */}
            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                ref={muteNode.ref as React.RefObject<HTMLButtonElement>}
                onClick={(e) => { e.stopPropagation(); setPlayerMuted(!playerMuted); }}
                className={`p-2.5 bg-zinc-900/80 border border-zinc-800 rounded-xl text-white cursor-pointer hover:bg-zinc-850 transition-all ${muteNode.isFocused ? FOCUS_RING : ""}`}
                title={lang === "ar" ? "كتم الصوت" : "Mute"}
              >
                {playerMuted ? <VolumeX className="w-4.5 h-4.5 text-rose-500" /> : <Volume2 className="w-4.5 h-4.5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
