import React from "react";
import { Star, Play, Plus, Heart, Check, Lock, ShieldAlert } from "lucide-react";
import { Movie } from "../types";
import { getHighResImage } from "../utils/imageUtils";

export const formatQuality = (q: string) => {
  if (!q) return "FHD";
  const normalized = q.toUpperCase().trim();
  if (normalized === "ULTRA HD" || normalized === "UHD" || normalized.includes("4K") || normalized === "4K ULTRA") {
    return "4K";
  }
  if (normalized === "FULL HD" || normalized === "FHD" || normalized.includes("1080P") || normalized === "HD") {
    return "FHD";
  }
  return q;
};

export function formatMovieDuration(rawDuration?: string): string {
  if (!rawDuration) return "";
  const trimmed = rawDuration.trim();
  if (!trimmed) return "";

  // Check if it's series episode count e.g. "8 حلقات" / "8 Episodes" / "8 eps"
  const episodeMatch = trimmed.match(/^(\d+)\s*(?:حلقات|حلقة|episodes|ep|eps)$/i);
  if (episodeMatch) {
    return `${episodeMatch[1]} EPS`;
  }

  // Already standard format e.g. "1H 20M" or "2h 45m"
  const hmMatch = trimmed.match(/^(\d+)\s*h(?:our|ours)?\s*(\d+)?\s*m(?:in|ins|inutes)?$/i);
  if (hmMatch) {
    const hours = hmMatch[1];
    const mins = hmMatch[2] ? hmMatch[2] : "0";
    return `${hours}H ${mins}M`;
  }

  // Only hours e.g. "2h" or "2 hours"
  const hOnlyMatch = trimmed.match(/^(\d+)\s*h(?:our|ours)?$/i);
  if (hOnlyMatch) {
    return `${hOnlyMatch[1]}H 00M`;
  }

  // Arabic hours & minutes e.g. "2 ساعة و 15 دقيقة" or "ساعة و 30 دقيقة"
  if (trimmed.includes("ساعة") || trimmed.includes("دقيقة")) {
    let hours = 0;
    let mins = 0;

    const hNum = trimmed.match(/(\d+)\s*ساع/);
    if (hNum) {
      hours = parseInt(hNum[1], 10);
    } else if (trimmed.includes("ساعتان") || trimmed.includes("ساعتين")) {
      hours = 2;
    } else if (trimmed.includes("ساعة")) {
      hours = 1;
    }

    const mNum = trimmed.match(/(\d+)\s*دقيق/);
    if (mNum) {
      mins = parseInt(mNum[1], 10);
    }

    if (hours > 0 || mins > 0) {
      return `${hours}H ${mins}M`;
    }
  }

  // Only minutes e.g. "120 دقيقة" or "120m" or "120 min" or pure "120"
  const mOnlyMatch = trimmed.match(/^(\d+)\s*(?:m|min|mins|minutes|دقيقة|دقائق)?$/i);
  if (mOnlyMatch) {
    const totalMins = parseInt(mOnlyMatch[1], 10);
    if (!isNaN(totalMins) && totalMins > 0) {
      if (totalMins >= 60) {
        const hrs = Math.floor(totalMins / 60);
        const remainingMins = totalMins % 60;
        return `${hrs}H ${remainingMins}M`;
      }
      return `${totalMins}M`;
    }
  }

  return trimmed.toUpperCase().replace(/\s+/g, ' ');
}

interface MovieCardProps {
  key?: React.Key;
  movie: Movie;
  rIdx?: number;
  cIdx?: number;
  uniqueKey: string;
  isFocused: boolean;
  lang: "ar" | "en";
  hoveredCardKey: string | null;
  setHoveredCardKey: (key: string | null) => void;
  onSelect: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  favorites: Movie[];
  toggleFavorite: (movie: Movie) => void;
  progressPercent?: number;
  rankNumber?: number;
  showPartNumber?: boolean;
}

export default function MovieCard({
  movie,
  uniqueKey,
  isFocused,
  lang,
  hoveredCardKey,
  setHoveredCardKey,
  onSelect,
  onPlay,
  favorites,
  toggleFavorite,
  progressPercent,
  rankNumber,
  showPartNumber,
}: MovieCardProps) {
  const isCardActive = isFocused || hoveredCardKey === uniqueKey;
  const isFav = favorites.some((f) => f.id === movie.id);
  const cardRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [isFocused]);

  return (
    <div
      ref={cardRef}
      id={`movie-card-${uniqueKey}`}
      data-card-focused={isFocused ? "true" : "false"}
      onClick={() => onSelect(movie)}
      onMouseEnter={() => setHoveredCardKey(uniqueKey)}
      onMouseLeave={() => setHoveredCardKey(null)}
      className={`flex-shrink-0 relative select-none group/mcard cursor-pointer transition-all duration-300 ${
        rankNumber 
          ? "w-[145px] sm:w-[170px] md:w-[190px] lg:w-[210px] 2xl:w-[230px] flex items-end"
          : "w-[115px] sm:w-[130px] md:w-[145px] lg:w-[160px] 2xl:w-[175px]"
      }`}
    >
      {/* Giant Hollow Stroke Rank Number for Top 10 (Positioned on the inner/opposite side away from sidebar) */}
      {rankNumber && (
        <div 
          className={`stroke-number text-[55px] sm:text-[70px] md:text-[85px] lg:text-[98px] leading-none shrink-0 pointer-events-none select-none z-0 translate-y-1 drop-shadow-[0_8px_16px_rgba(0,0,0,0.95)] ${
            lang === "ar" ? "-ml-4 sm:-ml-5 md:-ml-6 order-2" : "-mr-4 sm:-mr-5 md:-mr-6 order-first"
          }`}
          dir="ltr"
        >
          {rankNumber}
        </div>
      )}

      <div className={`flex flex-col w-full relative z-10 ${lang === "ar" ? "text-right" : "text-left"}`}>
        {/* Upper Image Container (Aspect 2/3 Portrait Poster) */}
        <div
          className={`relative w-full aspect-[2/3] rounded-sm overflow-hidden transition-all duration-300 ease-out border ${
            isCardActive
              ? "scale-[1.04] z-10 border-white bg-[#0a0e1a] shadow-[0_15px_35px_rgba(255,255,255,0.25)] ring-1 ring-white"
              : "border-zinc-800 bg-[#060913]"
          }`}
        >
          <img
            src={getHighResImage(movie.poster || movie.backdrop, false)}
            alt={movie.titleEn}
            className={`w-full h-full object-cover transition-transform duration-500 ease-out ${
              isCardActive ? "scale-105 brightness-[0.75]" : "brightness-[0.78] group-hover/mcard:brightness-[0.88]"
            }`}
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.src = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
            }}
          />
          
          {/* Enhanced Image Overlay Gradient */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-100" />

          {/* Top Left Badge Tag: Standalone Part Number or Type Badge */}
          <div className="absolute top-2 left-2 z-20 flex items-center pointer-events-none" dir="ltr">
            {movie.partNumber ? (
              <span className="text-xl sm:text-2xl font-black font-num text-white leading-none tracking-tighter drop-shadow-[0_4px_12px_rgba(0,0,0,1)] select-none">
                {movie.partNumber}
              </span>
            ) : rankNumber ? (
              <span className="px-2 py-0.5 rounded-none bg-black/80 backdrop-blur-md border border-white/20 text-white font-extrabold text-[8.5px] sm:text-[9.5px] uppercase tracking-wider shadow-md">
                {movie.type === "series" ? (lang === "ar" ? "مسلسل" : "SERIES") : (lang === "ar" ? "فيلم" : "FILM")}
              </span>
            ) : null}
          </div>

          {/* Centered Premium Play Icon Overlay */}
          <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-all duration-300 ${
            isCardActive ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`}>
            <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center shadow-2xl shadow-black/80 ring-4 ring-white/20">
              <Play className="w-4 h-4 fill-black text-black ml-0.5" />
            </div>
          </div>

          {/* Quality Badge on Bottom-Left */}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-black/75 backdrop-blur-md border border-white/10 text-white font-black text-[7.5px] uppercase select-none">
            <span className={`w-1 h-1 rounded-full transition-colors ${isCardActive ? "bg-white animate-pulse" : "bg-white/60"}`} />
            {formatQuality(movie.quality)}
          </div>

          {/* Duration Badge */}
          {movie.duration && formatMovieDuration(movie.duration) && (
            <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/85 backdrop-blur-md rounded-none text-[8.5px] sm:text-[9.5px] font-black text-white font-num tracking-wider border border-white/10 uppercase shadow-md select-none">
              {formatMovieDuration(movie.duration)}
            </span>
          )}

          {/* Progress Bar overlay at the bottom if progressPercent is provided */}
          {typeof progressPercent === "number" && progressPercent > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-20 pointer-events-none overflow-hidden rounded-b-none">
              <div 
                className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] transition-all duration-300" 
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }} 
              />
            </div>
          )}
        </div>

        {/* Lower Content Details Section */}
        <div className={`mt-2 px-0.5 flex flex-col gap-0.5 ${lang === "ar" ? "text-right" : "text-left"}`}>
          {/* Title with default Cairo font and reduced font weight */}
          <h4 className={`text-[12px] sm:text-[13px] font-medium leading-snug tracking-normal truncate transition-colors ${
            isCardActive ? "text-white drop-shadow-[0_2px_8px_rgba(255,255,255,0.3)]" : "text-zinc-200 group-hover/mcard:text-white"
          }`}>
            {lang === "ar" ? movie.titleAr : movie.titleEn}
          </h4>

          {/* Minimal Production Year & Premium IMDb Rating Badge */}
          <div className="flex flex-row items-center gap-1.5 text-[9.5px] sm:text-[10.5px] text-zinc-400 font-semibold mt-0.5 select-none">
            {/* IMDb Official Design Badge */}
            <div className="flex items-center gap-1">
              <span className="bg-[#F5C518] text-[#000000] font-black px-1 py-0.5 rounded-[3px] text-[7.5px] sm:text-[8px] tracking-tight leading-none uppercase font-sans">
                IMDb
              </span>
              <span className="font-num text-[11px] sm:text-[11.5px] font-black text-white leading-none">
                {movie.rating}
              </span>
            </div>
            
            <span className="text-zinc-800 font-normal select-none">•</span>
            
            {/* Production Year */}
            <span className="font-num text-[11px] sm:text-[11.5px] font-black text-zinc-400 leading-none">
              {movie.year}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

