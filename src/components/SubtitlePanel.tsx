import { Globe, SlidersHorizontal, X } from "lucide-react";
import { useFocusZone, useFocusNode } from "../hooks/useFocusNav";
import { safeStorage } from "../utils/safeStorage";

const FOCUS_RING = "ring-2 ring-white ring-offset-2 ring-offset-zinc-950";

interface SubtitlePanelProps {
  lang: "ar" | "en";
  playerSubtitles: string;
  setPlayerSubtitles: (v: string) => void;
  subColor: string;
  setSubColor: (v: string) => void;
  subSize: string;
  setSubSize: (v: string) => void;
  subFont: string;
  setSubFont: (v: string) => void;
  subShadow: boolean;
  setSubShadow: (v: boolean) => void;
  showControlsAndResetTimer: () => void;
  setPlayerToast: (v: string | null) => void;
  onClose: () => void;
}

const LANGUAGE_OPTIONS = [
  { id: "off", labelAr: "إيقاف", labelEn: "Off" },
  { id: "ar", labelAr: "العربية", labelEn: "Arabic" },
  { id: "en", labelAr: "English", labelEn: "English" },
];

const COLOR_OPTIONS = [
  { id: "yellow", hex: "#facc15", labelAr: "أصفر", labelEn: "Yellow" },
  { id: "white", hex: "#ffffff", labelAr: "أبيض", labelEn: "White" },
  { id: "cyan", hex: "#22d3ee", labelAr: "سماوي", labelEn: "Cyan" },
  { id: "green", hex: "#4ade80", labelAr: "أخضر", labelEn: "Green" },
];

const SIZE_OPTIONS = [
  { id: "small", labelAr: "صغير", labelEn: "Small" },
  { id: "medium", labelAr: "وسط", labelEn: "Medium" },
  { id: "large", labelAr: "كبير", labelEn: "Large" },
  { id: "xl", labelAr: "ضخم", labelEn: "Huge" },
];

const FONT_OPTIONS = [
  { id: "Cairo", fontClass: "font-['Cairo']", label: "Cairo" },
  { id: "Tajawal", fontClass: "font-['Tajawal']", label: "Tajawal" },
  { id: "Amiri", fontClass: "font-['Amiri']", label: "Amiri" },
  { id: "JetBrains_Mono", fontClass: "font-mono", label: "Mono" },
];

export function SubtitlePanel(props: SubtitlePanelProps) {
  const { lang, showControlsAndResetTimer, setPlayerToast, onClose } = props;

  useFocusZone({
    id: "player.subtitle-panel",
    parentZoneId: "player.controls",
    layout: () => [
      LANGUAGE_OPTIONS.map((o) => `lang-${o.id}`),
      COLOR_OPTIONS.map((o) => `color-${o.id}`),
      SIZE_OPTIONS.map((o) => `size-${o.id}`),
      FONT_OPTIONS.map((o) => `font-${o.id}`),
      ["shadow-toggle"],
    ],
    onBack: () => {
      onClose();
      return true;
    },
    onEdge: (dir) => {
      // Trap focus inside the panel: Up at the top row does nothing (doesn't escape
      // to the trigger button behind it), Down past the last row closes the panel
      // (same effect as Back), and Left/Right at a row's edge stays put rather than
      // leaking out to the player controls underneath.
      if (dir === "down") {
        onClose();
        return "stay";
      }
      return "stay";
    },
  });

  function useOptionFocus(nodeId: string, onSelect: () => void) {
    return useFocusNode({ zoneId: "player.subtitle-panel", id: nodeId, onSelect });
  }

  return (
    <div
      className="absolute bottom-full mb-3 right-0 rtl:left-0 rtl:right-auto w-[calc(100vw-2.5rem)] max-w-sm sm:w-96 bg-zinc-950/98 border border-white/10 backdrop-blur-3xl p-5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.95)] z-[60] flex flex-col gap-4 animate-fade-in"
      dir={lang === "ar" ? "rtl" : "ltr"}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-white/5 pb-3">
        <h4 className="text-xs font-black uppercase text-zinc-400 tracking-wider flex items-center gap-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-white" />
          {lang === "ar" ? "إعدادات ومظهر الترجمة" : "Subtitle Settings & Style"}
        </h4>
        <button onClick={onClose} className="p-1 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 cursor-pointer transition-all duration-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Subtitle Language Selector */}
      <div className="flex flex-col gap-1.5 border-b border-white/5 pb-3.5">
        <span className="text-xs text-zinc-400 font-bold flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5 text-zinc-500" />
          {lang === "ar" ? "لغة الترجمة:" : "Subtitle Language:"}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGE_OPTIONS.map((opt) => {
            const handleSelect = () => {
              props.setPlayerSubtitles(opt.id);
              const subtitleLabelsAr: Record<string, string> = { ar: "العربية", en: "الإنجليزية", off: "إيقاف الترجمة" };
              const subtitleLabelsEn: Record<string, string> = { ar: "Arabic", en: "English", off: "Subtitles Off" };
              setPlayerToast(lang === "ar" ? `الترجمة: ${subtitleLabelsAr[opt.id]} 💬` : `Subtitles: ${subtitleLabelsEn[opt.id]} 💬`);
              showControlsAndResetTimer();
            };
            const { isFocused, ref } = useOptionFocus(`lang-${opt.id}`, handleSelect);
            return (
              <button
                key={opt.id}
                ref={ref as React.RefObject<HTMLButtonElement>}
                onClick={handleSelect}
                className={`py-2 rounded-xl border text-[11px] font-bold cursor-pointer transition-all duration-200 ${isFocused ? FOCUS_RING : ""} ${
                  props.playerSubtitles === opt.id
                    ? "bg-white border-white text-zinc-950 shadow-[0_4px_12px_rgba(255,255,255,0.25)]"
                    : "bg-zinc-900/40 border-white/5 hover:border-zinc-700 hover:bg-zinc-900/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {lang === "ar" ? opt.labelAr : opt.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Color Options */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-400 font-bold">{lang === "ar" ? "لون النص:" : "Text Color:"}</span>
        <div className="grid grid-cols-4 gap-2">
          {COLOR_OPTIONS.map((c) => {
            const handleSelect = () => {
              props.setSubColor(c.id);
              safeStorage.setItem("cinemana_sub_color", c.id);
              showControlsAndResetTimer();
            };
            const { isFocused, ref } = useOptionFocus(`color-${c.id}`, handleSelect);
            return (
              <button
                key={c.id}
                ref={ref as React.RefObject<HTMLButtonElement>}
                onClick={handleSelect}
                className={`flex items-center justify-center gap-1.5 py-2 px-1 rounded-xl border cursor-pointer transition-all duration-200 ${isFocused ? FOCUS_RING : ""} ${
                  props.subColor === c.id
                    ? "bg-white/10 border-white text-white shadow-[0_0_12px_rgba(255,255,255,0.1)]"
                    : "bg-zinc-900/40 border-white/5 hover:border-zinc-700 hover:bg-zinc-900/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shadow-inner border border-white/10 shrink-0" style={{ backgroundColor: c.hex }} />
                <span className="text-[10px] font-semibold">{lang === "ar" ? c.labelAr : c.labelEn}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Size Options */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-400 font-bold">{lang === "ar" ? "حجم الخط:" : "Font Size:"}</span>
        <div className="grid grid-cols-4 gap-1.5">
          {SIZE_OPTIONS.map((s) => {
            const handleSelect = () => {
              props.setSubSize(s.id);
              safeStorage.setItem("cinemana_sub_size", s.id);
              showControlsAndResetTimer();
            };
            const { isFocused, ref } = useOptionFocus(`size-${s.id}`, handleSelect);
            return (
              <button
                key={s.id}
                ref={ref as React.RefObject<HTMLButtonElement>}
                onClick={handleSelect}
                className={`py-2 rounded-xl border text-[11px] font-bold cursor-pointer transition-all duration-200 ${isFocused ? FOCUS_RING : ""} ${
                  props.subSize === s.id
                    ? "bg-white/10 border-white text-white shadow-[0_0_12px_rgba(255,255,255,0.1)]"
                    : "bg-zinc-900/40 border-white/5 hover:border-zinc-700 hover:bg-zinc-900/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {lang === "ar" ? s.labelAr : s.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* Font Options */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-400 font-bold">{lang === "ar" ? "نوع الخط والنمط:" : "Font Family:"}</span>
        <div className="grid grid-cols-2 gap-2">
          {FONT_OPTIONS.map((f) => {
            const handleSelect = () => {
              props.setSubFont(f.id);
              safeStorage.setItem("cinemana_sub_font", f.id);
              showControlsAndResetTimer();
            };
            const { isFocused, ref } = useOptionFocus(`font-${f.id}`, handleSelect);
            return (
              <button
                key={f.id}
                ref={ref as React.RefObject<HTMLButtonElement>}
                onClick={handleSelect}
                className={`py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all duration-200 ${f.fontClass} ${isFocused ? FOCUS_RING : ""} ${
                  props.subFont === f.id
                    ? "bg-white/10 border-white text-white shadow-[0_0_12px_rgba(255,255,255,0.1)]"
                    : "bg-zinc-900/40 border-white/5 hover:border-zinc-700 hover:bg-zinc-900/80 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Background Shadow Toggle */}
      <div className="flex items-center justify-between border-t border-white/5 pt-3.5">
        <span className="text-xs text-zinc-400 font-bold">{lang === "ar" ? "خلفية النص السوداء:" : "Dark Text Background:"}</span>
        {(() => {
          const handleSelect = () => {
            props.setSubShadow(!props.subShadow);
            safeStorage.setItem("cinemana_sub_shadow", String(!props.subShadow));
            showControlsAndResetTimer();
          };
          const { isFocused, ref } = useOptionFocus("shadow-toggle", handleSelect);
          return (
            <button
              ref={ref as React.RefObject<HTMLButtonElement>}
              onClick={handleSelect}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${isFocused ? FOCUS_RING : ""} ${
                props.subShadow ? "bg-white" : "bg-zinc-850"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4.5 w-4.5 transform rounded-full shadow ring-0 transition duration-200 ease-in-out ${
                  props.subShadow ? "bg-zinc-950" : "bg-white"
                } ${props.subShadow ? (lang === "ar" ? "-translate-x-5" : "translate-x-5") : "translate-x-0"}`}
              />
            </button>
          );
        })()}
      </div>
    </div>
  );
}
