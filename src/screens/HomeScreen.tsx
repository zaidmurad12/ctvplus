import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { View, Text, Image, ScrollView, StyleSheet, ActivityIndicator, Animated, Dimensions } from "react-native";
import LinearGradient from "react-native-linear-gradient";
import type { Category, Movie } from "../api";
import { posterUrl, HOME_ROW_MAX_ITEMS } from "../api";
import Focusable from "../components/Focusable";
import LogoImage from "../components/LogoImage";
import { colors, font, focusShadow, spacing } from "../theme";
import { s, fs } from "../scale";
import { Lang, countryName, genreName, pickText, t } from "../i18n";
import { useSidebarHomeHandle } from "../focusRefs";
import { useFocusClamp } from "../useFocusClamp";
import { useProgressiveReveal } from "../useProgressiveReveal";

// The server names this specific category "recent" (see server.ts's categories array) - kept
// first in the row order below, matching the emphasis it had as this screen's own hero before.
const RECENT_CATEGORY_ID = "recent";
// Every row below is styled to this same fixed height, title included - kept only so every row
// looks visually consistent regardless of its own title length/content, *not* relied on for the
// scroll math anymore (see rowOffsets/scrollToRow's own comment on why: an assumed height fed
// straight into an arithmetic offset, unlike a real per-row onLayout measurement, has no way to
// self-correct if that assumption is even slightly off, and that error compounds by one row's
// worth with every row scrolled past - reported as row-to-row navigation feeling imprecise/not
// smooth, exactly the class of bug BrowseScreen's own rows deliberately measure their way around
// instead of computing).
// Lowered significantly (was 320) - per explicit request. This is a fixed height per row
// (rowBlock below), not a shrink-wrap to content, so the gap between consecutive rows was
// whatever slack sat between each row's own actual content (title + strip) and this number - the
// tighter this is to that real content height, the less empty space shows between rows.
const ROW_HEIGHT = s(258);
// Taller than before (was 360, then 410) - per explicit request, now that the story text
// underneath the logo is gone entirely: the extra room goes to the backdrop itself (this View
// clips its own Image to exactly this height), showing more of the poster/backdrop instead of
// cropping it.
const HERO_HEIGHT = s(450);
// The hero picture is sized so nearly the whole 16:9 image shows - only the bottom
// HERO_PICTURE_BOTTOM_HIDDEN of it is cut off, and that part sits under the fade anyway. It's pinned
// flush to the top and right edges of the screen (its left edge is faded into the background).
// Width is derived from the hero's height rather than a share of the screen, so it stays "almost the
// full picture" on any TV; capped so it never takes more than 68% of the width.
const HERO_PICTURE_BOTTOM_HIDDEN = 0.2; // was 0.12 - a larger picture (more of its bottom sits under the fade)
const HERO_IMAGE_TOP_OFFSET = 0;
const HERO_PICTURE_WIDTH = Math.min(
  Math.round((HERO_HEIGHT * (16 / 9)) / (1 - HERO_PICTURE_BOTTOM_HIDDEN)),
  Math.round(Dimensions.get("window").width * 0.68)
);
const HERO_PICTURE_HEIGHT = Math.round(HERO_PICTURE_WIDTH * (9 / 16));
// See onRowFocusChange's own comment on why the hero's own backdrop swap is debounced by this
// much rather than committing on every single card focus change - long enough to skip past
// scrubbing quickly through a row (including a held direction key's own repeat rate), short
// enough that pausing on a card still feels immediate.
const HERO_UPDATE_DEBOUNCE_MS = 320;
// How long the hero sits on one title before auto-advancing to the next - long enough to actually
// read the title/story, short enough to still read as a "slider" rather than a static banner.
const HERO_AUTO_ROTATE_MS = 7000;
// A row further than this from the currently-focused row doesn't render its own card Images yet
// (see revealImages's own use below) - the same lever BrowseScreen's own IMAGE_REVEAL_RADIUS uses
// for the same reason, just a smaller radius: unlike that screen's grid, only one row here is ever
// even visible at a time, so only the current row and its immediate neighbors (the only ones a
// single up/down press could actually reach next) are worth keeping image-ready.
// Was 2 (5 rows' worth, up to ~100 resident backdrop images across rows of up to 20 cards each) -
// reported as stutter while scrolling between rows, the same class of concurrent-decode cost
// BrowseScreen's own IMAGE_REVEAL_RADIUS was just tightened for. 1 still keeps both neighbors a
// single up/down press could reach ready ahead of time, just without the second ring beyond that.
const ROW_REVEAL_RADIUS = 1;
// Every card in a row is a live view (Focusable + gradient + text + image), so this is the single biggest
// lever on how smooth moving between cards feels: 40 per row (tried for long imported lists) made
// navigation visibly heavier than the original 20.
// Imported from api.ts (not defined here) - sectionsToCategories there needs the exact same
// number to decide whether a row's own "View more" card should appear at all.
const ROW_MAX_ITEMS = HOME_ROW_MAX_ITEMS;

interface Props {
  heroMovies: Movie[];
  categories: Category[];
  lang: Lang;
  onSelectMovie: (movie: Movie) => void;
  // The "View more" card at the end of a row: opens that row's full list.
  onOpenCategory: (category: Category) => void;
  // False whenever Home is mounted but not what the viewer is looking at (another section, a details
  // page, a person page) - it stays mounted underneath, hidden, so its hero auto-rotation must stop or
  // it keeps decoding a full-size backdrop every few seconds behind whatever they are actually using.
  active: boolean;
}

export interface HomeScreenHandle {
  scrollToTop: () => void;
}

// Redesign, per explicit request: every category's own row - "recent" included, no longer a
// special case with its own bigger backdrop+story treatment - is now the exact same landscape-card
// presentation (RecentCard below). A fixed hero above (driven by whichever card most recently
// gained real focus, across any row - see focusedMovie's own comment) sits above a plain
// scrollable list of these rows, matching the request that the rows *below* the current one stay
// visible rather than being clipped away - an earlier version of this redesign clipped to one row
// at a time, reverted per explicit follow-up.
//
// Deliberately reuses the exact navigation mechanism the previous design (and BrowseScreen's own
// rows) already proved reliable rather than inventing a new one: real Android focus search moves
// between rows (every row stays permanently mounted, nothing is swapped in/out), and a plain
// reactive, animated scrollTo follows whichever row's card just gained focus, targeting that row's
// own *measured* position (via its own onLayout, exactly like BrowseScreen's own rows) rather than
// a computed one - the same mechanism that's already smooth everywhere else it's used in this app,
// satisfying "the transition between rows should be a smooth slide" without a bespoke animation of
// its own to get wrong.
const HomeScreen = React.forwardRef<HomeScreenHandle, Props>(function HomeScreen(
  { heroMovies, categories, lang, onSelectMovie, onOpenCategory, active },
  ref
) {
  const homeHandle = useSidebarHomeHandle();

  // "recent" kept first (matching the emphasis it had as this screen's own hero before), every
  // other category following in whatever order the server sent them. Falls back to a single
  // synthetic "featured" row built from heroMovies only if the server sent no categories at all -
  // an edge case (a totally empty catalog), not the normal shape, but one this screen's own props
  // still need to degrade into something rather than rendering nothing.
  const rows = useMemo(() => {
    const recent = categories.find((c) => c.id === RECENT_CATEGORY_ID);
    const rest = categories.filter((c) => c.id !== RECENT_CATEGORY_ID);
    const ordered = recent ? [recent, ...rest] : rest;
    if (!ordered.length && heroMovies.length) {
      return [
        {
          id: "featured",
          titleAr: "مميز",
          titleEn: "Featured",
          items: heroMovies,
        } as Category,
      ];
    }
    return ordered;
  }, [categories, heroMovies]);
  const rowItems = useMemo(() => rows.map((cat) => (cat.items || []).slice(0, ROW_MAX_ITEMS)), [rows]);

  // Populated once, on the very first row's very first card - the sidebar's own Home icon
  // (useImperativeHandle below) imperatively refocuses this the same one-shot way BrowseScreen's
  // own filter-bar transitions do (see retryFocus's own comment), since scrolling back to the top
  // alone doesn't also move real focus back there on its own.
  const firstCardRef = useRef<View>(null);

  // The banner above the stage (restored per explicit request - the redesign initially dropped it
  // entirely) - unlike the old hero, this is *always* mounted, never toggled on/off, so it never
  // has the enlarge/reflow or clipping bugs the old show/hide hero went through (see this file's
  // own git history) - it just always shows whichever card most recently gained real focus,
  // exactly the same always-mounted, just-swap-the-content shape BrowseScreen's own banner uses.
  const [focusedMovie, setFocusedMovie] = useState<Movie | null>(() => rowItems[0]?.[0] ?? null);
  // Which row is current, for revealImages below - a separate piece of *state* (not just the
  // lastScrolledTo ref, which exists purely to guard against redundant scrollTo calls and isn't
  // itself something a render can react to).
  const [currentRowIndex, setCurrentRowIndex] = useState(0);

  const scrollRef = useRef<any>(null);
  const lastScrolledTo = useRef<number | null>(null);
  // Populated via onLayout on each row below (see CategoryRow's own onRowLayout prop) - real
  // measured y-offsets *inside this ScrollView's own content*, exactly what scrollTo({y}) expects.
  // See ROW_HEIGHT's own comment for why this replaced a computed (index * ROW_HEIGHT) offset.
  const rowOffsets = useRef<number[]>([]);
  // A custom easing was tried here once (an Animated.Value ticked on the JS thread, with a
  // listener calling the imperative, non-animated scrollTo on every frame - useNativeDriver:false
  // is unavoidable for a ScrollView's own contentOffset) to get a duration/curve plain
  // scrollTo({animated:true}) doesn't expose any control over. Reported as choppier, not smoother
  // - every one of those per-frame ticks runs on the JS thread and crosses the bridge into a real
  // native scrollTo call, competing with this same transition's own state updates (the hero
  // banner swapping to a new backdrop Image, revealImages/currentRowIndex changing) for the same
  // thread right when it matters most. Reverted back to plain native animated scrollTo - Android's
  // own UI-thread-driven smooth scroll, the same mechanism this app already trusts everywhere
  // else - rather than keep tuning an approach that made this measurably worse.
  const scrollToRow = useCallback((index: number) => {
    if (lastScrolledTo.current === index) return;
    lastScrolledTo.current = index;
    const y = rowOffsets.current[index];
    if (y != null) scrollRef.current?.scrollTo({ y, animated: true });
  }, []);
  const onRowLayout = useCallback((index: number, e: { nativeEvent: { layout: { y: number } } }) => {
    rowOffsets.current[index] = e.nativeEvent.layout.y;
  }, []);
  // One shared callback for every row (its own behavior never depends on *which* row, only "did
  // one of its cards just gain focus") - stable via useCallback, same reasoning as every other
  // screen's own identically-shaped callback (see BrowseScreen's own handleCardFocusChange).
  //
  // setFocusedMovie itself is debounced (see HERO_UPDATE_DEBOUNCE_MS) - this fires on *every*
  // card that gains focus, including a plain left/right move between cards in the same row, not
  // just a row-to-row change. Each one used to swap the hero's backdrop Image immediately, which
  // meant scrubbing quickly across a row (or holding a direction key, which repeats several times
  // a second) fired one full-resolution network fetch+decode per card passed through - real,
  // frequent work landing in the exact same moment as the scroll/focus animation, and the more
  // likely root cause of this screen reading as choppy to navigate than the scroll mechanism
  // itself (already tried and reverted, see scrollToRow's own comment). Only committing the swap
  // once focus has actually settled on a card for a beat - the same "preview lags a hair behind
  // fast scrubbing" behavior other TV UIs use for an identical reason - cuts that down to at most
  // one fetch per pause, not one per card passed through.
  const heroUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-rotating hero (restored per explicit request) - cycles through heroMovies on its own
  // whenever the viewer hasn't touched navigation for a while, the same "slider" behavior the
  // hero originally had. A plain recursive setTimeout, not setInterval, so a real focus change
  // below can cleanly cancel-and-reschedule it instead of two timers racing to set focusedMovie.
  const heroAutoRotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heroRotateIndexRef = useRef(0);
  // True only for a change the auto-rotation itself made - those crossfade like a slider; a change
  // from real navigation swaps instantly, exactly as before (an animation there competed with the
  // scroll/focus animation and read as choppy).
  const heroChangeIsAutoRef = useRef(false);
  const scheduleHeroAutoRotate = useCallback(() => {
    if (heroAutoRotateTimerRef.current) clearTimeout(heroAutoRotateTimerRef.current);
    if (heroMovies.length < 2 || !active) return;
    heroAutoRotateTimerRef.current = setTimeout(() => {
      heroRotateIndexRef.current = (heroRotateIndexRef.current + 1) % heroMovies.length;
      heroChangeIsAutoRef.current = true;
      setFocusedMovie(heroMovies[heroRotateIndexRef.current]);
      scheduleHeroAutoRotate();
    }, HERO_AUTO_ROTATE_MS);
  }, [heroMovies, active]);
  useEffect(() => {
    scheduleHeroAutoRotate();
    return () => {
      if (heroAutoRotateTimerRef.current) clearTimeout(heroAutoRotateTimerRef.current);
    };
  }, [scheduleHeroAutoRotate]);

  const onRowFocusChange = useCallback(
    (index: number, movie: Movie) => {
      scrollToRow(index);
      if (heroUpdateTimerRef.current) clearTimeout(heroUpdateTimerRef.current);
      // Real navigation always wins over the auto-rotation and pushes its next tick back out -
      // rotating to a different title a moment after the viewer just deliberately focused one
      // would read as the screen fighting their own input.
      // The current-row state and the hero swap are committed together, once focus has settled - a
      // re-render (and newly revealed images) landing mid scroll animation is what made moving
      // between rows stutter.
      heroUpdateTimerRef.current = setTimeout(() => {
        setCurrentRowIndex(index);
        setFocusedMovie(movie);
        scheduleHeroAutoRotate();
      }, HERO_UPDATE_DEBOUNCE_MS);
    },
    [scrollToRow, scheduleHeroAutoRotate]
  );

  // See VideoPlayer.tsx's/BrowseScreen.tsx's own identical helper (word-for-word) for the full
  // reasoning - only used here for the sidebar's own Home icon (below), a single one-shot
  // "re-establish focus at the top" transition, not a hook into continuous navigation.
  const retryFocusRef = useRef<(() => void) | null>(null);
  const retryFocus = (r: React.RefObject<any>, attempts = 5, firstDelay = 40, step = 120) => {
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryFocus = () => {
      attempt += 1;
      (r.current as any)?.focus?.();
      if (attempt < attempts) timer = setTimeout(tryFocus, attempt * step);
    };
    timer = setTimeout(tryFocus, firstDelay);
    return () => {
      if (timer) clearTimeout(timer);
    };
  };

  // Home staying mounted (never remounted when leaving/returning to it - see App.tsx) means its
  // scroll position genuinely persists across visits, which is only wanted when returning from a
  // movie/person/the player mid-scroll - pressing the sidebar's own Home icon should still always
  // land back on row 0 with real focus there, not wherever the screen happened to be left.
  useImperativeHandle(ref, () => ({
    scrollToTop: () => {
      lastScrolledTo.current = 0;
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      retryFocusRef.current?.();
      retryFocusRef.current = retryFocus(firstCardRef);
    },
  }));

  const heroUri = focusedMovie ? posterUrl(focusedMovie.backdrop || focusedMovie.poster, "w1280") : "";
  const lastHeroUriRef = useRef(heroUri);
  const [prevHeroUri, setPrevHeroUri] = useState<string | null>(null);
  const heroFade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (heroUri === lastHeroUriRef.current) return;
    const previous = lastHeroUriRef.current;
    lastHeroUriRef.current = heroUri;
    if (!heroChangeIsAutoRef.current || !previous) {
      heroFade.setValue(1);
      setPrevHeroUri(null);
      return;
    }
    heroChangeIsAutoRef.current = false;
    setPrevHeroUri(previous);
    heroFade.setValue(0);
    Animated.timing(heroFade, { toValue: 1, duration: 700, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setPrevHeroUri(null);
    });
  }, [heroUri, heroFade]);

  // App.tsx no longer waits for the catalog fetch to resolve before letting a guest reach this
  // screen (see its own comment on why) - this is the gap that closes: a real loading state
  // instead of rendering nothing at all while `data` is still in flight. Once it arrives, `rows`
  // populates and this branch stops matching on its own, no extra state needed here to track it.
  if (!rows.length) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!!focusedMovie && (
        <View style={styles.hero}>
          {/* No key={focusedMovie.id} here (there once was) - this fires on every settled focus
              change (see onRowFocusChange's own debounce), including a plain left/right move
              between cards in the same row, not just a row-to-row change, so a key forcing a full
              destroy-and-recreate of this native image view on every one was real, frequent work
              competing with whatever scroll/focus animation was also happening in that same
              moment - reported as the whole screen feeling choppy to navigate, not just switching
              rows. A plain source swap re-decodes the same new image either way; it just doesn't
              also tear down and rebuild the view around it first. w1280 (was w780 - reported as
              visibly soft/blurry stretched full-width across this box on a real TV, so the decode
              cost tradeoff below no longer held) - this still swaps far more often than a typical
              hero/detail backdrop (see onRowFocusChange's own debounce comment), so it's worth
              watching for the same choppy-navigation regression if this ever comes up again. */}
          {/* The picture sits in a box on the right (HERO_IMAGE_WIDTH of the screen) instead of spanning
              it edge to edge, freeing the left side for real details. Its left edge is painted over
              with the solid background color and fades out to the right, so there is no visible
              poster border anywhere - the image just emerges from the dark. */}
          <View style={styles.heroImageBox} pointerEvents="none">
            {!!prevHeroUri && <Image source={{ uri: prevHeroUri }} style={styles.heroPicture} resizeMode="cover" fadeDuration={0} />}
            <Animated.Image
              source={{ uri: heroUri }}
              style={[styles.heroPicture, { opacity: heroFade }]}
              resizeMode="cover"
              fadeDuration={0}
            />
            <LinearGradient
              // Many stops on an ease-out curve (not 4-5 straight segments): a few linear segments each read as
              // a visible "step", i.e. an edge. This falloff is gradual enough to melt into the black.
              colors={[
                colors.bg,
                "rgba(0,0,0,0.96)",
                "rgba(0,0,0,0.88)",
                "rgba(0,0,0,0.76)",
                "rgba(0,0,0,0.6)",
                "rgba(0,0,0,0.44)",
                "rgba(0,0,0,0.28)",
                "rgba(0,0,0,0.15)",
                "rgba(0,0,0,0.06)",
                "rgba(0,0,0,0)",
              ]}
              locations={[0, 0.07, 0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.84, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          {/* Both gradients lightened (was 0.55/0.9) - per explicit request, matching a
              reference screenshot's own lighter dimming, so the backdrop itself reads as more
              vibrant/colorful instead of mostly darkened out. */}
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.08)", "rgba(0,0,0,0.3)", "rgba(0,0,0,0.65)", colors.bg]}
            locations={[0, 0.5, 0.7, 0.87, 1]}
            style={StyleSheet.absoluteFill}
          />
          {/* Meta row back to type/year/duration/rating only (was genre/age-rating/rating/year/
              country) and back above the story text (was below it) - both per explicit request,
              matching that same reference screenshot. No buttons here on purpose, per that same
              request - this banner stays purely informational, not interactive. */}
          <View style={styles.heroContent}>
            {focusedMovie.logoUrl || focusedMovie.titleLogo ? (
              <LogoImage uri={posterUrl(focusedMovie.logoUrl || focusedMovie.titleLogo, "w780")} height={s(80)} maxWidth={s(340)} />
            ) : (
              <Text style={styles.heroTitle} numberOfLines={2}>{pickText(focusedMovie.titleAr, focusedMovie.titleEn, lang)}</Text>
            )}
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroMetaLine}>{focusedMovie.type === "series" ? t("series", lang) : t("movies", lang)}</Text>
              {!!focusedMovie.year && <Text style={styles.heroMetaLine}>{focusedMovie.year}</Text>}
              {!!focusedMovie.duration && <Text style={styles.heroMetaLine}>{focusedMovie.duration}</Text>}
              <View style={styles.imdbBadge}>
                <Text style={styles.imdbBadgeText}>IMDb</Text>
              </View>
              <Text style={styles.heroRating}>{focusedMovie.rating}</Text>
            </View>
            {!!focusedMovie.genres?.length && (
              <Text numberOfLines={1} style={styles.heroGenres}>
                {focusedMovie.genres.slice(0, 4).map((g) => genreName(g, lang)).join("  •  ")}
              </Text>
            )}
            <Text numberOfLines={4} style={styles.heroStory}>
              {pickText(focusedMovie.storyAr, focusedMovie.storyEn, lang)}
            </Text>
          </View>
          {heroMovies.length > 1 && (
            <View style={styles.heroDots} pointerEvents="none">
              {heroMovies.slice(0, 10).map((m) => (
                <View key={m.id} style={[styles.heroDot, m.id === focusedMovie.id && styles.heroDotActive]} />
              ))}
            </View>
          )}
        </View>
      )}
      {/* Root cause of the choppy vertical scrolling: on focus, Android's own ScrollView (RN's
          ReactScrollView.requestChildFocus -> scrollToChild -> scrollBy) INSTANTLY jumps to reveal the
          newly focused card, and then this screen's own animated scrollTo (see scrollToRow) starts a second
          scroll from that jumped position - a jump followed by a re-animation is exactly the stutter seen
          between rows. scrollsChildToFocus={false} removes the native jump so the one animated scroll is
          the only thing that moves. */}
      <ScrollView ref={scrollRef} style={styles.rowsScroll} showsVerticalScrollIndicator={false} scrollsChildToFocus={false}>
        {rows.map((cat, index) => (
          <CategoryRow
            key={cat.id}
            title={pickText(cat.titleAr, cat.titleEn, lang)}
            items={rowItems[index]}
            // A row shows a head of ROW_MAX_ITEMS; the card at its end opens the rest. `cat.loadAll` is
            // only ever set when there's actually more to fetch - see api.ts's sectionsToCategories.
            category={cat.loadAll ? cat : undefined}
            lang={lang}
            homeHandle={homeHandle}
            onSelect={onSelectMovie}
            onOpenCategory={onOpenCategory}
            rowIndex={index}
            onRowFocusChange={onRowFocusChange}
            onRowLayout={onRowLayout}
            // While Home sits hidden under a details/person page, only its current row keeps its bitmaps -
            // the rest are released, which cuts peak memory exactly when the heavier page is on screen.
            revealImages={Math.abs(index - currentRowIndex) <= (active ? ROW_REVEAL_RADIUS : 0)}
            firstCardRef={index === 0 ? firstCardRef : undefined}
            isCurrent={index === currentRowIndex}
          />
        ))}
      </ScrollView>
    </View>
  );
});

export default HomeScreen;

// One category's own row - a real component (not inlined in HomeScreen's own .map()) so
// React.memo has stable props to compare (a full re-render audit this app relied on elsewhere
// found a fresh renderItem/closure per row forcing every other mounted row to re-render on every
// single focus change - the same reasoning applies here). Every row is the exact same landscape
// card treatment "recent" alone used to get - see ROW_HEIGHT's own comment for why every row also
// needs to render at the exact same height.
const CategoryRow = React.memo(function CategoryRow({
  title,
  items,
  category,
  lang,
  homeHandle,
  onSelect,
  onOpenCategory,
  rowIndex,
  onRowFocusChange,
  onRowLayout,
  revealImages,
  firstCardRef,
  isCurrent,
}: {
  title: string;
  items: Movie[];
  // Set only when this row has a "View more" card at its end.
  category?: Category;
  lang: Lang;
  homeHandle?: number | null;
  onSelect: (movie: Movie) => void;
  onOpenCategory: (category: Category) => void;
  rowIndex: number;
  onRowFocusChange: (rowIndex: number, movie: Movie) => void;
  onRowLayout: (rowIndex: number, e: { nativeEvent: { layout: { y: number } } }) => void;
  // See ROW_REVEAL_RADIUS's own comment - every row stays mounted regardless (needed for
  // reliable navigation, matching BrowseScreen's own identical reasoning), only each row's own
  // Image is deferred while it's far from the currently-focused row.
  revealImages: boolean;
  firstCardRef?: React.RefObject<View | null>;
  // Whether this is the row real focus is currently on - used only to snap this row's own
  // horizontal scroll back to column 0 the moment focus leaves it (see hScrollRef's own effect
  // below), never to gate rendering/reveal (that's revealImages' job).
  isCurrent: boolean;
}) {
  const hasMore = !!category;
  // The "View more" card counts as the row's last focus target, so the right-edge clamp lands on it.
  const clamp = useFocusClamp(items.length + (hasMore ? 1 : 0));
  const visibleImages = useProgressiveReveal(items.length);
  const handleOpenMore = useCallback(() => {
    if (category) onOpenCategory(category);
  }, [category, onOpenCategory]);
  const hScrollRef = useRef<any>(null);
  // On-device diagnostic (see HomeScreen's own debugPos comment) confirmed real focus landing on
  // *whichever card in a scrolled-away row currently sits leftmost on screen* when pressing left
  // from a different row's own real column 0 toward the sidebar - e.g. this row scrolled to show
  // column 14, focus escaping left from the row below landed on this row's column 11 (its
  // then-leftmost *visible* card), not the sidebar at all. That confirms the explicit "jump
  // straight to the sidebar" routing (nextFocusLeft on column 0, see below) is being silently
  // skipped by Android specifically right after a vertical row change - a real limitation of that
  // mechanism on this renderer already documented elsewhere in this app (see focusRefs.ts and this
  // file's own git history), not something fixable by tuning the same routing yet again. Snapping
  // a row back to column 0 the instant it's no longer the current one means that when this
  // Android-level fallback does misfire, it lands on this row's real column 0 - immediately
  // adjacent to the sidebar - instead of a confusing, seemingly-random column far into whatever the
  // row happened to be scrolled to. Doesn't guarantee a single-press escape from every position,
  // but turns the failure mode from "jumps somewhere unrelated" into "one extra, predictable press
  // right next to where you're trying to go."
  useEffect(() => {
    if (!isCurrent) hScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [isCurrent]);
  const handleCardFocusChange = useCallback(
    (index: number, focused: boolean) => {
      if (focused) onRowFocusChange(rowIndex, items[index]);
    },
    [onRowFocusChange, rowIndex, items]
  );

  return (
    <View style={styles.rowBlock} onLayout={(e) => onRowLayout(rowIndex, e)}>
      {/* Back to stacked (was side by side: title beside the strip) - per explicit follow-up
          request. */}
      <View style={styles.railTitleRow}>
        <View style={styles.railTitleBar} />
        <Text style={styles.railTitle}>{title}</Text>
      </View>
      <View style={styles.railClip}>
        <ScrollView ref={hScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentStripContent}>
          {items.map((movie, i) => (
            <RecentCard
              key={movie.id}
              ref={(node: View | null) => {
                clamp.setRef(i)(node);
                if (i === 0 && firstCardRef) firstCardRef.current = node;
              }}
              movie={movie}
              lang={lang}
              index={i}
              showImage={revealImages && i < visibleImages}
              onSelect={onSelect}
              hasTVPreferredFocus={rowIndex === 0 && i === 0}
              onFocusChangeIndexed={handleCardFocusChange}
              // Column 0 only (was every card, per an earlier "exit left from any row" request) -
              // that blanket override was an explicit cross-ScrollView target (this row's own
              // strip -> the sidebar, a completely different part of the tree) being resolved from
              // however far right the row happened to be scrolled, not just from column 0 - a
              // structurally different, far-less-tested case than the original column-0-only
              // escape this app has long relied on elsewhere (BrowseScreen's own grid, every other
              // rail). Confirmed via repeated on-device reports as unreliable specifically from a
              // non-zero column (landing back in whatever row was last visited instead of the
              // sidebar) - removing it for those columns hands left back to Android's own plain
              // adjacent-card focus search, the same reliable, zero-interception mechanism this
              // app's own D-pad navigation is otherwise built entirely on (see this file's own top
              // comment on rails, and BrowseScreen's identical grid pattern). Reaching the sidebar
              // from a non-zero column now takes one press per card back to column 0 instead of a
              // single instant jump - slower, but every one of those presses is the same trivial,
              // already-proven-reliable movement RIGHT already uses in the other direction, unlike
              // the escape that was silently failing.
              nextFocusLeft={i === 0 ? homeHandle ?? undefined : undefined}
              nextFocusRight={i === items.length - 1 && !hasMore ? clamp.clampRight() : undefined}
            />
          ))}
          {hasMore && (
            <Focusable
              ref={clamp.setRef(items.length)}
              onPress={handleOpenMore}
              nextFocusRight={clamp.clampRight()}
              style={styles.recentCard}
              scaleTo={1}
              focusRadius={s(10)}
            >
              {(focused: boolean) => (
                <View style={[styles.recentFrame, styles.moreFrame, focused && styles.recentFrameFocused, focused && focusShadow]}>
                  <Text style={[styles.morePlus, focused && styles.moreTextFocused]}>+</Text>
                  <Text style={[styles.moreText, focused && styles.moreTextFocused]}>{lang === "ar" ? "عرض المزيد" : "View more"}</Text>
                </View>
              )}
            </Focusable>
          )}
        </ScrollView>
      </View>
    </View>
  );
});

// The landscape card every row uses now (previously only the "recent" rail's own treatment) - a
// backdrop image with title/logo/meta overlaid directly on it, rather than a plain vertical poster
// with a caption underneath.
//
// Wrapped in React.memo, same reasoning as CategoryRow above - `index` bridges HomeScreen's one
// shared, stable onFocusChangeIndexed callback down to Focusable's own plain
// (focused: boolean) => void shape *inside* this component (via handleFocusChange below) instead
// of the parent's own .map() needing a fresh per-card closure captured over `i`, which would have
// been exactly the kind of unstable prop that defeats memoization here.
const RecentCard = React.memo(React.forwardRef<View, {
  movie: Movie;
  lang: Lang;
  index: number;
  onSelect: (movie: Movie) => void;
  onFocusChangeIndexed?: (index: number, focused: boolean) => void;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  showImage?: boolean;
  hasTVPreferredFocus?: boolean;
}>(function RecentCard(
  { movie, lang, index, onSelect, onFocusChangeIndexed, nextFocusLeft, nextFocusRight, showImage = true, hasTVPreferredFocus },
  ref
) {
  const metaBits = [
    movie.year ? String(movie.year) : null,
    movie.country ? countryName(movie.country, lang) : null,
    movie.genres?.[0] ? genreName(movie.genres[0], lang) : null,
    movie.quality || null,
  ].filter(Boolean) as string[];

  const handleFocusChange = useCallback(
    (focused: boolean) => onFocusChangeIndexed?.(index, focused),
    [onFocusChangeIndexed, index]
  );
  const handlePress = useCallback(() => onSelect(movie), [onSelect, movie]);

  return (
    <Focusable
      ref={ref}
      onPress={handlePress}
      onFocusChange={handleFocusChange}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={styles.recentCard}
      // No scale on focus here (every other Focusable in the app uses one) - scaling grows a
      // card symmetrically from its own center, which shifts its rendered left edge left by half
      // the added width the instant it becomes focused, a card this wide (400) makes even a small
      // 3.5% scale a visible few pixels of its own. recentFrameFocused's own
      // white border already carries the focus indicator on its own, so nothing is lost by
      // dropping the scale specifically for this one card.
      scaleTo={1}
      focusRadius={s(10)}
    >
      {(focused: boolean) => (
        <View style={[styles.recentFrame, focused && styles.recentFrameFocused, focused && focusShadow]}>
          <View style={styles.recentImageClip}>
            {showImage && (
              // w342 (posterUrl's own available sizes stop at w185/w342/w780/w1280), not w780 -
              // which every row now requests, not just the old "recent" row alone. The card
              // itself only ever renders at s(400) wide, so w780 was fetching and decoding
              // roughly 5x the pixel count actually displayed, on every card in every row now
              // instead of just one row's worth - a real, measurable cost behind this screen's
              // own reported slowness once every row switched to this card style. w342 is a
              // slight (~17%) upscale rather than an exact match, an acceptable trade for TV
              // viewing distance against that much less to fetch/decode per card.
              <Image source={{ uri: posterUrl(movie.backdrop || movie.poster, "w342") }} style={styles.recentImage} fadeDuration={0} />
            )}
            {!!movie.partNumber && (
              <View style={styles.partBadgeRecent}>
                <Text style={styles.partBadgeRecentText}>{movie.partNumber}</Text>
              </View>
            )}
            {/* Four stops, not two - a plain transparent-to-black gradient still reads as a hard
                edge right where the text ends, since the eye is far more sensitive to a gradient's
                own rate of change than to its absolute darkness. Slowing that rate down right at
                the top (transparent for a while, then only gradually darkening) is what makes it
                fade out instead of just stopping. */}
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.05)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.9)"]}
              locations={[0, 0.4, 0.75, 1]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.recentInfo} pointerEvents="none">
              {movie.logoUrl || movie.titleLogo ? (
                <LogoImage uri={posterUrl(movie.logoUrl || movie.titleLogo, "w780")} height={s(40)} maxWidth={s(260)} />
              ) : (
                <Text numberOfLines={1} style={styles.recentTitle}>
                  {pickText(movie.titleAr, movie.titleEn, lang)}
                </Text>
              )}
              {/* One combined row (was a badges row, then a separate facts line under it) - same
                  "everything after the title lives on one line" shape the hero above already
                  uses for its own heroMetaRow. */}
              <View style={styles.recentBadgeRow}>
                {!!movie.ageRating && (
                  <View style={styles.recentAgeBadge}>
                    <Text style={styles.recentAgeBadgeText}>{movie.ageRating}</Text>
                  </View>
                )}
                {/* Same filled-pill shape as the shared imdbBadge (unchanged elsewhere, e.g. the
                    hero) just recolored white instead of yellow, this card only - and built off
                    recentAgeBadge's own exact box model (border width, vertical padding, radius)
                    so the two badges land at the same height. */}
                <View style={styles.recentImdbBadge}>
                  <Text style={styles.recentImdbBadgeText}>IMDb</Text>
                </View>
                <Text style={styles.recentRating}>{movie.rating}</Text>
                {metaBits.length > 0 && (
                  <Text numberOfLines={1} style={styles.recentMeta}>
                    {"  •  " + metaBits.join("  •  ")}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </View>
      )}
    </Focusable>
  );
}));

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingRoot: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  // Always mounted (see focusedMovie's own comment above) - a fixed height, backdrop + gradients
  // + logo/meta, the same recipe BrowseScreen's own banner uses. No more story text underneath -
  // removed per explicit request, freeing the extra height HERO_HEIGHT now gives the backdrop
  // itself instead.
  hero: { height: HERO_HEIGHT, overflow: "hidden", justifyContent: "flex-end" },
  heroPicture: { position: "absolute", top: 0, left: 0, right: 0, height: HERO_PICTURE_HEIGHT },
  heroImageBox: { position: "absolute", top: HERO_IMAGE_TOP_OFFSET, right: 0, height: HERO_HEIGHT - HERO_IMAGE_TOP_OFFSET, width: HERO_PICTURE_WIDTH, overflow: "hidden" },
  // Back to a plain vertical stack - logo, then one meta line under it - per explicit follow-up
  // request (an earlier version put the meta info in its own column facing the logo from the
  // opposite side of a row instead of underneath it).
  heroDots: { position: "absolute", right: s(32), bottom: s(18), flexDirection: "row", gap: s(6) },
  heroDot: { width: s(8), height: s(8), borderRadius: s(4), backgroundColor: "rgba(255,255,255,0.3)" },
  heroDotActive: { width: s(24), backgroundColor: "#fff" },
  heroContent: { padding: s(32), paddingLeft: spacing.contentStart, gap: s(10) },
  // Enlarged (was fs(38), then 44, then 50) - stands in for a missing title logo, per request.
  // Only shown for titles with no logo - bigger and in capitals so it reads like one (per request).
  heroTitle: { color: "#fff", fontSize: fs(66), lineHeight: fs(74), textTransform: "uppercase", maxWidth: s(760), fontFamily: font.black, textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 10 },
  // One line - type, year, duration, rating (with its IMDb badge).
  heroMetaRow: { flexDirection: "row", gap: s(10), alignItems: "center" },
  heroMetaLine: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold },
  heroRating: { color: "#fff", fontSize: fs(13), fontFamily: font.black },
  // maxWidth capped at half the screen (was unconstrained) - per explicit request, so this
  // doesn't stretch all the way to the far edge on a wide screen.
  heroGenres: { color: colors.textSecondary, fontSize: fs(13), fontFamily: font.bold },
  heroStory: { maxWidth: "46%", color: colors.textSecondary, fontSize: fs(14), lineHeight: fs(21), fontFamily: font.semiBold },
  // A plain scrollable list below the hero now, not clipped to one row at a time - per explicit
  // request, the rows *below* the current one need to stay visible (a normal, familiar rail-list
  // feel), with the "smooth slide" ask covered by the scrollTo below already being animated. Each
  // row's own real position is measured via its own onLayout (see rowOffsets/scrollToRow above),
  // not computed from this fixed height - ROW_HEIGHT is only for consistent visual sizing.
  rowsScroll: { flex: 1, marginTop: s(20) },
  // Back to a plain column (was a row: title beside the strip) - per explicit follow-up request.
  rowBlock: { height: ROW_HEIGHT },
  railTitleRow: { flexDirection: "row", alignItems: "center", gap: s(8), marginLeft: spacing.contentStart, marginBottom: s(6) },
  // Starts exactly where the sidebar's own column ends - anything a horizontal scroll would
  // have carried further left than this is now outside the ScrollView's box entirely, not
  // just behind extra padding, so it can't paint through the sidebar's transparent gaps.
  railClip: { marginLeft: spacing.sidebarWidth, overflow: "hidden" },
  railTitleBar: { width: s(5), height: s(15), borderRadius: 3, backgroundColor: "#fff" },
  railTitle: { color: "#fff", fontSize: fs(15), fontFamily: font.bold },
  // paddingLeft here is contentStart *minus* the sidebarWidth railClip's own marginLeft above
  // already accounts for - without it the first card sits flush against this box's own x=0 with
  // no buffer of its own. paddingTop/Bottom trimmed down (was 20/20) as part of shrinking
  // ROW_HEIGHT overall - RecentCard doesn't scale on focus (scaleTo={1}, see its own comment on
  // why), so unlike a scaling card, there's no focus-grow headroom this vertical padding needs to
  // reserve for; it's purely breathing room now.
  recentStripContent: {
    paddingLeft: spacing.contentStart - spacing.sidebarWidth,
    paddingRight: s(24),
    paddingTop: s(10),
    paddingBottom: s(10),
  },
  imdbBadge: { backgroundColor: colors.imdbYellow, borderRadius: 3, paddingHorizontal: s(5), paddingVertical: 1 },
  imdbBadgeText: { color: "#000", fontSize: fs(9), fontFamily: font.black },
  // Was 280, then 360, then 400 (each per explicit request), settled at 360. marginHorizontal
  // brought down too (was 10) - per explicit request to bring the cards closer together.
  recentCard: { width: s(360), marginHorizontal: s(6) },
  // No overflow:hidden on the frame itself, same reasoning as MovieCard's own posterFrame -
  // combined with borderRadius and the focus-scale transform, that previously rendered with
  // one edge of the border missing on some devices. The image's own rounded clip is a separate
  // inner view instead, so it never masks the border.
  // Unselected border much darker (was the gray colors.border) - it read as a visible gray outline.
  recentFrame: { width: "100%", borderRadius: s(10), borderWidth: 2, borderColor: "#0d0d0d", backgroundColor: colors.cardBg },
  recentFrameFocused: { borderColor: "#fff" },
  // Rounded on all four corners now (was top-only) - the info panel that used to sit below the
  // image, squaring off its bottom edge, is gone: this clip *is* the whole visible card now.
  recentImageClip: { width: "100%", aspectRatio: 16 / 9, borderRadius: s(9), overflow: "hidden" },
  recentImage: { width: "100%", height: "100%" },
  // The "View more" card: same footprint as a title card (16:9 inside the same framed border), so the row keeps its height.
  moreFrame: { aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", gap: s(4), backgroundColor: "rgba(255,255,255,0.06)" },
  morePlus: { color: "rgba(255,255,255,0.8)", fontSize: fs(44), fontFamily: font.black, lineHeight: fs(50) },
  moreText: { color: "rgba(255,255,255,0.8)", fontSize: fs(16), fontFamily: font.bold },
  moreTextFocused: { color: "#fff" },
  // Flush corner tag (matches MovieCard's own partBadge - see its own comment for why this
  // replaced an earlier solid accent-red floating circle) - zero-offset into the thumbnail's own
  // top-left corner, sharing recentImageClip's own radius on its two outer corners instead of
  // floating on top of the image as an unrelated sticker.
  partBadgeRecent: {
    position: "absolute",
    top: 0,
    left: 0,
    minWidth: s(24),
    paddingHorizontal: s(8),
    paddingVertical: s(4),
    borderTopLeftRadius: s(9),
    borderBottomRightRadius: s(10),
    backgroundColor: "rgba(0,0,0,0.82)",
    borderBottomWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  partBadgeRecentText: { color: "#fff", fontSize: fs(13), fontFamily: font.black, letterSpacing: 0.2 },
  // One combined row - age rating, IMDb, the numeric rating, and the year/country/genre/quality
  // facts that used to run on their own separate line underneath. recentMeta's own flex:1 is
  // what actually keeps this to one line: it soaks up whatever width the fixed-size items ahead
  // of it don't use, so a long facts string ellipsizes there instead of wrapping/overflowing.
  recentBadgeRow: { flexDirection: "row", alignItems: "center", gap: s(6) },
  recentAgeBadge: { borderWidth: 1.5, borderColor: "rgba(255,255,255,0.5)", borderRadius: 4, paddingHorizontal: s(6), paddingVertical: s(1) },
  recentAgeBadgeText: { color: "#fff", fontSize: fs(10), fontFamily: font.black },
  // Same border width/vertical padding/radius as recentAgeBadge above (just filled white with a
  // matching white border, instead of outlined) - what actually keeps the two badges the same
  // height, not just an eyeballed match.
  // Smaller (was fs(10), padding s(6)/s(1), border 1.5) - read as oversized on the card, per request.
  recentImdbBadge: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#fff", borderRadius: 3, paddingHorizontal: s(4), paddingVertical: 0 },
  recentImdbBadgeText: { color: "#000", fontSize: fs(8), fontFamily: font.black },
  recentRating: { color: "#fff", fontSize: fs(12), fontFamily: font.black },
  // Pinned to the image's own bottom edge (was a plain panel below it) - sits over the gradient
  // above, so it needs no background of its own.
  recentInfo: { position: "absolute", left: 0, right: 0, bottom: 0, padding: s(12), gap: s(12) },
  // Always white (was textSecondary/white on focus) - unlike a plain poster row's caption text,
  // this now sits on the artwork itself, over a dark gradient built to keep it readable
  // regardless of focus, so dimming it unfocused had nothing left to actually contrast against.
  // Stands in for a missing title logo (s(40) tall) - enlarged from fs(16), then 20, then 22, per request.
  recentTitle: { color: "#fff", fontSize: fs(30), fontFamily: font.black, textTransform: "uppercase" },
  recentMeta: { flex: 1, color: "rgba(255,255,255,0.75)", fontSize: fs(12), fontFamily: font.semiBold },
});
