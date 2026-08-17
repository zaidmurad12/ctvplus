import { Film, Heart, Home, Search, Settings, Tv } from "lucide-react";
import { useFocusNode, useFocusZone } from "../hooks/useFocusNav";
import CtvLogo from "./CtvLogo";

interface SidebarItem {
  icon: typeof Home;
  labelAr: string;
  labelEn: string;
}

const ITEMS: SidebarItem[] = [
  { icon: Home, labelAr: "الرئيسية", labelEn: "Home" },
  { icon: Search, labelAr: "البحث الذكي", labelEn: "AI Search" },
  { icon: Tv, labelAr: "المسلسلات", labelEn: "Series" },
  { icon: Film, labelAr: "الأفلام", labelEn: "Movies" },
  { icon: Heart, labelAr: "قائمتي", labelEn: "Favorites" },
  { icon: Settings, labelAr: "الإعدادات", labelEn: "Settings" },
];

interface SidebarProps {
  lang: "ar" | "en";
  /** Index (0-5) of the section currently being viewed — kept highlighted even
   * when keyboard focus isn't on the sidebar itself. */
  activeIndex: number;
  /** Called with the item's index both on "ok" and on leaving the sidebar toward
   * content (both mean the same thing here: enter whichever item is highlighted). */
  onSelect: (index: number) => void;
  /** Called when the user backs out of the sidebar toward content without picking an
   * item (moving further "right" — physical Right in LTR, physical Left in RTL, i.e.
   * the opposite of the direction that opened the sidebar in the first place). */
  onExit: () => void;
}

export function Sidebar({ lang, activeIndex, onSelect, onExit }: SidebarProps) {
  useFocusZone({
    id: "sidebar",
    layout: () => ITEMS.map((_, i) => [String(i)]),
    onEdge: (dir, row) => {
      if (dir === "left") {
        onSelect(row);
        return "stay";
      }
      if (dir === "right") {
        onExit();
        return "stay";
      }
      return;
    },
  });

  return (
    <div
      id="tv-sidebar"
      // Tailwind's start-0 (inset-inline-start) is supposed to flip with dir
      // automatically, but the production build's CSS minifier resolves it down to a
      // fixed physical left/right at build time instead of leaving it direction-aware -
      // invisible for as long as the production build had no styling at all, but once
      // that got fixed the sidebar was hardcoded to one physical side regardless of
      // language. Resolve the side from lang directly instead of relying on the CSS.
      className={`absolute inset-y-0 ${lang === "ar" ? "right-0" : "left-0"} z-40 bg-transparent transition-all duration-300 flex flex-col justify-between py-6 w-20 items-center pointer-events-none`}
    >
      <div
        className="flex items-center justify-center pt-2 pb-2 cursor-pointer transition-transform duration-300 hover:scale-105 pointer-events-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
        onClick={() => onSelect(0)}
        title="ctv"
      >
        <CtvLogo className="w-16 h-10" />
      </div>

      <div className="flex-1 flex flex-col justify-center items-center gap-3.5 w-full my-auto pointer-events-auto">
        {ITEMS.map((item, index) => {
          const { isFocused, ref } = useFocusNode({ zoneId: "sidebar", id: String(index), onSelect: () => onSelect(index) });
          const isActive = activeIndex === index;
          const IconComponent = item.icon;
          return (
            <button
              ref={ref as React.RefObject<HTMLButtonElement>}
              key={index}
              title={lang === "ar" ? item.labelAr : item.labelEn}
              onClick={() => onSelect(index)}
              className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all duration-300 cursor-pointer group pointer-events-auto ${
                isFocused
                  ? "bg-white text-black scale-105 z-30 shadow-lg shadow-white/20"
                  : isActive
                    ? "bg-neutral-800/90 backdrop-blur-md text-white font-bold shadow-md shadow-black/50"
                    : "bg-black/30 hover:bg-black/60 text-neutral-400 hover:text-white backdrop-blur-sm"
              }`}
            >
              <IconComponent
                className={`transition-all duration-300 ${
                  isFocused
                    ? "w-5 h-5 text-black scale-110"
                    : isActive
                      ? "w-5 h-5 text-white scale-110"
                      : "w-4.5 h-4.5 text-neutral-400 group-hover:text-neutral-200 group-hover:scale-105"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="w-16 h-10 pointer-events-none" />
    </div>
  );
}
