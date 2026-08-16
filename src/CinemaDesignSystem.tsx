import React, { useState } from "react";
import { 
  ChevronDown, Play, Heart, Star, Film, Tv, Info, Check, Search, 
  Settings, ArrowRight, ArrowLeft, Volume2, Maximize, RotateCcw, 
  Grid, Plus, Trash2, Edit, Download, RefreshCw, X
} from "lucide-react";

/**
 * ============================================================================
 * CINEMANA TV - FULL UI/UX DESIGN SYSTEM & COMPLETE VIEW TEMPLATES
 * ============================================================================
 * 
 * This file contains all UI components, design tokens, and full screen views
 * designed for Cinema / TV applications in a clean Black & White palette.
 * 
 * You can copy this single file into any React + Tailwind CSS project!
 */

// ============================================================================
// 1. DESIGN TOKENS
// ============================================================================
export const CINEMA_TOKENS = {
  colors: {
    bgApp: "bg-black text-white font-sans",
    bgSurface: "bg-[#060913]",
    bgActiveCard: "bg-[#0a0e1a]",
    borderMuted: "border-zinc-800",
    borderBright: "border-white/20",
    borderFocus: "border-white",
    ringFocus: "ring-2 ring-white scale-105 shadow-[0_0_20px_rgba(255,255,255,0.4)]",
  },
  card: {
    sharpPoster: "relative w-full aspect-[2/3] rounded-sm overflow-hidden transition-all duration-300 ease-out border",
    focusedCard: "scale-[1.04] z-10 border-white bg-[#0a0e1a] shadow-[0_15px_35px_rgba(255,255,255,0.25)] ring-1 ring-white",
    normalCard: "border-zinc-800 bg-[#060913]",
  },
  dropdown: {
    button: "flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg cursor-pointer border border-white/20 hover:border-white",
    menu: "absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[150px] max-h-64 overflow-y-auto z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl",
    activeItem: "text-black bg-white font-extrabold shadow-sm",
    item: "w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer text-zinc-300 hover:text-white hover:bg-zinc-900",
  },
  buttons: {
    primaryTV: "px-5 py-2.5 rounded-lg font-black text-xs bg-white text-black hover:bg-zinc-200 transition-all cursor-pointer flex items-center gap-2 shadow-lg",
    secondaryTV: "px-4 py-2.5 rounded-lg font-bold text-xs bg-black/80 text-white border border-white/20 hover:border-white transition-all cursor-pointer flex items-center gap-2",
  }
};

// ============================================================================
// 2. REUSABLE ATOMIC UI COMPONENTS
// ============================================================================

export const TVButton: React.FC<{
  variant?: "primary" | "secondary" | "ghost";
  isFocused?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}> = ({ variant = "primary", isFocused = false, icon, children, onClick, className = "" }) => {
  const baseStyle = "px-5 py-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer select-none";
  let variantStyle = "bg-white text-black hover:bg-zinc-200";
  if (variant === "secondary") variantStyle = "bg-black/80 text-white border border-white/20 hover:border-white";
  else if (variant === "ghost") variantStyle = "bg-transparent text-zinc-300 hover:text-white";

  const focusStyle = isFocused ? "border-white ring-2 ring-white scale-105 bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.5)] z-20" : "";
  return (
    <button onClick={onClick} className={`${baseStyle} ${variantStyle} ${focusStyle} ${className}`}>
      {icon}
      <span>{children}</span>
    </button>
  );
};

export const CinemaDropdown: React.FC<{
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  options: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  isFocused?: boolean;
}> = ({ label, isOpen, onToggle, options, selectedId, onSelect, isFocused = false }) => (
  <div className="relative inline-block text-left">
    <button onClick={onToggle} className={`${CINEMA_TOKENS.dropdown.button} ${isFocused ? "border-white ring-2 ring-white scale-105" : ""}`}>
      <span>{options.find((o) => o.id === selectedId)?.label || label}</span>
      <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
    </button>
    {isOpen && (
      <div className={CINEMA_TOKENS.dropdown.menu}>
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className={`${CINEMA_TOKENS.dropdown.item} ${opt.id === selectedId ? CINEMA_TOKENS.dropdown.activeItem : ""}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )}
  </div>
);

export const CinemaQualityBadge: React.FC<{ quality?: string; isFocused?: boolean }> = ({ quality = "Full HD", isFocused = false }) => (
  <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-black/80 backdrop-blur-md border border-white/20 text-white font-black text-[8px] uppercase select-none">
    <span className={`w-1 h-1 rounded-full ${isFocused ? "bg-white animate-pulse" : "bg-white/70"}`} />
    <span>{quality}</span>
  </div>
);

export const CinemaMovieCard: React.FC<{
  title: string;
  posterUrl: string;
  year?: string | number;
  rating?: number;
  quality?: string;
  duration?: string;
  partNumber?: string | number;
  isFocused?: boolean;
  onClick?: () => void;
}> = ({ title, posterUrl, year, rating, quality = "Full HD", duration, partNumber, isFocused = false, onClick }) => (
  <div onClick={onClick} className={`relative group cursor-pointer transition-all duration-300 ${isFocused ? "scale-105 z-20" : "hover:scale-102"}`}>
    <div className={`${CINEMA_TOKENS.card.sharpPoster} ${isFocused ? CINEMA_TOKENS.card.focusedCard : CINEMA_TOKENS.card.normalCard}`}>
      <img src={posterUrl} alt={title} className="w-full h-full object-cover" loading="lazy" />
      {partNumber && (
        <div className="absolute top-2 left-2 z-20">
          <span className="text-xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)] italic">{partNumber}</span>
        </div>
      )}
      <div className="absolute bottom-2 left-2">
        <CinemaQualityBadge quality={quality} isFocused={isFocused} />
      </div>
      {duration && (
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/85 rounded-none text-[9px] font-black text-white border border-white/20 uppercase">
          {duration}
        </span>
      )}
    </div>
    <div className="mt-2 text-left">
      <h4 className="text-xs font-bold text-white truncate">{title}</h4>
      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-zinc-400">
        {year && <span>{year}</span>}
        {rating && (
          <span className="flex items-center gap-0.5 text-white font-bold">
            <Star className="w-2.5 h-2.5 fill-current text-white" />
            {rating}
          </span>
        )}
      </div>
    </div>
  </div>
);

// ============================================================================
// 3. COMPLETE SCREEN / VIEW TEMPLATES
// ============================================================================

// VIEW 1: HERO BANNER & SHOWCASE VIEW (الواجهة الرئيسية والبنر العلوي)
export const HeroBannerViewTemplate: React.FC = () => (
  <div className="relative w-full h-[450px] overflow-hidden bg-black text-white border-b border-zinc-800">
    <img 
      src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1920&q=80" 
      alt="Hero Backdrop" 
      className="absolute inset-0 top-0 w-full h-full object-cover object-top brightness-[0.85] contrast-[1.05]"
    />
    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
    <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent" />
    
    <div className="relative z-10 p-8 md:p-12 h-full flex flex-col justify-end max-w-2xl gap-3">
      <div className="flex items-center gap-2 text-xs font-bold text-zinc-300">
        <span className="px-2 py-0.5 bg-white text-black font-black uppercase rounded-sm">4K ULTRA HD</span>
        <span>2024</span>
        <span>•</span>
        <span>2h 45m</span>
      </div>
      <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight">INCEPTION: THE FINAL CHAPTER</h1>
      <p className="text-xs md:text-sm text-zinc-300 line-clamp-2 leading-relaxed">
        A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.
      </p>
      <div className="flex items-center gap-3 mt-2">
        <TVButton variant="primary" icon={<Play className="w-4 h-4 fill-current" />}>شاهد الآن (Play Now)</TVButton>
        <TVButton variant="secondary" icon={<Info className="w-4 h-4" />}>التفاصيل (Details)</TVButton>
      </div>
    </div>
  </div>
);

// VIEW 2: DETAILS MODAL VIEW (واجهة معلومات الفيلم/المسلسل والأجزاء)
export const MovieDetailsViewTemplate: React.FC = () => (
  <div className="relative w-full min-h-[500px] bg-zinc-950 text-white p-6 md:p-12 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
    <div className="flex flex-col md:flex-row gap-8">
      <div className="w-48 aspect-[2/3] rounded-sm overflow-hidden border border-white/20 shrink-0">
        <img src="https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80" alt="Poster" className="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-3 justify-center">
        <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">المسلسل التلفزيوني • TV SHOW</span>
        <h2 className="text-3xl font-black text-white">THE DARK KNIGHT RISES</h2>
        <div className="flex items-center gap-3 text-xs font-bold text-zinc-300">
          <span className="flex items-center gap-1 text-white font-black"><Star className="w-3.5 h-3.5 fill-current" /> 9.0</span>
          <span>•</span>
          <span>2023</span>
          <span>•</span>
          <span className="px-1.5 py-0.5 bg-zinc-800 border border-white/10 rounded-sm">PG-13</span>
        </div>
        <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
          ثماني سنوات بعد عهد الجوكر، يُجبر باتمان على الخروج من منفاه بمساعدة سيلفينا كايل لحماية مدينة غوثام من الإرهابي بين.
        </p>
        <div className="flex items-center gap-3 mt-3">
          <TVButton variant="primary" icon={<Play className="w-4 h-4 fill-current" />}>تشغيل الحلقة 1</TVButton>
          <TVButton variant="secondary" icon={<Heart className="w-4 h-4" />}>المفضلة</TVButton>
        </div>
      </div>
    </div>

    {/* Episodes/Parts Row */}
    <div className="mt-10 border-t border-zinc-800 pt-6">
      <h3 className="text-base font-bold text-white mb-4">أجزاء العمل وسلسلة الأفلام (Movie Franchise & Parts)</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {["Part 1", "Part 2", "Part 3", "Part 4"].map((part, idx) => (
          <div key={idx} className="bg-black p-3 border border-white/20 rounded-lg flex items-center gap-3 hover:border-white transition-all cursor-pointer">
            <span className="text-lg font-black text-white">{idx + 1}</span>
            <div>
              <p className="text-xs font-bold text-white">{part}</p>
              <p className="text-[10px] text-zinc-400">120 min • 4K</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// VIEW 3: VIDEO PLAYER OVERLAY VIEW (واجهة مشغل الفيديو والتحكم)
export const PlayerOverlayViewTemplate: React.FC = () => (
  <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-zinc-800 shadow-2xl flex flex-col justify-between p-6">
    {/* Video Background Mock */}
    <div className="absolute inset-0 bg-neutral-900 flex items-center justify-center text-zinc-700 font-mono text-sm">
      [ Video Stream Canvas / HLS Player ]
    </div>

    {/* Top Controls Bar */}
    <div className="relative z-10 flex items-center justify-between bg-black/80 backdrop-blur-md px-4 py-2.5 rounded-lg border border-white/10">
      <div className="flex items-center gap-3">
        <button className="p-1.5 rounded bg-white/10 text-white hover:bg-white/20"><ArrowRight className="w-4 h-4" /></button>
        <div>
          <h4 className="text-xs font-bold text-white">Oppenheimer (2023)</h4>
          <p className="text-[10px] text-zinc-400">Full HD • Dual Audio</p>
        </div>
      </div>
      <span className="text-xs font-mono font-bold text-white">01:42:10 / 03:00:00</span>
    </div>

    {/* Bottom Playback Bar */}
    <div className="relative z-10 flex flex-col gap-3 bg-black/80 backdrop-blur-md p-4 rounded-lg border border-white/10">
      <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden cursor-pointer">
        <div className="bg-white h-full w-2/3 shadow-[0_0_10px_white]" />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="p-2 rounded bg-white text-black font-bold"><Play className="w-4 h-4 fill-current" /></button>
          <button className="p-2 rounded bg-white/10 text-white hover:bg-white/20"><Volume2 className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-2">
          <TVButton variant="secondary" className="!px-3 !py-1 text-[11px]">الجودة: 1080p</TVButton>
          <TVButton variant="secondary" className="!px-3 !py-1 text-[11px]">الترجمة: العربية</TVButton>
          <button className="p-2 rounded bg-white/10 text-white hover:bg-white/20"><Maximize className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  </div>
);

// VIEW 4: SEARCH INTERFACE VIEW (واجهة البحث الشاملة)
export const SearchViewTemplate: React.FC = () => {
  const [query, setQuery] = useState("");
  return (
    <div className="w-full bg-black text-white p-6 md:p-8 border border-zinc-800 rounded-xl space-y-6">
      {/* Search Bar */}
      <div className="relative w-full max-w-2xl mx-auto">
        <Search className="absolute left-4 top-3.5 w-4 h-4 text-zinc-400" />
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن فيلم، مسلسل، ممثل، أو تصنيف..."
          className="w-full bg-zinc-950 border border-white/20 rounded-lg pl-11 pr-4 py-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all font-bold"
        />
        {query && (
          <button onClick={() => setQuery("")} className="absolute right-3 top-3 text-zinc-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* On-Screen Keyboard Mock */}
      <div className="max-w-xl mx-auto bg-zinc-950 p-4 border border-zinc-800 rounded-lg">
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {["أ","ب","ت","ث","ج","ح","خ","د","ذ","ر","ز","س","ش","ص","ض","ط","ظ","ع","غ","ف","ق","ك","ل","م","ن","هـ","و","ي"].map((char) => (
            <button key={char} onClick={() => setQuery(prev => prev + char)} className="py-2 bg-black hover:bg-white hover:text-black border border-zinc-800 rounded text-xs font-bold transition-all">
              {char}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// VIEW 5: ADMIN CONTROL PANEL TEMPLATE (واجهة لوحة تحكم الأدمن)
export const AdminPanelViewTemplate: React.FC = () => (
  <div className="w-full bg-black text-white p-6 border border-zinc-800 rounded-xl space-y-6">
    <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
      <div>
        <h2 className="text-xl font-black text-white">لوحة تحكم Cinemana TV</h2>
        <p className="text-xs text-zinc-400">إدارة واستيراد الأفلام والمسلسلات وتعديل السيرفرات</p>
      </div>
      <TVButton variant="primary" icon={<Plus className="w-4 h-4" />}>إضافة عمل جديد</TVButton>
    </div>

    {/* Quick Import Form */}
    <div className="bg-zinc-950 p-4 border border-zinc-800 rounded-lg space-y-3">
      <h3 className="text-xs font-bold text-zinc-300">استيراد تلقائي عبر TMDB / Cinemana</h3>
      <div className="flex gap-2">
        <input 
          type="text" 
          placeholder="أدخل رابط العمل من TMDB أو اسم الفيلم..."
          className="flex-1 bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-white font-mono"
        />
        <TVButton variant="primary" icon={<RefreshCw className="w-3.5 h-3.5" />}>استيراد</TVButton>
      </div>
    </div>
  </div>
);

// ============================================================================
// 4. MAIN EXPORTABLE DESIGN SYSTEM SHOWCASE COMPONENT
// ============================================================================
export const CinemaDesignSystemShowcase: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"hero" | "details" | "player" | "search" | "admin">("hero");

  return (
    <div className="w-full min-h-screen bg-black text-white p-6 space-y-8 font-sans">
      <div className="border-b border-zinc-800 pb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Cinemana TV - Design System & UI Views</h1>
          <p className="text-xs text-zinc-400">المكتبة الشاملة لتصاميم واجهات التلفزيون والأفلام (تنسيق أسود وأبيض)</p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: "hero", label: "الرئيسية (Hero)" },
            { id: "details", label: "التفاصيل (Details)" },
            { id: "player", label: "المشغل (Player)" },
            { id: "search", label: "البحث (Search)" },
            { id: "admin", label: "الأدمن (Admin)" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                activeTab === tab.id ? "bg-white text-black border-white" : "bg-black text-zinc-400 border-zinc-800 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Render Active View Template */}
      <div className="w-full">
        {activeTab === "hero" && <HeroBannerViewTemplate />}
        {activeTab === "details" && <MovieDetailsViewTemplate />}
        {activeTab === "player" && <PlayerOverlayViewTemplate />}
        {activeTab === "search" && <SearchViewTemplate />}
        {activeTab === "admin" && <AdminPanelViewTemplate />}
      </div>
    </div>
  );
};

export default CinemaDesignSystemShowcase;
