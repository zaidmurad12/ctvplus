import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ActivityIndicator,
  Dimensions,
  NativeEventEmitter,
  NativeModules,
  StyleSheet,
  findNodeHandle,
} from "react-native";
import { ChevronUp, ChevronDown } from "lucide-react-native";
import type { Movie } from "../api";
import { fetchMoviesPage } from "../api";
import MovieCard, { CARD_TOTAL_WIDTH_LARGE } from "../components/MovieCard";
import Focusable from "../components/Focusable";
import { colors, font } from "../theme";
import { s, fs } from "../scale";
import { Lang, languageName, genreName } from "../i18n";
import { useSidebarHomeHandle } from "../focusRefs";
import { loadJson, saveJson, storageKeys } from "../storage";

// Past the sidebar's own 88px column. Was s(176) (extra clearance for a card focus-scale that
// crept under the sidebar) - reported as sitting too far from the sidebar; cards no longer scale
// on focus (see MovieCard), so that clearance isn't needed.
const GRID_START = s(120);
const GRID_END_PADDING = s(24);
const ROW_GAP = s(30);
// A fixed column count left a wide dead strip on the right on any screen wider than that
// assumed - filling the actual row width, whatever it is, is what makes the grid reach the
// edge of the screen instead of stopping partway across.
const GRID_ROW_WIDTH = Dimensions.get("window").width - GRID_START - GRID_END_PADDING;
const NUM_COLUMNS = Math.max(4, Math.floor(GRID_ROW_WIDTH / CARD_TOTAL_WIDTH_LARGE));
// Rounding the column count down left up to almost a whole card's width empty at the end of
// every row (reported as a big gap on the right, varying with screen and UI size). The cards now
// share that leftover instead: each is widened just enough that the row ends exactly at the edge.
// s(16) is the card's own horizontal margins (MovieCard's s(8) each side).
const CARD_WIDTH_FILL = Math.floor(GRID_ROW_WIDTH / NUM_COLUMNS) - s(16);

type SortKey = "newest" | "rating" | "views";
// The backend's own sort enum (queryHelpers.ts's SORT_FIELD) doesn't share this screen's own
// "views" label - "popularity" is its closest equivalent (the field this app's own most-watched
// sort has always meant in practice), and rating matches verbatim. "newest" here deliberately maps
// to the backend's own "releaseDate" sort, not its "newest" (createdAt/when-added-to-the-catalog)
// - the admin panel's own "newest" listing is meant to stay addition-date-based (useful there for
// spotting what was just imported), but this screen's own "الأحدث" is viewer-facing and means
// newest *release*: a title imported today but released years ago shouldn't show up first here.
// Matches api.ts's own fetchMovies() (Home's "Recent" rail), which already made this same
// distinction for the identical reason.
const SORT_KEY_TO_BACKEND: Record<SortKey, "releaseDate" | "rating" | "popularity"> = {
  newest: "releaseDate",
  rating: "rating",
  views: "popularity",
};
const PAGE_LIMIT = 50;
// The very first page of a filter combination fetches more than a normal page (see loadPage's own
// use of this below) - knownGenresRef/knownLanguagesRef only ever learn what's actually loaded
// (see their own comment), so a plain 50-item first page reliably found most genres (most titles
// carry several) but often missed a language the catalog carries only a minority of - reported as
// the language stepper not appearing at all until some unrelated later filter change happened to
// fetch a page that included one. A wider first page (still just one request, still real items
// that render in the grid, not a throwaway sample) gives that discovery a meaningfully better
// chance without adding a second fetch or any backend change.
// Capped at 100, not something bigger like 150 - the backend's own PaginationQueryDto rejects any
// `limit` over 100 (@Max(100)) with a validation error, which made the very first request for
// *every* Movies/Series load fail outright (reported as the whole screen failing to load) the one
// time this was set higher than that server-side ceiling.
const FIRST_PAGE_LIMIT = 100;
// How close to the bottom (in px of remaining scroll content) triggers loading the next page -
// this screen's own replacement for FlatList's onEndReachedThreshold, now that the grid is a
// plain ScrollView (see rows/scrollToRow's own comment for why). Generous on purpose - this is
// also what triggers renderedRowCount's own growth (see its comment below), and a D-pad press
// held down can move through several rows faster than a single scrollEventThrottle tick, so this
// needs enough runway to grow the mounted set well before a fast descent could actually reach the
// end of what's currently rendered.
const PAGE_END_THRESHOLD = 1200;
// A row further than this from the currently-focused row doesn't render its own Image yet (see
// IMAGE_REVEAL_RADIUS's own use in Row below) - the actual fix for this screen's general
// slowness/stutter complaint, see rowOffsets/scrollToRow's own comment for the full story of why
// re-virtualizing the grid itself (tried once, reverted) was the wrong way to get there.
// Was 10 - with NUM_COLUMNS typically ~12 on a 1080p/4K TV, that kept a 21-row (~250-image)
// window of decoded posters resident at once, all still fully mounted (never unmounted, see
// gridScrollRef's own comment on why virtualizing the rows themselves isn't an option here) -
// every row scrolled past both decodes ~12 new bitmaps and keeps the ones leaving the window
// alive rather than freeing them, a real concurrent-decode/GPU-upload cost during a fast scroll,
// reported as stutters specifically while scrolling the grid. A tighter window still prefetches
// comfortably beyond the visible rows without paying for a screenful of rows nobody's about to
// see yet.
const IMAGE_REVEAL_RADIUS = 3;
// How long after focus lands on a new row before the screen commits to it (see focusedRow above) -
// about one native smooth-scroll animation.
const ROW_SETTLE_MS = 300;
// How many rows are actually mounted at once - see renderedRowCount's own comment below for why
// this exists at all (every row stays mounted forever once rendered, same as everywhere else on
// this screen; this only caps how many get mounted *in one go*, growing the same way pagination
// already does as the viewer scrolls further).
const INITIAL_ROWS = 24;
const ROWS_PER_BATCH = 24;

// See VideoPlayer.tsx's own identical helper (word-for-word, not shared only because the two
// files don't otherwise import from each other) for the full reasoning: an imperative .focus()
// call made right as a key/render cycle is still settling can lose the race and land on nothing
// at all, even though the exact same call succeeds a moment later - a single requestAnimationFrame
// defer (tried first here, for both the up and down filter-bar transitions) cut that down but
// didn't eliminate it, reported as "still hard to reach the filter row." Retrying a few times with
// backoff is cheap insurance once something's already focused, a later call on the same view is a
// harmless no-op.
function retryFocus(ref: React.RefObject<any>, attempts = 5, firstDelay = 40, step = 120): () => void {
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

interface Props {
  title: string;
  type: "movie" | "series";
  lang?: Lang;
  emptyLabel?: string;
  onSelect: (movie: Movie) => void;
}

// Loads 50 titles at a time (via /api/movies/list) instead of the screen needing this type's
// *entire* catalog in memory just to show a grid the viewer might only scroll a few rows into
// - reaching the end of what's loaded so far fetches the next page automatically. Picking a
// genre/language filter or a non-default sort is the one case that still needs everything:
// filtering or globally sorting a set that's only partially loaded would silently miss titles
// still sitting on later pages, so those two actions load whatever pages remain first.
export default function BrowseScreen({ title, type, lang = "ar", emptyLabel, onSelect }: Props) {
  const homeHandle = useSidebarHomeHandle();
  // Same big landscape banner the home screen's own hero uses, showing whichever card in the
  // grid below currently has focus (see MovieCard's own onFocusChange further down) - a big
  // static poster/backdrop up top instead of jumping straight into a wall of small cards.
  // Only the focused ROW is state (not the exact card): a left/right move inside a row must not
  // re-render this whole screen, and even a row change is committed only after the scroll animation
  // has had time to finish - re-rendering (and mounting newly-revealed rows' images) in the middle of
  // that animation is what made vertical scrolling stutter.
  const [focusedRow, setFocusedRow] = useState(0);
  const focusedRowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (focusedRowTimerRef.current) clearTimeout(focusedRowTimerRef.current);
  }, []);
  // The very first grid card - FilterBar's own onEscapeDown below imperatively focuses this
  // directly (a single, one-time boundary call - see FilterBar's own top comment on why that
  // shape is safe where a *repeated* one wasn't) to reach the grid in one press from the filter
  // row above. Also what makes entering this screen from the sidebar land straight on the first
  // movie card (hasTVPreferredFocus on the card itself below) instead of Android's own
  // initial-focus guess occasionally preferring the filter row instead.
  const firstCellRef = useRef<View>(null);
  // FilterBar's own Focusable. Up-escape (row 0 -> filter bar) used to be JS-owned - native key
  // capture (upEscapeActive) plus an imperative retryFocus(filterBarRef) - and was confirmed, via
  // on-device diagnostic toasts, to reliably reach this ref (non-null) and reliably fire the retry
  // loop, yet still never actually move real focus. That capture flag returns `true`
  // unconditionally from MainActivity's dispatchKeyEvent (see KeyEventBridgeModule.upEscapeActive),
  // meaning the key never even reached Android's own native focus-search engine - a structurally
  // different (and, elsewhere in this exact app - nextFocusLeft to the sidebar, row-to-row within
  // this same grid - already reliable) path from imperative .focus(). filterBarHandle below
  // resolves this ref to a real native view-tag once FilterBar has mounted, wired as nextFocusUp
  // on every row-0 card, letting Android's own focus engine (not JS) make this jump instead.
  const filterBarRef = useRef<View>(null);
  // findNodeHandle needs a real mounted node, which doesn't exist until after first render - same
  // one-shot bump pattern VideoPlayer.tsx's own focusHandles/bumpFocusHandles uses, so this
  // resolves once right after FilterBar mounts instead of forever returning undefined.
  const [filterBarHandleBump, bumpFilterBarHandle] = useState(0);
  const filterBarBumpedRef = useRef(false);
  const setFilterBarRef = useRef((node: View | null) => {
    filterBarRef.current = node;
    if (node && !filterBarBumpedRef.current) {
      filterBarBumpedRef.current = true;
      bumpFilterBarHandle((b) => b + 1);
    }
  }).current;
  const filterBarHandle = useMemo(
    () => findNodeHandle(filterBarRef.current) ?? undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterBarHandleBump]
  );
  // onEscapeDown (filter bar -> grid) still uses this - that direction's own down key is captured
  // for an unrelated, unavoidable reason (dpadNavActive must own all four directions while the
  // filter bar is focused, to distinguish "cycle this stepper's value" from "leave the row" in JS
  // - see FilterBar's own top comment), so unlike up above, that specific keypress is already fully
  // consumed before a native nextFocusDown could ever see it. Not reported broken, left as-is.
  const pendingFocusRetryRef = useRef<(() => void) | null>(null);

  // Navigation rebuild: this grid used to be one FlatList in numColumns mode, with its own
  // vertical scroll driven either by a reactive scrollToOffset correction or by explicit
  // nextFocusUp node routing - both left up/down between rows needing an extra press, and two
  // separate attempts at capturing the key entirely in JS and moving focus imperatively made it
  // measurably *worse* ("loses control a lot, hard to navigate"), not better, on this hardware.
  //
  // HomeScreen's own rail-to-rail navigation has never had any of these problems: each row's
  // absolute position is measured directly via its own onLayout (never computed by multiplying an
  // assumed row height, which compounds any small measurement error further with every row), a
  // scroll is triggered reactively from focus with a named guard against re-triggering
  // mid-animation, and - critically - there's *no* interception of the up/down key at all between
  // rows, just Android's own ordinary focus search. `rows` below chunks the flat list into one row
  // per NUM_COLUMNS items (plain Views, not FlatList's own internal numColumns wrapping) so each
  // row is a real component with its own onLayout, and rowOffsets/scrollToRow mirror Home's own
  // railOffsets/scrollToRail verbatim.
  //
  // A plain ScrollView here (as below), not a FlatList - a FlatList-of-rows was tried once instead
  // (to virtualize this screen's own unbounded, paginated catalog, unlike Home's bounded rails)
  // and reverted: it reported as *worse* than the reactive/nextFocusUp attempts before it -
  // focused cards going invisible, control getting lost, two-plus presses needed again. FlatList
  // only knows an item's real position once that item has actually laid out and reported it - a
  // still-unmeasured item below the current scroll position is estimated, not exact, and
  // scrollToOffset landing against a still-shifting estimate is exactly the kind of drift a plain
  // ScrollView never has (every onLayout position it ever reports is already exact and stable,
  // since nothing here is ever unmounted to be re-estimated later). This screen's own general
  // slowness/stutter complaint is real, but the fix for it is IMAGE_REVEAL_RADIUS below (Row keeps
  // every row mounted for reliable navigation, only defers each Image itself), not virtualizing
  // the rows/scroll mechanism this comment already explains was rebuilt specifically to avoid.
  const gridScrollRef = useRef<any>(null);
  const rowOffsets = useRef<number[]>([]);
  const lastScrolledRow = useRef<number | null>(null);
  const scrollToRow = useCallback((row: number) => {
    if (lastScrolledRow.current === row) return;
    lastScrolledRow.current = row;
    const y = rowOffsets.current[row];
    if (y != null) gridScrollRef.current?.scrollTo({ y: Math.max(0, y - ROW_GAP), animated: true });
  }, []);

  const [genre, setGenre] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  // The viewer's genre/language/sort choices are remembered per type (Movies and Series each keep their
  // own) and restored on the next visit - even across app restarts - and only ever change when the
  // viewer changes them by hand. `filtersType` is the type whose saved filters are currently applied;
  // nothing is fetched or saved until it matches `type`, so a stale set from the other type can neither
  // trigger a request nor overwrite a saved entry.
  const [filtersType, setFiltersType] = useState<"movie" | "series" | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFiltersType(null);
    loadJson<{ genre: string | null; language: string | null; sortBy: SortKey; genres?: string[]; languages?: string[] }>(`${storageKeys.browseFilters}.${type}`, {
      genre: null,
      language: null,
      sortBy: "newest",
    }).then((saved) => {
      if (cancelled) return;
      setGenre(saved.genre ?? null);
      setLanguage(saved.language ?? null);
      setSortBy(saved.sortBy ?? "newest");
      // The genre/language choices seen on earlier visits come back too: with a filter restored, the
      // first page only contains titles matching it, so the options couldn't be rediscovered from it -
      // the viewer would have no way to pick a different one without first clearing this one.
      knownGenresRef.current = new Set(saved.genres ?? []);
      knownLanguagesRef.current = new Set(saved.languages ?? []);
      prevTypeRef.current = type;
      forceOptionsUpdate((v) => v + 1);
      setFiltersType(type);
    });
    return () => {
      cancelled = true;
    };
  }, [type]);

  const [items, setItems] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  // Refs, not state, drive the fetch loop itself - state closures captured once per render go
  // stale across repeated awaited calls inside the same effect (e.g. the "load everything for
  // this filter" loop below), which would otherwise re-check the *pre-loop* page/hasMore/loading
  // values on every iteration instead of what the previous iteration actually just fetched.
  // hasMore itself is only ever read here (never rendered), so it stays a ref only - an earlier
  // version also mirrored it into state for no reason, forcing an extra re-render of this whole
  // screen on every single page fetch.
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  // Bumped by the reset effect below on every genre/language/sort/type change - a pagination
  // fetch already in flight *at that moment* (started by scrolling, just before the filter
  // changed) has no way to know it's now stale by the time its own await resolves. Without this,
  // that stale response's own setItems/pageRef/hasMoreRef writes land *after* the reset effect
  // already cleared everything for the new filter - silently appending the OLD filter's movies
  // onto the NEW filter's (just-cleared) grid, and scrambling pageRef/hasMoreRef with values
  // computed for a request that's no longer the one being shown. Reported as the screen
  // freezing/losing all control (a race that left `items` empty with nothing left to focus, since
  // the *new* filter's own loadPage() call had already found loadingRef still true from the stale
  // fetch and silently no-op'd) or exiting outright - both exactly the shape of bug a stale-response
  // race produces. Every read/write of loadingRef/items/pageRef/hasMoreRef inside loadPage below is
  // now guarded against the epoch having moved on while it was awaiting.
  const fetchEpochRef = useRef(0);

  const loadPage = async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const epoch = fetchEpochRef.current;
    try {
      // The server computes its own skip as (page-1)*limit *using this request's own limit* (see
      // the backend's queryHelpers.ts resolveSkip) - pageRef always counts in units of PAGE_LIMIT
      // (never FIRST_PAGE_LIMIT), so a request's own `page` number still lines up on the right
      // item regardless of which limit that one request happens to use. FIRST_PAGE_LIMIT must stay
      // an exact multiple of PAGE_LIMIT (150 = 3x50) for that arithmetic to land on an exact page
      // boundary - using a mismatched pair here would silently re-fetch (duplicate keys in the
      // grid) or skip a run of items right after the first page.
      const isFirstFetch = pageRef.current === 0;
      const limit = isFirstFetch ? FIRST_PAGE_LIMIT : PAGE_LIMIT;
      const page = isFirstFetch ? 1 : pageRef.current + 1;
      const data = await fetchMoviesPage(type, page, limit, SORT_KEY_TO_BACKEND[sortBy], language ?? undefined, genre ?? undefined);
      // A newer filter/sort/type change reset everything for a different request while this one
      // was still in flight - this response no longer belongs to what's on screen, discard it.
      if (epoch !== fetchEpochRef.current) return;
      // Skips anything an earlier page already delivered - offset paging over a sort with ties
      // (same release date/rating) could hand the same title back on a later page, reported as
      // "lots of duplicated titles." The backend now breaks ties by id too; this keeps the grid
      // clean regardless.
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...data.items.filter((m) => !seen.has(m.id) && seen.add(m.id))];
      });
      pageRef.current = isFirstFetch ? FIRST_PAGE_LIMIT / PAGE_LIMIT : pageRef.current + 1;
      hasMoreRef.current = data.hasMore;
    } catch (err) {
      console.error("[BrowseScreen] fetchMoviesPage failed:", err);
    } finally {
      if (epoch === fetchEpochRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  };

  // Genre/language stepper *options* accumulate across filter changes now, instead of being
  // derived fresh from `items` every time - now that both are server-filtered (see loadPage's own
  // comment), `items` is only ever whatever narrower set the current filter combination matches,
  // and deriving the stepper's own list of what's *selectable* from that would permanently
  // collapse it down to whatever's currently shown, with no way back to any other option. Reset
  // only when `type` itself changes (Movies and Series don't share the same genres/languages),
  // never on a genre/language/sort change alone.
  const knownGenresRef = useRef(new Set<string>());
  const knownLanguagesRef = useRef(new Set<string>());
  const prevTypeRef = useRef(type);
  // The discovery effect below mutates the two Sets above *in place* and bumps this to signal a
  // real change - genres/languages further down deliberately key off *this*, not off `items`.
  // Keying off `items` instead (as an earlier version did) meant the very first successful page
  // load never actually surfaced anything: that render already reads the Sets while they're still
  // empty (population happens in the discovery effect, which only runs *after* this render
  // commits), and the forced re-render the discovery effect triggers afterward still finds
  // `items` itself unchanged since nothing re-fetched - so a useMemo keyed on `items` alone skips
  // recomputing and keeps returning its stale, empty result. Reported as the language stepper
  // never appearing and the genre stepper stuck on "All" (its only option) right after opening
  // the screen, both correcting themselves only once an unrelated filter/sort change forced a
  // genuinely new `items` array to be fetched - at which point the Sets, already populated from
  // the *first* load's own (until-then-invisible) discovery, finally got read.
  const [optionsVersion, forceOptionsUpdate] = useState(0);
  useEffect(() => {
    if (filtersType !== type) return;
    saveJson(`${storageKeys.browseFilters}.${type}`, {
      genre,
      language,
      sortBy,
      genres: Array.from(knownGenresRef.current),
      languages: Array.from(knownLanguagesRef.current),
    });
  }, [filtersType, type, genre, language, sortBy, optionsVersion]);

  // Resets and refetches from page 1 whenever this screen switches between Movies and Series, a
  // sort is picked, or a genre/language filter changes - sort/language/genre are all passed
  // straight to the server now (see fetchMoviesPage's own comment), so every combination of these
  // is just one fast, already-correct page 1 request, never the "load the entire remaining
  // catalog to filter/sort it client-side" this screen used to need for any of the three.
  useEffect(() => {
    if (filtersType !== type) return; // saved filters for this type not applied yet - see filtersType
    // See fetchEpochRef's own comment above - invalidates whatever pagination fetch might still
    // be in flight from before this change, and frees loadingRef so the new loadPage() call just
    // below doesn't find it still held by that now-abandoned fetch and silently no-op.
    fetchEpochRef.current += 1;
    loadingRef.current = false;
    setItems([]);
    pageRef.current = 0;
    hasMoreRef.current = true;
    if (prevTypeRef.current !== type) {
      knownGenresRef.current = new Set();
      knownLanguagesRef.current = new Set();
      prevTypeRef.current = type;
      forceOptionsUpdate((v) => v + 1);
    }
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, genre, language, sortBy, filtersType]);

  // Discovers new genres/languages as pages load, adding them to the accumulating sets above
  // rather than replacing them - see those refs' own comment for why.
  useEffect(() => {
    let changed = false;
    items.forEach((m) => {
      m.genres?.forEach((g) => {
        if (!knownGenresRef.current.has(g)) {
          knownGenresRef.current.add(g);
          changed = true;
        }
      });
      if (m.language && !knownLanguagesRef.current.has(m.language)) {
        knownLanguagesRef.current.add(m.language);
        changed = true;
      }
    });
    if (changed) forceOptionsUpdate((v) => v + 1);
  }, [items]);

  const genres = useMemo(() => {
    const list = Array.from(knownGenresRef.current);
    return genre && !list.includes(genre) ? [...list, genre] : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsVersion, genre]);
  // Arabic, English, Turkish always lead (right after "All"), the rest follow alphabetically by
  // their displayed name - instead of whatever order the catalog's pages happened to surface them.
  const languages = useMemo(() => {
    const priority = ["ar", "en", "tr"];
    const rank = (code: string) => {
      const index = priority.indexOf(code.toLowerCase().trim());
      return index === -1 ? priority.length : index;
    };
    const known = Array.from(knownLanguagesRef.current);
    if (language && !known.includes(language)) known.push(language);
    return known.sort(
      (a, b) => rank(a) - rank(b) || languageName(a, lang).localeCompare(languageName(b, lang))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsVersion, lang, language]);

  // No client-side sort or language filter anymore - `items` already arrives in the requested
  // order, and (for movies - see loadPage/the bulk-load effect above) already filtered to the
  // requested language, straight from the server. Genre is still applied here since it has no
  // server-side equivalent at all.
  // The language filter here is a safety net, not the primary mechanism - the request already
  // asks the server for this exact language (see loadPage/the bulk-load effect above), so this
  // is normally a no-op pass over an already-correct set. It matters for TV shows specifically:
  // the shows endpoint's own backend support for this filter is code-complete but not yet
  // deployed as of this build (see showQueryRepository.ts's own buildWhere) - until it is, the
  // server silently ignores `language` for shows and returns every language regardless, which
  // this still narrows down correctly client-side in the meantime. Safe to leave in place even
  // after that deploys ships - filtering an already-filtered set changes nothing.
  const filtered = useMemo(() => {
    let list = items;
    if (genre) list = list.filter((m) => m.genres?.includes(genre));
    if (language) list = list.filter((m) => m.language === language);
    return list;
  }, [items, genre, language]);

  const sortLabels: Record<SortKey, string> = {
    newest: lang === "ar" ? "الأحدث" : "Newest",
    rating: lang === "ar" ? "الأعلى تقييماً" : "Top Rated",
    views: lang === "ar" ? "الأكثر مشاهدة" : "Most Watched",
  };

  const allLabel = lang === "ar" ? "الكل" : "All";
  // One plain array driving FilterBar below instead of three separately-wired FilterStepper
  // instances each needing to know its own left/right neighbor by ref - see FilterBar's own
  // comment on why that real-focus handoff between siblings turned out to be the actual cause of
  // "pressing a filter button loses control of the page completely."
  const filterSteppers = useMemo(
    () => [
      {
        key: "genre",
        label: lang === "ar" ? "التصنيف" : "Genre",
        options: [{ key: "__all", label: allLabel }, ...genres.map((g) => ({ key: g, label: genreName(g, lang) }))],
        selectedKey: genre ?? "__all",
        onChange: (k: string) => setGenre(k === "__all" ? null : k),
      },
      ...(languages.length > 1 || !!language
        ? [
            {
              key: "language",
              label: lang === "ar" ? "اللغة" : "Language",
              options: [{ key: "__all", label: allLabel }, ...languages.map((l) => ({ key: l, label: languageName(l, lang) }))],
              selectedKey: language ?? "__all",
              onChange: (k: string) => setLanguage(k === "__all" ? null : k),
            },
          ]
        : []),
      {
        key: "sort",
        label: lang === "ar" ? "الترتيب" : "Sort",
        options: (["newest", "rating", "views"] as SortKey[]).map((k) => ({ key: k, label: sortLabels[k] })),
        selectedKey: sortBy,
        onChange: (k: string) => setSortBy(k as SortKey),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [genre, language, sortBy, genres, languages, lang]
  );

  // Chunked into rows once here (a plain array of arrays), not left as FlatList's own internal
  // numColumns wrapping - rendering each row as a real component with its own onLayout is what
  // rowOffsets above needs to measure an absolute position per row, the same thing HomeScreen's
  // own railBlock onLayout does per rail.
  const rows = useMemo(() => {
    const out: Movie[][] = [];
    for (let i = 0; i < filtered.length; i += NUM_COLUMNS) out.push(filtered.slice(i, i + NUM_COLUMNS));
    return out;
  }, [filtered]);

  // Applying *any* genre/language filter loads the catalog's entire remaining pages into `items`
  // up front (see that effect's own comment above) - clearing a filter back to "All" then hands
  // `rows` potentially hundreds of rows in one go, which used to mean mounting all of them (every
  // row here stays mounted forever, see gridScrollRef's own comment on why) in a single
  // synchronous render the instant that filter change committed, reported as losing control and
  // the app exiting outright. renderedRowCount caps how many of `rows` actually render at once,
  // growing the same way pagination already does as the viewer scrolls further (see onGridScroll
  // below) rather than ever mounting the full set immediately - it only ever grows, never shrinks,
  // so a row that's already mounted is never later removed (the exact property that makes
  // rowOffsets/scrollToRow reliable in the first place). Resetting it back down on every filter/
  // sort/type change is what keeps a sudden much-larger `rows` array from mounting all at once
  // just because the underlying data already happened to be fully loaded already.
  const [renderedRowCount, setRenderedRowCount] = useState(INITIAL_ROWS);
  useEffect(() => {
    setRenderedRowCount(INITIAL_ROWS);
  }, [type, genre, language, sortBy]);
  const renderedRows = rows.length > renderedRowCount ? rows.slice(0, renderedRowCount) : rows;

  // One shared callback for every row (its own behavior never depends on *which* row, only "did
  // one of its cards just gain focus") - stable via useCallback and passed the same reference to
  // every Row below, the same reasoning Home's own handleCardFocusChange uses, so a fresh
  // per-row closure here never becomes a reason for Row's own React.memo to consider its props
  // "changed".
  const handleCardFocusChange = useCallback(
    (rowIndex: number, _colIndex: number, focused: boolean) => {
      if (!focused) return;
      scrollToRow(rowIndex);
      if (focusedRowTimerRef.current) clearTimeout(focusedRowTimerRef.current);
      focusedRowTimerRef.current = setTimeout(() => setFocusedRow(rowIndex), ROW_SETTLE_MS);
    },
    [scrollToRow]
  );
  const onRowLayout = useCallback((rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => {
    rowOffsets.current[rowIndex] = e.nativeEvent.layout.y;
  }, []);

  // loadPage itself closes over `type`, which can change without this screen ever remounting
  // (see this component's own top comment) - a ref mirror, read at scroll time, is what keeps
  // onGridScroll below from calling a stale closure stuck on whatever `type` was current the one
  // time it was first created.
  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;
  // rows.length itself doesn't need a ref mirror the same way - it's read fresh on every render
  // this closure is recreated for anyway (rows is a dependency below), unlike loadPage which is
  // deliberately *not* a dependency (see its own comment).
  const onGridScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      if (contentOffset.y + layoutMeasurement.height < contentSize.height - PAGE_END_THRESHOLD) return;
      loadPageRef.current();
      // See renderedRowCount's own comment above - reveals more of what's already loaded first,
      // the same "grow, never shrink" way pagination itself already works.
      setRenderedRowCount((n) => (n < rows.length ? n + ROWS_PER_BATCH : n));
    },
    [rows.length]
  );

  const renderRow = (rowItems: Movie[], rowIndex: number) => (
    <Row
      key={rowIndex}
      items={rowItems}
      rowIndex={rowIndex}
      lang={lang}
      onSelect={onSelect}
      homeHandle={homeHandle}
      onCardFocusChange={handleCardFocusChange}
      onRowLayout={onRowLayout}
      revealImages={Math.abs(rowIndex - focusedRow) <= IMAGE_REVEAL_RADIUS}
      firstCellRef={rowIndex === 0 ? firstCellRef : undefined}
      nextFocusUp={rowIndex === 0 ? filterBarHandle : undefined}
    />
  );

  return (
    <View style={styles.root}>
      {/* Title on the sidebar side, filters pushed to the opposite (far) side - both sit right at
          the top of the page now that the banner above them (which used to reflect whichever
          card had focus) is gone, per explicit request. */}
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <View style={styles.titleBar} />
          <Text style={styles.title}>{title}</Text>
        </View>

        <FilterBar
          ref={setFilterBarRef}
          steppers={filterSteppers}
          onEscapeDown={() => {
            // See retryFocus's own comment above, and pendingFocusRetryRef's own comment on why
            // this shares that same slot with the up-escape effect rather than running its own
            // independent retry loop.
            pendingFocusRetryRef.current?.();
            pendingFocusRetryRef.current = retryFocus(firstCellRef);
          }}
        />
      </View>

      {!loading && filtered.length === 0 && !!emptyLabel && (
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      )}

      {/* Plain, non-virtualized ScrollView - see gridScrollRef's own comment above for why.
          Fetches the next 50-title page once the viewer scrolls within PAGE_END_THRESHOLD of the
          bottom of what's loaded so far - this screen's own replacement for FlatList's
          onEndReached. */}
      <ScrollView
        ref={gridScrollRef}
        onScroll={onGridScroll}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
        // See HomeScreen's own scrollsChildToFocus comment - the native focus jump fights the animated scrollTo.
        scrollsChildToFocus={false}
        contentContainerStyle={styles.grid}
      >
        {renderedRows.map(renderRow)}
        {loading && <ActivityIndicator color="#fff" style={styles.loadingFooter} />}
      </ScrollView>
    </View>
  );
}

// One row's worth of cards - a real component (not inlined in BrowseScreen's own .map()) so its
// own onLayout can report this specific row's absolute position (see rowOffsets/scrollToRow's own
// comment above), and so React.memo actually has something stable to compare: BrowseScreen passes
// every prop here as a stable reference (rowIndex/items are fixed per row instance, everything
// else is a useCallback from the parent), so a row only ever re-renders when its own real content
// changes, not on every unrelated focus change elsewhere in the grid - the same reasoning Home's
// own Rail component is built on, and for the same reason (a full re-render audit found a fresh
// renderItem/closure per cell was previously forcing every mounted card to re-render on every
// single focus change anywhere on the screen).
const Row = React.memo(function Row({
  items,
  rowIndex,
  lang,
  onSelect,
  homeHandle,
  onCardFocusChange,
  onRowLayout,
  revealImages,
  firstCellRef,
  nextFocusUp,
}: {
  items: Movie[];
  rowIndex: number;
  lang: Lang;
  onSelect: (movie: Movie) => void;
  homeHandle?: number | null;
  onCardFocusChange: (rowIndex: number, colIndex: number, focused: boolean) => void;
  onRowLayout: (rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => void;
  // See IMAGE_REVEAL_RADIUS's own comment above - every row stays mounted regardless (that's
  // what keeps navigation reliable for an unbounded catalog, see gridScrollRef's own comment on
  // why virtualizing the rows themselves was tried and reverted instead), only each row's own
  // Image is deferred while it's far from the currently-focused row, the actual expensive part
  // (network fetch + decode + GPU upload) that was making this screen feel slow the more pages
  // loaded in.
  revealImages: boolean;
  firstCellRef?: React.RefObject<View | null>;
  // Only set for row 0 (see renderRow) - the filter bar's own real node handle, so pressing up
  // from anywhere in the first row hands off to Android's native focus search instead of the
  // JS-owned capture+imperative-focus mechanism this replaced (see filterBarHandle's own comment
  // in BrowseScreen for why that was confirmed unreliable specifically for this transition).
  nextFocusUp?: number;
}) {
  return (
    <View style={styles.row} onLayout={(e) => onRowLayout(rowIndex, e)}>
      {items.map((movie, colIndex) => (
        <MovieCard
          key={movie.id}
          ref={rowIndex === 0 && colIndex === 0 ? firstCellRef : undefined}
          movie={movie}
          lang={lang}
          onSelect={onSelect}
          onFocusChange={(f) => onCardFocusChange(rowIndex, colIndex, f)}
          nextFocusLeft={colIndex === 0 ? homeHandle ?? undefined : undefined}
          nextFocusUp={nextFocusUp}
          hasTVPreferredFocus={rowIndex === 0 && colIndex === 0}
          showImage={revealImages}
          width={CARD_WIDTH_FILL}
        />
      ))}
    </View>
  );
});

// Replaces the old per-stepper open/close dropdown, then a later per-stepper cycling design,
// entirely - this is now ONE single native Focusable spanning the whole filter row, with which
// stepper is "active" (genre/language/sort) tracked as plain JS state instead of as real Android
// focus on N separate Pressables. The previous per-stepper design still moved real focus *between*
// steppers via imperative leftRef/rightRef.focus() calls - the exact mechanism the video player's
// own KeyEventBridgeModule.kt doc comment already flags as unreliable on this hardware ("real
// Android focus... has proven unreliable... in every shape it's been tried"), and reported here as
// "pressing a filter button loses control of the page completely." With only one real Pressable in
// the whole row, switching steppers can never lose real focus to a `.focus()` call that silently
// didn't land - there's nothing to hand off to, only a plain index in state. The one real,
// unavoidable focus handoff left - leaving the row downward into the grid - is a single, one-time
// boundary call (see onEscapeDown/firstCellRef in BrowseScreen), not a repeated one between equally
// valid siblings, which is a far safer shape for the same primitive.
//
// The chevrons are decorative only (pointerEvents="none", exactly like EpisodeRow's own
// seasonIndicator) - per explicit request, this is controlled purely through the remote's own
// up/down, never by navigating onto a separate arrow. Stock RN exposes no JS-level way to tell a
// bare focus-move apart from an actual key press, so this reuses the exact same native bridge
// (KeyEventBridgeModule.dpadNavActive/onNavKey) VideoPlayer.tsx's own controls already rely on
// for the same reason. dpadNavActive is on for as long as this row is focused at all (not just
// once `activated`) - left/right needs to move the JS-tracked active stepper even before OK is
// pressed, since there's no second real Pressable for Android's own focus search to find. up/down
// while merely focused (not activated) are what actually leave the row: down escapes to the grid
// in one press, up is a no-op (nothing sits above this row). Once `activated` (an OK press), up/
// down instead cycle a *local preview* of the active stepper's value (see previewKey) rather than
// calling its real onChange immediately - cycling used to commit (and reload the grid) on every
// single up/down press while just browsing options, which is both a lot of unnecessary reloading
// and, combined with the "load everything remaining" effect a genre/language/sort change kicks
// off, exactly what made rapid cycling feel like it lost control. Only a second OK press (turning
// `activated` back off) actually commits the preview and applies it; leaving the stepper any other
// way (left/right to a sibling, escaping down, losing focus) discards it instead.
const FilterBar = React.forwardRef<
  View,
  {
    steppers: { key: string; label: string; options: { key: string; label: string }[]; selectedKey: string; onChange: (key: string) => void }[];
    onEscapeDown: () => void;
  }
>(function FilterBar({ steppers, onEscapeDown }, ref) {
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activated, setActivated] = useState(false);
  // Only meaningful while activated - the option the active stepper would show/commit if OK were
  // pressed right now, independent of its real (committed) selectedKey until that actually
  // happens.
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  // The language stepper can appear/disappear as the catalog loads (only shown once more than one
  // language is present) - clamps the active index back onto whatever's left if it was pointing
  // past the end.
  useEffect(() => {
    if (activeIndex >= steppers.length) setActiveIndex(Math.max(0, steppers.length - 1));
  }, [steppers.length, activeIndex]);

  // Losing real focus entirely (BACK, or the escape-down call itself) shouldn't leave this
  // silently armed for whenever focus happens to land back on the row later, and any pending
  // preview along with it is abandoned, not committed.
  useEffect(() => {
    if (!focused) {
      setActivated(false);
      setPreviewKey(null);
    }
  }, [focused]);

  const stateRef = useRef({ activeIndex, activated, steppers, previewKey });
  useEffect(() => {
    stateRef.current = { activeIndex, activated, steppers, previewKey };
  });

  const cyclePreview = (delta: number) => {
    const { activeIndex: i, steppers: st, previewKey: preview } = stateRef.current;
    const stepper = st[i];
    if (!stepper || stepper.options.length === 0) return;
    const currentKey = preview ?? stepper.selectedKey;
    const optIndex = Math.max(0, stepper.options.findIndex((o) => o.key === currentKey));
    const next = (optIndex + delta + stepper.options.length) % stepper.options.length;
    setPreviewKey(stepper.options[next].key);
  };

  // OK toggles activation - opening it seeds the preview from the real committed value, closing
  // it commits whatever the preview ended up on (only actually calling onChange, and so only
  // actually reloading anything, if it differs from what's already applied).
  const toggleActivated = () => {
    const { activeIndex: i, activated: on, steppers: st, previewKey: preview } = stateRef.current;
    if (on) {
      const stepper = st[i];
      if (stepper && preview != null && preview !== stepper.selectedKey) {
        stepper.onChange(preview);
      }
      setPreviewKey(null);
      setActivated(false);
    } else {
      setPreviewKey(st[i]?.selectedKey ?? null);
      setActivated(true);
    }
  };

  useEffect(() => {
    if (!focused) return;
    const { KeyEventBridge } = NativeModules;
    KeyEventBridge?.setDpadNavActive(true);
    const emitter = new NativeEventEmitter(KeyEventBridge);
    const sub = emitter.addListener("onNavKey", (event: any) => {
      const { direction, action } = event as { direction: "up" | "down" | "left" | "right"; action: "down" | "up" };
      if (action !== "down") return;
      const { activeIndex: i, activated: on, steppers: st } = stateRef.current;
      if (on) {
        if (direction === "up") cyclePreview(-1);
        else if (direction === "down") cyclePreview(1);
        else if (direction === "left") {
          // Leaving without a second OK press abandons the preview, doesn't commit it.
          setPreviewKey(null);
          setActivated(false);
          setActiveIndex(Math.max(0, i - 1));
        } else if (direction === "right") {
          setPreviewKey(null);
          setActivated(false);
          setActiveIndex(Math.min(st.length - 1, i + 1));
        }
      } else {
        if (direction === "left") setActiveIndex(Math.max(0, i - 1));
        else if (direction === "right") setActiveIndex(Math.min(st.length - 1, i + 1));
        else if (direction === "down") {
          // The one real focus handoff this row ever makes - see this component's own top
          // comment on why a single boundary call here is safe where per-stepper hops weren't.
          KeyEventBridge?.setDpadNavActive(false);
          onEscapeDown();
        }
        // up: nothing above this row to escape to - swallowed.
      }
    });
    return () => {
      sub.remove();
      KeyEventBridge?.setDpadNavActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  return (
    <Focusable ref={ref} onFocusChange={setFocused} onPress={toggleActivated} style={styles.filters} scaleTo={1}>
      {() => (
        <>
          {steppers.map((stepper, i) => {
            const isActiveStepper = i === activeIndex;
            const displayKey = isActiveStepper && activated && previewKey != null ? previewKey : stepper.selectedKey;
            return (
              <FilterStepperView
                key={stepper.key}
                label={stepper.label}
                value={stepper.options.find((o) => o.key === displayKey)?.label ?? ""}
                isActive={focused && isActiveStepper}
                isActivated={focused && activated && isActiveStepper}
              />
            );
          })}
        </>
      )}
    </Focusable>
  );
});

// Purely presentational - no Focusable/Pressable of its own, just paints whichever stepper
// FilterBar above currently considers active/activated. `isActivated` going from false to true is
// what plays the chevron bounce below (moving, not just changing color, is what was explicitly
// asked for as confirmation "control has become available" for this stepper specifically).
function FilterStepperView({
  label,
  value,
  isActive,
  isActivated,
}: {
  label: string;
  value: string;
  isActive: boolean;
  isActivated: boolean;
}) {
  const upBounce = useRef(new Animated.Value(0)).current;
  const downBounce = useRef(new Animated.Value(0)).current;
  const wasActivated = useRef(isActivated);
  useEffect(() => {
    if (isActivated && !wasActivated.current) {
      upBounce.setValue(0);
      downBounce.setValue(0);
      Animated.sequence([
        Animated.timing(upBounce, { toValue: 1, duration: 130, useNativeDriver: true }),
        Animated.spring(upBounce, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 10 }),
      ]).start();
      Animated.sequence([
        Animated.timing(downBounce, { toValue: 1, duration: 130, useNativeDriver: true }),
        Animated.spring(downBounce, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 10 }),
      ]).start();
    }
    wasActivated.current = isActivated;
  }, [isActivated, upBounce, downBounce]);

  const tint = isActive ? "#fff" : colors.textMuted;

  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperCategoryLabel}>{label}</Text>
      {/* No background/border at all, in either state - per explicit request, focus reads purely
          through the value/chevrons turning white (they're gray otherwise), not a filled pill. */}
      <View style={styles.stepperValueRow}>
        <Animated.View style={{ transform: [{ translateY: upBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -s(4)] }) }] }}>
          <ChevronUp size={s(12)} color={tint} strokeWidth={2.5} />
        </Animated.View>
        <Text numberOfLines={1} style={[styles.stepperValue, isActive && styles.stepperValueFocused]}>
          {value}
        </Text>
        <Animated.View style={{ transform: [{ translateY: downBounce.interpolate({ inputRange: [0, 1], outputRange: [0, s(4)] }) }] }}>
          <ChevronDown size={s(12)} color={tint} strokeWidth={2.5} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingLeft: GRID_START },
  // Sits directly at the top of the page now - see this screen's own top comment on why the
  // banner that used to live above it (with its own paddingTop pushing this row down under it)
  // is gone. Lowered again to 30 (was 44, briefly 26, then back to 44) - per explicit follow-up
  // request to raise this and the filter row to the sidebar's own logo level instead of lowering
  // the logo any further (see Sidebar.tsx's own `top`) - applied identically to Library/Search/
  // Settings too (see their own root/content padding) so all four sidebar-adjacent screens stay
  // at the same level as each other, not just as the logo.
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: s(24), paddingTop: s(30), paddingRight: s(32), zIndex: 20 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: s(10) },
  titleBar: { width: s(5), height: s(20), borderRadius: 3, backgroundColor: "#fff" },
  title: { color: "#fff", fontSize: fs(18), fontFamily: font.bold },
  filters: { flexDirection: "row", gap: s(28) },
  // Label beside the control (was above it) and the control itself has no background/border of
  // its own by default (was a filled/outlined pill) - per explicit request. The whole row is one
  // Focusable now (see FilterBar's own comment), so the color/chevron-motion treatment below is
  // applied per stepper purely from JS state (isActive/isActivated), not from each one owning its
  // own real focus.
  stepperRow: { flexDirection: "row", alignItems: "center", gap: s(8) },
  stepperCategoryLabel: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.bold },
  // No flexDirection (defaults to column) - chevron above, value, chevron below, matching the
  // video player's own season indicator shape.
  stepperValueRow: {
    alignItems: "center",
    gap: s(2),
    paddingHorizontal: s(8),
    paddingVertical: s(4),
    borderRadius: s(8),
  },
  // Gray by default, white on focus - the only focus indicator now (see FilterBar's own comment
  // on why there's no background/border at all here anymore).
  stepperValue: { color: colors.textMuted, fontSize: fs(13), fontFamily: font.bold, textAlign: "center" },
  stepperValueFocused: { color: "#fff" },
  emptyText: { color: colors.textFaint, fontSize: fs(14), fontFamily: font.semiBold, marginTop: s(40) },
  loadingFooter: { marginVertical: s(24) },
  grid: { paddingRight: s(24), paddingBottom: s(40), paddingTop: s(8) },
  row: { flexDirection: "row", marginBottom: ROW_GAP },
});
