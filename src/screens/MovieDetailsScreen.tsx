import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Image, ScrollView, StyleSheet, Dimensions, ActivityIndicator, Animated, ToastAndroid } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import { WebView } from "react-native-webview";
import { Play, Bookmark, Users, Check, ChevronDown } from "lucide-react-native";
import type { Movie, Season, Episode, StreamServer, SubtitleTrack } from "../api";
import { posterUrl, youtubeVideoId, youtubeEmbedUrl, fetchCollection, fetchMovieDetail, fetchShowDetail, fetchEpisodePlayback, fetchCinemanaMoviePlayback, fetchCeeMoviePlayback, findCinemanaMatch, findCeeMatch, bestQualityLabel } from "../api";
import { pickBestServers } from "../streamSelect";
import Focusable from "../components/Focusable";
import MovieCard from "../components/MovieCard";
import { colors, font, focusShadow, focusShadowTight, radius, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, pickText, t, genreName, countryName, upcomingLabel } from "../i18n";
import type { SelectedPerson } from "./PersonScreen";
import LogoImage from "../components/LogoImage";
import { useFocusClamp } from "../useFocusClamp";
import { useProgressiveReveal } from "../useProgressiveReveal";
import { pushBackHandler } from "../backStack";

// Lowered from 10000, then 6000, then 4000 - still reported as too slow to start each time.
const TRAILER_DELAY_MS = 1500;
// See playEpisode's own comment - a floor under how quickly the resolving spinner can disappear
// again, so a cached/instant fetch still leaves it on screen long enough to actually be seen.
const MIN_RESOLVE_MS = 450;

interface Props {
  movie: Movie;
  isFavorite: boolean;
  lang: Lang;
  onToggleFavorite: () => void;
  onPlay: (source: { servers: StreamServer[]; movie: Movie; season?: Season; episode?: Episode }) => void;
  onSelectPerson: (person: SelectedPerson) => void;
  onSelectMovie: (movie: Movie) => void;
  onBack: () => void;
  isEpisodeWatched: (movieId: string, seasonNumber: number, episodeNumber: number) => boolean;
}

export default function MovieDetailsScreen({ movie: initialMovie, isFavorite, lang, onToggleFavorite, onPlay, onSelectPerson, onSelectMovie, onBack, isEpisodeWatched }: Props) {
  // Home/Browse/Search only ever hand this screen the new backend's *summary* shape (no
  // titleAr/genres/cast/director yet - only its dedicated detail endpoint has those, see
  // fetchMovieDetail in api.ts). Shadowing the prop with local state of the same name means
  // every other `movie.x` reference below keeps working unchanged once the fuller detail
  // arrives, without threading a second variable through this whole file.
  const [movie, setMovie] = useState<Movie>(initialMovie);
  // Cast/crew and country only ever come from this detail fetch, never the summary the screen
  // opens with - the section below rendered nothing at all until it resolved, reading as cast/
  // crew being "slow to appear" (or missing) rather than "still loading," especially on a slow
  // connection. This drives a real loading placeholder in that gap instead of nothing.
  const [detailLoading, setDetailLoading] = useState(true);
  // Whether the Watch button should render at all for a movie (see its own render-site comment
  // for why series never gates on this) - starts from whatever the summary already knew
  // (instant, no flash for the common case), then gets a real answer once the detail fetch below
  // resolves.
  const [hasPlaybackSource, setHasPlaybackSource] = useState(initialMovie.type === "series" || !!initialMovie.hasPlayableStream);
  useEffect(() => {
    setMovie(initialMovie);
    setDetailLoading(true);
    setHasPlaybackSource(initialMovie.type === "series" || !!initialMovie.hasPlayableStream);
    let cancelled = false;
    const detailPromise = initialMovie.type === "series"
      ? fetchShowDetail(initialMovie.id, initialMovie.playback, initialMovie.playbackSources)
      : fetchMovieDetail(initialMovie.id);
    detailPromise
      .then(async (full) => {
        if (cancelled) return;
        setMovie((prev) => ({ ...prev, ...full }));
        if (full.type === "series") return;
        if (full.hasPlayableStream) {
          setHasPlaybackSource(true);
          return;
        }
        // The catalog itself has no stream on file yet - the same CEE/Cinemana matching
        // playMovie() already does lazily on an actual Play press (see its own comment there),
        // run here instead just to decide whether the Watch button should exist at all. Stays
        // hidden (the state above already started false) rather than flashing on and then off,
        // matching the fix already in place for a series briefly showing this same button.
        const [cinemanaMatch, ceeMatch] = await Promise.all([findCinemanaMatch(full), findCeeMatch(full)]);
        if (cancelled) return;
        setHasPlaybackSource(!!(cinemanaMatch || ceeMatch));
        // Nothing is stored in the catalog any more, so the resolution badge has to come from the
        // matched sources themselves: ask each for its video list and show the best one on offer.
        const results = await Promise.all(
          [cinemanaMatch, ceeMatch].map(async (source) => {
            try {
              if (!source) return null;
              if (source.provider === "cee" && source.ceeId) return await fetchCeeMoviePlayback(source.ceeId, source.kind);
              if (source.cinemanaId) return await fetchCinemanaMoviePlayback(source.cinemanaId, source.kind);
            } catch {
              // One source failing must not hide the other's resolution.
            }
            return null;
          })
        );
        const best = bestQualityLabel(results.flatMap((result) => result?.servers ?? []));
        if (!cancelled && best) setMovie((prev) => ({ ...prev, quality: best }));
      })
      .catch((err) => console.error("[MovieDetailsScreen] fetchDetail failed:", err))
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialMovie]);

  const isSeries = movie.type === "series" && (movie.seasons?.length ?? 0) > 0;
  const [activeSeason, setActiveSeason] = useState<Season | undefined>(movie.seasons?.[0]);
  // The initial `movie` prop is only ever a summary (no seasons yet) - seasons only arrive once
  // fetchShowDetail resolves above, well after this state's own initializer already ran once.
  useEffect(() => {
    if (!activeSeason && movie.seasons?.length) setActiveSeason(movie.seasons[0]);
  }, [movie.seasons, activeSeason]);
  const [resolvingEpisodeId, setResolvingEpisodeId] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);
  // See the trailer WebView's own onMessage below - covers the brief moment its own loop restart
  // (playlist+loop, since there's no "seamless" native loop option) flashes YouTube's own
  // play/seek indicator icons, which happens regardless of controls:0. Cleared again as soon as
  // "playing" confirms the restart actually completed, or after a short ceiling either way so a
  // restart that never confirms doesn't leave this stuck covering the trailer forever.
  const [trailerLoopCover, setTrailerLoopCover] = useState(false);
  // See the trailer WebView's own style comment below - true only once "playing" confirms real
  // video is actually decoding, so the cover image right after the WebView can stay up the whole
  // time before that regardless of what the WebView's own surface is doing underneath.
  const [trailerReady, setTrailerReady] = useState(false);
  const [parts, setParts] = useState<Movie[]>([]);
  const trailerVideoId = youtubeVideoId(movie.trailerUrl);

  // The app previously had no way at all to look up a movie's other parts - it only ever had
  // the single Movie object the viewer tapped into, with nothing pointing at sibling entries
  // sharing the same collectionId. /api/movies/collection is a dedicated server-side lookup
  // for exactly that; this only runs when the movie is actually part of a series at all.
  useEffect(() => {
    setParts([]);
    if (!movie.collectionId) return;
    let cancelled = false;
    fetchCollection(movie.collectionId, movie.id)
      .then((items) => {
        if (!cancelled) setParts(items);
      })
      .catch((err) => console.error("[MovieDetailsScreen] fetchCollection failed:", err));
    return () => {
      cancelled = true;
    };
  }, [movie.collectionId, movie.id]);

  const scrollRef = useRef<any>(null);
  const episodeScrollRef = useRef<any>(null);
  const seasonScrollRef = useRef<any>(null);
  // Only two positions this screen ever sits at now, not one per section - focus on the hero's
  // own buttons means the top of the screen, focus on *anything* below (cast, parts, seasons,
  // episodes) means the bottom, full stop. Moving focus card-to-card *within* the same row
  // re-fires this on every single left/right press, not just the first one entering that row,
  // so this tracks *which of the two* we last scrolled to and only moves when that actually
  // changes - immune to both animation timing and to re-firing for no reason.
  const lastScrollTarget = useRef<"top" | "bottom" | null>(null);
  const scrollToTop = () => {
    if (lastScrollTarget.current === "top") return;
    lastScrollTarget.current = "top";
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  const scrollToBottom = () => {
    // scrollEnabled only ever blocks the *viewer's own* touch/drag scrolling - it does nothing
    // to stop a programmatic .scrollToEnd() call like this one, which kept sliding a plain
    // movie's (no parts, no series) screen down anyway despite scrolling being turned off for
    // exactly that case below. Nothing calls this for such a movie in the first place (there's
    // no cast-focus handler wiring it up when there's nothing past the cast row), but guarding
    // here too means that stays true even if a future section starts calling it.
    if (!isSeries && parts.length === 0) return;
    if (lastScrollTarget.current === "bottom") return;
    lastScrollTarget.current = "bottom";
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  // Pushed onto the shared backStack (see its own top comment) rather than calling
  // BackHandler.addEventListener directly - registered directly on this screen itself, not only
  // via App.tsx's own centralized fallback, since a handler living inside the actual mounted
  // component doesn't depend on App's own state (selectedMovie/playing) staying perfectly in sync
  // with what's really on screen at every instant, a real gap during this screen's own lazy-import
  // Suspense window. `onBack` is a stable reference from App.tsx (useCallback - see its own
  // comment there) so this effect isn't re-pushing on every unrelated App-level re-render either.
  // Both this and App's own fallback coexist safely: the stack's own "top always wins" rule means
  // this one (pushed by a child, after the parent's own effects in the same commit) always sits
  // above App's fallback whenever this screen is actually mounted - deterministic, not dependent
  // on native listener registration order.
  useEffect(() => {
    return pushBackHandler(() => {
      onBack();
      return true;
    }, "MovieDetailsScreen");
  }, [onBack]);

  useEffect(() => {
    setShowTrailer(false);
    if (!trailerVideoId) return;
    const timer = setTimeout(() => setShowTrailer(true), TRAILER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [movie.id, trailerVideoId]);

  // The old version pointed the iframe straight at youtube.com/embed's own autoplay params
  // and just trusted it worked - WebView's onError only ever catches the *outer* local HTML
  // document failing to load, never anything going wrong *inside* the embedded iframe (blocked
  // by the device's network/DNS, no system WebView build capable of running it, YouTube
  // rejecting the autoplay), so a silently-failed embed just sat there as a dead black
  // rectangle over the backdrop with no code path that ever noticed. Using the real YouTube
  // IFrame API lets the page tell us, via postMessage, whether the video actually reached the
  // *playing* state - if that confirmation never arrives within a few seconds of mounting,
  // the embed is treated as failed and this reverts to the plain backdrop image instead of
  // leaving a broken player on screen indefinitely.
  const trailerConfirmedRef = useRef(false);
  useEffect(() => {
    if (!showTrailer) return;
    trailerConfirmedRef.current = false;
    // Raised from 6000 - reported as "the trailer never plays, just a loading mark then it
    // disappears," which this window being too short exactly explains: this screen's own detail/
    // cast/collection fetches are all competing for bandwidth/CPU at the same moment the trailer's
    // WebView is trying to boot up (load the iframe_api script, create the player, start
    // buffering) right after the viewer just navigated here, unlike VideoPlayerScreen's own
    // equivalent timeout (also 15s), which runs with no such competing load. 6s was enough on a
    // fast connection but not reliably otherwise.
    const timer = setTimeout(() => {
      if (!trailerConfirmedRef.current) setShowTrailer(false);
    }, 15000);
    return () => clearTimeout(timer);
  }, [showTrailer]);

  // A season switch used to leave the episode row wherever its scroll position happened to
  // be from the *previous* season - if that was scrolled a few cards in, the new season's
  // first episode (which still needs the same leading-edge buffer as any other row's first
  // item) opened already past it, and the row read as clipped/misaligned against the sidebar
  // again despite the padding fix below actually being in place the whole time.
  useEffect(() => {
    episodeScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [activeSeason?.id]);

  // Watch is shown as soon as hasPlayableStream says so (known from the summary already, see
  // api.ts), which can be before the detail fetch that actually resolves `servers` has
  // finished. Falls back to a fresh fetch in that race instead of silently doing nothing.
  const [resolvingMovie, setResolvingMovie] = useState(false);
  // Which sources to play from, best first. A title the admin pinned to specific entries tries those first: a movie
  // opened from Search arrives with playbackSources already filled by the automatic title matching (see
  // searchMovies), and preferring that over the pin made a manual link silently lose to a wrong/empty automatic
  // match. The other source's automatic match still follows as the fallback - a pin that turns out dead should
  // fall through to the second source rather than end playback.
  const sourcesFor = async (m: Movie) => {
    if (m.sourceLinks?.length) {
      const pinnedProviders = new Set(m.sourceLinks.map((link) => link.source));
      const found = (await Promise.all([findCinemanaMatch(m), findCeeMatch(m)])).filter((source): source is NonNullable<typeof source> => !!source);
      return [...found.filter((source) => pinnedProviders.has(source.provider)), ...found.filter((source) => !pinnedProviders.has(source.provider))];
    }
    return m.playbackSources?.length
      ? m.playbackSources
      : [m.playback, ...(await Promise.all([findCinemanaMatch(m), findCeeMatch(m)]))].filter((source): source is NonNullable<typeof source> => !!source);
  };
  const playMovie = async () => {
    if (resolvingMovie) return;
    if (movie.servers?.length) {
      setResolvingMovie(true);
      try {
        // The catalog's own `servers` can already be populated (admin-entered, or not yet
        // backfilled by the scheduled import job - see api.ts) while `subtitles` stays empty -
        // that combination used to play with no subtitles at all, silently, since this branch
        // never checked CEE/Cinemana once servers were already known. Same source lookup the
        // fully-discovered branch below already does, just for subtitles only this time - real
        // playback still uses the catalog's own servers, untouched.
        let subtitles = movie.subtitles;
        if (!subtitles?.length) {
          const sources = await sourcesFor(movie);
          for (const source of sources) {
            const result = source.provider === "cee" && source.ceeId
              ? await fetchCeeMoviePlayback(source.ceeId, source.kind)
              : source.cinemanaId
                ? await fetchCinemanaMoviePlayback(source.cinemanaId, source.kind)
                : null;
            if (result?.subtitles.length) {
              subtitles = result.subtitles;
              break;
            }
          }
        }
        onPlay({ servers: await pickBestServers(movie.servers), movie: { ...movie, subtitles } });
      } finally {
        setResolvingMovie(false);
      }
      return;
    }
    setResolvingMovie(true);
    try {
      const discovered = await sourcesFor(movie);
      // Every matched source is tried and merged, not just the first one with any servers at
      // all - a source that matched the title can still return servers whose actual files are
      // dead/never transcoded (the match succeeding says nothing about the video itself still
      // working), and stopping here used to mean a genuinely working link on a *second* source
      // never even got fetched. Reported as "this title is really on CEE and plays fine there,
      // but not in the app" - CEE would have been skipped entirely whenever Cinemana happened to
      // match first and return any servers, dead or not. pickBestServers below already probes
      // real reachability across whatever it's given, so handing it every source's servers
      // together (not just the first source's) is what actually lets it pick a working one
      // regardless of which source it came from.
      // Fetched side by side (a slow source no longer delays the other), one group per source in priority order.
      const groups = await Promise.all(
        discovered.map(async (source) => {
          const result = source.provider === "cee" && source.ceeId
            ? await fetchCeeMoviePlayback(source.ceeId, source.kind)
            : source.cinemanaId
              ? await fetchCinemanaMoviePlayback(source.cinemanaId, source.kind)
              : { servers: [], subtitles: [] };
          return { source, ...result };
        })
      );
      const allServers: StreamServer[] = groups.flatMap((group) => group.servers);
      let mergedSubtitles: SubtitleTrack[] = movie.subtitles ?? [];
      const report: string[] = [];
      for (const group of groups) {
        report.push(`${group.source.provider === "cee" ? "CEE" : "Cinemana"}: ${group.servers.length}`);
        if (!mergedSubtitles.length && group.subtitles.length) mergedSubtitles = group.subtitles;
      }
      // Nothing to play used to end silently (the spinner just stopped) - say what was actually found so a
      // failure on a real device can be told apart: no source matched, a source answered empty, or it timed out.
      if (!allServers.length) {
        ToastAndroid.show(
          lang === "ar"
            ? `لا توجد روابط تشغيل - المصادر: ${discovered.length ? report.join(" · ") : "لم يُعثر على تطابق"}`
            : `No playable links - sources: ${discovered.length ? report.join(" · ") : "no match found"}`,
          ToastAndroid.LONG
        );
      }
      if (allServers.length) {
        // A pinned title keeps its sources in priority order - the pinned source's links first, then the other
        // source's, each group ranked on its own - so the player only moves on to the second source once every
        // link of the first has failed (it walks this list in order on each error). Unpinned titles keep the
        // old behavior: everything ranked together by quality.
        const ordered = movie.sourceLinks?.length
          ? (await Promise.all(groups.map((group) => pickBestServers(group.servers)))).flat()
          : await pickBestServers(allServers);
        onPlay({ servers: ordered, movie: { ...movie, subtitles: mergedSubtitles } });
        return;
      }
      const full = await fetchMovieDetail(movie.id);
      if (full.servers?.length) onPlay({ servers: await pickBestServers(full.servers), movie: full });
    } catch (err) {
      console.error("[MovieDetailsScreen] fetchMovieDetail failed on play:", err);
    } finally {
      setResolvingMovie(false);
    }
  };

  // Episode stream links are resolved lazily on tap rather than preloaded for every episode of
  // every season up front (see fetchShowDetail's comment in api.ts) - hasPlayableStream (known
  // up front, cheap) gates whether there's anything to resolve at all.
  //
  // A cached/already-warm fetchEpisodePlayback can resolve within the same tick React would
  // otherwise use to actually paint the resolvingEpisodeId spinner - the press just cut straight
  // to the player with no visible feedback that anything happened in between, reported as
  // episodes "disappearing immediately." Racing the real fetch against a floor delay guarantees
  // the spinner gets at least this long on screen without slowing down a genuinely slow fetch
  // (Promise.all waits for whichever of the two takes longer).
  const playEpisode = async (ep: Episode) => {
    if (!ep.hasPlayableStream || resolvingEpisodeId) return;
    setResolvingEpisodeId(ep.id);
    try {
      const [{ servers, subtitles }] = await Promise.all([
        fetchEpisodePlayback(ep.id, ep.cinemanaId, ep.ceeId),
        new Promise<void>((resolve) => setTimeout(() => resolve(), MIN_RESOLVE_MS)),
      ]);
      if (servers.length) {
        onPlay({
          servers: await pickBestServers(servers),
          movie,
          season: activeSeason,
          episode: { ...ep, servers, subtitles },
        });
      }
    } catch (err) {
      console.error("[MovieDetailsScreen] fetchEpisodePlayback failed:", err);
    } finally {
      setResolvingEpisodeId(null);
    }
  };

  // Stable identities for the memoized episode rail below - playEpisode/scrollToBottom are recreated
  // every render, which would defeat React.memo on every card if passed straight through.
  const playEpisodeRef = useRef(playEpisode);
  playEpisodeRef.current = playEpisode;
  const stablePlayEpisode = useCallback((ep: Episode) => playEpisodeRef.current(ep), []);
  const scrollToBottomRef = useRef(scrollToBottom);
  scrollToBottomRef.current = scrollToBottom;
  const stableScrollToBottom = useCallback(() => scrollToBottomRef.current(), []);

  // Director/writer used to be fetched and stored on every import (directorPhotoUrl/
  // writerPhotoUrl) but never actually rendered anywhere in this app - added to the front of
  // the same row cast members already appear in, with "Director"/"Writer" standing in for the
  // role text a cast member's own character name normally occupies there.
  const crewAndCast: {
    id: string;
    name: string;
    role?: string;
    photoUrl?: string;
    birthday?: string;
    deathday?: string;
    placeOfBirth?: string;
    biography?: string;
    biographyAr?: string;
  }[] = [
    ...(movie.director ? [{ ...movie.director, role: lang === "ar" ? "مخرج" : "Director" }] : []),
    ...(movie.writer ? [{ ...movie.writer, role: lang === "ar" ? "كاتب" : "Writer" }] : []),
    // Shows only - TMDB has no show-level director/writer credit, so both above are always
    // absent for a series; this is the real populated show-level credit (see api.ts's own
    // ShowDetailDto.creator comment).
    ...(movie.creator ? [{ ...movie.creator, role: lang === "ar" ? "مبدع المسلسل" : "Creator" }] : []),
    ...(movie.castMembers ?? []).slice(0, 12),
  ];

  // Reaching the end of any one of these horizontal rows used to fall through to Android's own
  // nearest-neighbor guess, which could land on an item in a *different* row - explicitly
  // self-referencing the first/last item's nextFocusLeft/Right (see useFocusClamp) makes that
  // direction a no-op there instead, so only up/down ever actually leaves a row.
  const castCount = crewAndCast.length;
  const castClamp = useFocusClamp(castCount);
  const partsClamp = useFocusClamp(parts.length);
  const seasonsClamp = useFocusClamp(movie.seasons?.length ?? 0);
  const episodesClamp = useFocusClamp(activeSeason?.episodes.length ?? 0);
  // See useProgressiveReveal's own comment - same "don't fire every row's images in one burst"
  // fix as Home's rails, just applied to this screen's own longer rows (a season can easily run
  // past 20 episodes).
  const visibleCastImages = useProgressiveReveal(castCount);
  const visiblePartsImages = useProgressiveReveal(parts.length);
  const visibleEpisodeImages = useProgressiveReveal(activeSeason?.episodes.length ?? 0);

  // Nothing below the cast row to scroll to at all for a plain movie with no parts - locking
  // scrolling off entirely here (rather than just leaving it technically scrollable over a
  // screen's worth of empty space) is what makes the screen actually read as a single fixed
  // page instead of one that merely happens not to need scrolling yet.
  const canScroll = isSeries || parts.length > 0;

  // Blinking down-arrow hinting that seasons/episodes (or other parts, for a movie) sit just
  // below the fold - only ever shown when there's actually something down there to point at
  // (same condition as canScroll itself).
  const scrollHintAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!canScroll) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scrollHintAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(scrollHintAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [canScroll, scrollHintAnim]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.root}
      contentContainerStyle={[styles.content, isSeries && styles.seriesContent]}
      scrollEnabled={canScroll}
    >
      <View style={styles.hero}>
        {/* Same fix as HomeScreen's own hero backdrop (see its comment): a plain absoluteFill
            Image with the default "cover" resizeMode centers its crop, which - for a backdrop
            shorter (in its own 16:9) than `hero`'s own box - crops evenly off both the top and
            bottom. That reads as "cropped from the top" because that's the half that actually
            loses key art/faces; the bottom half is normally just gradient/empty space anyway.
            Sizing the image to its real 16:9 aspect ratio and pinning it to top:0 means any
            excess height only ever comes off the bottom (clipped by `hero`'s own overflow:hidden
            below) instead of the top edge ever moving. */}
        <Image
          source={{ uri: posterUrl(movie.backdrop || movie.poster, "w1280") }}
          style={styles.heroBackdrop}
          resizeMode="cover"
          fadeDuration={0}
        />
        {showTrailer && trailerVideoId && (
          // trailerUrl is always a YouTube watch link (never a direct video file - see
          // server.ts's own field description), so react-native-video can never play it;
          // this is a real player, just reached through YouTube's embeddable iframe instead.
          //
          // Loads a real page hosted on this backend's own domain (youtube-embed - see
          // youtubeEmbedUrl's own comment in api.ts) rather than a WebView-local HTML string with
          // a faked `baseUrl` - that older trick (meant to work around YouTube error 153, "this
          // origin is blocked") turned out to be the real cause of this trailer silently failing
          // to ever play on every device: the origin it faked never actually satisfied the real
          // IFrame Player API's own validation, and this effect's own 6s no-confirmation fallback
          // (see trailerConfirmedRef above) just quietly reverted to the plain backdrop image
          // instead of ever surfacing that as a visible error. A genuine https:// navigation gives
          // it a real, consistent origin to check instead.
          <>
            <WebView
              // mute:true is still required for autoplay to actually start at all (YouTube's own
              // autoplay policy - see VideoPlayer.tsx's identical fix for the full write-up);
              // unmuteOnPlay is what turns real sound on the instant it actually starts playing -
              // per explicit request, this preview is no longer silent.
              source={{ uri: youtubeEmbedUrl(trailerVideoId, { autoplay: true, mute: true, loop: true, unmuteOnPlay: true }) }}
              // Explicit background color - the native Android WebView otherwise paints its own
              // default white surface for the brief gap before this page's own content (background
              // :#000 in its own CSS included) actually arrives and paints over it. A prior attempt
              // to fix "black screen before playback" by making this transparent instead (so the
              // backdrop image behind it would show through) reintroduced exactly that white flash,
              // *and* still went black again right as the video element itself first initializes
              // (any video surface, on any platform, paints black before its first real frame
              // decodes - nothing to do with this WebView's own background either way) - reported
              // as "white screen at the start, then black once the play marks appear." The
              // trailerReady cover image below is what actually solves the original ask now: it
              // stays opaque over this whole WebView (whatever it's doing underneath) until
              // "playing" confirms real video is actually decoding, so neither flash is ever seen.
              // Same 16:9 top-pinned box as the still image (styles.heroBackdrop) - filling the whole hero
              // instead made the picture visibly change size the moment the trailer started.
              style={[styles.heroBackdrop, { backgroundColor: "#000" }]}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              // See the identical prop (and its own comment) on VideoPlayer.tsx's own YouTube
              // WebView - a documented Android WebView video-playback fix, not specific to the
              // trailer, applied here too since it goes through the exact same underlying issue.
              androidLayerType="hardware"
              scrollEnabled={false}
              onError={() => setShowTrailer(false)}
              onHttpError={() => setShowTrailer(false)}
              onMessage={(e) => {
                const msg = e.nativeEvent.data;
                if (msg === "playing") {
                  trailerConfirmedRef.current = true;
                  setTrailerLoopCover(false);
                  setTrailerReady(true);
                  return;
                }
                if (msg?.startsWith("error:")) {
                  setShowTrailer(false);
                  return;
                }
                // 0 is YT.PlayerState.ENDED - momentary here (loop+playlist restarts it
                // immediately), but YouTube still flashes its own play/seek indicator icons for
                // that instant regardless of controls:0, with no playerVar to suppress it - per
                // explicit request ("hide the play/forward/rewind marks that show"), covering the
                // trailer for a brief moment here hides that flash instead. Cleared by the
                // "playing" branch above once the restart actually confirms, or this same short
                // ceiling either way so a restart that never confirms doesn't leave it stuck.
                if (msg === "diag:state:0") {
                  setTrailerLoopCover(true);
                  setTimeout(() => setTrailerLoopCover(false), 1200);
                }
              }}
            />
            {/* Covers the WebView entirely (same backdrop image already showing behind it, so
                hiding this reads as a seamless reveal, not a swap) until "playing" confirms real
                video is actually decoding - see the WebView's own style comment above for why this,
                not a transparent background, is what actually fixes both the white-then-black
                flash. */}
            {!trailerReady && (
              <Image
                source={{ uri: posterUrl(movie.backdrop || movie.poster, "w1280") }}
                style={styles.heroBackdrop}
                resizeMode="cover"
                fadeDuration={0}
              />
            )}
            {trailerLoopCover && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="none" />
            )}
            {/* Same top-dark-fade VideoPlayer.tsx's own YouTube branch uses over its header - this
                trailer has no header content of its own to show over it (the movie's title/logo/
                facts row already sit further down, outside this WebView entirely - see below), so
                this exists purely to hide whatever YouTube itself might draw near the top edge
                (its own video title/channel overlay) the same way that one does. */}
            <LinearGradient
              colors={["#000", "transparent"]}
              locations={[0, 0.35]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </>
        )}
        <LinearGradient
          colors={["rgba(0,0,0,0.15)", "rgba(0,0,0,0.55)", colors.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />

        <Image source={{ uri: posterUrl(movie.poster || movie.backdrop, "w780") }} style={styles.poster} fadeDuration={0} />

        <View style={styles.infoCol}>
          {movie.logoUrl || movie.titleLogo ? (
            <LogoImage uri={posterUrl(movie.logoUrl || movie.titleLogo, "w780")} height={s(95)} maxWidth={s(460)} style={styles.titleLogo} />
          ) : (
            <Text style={styles.title}>{pickText(movie.titleAr, movie.titleEn, lang)}</Text>
          )}

          <View style={styles.metaRow}>
            {!!movie.ageRating && (
              <View style={styles.ageBadge}>
                <Text style={styles.ageBadgeText}>{movie.ageRating}</Text>
              </View>
            )}
            {!!movie.quality && (
              <View style={styles.qualityBadge}>
                <Text style={styles.qualityBadgeText}>{movie.quality}</Text>
              </View>
            )}
            {/* Same round accent badge as MovieCard's own partBadge (a franchise entry's card
                elsewhere in the app), just shown here too since this hero has no poster-corner
                overlay of its own to put it on. */}
            {!!movie.partNumber && (
              <View style={styles.partBadgeHero}>
                <Text style={styles.partBadgeHeroText}>{movie.partNumber}</Text>
              </View>
            )}
            <Text style={styles.meta}>{movie.type === "series" ? t("series", lang) : t("movies", lang)}</Text>
            {!!movie.genres?.length && <Text style={styles.meta}>{movie.genres.map((g) => genreName(g, lang)).join(" • ")}</Text>}
            {!!movie.country && <Text style={styles.meta}>{countryName(movie.country, lang)}</Text>}
          </View>

          <Text numberOfLines={2} style={styles.story}>{pickText(movie.storyAr, movie.storyEn, lang)}</Text>

          <View style={styles.factsRow}>
            {!!movie.duration && <Text style={styles.factMeta}>{movie.duration}</Text>}
            <View style={styles.imdbBadge}>
              <Text style={styles.imdbBadgeText}>IMDb</Text>
            </View>
            <Text style={styles.factRating}>{movie.rating}</Text>
            <Text style={styles.factMeta}>{movie.year}</Text>
          </View>

          <View style={styles.buttonsRow}>
            {/* Watch always gets initial focus whenever it's rendered at all. Gated on
                movie.type directly, not the shared `isSeries` (which also requires seasons to
                have already loaded) - using `isSeries` here let a real series briefly render this
                movie-style Watch button on first open, before its own fetchShowDetail had
                resolved seasons, then yank it away the instant seasons arrived - reported as "a
                Play button shows then disappears" on the details screen. movie.type is already
                known from the very first render, series or not, so this button now never
                flashes on for a series in the first place. */}
            {/* Gated on hasPlaybackSource (see its own state comment above), not just movie.type -
                per explicit follow-up request, a movie with no stream from any source (catalog,
                Cinemana, or Cee) no longer shows a Watch button that would just fail when pressed.
                The catalog-only signal (hasPlayableStream) is trusted immediately when it's true;
                only when it's false does this wait on the same Cinemana/Cee lookup playMovie()
                already does lazily on a Play press, run once here up front instead purely to
                decide this button's visibility. */}
            {movie.type !== "series" && hasPlaybackSource && (
              <DetailButton
                // Picking the best server (see playMovie/pickBestServers) now genuinely takes a
                // moment even for an already-loaded movie (a probe request per server, up to ~4s
                // each) - this used to open the player instantly, so silently doing the same
                // thing here would read as the button not responding at all for however long the
                // probes take.
                label={resolvingMovie ? (lang === "ar" ? "جارٍ التحضير..." : "Preparing...") : t("watchNow", lang)}
                Icon={Play}
                iconFill
                filled
                hasTVPreferredFocus
                onPress={playMovie}
                onFocusChange={(f) => f && scrollToTop()}
              />
            )}
            <DetailButton
              label={isFavorite ? t("removeFromFavorites", lang) : t("addToFavorites", lang)}
              Icon={Bookmark}
              iconFill={isFavorite}
              active={isFavorite}
              onPress={onToggleFavorite}
              // Whenever Watch itself doesn't render (a series, or now also a movie with no
              // playback source anywhere - see hasPlaybackSource above), this is the only button
              // in the row, so it has to be the one that picks up initial TV focus instead -
              // otherwise nothing here is focused at all on first open.
              hasTVPreferredFocus={movie.type === "series" || !hasPlaybackSource}
              onFocusChange={(f) => f && scrollToTop()}
            />
          </View>
        </View>

        {/* Centered across the whole hero, not tucked beside a button - reads as a page-level
            "there's more below" cue rather than something tied to Favorite specifically. */}
        {canScroll && (
          <Animated.View
            style={[
              styles.scrollHint,
              {
                opacity: scrollHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                transform: [{ translateY: scrollHintAnim.interpolate({ inputRange: [0, 1], outputRange: [0, s(6)] }) }],
              },
            ]}
            pointerEvents="none"
          >
            <Text style={styles.scrollHintText}>{lang === "ar" ? "مرر للأسفل" : "Scroll down"}</Text>
            <ChevronDown size={s(20)} color="#fff" />
          </Animated.View>
        )}
      </View>

      <View style={styles.body}>
        {detailLoading && !crewAndCast.length ? (
          <>
            <View style={styles.divider} />
            <View style={styles.castSection}>
              <View style={styles.sectionLabelRow}>
                <Users size={s(16)} color={colors.textMuted} />
                <Text style={styles.sectionLabel}>{lang === "ar" ? "طاقم وصناع العمل" : "Cast & Crew"}</Text>
              </View>
              <View style={[styles.castRow, styles.castSkeletonRow]} pointerEvents="none">
                {[0, 1, 2, 3, 4].map((i) => (
                  <View key={i} style={styles.castSkeletonItem}>
                    <View style={styles.castSkeletonAvatar} />
                    <View style={styles.castSkeletonLine} />
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}
        {!!crewAndCast.length && (
          <>
            <View style={styles.divider} />
            <View style={styles.castSection}>
              <View style={styles.sectionLabelRow}>
                <Users size={s(16)} color={colors.textMuted} />
                <Text style={styles.sectionLabel}>{lang === "ar" ? "طاقم وصناع العمل" : "Cast & Crew"}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
                {crewAndCast.map((c, i) => (
                  <Focusable
                    key={`${c.name}-${i}`}
                    ref={castClamp.setRef(i)}
                    nextFocusLeft={i === 0 ? castClamp.clampLeft() : undefined}
                    nextFocusRight={i === castCount - 1 ? castClamp.clampRight() : undefined}
                    scaleTo={1.06}
                    onPress={() =>
                      onSelectPerson({
                        id: c.id,
                        name: c.name,
                        role: c.role,
                        photoUrl: c.photoUrl,
                        birthday: c.birthday,
                        deathday: c.deathday,
                        placeOfBirth: c.placeOfBirth,
                        biography: c.biography,
                        biographyAr: c.biographyAr,
                      })
                    }
                    onFocusChange={(f) => f && scrollToBottom()}
                  >
                    {(focused: boolean) => (
                      <View style={styles.castItem}>
                        <View style={[styles.castAvatar, focused && styles.castAvatarFocused, focused && focusShadowTight]}>
                          {c.photoUrl && i < visibleCastImages ? (
                            <Image source={{ uri: posterUrl(c.photoUrl, "w185") }} style={styles.castAvatarImg} fadeDuration={0} />
                          ) : (
                            <View style={styles.castAvatarPlaceholder}>
                              <Text style={styles.castAvatarInitial}>{c.name?.[0] ?? "?"}</Text>
                            </View>
                          )}
                        </View>
                        <Text numberOfLines={1} style={styles.castName}>{c.name}</Text>
                        {!!c.role && <Text numberOfLines={1} style={styles.castRole}>{c.role}</Text>}
                      </View>
                    )}
                  </Focusable>
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {/* Below cast, not above it - per explicit request. */}
        {parts.length > 0 && (
          <>
            <View style={styles.fullWidthDivider} />
            <View style={styles.partsSection}>
              <View style={styles.sectionLabelRow}>
                <Text style={styles.sectionLabel}>{lang === "ar" ? "أجزاء أخرى من هذا العمل" : "Other Parts"}</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
                {parts.map((p, i) => (
                  <MovieCard
                    key={p.id}
                    ref={partsClamp.setRef(i)}
                    nextFocusLeft={i === 0 ? partsClamp.clampLeft() : undefined}
                    nextFocusRight={i === parts.length - 1 ? partsClamp.clampRight() : undefined}
                    movie={p}
                    lang={lang}
                    showImage={i < visiblePartsImages}
                    onSelect={onSelectMovie}
                    onFocusChange={(f) => f && scrollToBottom()}
                  />
                ))}
              </ScrollView>
            </View>
          </>
        )}

        {isSeries && (
          <View style={styles.seasons}>
            <ScrollView ref={seasonScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonRow}>
              {movie.seasons!.map((item, i) => (
                <Focusable
                  key={item.id}
                  ref={seasonsClamp.setRef(i)}
                  nextFocusLeft={i === 0 ? seasonsClamp.clampLeft() : undefined}
                  nextFocusRight={i === movie.seasons!.length - 1 ? seasonsClamp.clampRight() : undefined}
                  onPress={() => setActiveSeason(item)}
                  scaleTo={1.04}
                  onFocusChange={(f) => {
                    if (!f) return;
                    scrollToBottom();
                    // See the episode row's own identical fix just below for why this can't rely
                    // on Android's own auto-scroll alone for the boundary chips.
                    if (i === 0) seasonScrollRef.current?.scrollTo({ x: 0, animated: true });
                    else if (i === movie.seasons!.length - 1) seasonScrollRef.current?.scrollToEnd({ animated: true });
                  }}
                >
                  {(focused: boolean) => (
                    <View
                      style={[
                        styles.seasonChip,
                        activeSeason?.id === item.id && styles.seasonChipActive,
                        focused && styles.seasonChipFocused,
                        focused && focusShadowTight,
                      ]}
                    >
                      <Text style={[styles.seasonChipText, activeSeason?.id === item.id && styles.seasonChipTextActive]}>
                        {pickText(item.titleAr, item.titleEn, lang) || `${lang === "ar" ? "الموسم" : "Season"} ${item.number}`}
                        {/* A season this new has been imported (see AIR_DATE_IMPORT_HORIZON_DAYS
                            in bootstrap-importer.mjs) purely as a "coming soon" placeholder -
                            episodes only get added once they individually cross that same
                            window. A bare season chip with nothing under it read as broken
                            rather than "not out yet", so its own air date rides along right on
                            the chip whenever it has no episodes at all. */}
                        {item.episodes.length === 0 && !!upcomingLabel(item.airDate, lang, "season") &&
                          ` - ${upcomingLabel(item.airDate, lang, "season")}`}
                      </Text>
                    </View>
                  )}
                </Focusable>
              ))}
            </ScrollView>

            {activeSeason && activeSeason.episodes.length === 0 ? (
              <View style={styles.emptySeasonBox}>
                <Text style={styles.emptySeasonText}>
                  {upcomingLabel(activeSeason.airDate, lang, "season") ?? (lang === "ar" ? "لا توجد حلقات بعد" : "No episodes yet")}
                </Text>
              </View>
            ) : (
              activeSeason && (
                // A separate memoized component: focus moving between episodes updates only this
                // rail's own state (the shared title/story block) - it used to be state on this whole
                // screen, so every single D-pad step re-rendered the hero, the cast row and every
                // episode card of a long series.
                <EpisodeRail
                  season={activeSeason}
                  movieId={movie.id}
                  backdrop={movie.backdrop}
                  lang={lang}
                  resolvingEpisodeId={resolvingEpisodeId}
                  clamp={episodesClamp}
                  scrollRef={episodeScrollRef}
                  visibleImages={visibleEpisodeImages}
                  onPlayEpisode={stablePlayEpisode}
                  onFocusScroll={stableScrollToBottom}
                  isEpisodeWatched={isEpisodeWatched}
                />
              )
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// One season's episode cards plus the single shared title/story block under them. Owns its own
// "which episode has focus" state so a focus change re-renders only this rail, and each card is
// memoized so the ones whose props didn't change are skipped outright.
const EPISODE_BATCH = 24;
const EPISODE_LOOKAHEAD = 10;

const EpisodeRail = React.memo(function EpisodeRail({
  season,
  movieId,
  backdrop,
  lang,
  resolvingEpisodeId,
  clamp,
  scrollRef,
  visibleImages,
  onPlayEpisode,
  onFocusScroll,
  isEpisodeWatched,
}: {
  season: Season;
  movieId: string;
  backdrop?: string;
  lang: Lang;
  resolvingEpisodeId: string | null;
  clamp: ReturnType<typeof useFocusClamp>;
  scrollRef: React.RefObject<any>;
  visibleImages: number;
  onPlayEpisode: (ep: Episode) => void;
  onFocusScroll: () => void;
  isEpisodeWatched: (movieId: string, seasonNumber: number, episodeNumber: number) => boolean;
}) {
  const [focusedEpisodeId, setFocusedEpisodeId] = useState<string | null>(season.episodes[0]?.id ?? null);
  useEffect(() => {
    setFocusedEpisodeId(season.episodes[0]?.id ?? null);
  }, [season.id, season.episodes]);
  const count = season.episodes.length;
  const countRef = useRef(count);
  countRef.current = count;
  // A season can have hundreds of episodes (long Turkish series) - mounting every card at once is what
  // made switching seasons slow. Only the first batch mounts; more are added as focus nears the end of
  // what is mounted (well ahead of it, so the next card always already exists for the focus search).
  const [renderCount, setRenderCount] = useState(Math.min(count, EPISODE_BATCH));
  const renderCountRef = useRef(renderCount);
  renderCountRef.current = renderCount;
  useEffect(() => {
    setRenderCount(Math.min(season.episodes.length, EPISODE_BATCH));
  }, [season.id, season.episodes.length]);

  const handleFocus = useCallback(
    (ep: Episode, index: number) => {
      onFocusScroll();
      setFocusedEpisodeId(ep.id);
      if (index >= renderCountRef.current - EPISODE_LOOKAHEAD) {
        setRenderCount((c) => Math.min(countRef.current, c + EPISODE_BATCH));
      }
      // Reaching the first/last card via left/right relies on Android's own "bring the focused view
      // into the viewport" auto-scroll, which only guarantees the card itself is visible, not the
      // padding this row reserves around it - an explicit scrollTo/scrollToEnd overrides that with a
      // target that includes the full padding.
      if (index === 0) scrollRef.current?.scrollTo({ x: 0, animated: true });
      else if (index === countRef.current - 1) scrollRef.current?.scrollToEnd({ animated: true });
    },
    [onFocusScroll, scrollRef]
  );

  const shownEpisode = season.episodes.find((e) => e.id === focusedEpisodeId) ?? season.episodes[0];
  const seasonYear = season.airDate ? new Date(season.airDate).getUTCFullYear() : null;

  return (
    <>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.episodeList}>
        {season.episodes.slice(0, renderCount).map((ep, i) => (
          <EpisodeCard
            key={ep.id}
            ep={ep}
            index={i}
            lang={lang}
            watched={isEpisodeWatched(movieId, season.number, ep.number)}
            showImage={i < visibleImages}
            resolving={resolvingEpisodeId === ep.id}
            backdrop={backdrop}
            setRef={clamp.setRef(i)}
            nextFocusLeft={i === 0 ? clamp.clampLeft() : undefined}
            nextFocusRight={i === count - 1 ? clamp.clampRight() : undefined}
            onPlay={onPlayEpisode}
            onFocusEpisode={handleFocus}
          />
        ))}
      </ScrollView>
      {!!shownEpisode && (
        <View style={styles.episodeInfoBlock}>
          {!!seasonYear && <Text style={styles.episodeInfoYear}>{seasonYear}</Text>}
          <Text numberOfLines={1} style={styles.episodeInfoTitle}>
            {pickText(shownEpisode.titleAr, shownEpisode.titleEn, lang)}
          </Text>
          {!!(shownEpisode.storyAr || shownEpisode.storyEn) && (
            <Text numberOfLines={3} style={styles.episodeInfoStory}>
              {pickText(shownEpisode.storyAr, shownEpisode.storyEn, lang)}
            </Text>
          )}
        </View>
      )}
    </>
  );
});

const EpisodeCard = React.memo(function EpisodeCard({
  ep,
  index,
  lang,
  watched,
  showImage,
  resolving,
  backdrop,
  setRef,
  nextFocusLeft,
  nextFocusRight,
  onPlay,
  onFocusEpisode,
}: {
  ep: Episode;
  index: number;
  lang: Lang;
  watched: boolean;
  showImage: boolean;
  resolving: boolean;
  backdrop?: string;
  setRef: (node: View | null) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  onPlay: (ep: Episode) => void;
  onFocusEpisode: (ep: Episode, index: number) => void;
}) {
  const handlePress = useCallback(() => onPlay(ep), [onPlay, ep]);
  const handleFocusChange = useCallback(
    (f: boolean) => {
      if (f) onFocusEpisode(ep, index);
    },
    [onFocusEpisode, ep, index]
  );
  return (
    <Focusable
      ref={setRef}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      onPress={handlePress}
      scaleTo={1.03}
      onFocusChange={handleFocusChange}
    >
      {(focused: boolean) => (
        <View style={[styles.episodeCard, focused && styles.episodeCardFocused, focused && focusShadowTight]}>
          <View style={styles.episodeThumbBox}>
            {showImage && (
              // Not every episode has its own thumbnail from the source - the show's own landscape
              // backdrop reads far better than the plain black box posterUrl(undefined) would give.
              <Image source={{ uri: posterUrl(ep.thumbnail || backdrop, "w342") }} style={styles.episodeThumb} fadeDuration={0} />
            )}
            <View style={styles.episodeNumberBadge}>
              <Text style={styles.episodeNumberText}>E{ep.number}</Text>
            </View>
            {watched && (
              <View style={styles.episodeWatchedBadge}>
                <Check size={s(13)} color="#000" strokeWidth={3.5} />
              </View>
            )}
            {!!ep.duration && (
              <View style={styles.episodeDurationBadge}>
                <Text style={styles.episodeDurationText}>{ep.duration}</Text>
              </View>
            )}
            {!ep.hasPlayableStream && (
              <View style={styles.episodeComingSoonBadge}>
                <Text style={styles.episodeComingSoonText}>
                  {upcomingLabel(ep.airDate, lang) ?? (lang === "ar" ? "قريبًا" : "Coming Soon")}
                </Text>
              </View>
            )}
            {/* Shown on focus, but also - regardless of focus - while this exact episode is mid-resolve. */}
            {(focused || resolving) && ep.hasPlayableStream && (
              <View style={styles.episodePlayOverlay}>
                {resolving ? <ActivityIndicator color="#fff" /> : <Play size={s(26)} color="#fff" fill="#fff" />}
              </View>
            )}
          </View>
        </View>
      )}
    </Focusable>
  );
});

function DetailButton({
  label,
  Icon,
  onPress,
  filled,
  active,
  iconFill,
  hasTVPreferredFocus,
  onFocusChange,
}: {
  label: string;
  Icon: typeof Play;
  onPress: () => void;
  filled?: boolean;
  active?: boolean;
  iconFill?: boolean;
  hasTVPreferredFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
}) {
  return (
    <Focusable
      onPress={onPress}
      onFocusChange={onFocusChange}
      hasTVPreferredFocus={hasTVPreferredFocus}
      scaleTo={1.05}
    >
      {(focused: boolean) => (
        <View
          style={[
            styles.detailBtn,
            filled ? styles.detailBtnFilled : styles.detailBtnOutline,
            focused && (filled ? styles.detailBtnFocusedFilled : styles.detailBtnFocusedOutline),
            focused && focusShadow,
          ]}
        >
          <Icon
            size={s(16)}
            color={filled ? "#000" : active ? colors.accentRed : "#fff"}
            fill={iconFill ? (filled ? "#000" : colors.accentRed) : "none"}
          />
          <Text style={[styles.detailBtnText, filled && styles.detailBtnTextFilled]}>{label}</Text>
        </View>
      )}
    </Focusable>
  );
}

// Bigger than before per repeated request - still a 2:3 poster ratio.
const POSTER_W = s(260);
const POSTER_H = s(390);

const SCREEN_W = Dimensions.get("window").width;
const SCREEN_H = Dimensions.get("window").height;
// Approximate height of the divider + section label + cast row *plus* the content area's own
// bottom padding - together, this needs to equal the actual rendered height of everything
// below the hero, since HERO_HEIGHT is defined as "whatever's left after that". Undercounting
// it (as a previous pass did, only accounting for the cast row and not the padding stacked on
// top of it) left the total content a little taller than the screen, which was still forcing a
// small, technically-unnecessary scroll for a plain movie with nothing else below the cast.
const CAST_BLOCK_ESTIMATE = s(210);
// Floor raised to comfortably fit the bigger poster above - it (and the info column beside it)
// sit flush with the hero's own bottom edge now (see `poster`/`infoCol` below), so the hero
// itself needs to be at least tall enough for that poster regardless of how short the actual
// screen turns out to be.
const HERO_HEIGHT = Math.max(POSTER_H + s(40), SCREEN_H - CAST_BLOCK_ESTIMATE);
// Ends at the screen's actual horizontal midpoint, not a fixed width - the section starts at
// spacing.contentStart from the left (the body's own paddingLeft), so capping its width at
// half the screen minus that offset is what makes it stop exactly at mid-screen on any
// device instead of a fixed 480px that only happened to look that way on one resolution.
const CAST_MAX_WIDTH = SCREEN_W / 2 - spacing.contentStart;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // A real (not flush-to-the-edge) gap below the cast row for a plain movie - factored into
  // CAST_BLOCK_ESTIMATE above so the hero still shrinks to leave exactly this much room, not
  // more (which would force a needless scroll) or less (which would crowd the bottom edge).
  content: { paddingBottom: s(40) },
  // Raised again - the episode row was still reading as flush against the bottom edge at 110.
  seriesContent: { paddingBottom: s(150) },
  hero: { height: HERO_HEIGHT, position: "relative", overflow: "hidden" },
  heroBackdrop: { position: "absolute", top: 0, left: 0, right: 0, width: "100%", aspectRatio: 16 / 9 },
  // Poster on the end side, text starting right after the sidebar - matches the app's own
  // left-to-right content flow (sidebar, then content) instead of mirroring the RTL web
  // layout, which put them on the opposite sides. Back is handled by the remote's own back
  // button (see the BackHandler above) - no on-screen back button needed.
  // bottom: 0 pushed the Watch/Favorite buttons (the last thing in infoCol) flush against the
  // divider that starts the cast section right below it, with no breathing room between them
  // at all - a small inset again, just much smaller than the original one, keeps the poster
  // and buttons close to that same level without touching it.
  poster: {
    position: "absolute",
    bottom: s(14),
    right: s(48),
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: s(12),
    backgroundColor: colors.cardBg,
    ...cardShadow(),
  },
  infoCol: {
    position: "absolute",
    bottom: s(14),
    left: spacing.contentStart,
    right: POSTER_W + s(28) + s(48),
    gap: s(8),
  },
  titleLogo: { marginBottom: s(2) },
  title: { color: "#fff", fontSize: fs(28), fontFamily: font.black },
  metaRow: { flexDirection: "row", gap: s(12), flexWrap: "wrap", alignItems: "center" },
  ageBadge: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)", borderRadius: 4, paddingHorizontal: s(6), paddingVertical: s(1) },
  ageBadgeText: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
  // Same box as ageBadge, with a solid white frame - the work's best available resolution, right after the age rating.
  qualityBadge: { borderWidth: 1.5, borderColor: "#fff", borderRadius: 4, paddingHorizontal: s(6), paddingVertical: s(1) },
  qualityBadgeText: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
  // Matches ageBadge's own bordered-pill look (right above) rather than the poster-corner
  // partBadge's flush-tag treatment - this one sits inline among other plain-bordered meta
  // badges in running text, not overlaid on an image corner, so it reads as one deliberate family
  // of badges instead of a mismatched solid-circle sticker dropped into a text row.
  partBadgeHero: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    borderRadius: s(6),
    paddingHorizontal: s(8),
    paddingVertical: s(2),
  },
  partBadgeHeroText: { color: "#fff", fontSize: fs(12), fontFamily: font.black },
  meta: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold },
  story: { color: colors.textSecondary, fontSize: fs(14), lineHeight: fs(21), maxWidth: s(760), fontFamily: font.semiBold },
  factsRow: { flexDirection: "row", gap: s(12), flexWrap: "wrap", alignItems: "center" },
  factMeta: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.bold },
  imdbBadge: { backgroundColor: colors.imdbYellow, borderRadius: 3, paddingHorizontal: s(5), paddingVertical: s(1) },
  imdbBadgeText: { color: "#000", fontSize: fs(9), fontFamily: font.black },
  factRating: { color: "#fff", fontSize: fs(13), fontFamily: font.black },
  buttonsRow: { flexDirection: "row", alignItems: "center", gap: s(12), marginTop: s(12) },
  detailBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    paddingHorizontal: s(26),
    paddingVertical: s(14),
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: "transparent",
  },
  detailBtnFilled: { backgroundColor: "#fff" },
  detailBtnOutline: { backgroundColor: "rgba(24,24,27,0.6)", borderColor: "rgba(255,255,255,0.2)" },
  detailBtnFocusedFilled: { borderColor: "rgba(255,255,255,0.5)" },
  detailBtnFocusedOutline: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.12)" },
  detailBtnText: { color: "#fff", fontSize: fs(13), fontFamily: font.extraBold },
  detailBtnTextFilled: { color: "#000" },
  scrollHint: { position: "absolute", bottom: s(14), left: 0, right: 0, alignItems: "center", gap: s(3) },
  scrollHintText: { color: "#fff", fontSize: fs(11), fontFamily: font.bold },
  body: { paddingHorizontal: s(32), paddingLeft: spacing.contentStart },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginBottom: s(14), maxWidth: CAST_MAX_WIDTH },
  sectionLabelRow: { flexDirection: "row", alignItems: "center", gap: s(8), marginBottom: s(12) },
  sectionLabel: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold },
  // Capped at the screen's actual midpoint (not the earlier full-bleed-to-the-edge horizontal
  // scroller) and pulled up closer to the divider - a smaller, tighter block instead of a
  // section that dominated the whole lower half of the screen.
  castSection: { marginBottom: s(8), maxWidth: CAST_MAX_WIDTH },
  // Other Parts specifically - same block, just without the half-screen cap above, per explicit
  // request: a franchise's other entries read as clipped/cut off at the screen's midpoint
  // otherwise, unlike Cast & Crew where that cap is intentional (a tighter block reads better
  // for a row of small round avatars than one stretched across the full width).
  partsSection: { marginBottom: s(8) },
  fullWidthDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.15)", marginBottom: s(14) },
  // paddingLeft here (not just paddingRight) - without it the first cast/season/episode item
  // in these horizontal scrollers sits flush against x=0 with no buffer of its own, so its
  // focus-scale grows into nothing and clips exactly on that leading edge. paddingVertical is
  // the other half of the same problem on this row specifically: a horizontal ScrollView's own
  // box is only ever as tall as its *unscaled* content, so with no vertical buffer at all a
  // focused avatar's scale-up had nowhere to grow but into the ScrollView's own clipped edge -
  // that's what was still cropping the top of the photo specifically while it had focus.
  // paddingLeft/Right widened (was 16/24, then 28/32 - still reported as clipped at both ends) -
  // per explicit request: a focused card's own border/scale-up right at either edge of these
  // horizontal rows had nowhere to grow into, reading as the selection highlight getting clipped
  // right at the screen's edge.
  castRow: { gap: s(14), paddingLeft: s(36), paddingRight: s(40), paddingVertical: s(10) },
  castItem: { alignItems: "center", width: s(64) },
  seasonRow: { paddingLeft: s(36), paddingRight: s(40), paddingVertical: s(6) },
  castAvatar: {
    // A plain circle center-crops a portrait TMDB headshot, which on many photos chops the
    // top of the head off since the face sits above center in the source frame. A portrait-
    // ratio rounded rect keeps the vertical extent a circle would have discarded.
    width: s(60),
    height: s(80),
    borderRadius: s(12),
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: colors.cardBg,
  },
  castAvatarFocused: { borderColor: "#fff" },
  castAvatarImg: { width: "100%", height: "100%" },
  castAvatarPlaceholder: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#27272a" },
  castAvatarInitial: { color: "#fff", fontSize: fs(18), fontFamily: font.black },
  castName: { color: "#fff", fontSize: fs(10.5), fontFamily: font.bold, marginTop: s(6), textAlign: "center" },
  // Same footprint as a real cast card (castAvatar/castName above) so the section doesn't
  // visibly resize once the real data replaces this.
  // castRow itself has no flexDirection - the real cast list gets its row layout for free from
  // ScrollView's own `horizontal` prop, which this plain View placeholder doesn't have.
  castSkeletonRow: { flexDirection: "row" },
  castSkeletonItem: { width: s(60), alignItems: "center" },
  castSkeletonAvatar: { width: s(60), height: s(80), borderRadius: s(12), backgroundColor: "#27272a" },
  castSkeletonLine: { width: s(40), height: s(9), borderRadius: s(4), backgroundColor: "#27272a", marginTop: s(8) },
  castRole: { color: colors.textFaint, fontSize: fs(9), fontFamily: font.semiBold, textAlign: "center", textTransform: "uppercase" },
  seasons: { marginTop: s(26), gap: s(14) },
  seasonChip: {
    paddingHorizontal: s(18),
    paddingVertical: s(9),
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginRight: s(10),
    borderWidth: 2,
    borderColor: "transparent",
  },
  seasonChipActive: { backgroundColor: "#fff" },
  seasonChipFocused: { borderColor: "#fff" },
  seasonChipText: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold },
  seasonChipTextActive: { color: "#000" },
  episodeList: { gap: s(16), marginTop: s(8), paddingVertical: s(14), paddingLeft: s(36), paddingRight: s(40) },
  emptySeasonBox: { marginTop: s(8), paddingVertical: s(28), paddingHorizontal: s(16), alignItems: "center" },
  emptySeasonText: { color: colors.textMuted, fontSize: fs(13), fontFamily: font.semiBold },
  episodeCard: {
    width: s(240),
    padding: s(8),
    borderRadius: s(10),
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 2,
    borderColor: "transparent",
    gap: s(6),
  },
  episodeCardFocused: { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.08)" },
  episodeThumbBox: { width: "100%", aspectRatio: 16 / 9, borderRadius: s(6), overflow: "hidden", backgroundColor: "#000" },
  episodeThumb: { width: "100%", height: "100%" },
  episodeNumberBadge: {
    position: "absolute",
    top: s(6),
    left: s(6),
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  episodeNumberText: { color: "#fff", fontSize: fs(11), fontFamily: font.black },
  // Filled white circle (not just an outline) so a black check reads clearly regardless of
  // whatever's behind it in the thumbnail - same treatment as the color-swatch checkmarks in
  // SettingsScreen.
  episodeWatchedBadge: {
    position: "absolute",
    top: s(6),
    right: s(6),
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  episodeDurationBadge: {
    position: "absolute",
    bottom: s(6),
    right: s(6),
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  episodeDurationText: { color: "#fff", fontSize: fs(10), fontFamily: font.bold },
  episodeComingSoonBadge: {
    position: "absolute",
    bottom: s(6),
    left: s(6),
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  episodeComingSoonText: { color: colors.textSecondary, fontSize: fs(10), fontFamily: font.bold },
  episodePlayOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  // One shared block below the whole row instead of per-card text - see focusedEpisodeId's own
  // comment. Bigger type than the old per-card title/story now that it's not competing for space
  // inside a small card.
  episodeInfoBlock: { marginTop: s(4), maxWidth: CAST_MAX_WIDTH, gap: s(6) },
  episodeInfoYear: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.bold },
  episodeInfoTitle: { color: "#fff", fontSize: fs(16), fontFamily: font.bold },
  episodeInfoStory: { color: colors.textMuted, fontSize: fs(13), lineHeight: fs(19), fontFamily: font.semiBold },
});

function cardShadow() {
  return {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  };
}
