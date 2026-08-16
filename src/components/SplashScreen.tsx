import React from "react";
import CtvLogo from "./CtvLogo";
import { getHighResImage } from "../utils/imageUtils";

interface SplashScreenProps {
  posters?: string[];
  lang?: "ar" | "en";
  onDismiss?: () => void;
}

const DEFAULT_POSTERS = [
  "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1920&q=95",
  "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=1920&q=95",
  "https://images.unsplash.com/photo-1635805737707-575885ab0820?w=1920&q=95",
  "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1920&q=95",
  "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1920&q=95",
  "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95",
  "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=95",
  "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1920&q=95",
  "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=1920&q=95",
  "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=1920&q=95",
  "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1920&q=95",
  "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=1920&q=95"
];

export const SplashScreen: React.FC<SplashScreenProps> = ({
  posters = [],
  lang = "ar",
  onDismiss
}) => {
  // Combine real loaded posters with default poster list to fill poster collage grid
  const posterList = Array.from(
    new Set([
      ...posters.filter((p) => p && typeof p === "string"),
      ...DEFAULT_POSTERS
    ])
  ).slice(0, 18);

  return (
    <div 
      onClick={onDismiss} 
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black overflow-hidden select-none transition-opacity duration-500 cursor-pointer"
    >
      {/* 1. BACKGROUND MOVIE POSTERS COLLAGE GRID */}
      <div className="absolute inset-0 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-6 gap-2.5 p-2 opacity-35 scale-105 pointer-events-none transform transition-transform duration-1000 ease-out">
        {posterList.map((posterUrl, idx) => (
          <div 
            key={idx} 
            className="w-full h-full rounded-xl overflow-hidden bg-neutral-900 shadow-lg border border-white/5"
          >
            <img 
              src={getHighResImage(posterUrl, false)} 
              alt="Movie Poster" 
              className="w-full h-full object-cover rounded-xl filter brightness-85 contrast-105"
              onError={(e) => {
                e.currentTarget.src = DEFAULT_POSTERS[idx % DEFAULT_POSTERS.length];
              }}
            />
          </div>
        ))}
      </div>

      {/* 2. DARK OVERLAY LAYER */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/85 to-black/75 backdrop-blur-[2px]" />

      {/* Radial soft glow behind logo */}
      <div className="absolute w-80 h-80 bg-white/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

      {/* 3. CENTER CONTENT (CTV LOGO + SPINNER) */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-6 px-4 text-center">
        {/* CTV Logo */}
        <div className="relative group flex items-center justify-center">
          <div className="absolute -inset-4 bg-gradient-to-r from-white/10 via-white/20 to-white/10 rounded-full blur-2xl opacity-80 animate-pulse" />
          <CtvLogo className="w-24 h-14 sm:w-32 sm:h-18 md:w-38 md:h-20 text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.35)]" />
        </div>

        {/* Loading Indicator Spinner below logo */}
        <div className="flex flex-col items-center gap-3 mt-1">
          <div className="relative flex items-center justify-center w-10 h-10">
            {/* Outer spinning ring */}
            <div className="absolute inset-0 rounded-full border-3 border-white/15 border-t-white border-r-white/60 animate-spin" />
          </div>

          <span className="text-sm font-medium text-neutral-300 tracking-wider font-sans animate-pulse">
            {lang === "ar" ? "جاري التحميل..." : "Loading..."}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SplashScreen;
