import React from "react";
import CtvLogo from "./CtvLogo";

interface SplashScreenProps {
  lang?: "ar" | "en";
  onDismiss?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  lang = "ar",
  onDismiss
}) => {
  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#090b11] overflow-hidden select-none cursor-pointer"
    >
      {/* Static background - no remote images to fetch, so the splash never itself
          becomes the slow thing users are waiting on (it used to load a poster collage
          of up to 18 images, several from external URLs, right when the connection is
          least likely to be fast/available yet). */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0d1018] via-[#090b11] to-black" />
      <div className="absolute w-80 h-80 bg-white/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="relative z-10 flex flex-col items-center justify-center gap-6 px-4 text-center">
        <div className="relative group flex items-center justify-center">
          <div className="absolute -inset-4 bg-gradient-to-r from-white/10 via-white/20 to-white/10 rounded-full blur-2xl opacity-80 animate-pulse" />
          <CtvLogo className="w-24 h-14 sm:w-32 sm:h-18 md:w-38 md:h-20 text-white drop-shadow-[0_0_25px_rgba(255,255,255,0.35)]" />
        </div>

        <div className="flex flex-col items-center gap-3 mt-1">
          <div className="relative flex items-center justify-center w-10 h-10">
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
