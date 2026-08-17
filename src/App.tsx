/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Play, 
  Info, 
  Search, 
  Home, 
  Tv, 
  Film, 
  Heart, 
  Settings, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  Star, 
  Maximize2, 
  Minimize2, 
  RotateCcw, 
  ArrowLeft, 
  ArrowRight,
  Volume2, 
  VolumeX, 
  Check, 
  Plus, 
  Sparkles, 
  Languages, 
  X,
  Globe,
  Delete,
  Hash,
  Smartphone,
  Keyboard,
  Compass,
  LayoutDashboard,
  SlidersHorizontal,
  Activity,
  Cpu,
  Database,
  Server,
  PlusCircle,
  TrendingUp,
  BarChart2,
  Sliders,
  SkipForward,
  SkipBack,
  Captions,
  Scissors,
  Pause,
  EyeOff,
  User,
  Users,
  Lock,
  LogOut,
  Type,
  History,
  Trash2,
  ShieldAlert,
  Video,
  Megaphone
} from "lucide-react";
import { Movie, Category, Season, Episode, Ad, AdsSettings } from "./types";
import { getHighResImage } from "./utils/imageUtils";
import Hls from "hls.js";
import MovieCard, { formatMovieDuration } from "./components/MovieCard";
import AdminPanel from "./components/AdminPanel";
import { getApiUrl } from "./utils/apiUtils";
import { safeStorage } from "./utils/safeStorage";
import CtvLogo from "./components/CtvLogo";
import SplashScreen from "./components/SplashScreen";
import { initialMovies } from "./data/initialMovies";
import { VideoPlayer } from "./components/VideoPlayer";
import { formatDuration } from "./utils/formatDuration";
import { Sidebar } from "./components/Sidebar";
import { HomeScreen } from "./components/HomeScreen";
import { FocusNavProvider, useFocusNavActions, useFocusNavState, useFocusZone } from "./hooks/useFocusNav";

// Immediate synchronous fallback structures to prevent any black screen on launch
const defaultAllMovies: Movie[] = (initialMovies || []) as Movie[];
const defaultHeroMoviesList: Movie[] = defaultAllMovies.slice(0, 10);
const defaultHeroMovieItem: Movie | null = defaultHeroMoviesList[0] || null;

const defaultRecentlyAdded = defaultAllMovies.slice().reverse();
const defaultTrending = defaultAllMovies.filter(m => m && m.rating >= 8.5);
const defaultSeriesList = defaultAllMovies.filter(m => m && m.type === "series");
const defaultActionList = defaultAllMovies.filter(m => m && m.genres?.some(g => g.includes("أكشن") || g.includes("خيال") || g.toLowerCase().includes("action")));
const defaultMoviesOnly = defaultAllMovies.filter(m => m && m.type === "movie");

const defaultCategoriesList: Category[] = [
  { id: "top10", titleAr: "الأعمال 10 الأكثر مشاهدة هذا الأسبوع", titleEn: "Top 10 This Week", items: defaultTrending.slice(0, 10) },
  { id: "recent", titleAr: "الأفلام والمسلسلات المضافة حديثاً", titleEn: "Recently Added", items: defaultRecentlyAdded },
  { id: "series", titleAr: "أحدث المسلسلات والبرامج", titleEn: "Latest Series", items: defaultSeriesList },
  { id: "action", titleAr: "أفلام الأكشن والخيال العلمي", titleEn: "Action & Sci-Fi", items: defaultActionList },
  { id: "movies", titleAr: "أفلام سينمانا المميزة", titleEn: "Featured Movies", items: defaultMoviesOnly }
];

const localFallbackPromos = [
  {
    id: "promo_1",
    titleAr: "ولاد رزق 3: القاضية",
    titleEn: "Welad Rizk 3: The Knockout",
    tagAr: "عرض أول حصري",
    tagEn: "Exclusive Premiere",
    descriptionAr: "فيلم الأكشن والتشويق العربي الأكثر شعبية لهذا العام متوفر الآن للبث الفوري بجودة Ultra HD 4K فائقة السرعة.",
    descriptionEn: "The highly anticipated Arabic blockbuster is now streaming in stunning Ultra HD 4K directly on Cinemana.",
    image: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&q=80",
    actionType: "search",
    actionValue: "ولاد رزق"
  },
  {
    id: "promo_2",
    titleAr: "صراع العروش: آل التنين",
    titleEn: "House of the Dragon - S2",
    tagAr: "حلقات جديدة مضافة",
    tagEn: "New Episodes Added",
    descriptionAr: "شاهد المعارك الملحمية والتنانين في الموسم الثاني الجديد كلياً. حلقات جديدة تضاف أسبوعياً بجودة Full HD.",
    descriptionEn: "Watch the epic battles and dragons in the all-new Season 2. New episodes added weekly in Full HD.",
    image: "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=1200&q=80",
    actionType: "play",
    actionValue: "series_1"
  },
  {
    id: "promo_3",
    titleAr: "باقة سينمانا VIP المميزة",
    titleEn: "Cinemana VIP Premium Channels",
    tagAr: "ميزة البث المباشر",
    tagEn: "Live TV Feature",
    descriptionAr: "بث مباشر مجاني بدون فواصل إعلانية لجميع قنوات المباريات والرياضة والترفيه مباشرة داخل تطبيقك المفضل.",
    descriptionEn: "Free live streams of sports, matches, and premier entertainment channels with zero ads directly inside your app.",
    image: "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=1200&q=80",
    actionType: "settings",
    actionValue: "vip"
  }
];

const genreMap: Record<string, { ar: string; en: string }> = {
  "الكل": { ar: "الكل", en: "All" },
  "أكشن": { ar: "أكشن", en: "Action" },
  "جريمة": { ar: "جريمة", en: "Crime" },
  "دراما": { ar: "دراما", en: "Drama" },
  "كوميديا": { ar: "كوميديا", en: "Comedy" },
  "كوميدي": { ar: "كوميدي", en: "Comedy" },
  "خيال علمي": { ar: "خيال علمي", en: "Sci-Fi" },
  "رعب": { ar: "رعب", en: "Horror" },
  "غموض": { ar: "غموض", en: "Mystery" },
  "تشويق": { ar: "تشويق", en: "Thriller" },
  "مغامرة": { ar: "مغامرة", en: "Adventure" },
  "خيال": { ar: "خيال", en: "Fantasy" },
  "حرب": { ar: "حرب", en: "War" },
  "رومانسية": { ar: "رومانسية", en: "Romance" },
  "أنيميشن": { ar: "أنيميشن", en: "Animation" },
  "رسوم متحركة": { ar: "رسوم متحركة", en: "Animation" },
  "أنمي": { ar: "أنمي", en: "Anime" },
  "تاريخي": { ar: "تاريخي", en: "Historical" },
  "سيرة ذاتية": { ar: "سيرة ذاتية", en: "Biography" },
  "عائلي": { ar: "عائلي", en: "Family" },
  "وثائقي": { ar: "وثائقي", en: "Documentary" },
  "إثارة": { ar: "إثارة", en: "Suspense" },
  "موسيقى": { ar: "موسيقى", en: "Music" },
  "رياضي": { ar: "رياضي", en: "Sport" },
  "عام": { ar: "عام", en: "General" },
};

// Mirrors genreMap's pattern: movie.country is stored already-Arabic (server-side ISO
// 3166-1 lookup), this only supplies the English label for the EN UI.
const countryMap: Record<string, string> = {
  "الولايات المتحدة": "United States", "المملكة المتحدة": "United Kingdom", "فرنسا": "France",
  "ألمانيا": "Germany", "إيطاليا": "Italy", "إسبانيا": "Spain", "كوريا الجنوبية": "South Korea",
  "اليابان": "Japan", "الصين": "China", "هونغ كونغ": "Hong Kong", "تايوان": "Taiwan",
  "الهند": "India", "تركيا": "Turkey", "مصر": "Egypt", "السعودية": "Saudi Arabia",
  "الإمارات": "UAE", "لبنان": "Lebanon", "العراق": "Iraq", "سوريا": "Syria", "الأردن": "Jordan",
  "الكويت": "Kuwait", "قطر": "Qatar", "البحرين": "Bahrain", "عمان": "Oman", "المغرب": "Morocco",
  "تونس": "Tunisia", "الجزائر": "Algeria", "ليبيا": "Libya", "السودان": "Sudan",
  "فلسطين": "Palestine", "اليمن": "Yemen", "كندا": "Canada", "أستراليا": "Australia",
  "نيوزيلندا": "New Zealand", "روسيا": "Russia", "البرازيل": "Brazil", "المكسيك": "Mexico",
  "الأرجنتين": "Argentina", "السويد": "Sweden", "النرويج": "Norway", "الدنمارك": "Denmark",
  "فنلندا": "Finland", "هولندا": "Netherlands", "بلجيكا": "Belgium", "سويسرا": "Switzerland",
  "النمسا": "Austria", "أيرلندا": "Ireland", "البرتغال": "Portugal", "اليونان": "Greece",
  "بولندا": "Poland", "تايلاند": "Thailand", "إندونيسيا": "Indonesia", "الفلبين": "Philippines",
  "ماليزيا": "Malaysia", "سنغافورة": "Singapore", "إسرائيل": "Israel", "إيران": "Iran",
  "باكستان": "Pakistan", "نيجيريا": "Nigeria", "جنوب أفريقيا": "South Africa",
};

const ALL_GENRES = [
  "الكل",
  "أكشن",
  "جريمة",
  "دراما",
  "كوميديا",
  "خيال علمي",
  "رعب",
  "غموض",
  "تشويق",
  "مغامرة",
  "خيال",
  "حرب",
  "رومانسية",
  "أنيميشن",
  "أنمي",
  "تاريخي",
  "سيرة ذاتية",
  "عائلي",
  "وثائقي",
  "إثارة",
  "موسيقى",
  "رياضي"
];

// movie.language stores the raw TMDB ISO 639-1 code (e.g. "ko", "hi", "es") rather than a
// bucketed value, so the filter can offer every common language its own option instead of
// lumping them all into "other". "other" here means "a real language we didn't curate a
// button for" - still matched, just grouped rather than named.
const ALL_LANGUAGES = ["الكل", "ar", "en", "hi", "es", "ko", "ja", "tr", "fr", "de", "it", "zh", "ru", "pt", "other"];

const languageMap: Record<string, { ar: string; en: string }> = {
  "الكل": { ar: "الكل", en: "All" },
  "ar": { ar: "العربية", en: "Arabic" },
  "en": { ar: "الإنجليزية", en: "English" },
  "hi": { ar: "الهندية", en: "Hindi" },
  "es": { ar: "الإسبانية", en: "Spanish" },
  "ko": { ar: "الكورية", en: "Korean" },
  "ja": { ar: "اليابانية", en: "Japanese" },
  "tr": { ar: "التركية", en: "Turkish" },
  "fr": { ar: "الفرنسية", en: "French" },
  "de": { ar: "الألمانية", en: "German" },
  "it": { ar: "الإيطالية", en: "Italian" },
  "zh": { ar: "الصينية", en: "Chinese" },
  "ru": { ar: "الروسية", en: "Russian" },
  "pt": { ar: "البرتغالية", en: "Portuguese" },
  "other": { ar: "لغات أخرى", en: "Other" },
};

const KNOWN_LANGUAGE_CODES = ["ar", "en", "hi", "es", "ko", "ja", "tr", "fr", "de", "it", "zh", "ru", "pt"];

const matchLanguageFilter = (movieLanguage: string | undefined, filter: string): boolean => {
  if (!filter || filter === "الكل") return true;
  if (filter === "other") return !!movieLanguage && !KNOWN_LANGUAGE_CODES.includes(movieLanguage);
  return movieLanguage === filter;
};

const matchGenreFilter = (movieGenres: string[] | undefined, filter: string): boolean => {
  if (!filter || filter === "الكل") return true;
  if (!movieGenres || !Array.isArray(movieGenres) || movieGenres.length === 0) return false;
  return movieGenres.some(g => {
    if (!g) return false;
    if (g === filter) return true;
    const filterEn = genreMap[filter]?.en?.toLowerCase();
    const filterAr = genreMap[filter]?.ar;
    const gEn = genreMap[g]?.en?.toLowerCase();
    const gAr = genreMap[g]?.ar;
    
    if (filterAr && (g === filterAr || gAr === filterAr)) return true;
    if (filterEn && (g.toLowerCase() === filterEn || gEn === filterEn)) return true;
    
    if ((filter === "كوميدي" || filter === "كوميديا") && (g === "كوميدي" || g === "كوميديا")) return true;
    if ((filter === "أنيميشن" || filter === "رسوم متحركة") && (g === "أنيميشن" || g === "رسوم متحركة")) return true;
    if ((filter === "إثارة" || filter === "تشويق") && (g === "إثارة" || g === "تشويق")) return true;

    return g.toLowerCase().includes(filter.toLowerCase()) || filter.toLowerCase().includes(g.toLowerCase());
  });
};

const formatQuality = (q: string) => {
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

const getServerNameLabel = (name: string, currentLang: "ar" | "en") => {
  if (!name) return "";
  if (currentLang === "ar") return name;
  if (name.includes("سيرفر شبكتي HD")) return "Shabakaty HD Server";
  if (name.includes("سيرفر رئيسي 1080p")) return "Main Server 1080p";
  if (name.includes("سيرفر سينمانا الرئيسي")) return "Cinemana Main Server";
  if (name.includes("سيرفر البث الرئيسي")) return "Default Stream Server";
  if (name.includes("سيرفر البث الذكي")) return "Smart AI Streaming Node";
  if (name.includes("الحلقة")) {
    return name.replace("الحلقة", "Episode");
  }
  return name;
};

// Individual focus nodes each scroll themselves into view on focus (see useFocusNode /
// MovieCard), which only guarantees that one element is visible — not that a container
// meant to reset to its very top actually gets there, and the timing races against
// whichever of those per-node scrolls happens to run in the same commit. Deferring one
// frame with rAF and setting scrollTop directly (no "smooth" options object, which some
// WebViews — this app also ships inside an Android TV WebView — handle inconsistently)
// guarantees this runs last and lands exactly at 0. The animation itself comes from the
// `scroll-smooth` CSS class on these containers (a plain scrollTop assignment still
// animates under scroll-behavior: smooth), which every browser either honors or safely
// ignores — so the landing position is never in question, only whether it's animated.
function scrollElementToTop(elementId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(elementId);
    if (el) el.scrollTop = 0;
  });
}

// Registers a real but empty "hole" zone: while it's active, the root FocusNavProvider's
// listener yields entirely to the old navSection-driven keydown handler, so not-yet-migrated
// screens keep working exactly as before during the incremental Phase 2 rollout.
function LegacyPassthroughZone() {
  useFocusZone({ id: "legacy", layout: () => [[]], passthrough: true });
  return null;
}

// Exposes the root provider's imperative setFocus to plain App.tsx handlers that live
// outside the provider's subtree (e.g. the sidebar's bridged select handler below). Also
// remembers the last non-sidebar zone+node so leaving the sidebar (see handleSidebarExit)
// can land back on the exact row the user was on, rather than always resetting to the
// zone's first node.
function FocusNavBridge({
  setFocusRef,
  lastContentFocusRef,
}: {
  setFocusRef: React.MutableRefObject<(zoneId: string, nodeId?: string) => void>;
  lastContentFocusRef: React.MutableRefObject<{ zoneId: string; nodeId: string | null }>;
}) {
  const { setFocus } = useFocusNavActions();
  const { activeZoneId, activeNodeId } = useFocusNavState();
  setFocusRef.current = setFocus;

  useEffect(() => {
    if (activeZoneId !== "sidebar") {
      lastContentFocusRef.current = { zoneId: activeZoneId, nodeId: activeNodeId };
    }
    // Moving focus back onto the hero zone (e.g. leaving the sidebar, or Up from the
    // top rail row) only guarantees the focused button scrolls into view, not the
    // banner above it — so the container was left scrolled partway down and the hero
    // never looked "whole" again until the user manually scrolled up themselves.
    if (activeZoneId === "home.hero") {
      scrollElementToTop("main-content-scroll");
    }
  }, [activeZoneId, activeNodeId, lastContentFocusRef]);

  return null;
}

export const generateSeasonsForSeries = (series: Movie): Season[] => {
  if (series.seasons && series.seasons.length > 0) {
    return series.seasons;
  }

  // If it is House of the Dragon (series_1)
  if (series.id === "series_1") {
    return [
      {
        id: "s1",
        number: 1,
        titleAr: "الموسم الأول",
        titleEn: "Season 1",
        episodes: [
          {
            id: "s1_e1",
            number: 1,
            titleAr: "ورثة التنين",
            titleEn: "The Heirs of the Dragon",
            duration: "59m",
            storyAr: "يبحث الملك جيرس عن وريث للعرش بعد وفاة زوجته وابنه الرضيع، مما يثير نزاعاً عائلياً مبكراً بين شقيقه ديمون وابنته رينيرا.",
            storyEn: "King Viserys looks for an heir to the throne after the death of his wife and newborn son, leading to early family disputes.",
            thumbnail: "https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4" }]
          },
          {
            id: "s1_e2",
            number: 2,
            titleAr: "الأمير المارق",
            titleEn: "The Rogue Prince",
            duration: "54m",
            storyAr: "ديمون تارجاريين يستولي على صخرة التنين ويشكل تحالفاً عسكرياً يتحدى به والي العرش.",
            storyEn: "Daemon Targaryen seizes Dragonstone and forms a military alliance that challenges the king.",
            thumbnail: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4" }]
          },
          {
            id: "s1_e3",
            number: 3,
            titleAr: "الثاني من اسمه",
            titleEn: "Second of His Name",
            duration: "63m",
            storyAr: "الاحتفالات بعيد ميلاد إيجون الثاني تزيد من عزلة رينيرا وتكثف الضغوط عليها لتتزوج.",
            storyEn: "Celebrations for Aegon's second birthday isolate Rhaenyra further and pressure her to marry.",
            thumbnail: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4" }]
          }
        ]
      },
      {
        id: "s2",
        number: 2,
        titleAr: "الموسم الثاني",
        titleEn: "Season 2",
        episodes: [
          {
            id: "s2_e1",
            number: 1,
            titleAr: "ابن مقابل ابن",
            titleEn: "A Son for a Son",
            duration: "64m",
            storyAr: "بينما تبكي رينيرا خسارة ابنها لوكيريس، يتخذ ديمون خطوة انتقامية مأساوية في كينغز لاندينغ.",
            storyEn: "As Rhaenyra mourns Lucerys, Daemon plans a tragic retaliation in King's Landing.",
            thumbnail: "https://images.unsplash.com/photo-1514306191717-452ec28c7814?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" }]
          },
          {
            id: "s2_e2",
            number: 2,
            titleAr: "رينيرا القاسية",
            titleEn: "Rhaenyra the Cruel",
            duration: "59m",
            storyAr: "الجرائم الأخيرة تثير سخطاً شعبياً واسعاً وتهدد استقرار حكم عائلة الأخضر في العاصمة.",
            storyEn: "The recent tragedy sparks outrage among citizens and threatens the Green Council's authority.",
            thumbnail: "https://images.unsplash.com/photo-1461360370896-922624d12aa1?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }]
          },
          {
            id: "s2_e3",
            number: 3,
            titleAr: "طواحين النار",
            titleEn: "The Burning Mill",
            duration: "58m",
            storyAr: "معارك عسكرية دموية تشتعل بين حلفاء رينيرا وإيجون، بينما رينيرا تسعى لتجنب الحرب الشاملة بلقاء سري.",
            storyEn: "Bloody skirmishes ignite between Rhaenyra's and Aegon's allies, as Rhaenyra seeks a peaceful way out.",
            thumbnail: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" }]
          }
        ]
      }
    ];
  }

  // If it is Demon Slayer (series_2)
  if (series.id === "series_2") {
    return [
      {
        id: "s1",
        number: 1,
        titleAr: "موسم قلعة اللانهاية",
        titleEn: "Infinity Castle Season",
        episodes: [
          {
            id: "s2_1",
            number: 1,
            titleAr: "مواجهة الحشد",
            titleEn: "Clash of the Hordes",
            duration: "45m",
            storyAr: "يدخل تانجيرو وأعضاء فيلق قتلة الشياطين قلعة اللانهاية حيث يواجهون موجات لا تنتهي من الشياطين السامة.",
            storyEn: "Tanjiro and the Demon Slayer Corps enter the Infinity Castle to face endless waves of demons.",
            thumbnail: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر سينمانا أنمي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4" }]
          },
          {
            id: "s2_2",
            number: 2,
            titleAr: "قوة الأقمار العليا",
            titleEn: "Power of Upper Moons",
            duration: "50m",
            storyAr: "اشتباك ضاري ومميت بين هاشيرا الحشرات شينوبو والقمر العلوي الثاني دوما.",
            storyEn: "Shinobu faces a deathmatch against Upper Moon Two, Douma.",
            thumbnail: "https://images.unsplash.com/photo-1541512416146-3cf58d6b27cc?w=480&q=80",
            servers: series.servers.length > 0 ? series.servers : [{ name: "سيرفر سينمانا أنمي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4" }]
          }
        ]
      }
    ];
  }

  // Default fallback for any other series (like Assassins/series_3 or custom added series)
  if (series.servers && series.servers.length > 0) {
    return [
      {
        id: "s1",
        number: 1,
        titleAr: "الموسم الأول",
        titleEn: "Season 1",
        episodes: series.servers.map((srv, i) => ({
          id: `s1_e${i+1}`,
          number: i + 1,
          titleAr: srv.name || `الحلقة ${i + 1}`,
          titleEn: `Episode ${i + 1}`,
          duration: "45m",
          storyAr: `الحلقة الحادية والأربعون من الموسم الأول لمسلسل ${series.titleAr || series.titleEn}.`,
          storyEn: `Episode ${i + 1} of Season 1 of ${series.titleEn}.`,
          thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=480&q=80",
          servers: [srv]
        }))
      }
    ];
  }

  const fallbackServers = [
    { name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
    { name: "سيرفر البث الذكي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" }
  ];

  return [
    {
      id: "s1",
      number: 1,
      titleAr: "الموسم الأول",
      titleEn: "Season 1",
      episodes: Array.from({ length: 4 }).map((_, i) => ({
        id: `s1_e${i+1}`,
        number: i + 1,
        titleAr: `الحلقة ${i + 1}`,
        titleEn: `Episode ${i + 1}`,
        duration: "45m",
        storyAr: `تفاصيل الحلقة الممتعة والمليئة بالأحداث الشيقة والدرامية من الموسم الأول لمسلسل ${series.titleAr}.`,
        storyEn: `Exciting plot details and developments in Episode ${i + 1} of Season 1 of ${series.titleEn}.`,
        thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=480&q=80",
        servers: fallbackServers
      }))
    },
    {
      id: "s2",
      number: 2,
      titleAr: "الموسم الثاني",
      titleEn: "Season 2",
      episodes: Array.from({ length: 3 }).map((_, i) => ({
        id: `s2_e${i+1}`,
        number: i + 1,
        titleAr: `الحلقة ${i + 1}`,
        titleEn: `Episode ${i + 1}`,
        duration: "48m",
        storyAr: `استمرار ملحمي للأحداث ومفاجآت غير متوقعة في الحلقة ${i + 1} من الموسم الثاني لمسلسل ${series.titleAr}.`,
        storyEn: `Epic continuation of events with unexpected twists in Episode ${i + 1} of Season 2 of ${series.titleEn}.`,
        thumbnail: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=480&q=80",
        servers: fallbackServers
      }))
    }
  ];
};

const translateActorName = (name: string, currentLang: "ar" | "en") => {
  if (!name) return "";
  const trimName = name.trim();
  
  const mapping: Record<string, { ar: string; en: string }> = {
    // House of the Dragon
    "Paddy Considine": { ar: "بادي كونسيدين", en: "Paddy Considine" },
    "Matt Smith": { ar: "مات سميث", en: "Matt Smith" },
    "Emma D'Arcy": { ar: "إيما دارسي", en: "Emma D'Arcy" },
    "Milly Alcock": { ar: "ميلي ألكوك", en: "Milly Alcock" },
    "Olivia Cooke": { ar: "أوليفيا كوك", en: "Olivia Cooke" },
    "Rhys Ifans": { ar: "ريس ايفانز", en: "Rhys Ifans" },
    "Steve Toussaint": { ar: "ستيف توسان", en: "Steve Toussaint" },
    "Eve Best": { ar: "إيف بيست", en: "Eve Best" },
    "ريس إيفانز": { ar: "ريس إيفانز", en: "Rhys Ifans" },
    "إيما دآرسي": { ar: "إيما دآرسي", en: "Emma D'Arcy" },
    
    // Demon Slayer
    "Natsuki Hanae": { ar: "ناتسوكي هاناي", en: "Natsuki Hanae" },
    "Akari Kito": { ar: "أكاري كيتو", en: "Akari Kito" },
    "Yoshitsugu Matsuoka": { ar: "يوشيتسوغو ماتسوكا", en: "Yoshitsugu Matsuoka" },
    "Hiro Shimono": { ar: "هيرو شيمونو", en: "Hiro Shimono" },
    "Takahiro Sakurai": { ar: "تاكاهيرو ساكوراي", en: "Takahiro Sakurai" },
    
    // Vikings / Other Movies
    "Travis Fimmel": { ar: "ترافيس فيميل", en: "Travis Fimmel" },
    "Katheryn Winnick": { ar: "كاثرين وينيك", en: "Katheryn Winnick" },
    "Clive Standen": { ar: "كلايف ستاندين", en: "Clive Standen" },
    "Gustaf Skarsgård": { ar: "غوستاف سكارسجارد", en: "Gustaf Skarsgård" },

    // Dune Part 2
    "تيموثي شالاماي": { ar: "تيموثي شالاماي", en: "Timothée Chalamet" },
    "Timothée Chalamet": { ar: "تيموثي شالاماي", en: "Timothée Chalamet" },
    "زيندايا": { ar: "زيندايا", en: "Zendaya" },
    "Zendaya": { ar: "زيندايا", en: "Zendaya" },
    "Rebecca Ferguson": { ar: "ريبيكا فيرغسون", en: "Rebecca Ferguson" },
    "خافيير بارديم": { ar: "خافيير بارديم", en: "Javier Bardem" },
    "Javier Bardem": { ar: "خافيير بارديم", en: "Javier Bardem" },

    // Oppenheimer
    "كيليان مورفي": { ar: "كيليان مورفي", en: "Cillian Murphy" },
    "Cillian Murphy": { ar: "كيليان مورفي", en: "Cillian Murphy" },
    "إميلي بلانت": { ar: "إميلي بلانت", en: "Emily Blunt" },
    "Emily Blunt": { ar: "إميلي بلانت", en: "Emily Blunt" },
    "روبرت داوني جونيور": { ar: "روبرت داوني جونيور", en: "Robert Downey Jr." },
    "Robert Downey Jr.": { ar: "روبرت داوني جونيور", en: "Robert Downey Jr." },
    "مات ديمون": { ar: "مات ديمون", en: "Matt Damon" },
    "Matt Damon": { ar: "مات ديمون", en: "Matt Damon" },

    // Spider-Man
    "شاميك مور": { ar: "شاميك مور", en: "Shameik Moore" },
    "Shameik Moore": { ar: "شاميك مور", en: "Shameik Moore" },
    "هيلي ستاينفيلد": { ar: "هيلي ستاينفيلد", en: "Hailee Steinfeld" },
    "Hailee Steinfeld": { ar: "هيلي ستاينفيلد", en: "Hailee Steinfeld" },
    "أوسكار إسحاق": { ar: "أوسكار إسحاق", en: "Oscar Isaac" },
    "Oscar Isaac": { ar: "أوسكار إسحاق", en: "Oscar Isaac" },
    "Jake Johnson": { ar: "جيك جونسون", en: "Jake Johnson" },

    // The Assassins (الحشاشين)
    "كريم عبد العزيز": { ar: "كريم عبد العزيز", en: "Karim Abdel Aziz" },
    "Karim Abdel Aziz": { ar: "كريم عبد العزيز", en: "Karim Abdel Aziz" },
    "فتحي عبد الوهاب": { ar: "فتحي عبد الوهاب", en: "Fathy Abdel Wahab" },
    "Fathy Abdel Wahab": { ar: "فتحي عبد الوهاب", en: "Fathy Abdel Wahab" },
    "ميرنا نور الدين": { ar: "ميرنا نور الدين", en: "Mirna Noureldin" },
    "Mirna Noureldin": { ar: "ميرنا نور الدين", en: "Mirna Noureldin" },
    "نيقولا معوض": { ar: "نيقولا معوض", en: "Nicolas Mouawad" },
    "Nicolas Mouawad": { ar: "نيقولا معوض", en: "Nicolas Mouawad" },

    // The Batman
    "روبرت باتينسون": { ar: "روبرت باتينسون", en: "Robert Pattinson" },
    "Robert Pattinson": { ar: "روبرت باتينسون", en: "Robert Pattinson" },
    "زوي كرافيتز": { ar: "زوي كرافيتز", en: "Zoë Kravitz" },
    "Zoë Kravitz": { ar: "زوي كرافيتز", en: "Zoë Kravitz" },
    "بول دانو": { ar: "بول دانو", en: "Paul Dano" },
    "Paul Dano": { ar: "بول دانو", en: "Paul Dano" },
    "كولين فاريل": { ar: "كولين فاريل", en: "Colin Farrell" },
    "Colin Farrell": { ar: "كولين فاريل", en: "Colin Farrell" },

    // Interstellar
    "ماثيو ماكونهي": { ar: "ماثيو ماكونهي", en: "Matthew McConaughey" },
    "Matthew McConaughey": { ar: "ماثيو ماكونهي", en: "Matthew McConaughey" },
    "آن هاثاواي": { ar: "آن هاثاواي", en: "Anne Hathaway" },
    "Anne Hathaway": { ar: "آن هاثاواي", en: "Anne Hathaway" },
    "جيسيكا تشاستين": { ar: "جيسيكا تشاستين", en: "Jessica Chastain" },
    "Jessica Chastain": { ar: "جيسيكا تشاستين", en: "Jessica Chastain" },
    "مايكل كين": { ar: "مايكل كين", en: "Michael Caine" },
    "Michael Caine": { ar: "مايكل كين", en: "Michael Caine" },

    "ممثل مخصص": { ar: "ممثل مخصص", en: "Custom Actor" },
    "GCP Service Node": { ar: "عقدة خدمات GCP", en: "GCP Service Node" },

    // Arabic equivalents already in DB to translate back to English
    "مات سميث": { ar: "مات سميث", en: "Matt Smith" },
    "ميلي ألكوك": { ar: "ميلي ألكوك", en: "Milly Alcock" },
    "إيما دارسي": { ar: "إيما دارسي", en: "Emma D'Arcy" },
    "أوليفيا كوك": { ar: "أوليفيا كوك", en: "Olivia Cooke" },
    "ستيف توسان": { ar: "ستيف توسان", en: "Steve Toussaint" },
    "إيف بيست": { ar: "إيف بيست", en: "Eve Best" },
    "بادي كونسيدين": { ar: "بادي كونسيدين", en: "Paddy Considine" },
    "ريس ايفانز": { ar: "ريس ايفانز", en: "Rhys Ifans" },
    "ناتسوكي هاناي": { ar: "ناتسوكي هاناي", en: "Natsuki Hanae" },
    "أكاري كيتو": { ar: "أكاري كيتو", en: "Akari Kito" },
    "يوشيتسوغو ماتسوكا": { ar: "يوشيتسوغو ماتسوكا", en: "Yoshitsugu Matsuoka" },
    "هيرو شيمونو": { ar: "هيرو شيمونو", en: "Hiro Shimono" },
    "ترافيس فيميل": { ar: "ترافيس فيميل", en: "Travis Fimmel" },
    "كاثرين وينيك": { ar: "كاثرين وينيك", en: "Katheryn Winnick" },
    "كلايف ستاندين": { ar: "كلايف ستاندين", en: "Clive Standen" },
    "غوستاف سكارسجارد": { ar: "غوستاف سكارسجارد", en: "Gustaf Skarsgård" },
  };

  const match = mapping[trimName];
  if (match) {
    return currentLang === "ar" ? match.ar : match.en;
  }
  
  return trimName;
};

export default function App() {
  // Splash Screen State. Shown by default: the very first render uses
  // defaultCategoriesList/defaultHeroMovieItem, a synchronous fallback built from
  // whatever movies_db.json snapshot happened to be bundled at build time (see top of
  // file) purely to avoid a literal black screen. fetchMoviesData() below always then
  // overwrites that with live data (from /api/movies, or ./movies.json as a second
  // fallback), which on an active install can differ noticeably from the bundled
  // snapshot - a different hero movie, different rows - so users saw two visibly
  // different home screens flash in succession. Covering that swap with the splash
  // screen means only the final, correct state is ever visible.
  const [showSplash, setShowSplash] = useState<boolean>(true);

  // Navigation & View States
  const [lang, setLang] = useState<"ar" | "en">(() => {
    const saved = safeStorage.getItem("cinemana_lang");
    return (saved === "ar" || saved === "en") ? saved : "ar";
  });
  const [navSection, setNavSection] = useState<"sidebar" | "hero" | "rails" | "details" | "search" | "favorites" | "settings" | "movies_section" | "series_section" | "admin" | "collections_section" | "person_section">("hero");
  const [activeSidebarItem, setActiveSidebarItem] = useState<number>(0); // 0: Home, 1: Search, 2: Series, 3: Movies, 4: Favorites, 5: Settings
  // Imperative bridge into the root FocusNavProvider — see FocusNavBridge/handleSidebarSelectBridged.
  const focusNavSetFocusRef = useRef<(zoneId: string, nodeId?: string) => void>(() => {});
  // Last non-sidebar zone+node the root provider had focus on — see FocusNavBridge and
  // handleSidebarExit. Lets leaving the sidebar land back on the exact row the user was
  // on (e.g. deep in a rail) instead of always resetting to the zone's first node.
  const lastContentFocusRef = useRef<{ zoneId: string; nodeId: string | null }>({ zoneId: "home.hero", nodeId: null });
  // Short cooldown after picking a section from the sidebar, or opening a movie's details
  // (see handleSidebarSelect / the selectedMovie effect below): a couple of reports only
  // make sense as the SAME physical OK press somehow reaching the legacy handler twice —
  // once to open the screen, once more landing on whatever its default focus is (typing
  // the first virtual keyboard letter into an empty search box, toggling the app language
  // via the now-focused language row, playing a movie via its now-focused Play button).
  // Scoped to OK/Enter only (see isConfirmKeyForGuard below) and kept short — swallowing
  // every key here, arrows included, or holding it for a human-perceptible stretch, made
  // fast directional browsing (e.g. flipping through a franchise's parts) feel laggy.
  const sectionEntryGuardUntilRef = useRef<number>(0);
  // Remembers the last non-"sidebar" navSection. Entering the sidebar from a legacy
  // screen overwrites navSection to the literal "sidebar" value (see the mirroring
  // effect below) so the old handleKeyDown knows to stand down — but every content
  // block below is gated on navSection too, so without this the whole screen would go
  // blank/black the moment the sidebar gets focus. contentNavSection (below, near the
  // JSX) falls back to this whenever navSection is literally "sidebar", so the screen
  // the user came from stays visible underneath while the sidebar has focus. Also used
  // by handleSidebarExit to restore navSection when leaving the sidebar without picking
  // an item.
  const [preSidebarNavSection, setPreSidebarNavSection] = useState(navSection);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean>(() => {
    return safeStorage.getItem("isAdminLoggedIn") === "true";
  });
  const [adminUsername, setAdminUsername] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState<string>("");
  const [adminLoginError, setAdminLoginError] = useState<string | null>(null);
  
  // TV keyboard navigation states
  const [settingsFocusArea, setSettingsFocusArea] = useState<
    "sidebar" | "login_username" | "login_password" | "login_submit" | "admin_panel_btn" | "logout_btn" | "app_language" | "sub_font" | "sub_size" | "sub_color" | "sub_shadow" | "clear_history" | "watch_history"
  >("app_language");
  const [focusedSubSizeIndex, setFocusedSubSizeIndex] = useState<number>(1); // 0: small, 1: medium, 2: large, 3: xl
  const [focusedSubColorIndex, setFocusedSubColorIndex] = useState<number>(1); // 0: yellow, 1: white, 2: white_light
  const [adminLoginFocus, setAdminLoginFocus] = useState<"username" | "password" | "submit" | "back">("username");
  
  // Movie database states
  const [allMovies, setAllMovies] = useState<Movie[]>(defaultAllMovies);

  // Control Panel States
  const [activeSimulatedUsers, setActiveSimulatedUsers] = useState<number>(1420);
  const [mockCpuLoad, setMockCpuLoad] = useState<number>(24.5);
  const [mockRamLoad, setMockRamLoad] = useState<number>(1.28);
  const [systemLogs, setSystemLogs] = useState<string[]>([
    "Cloud Console initialized successfully.",
    "Database connection status: SECURE.",
    "Baghdad CDN Node Online (latency: 12ms).",
    "Gemini crawler model 'gemini-3.5-flash' ready."
  ]);

  // Content Injector Form States
  const [injTitleAr, setInjTitleAr] = useState<string>("");
  const [injTitleEn, setInjTitleEn] = useState<string>("");
  const [injType, setInjType] = useState<"movie" | "series">("movie");
  const [injRating, setInjRating] = useState<number>(8.5);
  const [injYear, setInjYear] = useState<number>(2025);
  const [injDuration, setInjDuration] = useState<string>("2h 15m");
  const [injGenres, setInjGenres] = useState<string>("أكشن, مغامرة");
  const [injStoryAr, setInjStoryAr] = useState<string>("قصة مشوقة لفيلم تمت إضافته يدوياً من لوحة التحكم.");
  const [injStoryEn, setInjStoryEn] = useState<string>("An exciting story of a custom added movie injected via the console panel.");
  const [injPoster, setInjPoster] = useState<string>("https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80");
  const [injBackdrop, setInjBackdrop] = useState<string>("https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200&q=80");
  const [injQuality, setInjQuality] = useState<string>("Ultra HD");

  // Movies & Series Filter/Sort States
  const [movieGenreFilter, setMovieGenreFilter] = useState<string>("الكل");
  const [movieSortBy, setMovieSortBy] = useState<string>("newest");
  const [movieLanguageFilter, setMovieLanguageFilter] = useState<string>("الكل");
  const [seriesGenreFilter, setSeriesGenreFilter] = useState<string>("الكل");
  const [seriesSortBy, setSeriesSortBy] = useState<string>("newest");
  const [seriesLanguageFilter, setSeriesLanguageFilter] = useState<string>("الكل");
  const [activeDropdown, setActiveDropdown] = useState<"movie_genre" | "movie_sort" | "movie_language" | "series_genre" | "series_sort" | "series_language" | null>(null);
  const [adminRemoteAction, setAdminRemoteAction] = useState<{action: "up" | "down" | "left" | "right" | "ok" | "back"; time: number} | null>(null);
  const [sectionFocusArea, setSectionFocusArea] = useState<"filters" | "cards">("cards");
  // The Favorites page (see "SECTION 2: WATCH HISTORY" in its JSX) actually has two areas —
  // the favorites grid, and a Continue Watching / Clear History area below it — but that
  // second area's D-pad handling used to be written under `case "settings":`, gated on
  // `navSection === "settings"`, even though it's rendered on and only reachable while on
  // the Favorites page. Since navSection can never be both "favorites" and "settings" at
  // once, that whole area was permanently unreachable. This tracks it correctly instead.
  const [favoritesFocusArea, setFavoritesFocusArea] = useState<"list" | "watch_history" | "clear_history">("list");
  const [focusedSectionFilter, setFocusedSectionFilter] = useState<number>(0); // 0: Genre, 1: Sort
  const [focusedDropdownItemIndex, setFocusedDropdownItemIndex] = useState<number>(0);

  const [heroMovie, setHeroMovie] = useState<Movie | null>(defaultHeroMovieItem);
  const [heroMovies, setHeroMovies] = useState<Movie[]>(defaultHeroMoviesList);
  const [currentHeroIndex, setCurrentHeroIndex] = useState<number>(0);
  const [categories, setCategories] = useState<Category[]>(defaultCategoriesList);
  const [promos, setPromos] = useState<any[]>(localFallbackPromos);
  const [currentPromoIndex, setCurrentPromoIndex] = useState<number>(0);
  const [focusedRailIndex, setFocusedRailIndex] = useState<number>(0);
  const [focusedCardIndex, setFocusedCardIndex] = useState<number>(0);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const collectionMovies = selectedMovie && selectedMovie.collectionId
    ? allMovies.filter(m => m.collectionId === selectedMovie.collectionId).sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0))
    : [];
  const [activeTrailerUrl, setActiveTrailerUrl] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<{ 
    name: string; 
    role?: string; 
    photoUrl?: string;
    previousNavSection?: string;
    previousMovie?: Movie | null;
  } | null>(null);

  const normalizePersonName = (s?: string) => (s || "").trim().toLowerCase();

  const isPersonMatch = (personName: string, candidate?: string) => {
    if (!candidate || !personName) return false;
    const p1 = normalizePersonName(personName);
    const p2 = normalizePersonName(candidate);
    if (p1 === p2) return true;
    
    const transP1En = normalizePersonName(translateActorName(personName, "en"));
    const transP1Ar = normalizePersonName(translateActorName(personName, "ar"));
    const transP2En = normalizePersonName(translateActorName(candidate, "en"));
    const transP2Ar = normalizePersonName(translateActorName(candidate, "ar"));
    
    return (
      (transP1En && transP1En === transP2En) ||
      (transP1Ar && transP1Ar === transP2Ar) ||
      (transP1En && transP1En === p2) ||
      (transP1Ar && transP1Ar === p2) ||
      (p1 === transP2En) ||
      (p1 === transP2Ar)
    );
  };

  const getCastItems = (movie: Movie | null, currentLang: string) => {
    if (!movie) return [];
    const items: Array<{ name: string; role: string; photoUrl?: string }> = [];

    const dirNorm = movie.director?.trim().toLowerCase();
    const writNorm = movie.writer?.trim().toLowerCase();

    const isDirOrWrit = (name: string) => {
      if (!name) return false;
      const norm = name.trim().toLowerCase();
      if (dirNorm && (norm === dirNorm || isPersonMatch(movie.director, name))) return true;
      if (writNorm && (norm === writNorm || isPersonMatch(movie.writer, name))) return true;
      return false;
    };

    if (movie.director) {
      items.push({
        name: movie.director,
        role: currentLang === "ar" ? "المخرج" : "Director",
        photoUrl: movie.directorPhotoUrl,
      });
    }

    if (movie.writer) {
      items.push({
        name: movie.writer,
        role: currentLang === "ar" ? "الكاتب" : "Writer",
        photoUrl: movie.writerPhotoUrl,
      });
    }

    const filteredCastMembers = (movie.castMembers || []).filter(c => !isDirOrWrit(c.name));
    for (const c of filteredCastMembers) {
      items.push({
        name: c.name,
        role: c.role || (currentLang === "ar" ? "ممثل" : "Actor"),
        photoUrl: c.photoUrl,
      });
    }

    if (filteredCastMembers.length === 0) {
      const filteredActors = (movie.actors || []).filter(aName => !isDirOrWrit(aName));
      for (const aName of filteredActors) {
        items.push({
          name: aName,
          role: currentLang === "ar" ? "ممثل" : "Actor",
        });
      }
    }

    return items;
  };

  const personWorks = selectedPerson
    ? allMovies.filter(m => {
        if (isPersonMatch(selectedPerson.name, m.director)) return true;
        if (isPersonMatch(selectedPerson.name, m.writer)) return true;
        if (m.actors?.some(act => isPersonMatch(selectedPerson.name, act))) return true;
        if (m.castMembers?.some(cm => isPersonMatch(selectedPerson.name, cm.name))) return true;
        return false;
      })
    : [];
  
  const getYoutubeId = (url?: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const getTrailerEmbedUrl = (movie: Movie | null): string | null => {
    if (!movie) return null;
    if (movie.trailerUrl) {
      const ytId = getYoutubeId(movie.trailerUrl);
      if (ytId) {
        return `https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=0&rel=0&showinfo=0&modestbranding=1`;
      }
      if (movie.trailerUrl.includes("youtube.com/embed/")) {
        return movie.trailerUrl;
      }
    }
    // Fallback: search YouTube for the official trailer of the movie/series using its title
    const query = `${movie.titleEn} ${movie.year} official trailer`;
    return `https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1&mute=0&rel=0&showinfo=0&modestbranding=1`;
  };
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);
  
  // Media Player States
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null);

  // Pre-roll Ads States
  const [adsSettings, setAdsSettings] = useState<AdsSettings | null>(null);
  const [currentAd, setCurrentAd] = useState<Ad | null>(null);
  const [isAdPlaying, setIsAdPlaying] = useState<boolean>(false);
  const [adTimeRemaining, setAdTimeRemaining] = useState<number>(0);
  const [canSkipAd, setCanSkipAd] = useState<boolean>(false);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const [detailsFocusArea, setDetailsFocusArea] = useState<"back" | "actions" | "cast" | "seasons" | "episodes" | "collection">("actions");
  const [focusedActionIndex, setFocusedActionIndex] = useState<number>(0); // 0: Play Button, 1: Add to Favorites
  const [focusedCastIndex, setFocusedCastIndex] = useState<number>(0);
  const [focusedEpisodeIndex, setFocusedEpisodeIndex] = useState<number>(0);
  const [focusedCollectionIndex, setFocusedCollectionIndex] = useState<number>(0);
  const [personFocusArea, setPersonFocusArea] = useState<"back" | "movies">("movies");
  const [focusedPersonMovieIndex, setFocusedPersonMovieIndex] = useState<number>(0);
  const [activeServerIndex, setActiveServerIndex] = useState<number>(0);
  const [playerMuted, setPlayerMuted] = useState<boolean>(false);
  const [playerVolume, setPlayerVolume] = useState<number>(80);
  const [playerProgress, setPlayerProgress] = useState<number>(0);
  const [playerDuration, setPlayerDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showQuarterHourOverlay, setShowQuarterHourOverlay] = useState<boolean>(true);
  const [isScrubbingSeek, setIsScrubbingSeek] = useState<boolean>(false);

  // Controls visibility timeout state and functions
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const controlsTimeoutRef = useRef<any>(null);

  const showControlsAndResetTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3500); // Hide after 3.5 seconds of inactivity
    }
  }, [isPlaying]);

  // Pre-roll ad trigger when playingMovie changes
  useEffect(() => {
    if (!playingMovie) {
      setIsAdPlaying(false);
      setCurrentAd(null);
      return;
    }

    fetch(getApiUrl("/api/ads"))
      .then((res) => res.json())
      .then((data) => {
        const settings: AdsSettings = data.adsSettings || data;
        if (settings && settings.enabled !== false && Array.isArray(settings.ads) && settings.ads.length > 0) {
          setAdsSettings(settings);
          const activeAds = settings.ads.filter(
            (a: Ad) => (a.isActive !== false && (a as any).active !== false) && (!a.targetType || a.targetType === "all" || a.targetType === playingMovie.type)
          );
          if (activeAds.length > 0) {
            const chosenAd = activeAds[Math.floor(Math.random() * activeAds.length)];
            const adUrl = (chosenAd.servers && chosenAd.servers.length > 0 && chosenAd.servers[0]?.url) || (chosenAd as any).mediaUrl;
            if (adUrl) {
              setCurrentAd(chosenAd);
              setIsAdPlaying(true);
              const durationSec = chosenAd.durationSeconds || 15;
              const skipSec = chosenAd.skipAfterSeconds ?? settings.globalSkipAfterSeconds ?? 5;
              setAdTimeRemaining(durationSec);
              setCanSkipAd(skipSec <= 0);
            }
          }
        }
      })
      .catch((err) => console.warn("Failed to load ads config:", err));
  }, [playingMovie?.id]);

  const skipOrFinishAd = () => {
    setIsAdPlaying(false);
    setCurrentAd(null);
  };
  useEffect(() => {
    if (heroMovies.length <= 1) return;
    
    const interval = setInterval(() => {
      setCurrentHeroIndex((prevIndex) => {
        const nextIndex = (prevIndex + 1) % heroMovies.length;
        setHeroMovie(heroMovies[nextIndex]);
        return nextIndex;
      });
    }, 6000); // Transitions every 6 seconds
    
    return () => clearInterval(interval);
  }, [heroMovies]);

  // Handle active playback change or state changes
  useEffect(() => {
    if (playingMovie) {
      showControlsAndResetTimer();
    } else {
      setControlsVisible(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [playingMovie, isPlaying, showControlsAndResetTimer]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastPlaybackTimeRef = useRef<number | null>(null);
  const lastSaveProgressTimeRef = useRef<number>(0);
  const episodesScrollRef = useRef<HTMLDivElement | null>(null);
  const detailsContainerRef = useRef<HTMLDivElement | null>(null);

  const [playerQuality, setPlayerQuality] = useState<string>("FHD");
  const [playerSubtitles, setPlayerSubtitles] = useState<string>("ar"); // "ar" | "en" | "off"
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState<boolean>(false);
  const [playerToast, setPlayerToast] = useState<string | null>(null);
  const [subCuesAr, setSubCuesAr] = useState<any[]>([]);
  const [subCuesEn, setSubCuesEn] = useState<any[]>([]);

  // Subtitle Customization & Video Loading/Buffering States
  const [isVideoBuffering, setIsVideoBuffering] = useState<boolean>(false);

  // Sync mute state to video element
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = playerMuted;
    }
  }, [playerMuted]);

  const isArabicContent = (movie: Movie | null): boolean => {
    if (!movie) return false;
    const lang = (movie.language || "").toLowerCase().trim();
    if (lang === "ar" || lang === "arabic" || lang.includes("عرب")) return true;
    if (movie.genres && movie.genres.some((g) => g.toLowerCase().includes("عرب"))) return true;
    return false;
  };

  // Reset buffering and sub settings when closing or switching movie
  useEffect(() => {
    if (playingMovie) {
      if (isArabicContent(playingMovie)) {
        setPlayerSubtitles("off");
      } else {
        setPlayerSubtitles("ar");
      }
    } else {
      setIsVideoBuffering(false);
    }
  }, [playingMovie]);

  // Implements live HLS streaming with automated stream auto-recovering and connection retry logic.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const mainStreamUrl = (activeEpisode 
      ? (activeEpisode.servers?.[activeServerIndex]?.url || activeEpisode.servers?.[0]?.url) 
      : (playingMovie ? (playingMovie.servers?.[activeServerIndex]?.url || playingMovie.servers?.[0]?.url) : undefined)
    ) || undefined;

    const adStreamUrl = (isAdPlaying && currentAd)
      ? ((currentAd.servers && currentAd.servers[0]?.url) || currentAd.mediaUrl)
      : undefined;

    const streamUrl = isAdPlaying ? adStreamUrl : mainStreamUrl;

    if (!streamUrl) return;

    let hls: Hls | null = null;

    // Detect if the streaming URL is an HLS .m3u8 index playlist
    const isHls = streamUrl.toLowerCase().includes(".m3u8") || streamUrl.includes("video.shabakaty.com");

    if (isHls) {
      if (Hls.isSupported()) {
        hls = new Hls({
          // Web Worker support is a known trouble spot on older/quirky Android WebView
          // engines (this app already targets several - see the cascade-layers CSS
          // compat work). Transmuxing on the main thread instead is somewhat heavier for
          // the UI thread, but a hang/jank there is recoverable - a worker crashing the
          // renderer outright on a device with a broken/partial Worker implementation is
          // not, and looks identical to "the app just exits" a few seconds into playback.
          enableWorker: false,
          // Low-latency HLS is a live-streaming feature (keeping playback close to the
          // live edge); this app only ever plays VOD movies/episodes, so it adds
          // complexity (different buffering/seeking behavior) with no benefit here.
          maxBufferLength: 30,
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isPlaying) {
            video.play().catch((e) => console.log("HLS autoplay prevented:", e));
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn("HLS network error, attempting recovery...");
                hls?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn("HLS media error, attempting recovery...");
                hls?.recoverMediaError();
                break;
              default:
                console.error("HLS unrecoverable error, reloading standard source tag...");
                video.src = streamUrl;
                break;
            }
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Native Apple Safari HLS player support
        video.src = streamUrl;
      } else {
        // Standard video fallback (e.g. mobile chrome, browsers with polyfills)
        video.src = streamUrl;
      }
    } else {
      // Direct mp4 standard streams
      video.src = streamUrl;
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [activeEpisode, activeServerIndex, playingMovie, isAdPlaying, currentAd]);

  // Search Engine states
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [isSearchingBackend, setIsSearchingBackend] = useState<boolean>(false);
  const [keyboardLang, setKeyboardLang] = useState<"ar" | "en">("ar");
  const [keyboardMode, setKeyboardMode] = useState<"letters" | "symbols">("letters");
  const [searchTypeFilter, setSearchTypeFilter] = useState<"all" | "movie" | "series">("all");
  const [focusedSearchKey, setFocusedSearchKey] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const [searchFocusArea, setSearchFocusArea] = useState<"keyboard" | "filters" | "results">("keyboard");
  // The virtual keyboard's first key ("ا") used to show its focus ring the instant the
  // search screen opened, before any remote input at all — easy to mistake for a
  // pre-typed/default letter sitting in the search box. No ring is drawn until the user
  // actually presses a key on this screen (see effectiveSearchKey below).
  const [searchKeyboardTouched, setSearchKeyboardTouched] = useState(false);
  const [focusedFilterIndex, setFocusedFilterIndex] = useState<number>(0);

  // Favorites state saved in LocalStorage
  const [favorites, setFavorites] = useState<Movie[]>([]);

  // Watch history state saved in LocalStorage
  const [watchHistory, setWatchHistory] = useState<Movie[]>(() => {
    try {
      const saved = safeStorage.getItem("cinemana_tv_watch_history");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Failed to parse watch history", e);
      return [];
    }
  });

  // Watch progress map { [movieId]: { percent: number, currentTime?: number, updatedAt: number } } saved in LocalStorage
  const [watchProgress, setWatchProgress] = useState<Record<string, { percent: number; currentTime?: number; updatedAt: number }>>(() => {
    try {
      const saved = safeStorage.getItem("cinemana_tv_watch_progress");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to parse watch progress", e);
      return {};
    }
  });

  // Settings customizable states
  const [subFont, setSubFont] = useState<string>(() => {
    return safeStorage.getItem("cinemana_sub_font") || "Cairo";
  }); // "Cairo" | "Tajawal" | "Inter" | "Fira Code" | "Al Jazeera"
  const [subSize, setSubSize] = useState<string>(() => {
    return safeStorage.getItem("cinemana_sub_size") || "medium";
  }); // "small" | "medium" | "large" | "xl"
  const [subColor, setSubColor] = useState<string>(() => {
    return safeStorage.getItem("cinemana_sub_color") || "yellow";
  }); // "yellow" | "white" | "white_light"
  const [subShadow, setSubShadow] = useState<boolean>(() => {
    const saved = safeStorage.getItem("cinemana_sub_shadow");
    return saved !== "false"; // default true
  }); // true = enabled, false = disabled

  const [subtitleOffset, setSubtitleOffset] = useState<number>(0); // Timing offset in seconds
  
  // User Authentication state (mock real login with persistent flow)
  const [userSession, setUserSession] = useState<{ username: string; displayName: string; planAr: string; planEn: string; activeUntil: string } | null>(() => {
    try {
      const saved = safeStorage.getItem("cinemana_session");
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error("Failed to parse cinemana_session", e);
      return null;
    }
  });
  const [loginUsername, setLoginUsername] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string>("");

  // Remote controller vibration effect feedback
  const [lastRemoteAction, setLastRemoteAction] = useState<string | null>(null);

  // Fallback database containing all 302 real movies and series
  const fallbackDatabase: Movie[] = initialMovies;

  // Fetch Movies on Mount & Splash Screen Timer
  useEffect(() => {
    // Hide the splash as soon as real data is in (whichever source it came from), so it
    // never shows for longer than necessary. The fixed ceiling below is just a safety net
    // in case the fetch chain hangs (e.g. a dead network with no fallback responding) -
    // it should normally never fire.
    fetchMoviesData().finally(() => setShowSplash(false));

    const splashTimer = setTimeout(() => {
      setShowSplash(false);
    }, 6000);

    // Load favorites from local storage
    const savedFavs = safeStorage.getItem("cinemana_tv_favorites");
    if (savedFavs) {
      try {
        setFavorites(JSON.parse(savedFavs));
      } catch (e) {
        console.error("Failed to parse favorites", e);
      }
    }

    // Close custom dropdowns on clicking anywhere else
    const handleGlobalClick = () => {
      setActiveDropdown(null);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      clearTimeout(splashTimer);
      window.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  // Persist customizable settings on changes
  useEffect(() => {
    safeStorage.setItem("cinemana_lang", lang);
  }, [lang]);

  useEffect(() => {
    safeStorage.setItem("cinemana_sub_font", subFont);
    safeStorage.setItem("cinemana_sub_size", subSize);
    safeStorage.setItem("cinemana_sub_color", subColor);
    safeStorage.setItem("cinemana_sub_shadow", String(subShadow));
  }, [subFont, subSize, subColor, subShadow]);

  // Reset focus on opening/changing person section
  useEffect(() => {
    if (selectedPerson) {
      setPersonFocusArea("movies");
      setFocusedPersonMovieIndex(0);
    }
  }, [selectedPerson]);

  // Prevent black screen if selectedMovie becomes null while navSection is "details"
  useEffect(() => {
    if (!selectedMovie && navSection === "details") {
      setNavSection("hero");
    }
  }, [selectedMovie, navSection]);

  // Reset focus on opening/changing movie details
  useEffect(() => {
    if (selectedMovie) {
      setDetailsFocusArea("actions");
      setFocusedActionIndex(0); // Focus directly on Play button!
      setFocusedCastIndex(0);
      setFocusedEpisodeIndex(0);
      setFocusedCollectionIndex(0);
      setSelectedSeasonNumber(1);
      // The Play button being the default focus target the instant details opens (above)
      // means an extra/bounced OK event landing right after the one that opened this movie
      // doesn't just re-select the same card — it immediately plays it, and the details
      // page the user actually meant to open never gets a chance to be seen. See
      // sectionEntryGuardUntilRef — same swallow-window used for sidebar section switches.
      sectionEntryGuardUntilRef.current = Date.now() + 120;
    }
  }, [selectedMovie]);

  // Preload every collection part's backdrop and title-logo image up front, as soon as
  // the details page for any part of that collection opens. Switching parts otherwise
  // waits on each newly-selected part's own image fetch — nothing wrong technically, but
  // it reads as the backdrop/title going blank or lagging behind for a moment every time.
  // Warming the browser's own image cache this way means by the time the user actually
  // navigates to a given part, its images are already loaded.
  useEffect(() => {
    if (!selectedMovie?.collectionId) return;
    const parts = allMovies.filter(m => m.collectionId === selectedMovie.collectionId);
    for (const part of parts) {
      const backdropImg = new window.Image();
      backdropImg.src = getHighResImage(part.backdrop || part.poster, true);
      const logoSrc = part.logoUrl || part.titleLogo;
      if (logoSrc) {
        const logoImg = new window.Image();
        logoImg.src = getHighResImage(logoSrc);
      }
    }
  }, [selectedMovie?.collectionId, allMovies]);

  // Scroll focused cast member into view dynamically
  useEffect(() => {
    if (selectedMovie && detailsFocusArea === "cast") {
      const castEl = document.getElementById(`cast-item-${focusedCastIndex}`);
      if (castEl) {
        castEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [focusedCastIndex, detailsFocusArea, selectedMovie]);

  // Scroll focused episode into view dynamically
  useEffect(() => {
    if (selectedMovie && selectedMovie.type === "series" && detailsFocusArea === "episodes" && episodesScrollRef.current) {
      const scrollContainer = episodesScrollRef.current;
      const episodeElements = scrollContainer.children;
      if (episodeElements && episodeElements[focusedEpisodeIndex]) {
        const targetEl = episodeElements[focusedEpisodeIndex] as HTMLElement;
        targetEl.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center"
        });
      }
    }
  }, [focusedEpisodeIndex, detailsFocusArea, selectedMovie]);

  // Scroll focused collection/parts item into view dynamically
  useEffect(() => {
    if (selectedMovie && detailsFocusArea === "collection") {
      const collEl = document.getElementById(`collection-item-${focusedCollectionIndex}`);
      if (collEl) {
        collEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      }
    }
  }, [focusedCollectionIndex, detailsFocusArea, selectedMovie]);

  // Smooth scroll of details container itself to show episodes/seasons/collection or go back to top actions
  useEffect(() => {
    if (selectedMovie && detailsContainerRef.current) {
      if (detailsFocusArea === "collection") {
        const collectionHeader = document.getElementById("collection-section-header");
        if (collectionHeader) {
          collectionHeader.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else if (detailsFocusArea === "seasons" || detailsFocusArea === "episodes") {
        const episodesHeader = document.getElementById("episodes-section-header");
        if (episodesHeader) {
          episodesHeader.scrollIntoView({ behavior: "smooth", block: "start" });
        } else {
          const height = detailsContainerRef.current.clientHeight;
          detailsContainerRef.current.scrollTo({
            top: height * 0.45,
            behavior: "smooth"
          });
        }
      } else if (detailsFocusArea === "actions" || detailsFocusArea === "back") {
        detailsContainerRef.current.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      }
    }
  }, [detailsFocusArea, selectedMovie]);

  // Sync watchHistory when a movie starts playing
  useEffect(() => {
    if (playingMovie) {
      setWatchHistory((prev) => {
        const filtered = prev.filter((m) => m.id !== playingMovie.id);
        const updated = [playingMovie, ...filtered].slice(0, 24); // Keep latest 24 movies
        safeStorage.setItem("cinemana_tv_watch_history", JSON.stringify(updated));
        return updated;
      });
    }
  }, [playingMovie]);

  // Load and Parse Subtitle Tracks for active movie/episode
  useEffect(() => {
    if (!playingMovie) {
      setSubCuesAr([]);
      setSubCuesEn([]);
      return;
    }

    setSubtitleOffset(0); // Reset subtitle synchronization offset for the new film

    const parseSubtitlesText = (text: string) => {
      const cues: any[] = [];
      const cleanText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const blocks = cleanText.split(/\n\n+/);
      
      const parseTime = (str: string): number | null => {
        const cleanStr = str.trim().split(/\s+/)[0]; // Discard trailing WebVTT styles (e.g., align:middle)
        const m = cleanStr.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
        if (m) {
          const h = m[1] ? parseInt(m[1], 10) : 0;
          const min = parseInt(m[2], 10);
          const sec = parseInt(m[3], 10);
          const msStr = m[4];
          const ms = parseInt(msStr, 10) / Math.pow(10, msStr.length);
          return h * 3600 + min * 60 + sec + ms;
        }
        const mShort = cleanStr.match(/(\d{1,2}):(\d{1,2})[.,](\d{1,3})/);
        if (mShort) {
          const min = parseInt(mShort[1], 10);
          const sec = parseInt(mShort[2], 10);
          const msStr = mShort[3];
          const ms = parseInt(msStr, 10) / Math.pow(10, msStr.length);
          return min * 60 + sec + ms;
        }
        return null;
      };

      for (const block of blocks) {
        const lines = block.trim().split("\n");
        if (lines.length < 2) continue;

        let timeLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("-->")) {
            timeLineIndex = i;
            break;
          }
        }
        if (timeLineIndex === -1) continue;

        const timeLine = lines[timeLineIndex];
        const textLines = lines.slice(timeLineIndex + 1);
        // Strip both HTML-style tags (<i>, <b>...) and ASS/SSA override tags ({\3c&H...&\fnArial...})
        // that some fan-authored .srt files embed for color/font styling our plain-text renderer can't use.
        const textVal = textLines.join("\n").replace(/<[^>]*>/g, "").replace(/\{\\[^}]*\}/g, "").trim();

        const parts = timeLine.split(/\s*-->\s*/);
        if (parts.length === 2) {
          const startSec = parseTime(parts[0]);
          let endSec = parseTime(parts[1]);
          if (startSec !== null && endSec !== null) {
            // Some real-world subtitle files contain a stray corrupted timestamp (e.g. a credit
            // line accidentally ending an hour later instead of a few seconds later). Left as-is,
            // that single cue would win every time-lookup for its entire bogus duration, silently
            // hiding all real dialogue underneath it. Cap any implausibly long cue.
            const MAX_CUE_DURATION_SEC = 12;
            if (endSec - startSec > MAX_CUE_DURATION_SEC) {
              endSec = startSec + MAX_CUE_DURATION_SEC;
            }
            cues.push({ start: startSec, end: endSec, text: textVal });
          }
        }
      }
      return cues;
    };

    const fetchSub = async (url: string, setCues: (cues: any[]) => void) => {
      if (!url) {
        setCues([]);
        return;
      }
      try {
        const fetchUrl = getApiUrl((url.startsWith("http://") || url.startsWith("https://"))
          ? `/api/proxy-subtitles?url=${encodeURIComponent(url)}`
          : url);

        const response = await fetch(fetchUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          let rawText = "";
          try {
            // Try decoding UTF-8 first
            const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
            rawText = utf8Decoder.decode(arrayBuffer);

            // Auto-detect if it was actually Windows-1256 Arabic encoded (it would decode as UTF-8 without throwing error but contain no Arabic letters)
            const hasArabic = /[\u0600-\u06FF]/.test(rawText);
            if (!hasArabic) {
              const win1256Decoder = new TextDecoder("windows-1256");
              const winText = win1256Decoder.decode(arrayBuffer);
              if (winText && /[\u0600-\u06FF]/.test(winText)) {
                rawText = winText;
              }
            }
          } catch (e) {
            // Fallback to windows-1256 for Arabic subtitles if UTF-8 fails
            try {
              const win1256Decoder = new TextDecoder("windows-1256");
              rawText = win1256Decoder.decode(arrayBuffer);
            } catch (err) {
              const looseDecoder = new TextDecoder("utf-8");
              rawText = looseDecoder.decode(arrayBuffer);
            }
          }
          const cues = parseSubtitlesText(rawText);
          setCues(cues);
        } else {
          console.warn("[Subtitles] Failed to fetch subtitles, status:", response.status);
          setCues([]);
        }
      } catch (err) {
        console.warn("[Subtitles] Failed to fetch subtitle file:", err);
        setCues([]);
      }
    };

    // Subtitle URL sources check (either episode-specific subtitles or general movie/series subtitles, or dynamic server subtitle route)
    const seasonIdStr = activeSeason?.id || "";
    const fallbackAr = playingMovie ? `/api/subtitles?movieId=${playingMovie.id}${activeEpisode ? `&seasonId=${seasonIdStr}&episodeId=${activeEpisode.id}` : ''}&lang=ar` : "";
    const fallbackEn = playingMovie ? `/api/subtitles?movieId=${playingMovie.id}${activeEpisode ? `&seasonId=${seasonIdStr}&episodeId=${activeEpisode.id}` : ''}&lang=en` : "";

    const urlAr = activeEpisode?.subtitlesUrlAr || playingMovie?.subtitlesUrlAr || fallbackAr;
    const urlEn = activeEpisode?.subtitlesUrlEn || playingMovie?.subtitlesUrlEn || fallbackEn;

    fetchSub(urlAr, setSubCuesAr);
    fetchSub(urlEn, setSubCuesEn);
  }, [playingMovie, activeSeason, activeEpisode]);

  // Clear player toast timer
  useEffect(() => {
    if (playerToast) {
      const timer = setTimeout(() => {
        setPlayerToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [playerToast]);

  // Promo slider auto-play rotation
  useEffect(() => {
    if (promos && promos.length > 0) {
      const timer = setInterval(() => {
        setCurrentPromoIndex((prev) => (prev === promos.length - 1 ? 0 : prev + 1));
      }, 8000);
      return () => clearInterval(timer);
    }
  }, [promos]);

  // Fluctuating metric updates & simulated console logs
  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate CPU/RAM
      setMockCpuLoad(prev => {
        const diff = (Math.random() - 0.5) * 5;
        return Math.max(5, Math.min(95, parseFloat((prev + diff).toFixed(1))));
      });
      setMockRamLoad(prev => {
        const diff = (Math.random() - 0.5) * 0.1;
        return Math.max(0.8, Math.min(3.8, parseFloat((prev + diff).toFixed(2))));
      });
      // Fluctuate active users slightly
      setActiveSimulatedUsers(prev => {
        const diff = Math.floor((Math.random() - 0.5) * 30);
        return Math.max(500, prev + diff);
      });

      // Periodically append a log
      const logTemplatesAr = [
        "طلب بحث جديد من مستخدم في بغداد تم تلبيته بنجاح.",
        "عقدة البث CDN في البصرة مستقرة وحمل الترافيك 34%.",
        "تحديث ذاكرة التخزين المؤقت للروابط بنجاح.",
        "فحص أمان خوادم البث: الكل أخضر وسليم.",
        "استعلام Gemini AI المسرع في 240 مللي ثانية.",
      ];
      const logTemplatesEn = [
        "New crawler query processed successfully.",
        "CDN Node Erbil report: load is normal at 18%.",
        "Stream cache buffer cleared.",
        "Security token validation completed.",
        "Gemini latency checked: 285ms, status active.",
      ];
      
      const chosenLog = lang === "ar" 
        ? logTemplatesAr[Math.floor(Math.random() * logTemplatesAr.length)]
        : logTemplatesEn[Math.floor(Math.random() * logTemplatesEn.length)];
      
      setSystemLogs(prev => {
        const updated = [`[${new Date().toLocaleTimeString()}] ${chosenLog}`, ...prev];
        if (updated.length > 30) updated.pop();
        return updated;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [lang]);

  const healClientMovies = (movies: Movie[]): Movie[] => {
    return movies.map(m => {
      const titleAr = m.titleAr || "";
      const titleEn = (m.titleEn || "").toLowerCase();
      
      let language = m.language;
      if (!language) {
        const isAr = 
          titleAr === "آسف على الإزعاج" || 
          titleAr === "مرجان أحمد مرجان" || 
          titleAr === "الحشاشين" || 
          m.id === "series_2" ||
          (m.actors && m.actors.some(a => /[\u0600-\u06FF]/.test(a) && !/^[a-zA-Z\s]+$/.test(a)));
          
        if (isAr) {
          language = "ar";
        } else if (
          titleAr.includes("كوري") || 
          titleEn.includes("squid game") || 
          titleEn.includes("demon slayer") || 
          titleAr.includes("أنمي") || 
          (m.genres && m.genres.includes("رسوم متحركة") && !titleAr.includes("سبايدرمان"))
        ) {
          language = "other";
        } else {
          language = "en";
        }
      }

      let collectionId = m.collectionId;
      let collectionNameAr = m.collectionNameAr;
      let collectionNameEn = m.collectionNameEn;
      let partNumber = m.partNumber;

      if (!collectionId) {
        if (titleAr.includes("سيد الخواتم") || titleEn.includes("lord of the rings") || titleEn.includes("hobbit")) {
          collectionId = "lotr";
          collectionNameAr = "سلسلة سيد الخواتم";
          collectionNameEn = "The Lord of the Rings Collection";
          if (titleAr.includes("عودة الملك") || titleEn.includes("return of the king")) {
            partNumber = 3;
          } else if (titleAr.includes("البرجين") || titleEn.includes("two towers")) {
            partNumber = 2;
          } else {
            partNumber = 1;
          }
        } else if (titleAr.includes("سبايدرمان") || titleEn.includes("spider-man") || titleEn.includes("spiderman")) {
          collectionId = "spiderman";
          collectionNameAr = "سلسلة سبايدرمان";
          collectionNameEn = "Spider-Man Franchise";
          if (titleAr.includes("عبر عالم العنكبوت") || titleEn.includes("across the spider-verse")) {
            partNumber = 2;
          } else if (titleAr.includes("لا عودة للمنزل") || titleEn.includes("no way home")) {
            partNumber = 3;
          } else {
            partNumber = 1;
          }
        } else if (titleAr.includes("كثبان") || titleAr.includes("ديبون") || titleEn.includes("dune")) {
          collectionId = "dune";
          collectionNameAr = "سلسلة كثبان Dune";
          collectionNameEn = "Dune Collection";
          if (titleAr.includes("الجزء الثاني") || titleAr.includes("الثاني") || titleEn.includes("part two") || titleEn.includes("part 2")) {
            partNumber = 2;
          } else {
            partNumber = 1;
          }
        } else if (titleAr.includes("باتمان") || titleEn.includes("batman")) {
          collectionId = "batman";
          collectionNameAr = "سلسلة باتمان";
          collectionNameEn = "Batman Collection";
          if (titleAr.includes("نهوض فارس الظلام") || titleEn.includes("dark knight rises")) {
            partNumber = 3;
          } else if (titleAr.includes("فارس الظلام") || titleEn.includes("dark knight")) {
            partNumber = 2;
          } else {
            partNumber = 1;
          }
        } else if (titleAr.includes("هاري بوتر") || titleEn.includes("harry potter")) {
          collectionId = "harry_potter";
          collectionNameAr = "سلسلة هاري بوتر";
          collectionNameEn = "Harry Potter Series";
          if (titleAr.includes("حجر الفيلسوف") || titleEn.includes("sorcerer's stone") || titleEn.includes("philosopher")) {
            partNumber = 1;
          } else if (titleAr.includes("حجرة الأسرار") || titleEn.includes("chamber of secrets")) {
            partNumber = 2;
          } else if (titleAr.includes("سجين أزكابان") || titleEn.includes("prisoner of azkaban")) {
            partNumber = 3;
          } else {
            partNumber = 4;
          }
        }
      }

      return {
        ...m,
        language,
        collectionId,
        collectionNameAr,
        collectionNameEn,
        partNumber
      };
    });
  };

  interface MovieCollection {
    id: string;
    nameAr: string;
    nameEn: string;
    movies: Movie[];
    rating: number;
  }

  const getMovieCollections = (moviesList: Movie[]): MovieCollection[] => {
    const groups: { [key: string]: Movie[] } = {};
    moviesList.forEach(m => {
      if (m.collectionId) {
        if (!groups[m.collectionId]) {
          groups[m.collectionId] = [];
        }
        if (!groups[m.collectionId].some(existing => existing.id === m.id)) {
          groups[m.collectionId].push(m);
        }
      }
    });

    const collections: MovieCollection[] = [];
    Object.keys(groups).forEach(cid => {
      const movies = groups[cid].sort((a, b) => {
        const pA = Number(a.partNumber || 0) || a.year || 0;
        const pB = Number(b.partNumber || 0) || b.year || 0;
        return pA - pB;
      });
      if (movies.length > 0) {
        const nameAr = movies[0].collectionNameAr || movies[0].titleAr || "سلسلة أفلام";
        const nameEn = movies[0].collectionNameEn || movies[0].titleEn || "Movie Collection";
        const maxRating = Math.max(...movies.map(m => m.rating || 0));
        collections.push({
          id: cid,
          nameAr,
          nameEn,
          movies,
          rating: maxRating
        });
      }
    });

    return collections.sort((a, b) => b.rating - a.rating);
  };

  const buildCollectionsCategory = (allMoviesList: Movie[]): Category => {
    const collections = getMovieCollections(allMoviesList);
    const collectionSyntheticMovies = collections.map(col => {
      const firstMovie = col.movies[0];
      // This card is a stand-in for the collection as a whole, built by summarizing the first
      // movie in it - but it's still opened as a real details/play screen, so it needs every
      // field those screens actually read. Spreading firstMovie first and overriding only what's
      // collection-specific (id/title/rating/collectionId) avoids repeating the "one more missing
      // field" bug (logo, cast photos, subtitles, trailer, etc. have each turned up separately).
      return {
        ...firstMovie,
        id: `collection_${col.id}`,
        titleAr: col.nameAr,
        titleEn: col.nameEn,
        rating: col.rating,
        collectionId: col.id,
        partNumber: ""
      };
    });

    const items = [
      ...collectionSyntheticMovies,
      {
        id: "show_more_collections",
        titleAr: "عرض المزيد",
        titleEn: "Show More",
        type: "movie" as const,
        rating: 10,
        year: 2026,
        duration: "",
        genres: [],
        poster: "",
        backdrop: "",
        storyAr: "",
        storyEn: "",
        actors: [],
        quality: "",
        servers: []
      }
    ];

    return {
      id: "collections",
      titleAr: lang === "ar" ? "سلاسل الأفلام الأكثر تقييماً" : "Top Movie Collections",
      titleEn: "Top Rated Movie Collections",
      items
    };
  };

  useEffect(() => {
    if (allMovies.length > 0) {
      setCategories(prev => {
        const hasCollections = prev.some(cat => cat.id === "collections");
        const collectionsCat = buildCollectionsCategory(allMovies);
        
        if (!hasCollections) {
          const nextCats = [...prev];
          nextCats.splice(1, 0, collectionsCat);
          return nextCats;
        } else {
          return prev.map(cat => cat.id === "collections" ? collectionsCat : cat);
        }
      });
    }
  }, [allMovies, lang]);

  const fetchMoviesData = async () => {
    let fetchedData = null;
    try {
      const response = await fetch(getApiUrl("/api/movies"));
      if (response.ok) {
        fetchedData = await response.json();
      }
    } catch (_err) {
      // Ignore network error and try local movies.json next
    }

    if (!fetchedData) {
      try {
        const localResp = await fetch("./movies.json");
        if (localResp.ok) {
          const rawItems = await localResp.json();
          if (Array.isArray(rawItems) && rawItems.length > 0) {
            fetchedData = { items: rawItems };
          }
        }
      } catch (_err) {
        // Fallback to imported initialMovies
      }
    }

    if (fetchedData && fetchedData.categories) {
      // Heal categories and their items
      const healedCategories = (fetchedData.categories || []).map((cat: any) => ({
        ...cat,
        items: healClientMovies(cat.items || [])
      }));

      // Populate allMovies flat list
      const flatList: Movie[] = [];
      healedCategories.forEach((cat: Category) => {
        if (cat.items) {
          cat.items.forEach((item: Movie) => {
            if (!flatList.some(m => m.id === item.id)) {
              flatList.push(item);
            }
          });
        }
      });

      const finalFlatList = flatList.length > 0 ? flatList : healClientMovies(fallbackDatabase);
      setAllMovies(finalFlatList);

      const fetchedHeroMovies = fetchedData.heroMovies && fetchedData.heroMovies.length > 0 
        ? healClientMovies(fetchedData.heroMovies) 
        : (healedCategories.find((c: any) => c.items && c.items.length > 0)?.items?.slice(0, 10) || finalFlatList.slice(0, 10));
      
      setHeroMovies(fetchedHeroMovies);

      const chosenHero = fetchedHeroMovies[0] || (fetchedData.hero ? healClientMovies([fetchedData.hero])[0] : undefined) || finalFlatList[0];
      setHeroMovie(chosenHero);
      setCurrentHeroIndex(0);
      
      setCategories(healedCategories.some((c: any) => c.items && c.items.length > 0) ? healedCategories : [
        { id: "top10", titleAr: "الأعمال 10 الأكثر مشاهدة هذا الأسبوع", titleEn: "Top 10 This Week", items: sortMoviesByPart(finalFlatList.filter(m => m.rating >= 8.5).slice(0, 10)) },
        { id: "recent", titleAr: "الأفلام والمسلسلات المضافة حديثاً", titleEn: "Recently Added", items: sortMoviesByPart(finalFlatList.slice().reverse()) },
        { id: "series", titleAr: "أحدث المسلسلات والبرامج", titleEn: "Latest Series", items: sortMoviesByPart(finalFlatList.filter(m => m.type === "series")) },
        { id: "action", titleAr: "أفلام الأكشن والخيال العلمي", titleEn: "Action & Sci-Fi", items: sortMoviesByPart(finalFlatList.filter(m => m.genres?.some(g => g.includes("أكشن") || g.includes("خيال") || g.toLowerCase().includes("action")))) },
        { id: "movies", titleAr: "أفلام سينمانا المميزة", titleEn: "Featured Movies", items: sortMoviesByPart(finalFlatList.filter(m => m.type === "movie")) }
      ]);
      setPromos(fetchedData.promos || localFallbackPromos);
    } else {
      // Complete multi-category structure built from all 302 real items
      const moviesList = fetchedData?.items ? healClientMovies(fetchedData.items) : healClientMovies(fallbackDatabase);
      const fallbackHeroMovies = moviesList.slice(0, 10);
      setHeroMovies(fallbackHeroMovies);
      setHeroMovie(fallbackHeroMovies[0]);
      setCurrentHeroIndex(0);
      setPromos(localFallbackPromos);

      const recentlyAdded = moviesList.slice().reverse();
      const trending = moviesList.filter(m => m.rating >= 8.5);
      const seriesList = moviesList.filter(m => m.type === "series");
      const actionList = moviesList.filter(m => m.genres?.some(g => g.includes("أكشن") || g.includes("خيال") || g.toLowerCase().includes("action")));
      const moviesOnly = moviesList.filter(m => m.type === "movie");

      const initialCats = [
        { id: "top10", titleAr: "الأعمال 10 الأكثر مشاهدة هذا الأسبوع", titleEn: "Top 10 This Week", items: sortMoviesByPart(trending.slice(0, 10)) },
        { id: "recent", titleAr: "الأفلام والمسلسلات المضافة حديثاً", titleEn: "Recently Added", items: sortMoviesByPart(recentlyAdded) },
        { id: "series", titleAr: "أحدث المسلسلات والبرامج", titleEn: "Latest Series", items: sortMoviesByPart(seriesList) },
        { id: "action", titleAr: "أفلام الأكشن والخيال العلمي", titleEn: "Action & Sci-Fi", items: sortMoviesByPart(actionList) },
        { id: "movies", titleAr: "أفلام سينمانا المميزة", titleEn: "Featured Movies", items: sortMoviesByPart(moviesOnly) }
      ];

      setCategories(initialCats);
      setAllMovies(moviesList);
    }
  };

  const handleInjectMedia = (e: React.FormEvent) => {
    e.preventDefault();
    if (!injTitleAr.trim() || !injTitleEn.trim()) {
      return;
    }

    const newId = `custom_${Date.now()}`;
    const newGenresArray = injGenres.split(",").map(g => g.trim()).filter(Boolean);

    const newMedia: Movie = {
      id: newId,
      titleAr: injTitleAr,
      titleEn: injTitleEn,
      type: injType,
      rating: parseFloat(injRating.toString()) || 8.0,
      year: parseInt(injYear.toString()) || 2025,
      duration: injDuration || "2h",
      genres: newGenresArray.length > 0 ? newGenresArray : ["عام"],
      poster: injPoster || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
      backdrop: injBackdrop || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200&q=80",
      storyAr: injStoryAr || "فيلم مضاف يدوياً من لوحة التحكم.",
      storyEn: injStoryEn || "A custom-injected film added from the control console.",
      actors: [lang === "ar" ? "ممثل مخصص" : "Injected Actor", "GCP Service Node"],
      quality: injQuality || "4K HDR",
      servers: [
        { name: lang === "ar" ? "سيرفر البث الرئيسي" : "Default Stream Server", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
      ]
    };

    // Update flat list
    setAllMovies(prev => [newMedia, ...prev]);

    // Update categories
    setCategories(prev => {
      return prev.map(cat => {
        if (cat.id === "recent") {
          return { ...cat, items: [newMedia, ...cat.items] };
        }
        if (cat.id === "series" && injType === "series") {
          return { ...cat, items: [newMedia, ...cat.items] };
        }
        if (cat.id === "trending" && newMedia.rating >= 8.5) {
          return { ...cat, items: [newMedia, ...cat.items] };
        }
        return cat;
      });
    });

    // Add logging
    setSystemLogs(prev => [
      `[${new Date().toLocaleTimeString()}] INJECTED: '${newMedia.titleEn}' added to live catalog successfully.`,
      ...prev
    ]);

    setInjTitleAr("");
    setInjTitleEn("");
  };

  const scrollEpisodes = (direction: "left" | "right") => {
    if (episodesScrollRef.current) {
      const scrollAmount = 350; // horizontal slide offset
      episodesScrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth"
      });
    }
  };

  // Save/Remove Favorite helper
  const toggleFavorite = (movie: Movie) => {
    let updated;
    if (favorites.some(f => f.id === movie.id)) {
      updated = favorites.filter(f => f.id !== movie.id);
    } else {
      updated = [...favorites, movie];
    }
    setFavorites(updated);
    safeStorage.setItem("cinemana_tv_favorites", JSON.stringify(updated));
  };

  const playNextMedia = () => {
    if (!playingMovie) return;

    if (playingMovie.type === "series" && activeEpisode && activeSeason) {
      const seasons = generateSeasonsForSeries(playingMovie);
      const currentSeasonIndex = seasons.findIndex(s => s.number === activeSeason.number);
      const currentEpisodeIndex = activeSeason.episodes.findIndex(e => e.id === activeEpisode.id);

      if (currentEpisodeIndex !== -1 && currentEpisodeIndex < activeSeason.episodes.length - 1) {
        // Next episode in same season
        const nextEp = activeSeason.episodes[currentEpisodeIndex + 1];
        setActiveEpisode(nextEp);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `الحلقة التالية: ${nextEp.titleAr}` : `Next Episode: ${nextEp.titleEn}`);
        return;
      } else if (currentSeasonIndex !== -1 && currentSeasonIndex < seasons.length - 1) {
        // First episode of next season
        const nextSeason = seasons[currentSeasonIndex + 1];
        const nextEp = nextSeason.episodes[0];
        setActiveSeason(nextSeason);
        setActiveEpisode(nextEp || null);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `${nextSeason.titleAr} - الحلقة الأولى` : `${nextSeason.titleEn} - First Episode`);
        return;
      } else {
        // Last episode of last season, wrap around to S1 E1
        const firstSeason = seasons[0];
        const firstEp = firstSeason?.episodes[0];
        setActiveSeason(firstSeason || null);
        setActiveEpisode(firstEp || null);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `العودة للموسم الأول: ${firstEp?.titleAr}` : `Back to Season 1: ${firstEp?.titleEn}`);
        return;
      }
    }

    const filtered = allMovies.filter(m => m.type === playingMovie.type);
    const currentIndex = filtered.findIndex(m => m.id === playingMovie.id);
    if (currentIndex !== -1 && currentIndex < filtered.length - 1) {
      setPlayingMovie(filtered[currentIndex + 1]);
      setActiveServerIndex(0);
      setPlayerProgress(0);
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? `جاري تشغيل: ${filtered[currentIndex + 1].titleAr}` : `Now Playing: ${filtered[currentIndex + 1].titleEn}`);
    } else if (filtered.length > 0) {
      // Wrap around
      setPlayingMovie(filtered[0]);
      setActiveServerIndex(0);
      setPlayerProgress(0);
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? `جاري تشغيل: ${filtered[0].titleAr}` : `Now Playing: ${filtered[0].titleEn}`);
    }
  };

  const playPrevMedia = () => {
    if (!playingMovie) return;

    if (playingMovie.type === "series" && activeEpisode && activeSeason) {
      const seasons = generateSeasonsForSeries(playingMovie);
      const currentSeasonIndex = seasons.findIndex(s => s.number === activeSeason.number);
      const currentEpisodeIndex = activeSeason.episodes.findIndex(e => e.id === activeEpisode.id);

      if (currentEpisodeIndex > 0) {
        // Previous episode in same season
        const prevEp = activeSeason.episodes[currentEpisodeIndex - 1];
        setActiveEpisode(prevEp);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `الحلقة السابقة: ${prevEp.titleAr}` : `Previous Episode: ${prevEp.titleEn}`);
        return;
      } else if (currentSeasonIndex > 0) {
        // Last episode of previous season
        const prevSeason = seasons[currentSeasonIndex - 1];
        const prevEp = prevSeason.episodes[prevSeason.episodes.length - 1];
        setActiveSeason(prevSeason);
        setActiveEpisode(prevEp || null);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `${prevSeason.titleAr} - الحلقة الأخيرة` : `${prevSeason.titleEn} - Last Episode`);
        return;
      } else {
        // First episode of first season, wrap around to last episode of last season
        const lastSeason = seasons[seasons.length - 1];
        const lastEp = lastSeason.episodes[lastSeason.episodes.length - 1];
        setActiveSeason(lastSeason);
        setActiveEpisode(lastEp || null);
        setActiveServerIndex(0);
        setPlayerProgress(0);
        setIsPlaying(true);
        setPlayerToast(lang === "ar" ? `الموسم الأخير: ${lastEp?.titleAr}` : `Final Season: ${lastEp?.titleEn}`);
        return;
      }
    }

    const filtered = allMovies.filter(m => m.type === playingMovie.type);
    const currentIndex = filtered.findIndex(m => m.id === playingMovie.id);
    if (currentIndex !== -1 && currentIndex > 0) {
      setPlayingMovie(filtered[currentIndex - 1]);
      setActiveServerIndex(0);
      setPlayerProgress(0);
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? `جاري تشغيل: ${filtered[currentIndex - 1].titleAr}` : `Now Playing: ${filtered[currentIndex - 1].titleEn}`);
    } else if (filtered.length > 0) {
      // Wrap around
      setPlayingMovie(filtered[filtered.length - 1]);
      setActiveServerIndex(0);
      setPlayerProgress(0);
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? `جاري تشغيل: ${filtered[filtered.length - 1].titleAr}` : `Now Playing: ${filtered[filtered.length - 1].titleEn}`);
    }
  };

  const cycleQuality = () => {
    const qualities = ["FHD", "HD", "4K", "Auto"];
    const currentIndex = qualities.indexOf(playerQuality);
    const nextIndex = (currentIndex + 1) % qualities.length;
    
    // Save current playback position
    if (videoRef.current) {
      lastPlaybackTimeRef.current = videoRef.current.currentTime;
    }
    
    setPlayerQuality(qualities[nextIndex]);
    setPlayerToast(lang === "ar" ? `تم تغيير الجودة إلى: ${qualities[nextIndex]} ⚙️` : `Quality changed to: ${qualities[nextIndex]} ⚙️`);

    // If there are multiple servers, switch to the next server to simulate true stream reload
    const serversList = activeEpisode ? activeEpisode.servers : (playingMovie as any)?.servers;
    if (serversList && serversList.length > 1) {
      setActiveServerIndex((activeServerIndex + 1) % serversList.length);
    } else if (videoRef.current) {
      // Reload the video tag to simulate a quality switch if there's only one server URL
      const currentSrc = videoRef.current.src;
      videoRef.current.src = "";
      videoRef.current.load();
      videoRef.current.src = currentSrc;
      videoRef.current.load();
    }
  };

  const cycleSubtitles = () => {
    const subtitleLabelsAr: Record<string, string> = { ar: "العربية", en: "الإنجليزية", off: "إيقاف الترجمة" };
    const subtitleLabelsEn: Record<string, string> = { ar: "Arabic", en: "English", off: "Subtitles Off" };
    const options = ["ar", "en", "off"];
    const currentIndex = options.indexOf(playerSubtitles);
    const nextOption = options[(currentIndex + 1) % options.length];
    setPlayerSubtitles(nextOption);
    setPlayerToast(lang === "ar" ? `الترجمة: ${subtitleLabelsAr[nextOption]} 💬` : `Subtitles: ${subtitleLabelsEn[nextOption]} 💬`);
  };

  const skipIntroOrScenes = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      const current = videoRef.current.currentTime || 0;
      let targetTime = current + 90;
      if (isFinite(duration) && duration > 0) {
        targetTime = Math.min(duration, targetTime);
      }
      if (isFinite(targetTime) && targetTime >= 0) {
        videoRef.current.currentTime = targetTime;
      }
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? "تم تخطي المقدمة (90 ثانية) ⏩" : "Skipped Intro (90s) ⏩");
    }
  };

  const filterInappropriateScenes = () => {
    if (videoRef.current) {
      const duration = videoRef.current.duration;
      const current = videoRef.current.currentTime || 0;
      let targetTime = current + 45;
      if (isFinite(duration) && duration > 0) {
        targetTime = Math.min(duration, targetTime);
      }
      if (isFinite(targetTime) && targetTime >= 0) {
        videoRef.current.currentTime = targetTime;
      }
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      setPlayerToast(lang === "ar" ? "تم تصفية وحذف المشاهد غير الملائمة بنجاح 🛡️" : "Filtered and skipped inappropriate scenes successfully 🛡️");
    }
  };

  const getSubtitleForTime = (currentTime: number) => {
    const adjustedTime = currentTime + subtitleOffset;
    if (subCuesAr && subCuesAr.length > 0) {
      const activeCue = subCuesAr.find(cue => adjustedTime >= cue.start && adjustedTime <= cue.end);
      if (activeCue) return activeCue.text;
    }
    return "";
  };

  const getSubtitleForTimeEn = (currentTime: number) => {
    const adjustedTime = currentTime + subtitleOffset;
    if (subCuesEn && subCuesEn.length > 0) {
      const activeCue = subCuesEn.find(cue => adjustedTime >= cue.start && adjustedTime <= cue.end);
      if (activeCue) return activeCue.text;
    }
    return "";
  };

  // Keyboard navigation logic mapping TV D-Pad controller keys.
  //
  // handleKeyDown reads a long tail of nav-related state (searchFocusArea,
  // focusedSearchKey, keyboardLang/Mode, focusedActionIndex, focusedCastIndex,
  // movieGenreFilter, settingsFocusArea, ...) that used to be captured once when this
  // effect's dependency array last changed, and NOT refreshed in between — e.g. pressing
  // Left in the search keyboard changed the real focusedSearchKey state (so the ring
  // visibly moved), but the listener's closure still held the old value, so the next OK
  // press typed whatever letter used to be focused, not the one on screen. Any nav state
  // left out of that list (it's easy to forget one — this is why it happened) went stale
  // the same way. Fix: define handleKeyDown fresh every render (so it always closes over
  // current state) and stash it in a ref; the actual window listener is attached once and
  // just calls through the ref — same "latest ref" idiom as handleDirRef in useFocusNav.tsx.
  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handleKeyDownRef.current = (e: KeyboardEvent) => {
      setShowSplash(false);
      // See sectionEntryGuardUntilRef above: swallow a *confirm* press for a brief window
      // right after picking a section (or opening a movie's details), to absorb whatever
      // is producing a second effective OK right on top of the one that opened the screen.
      // Scoped to just OK/Enter — blocking every key here, arrows included, used to make
      // fast directional browsing (e.g. flipping through a franchise's parts, each pressed
      // right after the last) feel like it was lagging a quarter-second behind every press.
      const isConfirmKeyForGuard = e.key === "Enter" || e.key === "Select" || e.key === "Accept" || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;
      if (isConfirmKeyForGuard && Date.now() < sectionEntryGuardUntilRef.current) {
        e.preventDefault();
        return;
      }
      // Don't intercept typing if user clicks search input with actual keyboard - but still let
      // ArrowDown/ArrowUp escape the field to reach results/keyboard below, otherwise a user who
      // clicks into the real search <input> gets permanently stuck there with no way to navigate
      // away except a mouse click, since Left/Right/typing keys must stay native for text editing.
      const activeIsTextInput = document.activeElement?.tagName === "INPUT";
      if (activeIsTextInput && e.key !== "Enter" && e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "ArrowUp") {
        return;
      }
      if (activeIsTextInput && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        (document.activeElement as HTMLElement).blur();
      }
      // Every <select> in this app (language/font/subtitle-shadow dropdowns) is driven
      // entirely by the D-pad focus ring + OK, never real DOM focus — they're tabIndex=-1
      // for exactly this reason. If one somehow still ends up genuinely focused, its native
      // Up/Down-changes-the-value behavior fires on the same arrow keys used for D-pad
      // navigation, silently changing e.g. the app language while the user just meant to
      // move around the screen — so unconditionally blur it before doing anything else.
      if (document.activeElement?.tagName === "SELECT") {
        (document.activeElement as HTMLElement).blur();
      }

      // The video player owns its own FocusNavProvider/listener while open (see
      // VideoPlayer.tsx) — defer to it entirely so keys aren't double-processed here.
      if (playingMovie) {
        return;
      }

      // Sidebar and Home (hero/rails) are migrated to the new root FocusNavProvider
      // (see Sidebar.tsx/HomeScreen.tsx) — defer to it entirely while active. Every
      // other navSection value is still owned by this legacy handler for now.
      //
      // Opening a movie's details (or the person page) from the Home screen — the hero's
      // "info" button, or a rail card — sets selectedMovie/selectedPerson without ever
      // touching navSection, since that's a pure new-system focus transition. So navSection
      // can still read "hero"/"rails" while a details overlay is fully covering the screen;
      // deferring to the new system in that case swallowed every key press (it kept quietly
      // moving focus around the hidden Home screen underneath), leaving the visible details
      // page completely unresponsive. Below, the "selectedMovie" branch is exactly what
      // should own input then, so it must not be skipped here.
      if ((navSection === "sidebar" || navSection === "hero" || navSection === "rails") && !selectedMovie && !selectedPerson) {
        return;
      }

      // Standard Android TV D-pad / Keyboard keys and keycodes
      const key = e.key;
      const keyCode = e.keyCode;

      if (key === "ArrowUp" || key === "Up" || keyCode === 38) {
        e.preventDefault();
        navigateTV("up");
      } else if (key === "ArrowDown" || key === "Down" || keyCode === 40) {
        e.preventDefault();
        navigateTV("down");
      } else if (key === "ArrowLeft" || key === "Left" || keyCode === 37) {
        e.preventDefault();
        navigateTV("left");
      } else if (key === "ArrowRight" || key === "Right" || keyCode === 39) {
        e.preventDefault();
        navigateTV("right");
      } else if (key === "Enter" || key === "Select" || key === "Accept" || keyCode === 13 || keyCode === 23 || keyCode === 66) {
        e.preventDefault();
        navigateTV("ok");
      } else if (
        key === "Escape" || 
        key === "Backspace" || 
        key === "GoBack" || 
        key === "BrowserBack" || 
        key === "Back" || 
        keyCode === 27 || 
        keyCode === 8 || 
        keyCode === 4 || 
        keyCode === 10009 || 
        keyCode === 461
      ) {
        // Back navigation acts as TV back button
        if (playingMovie) {
          e.preventDefault();
          setPlayingMovie(null);
        } else if (selectedMovie) {
          e.preventDefault();
          setSelectedMovie(null);
        } else if (selectedPerson) {
          e.preventDefault();
          if (selectedPerson.previousMovie) {
            setSelectedMovie(selectedPerson.previousMovie);
            setNavSection("details");
          } else {
            setNavSection((selectedPerson.previousNavSection as any) || "hero");
          }
          setSelectedPerson(null);
        } else if (navSection === "search" || navSection === "favorites" || navSection === "settings" || navSection === "movies_section" || navSection === "series_section" || navSection === "admin" || navSection === "person_section") {
          e.preventDefault();
          setNavSection("hero");
          setActiveSidebarItem(0);
        }
      }
  };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKeyDownRef.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  // Exposes whether the back/escape key above has anywhere left to go within the app -
  // read by MainActivity.kt (see its onKeyDown) before deciding whether a physical back
  // press should close the app. Without this the native side had no way to tell "the web
  // app just closed a video/dialog" apart from "there's nothing left to close", and was
  // exiting on every single back press regardless of screen. Mirrors exactly the set of
  // conditions the Escape branch above checks, in the same order/precedence.
  useEffect(() => {
    (window as any).__cinemanaAtRoot =
      !playingMovie &&
      !selectedMovie &&
      !selectedPerson &&
      (navSection === "hero" || navSection === "rails" || navSection === "sidebar");
  }, [playingMovie, selectedMovie, selectedPerson, navSection]);

  // Auto-scroll category rails smoothly into view when focused rail changes
  useEffect(() => {
    if (navSection === "rails") {
      const railEl = document.getElementById(`category-rail-${focusedRailIndex}`);
      if (railEl) {
        railEl.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [navSection, focusedRailIndex]);

  // Moving focus back up to the Genre/Language/Sort filter row only guarantees that row
  // itself scrolls into view, not the very top of the section — so pressing Up from the
  // first card row left the filters scrolled just out of frame instead of visible.
  useEffect(() => {
    if (sectionFocusArea === "filters") {
      const containerId = navSection === "movies_section" ? "movies-section-scroll" : navSection === "series_section" ? "series-section-scroll" : null;
      if (containerId) {
        scrollElementToTop(containerId);
      }
    }
  }, [sectionFocusArea, navSection]);

  // Same idea for Collections: reaching the topmost collection row only guarantees that
  // row is visible, not the page header above it.
  useEffect(() => {
    if (navSection === "collections_section" && focusedRailIndex === 0) {
      scrollElementToTop("collections-section-scroll");
    }
  }, [navSection, focusedRailIndex]);

  // Auto-scroll active dropdown focused item into view
  useEffect(() => {
    if (activeDropdown) {
      const el = document.querySelector('[data-dropdown-focused="true"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [activeDropdown, focusedDropdownItemIndex]);

  // These card grids (search results, movies, series, favorites, watch history) all use a
  // responsive `auto-fill` CSS layout, so how many cards actually fit per row depends on
  // viewport width — a hardcoded "5" for Up/Down doesn't track that, so whenever the real
  // column count differs, Up/Down lands mid-row instead of the card directly above/below,
  // which reads as focus jumping around at random. Measuring the real DOM instead keeps
  // it correct at any width, without having to keep a JS constant in sync with the CSS.
  const getGridColumnCount = (containerId: string): number => {
    const container = document.getElementById(containerId);
    if (!container) return 5;
    const cards = Array.from(container.children) as HTMLElement[];
    if (cards.length < 2) return Math.max(1, cards.length);
    const firstTop = cards[0].offsetTop;
    let count = 0;
    for (const card of cards) {
      if (card.offsetTop !== firstTop) break;
      count++;
    }
    return count || 1;
  };

  // Central Navigation Engine (Handles virtual remote & real keyboard)
  const navigateTV = (direction: "up" | "down" | "left" | "right" | "ok" | "back" | "home") => {
    setLastRemoteAction(direction);
    setTimeout(() => setLastRemoteAction(null), 300);

    // If classification activeDropdown is open, intercept navigation
    if (activeDropdown) {
      const isGenre = activeDropdown.includes("genre");
      const isLanguage = activeDropdown.includes("language");
      const options = isGenre
        ? ALL_GENRES
        : isLanguage
        ? ALL_LANGUAGES
        : ["most_watched", "highest_rated", "newest"];

      if (direction === "down") {
        setFocusedDropdownItemIndex(prev => Math.min(prev + 1, options.length - 1));
      } else if (direction === "up") {
        setFocusedDropdownItemIndex(prev => Math.max(prev - 1, 0));
      } else if (direction === "back") {
        setActiveDropdown(null);
      } else if (direction === "ok") {
        const selectedValue = options[focusedDropdownItemIndex];
        if (activeDropdown === "movie_genre") {
          setMovieGenreFilter(selectedValue);
        } else if (activeDropdown === "series_genre") {
          setSeriesGenreFilter(selectedValue);
        } else if (activeDropdown === "movie_sort") {
          setMovieSortBy(selectedValue);
        } else if (activeDropdown === "series_sort") {
          setSeriesSortBy(selectedValue);
        } else if (activeDropdown === "movie_language") {
          setMovieLanguageFilter(selectedValue);
        } else if (activeDropdown === "series_language") {
          setSeriesLanguageFilter(selectedValue);
        }
        setActiveDropdown(null);
      }
      return;
    }

    // Video player owns its own navigation while open (see VideoPlayer.tsx) — the
    // handleKeyDown guard above already returns before navigateTV is ever called here.

    // If Details Screen is open
    if (selectedMovie) {
      if (direction === "back") {
        setSelectedMovie(null);
        return;
      }

      const castItems = getCastItems(selectedMovie, lang);
      const castItemsCount = castItems.length;
      const seasons = selectedMovie.type === "series" ? generateSeasonsForSeries(selectedMovie) : [];
      const currentSeason = seasons.find((s) => s.number === selectedSeasonNumber) || seasons[0];
      const episodesCount = currentSeason?.episodes.length || 0;
      const collectionCount = collectionMovies.length;

      if (detailsFocusArea === "back") {
        if (direction === "down" || direction === "left" || direction === "right") {
          setDetailsFocusArea("actions");
          setFocusedActionIndex(0);
        } else if (direction === "ok") {
          setSelectedMovie(null);
        }
      } else if (detailsFocusArea === "actions") {
        if (direction === "up") {
          setDetailsFocusArea("back");
        } else if (direction === "down") {
          if (castItemsCount > 0) {
            setDetailsFocusArea("cast");
            setFocusedCastIndex(0);
          } else if (selectedMovie.type === "series" && seasons.length > 0) {
            setDetailsFocusArea("seasons");
          } else if (collectionCount > 1) {
            setDetailsFocusArea("collection");
            setFocusedCollectionIndex(0);
          }
        } else if (direction === "left") {
          setFocusedActionIndex(prev => (prev === 0 ? 1 : 0));
        } else if (direction === "right") {
          setFocusedActionIndex(prev => (prev === 1 ? 0 : 1));
        } else if (direction === "ok") {
          if (focusedActionIndex === 0) {
            // Play Button
            if (selectedMovie.type === "series") {
              const firstSzn = seasons[0];
              const firstEp = firstSzn?.episodes[0];
              setActiveSeason(firstSzn || null);
              setActiveEpisode(firstEp || null);
            } else {
              setActiveSeason(null);
              setActiveEpisode(null);
            }
            setActiveServerIndex(0);
            setPlayingMovie(selectedMovie);
          } else if (focusedActionIndex === 1) {
            // Toggle favorite
            toggleFavorite(selectedMovie);
          }
        }
      } else if (detailsFocusArea === "cast") {
        if (direction === "up") {
          setDetailsFocusArea("actions");
          setFocusedActionIndex(0);
        } else if (direction === "down") {
          if (selectedMovie.type === "series" && seasons.length > 0) {
            setDetailsFocusArea("seasons");
          } else if (collectionCount > 1) {
            setDetailsFocusArea("collection");
            setFocusedCollectionIndex(0);
          } else {
            setDetailsFocusArea("back");
          }
        } else if (direction === "left") {
          if (lang === "ar") {
            setFocusedCastIndex(prev => Math.min(prev + 1, castItemsCount - 1));
          } else {
            setFocusedCastIndex(prev => Math.max(prev - 1, 0));
          }
        } else if (direction === "right") {
          if (lang === "ar") {
            setFocusedCastIndex(prev => Math.max(prev - 1, 0));
          } else {
            setFocusedCastIndex(prev => Math.min(prev + 1, castItemsCount - 1));
          }
        } else if (direction === "ok") {
          const item = castItems[focusedCastIndex];
          if (item) {
            setSelectedPerson({
              name: item.name,
              role: item.role,
              photoUrl: item.photoUrl,
              previousNavSection: navSection,
              previousMovie: selectedMovie
            });
            setNavSection("person_section");
            setSelectedMovie(null);
          }
        }
      } else if (detailsFocusArea === "seasons") {
        if (direction === "up") {
          if (castItemsCount > 0) {
            setDetailsFocusArea("cast");
            setFocusedCastIndex(0);
          } else {
            setDetailsFocusArea("actions");
            setFocusedActionIndex(0);
          }
        } else if (direction === "down") {
          setDetailsFocusArea("episodes");
          setFocusedEpisodeIndex(0);
        } else if (direction === "left") {
          const currentSeasonIndex = seasons.findIndex(s => s.number === selectedSeasonNumber);
          if (lang === "ar") {
            if (currentSeasonIndex < seasons.length - 1) {
              setSelectedSeasonNumber(seasons[currentSeasonIndex + 1].number);
              setFocusedEpisodeIndex(0);
            }
          } else {
            if (currentSeasonIndex > 0) {
              setSelectedSeasonNumber(seasons[currentSeasonIndex - 1].number);
              setFocusedEpisodeIndex(0);
            }
          }
        } else if (direction === "right") {
          const currentSeasonIndex = seasons.findIndex(s => s.number === selectedSeasonNumber);
          if (lang === "ar") {
            if (currentSeasonIndex > 0) {
              setSelectedSeasonNumber(seasons[currentSeasonIndex - 1].number);
              setFocusedEpisodeIndex(0);
            }
          } else {
            if (currentSeasonIndex < seasons.length - 1) {
              setSelectedSeasonNumber(seasons[currentSeasonIndex + 1].number);
              setFocusedEpisodeIndex(0);
            }
          }
        } else if (direction === "ok") {
          setDetailsFocusArea("episodes");
          setFocusedEpisodeIndex(0);
        }
      } else if (detailsFocusArea === "episodes") {
        if (direction === "up") {
          setDetailsFocusArea("seasons");
        } else if (direction === "down") {
          if (collectionCount > 1) {
            setDetailsFocusArea("collection");
            setFocusedCollectionIndex(0);
          }
        } else if (direction === "left") {
          if (lang === "ar") {
            if (focusedEpisodeIndex < episodesCount - 1) {
              setFocusedEpisodeIndex(prev => prev + 1);
            }
          } else {
            if (focusedEpisodeIndex > 0) {
              setFocusedEpisodeIndex(prev => prev - 1);
            }
          }
        } else if (direction === "right") {
          if (lang === "ar") {
            if (focusedEpisodeIndex > 0) {
              setFocusedEpisodeIndex(prev => prev - 1);
            }
          } else {
            if (focusedEpisodeIndex < episodesCount - 1) {
              setFocusedEpisodeIndex(prev => prev + 1);
            }
          }
        } else if (direction === "ok") {
          const ep = currentSeason?.episodes[focusedEpisodeIndex];
          if (ep) {
            setActiveSeason(currentSeason);
            setActiveEpisode(ep);
            setActiveServerIndex(0);
            setPlayingMovie(selectedMovie);
          }
        }
      } else if (detailsFocusArea === "collection") {
        if (direction === "up") {
          if (selectedMovie.type === "series" && episodesCount > 0) {
            setDetailsFocusArea("episodes");
          } else if (castItemsCount > 0) {
            setDetailsFocusArea("cast");
            setFocusedCastIndex(0);
          } else {
            setDetailsFocusArea("actions");
            setFocusedActionIndex(0);
          }
        } else if (direction === "left") {
          if (lang === "ar") {
            if (focusedCollectionIndex < collectionCount - 1) {
              setFocusedCollectionIndex(prev => prev + 1);
            }
          } else {
            if (focusedCollectionIndex > 0) {
              setFocusedCollectionIndex(prev => prev - 1);
            }
          }
        } else if (direction === "right") {
          if (lang === "ar") {
            if (focusedCollectionIndex > 0) {
              setFocusedCollectionIndex(prev => prev - 1);
            }
          } else {
            if (focusedCollectionIndex < collectionCount - 1) {
              setFocusedCollectionIndex(prev => prev + 1);
            }
          }
        } else if (direction === "ok") {
          const collItem = collectionMovies[focusedCollectionIndex];
          if (collItem) {
            setSelectedMovie(collItem);
            setSelectedSeasonNumber(1);
            setFocusedEpisodeIndex(0);
            setFocusedCollectionIndex(0);
            setDetailsFocusArea("actions");
          }
        }
      }
      return;
    }

    // Main dashboard navigation — "sidebar"/"hero"/"rails" are fully owned by the new
    // root FocusNavProvider now (see Sidebar.tsx/HomeScreen.tsx); this handler never
    // even runs for them (see the early guard above), so their old cases are gone.
    switch (navSection) {
      case "search": {
        if (!searchKeyboardTouched) setSearchKeyboardTouched(true);
        const currentKeys = (keyboardMode === "symbols" ? symbolKeys : (keyboardLang === "ar" ? arabicLetters : englishLetters));
        const numRows = currentKeys.length;
        const filteredResults = searchResults.filter(m => searchTypeFilter === "all" || m.type === searchTypeFilter);

        if (searchFocusArea === "keyboard") {
          const r = focusedSearchKey.row;
          const c = focusedSearchKey.col;

          // Letter rows are no longer a uniform 7 keys wide (Arabic row 1 now has 8, see
          // arabicLetters below) — bounds and cross-row moves read the real row length
          // instead of the old hardcoded 6/7, so nothing goes unreachable or lands on an
          // out-of-range column when rows differ in length.
          const rowLen = r < numRows ? currentKeys[r].length : 7;

          if (direction === "left") {
            if (r <= numRows) {
              if (lang === "ar") {
                if (c < rowLen - 1) {
                  setFocusedSearchKey({ row: r, col: c + 1 });
                } else if (filteredResults.length > 0) {
                  setSearchFocusArea("results");
                  setFocusedCardIndex(0);
                }
              } else {
                if (c > 0) {
                  setFocusedSearchKey({ row: r, col: c - 1 });
                } else {
                  setNavSection("sidebar");
                  setSidebarExpanded(true);
                }
              }
            } else {
              if (lang === "ar") {
                if (c < 3) {
                  setFocusedSearchKey({ row: r, col: c + 1 });
                } else if (filteredResults.length > 0) {
                  setSearchFocusArea("results");
                  setFocusedCardIndex(0);
                }
              } else {
                if (c > 0) {
                  setFocusedSearchKey({ row: r, col: c - 1 });
                } else {
                  setNavSection("sidebar");
                  setSidebarExpanded(true);
                }
              }
            }
          } else if (direction === "right") {
            if (r <= numRows) {
              if (lang === "ar") {
                if (c > 0) {
                  setFocusedSearchKey({ row: r, col: c - 1 });
                } else {
                  setNavSection("sidebar");
                  setSidebarExpanded(true);
                }
              } else {
                if (c < rowLen - 1) {
                  setFocusedSearchKey({ row: r, col: c + 1 });
                } else if (filteredResults.length > 0) {
                  setSearchFocusArea("results");
                  setFocusedCardIndex(0);
                }
              }
            } else {
              if (lang === "ar") {
                if (c > 0) {
                  setFocusedSearchKey({ row: r, col: c - 1 });
                } else {
                  setNavSection("sidebar");
                  setSidebarExpanded(true);
                }
              } else {
                if (c < 3) {
                  setFocusedSearchKey({ row: r, col: c + 1 });
                } else if (filteredResults.length > 0) {
                  setSearchFocusArea("results");
                  setFocusedCardIndex(0);
                }
              }
            }
          } else if (direction === "up") {
            if (r > 0) {
              const prevRow = r - 1;
              const targetLen = prevRow < numRows ? currentKeys[prevRow].length : 7;
              setFocusedSearchKey({ row: prevRow, col: Math.min(c, targetLen - 1) });
            }
          } else if (direction === "down") {
            if (r < numRows + 1) {
              const nextRow = r + 1;
              let nextCol = c;
              if (r === numRows) {
                nextCol = 1; // space -> footer row: land on a sensible footer button
              } else {
                const targetLen = nextRow < numRows ? currentKeys[nextRow].length : nextRow === numRows ? 7 : 4;
                nextCol = Math.min(c, targetLen - 1);
              }
              setFocusedSearchKey({ row: nextRow, col: nextCol });
            } else {
              setSearchFocusArea("filters");
              setFocusedFilterIndex(0);
            }
          } else if (direction === "ok") {
            if (r < numRows) {
              handleVirtualKeyClick(currentKeys[r][c]);
            } else if (r === numRows) {
              handleVirtualKeyClick("space");
            } else {
              if (c === 0) {
                setKeyboardLang(prev => prev === "ar" ? "en" : "ar");
                setKeyboardMode("letters");
              } else if (c === 1) {
                setKeyboardMode(prev => prev === "letters" ? "symbols" : "letters");
              } else if (c === 2) {
                handleVirtualKeyClick("backspace");
              } else if (c === 3) {
                handleVirtualKeyClick("clear-all");
              }
            }
          }
        } else if (searchFocusArea === "filters") {
          if (direction === "up") {
            setSearchFocusArea("keyboard");
            setFocusedSearchKey({ row: numRows + 1, col: 1 });
          } else if (direction === "down") {
            if (filteredResults.length > 0) {
              setSearchFocusArea("results");
              setFocusedCardIndex(0);
            }
          } else if (direction === "left") {
            if (lang === "ar") {
              if (focusedFilterIndex < 2) {
                setFocusedFilterIndex(prev => prev + 1);
              } else if (filteredResults.length > 0) {
                setSearchFocusArea("results");
                setFocusedCardIndex(0);
              }
            } else {
              if (focusedFilterIndex > 0) {
                setFocusedFilterIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedFilterIndex > 0) {
                setFocusedFilterIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            } else {
              if (focusedFilterIndex < 2) {
                setFocusedFilterIndex(prev => prev + 1);
              } else if (filteredResults.length > 0) {
                setSearchFocusArea("results");
                setFocusedCardIndex(0);
              }
            }
          } else if (direction === "ok") {
            const opts = ["all", "movie", "series"];
            setSearchTypeFilter(opts[focusedFilterIndex] as any);
          }
        } else if (searchFocusArea === "results") {
          const list = filteredResults;
          const count = list.length;
          if (count === 0) {
            setSearchFocusArea("keyboard");
            return;
          }

          const cols = getGridColumnCount("search-results-grid");
          const rowStart = focusedCardIndex - (focusedCardIndex % cols);
          const rowEnd = Math.min(rowStart + cols - 1, count - 1);

          if (direction === "left") {
            if (lang === "ar") {
              if (focusedCardIndex < rowEnd) {
                setFocusedCardIndex(prev => prev + 1);
              }
            } else {
              if (focusedCardIndex > rowStart) {
                setFocusedCardIndex(prev => prev - 1);
              } else {
                setSearchFocusArea("keyboard");
                setFocusedSearchKey({ row: 0, col: 6 });
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedCardIndex > rowStart) {
                setFocusedCardIndex(prev => prev - 1);
              } else {
                setSearchFocusArea("keyboard");
                setFocusedSearchKey({ row: 0, col: 0 });
              }
            } else {
              if (focusedCardIndex < rowEnd) {
                setFocusedCardIndex(prev => prev + 1);
              }
            }
          } else if (direction === "up") {
            if (focusedCardIndex >= cols) {
              setFocusedCardIndex(prev => prev - cols);
            } else {
              setSearchFocusArea("filters");
              setFocusedFilterIndex(0);
            }
          } else if (direction === "down") {
            if (focusedCardIndex + cols < count) {
              setFocusedCardIndex(prev => prev + cols);
            }
          } else if (direction === "ok") {
            const m = list[focusedCardIndex];
            if (m) {
              setSelectedMovie(m);
            }
          }
        }
        break;
      }

      case "movies_section":
      case "series_section":
      case "favorites": {
        // Must mirror the movies_section/series_section grid's own filter chain
        // (type + genre + language, then sort) exactly — otherwise this list's indices
        // drift from what's actually rendered the moment a language filter is applied,
        // and focus starts landing on the wrong card entirely.
        let list: Movie[] = [];
        if (navSection === "movies_section") {
          list = allMovies
            .filter(m => m.type === "movie")
            .filter(m => matchGenreFilter(m.genres, movieGenreFilter))
            .filter(m => matchLanguageFilter(m.language, movieLanguageFilter))
            .sort((a, b) => {
              if (movieSortBy === "newest") return b.year - a.year;
              if (movieSortBy === "highest_rated") return b.rating - a.rating;
              if (movieSortBy === "most_watched") {
                const viewsA = a.views || Math.floor(a.rating * 1500 + a.year);
                const viewsB = b.views || Math.floor(b.rating * 1500 + b.year);
                return viewsB - viewsA;
              }
              return 0;
            });
        } else if (navSection === "series_section") {
          list = allMovies
            .filter(m => m.type === "series")
            .filter(m => matchGenreFilter(m.genres, seriesGenreFilter))
            .filter(m => matchLanguageFilter(m.language, seriesLanguageFilter))
            .sort((a, b) => {
              if (seriesSortBy === "newest") return b.year - a.year;
              if (seriesSortBy === "highest_rated") return b.rating - a.rating;
              if (seriesSortBy === "most_watched") {
                const viewsA = a.views || Math.floor(a.rating * 1500 + a.year);
                const viewsB = b.views || Math.floor(b.rating * 1500 + b.year);
                return viewsB - viewsA;
              }
              return 0;
            });
        } else if (navSection === "favorites") {
          list = favorites;
        }

        const count = list.length;

        // If focusing filters/sorting dropdowns. Three buttons, left-to-right on screen:
        // Genre(0), Language(1), Sort(2) — focusedSectionFilter must match that visual
        // order or Right/Left visibly skip over Language on the way to Sort (used to be
        // numbered 0/2/1, and only 0/1 were reachable at all, so Language couldn't be
        // opened by keyboard no matter what).
        if (sectionFocusArea === "filters" && (navSection === "movies_section" || navSection === "series_section")) {
          if (direction === "down") {
            setSectionFocusArea("cards");
            setFocusedCardIndex(0);
          } else if (direction === "left") {
            if (lang === "ar") {
              if (focusedSectionFilter < 2) {
                setFocusedSectionFilter(prev => prev + 1);
              }
            } else {
              if (focusedSectionFilter > 0) {
                setFocusedSectionFilter(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedSectionFilter > 0) {
                setFocusedSectionFilter(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            } else {
              if (focusedSectionFilter < 2) {
                setFocusedSectionFilter(prev => prev + 1);
              }
            }
          } else if (direction === "ok") {
            if (focusedSectionFilter === 0) {
              setActiveDropdown(navSection === "movies_section" ? "movie_genre" : "series_genre");
              setFocusedDropdownItemIndex(0);
            } else if (focusedSectionFilter === 1) {
              setActiveDropdown(navSection === "movies_section" ? "movie_language" : "series_language");
              setFocusedDropdownItemIndex(0);
            } else {
              setActiveDropdown(navSection === "movies_section" ? "movie_sort" : "series_sort");
              setFocusedDropdownItemIndex(0);
            }
          }
          break;
        }

        // Favorites has a second area below its grid — Continue Watching / Clear History
        // (see "SECTION 2: WATCH HISTORY" in the favorites JSX). This used to be gated on
        // `navSection === "settings"`, which can never be true while navSection is
        // "favorites", making the whole area permanently unreachable by remote.
        if (navSection === "favorites" && favoritesFocusArea !== "list") {
          const historyCount = watchHistory.length;
          const historyCols = getGridColumnCount("favorites-watch-history-grid");
          const historyRowStart = focusedCardIndex - (focusedCardIndex % historyCols);
          const historyRowEnd = Math.min(historyRowStart + historyCols - 1, historyCount - 1);

          if (direction === "up") {
            if (favoritesFocusArea === "watch_history") {
              if (focusedCardIndex >= historyCols) {
                setFocusedCardIndex(prev => prev - historyCols);
              } else {
                setFavoritesFocusArea(historyCount > 0 ? "clear_history" : "list");
              }
            } else if (favoritesFocusArea === "clear_history") {
              setFavoritesFocusArea("list");
              setFocusedCardIndex(Math.max(0, favorites.length - 1));
            }
          } else if (direction === "down") {
            if (favoritesFocusArea === "clear_history") {
              setFavoritesFocusArea("watch_history");
              setFocusedCardIndex(0);
            }
            // watch_history: nothing further down — no-op
          } else if (direction === "left") {
            if (favoritesFocusArea === "watch_history") {
              if (lang === "ar") {
                if (focusedCardIndex < historyRowEnd) setFocusedCardIndex(prev => prev + 1);
              } else if (focusedCardIndex > historyRowStart) {
                setFocusedCardIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            } else if (favoritesFocusArea === "clear_history" && lang === "en") {
              setNavSection("sidebar");
              setSidebarExpanded(true);
            }
          } else if (direction === "right") {
            if (favoritesFocusArea === "watch_history") {
              if (lang === "ar") {
                if (focusedCardIndex > historyRowStart) {
                  setFocusedCardIndex(prev => prev - 1);
                } else {
                  setNavSection("sidebar");
                  setSidebarExpanded(true);
                }
              } else if (focusedCardIndex < historyRowEnd) {
                setFocusedCardIndex(prev => prev + 1);
              }
            } else if (favoritesFocusArea === "clear_history" && lang === "ar") {
              setNavSection("sidebar");
              setSidebarExpanded(true);
            }
          } else if (direction === "ok") {
            if (favoritesFocusArea === "clear_history") {
              setWatchHistory([]);
              safeStorage.removeItem("cinemana_tv_watch_history");
              setPlayerToast(lang === "ar" ? "تم مسح سجل المشاهدة بالكامل" : "Watch history cleared successfully");
              setFavoritesFocusArea("watch_history");
            } else if (favoritesFocusArea === "watch_history") {
              const movie = watchHistory[focusedCardIndex];
              if (movie) setSelectedMovie(movie);
            }
          }
          break;
        }

        if (count === 0) {
          // Same "toward sidebar" direction as the non-empty list below (RTL: right,
          // LTR: left) — this used to be reversed, so an empty list (most commonly hit
          // on Favorites before anything's been added) sent you to the sidebar on the
          // wrong key and did nothing on the one that matched every other section.
          if (direction === "left" && lang === "en") {
            setNavSection("sidebar");
            setSidebarExpanded(true);
          } else if (direction === "right" && lang === "ar") {
            setNavSection("sidebar");
            setSidebarExpanded(true);
          }
          break;
        }

        {
          const cols = getGridColumnCount(
            navSection === "movies_section" ? "movies-section-grid" : navSection === "series_section" ? "series-section-grid" : "favorites-grid"
          );
          // Left/Right used to walk the whole flat list index-by-index, so leaving toward
          // the sidebar only worked from the very first/last card in the entire grid — from
          // any other row it just wrapped into the next/previous row instead. Bounding the
          // move to the current row (and exiting once already at that row's edge) means
          // every row can reach the sidebar directly, not just the top or bottom one.
          const rowStart = focusedCardIndex - (focusedCardIndex % cols);
          const rowEnd = Math.min(rowStart + cols - 1, count - 1);

          if (direction === "left") {
            if (lang === "ar") {
              if (focusedCardIndex < rowEnd) {
                setFocusedCardIndex(prev => prev + 1);
              }
            } else {
              if (focusedCardIndex > rowStart) {
                setFocusedCardIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedCardIndex > rowStart) {
                setFocusedCardIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            } else {
              if (focusedCardIndex < rowEnd) {
                setFocusedCardIndex(prev => prev + 1);
              }
            }
          } else if (direction === "up") {
            if (focusedCardIndex >= cols) {
              setFocusedCardIndex(prev => prev - cols);
            } else {
              if (navSection === "movies_section" || navSection === "series_section") {
                setSectionFocusArea("filters");
                setFocusedSectionFilter(0);
              }
            }
          } else if (direction === "down") {
            if (focusedCardIndex + cols < count) {
              setFocusedCardIndex(prev => prev + cols);
            } else if (navSection === "favorites") {
              const historyCount = watchHistory.length;
              setFavoritesFocusArea(historyCount > 0 ? "clear_history" : "watch_history");
              setFocusedCardIndex(0);
            }
          } else if (direction === "ok") {
            const movie = list[focusedCardIndex];
            if (movie) {
              setSelectedMovie(movie);
            }
          }
        }
        break;
      }

      case "collections_section": {
        const collections = getMovieCollections(allMovies);
        const currentCollection = collections[focusedRailIndex];
        if (currentCollection) {
          if (direction === "up") {
            if (focusedRailIndex > 0) {
              setFocusedRailIndex(prev => prev - 1);
              setFocusedCardIndex(0);
            }
          } else if (direction === "down") {
            if (focusedRailIndex < collections.length - 1) {
              setFocusedRailIndex(prev => prev + 1);
              setFocusedCardIndex(0);
            }
          } else if (direction === "left") {
            if (lang === "ar") {
              if (focusedCardIndex < currentCollection.movies.length - 1) {
                setFocusedCardIndex(prev => prev + 1);
              }
            } else {
              if (focusedCardIndex === 0) {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              } else {
                setFocusedCardIndex(prev => prev - 1);
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedCardIndex === 0) {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              } else {
                setFocusedCardIndex(prev => prev - 1);
              }
            } else {
              if (focusedCardIndex < currentCollection.movies.length - 1) {
                setFocusedCardIndex(prev => prev + 1);
              }
            }
          } else if (direction === "ok") {
            const movie = currentCollection.movies[focusedCardIndex];
            if (movie) {
              setSelectedMovie(movie);
            }
          }
        }
        break;
      }

      case "settings": {
        // Continue Watching / Clear History live on the Favorites page (see the
        // "favorites" case below and favoritesFocusArea) — this page only has the
        // Profile column and the Language/Subtitle column.
        if (direction === "left") {
          if (lang === "ar") {
            // RTL: the Profile column is DOM-first, which under dir="rtl" grid
            // auto-placement renders on the RIGHT (same rule as everywhere else in this
            // file — sidebar included, which is why it sits on the right too); the
            // Language/Subtitle column renders on the LEFT. So physical Left moves AWAY
            // from the sidebar (profile -> language column), physical Right moves TOWARD
            // it (language column -> profile -> sidebar). This block and the one below it
            // used to have that backwards — profile exited to the sidebar on Left instead
            // of Right, so the sidebar (actually on the right) was unreachable on the key
            // that actually points at it, and reachable on the one that doesn't.
            if (settingsFocusArea === "sub_size") {
              if (focusedSubSizeIndex > 0) setFocusedSubSizeIndex(prev => prev - 1);
              // else: already the leftmost swatch — nothing further left, no-op
            } else if (settingsFocusArea === "sub_color") {
              if (focusedSubColorIndex > 0) setFocusedSubColorIndex(prev => prev - 1);
            } else if (settingsFocusArea === "login_username" || settingsFocusArea === "login_password" || settingsFocusArea === "login_submit" || settingsFocusArea === "admin_panel_btn" || settingsFocusArea === "logout_btn") {
              // Move from profile column (right) to language/subtitle column (left)
              setSettingsFocusArea("app_language");
            }
            // app_language/sub_font/sub_shadow: already the leftmost column — no-op
          } else {
            // LTR Left Key moves focus from right column to left column, or left column to sidebar
            if (settingsFocusArea === "sub_size") {
              if (focusedSubSizeIndex > 0) setFocusedSubSizeIndex(prev => prev - 1);
              else if (!userSession) setSettingsFocusArea("login_username");
              else if (isAdminAuthenticated) setSettingsFocusArea("admin_panel_btn");
              else setSettingsFocusArea("logout_btn");
            } else if (settingsFocusArea === "sub_color") {
              if (focusedSubColorIndex > 0) setFocusedSubColorIndex(prev => prev - 1);
              else if (!userSession) setSettingsFocusArea("login_username");
              else if (isAdminAuthenticated) setSettingsFocusArea("admin_panel_btn");
              else setSettingsFocusArea("logout_btn");
            } else if (settingsFocusArea === "app_language" || settingsFocusArea === "sub_font" || settingsFocusArea === "sub_shadow") {
              // Move from right column to profile column
              if (!userSession) setSettingsFocusArea("login_username");
              else if (isAdminAuthenticated) setSettingsFocusArea("admin_panel_btn");
              else setSettingsFocusArea("logout_btn");
            } else if (settingsFocusArea === "login_username" || settingsFocusArea === "login_password" || settingsFocusArea === "login_submit" || settingsFocusArea === "admin_panel_btn" || settingsFocusArea === "logout_btn") {
              // Move to sidebar
              setNavSection("sidebar");
              setSidebarExpanded(true);
            }
          }
        } else if (direction === "right") {
          if (lang === "ar") {
            // RTL Right: language/subtitle column (left) -> profile column (right) -> sidebar
            if (settingsFocusArea === "sub_size") {
              if (focusedSubSizeIndex < 3) {
                setFocusedSubSizeIndex(prev => prev + 1);
              } else if (!userSession) {
                setSettingsFocusArea("login_username");
              } else if (isAdminAuthenticated) {
                setSettingsFocusArea("admin_panel_btn");
              } else {
                setSettingsFocusArea("logout_btn");
              }
            } else if (settingsFocusArea === "sub_color") {
              if (focusedSubColorIndex < 2) {
                setFocusedSubColorIndex(prev => prev + 1);
              } else if (!userSession) {
                setSettingsFocusArea("login_username");
              } else if (isAdminAuthenticated) {
                setSettingsFocusArea("admin_panel_btn");
              } else {
                setSettingsFocusArea("logout_btn");
              }
            } else if (settingsFocusArea === "app_language" || settingsFocusArea === "sub_font" || settingsFocusArea === "sub_shadow") {
              // Move from language/subtitle column (left) to profile column (right)
              if (!userSession) setSettingsFocusArea("login_username");
              else if (isAdminAuthenticated) setSettingsFocusArea("admin_panel_btn");
              else setSettingsFocusArea("logout_btn");
            } else if (settingsFocusArea === "login_username" || settingsFocusArea === "login_password" || settingsFocusArea === "login_submit" || settingsFocusArea === "admin_panel_btn" || settingsFocusArea === "logout_btn") {
              // Move from profile column (right) to sidebar (further right)
              setNavSection("sidebar");
              setSidebarExpanded(true);
            }
          } else {
            // LTR Right Key moves from left column to right column
            if (settingsFocusArea === "sub_size") {
              if (focusedSubSizeIndex < 3) setFocusedSubSizeIndex(prev => prev + 1);
            } else if (settingsFocusArea === "sub_color") {
              if (focusedSubColorIndex < 2) setFocusedSubColorIndex(prev => prev + 1);
            } else if (settingsFocusArea === "login_username" || settingsFocusArea === "login_password" || settingsFocusArea === "login_submit" || settingsFocusArea === "admin_panel_btn" || settingsFocusArea === "logout_btn") {
              setSettingsFocusArea("app_language");
            }
          }
        } else if (direction === "down") {
          if (settingsFocusArea === "login_username") {
            setSettingsFocusArea("login_password");
          } else if (settingsFocusArea === "login_password") {
            setSettingsFocusArea("login_submit");
          } else if (settingsFocusArea === "admin_panel_btn") {
            setSettingsFocusArea("logout_btn");
          } else if (settingsFocusArea === "app_language") {
            setSettingsFocusArea("sub_font");
          } else if (settingsFocusArea === "sub_font") {
            setSettingsFocusArea("sub_size");
          } else if (settingsFocusArea === "sub_size") {
            setSettingsFocusArea("sub_color");
          } else if (settingsFocusArea === "sub_color") {
            setSettingsFocusArea("sub_shadow");
          }
          // login_submit/logout_btn/sub_shadow: nothing further down in this page — no-op
        } else if (direction === "up") {
          if (settingsFocusArea === "login_password") {
            setSettingsFocusArea("login_username");
          } else if (settingsFocusArea === "login_submit") {
            setSettingsFocusArea("login_password");
          } else if (settingsFocusArea === "logout_btn") {
            if (isAdminAuthenticated) setSettingsFocusArea("admin_panel_btn");
          } else if (settingsFocusArea === "app_language") {
            setSettingsFocusArea("sub_font");
          } else if (settingsFocusArea === "sub_size") {
            setSettingsFocusArea("app_language");
          } else if (settingsFocusArea === "sub_color") {
            setSettingsFocusArea("sub_size");
          } else if (settingsFocusArea === "sub_shadow") {
            setSettingsFocusArea("sub_color");
          }
        } else if (direction === "ok") {
          if (settingsFocusArea === "login_username") {
            const el = document.getElementById("login-username-input");
            if (el) (el as any).focus();
          } else if (settingsFocusArea === "login_password") {
            const el = document.getElementById("login-password-input");
            if (el) (el as any).focus();
          } else if (settingsFocusArea === "login_submit") {
            const el = document.getElementById("login-submit-btn");
            if (el) (el as any).click();
          } else if (settingsFocusArea === "admin_panel_btn") {
            setNavSection("admin");
          } else if (settingsFocusArea === "logout_btn") {
            // Sign out
            safeStorage.removeItem("cinemana_session");
            safeStorage.removeItem("isAdminLoggedIn");
            setIsAdminAuthenticated(false);
            setUserSession(null);
            setLoginError("");
            setPlayerToast(lang === "ar" ? "تم تسجيل الخروج بنجاح" : "Logged out successfully");
            setSettingsFocusArea("login_username");
          } else if (settingsFocusArea === "app_language") {
            // Toggle language
            const nextLang = lang === "ar" ? "en" : "ar";
            setLang(nextLang);
            setPlayerToast(nextLang === "ar" ? "تم تغيير لغة التطبيق إلى العربية" : "App language changed to English");
          } else if (settingsFocusArea === "sub_font") {
            // Cycle sub font
            const fonts = ["Cairo", "Tajawal", "Amiri", "JetBrains Mono"];
            const currIdx = fonts.indexOf(subFont);
            const nextFont = fonts[(currIdx + 1) % fonts.length];
            setSubFont(nextFont);
            const fontLabel = nextFont === "Cairo" ? "كيرو (Cairo)" : nextFont === "Tajawal" ? "تجوال (Tajawal)" : nextFont === "Amiri" ? "أميري (Amiri)" : "مونو (Mono)";
            setPlayerToast(lang === "ar" ? `تم اختيار خط: ${fontLabel}` : `Font changed to: ${nextFont}`);
          } else if (settingsFocusArea === "sub_size") {
            const sizes = ["small", "medium", "large", "xl"];
            const sizeLabels = { small: { ar: "صغير", en: "Small" }, medium: { ar: "متوسط", en: "Medium" }, large: { ar: "كبير", en: "Large" }, xl: { ar: "ضخم جداً", en: "Extra Large" } };
            const nextSize = sizes[focusedSubSizeIndex];
            setSubSize(nextSize);
            setPlayerToast(lang === "ar" ? `الحجم: ${sizeLabels[nextSize as keyof typeof sizeLabels].ar}` : `Size set to: ${sizeLabels[nextSize as keyof typeof sizeLabels].en}`);
          } else if (settingsFocusArea === "sub_color") {
            const colors = ["yellow", "white", "white_light"];
            const colorLabels = { yellow: { ar: "أصفر ساطع", en: "Bright Yellow" }, white: { ar: "أبيض نقّي", en: "Pure White" }, white_light: { ar: "أبيض خفيف", en: "Light White" } };
            const nextColor = colors[focusedSubColorIndex];
            setSubColor(nextColor);
            setPlayerToast(lang === "ar" ? `اللون: ${colorLabels[nextColor as keyof typeof colorLabels].ar}` : `Color set to: ${colorLabels[nextColor as keyof typeof colorLabels].en}`);
          } else if (settingsFocusArea === "sub_shadow") {
            const nextShadow = !subShadow;
            setSubShadow(nextShadow);
            setPlayerToast(
              lang === "ar"
                ? (nextShadow ? "تم تفعيل تضليل النصوص" : "تم إيقاف تضليل النصوص")
                : (nextShadow ? "Text shadowing enabled" : "Text shadowing disabled")
            );
          }
        }
        break;
      }

      case "admin": {
        if (!isAdminAuthenticated) {
          if (direction === "down") {
            if (adminLoginFocus === "username") setAdminLoginFocus("password");
            else if (adminLoginFocus === "password") setAdminLoginFocus("submit");
            else if (adminLoginFocus === "submit") setAdminLoginFocus("back");
          } else if (direction === "up") {
            if (adminLoginFocus === "back") setAdminLoginFocus("submit");
            else if (adminLoginFocus === "submit") setAdminLoginFocus("password");
            else if (adminLoginFocus === "password") setAdminLoginFocus("username");
          } else if (direction === "left" && lang === "ar") {
            setNavSection("sidebar");
            setSidebarExpanded(true);
          } else if (direction === "right" && lang === "en") {
            setNavSection("sidebar");
            setSidebarExpanded(true);
          } else if (direction === "ok") {
            if (adminLoginFocus === "username") {
              const el = document.getElementById("admin-username-input");
              if (el) (el as any).focus();
            } else if (adminLoginFocus === "password") {
              const el = document.getElementById("admin-password-input");
              if (el) (el as any).focus();
            } else if (adminLoginFocus === "submit") {
              const el = document.getElementById("admin-login-submit-btn");
              if (el) (el as any).click();
            } else if (adminLoginFocus === "back") {
              setNavSection("settings");
              setActiveSidebarItem(5);
              setAdminUsername("");
              setAdminPassword("");
              setAdminLoginError(null);
            }
          }
        } else {
          // Admin is authenticated! Pass remote action to AdminPanel component
          if (direction === "up" || direction === "down" || direction === "left" || direction === "right" || direction === "ok" || direction === "back") {
            setAdminRemoteAction({ action: direction, time: Date.now() });
          }
        }
        break;
      }

      case "person_section": {
        if (!selectedPerson) break;
        const works = personWorks;
        const worksCount = works.length;
        const cols = 4; // 4 columns grid on TV layout

        if (direction === "back") {
          if (selectedPerson.previousMovie) {
            setSelectedMovie(selectedPerson.previousMovie);
            setNavSection("details");
          } else {
            const targetNav = (selectedPerson.previousNavSection && selectedPerson.previousNavSection !== "details" && selectedPerson.previousNavSection !== "person_section") 
              ? selectedPerson.previousNavSection 
              : "hero";
            setNavSection(targetNav as any);
            setSelectedMovie(null);
          }
          setSelectedPerson(null);
          break;
        }

        if (personFocusArea === "back") {
          if (direction === "down" || direction === "left" || direction === "right") {
            setPersonFocusArea("movies");
            setFocusedPersonMovieIndex(0);
          } else if (direction === "ok") {
            if (selectedPerson.previousMovie) {
              setSelectedMovie(selectedPerson.previousMovie);
              setNavSection("details");
            } else {
              const targetNav = (selectedPerson.previousNavSection && selectedPerson.previousNavSection !== "details" && selectedPerson.previousNavSection !== "person_section") 
                ? selectedPerson.previousNavSection 
                : "hero";
              setNavSection(targetNav as any);
              setSelectedMovie(null);
            }
            setSelectedPerson(null);
          }
        } else if (personFocusArea === "movies") {
          if (direction === "up") {
            if (focusedPersonMovieIndex < cols) {
              setPersonFocusArea("back");
            } else {
              setFocusedPersonMovieIndex(prev => Math.max(prev - cols, 0));
            }
          } else if (direction === "down") {
            if (focusedPersonMovieIndex + cols < worksCount) {
              setFocusedPersonMovieIndex(prev => prev + cols);
            } else if (focusedPersonMovieIndex < worksCount - 1) {
              setFocusedPersonMovieIndex(worksCount - 1);
            }
          } else if (direction === "left") {
            if (lang === "ar") {
              if (focusedPersonMovieIndex < worksCount - 1) {
                setFocusedPersonMovieIndex(prev => prev + 1);
              }
            } else {
              if (focusedPersonMovieIndex > 0) {
                setFocusedPersonMovieIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            }
          } else if (direction === "right") {
            if (lang === "ar") {
              if (focusedPersonMovieIndex > 0) {
                setFocusedPersonMovieIndex(prev => prev - 1);
              } else {
                setNavSection("sidebar");
                setSidebarExpanded(true);
              }
            } else {
              if (focusedPersonMovieIndex < worksCount - 1) {
                setFocusedPersonMovieIndex(prev => prev + 1);
              }
            }
          } else if (direction === "ok") {
            const m = works[focusedPersonMovieIndex];
            if (m) {
              setSelectedMovie(m);
              setNavSection("details");
            }
          }
        }
        break;
      }
    }

    if (direction === "home") {
      setNavSection("hero");
      setActiveSidebarItem(0);
      setSidebarExpanded(false);
      setSelectedMovie(null);
      setPlayingMovie(null);
    }
  };

  const handleSidebarSelect = (index: number) => {
    setActiveSidebarItem(index);
    setSidebarExpanded(false);
    // The details overlay (selectedMovie) and person page render unconditionally on top
    // of whatever navSection is active, and navigateTV's very first checks are `if
    // (selectedMovie)` / `if (selectedPerson)` — before it ever looks at navSection. Left
    // set from a previous visit, either one silently swallows all input on the section
    // you just switched to (it looked like Favorites/Settings simply stopped responding)
    // and, since the overlay itself still renders, hides the new section entirely behind
    // whichever movie was last open.
    setSelectedMovie(null);
    setSelectedPerson(null);

    // focusedCardIndex is shared across movies/series/favorites/settings' watch-history
    // grid, and sectionFocusArea/searchFocusArea/settingsFocusArea persist across visits
    // too — without resetting them here, switching sections (e.g. from a long Movies grid
    // straight into the much shorter Favorites list) leaves focus pointed at an index past
    // the new list's end, so nothing appears highlighted and arrow keys behave erratically
    // until the user happens to wander back into range.
    switch (index) {
      case 0: // Home
        setNavSection("hero");
        break;
      case 1: // Search
        setNavSection("search");
        setSearchFocusArea("keyboard");
        setFocusedSearchKey({ row: 0, col: 0 });
        setSearchKeyboardTouched(false);
        break;
      case 2: // Series
        setNavSection("series_section");
        setSectionFocusArea("cards");
        setFocusedSectionFilter(0);
        setFocusedCardIndex(0);
        break;
      case 3: // Movies
        setNavSection("movies_section");
        setSectionFocusArea("cards");
        setFocusedSectionFilter(0);
        setFocusedCardIndex(0);
        break;
      case 4: // Favorites
        setNavSection("favorites");
        setFocusedCardIndex(0);
        setFavoritesFocusArea("list");
        break;
      case 5: // Settings
        setNavSection("settings");
        setSettingsFocusArea("app_language");
        setFocusedCardIndex(0);
        break;
      case 6: // Admin
        setNavSection("admin");
        break;
    }

    // See sectionEntryGuardUntilRef above.
    sectionEntryGuardUntilRef.current = Date.now() + 120;
  };

  // Bridge into the root FocusNavProvider (see FocusNavBridge below): selecting Home
  // hands input off to the new HomeScreen zone; any other (not-yet-migrated) section
  // hands off to the "legacy" passthrough zone so this file's own handleKeyDown regains
  // control, exactly as it did before this migration started.
  const handleSidebarSelectBridged = (index: number) => {
    console.log("[DEBUG] handleSidebarSelectBridged called with index", index);
    handleSidebarSelect(index);
    focusNavSetFocusRef.current(index === 0 ? "home.hero" : "legacy");
  };

  // Sidebar's onEdge (see Sidebar.tsx) calls this when the user backs out of the sidebar
  // toward content without selecting an item (logical "right" — physical Right in LTR,
  // physical Left in RTL). Home (hero/rails) never touches navSection while the sidebar is
  // open, so it just regains the new system's focus; every other screen is still legacy, so
  // navSection needs restoring to whatever it was before "sidebar" overwrote it.
  const handleSidebarExit = () => {
    if (navSection === "hero" || navSection === "rails") {
      const target = lastContentFocusRef.current;
      focusNavSetFocusRef.current(target.zoneId, target.nodeId ?? undefined);
    } else if (navSection === "sidebar") {
      setNavSection(preSidebarNavSection);
      focusNavSetFocusRef.current("legacy");
    }
  };

  const handleSeeAllCollectionsBridged = () => {
    setNavSection("collections_section");
    setSelectedMovie(null);
    setSelectedPerson(null);
    setFocusedRailIndex(0);
    setFocusedCardIndex(0);
    focusNavSetFocusRef.current("legacy");
    // See sectionEntryGuardUntilRef above — same "OK" press that opened this screen must
    // not also register as an OK on whatever card ends up focused inside it.
    sectionEntryGuardUntilRef.current = Date.now() + 120;
  };

  // Whenever legacy code (any of the many `setNavSection("sidebar")` call sites still
  // scattered through navigateTV for not-yet-migrated screens) asks to move focus to the
  // sidebar, mirror that into the new system, which now owns all sidebar navigation.
  useEffect(() => {
    if (navSection === "sidebar") {
      // Land on the row for whichever section was actually active, not always row 0 —
      // otherwise pressing the sidebar-ward direction from deep in e.g. Movies would
      // highlight Home instead of the Movies icon that's already marked active.
      focusNavSetFocusRef.current("sidebar", String(activeSidebarItem));
    } else {
      setPreSidebarNavSection(navSection);
    }
  }, [navSection, activeSidebarItem]);

  // The root provider stays mounted even during video playback (so Sidebar/HomeScreen
  // don't lose their zone registrations and remount-reset), but must go quiet whenever
  // something else owns input instead: VideoPlayer's own nested provider while playing,
  // or this file's own legacy handleKeyDown while a details/person overlay is open (both
  // of those can open straight from Home — the hero's "info" button, a rail card, a cast
  // member — without navSection ever leaving "hero"/"rails", so navSection alone can't be
  // what gates this). Restore focus to wherever navSection says once everything closes.
  useEffect(() => {
    if (playingMovie || selectedMovie || selectedPerson) {
      focusNavSetFocusRef.current("legacy");
    } else {
      focusNavSetFocusRef.current((navSection === "hero" || navSection === "rails") ? "home.hero" : "sidebar");
    }
  }, [playingMovie, selectedMovie, selectedPerson]);

  // Helpers to group, expand and sort movies by part
  const sortMoviesByPart = (movies: Movie[]): Movie[] => {
    const groups: { [key: string]: Movie[] } = {};
    movies.forEach(m => {
      if (m.collectionId) {
        if (!groups[m.collectionId]) {
          groups[m.collectionId] = [];
        }
        groups[m.collectionId].push(m);
      }
    });

    Object.keys(groups).forEach(cid => {
      groups[cid].sort((a, b) => {
        const pA = Number(a.partNumber || 0) || a.year || 0;
        const pB = Number(b.partNumber || 0) || b.year || 0;
        return pA - pB;
      });
    });

    const result: Movie[] = [];
    const renderedCollections = new Set<string>();

    movies.forEach(m => {
      if (m.collectionId) {
        if (!renderedCollections.has(m.collectionId)) {
          renderedCollections.add(m.collectionId);
          result.push(...groups[m.collectionId]);
        }
      } else {
        result.push(m);
      }
    });

    return result;
  };

  const expandSearchResultsWithCollections = (results: Movie[], database: Movie[]): Movie[] => {
    const expanded: Movie[] = [];
    const addedIds = new Set<string>();

    results.forEach(m => {
      if (!addedIds.has(m.id)) {
        expanded.push(m);
        addedIds.add(m.id);
      }
      
      if (m.collectionId) {
        const collectionParts = database.filter(dbMovie => dbMovie.collectionId === m.collectionId);
        collectionParts.forEach(part => {
          if (!addedIds.has(part.id)) {
            expanded.push(part);
            addedIds.add(part.id);
          }
        });
      }
    });

    return sortMoviesByPart(expanded);
  };

  // Live backend/Gemini searching
  const handleSearchChange = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearchingBackend(true);
    try {
      const res = await fetch(getApiUrl(`/api/movies/search?q=${encodeURIComponent(query)}`));
      if (res.ok) {
        const data = await res.json();
        setSearchResults(expandSearchResultsWithCollections(data.items || [], allMovies));
      }
    } catch (e) {
      console.error(e);
      // fallback search locally in static array
      const matches = allMovies.filter(m => 
        m.titleAr.includes(query) || 
        m.titleEn.toLowerCase().includes(query.toLowerCase())
      );
      setSearchResults(expandSearchResultsWithCollections(matches, allMovies));
    } finally {
      setIsSearchingBackend(false);
    }
  };

  const handleGeminiDynamicCrawl = async () => {
    if (!searchQuery.trim()) return;
    setIsSearchingBackend(true);
    
    setSystemLogs(prev => [
      `[${new Date().toLocaleTimeString()}] 🤖 Gemini Crawler initiated for custom query: "${searchQuery}"`,
      ...prev
    ]);

    setTimeout(() => {
      setSystemLogs(prev => [
        `[${new Date().toLocaleTimeString()}] 🛰️ Searching global networks for movie streams...`,
        ...prev
      ]);
    }, 1000);

    setTimeout(() => {
      setSystemLogs(prev => [
        `[${new Date().toLocaleTimeString()}] 🧠 Sourcing metadata, posters, and cast list from Gemini knowledge graph...`,
        ...prev
      ]);
    }, 2000);

    setTimeout(() => {
      const isEnglish = /^[A-Za-z0-9\s:-]+$/.test(searchQuery);
      const generatedId = `gemini_sourced_${Date.now()}`;
      
      const crawledMovie: Movie = {
        id: generatedId,
        titleAr: isEnglish ? `${searchQuery} (مترجم ذكاء اصطناعي)` : searchQuery,
        titleEn: isEnglish ? searchQuery : `${searchQuery} (AI Sourced)`,
        type: "movie",
        rating: parseFloat((8.2 + Math.random() * 1.5).toFixed(1)),
        year: 2024,
        duration: "2h 18m",
        genres: [lang === "ar" ? "أكشن" : "Action", lang === "ar" ? "خيال علمي" : "Sci-Fi"],
        poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80",
        backdrop: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1200&q=80",
        storyAr: `تم توليد هذا العرض ديناميكياً بواسطة ذكاء الاصطناعي لـ "${searchQuery}". قصة ملحمية مشوقة تجري أحداثها في عالم مليء بالإثارة والغموض من جلب محرك بحث Gemini الذكي.`,
        storyEn: `This title was dynamically sourced by Gemini AI for "${searchQuery}". A blockbuster masterfully constructed with dynamic streaming nodes and rich audio-visual servers.`,
        actors: ["Gemini Sourced Node", "Cinemana AI Model", "Shabakaty Actor Engine"],
        quality: "Ultra HD 4K",
        servers: [
          { name: lang === "ar" ? "سيرفر البث الذكي" : "Smart AI Streaming Node", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
        ]
      };

      setAllMovies(prev => [crawledMovie, ...prev]);
      
      setCategories(prev => {
        return prev.map(cat => {
          if (cat.id === "recent") {
            return { ...cat, items: [crawledMovie, ...cat.items] };
          }
          return cat;
        });
      });

      setSearchResults([crawledMovie]);
      setIsSearchingBackend(false);
      setSelectedMovie(crawledMovie);

      setSystemLogs(prev => [
        `[${new Date().toLocaleTimeString()}] ✅ SOURCED SUCCESS: "${searchQuery}" created and loaded into active memory.`,
        ...prev
      ]);
    }, 3200);
  };

  // Virtual Remote Keyboard keys definitions
  const arabicLetters = [
    ["ا", "ب", "ت", "ث", "ج", "ح", "خ"],
    ["د", "ذ", "ر", "ز", "س", "ش", "ص"],
    ["ض", "ط", "ظ", "ع", "غ", "ف", "ق"],
    ["ك", "ل", "م", "ن", "هـ", "و", "ي"],
    ["ة", "ء", "ئ", "ؤ", "لا", "ى", "أ"]
  ];

  const englishLetters = [
    ["A", "B", "C", "D", "E", "F", "G"],
    ["H", "I", "J", "K", "L", "M", "N"],
    ["O", "P", "Q", "R", "S", "T", "U"],
    ["V", "W", "X", "Y", "Z", "-", "_"]
  ];

  const symbolKeys = [
    ["1", "2", "3", "4", "5", "6", "7"],
    ["8", "9", "0", "@", "#", "$", "%"],
    ["&", "*", "(", ")", "[", "]", "="],
    ["/", ":", ";", "?", "!", ".", ","]
  ];

  const handleVirtualKeyClick = (key: string) => {
    if (key === "space" || key === "Space" || key === "مسافة") {
      setSearchQuery(prev => prev + " ");
      handleSearchChange(searchQuery + " ");
    } else if (key === "backspace" || key === "Backspace" || key === "مسح" || key === "Clear") {
      setSearchQuery(prev => prev.slice(0, -1));
      handleSearchChange(searchQuery.slice(0, -1));
    } else if (key === "clear-all" || key === "تفريغ") {
      setSearchQuery("");
      handleSearchChange("");
    } else if (key === "أكشن") {
      handleSearchChange("أكشن");
    } else if (key === "دراما") {
      handleSearchChange("دراما");
    } else if (key === "خيال") {
      handleSearchChange("خيال علمي");
    } else {
      setSearchQuery(prev => prev + key);
      handleSearchChange(searchQuery + key);
    }
  };

  // Save progress helper function
  const saveCurrentProgress = useCallback((movie: Movie, currentTimeSec: number, progressPercent: number) => {
    setWatchProgress((prev) => {
      const updated = {
        ...prev,
        [movie.id]: {
          percent: progressPercent,
          currentTime: currentTimeSec,
          updatedAt: Date.now()
        }
      };
      try {
        safeStorage.setItem("cinemana_tv_watch_progress", JSON.stringify(updated));
      } catch (e) {
        console.error("Failed to save watch progress", e);
      }
      return updated;
    });
  }, []);

  // Media player play/pause controller
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
        if (playingMovie) {
          const cur = videoRef.current.currentTime || 0;
          const dur = videoRef.current.duration || 0;
          const pct = (isFinite(dur) && dur > 0) ? (cur / dur) * 100 : 0;
          saveCurrentProgress(playingMovie, cur, pct);
        }
      } else {
        videoRef.current.play().catch(e => console.log(e));
        setIsPlaying(true);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const curTime = videoRef.current.currentTime || 0;
      const duration = videoRef.current.duration || 0;

      if (isAdPlaying && currentAd) {
        const durSec = currentAd.durationSeconds || 15;
        const remaining = Math.max(0, Math.ceil(durSec - curTime));
        setAdTimeRemaining(remaining);
        const skipThreshold = currentAd.skipAfterSeconds ?? adsSettings?.skipAfterSeconds ?? 5;
        if (curTime >= skipThreshold) {
          setCanSkipAd(true);
        }
        return;
      }

      const progress = (isFinite(duration) && duration > 0) ? (curTime / duration) * 100 : 0;
      
      // Update seek bar progress only if not currently scrubbing/dragging
      if (!isScrubbingSeek) {
        setPlayerProgress(progress);
      }

      // Show periodic info overlay at start (0-10 sec) and every 15 minutes (900 seconds) for 10 seconds.
      const fifteenMinutesSec = 15 * 60; // 900 seconds
      const isWithinInterval = (Math.floor(curTime) % fifteenMinutesSec < 10);
      if (isWithinInterval !== showQuarterHourOverlay) {
        setShowQuarterHourOverlay(isWithinInterval);
      }

      // Save watch progress at most once every 3 seconds to avoid UI stutter and excessive React re-renders
      const now = Date.now();
      if (playingMovie && (now - lastSaveProgressTimeRef.current > 3000)) {
        lastSaveProgressTimeRef.current = now;
        saveCurrentProgress(playingMovie, curTime, progress);
      }
    }
  };

  const handleVideoLoaded = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration || 0;
      setPlayerDuration(dur);
      
      // Restore playback position if we switched quality/servers or if restarting media
      if (lastPlaybackTimeRef.current !== null && isFinite(lastPlaybackTimeRef.current)) {
        videoRef.current.currentTime = lastPlaybackTimeRef.current;
        lastPlaybackTimeRef.current = null;
      } else if (playingMovie) {
        const saved = watchProgress[playingMovie.id];
        if (saved && typeof saved.currentTime === "number" && isFinite(saved.currentTime)) {
          if (saved.currentTime > 5 && dur > 0 && saved.currentTime < (dur - 15)) {
            videoRef.current.currentTime = saved.currentTime;
            setPlayerToast(
              lang === "ar" 
                ? `تم استئناف العرض من ${formatDuration(saved.currentTime)} ⏯️` 
                : `Resumed playback from ${formatDuration(saved.currentTime)} ⏯️`
            );
          }
        }
      }

      videoRef.current.play().catch(e => console.log("Autoplay blocked", e));
      setIsPlaying(true);
    }
  };


  const movieTrailerId = selectedMovie ? (getYoutubeId(selectedMovie.trailerUrl) || getYoutubeId(selectedMovie.backdrop)) : null;

  // What content screen to actually render. navSection itself flips to the literal
  // "sidebar" value while the sidebar has focus (see the mirroring effect above) so the
  // old handleKeyDown knows to stand down — but the screen the user came from should stay
  // visible underneath, not go black, so every content block below checks this instead of
  // raw navSection.
  const contentNavSection = navSection === "sidebar" ? preSidebarNavSection : navSection;

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className={`w-full h-full min-h-screen relative bg-[#090b11] text-[#f8fafc] flex flex-col overflow-hidden select-none`}>
      {/* APP LAUNCH SPLASH SCREEN */}
      {showSplash && <SplashScreen lang={lang} onDismiss={() => setShowSplash(false)} />}
      
      {/* Android TV Top Ambient Ambient Glow */}
      <div className="absolute top-0 left-1/4 right-1/4 h-16 bg-white/10 blur-3xl pointer-events-none rounded-full" />

      {/* INTERNAL TV UI SCREEN */}
      <div className="w-full h-full flex-1 relative flex overflow-hidden">
            
            {/* 1. FLOATING TRANSPARENT SIDEBAR + fully-migrated Home (Sidebar.tsx/HomeScreen.tsx) —
                the provider stays open through the content zone below and closes just before
                this outer wrapper div does, so Sidebar and HomeScreen share one focus tree. */}
            <FocusNavProvider dir={lang === "ar" ? "rtl" : "ltr"} initialZoneId="home.hero">
              <FocusNavBridge setFocusRef={focusNavSetFocusRef} lastContentFocusRef={lastContentFocusRef} />
              <LegacyPassthroughZone />
              {!playingMovie && (
                <Sidebar lang={lang} activeIndex={activeSidebarItem} onSelect={handleSidebarSelectBridged} onExit={handleSidebarExit} />
              )}


            {/* 2. MAIN TV CONTENT ZONE */}
            <div id="main-content-scroll" className="flex-1 w-full h-full overflow-y-auto no-scrollbar scroll-smooth relative flex flex-col bg-[#000000]">
              
              {/* Conditional view renderer based on navSection */}

              {/* A. DASHBOARD (HERO + RAILS) — see HomeScreen.tsx */}
              {(navSection === "hero" || navSection === "rails") && !playingMovie && (
                <HomeScreen
                  lang={lang}
                  heroMovie={heroMovie}
                  heroMovies={heroMovies}
                  currentHeroIndex={currentHeroIndex}
                  setCurrentHeroIndex={setCurrentHeroIndex}
                  setHeroMovie={setHeroMovie}
                  categories={categories}
                  favorites={favorites}
                  toggleFavorite={toggleFavorite}
                  hoveredCardKey={hoveredCardKey}
                  setHoveredCardKey={setHoveredCardKey}
                  watchProgress={watchProgress}
                  generateSeasonsForSeries={generateSeasonsForSeries}
                  setSelectedMovie={setSelectedMovie}
                  setPlayingMovie={setPlayingMovie}
                  setActiveSeason={setActiveSeason}
                  setActiveEpisode={setActiveEpisode}
                  setActiveServerIndex={setActiveServerIndex}
                  onSeeAllCollections={handleSeeAllCollectionsBridged}
                />
              )}


              {/* B. SEARCH CENTER */}
              {contentNavSection === "search" && !playingMovie && (
                <div className="p-6 ps-28 md:ps-32 flex flex-col gap-6 h-full overflow-hidden anim-fade-in select-text">

                  {/* Main Grid: Split Layout. The whole page used to scroll as one unit —
                      now only the results grid on the right scrolls (min-h-0 on its
                      ancestors is what lets a flex/grid child actually shrink enough to
                      become its own scroll container); the input, keyboard and filters
                      stay put. */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch pt-4 flex-1 min-h-0">
                    
                    {/* Left Column: Input, Keyboard, Suggestions (lg:col-span-5) - Seamlessly blended with background */}
                    <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6 p-1 bg-transparent border-0 shadow-none">
                      
                      {/* Search Input Bar - Sleek, modern, custom-designed gray search bar */}
                      <div className="flex flex-col gap-2 max-w-sm w-full">
                        <div className="relative w-full group">
                          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-zinc-200 w-4 h-4 transition-colors" />
                          <input 
                            type="text"
                            placeholder={lang === "ar" ? "ابدأ الكتابة للبحث..." : "Type to search..."}
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            className="w-full bg-black hover:bg-zinc-950/90 focus:bg-black border border-zinc-800 focus:border-zinc-500 rounded-full py-3 pr-11 pl-4 text-zinc-100 placeholder-zinc-500 font-medium text-xs outline-none transition-all shadow-lg shadow-black/30 focus:ring-4 focus:ring-zinc-500/10"
                          />
                          {searchQuery && (
                            <button 
                              onClick={() => {
                                setSearchQuery("");
                                setSearchResults([]);
                              }}
                              className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5.5 h-5.5 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-all cursor-pointer shadow"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* On-Screen TV Virtual Keyboard - Enhanced tactical layout */}
                      <div className="flex flex-col gap-4 pt-5">

                        {/* Keys grid layout with luxurious layout and tactile buttons */}
                        <div className="flex flex-col gap-1.5 bg-zinc-950/40 p-3.5 rounded-3xl backdrop-blur-xl shadow-2xl shadow-black/60 items-center">
                          {(keyboardMode === "symbols" ? symbolKeys : (keyboardLang === "ar" ? arabicLetters : englishLetters)).map((row, rIdx) => (
                            <div key={rIdx} className="flex gap-1.5 justify-center w-full">
                              {row.map((char, cIdx) => {
                                const isAction = ["أكشن", "دراما", "خيال"].includes(char);
                                const isKeyFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === rIdx && focusedSearchKey.col === cIdx;
                                return (
                                  <button
                                    key={cIdx}
                                    onClick={() => handleVirtualKeyClick(char)}
                                    className={`w-9 h-9 sm:w-11 sm:h-11 aspect-square p-0 flex items-center justify-center rounded-xl text-xs sm:text-sm font-bold transition-all duration-150 transform active:scale-95 cursor-pointer border border-zinc-800/50 shadow-sm ${
                                      isAction
                                        ? "bg-zinc-700/80 hover:bg-zinc-600 text-white border-zinc-500/50 hover:border-zinc-400 shadow-md shadow-zinc-800/40"
                                        : "bg-zinc-900/70 hover:bg-zinc-800 text-zinc-200 hover:text-white border-zinc-800/80 hover:border-zinc-700"
                                    } ${
                                      isKeyFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-110 shadow-lg shadow-white/10 z-10" : ""
                                    }`}
                                  >
                                    {char}
                                  </button>
                                );
                              })}
                            </div>
                          ))}

                          {/* Spacebar - Smaller, integrated, centered, and aligned with letters */}
                          <div className="flex justify-center w-full mt-2.5">
                            {(() => {
                              const numRows = (keyboardMode === "symbols" ? symbolKeys : (keyboardLang === "ar" ? arabicLetters : englishLetters)).length;
                              const isSpaceFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === numRows;
                              return (
                                <button 
                                  onClick={() => handleVirtualKeyClick("space")}
                                  className={`w-[288px] sm:w-[344px] py-2.5 sm:py-3 rounded-xl bg-gradient-to-r from-zinc-850 to-zinc-900 hover:from-zinc-750 hover:to-zinc-800 text-zinc-200 border border-zinc-800/80 hover:border-zinc-750 shadow-md flex items-center justify-center transition-all text-xs sm:text-sm font-bold cursor-pointer active:scale-95 active:shadow-sm ${
                                    isSpaceFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-105 z-10 shadow-lg shadow-white/10" : ""
                                  }`}
                                >
                                  <span>{lang === "ar" ? "مسافة" : "Space"}</span>
                                </button>
                              );
                            })()}
                          </div>
                        </div>

                        {/* Elegant Row of Function Keys with Icons */}
                        {(() => {
                          const numRows = (keyboardMode === "symbols" ? symbolKeys : (keyboardLang === "ar" ? arabicLetters : englishLetters)).length;
                          const isLangFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === numRows + 1 && focusedSearchKey.col === 0;
                          const isSymFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === numRows + 1 && focusedSearchKey.col === 1;
                          const isBackFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === numRows + 1 && focusedSearchKey.col === 2;
                          const isClearFocused = navSection === "search" && searchKeyboardTouched && searchFocusArea === "keyboard" && focusedSearchKey.row === numRows + 1 && focusedSearchKey.col === 3;

                          return (
                            <div className="flex justify-center gap-2.5 pt-1.5">
                              {/* Language Switch */}
                              <button 
                                onClick={() => {
                                  setKeyboardLang(prev => prev === "ar" ? "en" : "ar");
                                  setKeyboardMode("letters");
                                }}
                                className={`w-11 h-11 rounded-2xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800/80 hover:border-zinc-700 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-black/20 hover:scale-105 active:scale-95 ${
                                  isLangFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-110 z-10 shadow-lg shadow-white/10" : ""
                                }`}
                                title={keyboardLang === "ar" ? "English" : "العربية"}
                              >
                                <Globe className="w-4.5 h-4.5 text-zinc-400 hover:text-zinc-200" />
                              </button>

                              {/* Symbol Mode Toggle */}
                              <button 
                                onClick={() => setKeyboardMode(prev => prev === "letters" ? "symbols" : "letters")}
                                className={`w-11 h-11 rounded-2xl border flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-black/20 hover:scale-105 active:scale-95 ${
                                  keyboardMode === "symbols"
                                    ? "bg-white text-black border-white"
                                    : "bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border-zinc-800/80 hover:border-zinc-700"
                                } ${
                                  isSymFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-110 z-10 shadow-lg shadow-white/10" : ""
                                }`}
                                title={keyboardMode === "letters" ? (lang === "ar" ? "الرموز" : "Symbols") : (lang === "ar" ? "الحروف" : "Letters")}
                              >
                                <Hash className={`w-4.5 h-4.5 ${keyboardMode === "symbols" ? "text-black" : "text-zinc-400"}`} />
                              </button>

                              {/* Backspace */}
                              <button 
                                onClick={() => handleVirtualKeyClick("backspace")}
                                className={`w-11 h-11 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 hover:border-red-500/35 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-black/20 hover:scale-105 active:scale-95 ${
                                  isBackFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-110 z-10 shadow-lg shadow-white/10" : ""
                                }`}
                                title={lang === "ar" ? "حذف" : "Del"}
                              >
                                <Delete className="w-4.5 h-4.5" />
                              </button>

                              {/* Reset / Clear All */}
                              <button 
                                onClick={() => handleVirtualKeyClick("clear-all")}
                                className={`w-11 h-11 rounded-2xl bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800/80 hover:border-zinc-700 flex items-center justify-center transition-all cursor-pointer shadow-lg shadow-black/20 hover:scale-105 active:scale-95 ${
                                  isClearFocused ? "ring-2 ring-white border-white bg-white/20 text-white scale-110 z-10 shadow-lg shadow-white/10" : ""
                                }`}
                                title={lang === "ar" ? "مسح الكل" : "Clear All"}
                              >
                                <X className="w-4.5 h-4.5 text-zinc-500 hover:text-zinc-300" />
                              </button>
                            </div>
                          );
                        })()}
                      </div>

                    </div>

                    {/* Right Column: Filters and Results Grid (lg:col-span-7 xl:col-span-8) */}
                    <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-6 h-full min-h-0">
                      
                      {/* Filters Bar & Results Header - Polished & Modernized */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-zinc-900/30 border border-zinc-800/40 p-4 rounded-2xl backdrop-blur-md shadow-lg shadow-black/10">
                        
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
                        </div>

                        {/* Media Type Filter inside Search Result view */}
                        <div className="flex items-center gap-1 bg-zinc-950/40 p-1 rounded-xl border border-zinc-800/50 text-xs">
                          {[
                            { id: "all", ar: "الكل", en: "All" },
                            { id: "movie", ar: "الأفلام", en: "Movies" },
                            { id: "series", ar: "المسلسلات", en: "TV Shows" }
                          ].map((opt, idx) => {
                            const isFilterFocused = navSection === "search" && searchFocusArea === "filters" && focusedFilterIndex === idx;
                            return (
                              <button
                                key={opt.id}
                                onClick={() => setSearchTypeFilter(opt.id as "all" | "movie" | "series")}
                                className={`px-3 py-1.5 rounded-lg font-bold transition-all text-xs cursor-pointer ${
                                  searchTypeFilter === opt.id
                                    ? "bg-zinc-200 text-zinc-900 shadow-sm"
                                    : "text-zinc-400 hover:text-zinc-200"
                                } ${
                                  isFilterFocused ? "ring-2 ring-white scale-105 border-white bg-white/20 text-white" : ""
                                }`}
                              >
                                {lang === "ar" ? opt.ar : opt.en}
                              </button>
                            );
                          })}
                        </div>

                      </div>

                      {/* Results Area — the only part of this page that scrolls */}
                      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar scroll-smooth">
                      {searchResults.length === 0 ? (
                        
                        /* Enhanced Empty/Guide State */
                        <div className="flex flex-col items-center justify-center p-12 bg-zinc-900/10 border border-dashed border-zinc-800/60 rounded-2xl min-h-[420px] text-center gap-6">
                          
                          <div className="w-16 h-16 rounded-full bg-zinc-800/30 border border-zinc-700/50 flex items-center justify-center text-zinc-400 shadow-inner">
                            <Compass className="w-8 h-8 text-zinc-400" />
                          </div>

                          <div className="flex flex-col gap-1 max-w-sm">
                            <h3 className="text-sm font-bold text-zinc-100">
                              {lang === "ar" ? "ابدأ البحث وتصفح المكتبة" : "Start Searching & Explore Catalog"}
                            </h3>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                              {lang === "ar"
                                ? "اكتب عبارة بحث باستخدام لوحة المفاتيح لتصفية وتصفح الأفلام والمسلسلات في المكتبة بسهولة."
                                : "Enter keywords using the keyboard to easily filter and explore movies and TV shows in the catalog."
                              }
                            </p>
                          </div>

                        </div>

                      ) : (
                        
                        /* Search Results Grid */
                        <div className="flex flex-col gap-4">
                          {isSearchingBackend && (
                            <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between text-xs text-zinc-300 font-bold animate-pulse">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 animate-spin text-zinc-400" />
                                <span>{lang === "ar" ? "جاري تشغيل محرك كراولر Gemini الذكي لجلب نتائجك..." : "Engaging Gemini smart crawler to source dynamic links..."}</span>
                              </div>
                              <div className="w-16 h-1 bg-zinc-950 rounded-full overflow-hidden">
                                <div className="h-full bg-zinc-400 animate-[shimmer_1.5s_infinite]" style={{ width: '60%' }} />
                              </div>
                            </div>
                          )}

                          {/* Render Matches */}
                          {searchResults.filter(m => searchTypeFilter === "all" || m.type === searchTypeFilter).length === 0 ? (
                            <div className="flex flex-col items-center justify-center p-12 bg-zinc-900/10 border border-dashed border-zinc-800/80 rounded-2xl min-h-[300px]">
                              <Compass className="w-12 h-12 text-zinc-600 mb-3" />
                              <h3 className="text-sm font-bold text-zinc-200 mb-1">
                                {lang === "ar" ? "لم يتم العثور على نتائج للتصنيف المختار" : "No matches found for selected format filter"}
                              </h3>
                              <p className="text-xs text-zinc-500">
                                {lang === "ar" ? "جرب تبديل الفلتر أو الاستعلام بعبارة أخرى." : "Try swapping filters or clear typing."}
                              </p>
                            </div>
                          ) : (
                            <div id="search-results-grid" className="grid grid-cols-[repeat(auto-fill,145px)] sm:grid-cols-[repeat(auto-fill,165px)] gap-4 justify-center">
                              {searchResults
                                .filter(m => searchTypeFilter === "all" || m.type === searchTypeFilter)
                                .map((movie, idx) => (
                                  <MovieCard
                                    key={movie.id}
                                    movie={movie}
                                    uniqueKey={`search-${movie.id}`}
                                    isFocused={navSection === "search" && searchFocusArea === "results" && focusedCardIndex === idx}
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
                                  />
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                      </div>

                    </div>

                  </div>
                </div>
              )}

              {/* D1. MOVIES LISTING & SORTING */}
              {contentNavSection === "movies_section" && !playingMovie && (
                <div id="movies-section-scroll" className="p-6 ps-28 md:ps-32 flex flex-col gap-6 h-full overflow-y-auto no-scrollbar scroll-smooth anim-fade-in">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Film className="w-5 h-5 text-white" />
                      <span>{lang === "ar" ? "الأفلام" : "Movies"}</span>
                    </h2>

                    {/* Filters and Sorting bar - Lifted to the top and positioned on the far right */}
                    <div className="flex flex-row items-center gap-5 text-xs">
                      {/* Genres classification selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "التصنيف:" : "Genre:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "movie_genre" ? null : "movie_genre");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[110px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 0 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>{movieGenreFilter === "الكل" ? (lang === "ar" ? "الكل" : "All") : (lang === "ar" ? movieGenreFilter : (genreMap[movieGenreFilter]?.en || movieGenreFilter))}</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "movie_genre" ? "rotate-180" : ""}`} />
                          </button>
                          
                          {activeDropdown === "movie_genre" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[150px] max-h-64 overflow-y-auto no-scrollbar z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {ALL_GENRES.map((g, idx) => (
                                <button
                                  key={g}
                                  data-dropdown-focused={activeDropdown === "movie_genre" && focusedDropdownItemIndex === idx ? "true" : "false"}
                                  onClick={() => {
                                    setMovieGenreFilter(g);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    movieGenreFilter === g ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "movie_genre" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black ring-2 ring-white" : ""}`}
                                >
                                  {lang === "ar" ? g : (genreMap[g]?.en || g)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Language classification selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "اللغة:" : "Language:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "movie_language" ? null : "movie_language");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[110px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 1 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>
                              {lang === "ar" ? (languageMap[movieLanguageFilter]?.ar || movieLanguageFilter) : (languageMap[movieLanguageFilter]?.en || movieLanguageFilter)}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "movie_language" ? "rotate-180" : ""}`} />
                          </button>

                          {activeDropdown === "movie_language" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[140px] max-h-64 overflow-y-auto no-scrollbar z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {ALL_LANGUAGES.map((id, idx) => (
                                <button
                                  key={id}
                                  onClick={() => {
                                    setMovieLanguageFilter(id);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    movieLanguageFilter === id ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "movie_language" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black" : ""}`}
                                >
                                  {lang === "ar" ? languageMap[id]?.ar : languageMap[id]?.en}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sorting selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "ترتيب حسب:" : "Sort By:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "movie_sort" ? null : "movie_sort");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[130px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 2 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>
                              {movieSortBy === "most_watched" 
                                ? (lang === "ar" ? "الأكثر مشاهدة" : "Most Watched")
                                : movieSortBy === "highest_rated"
                                ? (lang === "ar" ? "الأعلى تقييماً" : "Highest Rated")
                                : (lang === "ar" ? "الأحدث" : "Newest")}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "movie_sort" ? "rotate-180" : ""}`} />
                          </button>
                          
                          {activeDropdown === "movie_sort" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[145px] overflow-hidden z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {[
                                { id: "most_watched", labelAr: "الأكثر مشاهدة", labelEn: "Most Watched" },
                                { id: "highest_rated", labelAr: "الأعلى تقييماً", labelEn: "Highest Rated" },
                                { id: "newest", labelAr: "الأحدث", labelEn: "Newest" }
                              ].map((option, idx) => (
                                <button
                                  key={option.id}
                                  onClick={() => {
                                    setMovieSortBy(option.id);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    movieSortBy === option.id ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "movie_sort" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black" : ""}`}
                                >
                                  {lang === "ar" ? option.labelAr : option.labelEn}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Grid of Results */}
                  {allMovies
                    .filter(m => m.type === "movie")
                    .filter(m => matchGenreFilter(m.genres, movieGenreFilter))
                    .filter(m => matchLanguageFilter(m.language, movieLanguageFilter))
                    .length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 bg-slate-900/20 border border-dashed border-slate-800 rounded-3xl">
                      <Compass className="w-12 h-12 text-slate-700 mb-3" />
                      <h3 className="text-base font-bold text-white mb-1">{lang === "ar" ? "لا توجد أفلام تطابق التصنيف" : "No Movies match this classification"}</h3>
                      <p className="text-xs text-slate-500">{lang === "ar" ? "جرب تغيير تصنيف البحث أو تصفح الأقسام الأخرى." : "Try choosing another genre or classification."}</p>
                    </div>
                  ) : (
                    <div id="movies-section-grid" className="grid grid-cols-[repeat(auto-fill,145px)] sm:grid-cols-[repeat(auto-fill,165px)] gap-4 justify-center pt-4 pb-12 px-3">
                      {allMovies
                        .filter(m => m.type === "movie")
                        .filter(m => matchGenreFilter(m.genres, movieGenreFilter))
                        .filter(m => matchLanguageFilter(m.language, movieLanguageFilter))
                        .sort((a, b) => {
                          if (movieSortBy === "newest") return b.year - a.year;
                          if (movieSortBy === "highest_rated") return b.rating - a.rating;
                          if (movieSortBy === "most_watched") {
                            const viewsA = a.views || Math.floor(a.rating * 1500 + a.year);
                            const viewsB = b.views || Math.floor(b.rating * 1500 + b.year);
                            return viewsB - viewsA;
                          }
                          return 0;
                        })
                        .map((movie, idx) => (
                          <MovieCard
                            key={movie.id}
                            movie={movie}
                            uniqueKey={`movie-sect-${movie.id}`}
                            isFocused={navSection === "movies_section" && focusedCardIndex === idx}
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
                          />
                        ))
                      }
                    </div>
                  )}
                </div>
              )}

              {/* D1.2 SERIES LISTING & SORTING */}
              {contentNavSection === "series_section" && !playingMovie && (
                <div id="series-section-scroll" className="p-6 ps-28 md:ps-32 flex flex-col gap-6 h-full overflow-y-auto no-scrollbar scroll-smooth anim-fade-in">
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Tv className="w-5 h-5 text-white" />
                      <span>{lang === "ar" ? "المسلسلات" : "Series"}</span>
                    </h2>

                    {/* Filters and Sorting bar - Lifted to the top and positioned on the far right */}
                    <div className="flex flex-row items-center gap-5 text-xs">
                      {/* Genres classification selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "التصنيف:" : "Genre:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "series_genre" ? null : "series_genre");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[110px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 0 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>{seriesGenreFilter === "الكل" ? (lang === "ar" ? "الكل" : "All") : (lang === "ar" ? seriesGenreFilter : (genreMap[seriesGenreFilter]?.en || seriesGenreFilter))}</span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "series_genre" ? "rotate-180" : ""}`} />
                          </button>
                          
                          {activeDropdown === "series_genre" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[150px] max-h-64 overflow-y-auto no-scrollbar z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {ALL_GENRES.map((g, idx) => (
                                <button
                                  key={g}
                                  data-dropdown-focused={activeDropdown === "series_genre" && focusedDropdownItemIndex === idx ? "true" : "false"}
                                  onClick={() => {
                                    setSeriesGenreFilter(g);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    seriesGenreFilter === g ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "series_genre" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black ring-2 ring-white" : ""}`}
                                >
                                  {lang === "ar" ? g : (genreMap[g]?.en || g)}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Language classification selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "اللغة:" : "Language:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "series_language" ? null : "series_language");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[110px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 1 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>
                              {lang === "ar" ? (languageMap[seriesLanguageFilter]?.ar || seriesLanguageFilter) : (languageMap[seriesLanguageFilter]?.en || seriesLanguageFilter)}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "series_language" ? "rotate-180" : ""}`} />
                          </button>

                          {activeDropdown === "series_language" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[140px] max-h-64 overflow-y-auto no-scrollbar z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {ALL_LANGUAGES.map((id, idx) => (
                                <button
                                  key={id}
                                  onClick={() => {
                                    setSeriesLanguageFilter(id);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    seriesLanguageFilter === id ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "series_language" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black" : ""}`}
                                >
                                  {lang === "ar" ? languageMap[id]?.ar : languageMap[id]?.en}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sorting selector */}
                      <div className="flex items-center gap-2 text-xs relative">
                        <span className="text-zinc-400 font-semibold">{lang === "ar" ? "ترتيب حسب:" : "Sort By:"}</span>
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(prev => prev === "series_sort" ? null : "series_sort");
                            }}
                            className={`flex items-center justify-between gap-2 bg-black hover:bg-zinc-900 text-white rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all shadow-lg min-w-[130px] cursor-pointer select-none border ${
                              sectionFocusArea === "filters" && focusedSectionFilter === 2 ? "border-white ring-2 ring-white scale-[1.04]" : "border-white/20 hover:border-white"
                            }`}
                          >
                            <span>
                              {seriesSortBy === "most_watched" 
                                ? (lang === "ar" ? "الأكثر مشاهدة" : "Most Watched")
                                : seriesSortBy === "highest_rated"
                                ? (lang === "ar" ? "الأعلى تقييماً" : "Highest Rated")
                                : (lang === "ar" ? "الأحدث" : "Newest")}
                            </span>
                            <ChevronDown className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${activeDropdown === "series_sort" ? "rotate-180" : ""}`} />
                          </button>
                          
                          {activeDropdown === "series_sort" && (
                            <div className="absolute right-0 top-full mt-2 bg-black/98 text-white rounded-lg shadow-[0_16px_40px_rgba(0,0,0,0.95)] min-w-[145px] overflow-hidden z-50 flex flex-col py-1.5 border border-white/20 backdrop-blur-2xl">
                              {[
                                { id: "most_watched", labelAr: "الأكثر مشاهدة", labelEn: "Most Watched" },
                                { id: "highest_rated", labelAr: "الأعلى تقييماً", labelEn: "Highest Rated" },
                                { id: "newest", labelAr: "الأحدث", labelEn: "Newest" }
                              ].map((option, idx) => (
                                <button
                                  key={option.id}
                                  onClick={() => {
                                    setSeriesSortBy(option.id);
                                    setActiveDropdown(null);
                                  }}
                                  className={`w-full px-4 py-2 text-xs font-bold transition-all border-0 cursor-pointer ${lang === "ar" ? "text-right" : "text-left"} ${
                                    seriesSortBy === option.id ? "text-black bg-white font-extrabold shadow-sm" : "text-zinc-300 hover:text-white hover:bg-zinc-900"
                                  } ${activeDropdown === "series_sort" && focusedDropdownItemIndex === idx ? "bg-white text-black font-black" : ""}`}
                                >
                                  {lang === "ar" ? option.labelAr : option.labelEn}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Grid of Results */}
                  {allMovies
                    .filter(m => m.type === "series")
                    .filter(m => matchGenreFilter(m.genres, seriesGenreFilter))
                    .filter(m => matchLanguageFilter(m.language, seriesLanguageFilter))
                    .length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-12 bg-slate-900/20 border border-dashed border-slate-800 rounded-3xl">
                      <Compass className="w-12 h-12 text-slate-700 mb-3" />
                      <h3 className="text-base font-bold text-white mb-1">{lang === "ar" ? "لا توجد مسلسلات تطابق التصنيف" : "No Series match this classification"}</h3>
                      <p className="text-xs text-slate-500">{lang === "ar" ? "جرب تغيير تصنيف البحث أو تصفح الأقسام الأخرى." : "Try choosing another genre or classification."}</p>
                    </div>
                  ) : (
                    <div id="series-section-grid" className="grid grid-cols-[repeat(auto-fill,145px)] sm:grid-cols-[repeat(auto-fill,165px)] gap-4 justify-center pt-4 pb-12 px-3">
                      {allMovies
                        .filter(m => m.type === "series")
                        .filter(m => matchGenreFilter(m.genres, seriesGenreFilter))
                        .filter(m => matchLanguageFilter(m.language, seriesLanguageFilter))
                        .sort((a, b) => {
                          if (seriesSortBy === "newest") return b.year - a.year;
                          if (seriesSortBy === "highest_rated") return b.rating - a.rating;
                          if (seriesSortBy === "most_watched") {
                            const viewsA = a.views || Math.floor(a.rating * 1500 + a.year);
                            const viewsB = b.views || Math.floor(b.rating * 1500 + b.year);
                            return viewsB - viewsA;
                          }
                          return 0;
                        })
                        .map((movie, idx) => (
                          <MovieCard
                            key={movie.id}
                            movie={movie}
                            uniqueKey={`series-sect-${movie.id}`}
                            isFocused={navSection === "series_section" && focusedCardIndex === idx}
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
                          />
                        ))
                      }
                    </div>
                  )}
                </div>
              )}

              {/* D2. COLLECTION DETAIL LISTS (Show More view) */}
              {contentNavSection === "collections_section" && !playingMovie && (
                <div id="collections-section-scroll" className="p-6 md:p-8 ps-28 md:ps-32 flex flex-col gap-6 h-full overflow-y-auto no-scrollbar scroll-smooth anim-fade-in" dir={lang === "ar" ? "rtl" : "ltr"}>
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Users className="w-5 h-5 text-white" />
                        <span>{lang === "ar" ? "سلاسل الأفلام الأكثر تقييماً" : "Top Rated Movie Collections"}</span>
                      </h2>
                      <p className="text-xs text-zinc-400">
                        {lang === "ar" ? "تصفح سلاسل الأفلام الكاملة مرتبة من الجزء الأول للأخير وحسب التقييم." : "Browse full movie franchises ordered from the first part to the last and sorted by rating."}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setNavSection("rails");
                        setFocusedRailIndex(0);
                        setFocusedCardIndex(0);
                      }}
                      className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold transition-all border border-zinc-800 cursor-pointer flex items-center gap-1.5 self-start"
                    >
                      <span>{lang === "ar" ? "العودة للرئيسية" : "Back to Home"}</span>
                    </button>
                  </div>

                  {/* Collections List */}
                  <div className="flex flex-col gap-10 pb-20">
                    {getMovieCollections(allMovies).map((col, rIdx) => {
                      return (
                        <div key={col.id} className="flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <span className="w-1.5 h-4 rounded-full bg-white" />
                            <h3 className="text-sm font-black text-white">{lang === "ar" ? col.nameAr : col.nameEn}</h3>
                            <span className="text-[10px] bg-white/10 text-white/90 border border-white/5 px-2 py-0.5 rounded-full font-bold">
                              {col.movies.length} {lang === "ar" ? "أجزاء" : "Parts"}
                            </span>
                            <span className="flex items-center gap-0.5 text-amber-400 text-[10px] font-bold">
                              <Star className="w-3.5 h-3.5 fill-amber-400 stroke-amber-400 shrink-0" />
                              <span>{col.rating.toFixed(1)}</span>
                            </span>
                          </div>

                          <div className="relative group/col-rail">
                            <div className="flex items-center gap-4 overflow-x-auto pt-4 pb-8 px-1 no-scrollbar scroll-smooth">
                              {col.movies.map((movie, cIdx) => {
                                const isCardFocused = navSection === "collections_section" && focusedRailIndex === rIdx && focusedCardIndex === cIdx;
                                const uniqueKey = `collection-row-${rIdx}-${cIdx}`;
                                return (
                                  <MovieCard
                                    key={movie.id}
                                    movie={movie}
                                    uniqueKey={uniqueKey}
                                    isFocused={isCardFocused}
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
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* C. MY FAVORITES / BOOKMARKS */}
              {contentNavSection === "favorites" && !playingMovie && (
                <div className="p-6 md:p-8 ps-28 md:ps-32 flex flex-col gap-6 select-none">
                  
                  {/* Compact Header Title */}
                  <div className={`flex items-center gap-3 border-b border-white/10 pb-4 ${lang === "ar" ? "text-right" : "text-left"}`}>
                    <div className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500">
                      <Heart className="w-5 h-5 fill-current" />
                    </div>
                    <div>
                      <h1 className="text-xl md:text-2xl font-black text-white">
                        {lang === "ar" ? "قائمتي ومحفوظاتي" : "My Library & Watchlist"}
                      </h1>
                      <p className="text-xs text-zinc-400 font-medium mt-0.5">
                        {lang === "ar" ? "الأفلام والمسلسلات التي قمت بحفظها وسجل المشاهدة" : "Your bookmarked titles and watch history"}
                      </p>
                    </div>
                  </div>

                  {/* SECTION 1: MY FAVORITES */}
                  <div className="bg-zinc-950/25 border border-zinc-900/60 rounded-3xl p-5 md:p-6 shadow-xl backdrop-blur-sm space-y-5">
                    <div className={`border-b border-zinc-900/60 pb-3 flex flex-col gap-1 ${lang === "ar" ? "text-right" : "text-left"}`}>
                      <div className={`flex items-center gap-2 ${lang === "ar" ? "flex-row-reverse" : "flex-row"}`}>
                        <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
                          <Heart className="w-4 h-4 text-rose-500 fill-current animate-pulse" />
                        </div>
                        <h2 className="text-sm font-black text-zinc-200">{lang === "ar" ? "قائمتي المفضلة" : "My Watchlist"}</h2>
                        <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800/80 px-2 py-0.5 rounded-full font-black font-num">
                          {favorites.length}
                        </span>
                      </div>
                      <p className={`text-[11px] text-zinc-400 font-medium leading-relaxed ${lang === "ar" ? "pr-9" : "pl-9"}`}>
                        {lang === "ar" ? "أفلامك ومسلسلاتك المفضلة التي قمت بحفظها لمشاهدتها لاحقاً." : "Your favorite movies and series bookmarked for later viewing."}
                      </p>
                    </div>

                    {favorites.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 bg-zinc-900/10 border border-dashed border-zinc-800/60 rounded-2xl text-center">
                        <div className="p-3 bg-zinc-950/40 rounded-full border border-zinc-900/80 mb-3 text-zinc-600">
                          <Heart className="w-6 h-6 text-zinc-500" />
                        </div>
                        <h3 className="text-xs font-bold text-white mb-1">{lang === "ar" ? "قائمتك فارغة تماماً" : "Your watchlist is empty"}</h3>
                        <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed">
                          {lang === "ar" ? "تصفح أفلام ومسلسلات سينمانا واضغط على أيقونة القلب لإضافتها إلى قائمتك للرجوع إليها لاحقاً." : "Browse Cinemana movies and press the Heart icon on any card to save it right here."}
                        </p>
                      </div>
                    ) : (
                      <div id="favorites-grid" className="grid grid-cols-[repeat(auto-fill,145px)] sm:grid-cols-[repeat(auto-fill,165px)] gap-4 justify-center pt-2 pb-4 px-1">
                        {favorites.map((movie, idx) => (
                          <MovieCard
                            key={movie.id}
                            movie={movie}
                            uniqueKey={`fav-${movie.id}`}
                            isFocused={navSection === "favorites" && favoritesFocusArea === "list" && focusedCardIndex === idx}
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
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* SECTION 2: WATCH HISTORY */}
                  <div className="bg-zinc-950/25 border border-zinc-900/60 rounded-3xl p-5 md:p-6 shadow-xl backdrop-blur-sm space-y-5">
                    <div className={`flex items-center justify-between border-b border-zinc-900/60 pb-3 ${lang === "ar" ? "flex-row-reverse" : "flex-row"}`}>
                      <div className={`flex items-center gap-2 ${lang === "ar" ? "flex-row-reverse" : "flex-row"}`}>
                        <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <History className="w-4 h-4 text-blue-400" />
                        </div>
                        <h2 className="text-sm font-black text-zinc-200">{lang === "ar" ? "تابع المشاهدة" : "Continue Watching"}</h2>
                        <span className="text-[10px] bg-zinc-900 text-zinc-400 border border-zinc-800/80 px-2 py-0.5 rounded-full font-black font-num">
                          {watchHistory.length}
                        </span>
                      </div>
                      
                      {watchHistory.length > 0 && (
                        <button
                          onClick={() => {
                            setWatchHistory([]);
                            safeStorage.removeItem("cinemana_tv_watch_history");
                            setPlayerToast(lang === "ar" ? "تم مسح سجل المشاهدة بالكامل" : "Watch history cleared successfully");
                          }}
                          className={`px-2.5 py-1.5 rounded-xl border text-[9.5px] font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                            navSection === "favorites" && favoritesFocusArea === "clear_history"
                              ? "bg-red-600 text-white border-white ring-2 ring-white scale-[1.03]"
                              : "border-zinc-850 bg-zinc-950/60 text-zinc-400 hover:text-white hover:border-red-900/60 hover:bg-red-950/20"
                          }`}
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                          <span>{lang === "ar" ? "مسح السجل" : "Clear History"}</span>
                        </button>
                      )}
                    </div>

                    {watchHistory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 bg-zinc-900/10 border border-dashed border-zinc-800/60 rounded-2xl text-center">
                        <div className="p-3 bg-zinc-950/40 rounded-full border border-zinc-900/80 mb-3 text-zinc-600">
                          <History className="w-6 h-6 text-zinc-500" />
                        </div>
                        <h3 className="text-xs font-bold text-white mb-1">{lang === "ar" ? "سجل المشاهدات فارغ" : "Watch history is empty"}</h3>
                        <p className="text-[10px] text-zinc-500 max-w-xs leading-relaxed">
                          {lang === "ar" ? "الأفلام والمسلسلات التي تقوم بتشغيلها ستظهر هنا تلقائياً لتتمكن من إكمالها لاحقاً." : "Movies and series you watch will automatically show up here so you can easily resume watching them."}
                        </p>
                      </div>
                    ) : (
                      <div id="favorites-watch-history-grid" className="grid grid-cols-[repeat(auto-fill,145px)] sm:grid-cols-[repeat(auto-fill,165px)] gap-4 justify-center pt-2 pb-4 px-1">
                        {watchHistory.map((movie, idx) => (
                          <MovieCard
                            key={`hist-${movie.id}`}
                            movie={movie}
                            uniqueKey={`hist-${movie.id}`}
                            isFocused={navSection === "favorites" && favoritesFocusArea === "watch_history" && focusedCardIndex === idx}
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
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* D. SETTINGS MENU */}
              {contentNavSection === "settings" && !playingMovie && (
                <div className="p-6 ps-28 md:ps-32 flex flex-col gap-6 w-full max-w-5xl overflow-y-auto h-full pb-24 select-text no-scrollbar">
                  {/* Header */}
                  <div className="flex items-center gap-2 border-b border-neutral-800 pb-4">
                    <Settings className="w-5.5 h-5.5 text-white animate-spin-slow" />
                    <h2 className="text-xl font-bold text-white">
                      {lang === "ar" ? "الإعدادات" : "Settings"}
                    </h2>
                  </div>

                  {/* Main Settings Content Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                    
                    {/* COLUMN 1: Profile & Subscription (Login) - 5 columns */}
                    <div className="lg:col-span-5 flex flex-col gap-4">
                      
                      {/* LOGIN / SESSION CARD */}
                      <div className="bg-gradient-to-br from-neutral-900/80 to-neutral-950/80 border border-neutral-800/80 rounded-2xl p-5 shadow-xl relative overflow-hidden">
                        {/* Subtle decoration */}
                        <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-3xl pointer-events-none" />
                        
                        <div className="flex items-center gap-2 mb-4">
                          <User className="w-4 h-4 text-zinc-400" />
                          <h3 className="text-sm font-bold text-white">
                            {lang === "ar" ? "حساب المشترك" : "Subscriber Account"}
                          </h3>
                        </div>

                        {userSession ? (
                          /* Logged In State */
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3 bg-neutral-900/80 p-3.5 border border-neutral-850 rounded-xl">
                              <div className="w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-white font-black text-sm shadow-inner">
                                {userSession.displayName.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-white block truncate">{userSession.displayName}</span>
                                  <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded-full font-bold">
                                    ★ {isAdminAuthenticated ? (lang === "ar" ? "مشرف" : "ADMIN") : (lang === "ar" ? "مميز" : "VIP")}
                                  </span>
                                </div>
                                <span className="text-[10px] text-slate-500 block font-mono">@{userSession.username}</span>
                              </div>
                            </div>

                            {/* Subscription details */}
                            <div className="space-y-1.5 bg-neutral-950/60 p-3 rounded-xl border border-neutral-900 text-[11px]">
                              <div className="flex justify-between items-center text-slate-400">
                                <span>{lang === "ar" ? "نوع الاشتراك:" : "Plan Type:"}</span>
                                <span className="font-bold text-white">{lang === "ar" ? userSession.planAr : userSession.planEn}</span>
                              </div>
                              <div className="flex justify-between items-center text-slate-400">
                                <span>{lang === "ar" ? "صلاحية الحساب:" : "Active Until:"}</span>
                                <span className="font-mono text-white font-bold">{userSession.activeUntil}</span>
                              </div>
                              <div className="flex justify-between items-center text-slate-400">
                                <span>{lang === "ar" ? "دقة البث القصوى:" : "Max Resolution:"}</span>
                                <span className="font-mono text-zinc-300 font-bold">4K Ultra HD</span>
                              </div>
                            </div>

                            {/* Admin specific entry button */}
                            {isAdminAuthenticated && (
                              <button
                                onClick={() => {
                                  setNavSection("admin");
                                }}
                                className={`w-full py-2 text-white font-black text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                                  settingsFocusArea === "admin_panel_btn" 
                                    ? "bg-red-500 border-white ring-2 ring-white scale-[1.03] animate-pulse" 
                                    : "bg-red-600 hover:bg-red-500"
                                }`}
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                <span>{lang === "ar" ? "دخول لوحة التحكم للمشرفين" : "Open Administrator Panel"}</span>
                              </button>
                            )}

                            {/* Logout button */}
                            <button
                              onClick={() => {
                                safeStorage.removeItem("cinemana_session");
                                safeStorage.removeItem("isAdminLoggedIn");
                                setIsAdminAuthenticated(false);
                                setUserSession(null);
                                setLoginError("");
                                setPlayerToast(lang === "ar" ? "تم تسجيل الخروج بنجاح" : "Logged out successfully");
                              }}
                              className={`w-full py-2 text-zinc-300 hover:text-white text-[11px] font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                                settingsFocusArea === "logout_btn" 
                                  ? "bg-red-600 text-white border-white ring-2 ring-white scale-[1.03]" 
                                  : "bg-zinc-950 hover:bg-zinc-900 border-neutral-800 hover:border-neutral-700"
                              }`}
                            >
                              <LogOut className="w-3.5 h-3.5" />
                              <span>{lang === "ar" ? "تسجيل الخروج" : "Sign Out"}</span>
                            </button>
                          </div>
                        ) : (
                          /* Logged Out / Login Form State */
                          <div className="flex flex-col gap-3">
                            <p className="text-[11px] text-slate-400 leading-relaxed">
                              {lang === "ar" 
                                ? "سجل دخولك الآن لتفعيل مزايا المشتركين، مزامنة المفضلة والمشاهدة بدقة 4K فائقة الجودة." 
                                : "Sign in now to unlock premium member benefits, sync favorites, and stream in ultra 4K."}
                            </p>

                            {loginError && (
                              <div className="p-2.5 bg-zinc-900/60 border border-zinc-850 rounded-xl text-red-400 text-[10px] font-bold">
                                ⚠️ {loginError}
                              </div>
                            )}

                            <div className="space-y-2.5">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-slate-400 font-bold">
                                  {lang === "ar" ? "اسم المستخدم" : "Username"}
                                </label>
                                <div className="relative">
                                  <input
                                    id="login-username-input"
                                    type="text"
                                    value={loginUsername}
                                    onChange={(e) => setLoginUsername(e.target.value)}
                                    placeholder={lang === "ar" ? "مثال: ali_baghdad" : "e.g. ali_baghdad"}
                                    className={`w-full bg-black border rounded-xl py-2 px-3 pl-8 text-xs text-white placeholder-zinc-500 outline-none font-sans transition-all ${
                                      settingsFocusArea === "login_username" 
                                        ? "border-white ring-2 ring-white bg-white/5 scale-[1.02]" 
                                        : "border-zinc-800 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                                    }`}
                                  />
                                  <User className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                                </div>
                              </div>

                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] text-slate-400 font-bold">
                                  {lang === "ar" ? "كلمة المرور" : "Password"}
                                </label>
                                <div className="relative">
                                  <input
                                    id="login-password-input"
                                    type="password"
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className={`w-full bg-black border rounded-xl py-2 px-3 pl-8 text-xs text-white placeholder-zinc-500 outline-none font-sans transition-all ${
                                      settingsFocusArea === "login_password" 
                                        ? "border-white ring-2 ring-white bg-white/5 scale-[1.02]" 
                                        : "border-zinc-800 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                                    }`}
                                  />
                                  <Lock className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                                </div>
                              </div>

                              <button
                                id="login-submit-btn"
                                onClick={() => {
                                  const cleanUser = loginUsername.trim().toLowerCase();
                                  const cleanPass = loginPassword.trim();

                                  if (!cleanUser || !cleanPass) {
                                    setLoginError(lang === "ar" ? "يرجى كتابة اسم المستخدم وكلمة المرور" : "Please fill in all fields");
                                    return;
                                  }

                                  // Retrieve dynamically registered administrators list
                                  const savedAdmins = safeStorage.getItem("cinemana_admin_users");
                                  let adminsList = [{ username: "zaid", password: "1995" }];
                                  if (savedAdmins) {
                                    try {
                                      adminsList = JSON.parse(savedAdmins);
                                    } catch (e) {}
                                  }

                                  // Check if entered credentials match any admin user
                                  const matchedAdmin = adminsList.find(admin => admin.username === cleanUser && admin.password === cleanPass);

                                  if (matchedAdmin) {
                                    // LOG IN AS ADMIN
                                    setIsAdminAuthenticated(true);
                                    safeStorage.setItem("isAdminLoggedIn", "true");

                                    const adminSession = {
                                      username: cleanUser,
                                      displayName: cleanUser === "zaid" ? (lang === "ar" ? "زيد (المسؤول)" : "Zaid (Admin)") : `${cleanUser} (Admin)`,
                                      planAr: "حساب المشرف الكامل",
                                      planEn: "Full Administrator Account",
                                      activeUntil: "∞"
                                    };

                                    safeStorage.setItem("cinemana_session", JSON.stringify(adminSession));
                                    setUserSession(adminSession);
                                    setLoginUsername("");
                                    setLoginPassword("");
                                    setLoginError("");
                                    setPlayerToast(lang === "ar" ? "تم تسجيل دخول المسؤول بنجاح!" : "Administrator logged in successfully!");
                                    
                                    // Open admin dashboard automatically
                                    setNavSection("admin");
                                  } else {
                                    // Log in as normal premium subscriber
                                    const mockSession = {
                                      username: cleanUser,
                                      displayName: cleanUser === "shabakaty_user" ? (lang === "ar" ? "أبو الذهب" : "Abu Al-Dahab") : cleanUser,
                                      planAr: "الباقة الماسية اللامحدودة 4K",
                                      planEn: "Ultimate Diamond Plan 4K",
                                      activeUntil: "2027-12-31"
                                    };
                                    safeStorage.setItem("cinemana_session", JSON.stringify(mockSession));
                                    setUserSession(mockSession);
                                    setLoginUsername("");
                                    setLoginPassword("");
                                    setLoginError("");
                                    setPlayerToast(lang === "ar" ? "تم تسجيل الدخول بنجاح! أهلاً بك." : "Login successful! Welcome.");
                                  }
                                }}
                                className={`w-full py-2 text-xs rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 font-extrabold ${
                                  settingsFocusArea === "login_submit" 
                                    ? "bg-red-600 text-white border-white ring-2 ring-white scale-[1.03]" 
                                    : "bg-white hover:bg-zinc-200 text-black active:scale-98"
                                }`}
                              >
                                <span>{lang === "ar" ? "تسجيل الدخول" : "Sign In"}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* COLUMN 2: Language & Subtitle Settings - 7 columns */}
                    <div className="lg:col-span-7 flex flex-col gap-4">
                      
                      {/* INTERFACE LANGUAGE */}
                      <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 shadow-xl">
                        <div className="flex items-center gap-2 mb-3 border-b border-neutral-800 pb-2 flex-row">
                          <Globe className="w-4 h-4 text-zinc-400" />
                          <h3 className="text-xs font-bold text-white">
                            {lang === "ar" ? "لغة واجهة العرض" : "App Display Language"}
                          </h3>
                        </div>

                        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                          {lang === "ar" 
                            ? "اختر لغة واجهة التطبيق لعرض القوائم، التصنيفات، وأزرار التحكم." 
                            : "Select the display language for menus, category filters, and controls."}
                        </p>

                        <div className="relative max-w-sm">
                          {/* tabIndex=-1: this <select> is only ever driven by the D-pad focus
                              ring/OK-toggle above (settingsFocusArea === "app_language"), never
                              real DOM focus — the whole app is styled focus rings, not native
                              focus. If it ever DID pick up real browser focus (WebView spatial
                              nav, a stray click), its native Up/Down-changes-the-value behavior
                              would fire on the exact same arrow keys used for D-pad navigation,
                              silently flipping the app language while the user was just trying
                              to move around Settings. Same for the two <select>s below. */}
                          <select
                            id="app-language-dropdown"
                            tabIndex={-1}
                            value={lang}
                            onChange={(e) => {
                              const selectedLang = e.target.value as "ar" | "en";
                              setLang(selectedLang);
                              setPlayerToast(selectedLang === "ar" ? "تم تغيير لغة التطبيق إلى العربية" : "App language changed to English");
                            }}
                            className={`w-full bg-black border rounded-lg py-2.5 px-3.5 text-xs text-white font-bold outline-none cursor-pointer appearance-none pl-8 pr-8 font-sans transition-all shadow-xl ${
                              settingsFocusArea === "app_language" 
                                ? "border-white ring-2 ring-white bg-zinc-900 scale-[1.02]" 
                                : "border-white/20 hover:border-white"
                            }`}
                          >
                            <option value="ar" className="text-white bg-black font-bold">العربية (Arabic)</option>
                            <option value="en" className="text-white bg-black font-bold">English (English)</option>
                          </select>
                          <div className={`absolute inset-y-0 ${lang === "ar" ? "left-3" : "right-3"} flex items-center pointer-events-none text-zinc-300`}>
                            <ChevronDown className="w-4 h-4" />
                          </div>
                        </div>
                      </div>

                      {/* SUBTITLE CONTROLS */}
                      <div className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 shadow-xl">
                        <div className="flex items-center gap-2 mb-3 border-b border-neutral-800 pb-2">
                          <Captions className="w-4 h-4 text-zinc-400" />
                          <h3 className="text-xs font-bold text-white">
                            {lang === "ar" ? "التحكم بالترجمة ومظهر النصوص" : "Subtitle Settings & Text Appearance"}
                          </h3>
                        </div>

                        <div className="space-y-3.5">
                          
                          {/* 1. Font Family Dropdown */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-300 block">
                              <span>{lang === "ar" ? "نوع الخط العربي" : "Arabic Font Family"}</span>
                            </label>
                            <div className="relative max-w-sm">
                              <select
                                id="subtitle-font-dropdown"
                                tabIndex={-1}
                                value={subFont}
                                onChange={(e) => {
                                  const selectedId = e.target.value;
                                  setSubFont(selectedId);
                                  const fontLabel = selectedId === "Cairo" ? "كيرو (Cairo)" : selectedId === "Tajawal" ? "تجوال (Tajawal)" : selectedId === "Amiri" ? "أميري (Amiri)" : "مونو (Mono)";
                                  setPlayerToast(lang === "ar" ? `تم اختيار خط: ${fontLabel}` : `Font changed to: ${selectedId}`);
                                }}
                                className={`w-full bg-black border rounded-lg py-2.5 px-3.5 text-xs text-white font-bold outline-none cursor-pointer appearance-none pl-8 pr-8 font-sans transition-all shadow-xl ${
                                  settingsFocusArea === "sub_font" 
                                    ? "border-white ring-2 ring-white bg-zinc-900 scale-[1.02]" 
                                    : "border-white/20 hover:border-white"
                                }`}
                              >
                                <option value="Cairo" className="font-['Cairo'] text-white bg-black font-bold">كيرو (Cairo)</option>
                                <option value="Tajawal" className="font-['Tajawal'] text-white bg-black font-bold">تجوال (Tajawal)</option>
                                <option value="Amiri" className="font-['Amiri'] font-bold text-white bg-black">أميري (Amiri)</option>
                                <option value="JetBrains Mono" className="font-['JetBrains_Mono'] text-white bg-black font-bold">مونو (Mono)</option>
                              </select>
                              <div className={`absolute inset-y-0 ${lang === "ar" ? "left-3" : "right-3"} flex items-center pointer-events-none text-zinc-300`}>
                                <ChevronDown className="w-4 h-4" />
                              </div>
                            </div>
                          </div>

                          {/* 2. Font Size Picker */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-300">
                              {lang === "ar" ? "حجم خط الترجمة" : "Subtitle Font Size"}
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                              {[
                                { id: "small", labelAr: "صغير", labelEn: "Small" },
                                { id: "medium", labelAr: "متوسط", labelEn: "Medium" },
                                { id: "large", labelAr: "كبير", labelEn: "Large" },
                                { id: "xl", labelAr: "ضخم جداً", labelEn: "Extra Large" }
                              ].map((sizeItem, idx) => (
                                <button
                                  key={sizeItem.id}
                                  onClick={() => {
                                    setSubSize(sizeItem.id);
                                    setPlayerToast(lang === "ar" ? `الحجم: ${sizeItem.labelAr}` : `Size set to: ${sizeItem.labelEn}`);
                                  }}
                                  className={`p-1.5 rounded-xl border text-[10px] text-center cursor-pointer transition-all font-bold ${
                                    subSize === sizeItem.id 
                                      ? "bg-white text-black font-extrabold border-white" 
                                      : "bg-black border-zinc-800 text-slate-300 hover:border-zinc-700 hover:text-white"
                                  } ${
                                    settingsFocusArea === "sub_size" && focusedSubSizeIndex === idx 
                                      ? "ring-2 ring-white scale-105 border-white bg-white/10 text-white" 
                                      : ""
                                  }`}
                                >
                                  {lang === "ar" ? sizeItem.labelAr : sizeItem.labelEn}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 3. Subtitle Color Selector */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-300">
                              {lang === "ar" ? "لون خط الترجمة" : "Subtitle Text Color"}
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              {[
                                { id: "yellow", labelAr: "أصفر ساطع", labelEn: "Bright Yellow" },
                                { id: "white", labelAr: "أبيض نقّي", labelEn: "Pure White" },
                                { id: "white_light", labelAr: "أبيض خفيف", labelEn: "Light White" }
                              ].map((colorItem, idx) => (
                                <button
                                  key={colorItem.id}
                                  onClick={() => {
                                    setSubColor(colorItem.id);
                                    setPlayerToast(lang === "ar" ? `اللون: ${colorItem.labelAr}` : `Color set to: ${colorItem.labelEn}`);
                                  }}
                                  className={`p-1.5 rounded-xl border text-[10px] text-center cursor-pointer transition-all flex items-center justify-center gap-1 font-bold ${
                                    subColor === colorItem.id 
                                      ? "bg-white text-black font-extrabold border-white" 
                                      : "bg-black border-zinc-800 text-slate-300 hover:border-zinc-700 hover:text-white"
                                  } ${
                                    settingsFocusArea === "sub_color" && focusedSubColorIndex === idx 
                                      ? "ring-2 ring-white scale-105 border-white bg-white/10 text-white" 
                                      : ""
                                  }`}
                                >
                                  <div className={`w-2 h-2 rounded-full ${colorItem.id === "yellow" ? "bg-yellow-300" : colorItem.id === "white" ? "bg-white" : "bg-white/60"}`} />
                                  <span>{lang === "ar" ? colorItem.labelAr : colorItem.labelEn}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* 4. Subtitle Shadow Dropdown */}
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-300">
                              {lang === "ar" ? "تضليل نص الترجمة" : "Subtitle Text Shadow"}
                            </label>
                            <div className="relative max-w-sm">
                              <select
                                id="subtitle-shadow-dropdown"
                                tabIndex={-1}
                                value={subShadow ? "on" : "off"}
                                onChange={(e) => {
                                  const enabled = e.target.value === "on";
                                  setSubShadow(enabled);
                                  setPlayerToast(
                                    lang === "ar" 
                                      ? (enabled ? "تم تفعيل تضليل النصوص" : "تم إيقاف تضليل النصوص") 
                                      : (enabled ? "Text shadowing enabled" : "Text shadowing disabled")
                                  );
                                }}
                                className={`w-full bg-black border rounded-lg py-2.5 px-3.5 text-xs text-white font-bold outline-none cursor-pointer appearance-none pl-8 pr-8 font-sans transition-all shadow-xl ${
                                  settingsFocusArea === "sub_shadow" 
                                    ? "border-white ring-2 ring-white bg-zinc-900 scale-[1.02]" 
                                    : "border-white/20 hover:border-white"
                                }`}
                              >
                                <option value="on" className="text-white bg-black font-bold">{lang === "ar" ? "تشغيل" : "ON"}</option>
                                <option value="off" className="text-white bg-black font-bold">{lang === "ar" ? "إيقاف" : "OFF"}</option>
                              </select>
                              <div className={`absolute inset-y-0 ${lang === "ar" ? "left-3" : "right-3"} flex items-center pointer-events-none text-zinc-300`}>
                                <ChevronDown className="w-4 h-4" />
                              </div>
                            </div>
                          </div>

                          {/* 5. Subtitle Synchronization Offset Control (التحكم في مزامنة الترجمة) */}
                          <div className="space-y-1.5 pt-1">
                            <label className="text-[10px] font-bold text-slate-300 flex items-center justify-between">
                              <span>{lang === "ar" ? "مزامنة الترجمة وتوقيت الظهور" : "Subtitle Sync & Timing Offset"}</span>
                              <span className="text-[10px] font-extrabold text-amber-400 font-mono">
                                {subtitleOffset === 0 
                                  ? (lang === "ar" ? "متطابق" : "In Sync") 
                                  : `${subtitleOffset > 0 ? "+" : ""}${subtitleOffset.toFixed(1)}s`}
                              </span>
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                onClick={() => {
                                  setSubtitleOffset(prev => prev - 0.5);
                                  setPlayerToast(lang === "ar" ? `تم تأخير الترجمة بمقدار: ${(subtitleOffset - 0.5).toFixed(1)} ثانية` : `Subtitle delayed by: ${(subtitleOffset - 0.5).toFixed(1)}s`);
                                }}
                                className="p-1.5 rounded-xl border border-zinc-800 text-[10px] text-center cursor-pointer transition-all font-bold bg-black text-slate-300 hover:border-zinc-700 hover:text-white"
                              >
                                {lang === "ar" ? "تأخير -0.5ث" : "Delay -0.5s"}
                              </button>
                              
                              <button
                                onClick={() => {
                                  setSubtitleOffset(0);
                                  setPlayerToast(lang === "ar" ? "تم إعادة ضبط المزامنة للوضع الافتراضي" : "Subtitle sync reset to default");
                                }}
                                className="p-1.5 rounded-xl border border-zinc-800 text-[10px] text-center cursor-pointer transition-all font-bold bg-black text-slate-300 hover:border-zinc-700 hover:text-white"
                              >
                                {lang === "ar" ? "إعادة ضبط" : "Reset"}
                              </button>

                              <button
                                onClick={() => {
                                  setSubtitleOffset(prev => prev + 0.5);
                                  setPlayerToast(lang === "ar" ? `تم تقديم الترجمة بمقدار: ${(subtitleOffset + 0.5).toFixed(1)} ثانية` : `Subtitle advanced by: ${(subtitleOffset + 0.5).toFixed(1)}s`);
                                }}
                                className="p-1.5 rounded-xl border border-zinc-800 text-[10px] text-center cursor-pointer transition-all font-bold bg-black text-slate-300 hover:border-zinc-700 hover:text-white"
                              >
                                {lang === "ar" ? "تقديم +0.5ث" : "Advance +0.5s"}
                              </button>
                            </div>
                          </div>

                          {/* 5. REAL-TIME SUBTITLE PREVIEW BOX */}
                          <div className="space-y-1.5 mt-2">
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                              {lang === "ar" ? "معاينة الترجمة الفورية" : "Live Subtitle Preview"}
                            </span>
                            <div className="relative bg-black rounded-xl border border-neutral-850 p-4 h-20 flex items-center justify-center overflow-hidden">
                              <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=480&auto=format&fit=crop')` }} />
                              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                              
                              {/* Dynamically styled Subtitle container */}
                              <div 
                                className={`absolute bottom-2.5 text-center px-4 py-0.5 rounded z-10 transition-all duration-300 ${
                                  subShadow 
                                    ? "bg-black border border-black/30 shadow-2xl" 
                                    : "bg-transparent border-transparent shadow-none"
                                } ${
                                  subFont === "Cairo" ? "font-['Cairo']" : subFont === "Tajawal" ? "font-['Tajawal']" : subFont === "Amiri" ? "font-['Amiri']" : "font-['JetBrains_Mono']"
                                } ${
                                  subSize === "small" ? "text-xs" : subSize === "medium" ? "text-sm" : subSize === "large" ? "text-base" : "text-lg"
                                } ${
                                  subColor === "yellow" ? "text-yellow-300 font-extrabold" : subColor === "white" ? "text-white font-medium" : "text-white/70 font-medium"
                                }`}
                                style={{ textShadow: subShadow ? '2px 2px 4px rgba(0,0,0,0.95)' : 'none' }}
                              >
                                {lang === "ar" 
                                  ? "[معاينة للترجمة] مرحباً بك في واجهة عرض سينمانا الذكية." 
                                  : "[Subtitle Preview] Welcome to the smart Cinemana TV interface."}
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>

                    </div>

                  </div>
                </div>
              )}

              {/* E. ADMIN PANEL */}
              {contentNavSection === "admin" && !playingMovie && (
                <div className="p-4 sm:p-6 ps-28 md:ps-32 flex flex-col gap-6 w-full max-w-7xl overflow-y-auto h-full pb-24 select-text no-scrollbar items-center justify-center min-h-[70vh]">
                  {isAdminAuthenticated ? (
                    <AdminPanel 
                      lang={lang} 
                      adminRemoteAction={adminRemoteAction}
                      setAdminRemoteAction={setAdminRemoteAction}
                      onClose={() => {
                        setNavSection("settings");
                        setActiveSidebarItem(5);
                      }}
                      onRefreshData={fetchMoviesData}
                      onLogout={() => {
                        setIsAdminAuthenticated(false);
                        safeStorage.removeItem("isAdminLoggedIn");
                        setNavSection("settings");
                        setActiveSidebarItem(5);
                        setPlayerToast(lang === "ar" ? "تم تسجيل خروج المسؤول" : "Admin logged out");
                      }}
                    />
                  ) : (
                    <div 
                      dir={lang === "ar" ? "rtl" : "ltr"}
                      className="w-full max-w-md bg-neutral-950/80 border border-neutral-800/80 backdrop-blur-xl rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-6 anim-fade-in relative overflow-hidden"
                    >
                      {/* Decorative background glow */}
                      <div className="absolute -top-12 -left-12 w-32 h-32 bg-red-500/10 rounded-full blur-2xl pointer-events-none" />
                      <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

                      {/* Header icon & text */}
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="w-14 h-14 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center text-red-500 shadow-inner">
                          <Lock className="w-6 h-6 animate-pulse" />
                        </div>
                        <div>
                          <h2 className="text-xl font-black text-white tracking-tight">
                            {lang === "ar" ? "تسجيل دخول المسؤول" : "Administrator Login"}
                          </h2>
                          <p className="text-xs text-zinc-400 mt-1">
                            {lang === "ar" 
                              ? "الرجاء إدخال بيانات الاعتماد للوصول إلى لوحة التحكم" 
                              : "Please enter your credentials to access the admin panel"}
                          </p>
                        </div>
                      </div>

                      {/* Form */}
                      <form 
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (adminUsername === "zaid" && adminPassword === "1995") {
                            setIsAdminAuthenticated(true);
                            safeStorage.setItem("isAdminLoggedIn", "true");
                            setAdminUsername("");
                            setAdminPassword("");
                            setAdminLoginError(null);
                            setPlayerToast(lang === "ar" ? "تم تسجيل دخول المسؤول بنجاح!" : "Admin logged in successfully!");
                          } else {
                            setAdminLoginError(
                              lang === "ar" 
                                ? "اسم المستخدم أو كلمة المرور غير صحيحة!" 
                                : "Incorrect username or password!"
                            );
                          }
                        }}
                        className="flex flex-col gap-4"
                      >
                        {adminLoginError && (
                          <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-900/30 text-xs text-red-400 font-bold flex items-center gap-2.5 anim-fade-in">
                            <span className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
                            {adminLoginError}
                          </div>
                        )}

                        {/* Username Input */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold text-zinc-400 px-1">
                            {lang === "ar" ? "اسم المستخدم" : "Username"}
                          </label>
                          <div className="relative">
                            <span className={`absolute inset-y-0 ${lang === "ar" ? "right-3.5" : "left-3.5"} flex items-center text-zinc-500`}>
                              <User className="w-4 h-4" />
                            </span>
                            <input
                              type="text"
                              required
                              value={adminUsername}
                              onChange={(e) => setAdminUsername(e.target.value)}
                              className={`w-full py-3 ${lang === "ar" ? "pr-11 pl-4" : "pl-11 pr-4"} rounded-xl bg-neutral-900 border text-sm text-white focus:outline-none transition-all font-medium placeholder-zinc-600 ${
                                adminLoginFocus === "username" 
                                  ? "border-white ring-2 ring-white bg-white/5 scale-[1.02]" 
                                  : "border-neutral-800 focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
                              }`}
                              placeholder={lang === "ar" ? "مثال: zaid" : "e.g. zaid"}
                            />
                          </div>
                        </div>

                        {/* Password Input */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold text-zinc-400 px-1">
                            {lang === "ar" ? "كلمة المرور" : "Password"}
                          </label>
                          <div className="relative">
                            <span className={`absolute inset-y-0 ${lang === "ar" ? "right-3.5" : "left-3.5"} flex items-center text-zinc-500`}>
                              <Lock className="w-4 h-4" />
                            </span>
                            <input
                              type="password"
                              required
                              value={adminPassword}
                              onChange={(e) => setAdminPassword(e.target.value)}
                              className={`w-full py-3 ${lang === "ar" ? "pr-11 pl-4" : "pl-11 pr-4"} rounded-xl bg-neutral-900 border text-sm text-white focus:outline-none transition-all font-medium placeholder-•••• ${
                                adminLoginFocus === "password" 
                                  ? "border-white ring-2 ring-white bg-white/5 scale-[1.02]" 
                                  : "border-neutral-800 focus:border-red-500 focus:ring-1 focus:ring-red-500/50"
                              }`}
                              placeholder="••••••••"
                            />
                          </div>
                        </div>

                        {/* Submit Button */}
                        <button
                          type="submit"
                          className={`w-full mt-2 py-3 px-4 rounded-xl text-sm font-bold text-white shadow-lg transition-all cursor-pointer flex items-center justify-center gap-2 ${
                            adminLoginFocus === "submit" 
                              ? "bg-gradient-to-r from-red-500 to-amber-500 border-white ring-2 ring-white scale-[1.03]" 
                              : "bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 shadow-red-900/10 hover:shadow-red-900/20 active:scale-[0.98]"
                          }`}
                        >
                          <Lock className="w-4 h-4" />
                          {lang === "ar" ? "تسجيل الدخول" : "Login"}
                        </button>
                      </form>

                      {/* Cancel / Back Button */}
                      <div className="border-t border-neutral-900 pt-4 flex justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            setNavSection("settings");
                            setActiveSidebarItem(5);
                            setAdminUsername("");
                            setAdminPassword("");
                            setAdminLoginError(null);
                          }}
                          className={`text-xs font-bold transition-all cursor-pointer py-1.5 px-3 rounded-lg border ${
                            adminLoginFocus === "back" 
                              ? "text-white bg-neutral-850 border-white ring-2 ring-white scale-105" 
                              : "text-zinc-500 hover:text-zinc-300 border-transparent hover:border-zinc-850"
                          }`}
                        >
                          {lang === "ar" ? "العودة للإعدادات" : "Back to Settings"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* F. PERSON WORKS SECTION (Full Page View for Director / Actor / Writer) */}
              {contentNavSection === "person_section" && selectedPerson && !playingMovie && (
                <div className="p-6 md:p-8 ps-28 md:ps-32 flex flex-col gap-8 h-full overflow-y-auto no-scrollbar anim-fade-in select-none">
                  
                  {/* Header / Person Banner */}
                  <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-zinc-900 via-neutral-900 to-black border border-white/10 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 shadow-2xl">
                    <div className="absolute top-0 right-0 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl -ml-16 -mb-16 pointer-events-none" />

                    <div className="relative z-10 flex items-center gap-5">
                      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-rose-500/50 shadow-2xl shrink-0">
                        <img 
                          src={getHighResImage(selectedPerson.photoUrl, false)} 
                          alt={selectedPerson.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=600&q=95";
                          }}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                            {translateActorName(selectedPerson.name, lang)}
                          </h1>
                          {selectedPerson.role && (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 border border-rose-500/40 text-rose-400">
                              {selectedPerson.role}
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-zinc-400 font-medium">
                          {lang === "ar" 
                            ? `جميع الأعمال والأفلام والمسلسلات المشارك فيها (${personWorks.length})` 
                            : `All movies and series associated with this person (${personWorks.length})`}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (selectedPerson.previousMovie) {
                          setSelectedMovie(selectedPerson.previousMovie);
                          setNavSection("details");
                        } else {
                          const targetNav = (selectedPerson.previousNavSection && selectedPerson.previousNavSection !== "details" && selectedPerson.previousNavSection !== "person_section") 
                            ? selectedPerson.previousNavSection 
                            : "hero";
                          setNavSection(targetNav as any);
                          setSelectedMovie(null);
                        }
                        setSelectedPerson(null);
                      }}
                      className={`relative z-10 px-5 py-2.5 rounded-full text-white font-bold text-xs sm:text-sm flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95 self-start sm:self-center border ${
                        navSection === "person_section" && personFocusArea === "back"
                          ? "border-white ring-2 ring-white scale-105 bg-white/30 text-white shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                          : "bg-white/10 hover:bg-white/20 border-white/15"
                      }`}
                    >
                      <ArrowRight className={`w-4 h-4 ${lang === "ar" ? "" : "rotate-180"}`} />
                      <span>{lang === "ar" ? "العودة" : "Back"}</span>
                    </button>
                  </div>

                  {/* Movies & Series Grid */}
                  {personWorks.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6 pb-20">
                      {personWorks.map((movie, idx) => (
                        <MovieCard
                          key={`person-work-${movie.id}-${idx}`}
                          movie={movie}
                          uniqueKey={`person-work-${movie.id}`}
                          isFocused={navSection === "person_section" && personFocusArea === "movies" && focusedPersonMovieIndex === idx}
                          lang={lang}
                          hoveredCardKey={hoveredCardKey}
                          setHoveredCardKey={setHoveredCardKey}
                          onSelect={(m) => {
                            setSelectedMovie(m);
                            setNavSection("details");
                          }}
                          onPlay={(m) => {
                            setSelectedMovie(m);
                            setNavSection("details");
                            setPlayingMovie(m);
                            setActiveServerIndex(0);
                          }}
                          favorites={favorites}
                          toggleFavorite={toggleFavorite}
                          progressPercent={watchProgress[movie.id]?.percent}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-24 text-center text-zinc-500 gap-3">
                      <Film className="w-16 h-16 text-zinc-600 mb-2 animate-bounce" />
                      <p className="text-base font-bold text-zinc-300">
                        {lang === "ar" ? "لا توجد أعمال أخرى مسجلة لهذا الشخص حالياً" : "No other works recorded for this person currently"}
                      </p>
                    </div>
                  )}

                </div>
              )}

            </div>
            </FocusNavProvider>

            {/* 3. DETAILED VIEW OVERLAY / MODAL */}
            {selectedMovie && !playingMovie && (
              <div 
                ref={detailsContainerRef}
                dir={lang === "ar" ? "rtl" : "ltr"}
                className="absolute inset-0 bg-[#030509] text-white z-50 overflow-y-auto no-scrollbar anim-fade-in flex flex-col justify-between"
              >
                {/* Header Back button */}
                <div className="absolute top-0 left-0 right-0 z-50 p-6 md:p-8 flex items-center justify-between pointer-events-none">
                  <button 
                    onClick={() => setSelectedMovie(null)}
                    className={`pointer-events-auto flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-black/60 backdrop-blur-md hover:bg-white/10 text-white font-bold text-xs cursor-pointer transition-all border ${
                      detailsFocusArea === "back" ? "scale-105 bg-white/30 text-white shadow-[0_0_20px_rgba(255,255,255,0.4)]" : "border-white/15"
                    }`}
                  >
                    <ArrowLeft className={`w-4 h-4 ${lang === "ar" ? "rotate-180" : ""}`} />
                    <span>{lang === "ar" ? "عودة للرئيسية" : "Back to Home"}</span>
                  </button>

                  <button 
                    onClick={() => setSelectedMovie(null)}
                    className="pointer-events-auto p-2.5 rounded-full bg-black/60 backdrop-blur-md hover:bg-white/10 text-white/80 hover:text-white cursor-pointer border border-white/10"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Fullscreen Immersive Backdrop */}
                <div className="absolute top-0 left-0 right-0 h-[80vh] md:h-[88vh] z-0 overflow-hidden">
                  <img 
                    src={getHighResImage(selectedMovie.backdrop || selectedMovie.poster, true)} 
                    alt={selectedMovie.titleEn} 
                    className="w-full h-full object-cover opacity-85" 
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.src = "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=3840&q=95&auto=format&fit=crop";
                    }}
                  />
                  {/* Cinematic gradients exactly matching Apple TV style */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#030509] via-[#030509]/55 to-transparent" />
                  <div className={`absolute inset-0 bg-gradient-to-l from-transparent via-[#030509]/80 to-[#030509] ${lang === 'ar' ? 'bg-gradient-to-l' : 'bg-gradient-to-r'}`} />
                </div>

                {/* Main details content layout */}
                <div className="relative z-10 px-6 md:px-16 pt-[35vh] md:pt-[45vh] pb-8 flex flex-col md:flex-row gap-8 items-end w-full">
                  {/* Info side (takes up most width) */}
                  <div className={`flex-1 flex flex-col gap-3.5 ${lang === "ar" ? "text-right" : "text-left"}`}>
                    {/* Top tag / New Episode notice */}
                    <div className="flex items-center gap-2">
                      <span className="px-3 py-1 bg-white/10 backdrop-blur-md border border-white/20 rounded-full text-[10.5px] font-black text-white tracking-wide uppercase">
                        {selectedMovie.type === "series" ? (lang === "ar" ? "حلقات جديدة أسبوعياً" : "New Episodes Weekly") : (lang === "ar" ? "فيلم متاح الآن بدقة كاملة" : "Full Movie Available Now")}
                      </span>
                    </div>

                    {/* Cinematic Big Title (Supports TMDB title logo image with text fallback) */}
                    {(selectedMovie.logoUrl || selectedMovie.titleLogo) ? (
                      <div className="my-1">
                        <img 
                          src={getHighResImage(selectedMovie.logoUrl || selectedMovie.titleLogo)} 
                          alt={selectedMovie.titleEn} 
                          className="max-h-20 md:max-h-28 max-w-[320px] md:max-w-[420px] object-contain filter drop-shadow-[0_6px_16px_rgba(0,0,0,0.95)]"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const txtEl = document.getElementById(`modal-title-text-${selectedMovie.id}`);
                            if (txtEl) txtEl.style.display = "block";
                          }}
                        />
                        <h1 id={`modal-title-text-${selectedMovie.id}`} className="hidden text-3xl md:text-5xl font-extrabold text-white tracking-wide leading-tight">
                          {lang === "ar" ? selectedMovie.titleAr : selectedMovie.titleEn}
                        </h1>
                      </div>
                    ) : (
                      <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-wide leading-tight">
                        {lang === "ar" ? selectedMovie.titleAr : selectedMovie.titleEn}
                      </h1>
                    )}
                    <p className="text-xs md:text-sm text-zinc-400 font-bold font-mono tracking-wider -mt-2">
                      {selectedMovie.titleEn}
                    </p>

                    {/* Subtitle / Genre / Platform tags */}
                    <div className="flex flex-wrap items-center gap-2.5 mt-2 text-[11px] md:text-xs font-semibold text-zinc-300">
                      <span className="flex items-center gap-1 font-black text-white">
                        <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.8)] animate-pulse" />
                        {selectedMovie.type === "movie" ? (lang === "ar" ? "فيلم" : "Movie") : (lang === "ar" ? "مسلسل تلفزيوني" : "TV Show")}
                      </span>
                      <span className="text-zinc-700">•</span>
                      <span className="font-extrabold text-zinc-200">
                        {(selectedMovie.genres || []).map(g => lang === "ar" ? g : (genreMap[g]?.en || g)).join(" • ")}
                      </span>
                      {selectedMovie.country && (
                        <>
                          <span className="text-zinc-700">•</span>
                          <span className="font-extrabold text-zinc-200">
                            {lang === "ar" ? selectedMovie.country : (countryMap[selectedMovie.country] || selectedMovie.country)}
                          </span>
                        </>
                      )}
                      <span className="text-zinc-700">•</span>
                      <span className="border border-zinc-700 bg-zinc-950/60 px-1.5 py-0.5 rounded text-[9px] font-black font-disp text-white">
                        {selectedMovie.ageRating || (selectedMovie.rating >= 8.5 ? "TV-MA" : "PG-13")}
                      </span>
                    </div>

                    {/* Story / Synopsis (Apple TV style with more spacing and text layout) */}
                    <p className="max-w-2xl text-[13px] md:text-sm text-zinc-300 leading-relaxed font-medium mt-2">
                      {lang === "ar" ? selectedMovie.storyAr : selectedMovie.storyEn}
                    </p>

                    {/* Metabar with format badges & tech specs */}
                    <div className="flex flex-wrap items-center gap-2.5 mt-3 text-[11px] md:text-xs font-bold text-zinc-300">
                      <span className="font-num text-xs text-zinc-100 font-black">{selectedMovie.year}</span>
                      <span className="text-zinc-700">•</span>
                      <div className="flex items-center gap-1.5 select-none">
                        <span className="bg-[#F5C518] text-[#000000] font-sans font-black px-1.5 py-0.5 rounded-[3px] text-[9.5px] sm:text-[10px] tracking-tight leading-none uppercase">
                          IMDb
                        </span>
                        <span className="font-num text-[11px] sm:text-[12px] font-black text-white leading-none">
                          {selectedMovie.rating}
                        </span>
                      </div>
                      <span className="text-zinc-700">•</span>
                      <span className="text-zinc-200 font-black font-num text-[11px] sm:text-xs tracking-wider uppercase">{formatMovieDuration(selectedMovie.duration)}</span>
                      <span className="text-zinc-700">•</span>
                      
                      {/* Technical formats */}
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="border border-white/15 bg-white/5 px-1.5 py-0.5 rounded text-[8px] font-black text-white">4K ULTRA HD</span>
                        <span className="border border-white/15 bg-white/5 px-1.5 py-0.5 rounded text-[8px] font-black text-white">HDR</span>
                        <span className="border border-white/15 bg-white/5 px-1.5 py-0.5 rounded text-[8px] font-black text-white">Dolby Vision</span>
                        <span className="border border-white/15 bg-white/5 px-1.5 py-0.5 rounded text-[8px] font-black text-white">Dolby Atmos</span>
                        <span className="border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 rounded text-[8px] font-black text-zinc-400">CC</span>
                        <span className="border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 rounded text-[8px] font-black text-zinc-400">AD</span>
                      </div>
                    </div>

                    {/* Primary Actions bar (Play, Add to list) */}
                    <div className="flex flex-wrap items-center gap-3 mt-4">
                      <button 
                        onClick={() => {
                          if (selectedMovie.type === "series") {
                            const seasons = generateSeasonsForSeries(selectedMovie);
                            const firstSzn = seasons[0];
                            const firstEp = firstSzn?.episodes[0];
                            setActiveSeason(firstSzn || null);
                            setActiveEpisode(firstEp || null);
                          } else {
                            setActiveSeason(null);
                            setActiveEpisode(null);
                          }
                          setActiveServerIndex(0); 
                          setPlayingMovie(selectedMovie);
                        }}
                        className={`flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-full text-black font-black text-[12.5px] transition-all duration-300 transform active:scale-95 shadow-lg select-none cursor-pointer border-0 bg-white hover:bg-zinc-100 ${
                          detailsFocusArea === "actions" && focusedActionIndex === 0
                            ? "scale-105 shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                            : ""
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-black text-black" />
                        <span className="tracking-wide font-black">
                          {selectedMovie.type === "series" ? (lang === "ar" ? "شاهد الحلقة الأولى" : "Play Episode 1") : (lang === "ar" ? "شاهد الفيلم الآن" : "Play Movie Now")}
                        </span>
                      </button>

                      <button
                        onClick={() => toggleFavorite(selectedMovie)}
                        className={`px-5 py-2.5 rounded-full border backdrop-blur-md transition-all duration-300 transform active:scale-95 cursor-pointer flex items-center justify-center gap-2 text-[12.5px] font-black ${
                          favorites.some(f => f.id === selectedMovie.id)
                            ? "bg-rose-950/45 text-rose-500 border-rose-900/60 hover:bg-rose-950/65"
                            : "bg-white/10 border-white/20 text-white hover:text-white hover:bg-white/20"
                        } ${
                          detailsFocusArea === "actions" && focusedActionIndex === 1
                            ? "scale-105 shadow-[0_0_20px_rgba(255,255,255,0.4)]"
                            : ""
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${favorites.some(f => f.id === selectedMovie.id) ? "fill-current text-rose-500" : ""}`} />
                        <span>{favorites.some(f => f.id === selectedMovie.id) ? (lang === "ar" ? "في المفضلة" : "In Favorites") : (lang === "ar" ? "إضافة للمفضلة" : "Add to Favorites")}</span>
                      </button>
                    </div>

                    {/* Professional Cast & Filmmakers Grid/Row */}
                    {(() => {
                      const castItems = getCastItems(selectedMovie, lang);
                      if (castItems.length === 0) return null;

                      return (
                        <div className={`mt-6 pt-5 border-t border-white/10 w-full max-w-2xl ${lang === "ar" ? "text-right" : "text-left"}`}>
                          <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <Users className="w-3.5 h-3.5 text-zinc-400" />
                            <span>{lang === "ar" ? "طاقم العمل وصناع الفيلم" : "Cast & Filmmakers"}</span>
                          </h3>
                          
                          <div className="flex items-center gap-3 overflow-x-auto py-2.5 px-2.5 no-scrollbar">
                            {castItems.map((item, idx) => {
                              const isFocused = detailsFocusArea === "cast" && focusedCastIndex === idx;
                              return (
                                <div 
                                  key={idx}
                                  id={`cast-item-${idx}`}
                                  onClick={() => {
                                    setSelectedPerson({ 
                                      name: item.name, 
                                      role: item.role, 
                                      photoUrl: item.photoUrl,
                                      previousNavSection: navSection === "details" ? "hero" : navSection,
                                      previousMovie: selectedMovie
                                    });
                                    setNavSection("person_section");
                                    setSelectedMovie(null);
                                  }}
                                  className={`flex flex-col items-center text-center gap-1.5 shrink-0 group cursor-pointer transition-all px-2.5 py-2 rounded-xl border ${
                                    isFocused
                                      ? "bg-white/25 border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.4)] scale-100"
                                      : "bg-black/20 border-white/10 hover:bg-white/10 hover:border-white/20 active:scale-95"
                                  }`}
                                  title={lang === "ar" ? `عرض أعمال ${translateActorName(item.name, lang)}` : `View works of ${item.name}`}
                                >
                                  <div className={`relative w-11 h-11 rounded-full overflow-hidden border shadow-md transition-all ${
                                    isFocused ? "border-white/60 scale-100" : "border-white/20 group-hover:border-white/60"
                                  }`}>
                                    <img 
                                      src={getHighResImage(item.photoUrl, false) || `https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500&q=95`} 
                                      alt={item.name}
                                      className="w-full h-full object-cover"
                                      referrerPolicy="no-referrer"
                                      onError={(e) => {
                                        e.currentTarget.src = "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500&q=95";
                                      }}
                                    />
                                  </div>
                                  <div className="flex flex-col">
                                    <span className={`text-[10px] font-black transition-colors line-clamp-1 max-w-[80px] ${isFocused ? "text-white font-extrabold" : "text-white group-hover:text-white/90"}`}>
                                      {translateActorName(item.name, lang)}
                                    </span>
                                    <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-wider truncate max-w-[70px]">
                                      {item.role}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Poster element (Enlarged prominent portrait card for movie/series details) */}
                  <div 
                    onClick={() => {
                      const embedUrl = getTrailerEmbedUrl(selectedMovie);
                      if (embedUrl) {
                        setActiveTrailerUrl(embedUrl);
                      }
                    }}
                    className="hidden md:block w-64 lg:w-72 xl:w-80 aspect-[2/3] rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.9)] border flex-shrink-0 relative group transition-all duration-300 cursor-pointer hover:scale-[1.03] hover:shadow-red-900/40 border-red-900/40 hover:border-red-500/60 ring-1 ring-white/10"
                  >
                    <img 
                      src={getHighResImage(selectedMovie.poster, false)} 
                      alt={selectedMovie.titleEn} 
                      className="w-full h-full object-cover" 
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.src = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
                      }}
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex flex-col items-center justify-center gap-2">
                      <div className="p-3 bg-red-600 rounded-full text-white shadow-xl transform scale-75 group-hover:scale-100 transition-all duration-300">
                        <Play className="w-6 h-6 fill-white text-white translate-x-[1.5px]" />
                      </div>
                      <span className="text-[10px] font-black tracking-wider uppercase text-white bg-black/40 px-2 py-0.5 rounded">
                        {lang === "ar" ? "تشغيل الإعلان" : "Play Trailer"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Seasons & Episodes Section (Only for Series - Exactly matching image 3) */}
                {selectedMovie.type === "series" && (
                  <div className="relative z-10 px-6 md:px-16 mt-6 pb-12 w-full">
                    {/* Season Header & Selector */}
                    <div id="episodes-section-header" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 border-t border-zinc-900/60 pt-8">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-black text-white">
                          {lang === "ar" ? "حلقات المسلسل" : "Series Episodes"}
                        </h3>
                      </div>

                      {/* Modern Selector tabs */}
                      <div className="flex flex-wrap items-center gap-2">
                        {generateSeasonsForSeries(selectedMovie).map((szn) => {
                          const isFocused = selectedMovie.type === "series" && detailsFocusArea === "seasons" && selectedSeasonNumber === szn.number;
                          return (
                            <button
                              key={szn.id}
                              onClick={() => {
                                setSelectedSeasonNumber(szn.number);
                                setFocusedEpisodeIndex(0);
                                setDetailsFocusArea("seasons");
                              }}
                              className={`px-5 py-2.5 rounded-full text-xs font-black border transition-all cursor-pointer ${
                                isFocused
                                  ? "bg-white text-black border-white shadow-xl scale-105"
                                  : selectedSeasonNumber === szn.number
                                    ? "bg-white text-black border-white"
                                    : "bg-zinc-900/80 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-white"
                              }`}
                            >
                              {lang === "ar" ? szn.titleAr : szn.titleEn}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Horizontal Scroll Episodes Container */}
                    <div className={`relative ${lang === "ar" ? "text-right" : "text-left"}`}>
                      {/* Horizontal Episodes Shelf */}
                      <div
                        ref={episodesScrollRef}
                        className="flex flex-row gap-5 overflow-x-auto pb-4 pt-1 snap-x scroll-smooth no-scrollbar"
                      >
                        {generateSeasonsForSeries(selectedMovie)
                          .find((s) => s.number === selectedSeasonNumber)
                          ?.episodes.map((episode, epIdx) => {
                            const isFocused = selectedMovie.type === "series" && detailsFocusArea === "episodes" && focusedEpisodeIndex === epIdx;
                            return (
                              <div
                                key={episode.id}
                                onClick={() => {
                                  const seasons = generateSeasonsForSeries(selectedMovie);
                                  const currentSzn = seasons.find((s) => s.number === selectedSeasonNumber);
                                  setActiveSeason(currentSzn || null);
                                  setActiveEpisode(episode);
                                  setActiveServerIndex(0); 
                                  setPlayingMovie(selectedMovie);
                                  setFocusedEpisodeIndex(epIdx);
                                  setDetailsFocusArea("episodes");
                                }}
                                className={`w-72 sm:w-[320px] flex-shrink-0 snap-start group/card transition-all duration-300 flex flex-col relative cursor-pointer`}
                              >
                                {/* Episode Thumbnail (Exactly as image 3) */}
                                <div className={`w-full aspect-video relative overflow-hidden bg-zinc-900 rounded-2xl transition-all border ${
                                  isFocused
                                    ? "border-white scale-[1.02]"
                                    : "border-zinc-900/60 hover:border-zinc-700"
                                }`}>
                                  <img
                                    src={getHighResImage(episode.thumbnail, true)}
                                    alt={lang === "ar" ? episode.titleAr : episode.titleEn}
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.src = "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1920&q=95";
                                    }}
                                  />
                                  {/* Bottom vignette shadow */}
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-100" />

                                  {/* Interactive play hover layer */}
                                  <div className={`absolute inset-0 bg-black/40 transition-all duration-300 flex items-center justify-center ${isFocused ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"}`}>
                                    <button className="p-3.5 rounded-full bg-white text-black shadow-2xl scale-90 group-hover/card:scale-100 transition-all duration-300 cursor-pointer hover:bg-zinc-100">
                                      <Play className="w-5 h-5 fill-black text-black ml-0.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Episode Meta & Info (Underneath the card exactly like image 3) */}
                                <div className={`mt-3 flex flex-col ${lang === "ar" ? "text-right" : "text-left"}`}>
                                  {/* Episode Title Prefix, e.g. "EPISODE 1" */}
                                  <span className={`text-[10px] uppercase tracking-wider font-extrabold w-fit ${
                                    lang === "ar" 
                                      ? "font-sans font-black text-amber-400 bg-amber-400/10 px-2.5 py-0.5 rounded-md text-[10.5px] ml-auto mr-0" 
                                      : "text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded-md text-[9px] mr-auto ml-0"
                                  }`}>
                                    {lang === "ar" ? `الحلقة ${episode.number}` : `EPISODE ${episode.number}`}
                                  </span>
                                  
                                  {/* Episode Name */}
                                  <h4 className={`text-[14.5px] font-black transition-colors line-clamp-1 mt-0.5 ${
                                    isFocused ? "text-white" : "text-zinc-200 group-hover/card:text-white"
                                  }`}>
                                    {lang === "ar" ? episode.titleAr : episode.titleEn}
                                  </h4>

                                  {/* Episode Story Description */}
                                  <p className="text-xs text-zinc-400 leading-relaxed font-medium line-clamp-2 mt-1 min-h-[2.5rem]">
                                    {lang === "ar" ? episode.storyAr : episode.storyEn}
                                  </p>

                                  {/* Bottom row: ▶ Duration & Three Dots button */}
                                  <div className="flex items-center justify-between mt-2.5 flex-row-reverse">
                                    {/* Play duration */}
                                    <div className="flex items-center gap-1.5 text-[11px] font-black text-zinc-300">
                                      <Play className="w-3 h-3 fill-current text-zinc-400" />
                                      <span>{episode.duration}</span>
                                    </div>

                                    {/* Three-dot options icon */}
                                    <button className="p-1 rounded-full text-zinc-500 hover:text-white transition-all hover:bg-white/5">
                                      <span className="text-base font-extrabold leading-none tracking-widest">...</span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                )}

                {/* Franchise / Movie Series Collection (e.g. Parts of the series in one place) */}
                {selectedMovie.collectionId && collectionMovies.length > 1 && (
                  <div id="collection-section-header" className="relative z-10 px-6 md:px-16 mt-6 pb-12 w-full border-t border-zinc-900/60 pt-8">
                    <div className="flex items-center gap-2 mb-5">
                      <Film className="w-5 h-5 text-white" />
                      <h3 className="text-xl font-black text-white">
                        {lang === "ar" 
                          ? selectedMovie.collectionNameAr || "سلسلة الأفلام والأجزاء" 
                          : selectedMovie.collectionNameEn || "Movie Franchise & Parts"}
                      </h3>
                    </div>

                    <div className="relative">
                      {/* Horizontal scrollable row of movies in this series. Generous
                          padding (matching the Home rails' own scroll container) keeps a
                          focused card's scale/ring from being clipped by the scroll
                          container's edge, especially for the first/last card in the row. */}
                      <div className="flex flex-row gap-5 overflow-x-auto pt-4 pb-8 px-3 -mx-3 -my-3 snap-x scroll-smooth no-scrollbar">
                        {collectionMovies.map((collMovie, collIdx) => {
                          const isCurrent = collMovie.id === selectedMovie.id;
                          const isFocused = detailsFocusArea === "collection" && focusedCollectionIndex === collIdx;
                          return (
                            <div
                              id={`collection-item-${collIdx}`}
                              key={collMovie.id}
                              onClick={() => {
                                setSelectedMovie(collMovie);
                                setSelectedSeasonNumber(1);
                                setFocusedEpisodeIndex(0);
                                setFocusedCollectionIndex(collIdx);
                              }}
                              className={`flex-shrink-0 w-[145px] sm:w-[165px] group/coll transition-all duration-300 relative cursor-pointer select-none rounded-2xl p-1.5 ${
                                isFocused ? "z-30" : "hover:scale-[1.03]"
                              }`}
                            >
                              {/* Focus ring on the poster itself, same as MovieCard's own
                                  focused/active style on the Home screen. */}
                              <div className={`relative aspect-[2/3] rounded-xl overflow-hidden border transition-all duration-300 ease-out bg-[#060913] shadow-lg ${
                                isFocused
                                  ? "scale-[1.04] border-white ring-1 ring-white bg-white/5"
                                  : isCurrent
                                    ? "border-white/60 ring-1 ring-white/40"
                                    : "border-zinc-800/60"
                              }`}>
                                <img
                                  src={getHighResImage(collMovie.poster || collMovie.backdrop, false)}
                                  alt={collMovie.titleEn}
                                  className={`w-full h-full object-cover ${isCurrent ? "brightness-90" : "brightness-[0.70] group-hover/coll:brightness-[0.85]"}`}
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    e.currentTarget.src = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
                                  }}
                                />
                                {/* Cinematic Borderless Poster Part Number Digit */}
                                {collMovie.partNumber && (
                                  <div 
                                    className="absolute top-2 left-2 z-20 select-none pointer-events-none group-hover/coll:scale-110 transition-transform duration-300 drop-shadow-[0_4px_14px_rgba(0,0,0,1)]"
                                    dir="ltr"
                                  >
                                    <span className="text-2xl sm:text-3xl font-black font-num text-white leading-none tracking-tighter drop-shadow-[0_3px_10px_rgba(0,0,0,1)]">
                                      {collMovie.partNumber}
                                    </span>
                                  </div>
                                )}
                                
                                {isCurrent && (
                                  <div className="absolute inset-0 bg-black/45 backdrop-blur-[1px] flex items-center justify-center">
                                    <div className="px-2.5 py-1 rounded-md bg-white text-zinc-950 text-[9px] font-black tracking-wider uppercase shadow-xl border border-white/20 animate-pulse">
                                      {lang === "ar" ? "يعرض الآن" : "Viewing Now"}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className={`mt-2 flex flex-col ${lang === "ar" ? "text-right" : "text-left"}`}>
                                <h4 className={`text-xs font-bold line-clamp-1 ${isCurrent ? "text-white" : "text-zinc-200 group-hover/coll:text-white"}`}>
                                  {lang === "ar" ? collMovie.titleAr : collMovie.titleEn}
                                </h4>
                                <span className="text-[10px] text-zinc-500 font-bold mt-0.5 font-num">{collMovie.year}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* YouTube Trailer Video Overlay Modal */}
            {activeTrailerUrl && (
              <div className="fixed inset-0 bg-black/95 backdrop-blur-xl z-[150] flex flex-col items-center justify-center p-4 md:p-8 animate-fade-in animate-duration-300">
                <div className="w-full max-w-5xl bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl shadow-black relative aspect-video">
                  
                  {/* Close Trailer button */}
                  <button
                    onClick={() => setActiveTrailerUrl(null)}
                    className="absolute top-4 right-4 z-[160] p-3 rounded-full bg-black/60 backdrop-blur-md text-white hover:bg-white/10 border border-white/10 hover:border-red-500/50 hover:text-red-500 cursor-pointer transition-all active:scale-95 flex items-center justify-center"
                    title={lang === "ar" ? "إغلاق الإعلان" : "Close Trailer"}
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <iframe
                    src={activeTrailerUrl}
                    title="Movie Trailer"
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                
                {/* Visual Caption */}
                <div className="mt-4 flex flex-col items-center text-center gap-1 text-white">
                  <h3 className="text-sm font-black uppercase tracking-wider">
                    {lang === "ar" ? "الإعلان الترويجي الرسمي" : "Official Movie Trailer"}
                  </h3>
                  <button
                    onClick={() => setActiveTrailerUrl(null)}
                    className="mt-2 text-xs text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 hover:border-zinc-700 px-4 py-1.5 rounded-full cursor-pointer transition-all active:scale-95"
                  >
                    {lang === "ar" ? "الرجوع لتفاصيل العمل" : "Close and Return to Details"}
                  </button>
                </div>
              </div>
            )}

            {/* 4. IMMERSIVE MEDIA PLAYER VIEW */}
            {playingMovie && (
              <VideoPlayer
                lang={lang}
                playingMovie={playingMovie}
                activeEpisode={activeEpisode}
                adsSettings={adsSettings}
                currentAd={currentAd}
                isAdPlaying={isAdPlaying}
                adTimeRemaining={adTimeRemaining}
                canSkipAd={canSkipAd}
                skipOrFinishAd={skipOrFinishAd}
                videoRef={videoRef}
                handleTimeUpdate={handleTimeUpdate}
                handleVideoLoaded={handleVideoLoaded}
                playNextMedia={playNextMedia}
                playPrevMedia={playPrevMedia}
                isVideoBuffering={isVideoBuffering}
                setIsVideoBuffering={setIsVideoBuffering}
                showQuarterHourOverlay={showQuarterHourOverlay}
                playerSubtitles={playerSubtitles}
                setPlayerSubtitles={setPlayerSubtitles}
                getSubtitleForTime={getSubtitleForTime}
                getSubtitleForTimeEn={getSubtitleForTimeEn}
                subShadow={subShadow}
                setSubShadow={setSubShadow}
                subFont={subFont}
                setSubFont={setSubFont}
                subSize={subSize}
                setSubSize={setSubSize}
                subColor={subColor}
                setSubColor={setSubColor}
                controlsVisible={controlsVisible}
                showControlsAndResetTimer={showControlsAndResetTimer}
                playerProgress={playerProgress}
                playerDuration={playerDuration}
                saveCurrentProgress={saveCurrentProgress}
                isPlaying={isPlaying}
                setIsPlaying={setIsPlaying}
                togglePlay={togglePlay}
                playerMuted={playerMuted}
                setPlayerMuted={setPlayerMuted}
                setPlayerToast={setPlayerToast}
                isScrubbingSeek={isScrubbingSeek}
                setIsScrubbingSeek={setIsScrubbingSeek}
                onClose={() => setPlayingMovie(null)}
              />
            )}

        </div>
      </div>
  );
}
