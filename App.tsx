import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Image, NativeModules, StatusBar, Text, ToastAndroid, View, StyleSheet } from "react-native";
import type { SelectedPerson } from "./src/screens/PersonScreen";
import type { Category } from "./src/api";
import type { HomeScreenHandle } from "./src/screens/HomeScreen";
import type { Section } from "./src/components/Sidebar";
import { fetchMovies, fetchEpisodePlayback, movieUrl, posterUrl, Episode, Movie, MoviesResponse, Season, StreamServer } from "./src/api";
import { pickBestServers } from "./src/streamSelect";
import { font } from "./src/theme";
import { Lang, t } from "./src/i18n";
import { DEFAULT_SUBTITLE_SETTINGS, SubtitleSettings } from "./src/subtitleSettings";
import { DEFAULT_PREFERRED_QUALITY } from "./src/quality";
import { hasStoredValue, loadJson, saveJson, storageKeys } from "./src/storage";
import { DEFAULT_UI_SCALE, getUIScale, setUIScale, suggestInitialUIScale } from "./src/scale";
import { dispatchBack, pushBackHandler } from "./src/backStack";

// Every screen (and Sidebar) is lazy-loaded, not statically imported - each one's own
// `StyleSheet.create({...})` calls s()/fs() (see scale.ts) at the moment that module is first
// imported, not on every render, so the *manual* UI-size setting only has any effect if it's
// applied via setUIScale() before any of them have been imported for the first time. Nothing
// below ever renders a single one of these until settingsLoaded is true (see the guard clause
// past all the hooks), which is what actually enforces that ordering - React.lazy's dynamic
// import() doesn't fire until the component is first rendered.
//
// HomeScreen/Sidebar were briefly switched to a hand-rolled "store the resolved component instead
// of a ready flag" scheme instead of React.lazy, reasoning that a second React.lazy(...) call at
// render time still throws its own fresh promise even when a standalone prefetch had already
// warmed the same module - true, but that change itself was never verified on a real device before
// shipping, and was immediately followed by a real report of the app hanging on exactly this same
// splash-to-Home transition. Reverted back to the plain, previously-stable React.lazy + Suspense
// shape below rather than keep debugging an unverified change blind - the small one-tick fallback
// flash this trades back in is a known, minor cost; a hang on the app's own entry path is not.
const SplashScreen = React.lazy(() => import("./src/screens/SplashScreen"));
const HomeScreen = React.lazy(() => import("./src/screens/HomeScreen"));
const BrowseScreen = React.lazy(() => import("./src/screens/BrowseScreen"));
const SearchScreen = React.lazy(() => import("./src/screens/SearchScreen"));
const SettingsScreen = React.lazy(() => import("./src/screens/SettingsScreen"));
const MovieDetailsScreen = React.lazy(() => import("./src/screens/MovieDetailsScreen"));
const PersonScreen = React.lazy(() => import("./src/screens/PersonScreen"));
const CategoryScreen = React.lazy(() => import("./src/screens/CategoryScreen"));
const LibraryScreen = React.lazy(() => import("./src/screens/LibraryScreen"));
const VideoPlayerScreen = React.lazy(() => import("./src/screens/VideoPlayer"));
const Sidebar = React.lazy(() => import("./src/components/Sidebar"));

// Every screen sets its own fontFamily per weight (Cairo-Regular/Bold/...), but this app-wide
// default keeps any <Text> that forgets to (a stray label, a future screen) from silently
// falling back to Android's default system font instead of Cairo - matching the web app,
// where the same Cairo font-family is set once on the document root.
// @ts-ignore
Text.defaultProps = Text.defaultProps || {};
// @ts-ignore
Text.defaultProps.style = [{ fontFamily: font.semiBold }, Text.defaultProps.style];

type Screen = "splash" | "app";

interface Playing {
  servers: StreamServer[];
  movie: Movie;
  season?: Season;
  episode?: Episode;
}

interface HistoryEntry {
  movie: Movie;
  watchedAt: number;
}

const MAX_HISTORY = 50;
// See selectEpisodeInPlayer's own comment (same floor as MovieDetailsScreen's playEpisode) - a
// cached/instant fetchEpisodePlayback could otherwise resolve before the resolving spinner ever
// actually paints.
const MIN_RESOLVE_MS = 450;

export default function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [section, setSection] = useState<Section>("home");
  const [lang, setLang] = useState<Lang>("ar");
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(DEFAULT_SUBTITLE_SETTINGS);
  // A global preference (see storageKeys.preferredQuality's own comment) - starts at 1080p and
  // updates whenever the viewer picks a different quality from the player's own quality panel,
  // so every title played after that starts at the same quality instead of resetting to whatever
  // pickBestServers ranked first each time.
  const [preferredQuality, setPreferredQuality] = useState<string>(DEFAULT_PREFERRED_QUALITY);
  const [uiScale, setUiScaleState] = useState(DEFAULT_UI_SCALE);
  const [data, setData] = useState<MoviesResponse | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<SelectedPerson | null>(null);
  // The full list behind a home row's "View more" card (its own screen, opened over Home like a details page).
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  // The one and only native BackHandler subscription for this app's entire lifetime - see
  // backStack.ts's own top comment for why every other screen (this file included, below)
  // pushes/pops a plain in-memory handler through it instead of each calling
  // BackHandler.addEventListener independently.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => dispatchBack());
    return () => sub.remove();
  }, []);
  // See the render section below (where this actually gates Home/Sidebar's own remount) for the
  // full reasoning. Stays false for the first few seconds of every playback session - long enough
  // for the player's own initial focus grab to have already settled - then flips true so
  // Home/Sidebar can quietly rebuild in the background, hidden, well ahead of when exiting would
  // otherwise need to build them from scratch.
  const [homeWarm, setHomeWarm] = useState(false);
  useEffect(() => {
    if (!playing) {
      setHomeWarm(false);
      return;
    }
    const timer = setTimeout(() => setHomeWarm(true), 4000);
    return () => clearTimeout(timer);
  }, [playing]);
  // Purely a delayed-appearance visual bridge for handleExitPlayer below - never shown outright
  // the instant the player exits.
  const [exitTransition, setExitTransition] = useState(false);
  // The exiting movie's own backdrop, shown full-screen for the same window as exitTransition
  // below - see handleExitPlayer's own comment on why an overlay with no background of its own
  // was never actually going to fix "still shows a black screen": that black was never this
  // overlay's own background at all, it was App's own root View (styles.root, its own permanent
  // black backgroundColor) simply showing through during the real gap - Home hasn't rendered
  // anything on top of it yet. Painting this image over that same root instead reads as the movie
  // smoothly staying on screen while Home loads behind it, not a flash to black.
  const [exitBackdrop, setExitBackdrop] = useState<string | null>(null);
  const [resolvingEpisodeInPlayerId, setResolvingEpisodeInPlayerId] = useState<string | null>(null);
  const [watchLater, setWatchLater] = useState<Movie[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Composite "movieId:seasonNumber:episodeNumber" keys - `history` only ever tracked a whole
  // movie/series as watched, with no per-episode granularity, so a series with one watched
  // episode looked identical to one fully finished. This is what MovieDetailsScreen's episode
  // cards check to show a watched checkmark on the specific episode(s) actually played.
  const [watchedEpisodes, setWatchedEpisodes] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const homeRef = useRef<HomeScreenHandle>(null);
  const prevSectionRef = useRef<Section>(section);
  // Home staying permanently mounted (see below) means its scroll position now persists across
  // visits by default - wanted when returning from a movie/person/the player mid-scroll, but not
  // when the sidebar's own Home icon is pressed, which should always land back on the hero at
  // the top. Wrapping Sidebar's onSelect (instead of handing it setSection directly) is what
  // makes every press of that specific icon reset scroll, without needing Home to ever remount.
  const handleSelectSection = (s: Section) => {
    setSection(s);
    if (s === "home") homeRef.current?.scrollToTop();
  };

  // Stable references (not a fresh `() => setSelectedMovie(null)` arrow literal on every render)
  // for MovieDetailsScreen's/PersonScreen's own `onBack` prop specifically because both register
  // their hardware-back-button handler in a `useEffect(() => {...}, [onBack])` - an inline arrow
  // here is a *new* function every single App.tsx re-render (a data refresh timer, homeWarm,
  // AppState, anything), which was tearing down and re-adding that BackHandler subscription every
  // one of those times while either screen sat open, not just when actually navigating. Reported
  // as "pressing back from the movie info screen sometimes exits the app entirely" - constant
  // subscription churn is exactly the kind of avoidable instability worth removing outright rather
  // than trusting BackHandler's add/remove to always be perfectly gapless under it, even without a
  // fully isolated repro of the underlying timing.
  const closePerson = useCallback(() => setSelectedPerson(null), []);
  const closeCategory = useCallback(() => setSelectedCategory(null), []);
  const closeMovieDetails = useCallback(() => setSelectedMovie(null), []);

  // dataReady (not `data` itself) is what the splash's own AutoAdvance below actually waits on -
  // see its own comment for why the wait belongs here, on the branded splash (which already has
  // its own spinner), rather than as a separate spinner right after Home has already appeared.
  // Gating on `data` directly is exactly what caused the earlier version of this: a rejected fetch
  // (bad network, or the backend's own cold-start proxy timing out outright rather than just being
  // slow) never sets `data` at all, and nothing ever cleared that wait - a genuine permanent hang, not just a long
  // one. The 12s ceiling and the .catch() below both exist purely to guarantee dataReady still
  // becomes true even then, so the worst case is "Home loads its own catalog late" (already
  // handled by HomeScreen's own loading state) rather than "stuck on splash forever."
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const ceiling = setTimeout(() => {
      if (!cancelled) setDataReady(true);
    }, 12000);
    fetchMovies()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setDataReady(true);
        clearTimeout(ceiling);
      })
      .catch((err) => {
        console.error("[App] fetchMovies failed:", err);
        if (cancelled) return;
        setDataReady(true);
        clearTimeout(ceiling);
      });
    return () => {
      cancelled = true;
      clearTimeout(ceiling);
    };
  }, []);

  // The fetch above only ever runs once, at mount - and Home (see below) stays mounted for the
  // app's entire lifetime rather than remounting on navigation, so nothing was ever re-running
  // it afterwards. On a TV, the app process routinely stays alive (foregrounded or not) for
  // hours or days, so any movie/show an admin adds or edits after launch just never appeared
  // until someone force-killed and reopened the app. Refetching on a periodic timer covers a
  // long-lived foreground session; refetching when the app comes back to the foreground covers
  // the more common case of the viewer backgrounding it (home button) and returning later.
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
    const refresh = () => {
      fetchMovies()
        .then(setData)
        .catch((err) => console.error("[App] fetchMovies refresh failed:", err));
    };
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  // UI scale specifically is loaded on its own, ahead of (and separately from) the rest of the
  // saved settings below - every lazy screen's own StyleSheet.create() reads the *current* scale
  // via s()/fs() at the moment that module is first imported (see scale.ts), so setUIScale()
  // applying the saved value has to land before Sidebar/HomeScreen are prefetched just below, not
  // after. Splitting this into its own minimal two-key read (instead of one combined Promise.all
  // with everything else) is what lets that prefetch start at the very first possible moment after
  // cold boot, rather than waiting on watchLater/history/watchedEpisodes too - the biggest lever
  // available for "Home appears already loaded the instant the splash hands off" on weaker
  // hardware, where three real screens' worth of JS bundle taking a visible moment to parse/
  // evaluate was reported as a long spinner right after the splash.
  const [uiScaleReady, setUiScaleReady] = useState(false);
  useEffect(() => {
    Promise.all([loadJson<number>(storageKeys.uiScale, DEFAULT_UI_SCALE), hasStoredValue(storageKeys.uiScale)]).then(
      ([savedUiScale, uiScaleWasSaved]) => {
        // A viewer who has never touched the UI-size setting gets a device-aware guess instead of
        // the fixed 0.9 default (see suggestInitialUIScale's own comment) - anyone who already
        // has a saved value, even one that happens to equal the default, keeps exactly what they
        // saved.
        const resolved = uiScaleWasSaved ? savedUiScale : suggestInitialUIScale();
        setUiScaleState(resolved);
        setUIScale(resolved);
        setUiScaleReady(true);
      }
    );
  }, []);

  // Restores whatever the user picked last time (language, subtitle style, watch-later list,
  // watch history) - previously every one of these silently reset to defaults on every cold
  // start, since nothing was ever persisted anywhere.
  useEffect(() => {
    Promise.all([
      loadJson<Lang>(storageKeys.lang, "ar"),
      loadJson<SubtitleSettings>(storageKeys.subtitleSettings, DEFAULT_SUBTITLE_SETTINGS),
      loadJson<Movie[]>(storageKeys.watchLater, []),
      loadJson<HistoryEntry[]>(storageKeys.watchHistory, []),
      loadJson<string[]>(storageKeys.watchedEpisodes, []),
      loadJson<string>(storageKeys.preferredQuality, DEFAULT_PREFERRED_QUALITY),
    ]).then(([savedLang, savedSubs, savedWatchLater, savedHistory, savedWatchedEpisodes, savedPreferredQuality]) => {
      setLang(savedLang);
      // Merged rather than used as-is: a value saved before a field existed (e.g. `enabled`,
      // added later) round-trips through AsyncStorage missing that key entirely, not with an
      // explicit default - loadJson has no way to know a *partial* stored object should still
      // fall back per-field. Spreading the current default first is what keeps an old save from
      // silently reading as "subtitles off" for every existing viewer the moment that field was
      // introduced.
      setSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS, ...savedSubs });
      setWatchLater(savedWatchLater);
      setHistory(savedHistory);
      setWatchedEpisodes(savedWatchedEpisodes);
      setPreferredQuality(savedPreferredQuality);
      setSettingsLoaded(true);
    });
  }, []);

  // Every screen below is behind its own Suspense boundary now (see the render below), so a
  // lazy import that's still in flight only ever blanks *that one slot*, not the whole app - but
  // it still blanks that slot until the import resolves. Warming up the imports *before* the
  // screen that needs them is what avoids that gap actually being visible at all: by the time
  // React tries to render one of these, its module is (almost always) already sitting resolved
  // from this call, so Suspense never even has anything to wait for. Kicking these off only once
  // uiScaleReady is true keeps them after setUIScale() has already run (same ordering requirement
  // as the lazy() calls above), and a bare `import()` call here doesn't re-run a module that's
  // already been evaluated - it's the same cached module React.lazy resolves to.
  //
  // homeModuleReady/sidebarModuleReady track the *promise actually resolving*, not just being
  // fired - splash's own AutoAdvance below waits on these too, not just on `data`, which is what
  // closes the last real gap in "load during boot, not after the splash is gone": firing the
  // import alone only means the fetch/parse has *started*, and on weaker hardware the JS bundle
  // evaluation itself (not network) was still occasionally still in flight by the time the splash
  // handed off to Home - reported as a spinner right after the splash despite this prefetch
  // already existing. A later attempt to close that residual gap by storing the resolved component
  // directly instead of a flag (bypassing React.lazy/Suspense for these two entirely) caused a
  // real hang on this same transition and was reverted - see this file's own top comment.
  const [homeModuleReady, setHomeModuleReady] = useState(false);
  const [sidebarModuleReady, setSidebarModuleReady] = useState(false);
  useEffect(() => {
    if (!uiScaleReady) return;
    import("./src/components/Sidebar").then(
      () => setSidebarModuleReady(true),
      () => setSidebarModuleReady(true)
    );
    import("./src/screens/HomeScreen").then(
      () => setHomeModuleReady(true),
      () => setHomeModuleReady(true)
    );
  }, [uiScaleReady]);
  // Used to wait for screen === "app" && data - meaning these only started loading *after* a
  // guest had already landed on Home, so the very first visit to any of Movies/Series/Search/
  // Settings/a movie's details/a person/the player could still show its own <ScreenLoader/>
  // spinner if the viewer moved on from Home before the import resolved. None of these actually
  // need `data` themselves (only their own screen-specific fetches, which still only ever run once
  // that screen actually mounts) - only the same uiScale-before-first-render ordering every lazy
  // screen needs (see the top of this file) - so there's no real reason to wait any longer than
  // Home/Sidebar above do. Starting all of them together is what makes "every screen already
  // loaded by the time boot finishes" apply app-wide, not just to the one screen a guest happens
  // to land on first.
  useEffect(() => {
    if (!uiScaleReady) return;
    import("./src/screens/BrowseScreen").catch(() => {});
    import("./src/screens/LibraryScreen").catch(() => {});
    import("./src/screens/SearchScreen").catch(() => {});
    import("./src/screens/SettingsScreen").catch(() => {});
    import("./src/screens/MovieDetailsScreen").catch(() => {});
    import("./src/screens/PersonScreen").catch(() => {});
    import("./src/screens/CategoryScreen").catch(() => {});
    import("./src/screens/VideoPlayer").catch(() => {});
  }, [uiScaleReady]);

  // Guarded by settingsLoaded so the *defaults* this state starts with (before the load
  // above resolves) never get written back out and clobber whatever was actually saved.
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.lang, lang);
  }, [lang, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.subtitleSettings, subtitleSettings);
  }, [subtitleSettings, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.preferredQuality, preferredQuality);
  }, [preferredQuality, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.watchLater, watchLater);
  }, [watchLater, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.watchHistory, history);
  }, [history, settingsLoaded]);
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.watchedEpisodes, watchedEpisodes);
  }, [watchedEpisodes, settingsLoaded]);
  // Only ever persisted here - NOT also passed to setUIScale() again, since every screen in
  // this same running session already imported (and so already permanently baked in their
  // styles from) whatever scale was in effect at launch. This purely saves the choice for the
  // *next* launch; SettingsScreen's own UI is what tells the viewer a reopen is what applies it.
  useEffect(() => {
    if (settingsLoaded) saveJson(storageKeys.uiScale, uiScale);
  }, [uiScale, settingsLoaded]);

  // "Reopen the app to apply the new size" (SettingsScreen's own note) relied entirely on the
  // viewer actually killing the process themselves - pressing the home/launcher button on most
  // Android TV boxes only backgrounds the activity, so the already-imported screens' styles
  // (baked in at whatever scale was active when each was first opened, see scale.ts) never
  // actually got the fresh value, no matter how long they waited. Auto-exiting the moment they
  // leave Settings with a genuinely new value was meant to remove that ambiguity, but
  // BackHandler.exitApp() only ever finishes the current Activity - the Application object (and
  // the single ReactHost/JS engine every screen was imported into) is a process-lifetime
  // singleton that Android very often keeps alive and reuses for the very next launch, which
  // never re-runs any module's top-level StyleSheet.create() call. Reported as the size setting
  // only ever visibly changing icons (those read the live scale value at render time via s()/
  // fs(), unlike everything else baked into a module-level style object). AppRestart.restart()
  // (see AppRestartModule.kt) actually kills the process, which is the only thing that
  // guarantees the next launch is a genuine cold start.
  useEffect(() => {
    const prevSection = prevSectionRef.current;
    prevSectionRef.current = section;
    if (prevSection === "settings" && section !== "settings" && uiScale !== getUIScale()) {
      ToastAndroid.show(
        lang === "ar" ? "جاري إعادة التشغيل لتطبيق الحجم الجديد..." : "Restarting to apply the new size...",
        ToastAndroid.SHORT
      );
      setTimeout(() => NativeModules.AppRestart?.restart(), 600);
    }
  }, [section, uiScale, lang]);

  // A single back press used to exit the app immediately from the sidebar-navigable root
  // screens - nothing else on this screen consumes the back event, so Android's own default
  // behavior (finish the activity) ran unopposed. Pushed onto the shared backStack (see its own
  // top comment) rather than calling BackHandler directly - every screen below this root that
  // needs to consume back pushes its own handler while it's open, and the stack's own "top always
  // wins" rule is what keeps this one from firing while any of them are mounted, deterministically
  // - not dependent on native listener registration order the way the old
  // multiple-independent-BackHandler-subscriptions design was.
  const lastBackPressRef = useRef(0);
  useEffect(() => {
    if (screen !== "app" || playing || selectedPerson || selectedMovie || selectedCategory) return;
    const unsubscribe = pushBackHandler(() => {
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }
      lastBackPressRef.current = now;
      ToastAndroid.show(lang === "ar" ? "اضغط رجوع مرة أخرى للخروج" : "Press back again to exit", ToastAndroid.SHORT);
      return true;
    }, "App:root");
    // Without resetting this, a single back press here (say, on the Movies grid) arms a 2-second
    // exit window that outlives this effect entirely - opening a movie's details right after
    // unmounts this listener (selectedMovie truthy), but the stale timestamp survives in the ref.
    // Coming back out (details' own BackHandler consumes that press, never touching this ref) and
    // pressing back once more here re-mounts this same listener, which still finds "now -
    // lastBackPressRef.current < 2000" true from the *original* press and exits immediately - no
    // toast, no warning, from what reads to the viewer as a single ordinary back press. Reported as
    // "sudden exit while navigating between movies" - exactly the open-glance-back cycle that primes
    // this without ever showing the "press again" toast on the screen it actually exits from.
    // Clearing it here means only a genuinely fresh double-press *within this same active window*
    // can ever trigger the exit.
    return () => {
      unsubscribe();
      lastBackPressRef.current = 0;
    };
  }, [screen, playing, selectedPerson, selectedMovie, selectedCategory, lang]);

  // A fallback only - MovieDetailsScreen/PersonScreen each push their own back handler directly
  // (see their own comment) the moment they're actually mounted, which always sits above this one
  // on the stack and so always wins first. This one only ever matters for the brief window before
  // either lazy-loaded screen has finished Suspense-resolving, where nothing else has pushed yet.
  // `playing` deliberately isn't part of the condition or the dep list (it used to be both): while
  // selectedMovie/selectedPerson stay truthy the whole time a video plays (MovieDetailsScreen
  // never unmounts underneath the player - see App's own render tree), toggling `playing` used to
  // tear this effect down and re-run it purely because it was *listed* as a dependency, which
  // re-pushed this fallback handler back onto the *top* of the stack the moment playback ended -
  // above MovieDetailsScreen's own already-registered, already-correct handler, which had been
  // sitting there the entire time and never needed this fallback's help again. Two different
  // handlers now both capable of closing the same screen, reordering on every single play/exit
  // round trip, is exactly the "resurfaces in new shapes" instability backStack.ts's own top
  // comment warns about - reported as "back stops responding on the details screen, but only
  // after having played something first." This now only ever reacts to selectedPerson/
  // selectedMovie themselves actually opening or closing, which is its one real job.
  useEffect(() => {
    if (screen !== "app" || (!selectedPerson && !selectedMovie && !selectedCategory)) return;
    const unsubscribe = pushBackHandler(() => {
      if (selectedPerson) {
        setSelectedPerson(null);
      } else if (selectedMovie) {
        setSelectedMovie(null);
      } else {
        setSelectedCategory(null);
      }
      return true;
    }, "App:fallback");
    return unsubscribe;
  }, [screen, selectedPerson, selectedMovie, selectedCategory]);

  const isWatchLater = (id: string) => watchLater.some((f) => f.id === id);
  // useCallback with an empty dependency array - safe (and stable forever) because this only ever
  // reads its own `movie` argument plus setWatchLater's functional-update form, never anything
  // reactive from the closure itself. Same "clean up the unstable-prop-through-memo pattern"
  // pass as isEpisodeWatched/selectEpisodeInPlayer elsewhere in this file - this one specifically
  // feeds MovieDetailsScreen's onToggleFavorite, a prop threaded past that screen's own memoized
  // rows the exact same way.
  const toggleWatchLater = useCallback((movie: Movie) => {
    setWatchLater((prev) => (prev.some((f) => f.id === movie.id) ? prev.filter((f) => f.id !== movie.id) : [...prev, movie]));
  }, []);

  const historyItems = useMemo(() => history.map((h) => h.movie), [history]);

  // Same reasoning as toggleWatchLater just above - only reads its own argument plus
  // setHistory's functional-update form, so an empty dependency array is safe and keeps this
  // permanently stable (playFromDetails below calls it, and needs it stable to be stable itself).
  const recordHistory = useCallback((movie: Movie) => {
    setHistory((prev) => [{ movie, watchedAt: Date.now() }, ...prev.filter((h) => h.movie.id !== movie.id)].slice(0, MAX_HISTORY));
  }, []);

  const episodeKey = (movieId: string, seasonNumber: number, episodeNumber: number) => `${movieId}:${seasonNumber}:${episodeNumber}`;
  // Wrapped in useCallback (was a plain inline function) for the same reason closePerson/
  // closeMovieDetails already are (see their own comment) - this is a prop threaded through two
  // separate React.memo boundaries (MovieDetailsScreen's own EpisodeRail/EpisodeCard, and
  // VideoPlayer's own EpisodeRow, which its own comment already flags as re-rendering ~4x/second
  // during playback specifically to defeat exactly this kind of unstable-prop leak). A fresh
  // closure every single App.tsx render - which a data refresh timer, homeWarm, AppState, or
  // anything else triggers continuously - was silently busting both memo boundaries on every one
  // of those renders regardless, fully re-rendering the entire visible episode list each time.
  // Reported as "the app got heavier, especially the show info page and moving between episodes" -
  // exactly the symptom an unmemoized boundary produces under continuous background re-renders.
  const isEpisodeWatched = useCallback(
    (movieId: string, seasonNumber: number, episodeNumber: number) =>
      watchedEpisodes.includes(episodeKey(movieId, seasonNumber, episodeNumber)),
    [watchedEpisodes]
  );
  // VideoPlayerScreen's own isEpisodeWatched prop is 2-arg (season/episode only - it already
  // knows which movie is playing) - this curries that in once, instead of a fresh arrow function
  // at the JSX call site defeating the stability isEpisodeWatched itself just gained above.
  const playingMovieId = playing?.movie.id;
  const isPlayingEpisodeWatched = useCallback(
    (seasonNumber: number, episodeNumber: number) =>
      playingMovieId ? isEpisodeWatched(playingMovieId, seasonNumber, episodeNumber) : false,
    [isEpisodeWatched, playingMovieId]
  );

  // Wrapped in useCallback (was plain) for the same reason handleExitPlayer already is (see its
  // own comment) - this is MovieDetailsScreen's onPlay prop, and depends only on the now-stable
  // recordHistory, so it stays stable across every unrelated App.tsx render too.
  const playFromDetails = useCallback((source: { servers: StreamServer[]; movie: Movie; season?: Season; episode?: Episode }) => {
    recordHistory(source.movie);
    if (source.season && source.episode) {
      const key = episodeKey(source.movie.id, source.season.number, source.episode.number);
      setWatchedEpisodes((prev) => (prev.includes(key) ? prev : [...prev, key]));
    }
    // Warms RN's own image cache for handleExitPlayer's own exitBackdrop, fetched here (at the
    // *start* of playback, with as long as the whole watch itself to actually finish) rather than
    // only right at exit time - reported as "still shows a black screen" even after adding that
    // cover image, which this exactly explains: a freshly-mounted <Image> pointed at a URL that's
    // never been fetched before has nothing to paint until its own network request completes, so
    // the root's black background was still showing through underneath it for that gap - the same
    // failure mode as before, just with an invisible Image now sitting on top of it. Prefetching
    // this far ahead of when it's actually needed is what makes it already-cached and paint
    // instantly by the time an exit actually happens.
    Image.prefetch(posterUrl(source.movie.backdrop || source.movie.poster, "w1280")).catch(() => {});
    setPlaying({
      ...source,
      servers: source.servers.map((server) => ({ ...server, url: movieUrl(server.url) || server.url })),
    });
  }, [recordHistory]);

  // Reported as "exiting the player takes a long time, shows a black loading screen." Real
  // on-screen timing diagnostics (since removed, their job done) traced this to two distinct
  // causes, both fixed at the source rather than papered over here: the video surface itself
  // being slow to tear down while still actively decoding (see VideoPlayerScreen's own onExit -
  // it now stops playback first) and Home/Sidebar needing a real remount on the way out
  // (addressed by homeWarm above, which now rebuilds them in the background during playback
  // instead of at exit time). What's left here is purely the visual bridge for whatever gap
  // still remains: the movie's own backdrop paints over this component's own root background
  // (which would otherwise show through as a black flash - see exitBackdrop's own comment) the
  // instant an exit begins, and a delayed-appearance spinner (no background of its own) covers
  // the rare case where revealing what comes back into view still takes a moment - two nested
  // requestAnimationFrame calls clear both as soon as that's actually finished, not a fixed
  // guess at how long it should take (InteractionManager, the normal fix for exactly this, was
  // removed from this RN version's core entirely).
  // Wrapped in useCallback (was a plain inline function) - see closePerson/closeMovieDetails'
  // own comment just above for why an unstable callback here is a real bug, not just a wasted
  // render: this is VideoPlayerScreen's own `onExit` prop, which VideoPlayer.tsx's back-handler
  // effect depends on transitively (via its own `handleExit` useCallback). A fresh identity every
  // single App.tsx re-render - which happens continuously while a video plays, from state that
  // has nothing to do with playback - meant that effect was tearing down and re-pushing the
  // player's own backStack entry that same relentless rate for as long as playback lasted.
  // Reported as "returns from the player fine, but back then does nothing on the details screen
  // right after" - the same class of instability backStack.ts's own top comment was written to
  // eliminate, just reintroduced here by the one callback in this file that never got the
  // useCallback treatment its siblings did. Only depends on `playing` (read for the exit
  // backdrop), so it now only gets a new identity exactly when playback actually starts/stops -
  // not on every unrelated render in between.
  const handleExitPlayer = useCallback(() => {
    setExitBackdrop(posterUrl(playing?.movie.backdrop || playing?.movie.poster, "w1280"));
    const showTimer = setTimeout(() => setExitTransition(true), 1000);
    setPlaying(null);
    const safetyCeiling = setTimeout(clearExitTransition, 20000);
    requestAnimationFrame(() => requestAnimationFrame(clearExitTransition));
    function clearExitTransition() {
      clearTimeout(showTimer);
      clearTimeout(safetyCeiling);
      setExitTransition(false);
      setExitBackdrop(null);
    }
  }, [playing]);

  // Hides the splash - see the app tree's own opening comment in the render below for the full
  // reasoning. Same "wait for the JS thread to actually go idle" technique already proven for
  // handleExitPlayer's own reveal (two nested requestAnimationFrame calls - see its own comment):
  // the first fires after React has committed whatever just mounted (the app tree, rendered the
  // instant the condition below turns true), the second after the layout pass that commit
  // triggered has also finished - only then is Home's own first paint actually done, not just
  // scheduled. A flat fixed delay here (this used to be a 150ms timer) can't adapt to how long
  // that real cost turns out to be on a given device, which is exactly what let it show through
  // as a second, unbranded loading screen on weaker hardware.
  useEffect(() => {
    if (!(dataReady && homeModuleReady && sidebarModuleReady)) return;
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setScreen("app"));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [dataReady, homeModuleReady, sidebarModuleReady]);

  // Switching episodes from EpisodesPanel (opened *inside* an already-playing episode) reuses
  // the exact same resolve-playback-then-pick-best-servers-then-record-history path
  // MovieDetailsScreen's own playEpisode already goes through - just without ever leaving the
  // player screen to get there.
  // Wrapped in useCallback (was plain) - this is VideoPlayerScreen's own onSelectEpisode prop,
  // which reaches EpisodeRow.tsx exactly the way isEpisodeWatched did (see its own comment on
  // why that mattered: EpisodeRow is memoized specifically because VideoPlayer re-renders ~4x/
  // second during playback, and an unstable prop here defeated that memo on every one of those
  // ticks just as much as isEpisodeWatched's did). Depends on playing/resolvingEpisodeInPlayerId
  // (read directly) and playFromDetails (now itself stable) - only gets a new identity when the
  // episode-switching state actually changes, not on every unrelated render in between.
  const selectEpisodeInPlayer = useCallback(async (ep: Episode, season: Season) => {
    if (!playing || !ep.hasPlayableStream || resolvingEpisodeInPlayerId) return;
    setResolvingEpisodeInPlayerId(ep.id);
    try {
      const [{ servers, subtitles }] = await Promise.all([
        fetchEpisodePlayback(ep.id, ep.cinemanaId, ep.ceeId),
        new Promise<void>((resolve) => setTimeout(() => resolve(), MIN_RESOLVE_MS)),
      ]);
      if (!servers.length) return;
      playFromDetails({
        servers: await pickBestServers(servers),
        movie: playing.movie,
        season,
        episode: { ...ep, servers, subtitles },
      });
    } catch (err) {
      console.error("[App] selectEpisodeInPlayer failed:", err);
    } finally {
      setResolvingEpisodeInPlayerId(null);
    }
  }, [playing, resolvingEpisodeInPlayerId, playFromDetails]);

  // Nothing past this point ever renders a lazy screen - see the top of this file for why that
  // ordering matters for the UI-scale setting specifically. Gated on both settings loads now
  // that uiScale resolves via its own separate, faster read (see its own comment) - either one
  // still in flight means setUIScale() might not have run yet.
  if (!settingsLoaded || !uiScaleReady) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {/* One Suspense boundary used to wrap this entire tree, which meant a lazy import
          *anywhere* in it - even a screen with nothing to do with what's already on screen -
          blanked literally everything else under this boundary to the fallback until it
          resolved. Reported as a black flash both at boot (splash/auth/home each loading for
          the first time) and while navigating (switching to a not-yet-visited tab, or opening a
          movie/person/the player for the first time). Each slot below now has its own nested
          boundary, so a pending import only ever blanks its own slot - and the prefetching
          above means most of these will already be resolved by the time they're rendered,
          so there's usually nothing to wait for at all. */}
      {/* Mounted the instant the catalog + Home/Sidebar's own JS module are ready - *not* gated
          on `screen` reaching "app" - so the splash below, still covering the screen at this
          point, has something real already mounting underneath it. See the splash-hiding effect
          above this component's `return` for why: Home's very first mount here is a genuinely
          expensive, CPU-bound synchronous cost on weaker hardware (the exact same cost
          pre-warming exists to hide during a *player exit* - see homeWarm's own comment - just
          happening at cold boot instead), and revealing it before that cost has actually finished
          was reported as "~10 seconds of black screen after the logo, then Home appears" - a
          second, unbranded loading phase confirmed to happen even with the backend already warm
          (ruling out a network cause; see the minScale investigation this same report led to and
          then reverted, since the mount cost - not the network - was the real culprit). Mounting
          here and only hiding the splash once that mount has actually settled means the splash
          bridges the *entire* real cost instead of a guessed fixed delay. */}
      {dataReady && homeModuleReady && sidebarModuleReady && (
        <>
          {/* The sidebar-navigable root (Sidebar + all sections) used to be one branch of a
              playing/selectedPerson/selectedMovie ternary, so opening a movie's details, a
              person, or the player unmounted this whole branch - including Home - and coming
              back re-created Home from scratch (hero image reload, rail scroll reset, every
              fetch re-run). It's now mounted and only hidden with display:none while a movie's
              details or a person are open, the same technique already used to keep Home itself
              resident across sidebar tab switches below - so returning from either back to Home
              is instant instead of a full remount.
              `playing` specifically is excluded from that - the video player is unmounted
              (not just hidden) instead, same as before. Reported as "nothing in the player has
              focus at all, only the hardware back button works" once Home/Sidebar started
              staying mounted underneath it: Android's initial-focus handoff (which
              hasTVPreferredFocus and the player's own retry-focus effect both depend on) is far
              more reliable when a screen appears as a genuinely fresh subtree than when it's
              added as a new sibling next to an already-focus-established one that's merely
              hidden.
              That real cost - reported separately as "exiting takes several seconds," isolated
              via on-screen timing diagnostics to specifically this remount, once every other
              candidate (the video surface itself being slow to tear down, the screen revealed
              underneath needing to re-fetch anything) was measured and ruled out in turn - is what
              homeWarm below actually addresses, without touching the fresh-mount-on-entry
              behavior above that fixed the focus bug in the first place: it stays false (Home
              genuinely unmounted, exactly as before) through the entire window where the player's
              own initial focus grab is happening, and only afterward - well after that one-time
              handoff has already settled, with nothing left competing for "what gets focus first"
              - does it flip true and quietly remount Home/Sidebar/etc. again in the background,
              hidden behind the still-playing, already-focused video. Exiting later then only ever
              needs to *reveal* an already-built screen instead of building one from scratch.
              Scoped to Sidebar+Home specifically now, not the whole sidebar-navigable root this
              originally covered - Library/Settings below stayed strictly on `!playing`, back to
              their own original behavior, after pre-warming caused a real regression: reported as
              "the app suddenly exits to the OS home screen" sometimes - traced to SettingsScreen's
              own hardware-back-button handler, which registers unconditionally on mount with no
              awareness of whether Settings is the actually-visible section. Pre-warming mounted it
              (hidden) during every playback session, and Android's own back-dispatch ordering let
              its handler intercept a back press meant for the player before the player's own
              handler ever ran. Home/Sidebar have no equivalent landmine, and are also the only
              genuinely expensive part to rebuild anyway - Library/Settings were already
              lightweight, per this same block's own original comment below, so excluding them
              from pre-warming costs nothing. */}
          <View style={[StyleSheet.absoluteFill, (selectedPerson || selectedMovie || selectedCategory || !!playing) && styles.sectionHidden]}>
            {(!playing || homeWarm) && (
              <>
                <Suspense fallback={null}>
                  <Sidebar active={section} onSelect={handleSelectSection} />
                </Suspense>
                <View style={[StyleSheet.absoluteFill, section !== "home" && styles.sectionHidden]}>
                  <Suspense fallback={<ScreenLoader />}>
                    <HomeScreen
                      ref={homeRef}
                      heroMovies={data ? (data.heroMovies.length > 0 ? data.heroMovies : [data.hero]) : []}
                      categories={data?.categories ?? []}
                      lang={lang}
                      onSelectMovie={setSelectedMovie}
                      onOpenCategory={setSelectedCategory}
                      active={section === "home" && !selectedPerson && !selectedMovie && !selectedCategory}
                    />
                  </Suspense>
                </View>
              </>
            )}
            {!playing && (
              <>
                {section === "movies" && (
                  <View style={StyleSheet.absoluteFill}>
                    <Suspense fallback={<ScreenLoader />}>
                      <BrowseScreen title={t("movies", lang)} type="movie" lang={lang} onSelect={setSelectedMovie} />
                    </Suspense>
                  </View>
                )}
                {section === "series" && (
                  <View style={StyleSheet.absoluteFill}>
                    <Suspense fallback={<ScreenLoader />}>
                      <BrowseScreen title={t("series", lang)} type="series" lang={lang} onSelect={setSelectedMovie} />
                    </Suspense>
                  </View>
                )}
                {/* Library and Settings, unlike Movies/Series/Search below, hold nothing large
                    or network-fetched of their own - Library's own items are already-loaded
                    props from this component's own state, and Settings is just controls - so
                    they get the exact same "hide, don't unmount" treatment as Home above for the
                    same reason: switching back to either used to mean a full remount (and, for
                    Settings, its own detail fetches re-running) every single time, reported as
                    the sidebar itself feeling slow to navigate. Movies/Series/Search keep
                    unmounting on the way out - each can grow into a large, image-heavy fetched
                    list via its own infinite scroll, and keeping every one of those resident at
                    once on top of Home's own images is a real memory cost on TV hardware that
                    Library/Settings don't share. */}
                <View style={[StyleSheet.absoluteFill, section !== "library" && styles.sectionHidden]}>
                  <Suspense fallback={<ScreenLoader />}>
                    <LibraryScreen lang={lang} watchLater={watchLater} history={historyItems} onSelect={setSelectedMovie} />
                  </Suspense>
                </View>
                {section === "search" && (
                  <View style={StyleSheet.absoluteFill}>
                    <Suspense fallback={<ScreenLoader />}>
                      <SearchScreen lang={lang} onSelect={setSelectedMovie} />
                    </Suspense>
                  </View>
                )}
                <View style={[StyleSheet.absoluteFill, section !== "settings" && styles.sectionHidden]}>
                  <Suspense fallback={<ScreenLoader />}>
                    <SettingsScreen
                      lang={lang}
                      onChangeLang={setLang}
                      subtitleSettings={subtitleSettings}
                      onChangeSubtitleSettings={setSubtitleSettings}
                      uiScale={uiScale}
                      onChangeUiScale={setUiScaleState}
                      onBack={() => setSection("home")}
                      // See SettingsScreen's own comment on why this - not just being mounted -
                      // is what its back-handler push has to be gated on: it stays mounted
                      // (hidden) through every play/exit cycle regardless of section, per this
                      // block's own "keep it warm" comment above.
                      active={section === "settings"}
                    />
                  </Suspense>
                </View>
              </>
            )}
          </View>

          {selectedCategory && (
            <View style={StyleSheet.absoluteFill}>
              <Suspense fallback={<ScreenLoader />}>
                <CategoryScreen category={selectedCategory} lang={lang} onSelectMovie={setSelectedMovie} onBack={closeCategory} />
              </Suspense>
            </View>
          )}

          {selectedMovie && (
            <View style={StyleSheet.absoluteFill}>
              <Suspense fallback={<ScreenLoader />}>
                {/* key={movie.id}: tapping one of a movie's "other parts" calls setSelectedMovie
                    again while this same screen is already mounted (not routed through null
                    first the way every other entry into this screen is) - without a key forcing
                    a fresh instance, this component's internal state (active season, scroll
                    position, the fetched parts list itself) would carry over from the *previous*
                    movie instead of resetting for the new one. */}
                <MovieDetailsScreen
                  key={selectedMovie.id}
                  movie={selectedMovie}
                  lang={lang}
                  isFavorite={isWatchLater(selectedMovie.id)}
                  onToggleFavorite={() => toggleWatchLater(selectedMovie)}
                  onPlay={playFromDetails}
                  onSelectPerson={setSelectedPerson}
                  onSelectMovie={setSelectedMovie}
                  onBack={closeMovieDetails}
                  isEpisodeWatched={isEpisodeWatched}
                />
              </Suspense>
            </View>
          )}

          {selectedPerson && (
            <View style={StyleSheet.absoluteFill}>
              <Suspense fallback={<ScreenLoader />}>
                <PersonScreen
                  person={selectedPerson}
                  lang={lang}
                  onSelectMovie={(m) => {
                    setSelectedPerson(null);
                    setSelectedMovie(m);
                  }}
                  onBack={closePerson}
                />
              </Suspense>
            </View>
          )}

          {playing && (
            <View style={StyleSheet.absoluteFill}>
              <Suspense fallback={<ScreenLoader />}>
                <VideoPlayerScreen
                  servers={playing.servers}
                  movie={playing.movie}
                  season={playing.season}
                  episode={playing.episode}
                  lang={lang}
                  subtitleSettings={subtitleSettings}
                  onChangeSubtitleSettings={setSubtitleSettings}
                  preferredQuality={preferredQuality}
                  onChangePreferredQuality={setPreferredQuality}
                  onExit={handleExitPlayer}
                  onSelectEpisode={selectEpisodeInPlayer}
                  resolvingEpisodeId={resolvingEpisodeInPlayerId}
                  isEpisodeWatched={isPlayingEpisodeWatched}
                />
              </Suspense>
            </View>
          )}
        </>
      )}
      {/* Rendered *after* (so it paints on top of) the app tree above, covering it for however
          long that tree's own first mount actually takes - see the splash-hiding effect above
          this component's `return`, and the app tree's own opening comment, for the full
          reasoning. `screen` only ever gates this cover now, never whether the app tree itself
          exists underneath it. */}
      {screen === "splash" && (
        <Suspense fallback={<View style={styles.root} />}>
          <SplashScreen posters={data?.categories?.[0]?.items ?? []} />
        </Suspense>
      )}
      {/* See exitBackdrop's own comment above - shown immediately (not delayed like the spinner
          below), covering this component's own root black background for the whole transition
          instead of letting it show through while Home is still rebuilding on top of it. */}
      {!!exitBackdrop && (
        <Image source={{ uri: exitBackdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
      )}
      {/* A delayed-appearance spinner only, shown only once a player exit's own Home/Sidebar
          remount has already run long enough to actually be worth saying something about - see
          handleExitPlayer's own comment above. */}
      {exitTransition && (
        <View style={styles.exitTransitionOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </View>
  );
}

// A visible loading state instead of an opaque black rectangle for the (now rare, thanks to
// prefetching above) case where a screen's lazy import is still in flight when it's rendered -
// reads as "this is loading" rather than "the screen just went black."
function ScreenLoader() {
  return (
    <View style={styles.loaderWrap}>
      <ActivityIndicator size="large" color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  sectionHidden: { display: "none" },
  loaderWrap: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  // See handleExitPlayer's own comment - deliberately no backgroundColor at all here.
  exitTransitionOverlay: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 10 },
});
