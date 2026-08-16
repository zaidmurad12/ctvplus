import React from "react";
import { Heart, Info, Play, Plus } from "lucide-react";
import type { Category, Episode, Movie, Season } from "../types";
import { getHighResImage } from "../utils/imageUtils";
import MovieCard, { formatMovieDuration } from "./MovieCard";
import { useFocusNode, useFocusNodes, useFocusZone } from "../hooks/useFocusNav";

const FOCUS_RING = "ring-2 ring-white ring-offset-2 ring-offset-zinc-950";

interface HomeScreenProps {
  lang: "ar" | "en";
  heroMovie: Movie | null;
  heroMovies: Movie[];
  currentHeroIndex: number;
  setCurrentHeroIndex: (i: number) => void;
  setHeroMovie: (m: Movie) => void;
  categories: Category[];
  favorites: Movie[];
  toggleFavorite: (movie: Movie) => void;
  hoveredCardKey: string | null;
  setHoveredCardKey: (key: string | null) => void;
  watchProgress: Record<string, { percent: number; currentTime?: number; updatedAt: number }>;
  generateSeasonsForSeries: (series: Movie) => Season[];
  setSelectedMovie: (movie: Movie | null) => void;
  setPlayingMovie: (movie: Movie | null) => void;
  setActiveSeason: (season: Season | null) => void;
  setActiveEpisode: (episode: Episode | null) => void;
  setActiveServerIndex: (i: number) => void;
  onSeeAllCollections: () => void;
}

export function HomeScreen({
  lang, heroMovie, heroMovies, currentHeroIndex, setCurrentHeroIndex, setHeroMovie,
  categories, favorites, toggleFavorite, hoveredCardKey, setHoveredCardKey, watchProgress,
  generateSeasonsForSeries, setSelectedMovie, setPlayingMovie, setActiveSeason, setActiveEpisode,
  setActiveServerIndex, onSeeAllCollections,
}: HomeScreenProps) {
  const playHeroMovie = () => {
    if (!heroMovie) return;
    if (heroMovie.type === "series") {
      const seasons = generateSeasonsForSeries(heroMovie);
      const firstSzn = seasons[0];
      const firstEp = firstSzn?.episodes[0];
      setActiveSeason(firstSzn || null);
      setActiveEpisode(firstEp || null);
    } else {
      setActiveSeason(null);
      setActiveEpisode(null);
    }
    setPlayingMovie(heroMovie);
    setActiveServerIndex(0);
  };

  useFocusZone({
    id: "home.hero",
    layout: () => [["watch", "info", "favorite"]],
    onEdge: (dir) => {
      if (dir === "left") return { zoneId: "sidebar" };
      if (dir === "down") return { zoneId: "home.rails" };
      return;
    },
  });
  const watchNode = useFocusNode({ zoneId: "home.hero", id: "watch", onSelect: playHeroMovie });
  const infoNode = useFocusNode({ zoneId: "home.hero", id: "info", onSelect: () => heroMovie && setSelectedMovie(heroMovie) });
  const favoriteNode = useFocusNode({ zoneId: "home.hero", id: "favorite", onSelect: () => heroMovie && toggleFavorite(heroMovie) });

  const railLayout = () => categories.map((cat) => (cat.items || []).map((_, cIdx) => `${cat.id}-${cIdx}`));
  useFocusZone({
    id: "home.rails",
    layout: railLayout,
    onEdge: (dir, row) => {
      if (dir === "up" && row === 0) return { zoneId: "home.hero", nodeId: "watch" };
      if (dir === "left") return { zoneId: "sidebar" };
      return;
    },
  });

  // Rail card count changes as data loads in, so these can't be registered one
  // useFocusNode() call per card (that breaks the Rules of Hooks) — one useFocusNodes()
  // call handles the whole, variable-length id list instead.
  const allRailNodeIds = categories.flatMap((cat) => (cat.items || []).map((_, cIdx) => `${cat.id}-${cIdx}`));
  const railNodes = useFocusNodes("home.rails", allRailNodeIds, {
    onSelect: (id) => {
      for (const cat of categories) {
        const cIdx = (cat.items || []).findIndex((_, i) => `${cat.id}-${i}` === id);
        if (cIdx === -1) continue;
        const movie = cat.items[cIdx];
        if (movie.id === "show_more_collections") onSeeAllCollections();
        else setSelectedMovie(movie);
        return;
      }
    },
  });

  return (
    <>
      {heroMovie && (
        <div className="relative w-full h-[460px] sm:h-[510px] md:h-[550px] flex-shrink-0 overflow-hidden">
          <img
            key={heroMovie.id}
            src={getHighResImage(heroMovie.backdrop || heroMovie.poster, true)}
            alt={heroMovie.titleEn}
            className="absolute inset-0 top-0 w-full h-full object-cover object-top animate-hero-zoom-out brightness-[0.95] contrast-[1.05]"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.src = "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=3840&q=95&auto=format&fit=crop";
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#000000] via-[#000000]/25 to-transparent pointer-events-none" />
          <div className={`absolute inset-0 pointer-events-none ${lang === "ar" ? "bg-gradient-to-l from-[#000000]/85 via-[#000000]/25 to-transparent" : "bg-gradient-to-r from-[#000000]/85 via-[#000000]/25 to-transparent"}`} />

          <div className={`absolute bottom-8 sm:bottom-12 md:bottom-14 z-10 flex flex-col gap-2.5 max-w-2xl drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)] ${lang === "ar" ? "right-24 md:right-28 text-right" : "left-24 md:left-28 text-left"}`}>
            {(heroMovie.logoUrl || heroMovie.titleLogo) ? (
              <div className="my-1">
                <img
                  src={getHighResImage(heroMovie.logoUrl || heroMovie.titleLogo)}
                  alt={lang === "ar" ? heroMovie.titleAr : heroMovie.titleEn}
                  className="max-h-20 sm:max-h-28 md:max-h-36 max-w-full object-contain filter drop-shadow-[0_8px_20px_rgba(0,0,0,0.95)]"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const txtEl = document.getElementById(`hero-title-text-${heroMovie.id}`);
                    if (txtEl) txtEl.style.display = "block";
                  }}
                />
                <h2 id={`hero-title-text-${heroMovie.id}`} className="hidden text-3xl sm:text-5xl md:text-6xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
                  {lang === "ar" ? heroMovie.titleAr : heroMovie.titleEn}
                </h2>
              </div>
            ) : (
              <h2 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white leading-tight tracking-tight drop-shadow-2xl">
                {lang === "ar" ? heroMovie.titleAr : heroMovie.titleEn}
              </h2>
            )}

            <div className="flex items-center gap-2.5 text-xs sm:text-sm font-bold flex-wrap">
              <span className="text-zinc-300 font-num">{heroMovie.year}</span>
              <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded border border-white/40 text-white bg-black/40">
                {heroMovie.type === "movie" ? (lang === "ar" ? "فيلم" : "FILM") : (lang === "ar" ? "مسلسل" : "SERIES")}
              </span>
              <div className="flex items-center gap-1 select-none">
                <span className="bg-[#F5C518] text-[#000000] font-sans font-black px-1.5 py-0.5 rounded-[3px] text-[7.5px] sm:text-[8px] tracking-tight leading-none uppercase">IMDb</span>
                <span className="font-num text-[11px] font-black text-white leading-none">{heroMovie.rating}</span>
              </div>
              <span className="text-zinc-300 text-xs font-num font-black tracking-wider uppercase">{formatMovieDuration(heroMovie.duration)}</span>
            </div>

            <p className="text-xs sm:text-sm text-zinc-300 line-clamp-3 mt-0.5 max-w-xl leading-relaxed font-medium">
              {lang === "ar" ? heroMovie.storyAr : heroMovie.storyEn}
            </p>

            <div className="flex items-center gap-3 mt-3">
              <button
                ref={watchNode.ref as React.RefObject<HTMLButtonElement>}
                id="hero-watch-btn"
                onClick={playHeroMovie}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-md bg-white text-black font-extrabold text-xs sm:text-sm shadow-xl transition-all transform hover:scale-105 cursor-pointer hover:bg-zinc-200 ${watchNode.isFocused ? FOCUS_RING : ""}`}
              >
                <Play className="w-4 h-4 fill-black text-black" />
                <span>{lang === "ar" ? "شاهد الآن" : "Play"}</span>
              </button>

              <button
                ref={infoNode.ref as React.RefObject<HTMLButtonElement>}
                id="hero-info-btn"
                onClick={() => heroMovie && setSelectedMovie(heroMovie)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-md bg-zinc-900/80 border border-zinc-700/80 text-white font-bold text-xs sm:text-sm hover:bg-zinc-800 transition-all cursor-pointer hover:scale-105 ${infoNode.isFocused ? FOCUS_RING : ""}`}
              >
                <Info className="w-4 h-4" />
                <span>{lang === "ar" ? "تفاصيل" : "More Info"}</span>
              </button>

              <button
                ref={favoriteNode.ref as React.RefObject<HTMLButtonElement>}
                id="hero-favorite-btn"
                onClick={() => heroMovie && toggleFavorite(heroMovie)}
                className={`p-2.5 rounded-md border transition-all cursor-pointer hover:scale-105 ${favoriteNode.isFocused ? FOCUS_RING : ""} ${
                  favorites.some((f) => f.id === heroMovie.id)
                    ? "bg-rose-950/50 text-rose-500 border-rose-800/60"
                    : "bg-zinc-900/80 border-zinc-700/80 text-zinc-400 hover:text-white"
                }`}
              >
                <Heart className={`w-4 h-4 ${favorites.some((f) => f.id === heroMovie.id) ? "fill-current" : ""}`} />
              </button>
            </div>
          </div>

          {heroMovies.length > 1 && (
            <div className={`absolute bottom-8 z-20 flex items-center gap-2 ${lang === "ar" ? "left-8" : "right-8"}`}>
              {heroMovies.map((m, idx) => (
                <button
                  key={m.id}
                  onClick={() => { setCurrentHeroIndex(idx); setHeroMovie(m); }}
                  className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                    idx === currentHeroIndex ? "w-8 bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" : "w-4 bg-white/30 hover:bg-white/60"
                  }`}
                  title={lang === "ar" ? m.titleAr : m.titleEn}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-6 ps-28 md:ps-32 pb-12 flex flex-col gap-6 -mt-4 relative z-20">
        {categories.map((cat) => {
          const isTop10Rail = cat.id === "top10";
          return (
            <div key={cat.id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span className="w-1.5 h-4 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
                  {lang === "ar" ? cat.titleAr : cat.titleEn}
                </h3>
                {cat.id === "collections" && (
                  <button
                    onClick={onSeeAllCollections}
                    className="text-xs font-black text-zinc-400 hover:text-white transition-all cursor-pointer flex items-center gap-1 bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-full border border-white/5"
                  >
                    <span>{lang === "ar" ? "عرض المزيد" : "See All"}</span>
                  </button>
                )}
              </div>

              <div className="relative group/rail">
                <div className="flex items-center gap-4 overflow-x-auto pt-10 pb-16 px-4 -my-8 no-scrollbar scroll-smooth">
                  {(cat.items || []).map((movie, cIdx) => {
                    const nodeId = `${cat.id}-${cIdx}`;
                    const isFocused = railNodes.isFocused(nodeId);
                    const ref = railNodes.getRef(nodeId);
                    if (movie.id === "show_more_collections") {
                      return (
                        <div
                          key="show-more-card"
                          ref={ref as React.RefCallback<HTMLDivElement>}
                          onClick={onSeeAllCollections}
                          className={`w-[145px] sm:w-[165px] h-[217.5px] sm:h-[247.5px] rounded-2xl flex-shrink-0 flex flex-col items-center justify-center border transition-all duration-300 cursor-pointer ${
                            isFocused
                              ? "bg-white text-zinc-950 border-white scale-[1.04] shadow-2xl shadow-white/10 font-black"
                              : "bg-zinc-900/40 hover:bg-zinc-900/80 border-white/5 text-zinc-400 hover:text-white font-bold"
                          }`}
                        >
                          <Plus className="w-8 h-8 mb-2 shrink-0" />
                          <span className="text-xs uppercase tracking-wider text-center px-2">{lang === "ar" ? "عرض الكل" : "Show All"}</span>
                        </div>
                      );
                    }

                    return (
                      <div key={movie.id} ref={ref as React.RefCallback<HTMLDivElement>}>
                        <MovieCard
                          movie={movie}
                          uniqueKey={nodeId}
                          isFocused={isFocused}
                          lang={lang}
                          hoveredCardKey={hoveredCardKey}
                          setHoveredCardKey={setHoveredCardKey}
                          onSelect={setSelectedMovie}
                          onPlay={(m) => {
                            setSelectedMovie(m);
                            setPlayingMovie(m);
                            setActiveServerIndex(0);
                          }}
                          favorites={favorites}
                          toggleFavorite={toggleFavorite}
                          progressPercent={watchProgress[movie.id]?.percent}
                          rankNumber={isTop10Rail && cIdx < 10 ? cIdx + 1 : undefined}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
