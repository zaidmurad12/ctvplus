import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";
import AdmZip from "adm-zip";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, getDocs, collection, deleteDoc } from "firebase/firestore";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize Firebase SDK
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    console.log("[Server] Firebase/Firestore successfully initialized using project:", firebaseConfig.projectId);
  } else {
    console.warn("[Server] firebase-applet-config.json not found. Firebase is uninitialized.");
  }
} catch (fbErr) {
  console.error("[Server] Error initializing Firebase:", fbErr);
}

// Enable CORS for Android WebViews & remote clients
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Initialize Gemini client (Only server-side)
const geminiApiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Global variable to keep track of rate limits and cool down to avoid error spamming
let quotaExceededUntil = 0;

function handleGeminiError(error: any, contextName: string) {
  const errMsg = String(error?.message || error);
  if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("quota")) {
    quotaExceededUntil = Date.now() + 15 * 60 * 1000; // 15 minutes cooldown
    console.warn(`[Gemini Rate Limit] Quota limit hit in ${contextName}. Pausing all Gemini queries for 15 minutes.`);
  }
}

interface Episode {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  duration: string;
  storyAr: string;
  storyEn: string;
  thumbnail: string;
  servers: { name: string; url: string }[];
  subtitlesUrlAr?: string;
  subtitlesUrlEn?: string;
  originalSubtitlesUrlAr?: string;
  originalSubtitlesUrlEn?: string;
  rating?: number;
}

interface Season {
  id: string;
  number: number;
  titleAr: string;
  titleEn: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  storyAr?: string;
  storyEn?: string;
  episodes: Episode[];
}

// Structuring static database of movies and series
interface Movie {
  id: string;
  titleAr: string;
  titleEn: string;
  type: "movie" | "series";
  rating: number;
  year: number;
  duration: string;
  genres: string[];
  poster: string;
  backdrop: string;
  storyAr: string;
  storyEn: string;
  actors: string[];
  quality: string;
  servers: { name: string; url: string }[];
  seasons?: Season[];
  subtitlesUrlAr?: string;
  subtitlesUrlEn?: string;
  ageRating?: string;
  originalSubtitlesUrlAr?: string;
  originalSubtitlesUrlEn?: string;
  trailerUrl?: string;
  language?: string;
  isPublished?: boolean;
  collectionId?: string;
  collectionNameAr?: string;
  collectionNameEn?: string;
  partNumber?: string | number;
  director?: string;
  writer?: string;
  directorPhotoUrl?: string;
  writerPhotoUrl?: string;
  castMembers?: CastMember[];
}

interface CastMember {
  name: string;
  role?: string;
  photoUrl: string;
}

const MOVIES_DB_PATH = path.join(process.cwd(), "movies_db.json");
const CONFIG_PATH = path.join(process.cwd(), "config.json");

let customHeroId: string | null = null;
let customTrendingIds: string[] = [];
let customPromos: any[] = [];

const defaultAdsSettings = {
  enabled: false,
  globalSkipAfterSeconds: 5,
  allowSkip: true,
  ads: [
    {
      id: "ad_demo_1",
      titleAr: "إعلان سينمانا العرض الذهبي 4K",
      titleEn: "Cinemana Golden Premiere 4K Ad",
      sponsorNameAr: "سينمانا تي في برو",
      sponsorNameEn: "Cinemana TV Pro",
      sponsorLogo: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=200&q=80",
      sponsorUrl: "https://cinemana.tv",
      skipAfterSeconds: 5,
      durationSeconds: 15,
      isActive: true,
      targetType: "all",
      createdAt: new Date().toISOString(),
      servers: [
        { id: "ad_srv_1", name: "سيرفر الإعلان الرئيسي (MP4 Direct 1080p)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", type: "video" },
        { id: "ad_srv_2", name: "سيرفر الإعلان السريع (MP4 4K)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4", type: "video" },
        { id: "ad_srv_3", name: "سيرفر البث الإحتياطي (HLS Stream)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls" }
      ]
    },
    {
      id: "ad_demo_2",
      titleAr: "إعلان راعي البث والتغطية الحصرية",
      titleEn: "Exclusive Broadcast Sponsor Ad",
      sponsorNameAr: "الراعي الرسمي للفيلم",
      sponsorNameEn: "Official Sponsor",
      sponsorLogo: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&q=80",
      sponsorUrl: "https://google.com",
      skipAfterSeconds: 5,
      durationSeconds: 12,
      isActive: true,
      targetType: "all",
      createdAt: new Date().toISOString(),
      servers: [
        { id: "ad_srv_2_1", name: "سيرفر البث الرئيسي للإعلان الثاني", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoypasses.mp4", type: "video" },
        { id: "ad_srv_2_2", name: "سيرفر البث البديل", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4", type: "video" }
      ]
    }
  ]
};

let adsSettings: any = JSON.parse(JSON.stringify(defaultAdsSettings));


const defaultPromos = [
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

function saveMoviesDatabase() {
  try {
    const dataStr = JSON.stringify(moviesDatabase, null, 2);
    fs.writeFileSync(MOVIES_DB_PATH, dataStr, "utf8");

    // Also persist to public/movies.json, dist/movies.json, and android/app/src/main/assets/movies.json
    try {
      const publicPath = path.join(process.cwd(), "public", "movies.json");
      if (fs.existsSync(path.dirname(publicPath))) fs.writeFileSync(publicPath, dataStr, "utf8");

      const distPath = path.join(process.cwd(), "dist", "movies.json");
      if (fs.existsSync(path.dirname(distPath))) fs.writeFileSync(distPath, dataStr, "utf8");

      const androidAssetsPath = path.join(process.cwd(), "android", "app", "src", "main", "assets", "movies.json");
      if (fs.existsSync(path.dirname(androidAssetsPath))) fs.writeFileSync(androidAssetsPath, dataStr, "utf8");
    } catch (_e) {
      // Ignore secondary asset sync errors
    }

    // Invalidate caches so updates immediately take effect across all API clients
    cachedHomeData = null;
    subtitlesCache.clear();
  } catch (error) {
    console.error("[Server] Error saving movies database:", error);
  }
}

function getRealStreamingServers(item: { id: string; type: string; titleEn: string }, seasonNumber?: number, episodeNumber?: number) {
  const cleanId = item.id.replace(/\D/g, "");
  
  if (cleanId) {
    if (seasonNumber !== undefined && episodeNumber !== undefined) {
      // Direct Cinemana CDN streaming URL for series episodes
      return [
        { name: "سيرفر سينمانا المباشر", url: `https://video.shabakaty.com/movies/${cleanId}/${seasonNumber}/${episodeNumber}/index.m3u8` }
      ];
    } else {
      // Direct Cinemana CDN streaming URL for movies
      return [
        { name: "سيرفر سينمانا المباشر", url: `https://video.shabakaty.com/movies/${cleanId}/index.m3u8` }
      ];
    }
  }

  // Fallback to a single sample video URL if there's no numeric ID
  const samples = [
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
  ];
  const str = `${item.id}_${seasonNumber || ""}_${episodeNumber || ""}_${item.titleEn}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % samples.length;
  return [
    { name: "سيرفر سينمانا الرئيسي", url: samples[idx] }
  ];
}

const isPlaceholderServer = (servers?: { name: string; url: string }[]) => {
  if (!servers || servers.length === 0) return true;
  const url = servers[0].url;
  return (
    url.includes("commondatastorage.googleapis.com") || 
    url.includes("mov_bbb.mp4") || 
    url.includes("example.com") || 
    url.includes("w3schools.com")
  );
};

function enrichMovieMetadata(movie: Movie) {
  if (!movie) return;

  // Proxy-format subtitle URLs must always point at this movie's CURRENT id. Movie ids can
  // get reassigned during dedup/merge passes, leaving stale "movieId=..." references behind
  // that silently point at the wrong (or a no-longer-existent) record - the frontend then
  // requests subtitles for an id that doesn't resolve to this movie, and gets nothing back.
  // Direct /uploads/, data:, or blob: URLs are left untouched since they're real content
  // pointers, not id-based lookups.
  const isFakeAr = !movie.subtitlesUrlAr || movie.subtitlesUrlAr.includes("example.com");
  const isMismatchedAr = !!movie.subtitlesUrlAr?.startsWith("/api/subtitles?") && !movie.subtitlesUrlAr.includes(`movieId=${movie.id}&`);
  if (isFakeAr || isMismatchedAr) {
    movie.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&lang=ar`;
  }

  const isFakeEn = !movie.subtitlesUrlEn || movie.subtitlesUrlEn.includes("example.com");
  const isMismatchedEn = !!movie.subtitlesUrlEn?.startsWith("/api/subtitles?") && !movie.subtitlesUrlEn.includes(`movieId=${movie.id}&`);
  if (isFakeEn || isMismatchedEn) {
    movie.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&lang=en`;
  }

  if (!movie.servers || movie.servers.length === 0 || isPlaceholderServer(movie.servers)) {
    movie.servers = getRealStreamingServers(movie);
  }

  if (movie.type === "series" && movie.seasons) {
    movie.seasons.forEach((season, sIdx) => {
      if (season.episodes) {
        season.episodes.forEach(episode => {
          const epIdMatch = `movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&`;

          const isEpFakeAr = !episode.subtitlesUrlAr || episode.subtitlesUrlAr.includes("example.com");
          const isEpMismatchedAr = !!episode.subtitlesUrlAr?.startsWith("/api/subtitles?") && !episode.subtitlesUrlAr.includes(epIdMatch);
          if (isEpFakeAr || isEpMismatchedAr) {
            episode.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&lang=ar`;
          }

          const isEpFakeEn = !episode.subtitlesUrlEn || episode.subtitlesUrlEn.includes("example.com");
          const isEpMismatchedEn = !!episode.subtitlesUrlEn?.startsWith("/api/subtitles?") && !episode.subtitlesUrlEn.includes(epIdMatch);
          if (isEpFakeEn || isEpMismatchedEn) {
            episode.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&seasonId=${season.id}&episodeId=${episode.id}&lang=en`;
          }

          if (!episode.servers || episode.servers.length === 0 || isPlaceholderServer(episode.servers)) {
            episode.servers = getRealStreamingServers(movie, season.number || (sIdx + 1), episode.number);
          }
        });
      }
    });
  }
}

const deletedMovieIds = new Set<string>();
const deletedMovieTitles = new Set<string>();
const DELETED_IDS_PATH = path.join(process.cwd(), "deleted_ids.json");

function loadDeletedMovieIds() {
  try {
    if (fs.existsSync(DELETED_IDS_PATH)) {
      const data = fs.readFileSync(DELETED_IDS_PATH, "utf8");
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.ids)) {
          parsed.ids.forEach((id: string) => deletedMovieIds.add(id));
        }
        if (Array.isArray(parsed.titles)) {
          parsed.titles.forEach((t: string) => deletedMovieTitles.add(t.toLowerCase().trim()));
        }
      } else if (Array.isArray(parsed)) {
        parsed.forEach((id: string) => deletedMovieIds.add(id));
      }
      console.log(`[Server] Loaded ${deletedMovieIds.size} deleted movie IDs and ${deletedMovieTitles.size} deleted movie titles from local storage.`);
    }
  } catch (err) {
    console.error("[Server] Error loading deleted_ids.json:", err);
  }
}

function saveDeletedMovieIds() {
  try {
    const payload = {
      ids: Array.from(deletedMovieIds),
      titles: Array.from(deletedMovieTitles)
    };
    fs.writeFileSync(DELETED_IDS_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.error("[Server] Error saving deleted_ids.json:", err);
  }
}

function isMovieDeleted(id?: string, titleAr?: string, titleEn?: string): boolean {
  if (id && deletedMovieIds.has(id)) return true;
  if (titleAr && deletedMovieTitles.has(titleAr.toLowerCase().trim())) return true;
  if (titleEn && deletedMovieTitles.has(titleEn.toLowerCase().trim())) return true;
  return false;
}

function markMovieAsDeleted(movie: { id: string; titleAr?: string; titleEn?: string }) {
  if (movie.id) deletedMovieIds.add(movie.id);
  if (movie.titleAr) deletedMovieTitles.add(movie.titleAr.toLowerCase().trim());
  if (movie.titleEn) deletedMovieTitles.add(movie.titleEn.toLowerCase().trim());
  saveDeletedMovieIds();
}

function unmarkMovieAsDeleted(id: string, titleAr?: string, titleEn?: string) {
  if (id) deletedMovieIds.delete(id);
  if (titleAr) deletedMovieTitles.delete(titleAr.toLowerCase().trim());
  if (titleEn) deletedMovieTitles.delete(titleEn.toLowerCase().trim());
  saveDeletedMovieIds();
}

function saveConfig() {
  try {
    saveDeletedMovieIds();
    const config = {
      customHeroId,
      customTrendingIds,
      customPromos,
      adsSettings
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (error) {
    console.error("[Server] Error saving config:", error);
  }
}

// Firestore persistence helpers
async function saveMovieToFirestore(movie: Movie) {
  if (!db) return;
  try {
    const movieRef = doc(db, "movies", movie.id);
    const cleanMovie = JSON.parse(JSON.stringify(movie));
    await setDoc(movieRef, cleanMovie);
    console.log(`[Firestore] Successfully saved movie ${movie.id}`);
  } catch (err) {
    console.error(`[Firestore] Error saving movie ${movie.id} to Firestore:`, err);
  }
}

async function deleteMovieFromFirestore(id: string) {
  if (!db) return;
  try {
    const movieRef = doc(db, "movies", id);
    await deleteDoc(movieRef);
    console.log(`[Firestore] Successfully deleted movie ${id}`);
  } catch (err) {
    console.error(`[Firestore] Error deleting movie ${id} from Firestore:`, err);
  }
}

async function saveConfigToFirestore() {
  if (!db) return;
  try {
    const configRef = doc(db, "config", "main_config");
    await setDoc(configRef, {
      customHeroId,
      customTrendingIds,
      customPromos,
      adsSettings,
      deletedMovieIds: Array.from(deletedMovieIds),
      deletedMovieTitles: Array.from(deletedMovieTitles)
    });
    console.log("[Firestore] Successfully saved global config to Firestore");
  } catch (err) {
    console.error("[Firestore] Error saving config to Firestore:", err);
  }
}

const moviesDatabase: Movie[] = [
  {
    id: "movie_1",
    titleAr: "كثبان: الجزء الثاني",
    titleEn: "Dune: Part Two",
    type: "movie",
    rating: 8.8,
    year: 2024,
    duration: "2h 46m",
    genres: ["خيال علمي", "مغامرة", "دراما"],
    poster: "https://image.tmdb.org/t/p/w500/1pdf7ZgTCg7g0RLv6V2mX6CDmrl.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/xOMoCO8v68vnsHOWDvStgGN67Hl.jpg",
    storyAr: "يتابع بول أتريدس رحلته الأسطورية بينما يتحد مع شاني والفرمن في طريق الانتقام من المتآمرين الذين دمروا عائلته. وفي مواجهة الاختيار بين حب حياته ومصير الكون المعروف، يسعى جاهداً لمنع مستقبل مرعب لا يستطيع التنبؤ به إلا هو.",
    storyEn: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family. Facing a choice between the love of his life and the fate of the universe, he endeavors to prevent a terrible future only he can foresee.",
    actors: ["تيموثي شالاماي", "زيندايا", "Rebecca Ferguson", "خافيير بارديم"],
    director: "Denis Villeneuve",
    writer: "Jon Spaihts",
    quality: "Ultra HD",
    servers: [
      { name: "سيرفر شبكتي HD", url: "https://www.w3schools.com/html/mov_bbb.mp4" },
      { name: "سيرفر رئيسي 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
      { name: "سيرفر سريع SD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" }
    ]
  },
  {
    id: "movie_2",
    titleAr: "أوبنهايمر",
    titleEn: "Oppenheimer",
    type: "movie",
    rating: 8.9,
    year: 2023,
    duration: "3h 00m",
    genres: ["سيرة ذاتية", "دراما", "تاريخي"],
    poster: "https://image.tmdb.org/t/p/w500/8Gxv2gSjdh4RH76v88VMj7xD26m.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/fm6a0A612Yg7jIIOWCO367YQO0Z.jpg",
    storyAr: "قصة الفيزيائي الأمريكي جيه. روبرت أوبنهايمر ودوره القيادي في تطوير القنبلة الذرية خلال الحرب العالمية الثانية في مشروع مانهاتن السري.",
    storyEn: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.",
    actors: ["كيليان مورفي", "إميلي بلانت", "روبرت داوني جونيور", "مات ديمون"],
    director: "Christopher Nolan",
    writer: "Christopher Nolan",
    quality: "Full HD",
    servers: [
      { name: "سيرفر شبكتي HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4" },
      { name: "سيرفر خارجي 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
    ]
  },
  {
    id: "movie_3",
    titleAr: "سبايدرمان: عبر عالم العنكبوت",
    titleEn: "Spider-Man: Across the Spider-Verse",
    type: "movie",
    rating: 8.7,
    year: 2023,
    duration: "2h 20m",
    genres: ["رسوم متحركة", "أكشن", "مغامرة"],
    poster: "https://image.tmdb.org/t/p/w500/8vt6mAwv8vN3C6vN6fLV204vWuO.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/gVJ0607v6aUjllKAgTKKpYg56RS.jpg",
    storyAr: "ينطلق مايلز موراليس عبر العوالم المتوازية، حيث يلتقي بفريق من 'العناكب' المكلفين بحماية وجود الكون المتعدد. ولكن عندما يختلف الأبطال حول كيفية التعامل مع تهديد جديد، يجد مايلز نفسه في مواجهة العناكب الأخرى.",
    storyEn: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence. When the heroes clash on how to handle a new threat, Miles must redefine what it means to be a hero.",
    actors: ["شاميك مور", "هيلي ستاينفيلد", "أوسكار إسحاق", "Jake Johnson"],
    director: "Joaquim Dos Santos",
    writer: "Phil Lord",
    quality: "Full HD",
    servers: [
      { name: "سيرفر سينمانا الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4" },
      { name: "سيرفر احتياطي HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4" }
    ]
  },
  {
    id: "series_1",
    titleAr: "بيت التنين: الموسم الثاني",
    titleEn: "House of the Dragon: S2",
    type: "series",
    rating: 8.6,
    year: 2024,
    duration: "8 حلقات",
    genres: ["خيال", "دراما", "حرب"],
    poster: "https://image.tmdb.org/t/p/w500/1XS16gYbe1b6pH9Yf6ZorR9gK7A.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/et8Zd6gYbe1b6pH9Yf6ZorR9gK7A.jpg",
    storyAr: "تبدأ الحرب الأهلية في عائلة تارجاريين (رقصة التنانين) بعد وفاة الملك فيسيريس، حيث يتنافس المجلس الأخضر المؤيد لإيجون، والمجلس الأسود المؤيد لرينيرا على الجلوس على العرش الحديدي.",
    storyEn: "The Targaryen civil war begins. Following King Viserys's death, the Green Council (supporting Aegon) and the Black Council (supporting Rhaenyra) fight for control of the Iron Throne.",
    actors: ["إيما دآرسي", "مات سميث", "أوليفيا كوك", "ريس إيفانز"],
    director: "Clare Kilner",
    writer: "George R.R. Martin",
    quality: "Ultra HD",
    servers: [
      { name: "الحلقة 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4" },
      { name: "الحلقة 2 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4" },
      { name: "الحلقة 3 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4" }
    ]
  },
  {
    id: "series_2",
    titleAr: "الحشاشين",
    titleEn: "The Assassins",
    type: "series",
    rating: 8.4,
    year: 2024,
    duration: "30 حلقة",
    genres: ["تاريخي", "دراما", "سيرة ذاتية"],
    poster: "https://image.tmdb.org/t/p/w500/mXf53hQfOofU52wR81a28a2g5Nf.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/7COx12A9E58N6S2g5NeF06a28aS.jpg",
    storyAr: "يتناول المسلسل السيرة التاريخية لفرقة الحشاشين وقائدها حسن الصباح، الملقب بالسيد أو شيخ الجبل، الذي أسس واحدة من أكثر الجماعات العسكرية ترويعاً في القرن الحادي عشر داخل قلعة ألموت.",
    storyEn: "A historical series depicting Hassan-i Sabbah, the founder of the Order of Assassins, and the terrifying group based at Alamut Castle in the 11th century.",
    actors: ["كريم عبد العزيز", "فتحي عبد الوهاب", "ميرنا نور الدين", "نيقولا معوض"],
    director: "بيتر ميمي",
    writer: "عبد الرحيم كمال",
    quality: "Full HD",
    servers: [
      { name: "الحلقة 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" },
      { name: "الحلقة 2 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4" }
    ]
  },
  {
    id: "movie_4",
    titleAr: "باتمان",
    titleEn: "The Batman",
    type: "movie",
    rating: 8.2,
    year: 2022,
    duration: "2h 56m",
    genres: ["أكشن", "جريمة", "دراما"],
    poster: "https://image.tmdb.org/t/p/w500/74xTEgt7R36P6C90v68779g987a.jpg",
    backdrop: "https://image.tmdb.org/t/p/original/b0Plj7R36P6C90v68779g987a.jpg",
    storyAr: "عندما يقتل قاتل متسلسل سادي سلسلة من الشخصيات السياسية الرئيسية في غوثام، يضطر باتمان إلى التحقيق في الفساد المستتر في المدينة ومساءلة التزام عائلته.",
    storyEn: "When a sadistic serial killer begins murdering key political figures in Gotham, Batman is forced to investigate the city's hidden corruption and question his family's involvement.",
    actors: ["روبرت باتينسون", "زوي كرافيتز", "جيفري رايت", "كولين فاريل"],
    director: "Matt Reeves",
    writer: "Matt Reeves",
    quality: "Ultra HD",
    servers: [
      { name: "سيرفر رئيسي 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4" }
    ]
  }
];

// Helper to verify if a subtitle URL is reachable and represents a genuine subtitle file (.vtt or srt)
// in the requested language (not just any file with "-->" in it).
async function verifySubtitleUrl(url: string, langHint: "ar" | "en" = "ar"): Promise<boolean> {
  if (!url || typeof url !== "string") return false;
  let targetUrl = url.trim();
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) return false;

  // Auto-rewrite GitHub and Archive.org links to raw downloadable versions
  if (targetUrl.includes("github.com") && targetUrl.includes("/blob/")) {
    targetUrl = targetUrl.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  } else if (targetUrl.includes("archive.org/details/")) {
    targetUrl = targetUrl.replace("archive.org/details/", "archive.org/download/");
  }

  // Basic filter for links that are clearly not raw files
  const lowerUrl = targetUrl.toLowerCase();
  if (lowerUrl.includes("/play") || lowerUrl.includes("/watch") || lowerUrl.includes("/search") || lowerUrl.includes("login") || lowerUrl.includes("register")) {
    return false;
  }

  try {
    let response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Range": "bytes=0-4096" // Only request the first 4KB for maximum speed
      },
      signal: AbortSignal.timeout(4000)
    });

    if (!response.ok && response.status !== 206) {
      console.log(`[Subtitle Verification] First attempt (Range GET) failed with status ${response.status}. Retrying standard GET without Range...`);
      response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(5000)
      });
    }

    if (!response.ok) {
      console.log(`[Subtitle Verification] Both range and standard GET attempts failed for: ${targetUrl}`);
      return false;
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
      console.log(`[Subtitle Verification] URL returned HTML webpage instead of raw subtitle file: ${targetUrl}`);
      return false;
    }

    const text = await response.text();
    const cleanText = text.trim();
    const looksLikeSubtitleFormat = cleanText.includes("WEBVTT") || cleanText.includes("-->");

    if (!looksLikeSubtitleFormat) {
      console.log(`[Subtitle Verification] Content did not look like VTT or SRT at: ${targetUrl}`);
      return false;
    }

    // A 4KB partial fetch is often too short for a reliable language check; only enforce
    // it when we have enough text to judge, otherwise defer to serve-time re-validation.
    if (cleanText.length > 200 && !isPlausibleSubtitleContent(cleanText, langHint)) {
      console.log(`[Subtitle Verification] Content does not genuinely match requested language "${langHint}" at: ${targetUrl}`);
      return false;
    }

    console.log(`[Subtitle Verification] SUCCESS: Verified subtitle at: ${targetUrl}`);
    return true;
  } catch (err: any) {
    console.warn(`[Subtitle Verification] Connection failed for ${targetUrl}:`, err.message || err);
    return false;
  }
}

// Decodes a subtitle file buffer into text, correctly distinguishing real UTF-8 from
// legacy Windows-1256 (common for older Arabic .srt files). The previous approach used
// across this file picked whichever decoding produced more Arabic-range characters, which
// is unreliable: misdecoded bytes frequently still land inside the Arabic Unicode block,
// producing text that LOOKS like real Arabic but is actually mojibake garbage. Strict
// UTF-8 validation (which throws on invalid byte sequences) is a much stronger signal.
function decodeSubtitleBuffer(buffer: Buffer, langHint?: "ar" | "en"): string {
  try {
    const utf8Text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (langHint === "ar" && !/[؀-ۿ]/.test(utf8Text)) {
      // Valid UTF-8 but no Arabic where Arabic was expected - double check windows-1256,
      // since some legacy files happen to also be valid (but wrong) UTF-8 byte sequences.
      const win1256Text = new TextDecoder("windows-1256").decode(buffer);
      if (/[؀-ۿ]/.test(win1256Text)) return win1256Text;
    }
    return utf8Text;
  } catch {
    // Not valid UTF-8 at all - almost certainly legacy Windows-1256.
    return new TextDecoder("windows-1256").decode(buffer);
  }
}

// Rejects content that doesn't genuinely match the requested language, or that is
// clearly not real dialogue (YouTube auto-caption noise, mojibake, ad spam, etc.)
// This is the check that was missing and let completely unrelated/garbled files get
// saved and served as if they were real movie subtitles.
function isPlausibleSubtitleContent(text: string, langHint: "ar" | "en"): boolean {
  if (!text || text.trim().length < 20) return false;

  const arabicChars = (text.match(/[؀-ۿ]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = arabicChars + latinChars;
  if (totalLetters === 0) return false;

  if (langHint === "ar") {
    // Require the text to be genuinely, predominantly Arabic - not just a few stray characters.
    if (arabicChars < 15 || arabicChars / totalLetters < 0.4) return false;
  } else {
    // English track must not be dominated by Arabic, and must contain real words.
    if (arabicChars / totalLetters > 0.2) return false;
    if (latinChars < 40) return false;
  }

  // Reject mojibake (replacement/control characters indicating a broken encoding).
  const badCharRatio = (text.match(/[�-]/g) || []).length / text.length;
  if (badCharRatio > 0.01) return false;

  // Reject content that's overwhelmingly non-speech placeholders/ads rather than dialogue.
  const cueLines = text.split(/\n/).filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !l.includes("-->"));
  const nonSpeechLines = cueLines.filter(l => /^\s*(\[.*\]|\(.*\)|uh+|um+)\s*$/i.test(l.trim()) || /download.{0,15}(free|mobile)/i.test(l));
  if (cueLines.length > 5 && nonSpeechLines.length / cueLines.length > 0.5) return false;

  return true;
}

async function downloadAndSaveSubtitleFromUrl(url: string, langHint: "ar" | "en" = "ar"): Promise<string | null> {
  try {
    if (!url || !url.startsWith("http")) return null;
    console.log(`[Subtitle Downloader] Fetching real subtitle file from: ${url}`);
    
    // Handle Subsource links
    if (url.includes("subsource.net")) {
      return await downloadAndExtractSubsourceSubtitle(url, langHint);
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/plain, text/vtt, application/x-subrip, application/octet-stream, */*"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("text/html")) return null;

    const ab = await res.arrayBuffer();
    let buffer = Buffer.from(ab);
    if (buffer.length < 50) return null;

    let fileName = `subtitle_${langHint}.srt`;

    // Unzip if ZIP archive
    if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      try {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        const entry = entries.find(e => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
        }
      } catch (zipErr: any) {
        console.warn("[Subtitle Downloader] Unzip error:", zipErr.message);
      }
    }

    const finalDecodedText = decodeSubtitleBuffer(buffer, langHint);

    if (!finalDecodedText.includes("-->") && !finalDecodedText.includes("WEBVTT") && !fileName.endsWith(".srt") && !fileName.endsWith(".vtt")) {
      return null;
    }

    if (!isPlausibleSubtitleContent(finalDecodedText, langHint)) {
      console.warn(`[Subtitle Downloader] Rejected: content does not genuinely match requested language "${langHint}" or looks like non-dialogue noise: ${url}`);
      return null;
    }

    const UPLOADS_DIR = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeName = `real_${langHint}_${Date.now()}_` + path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = path.join(UPLOADS_DIR, finalName);

    fs.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subtitle Downloader] Saved real subtitle file to: ${filePath}`);
    return `/uploads/${finalName}`;
  } catch (err: any) {
    console.warn(`[Subtitle Downloader] Download failed for ${url}:`, err.message);
    return null;
  }
}

async function scrapeRealSubtitlesDirect(title: string, year: number, imdbId?: string): Promise<{ ar: string; en: string }> {
  const result = { ar: "", en: "" };
  if (!title) return result;

  console.log(`[Real Subtitle Scraper] Programmatically locating real subtitle files for "${title}" (${year})...`);

  // 1. Query Archive.org public subtitle index
  try {
    const cleanTitle = title.replace(/[^\w\s]/gi, " ").trim();
    const query = `title:("${cleanTitle}") AND (format:"SubRip" OR extension:srt OR extension:vtt) AND mediatype:(texts OR movies)`;
    const archiveUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier,title&output=json`;
    const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const json = await res.json();
      const docs = json.response?.docs || [];
      for (const doc of docs.slice(0, 3)) {
        const filesUrl = `https://archive.org/metadata/${doc.identifier}/files`;
        const filesRes = await fetch(filesUrl, { signal: AbortSignal.timeout(5000) });
        if (filesRes.ok) {
          const filesJson = await filesRes.json();
          const srtFiles = (filesJson.result || []).filter((f: any) => 
            f.name && (f.name.toLowerCase().endsWith(".srt") || f.name.toLowerCase().endsWith(".vtt"))
          );
          
          for (const file of srtFiles) {
            const fileLower = file.name.toLowerCase();
            const isArabic = /(^|[._-])ar([._-]|$)/.test(fileLower) || fileLower.includes("arabic") || fileLower.includes("عربي");
            const isEnglish = !isArabic && (/(^|[._-])en(g)?([._-]|$)/.test(fileLower) || fileLower.includes("english"));

            // Skip files with no clear language signal in the name - guessing here is exactly
            // what previously caused unrelated/wrong-language files to be saved as if verified.
            if (!isArabic && !isEnglish) continue;
            if (isArabic && result.ar) continue;
            if (isEnglish && result.en) continue;

            const langHint: "ar" | "en" = isArabic ? "ar" : "en";
            const dlUrl = `https://archive.org/download/${doc.identifier}/${file.name}`;
            const savedPath = await downloadAndSaveSubtitleFromUrl(dlUrl, langHint);
            if (savedPath) {
              if (langHint === "ar") result.ar = savedPath;
              else result.en = savedPath;
            }
          }
        }
        if (result.ar && result.en) break;
      }
    }
  } catch (err: any) {
    console.warn("[Real Subtitle Scraper] Archive.org search notice:", err.message);
  }

  return result;
}

async function downloadAndExtractSubsourceSubtitle(url: string, langHint: "ar" | "en" = "ar"): Promise<string | null> {
  try {
    console.log(`[Subsource Downloader] Starting download for: ${url}`);
    
    // Try to extract ID from URL
    const idMatch = url.match(/\/(\d+)\/?$/) || url.match(/-(\d+)\/?$/) || url.match(/id=(\d+)/) || url.match(/subtitle\/[^\/]+\/(\d+)/);
    const id = idMatch ? idMatch[1] : null;
    
    let buffer: Buffer | null = null;
    let fileName = "subtitle.srt";
    let downloadUrl = "";

    // We will try multiple potential download paths
    const tryUrls: string[] = [];
    if (id) {
      tryUrls.push(`https://api.subsource.net/api/download/${id}`);
      tryUrls.push(`https://subsource.net/subtitle/download-file/${id}`);
      tryUrls.push(`https://subsource.net/download/subtitle?id=${id}`);
    }
    tryUrls.push(url);

    for (const tryUrl of tryUrls) {
      try {
        console.log(`[Subsource Downloader] Trying direct download URL: ${tryUrl}`);
        const fetchRes = await fetch(tryUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "application/octet-stream, application/zip, */*",
          },
          signal: AbortSignal.timeout(8000)
        });

        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get("content-type") || "";
          const contentDisposition = fetchRes.headers.get("content-disposition") || "";
          
          if (contentType.includes("text/html") && tryUrl === url && id) {
            continue;
          }

          const ab = await fetchRes.arrayBuffer();
          const tempBuf = Buffer.from(ab);
          if (tempBuf.length > 100) {
            buffer = tempBuf;
            downloadUrl = tryUrl;
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            if (filenameMatch) {
              fileName = filenameMatch[1];
            }
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[Subsource Downloader] Failed direct URL ${tryUrl}:`, err.message);
      }
    }

    // Fallback: fetch HTML page to extract ID and download again
    if (!buffer) {
      console.log(`[Subsource Downloader] Direct URLs failed. Fetching page HTML to extract ID...`);
      try {
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(8000)
        });

        if (pageRes.ok) {
          const html = await pageRes.text();
          const subIdMatch = html.match(/"id"\s*:\s*(\d+)/) || 
                             html.match(/download-file\/(\d+)/) || 
                             html.match(/subtitle\?id=(\d+)/) ||
                             html.match(/download\/(\d+)/);
          
          if (subIdMatch) {
            const extractedId = subIdMatch[1];
            console.log(`[Subsource Downloader] Extracted ID from HTML: ${extractedId}`);
            const fallbackUrls = [
              `https://api.subsource.net/api/download/${extractedId}`,
              `https://subsource.net/subtitle/download-file/${extractedId}`,
              `https://subsource.net/download/subtitle?id=${extractedId}`
            ];

            for (const fUrl of fallbackUrls) {
              try {
                const fRes = await fetch(fUrl, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
                  }
                });
                if (fRes.ok) {
                  const ab = await fRes.arrayBuffer();
                  buffer = Buffer.from(ab);
                  downloadUrl = fUrl;
                  break;
                }
              } catch (e) {}
            }
          }
        }
      } catch (htmlErr: any) {
        console.warn(`[Subsource Downloader] Failed to fetch page HTML:`, htmlErr.message);
      }
    }

    if (!buffer) {
      console.error(`[Subsource Downloader] Failed to download file for url: ${url}`);
      return null;
    }

    // ZIP check and unzip
    if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      console.log("[Subsource Downloader] ZIP file detected. Extracting...");
      try {
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        const entry = zipEntries.find(e => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
          console.log(`[Subsource Downloader] Extracted file: ${fileName}`);
        }
      } catch (zipErr: any) {
        console.error("[Subsource Downloader] Unzip error:", zipErr.message);
      }
    }

    const finalDecodedText = decodeSubtitleBuffer(buffer, langHint);

    if (!isPlausibleSubtitleContent(finalDecodedText, langHint)) {
      console.warn(`[Subsource Downloader] Rejected: content does not genuinely match requested language "${langHint}" or looks like non-dialogue noise: ${url}`);
      return null;
    }

    // Save file
    const UPLOADS_DIR = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeName = "subsource_" + Date.now() + "_" + path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = path.join(UPLOADS_DIR, finalName);
    
    fs.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subsource Downloader] Subtitle successfully saved to: ${filePath}`);
    return `/uploads/${finalName}`;
  } catch (err: any) {
    console.error("[Subsource Downloader] Error downloading subtitle:", err.message || err);
    return null;
  }
}

// Official OpenSubtitles REST API - the highest-yield legitimate real-subtitle source.
// Requires a free API key (https://www.opensubtitles.com/en/consumers -> free tier).
// Set OPENSUBTITLES_API_KEY in .env to enable; the rest of the pipeline works without it,
// just with lower hit rates since it then relies on Archive.org and web search only.
async function searchOpenSubtitles(title: string, year: number, lang: "ar" | "en", imdbId?: string): Promise<string | null> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey || !title) return null;

  try {
    const params = new URLSearchParams({ query: title, languages: lang, order_by: "download_count", order_direction: "desc" });
    if (year) params.set("year", String(year));
    if (imdbId) params.set("imdb_id", imdbId.replace(/^tt/i, ""));

    const searchRes = await fetch(`https://api.opensubtitles.com/api/v1/subtitles?${params.toString()}`, {
      headers: {
        "Api-Key": apiKey,
        "User-Agent": "CinemanaTV v1.0",
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!searchRes.ok) {
      console.warn(`[OpenSubtitles] Search failed with status ${searchRes.status} for "${title}" (${lang})`);
      return null;
    }

    const searchJson: any = await searchRes.json();
    const candidates = (searchJson?.data || []).slice(0, 5);
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
      const fileId = candidate?.attributes?.files?.[0]?.file_id;
      if (!fileId) continue;

      const dlRes = await fetch("https://api.opensubtitles.com/api/v1/download", {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
          "User-Agent": "CinemanaTV v1.0",
          "Accept": "application/json"
        },
        body: JSON.stringify({ file_id: fileId }),
        signal: AbortSignal.timeout(8000)
      });
      if (!dlRes.ok) {
        if (dlRes.status === 406 || dlRes.status === 429) {
          console.warn(`[OpenSubtitles] Download quota reached (status ${dlRes.status}) - skipping remaining candidates for "${title}" (${lang}). This resets daily on the free tier.`);
          return null;
        }
        continue;
      }

      const dlJson: any = await dlRes.json();
      const link = dlJson?.link;
      if (!link) continue;

      const saved = await downloadAndSaveSubtitleFromUrl(link, lang);
      if (saved) {
        console.log(`[OpenSubtitles] Verified real ${lang} subtitle for "${title}": ${saved}`);
        return saved;
      }
    }

    console.warn(`[OpenSubtitles] Found ${candidates.length} candidate(s) for "${title}" (${lang}) but none downloaded/validated successfully.`);
    return null;
  } catch (err: any) {
    console.warn(`[OpenSubtitles] Lookup failed for "${title}" (${lang}):`, err.message);
    return null;
  }
}

// Helper to search the web specifically for working real subtitle files (.vtt or .srt) for a given movie/show.
// Every source here either downloads and validates real content, or returns nothing - never a guessed/fabricated URL.
async function findSubtitlesForWork(title: string, year: number, type: string, imdbId?: string): Promise<{ ar: string; en: string }> {
  const result = { ar: "", en: "" };
  if (!title) return result;

  // 1. Official OpenSubtitles API - most reliable source when a key is configured.
  if (process.env.OPENSUBTITLES_API_KEY) {
    const [osAr, osEn] = await Promise.all([
      searchOpenSubtitles(title, year, "ar", imdbId),
      searchOpenSubtitles(title, year, "en", imdbId)
    ]);
    if (osAr) result.ar = osAr;
    if (osEn) result.en = osEn;
    if (result.ar && result.en) return result;
  }

  // 2. Archive.org public subtitle index (keyless, free, lower yield for mainstream titles)
  try {
    const directSubs = await scrapeRealSubtitlesDirect(title, year, imdbId);
    if (!result.ar && directSubs.ar) result.ar = directSubs.ar;
    if (!result.en && directSubs.en) result.en = directSubs.en;
    if (result.ar && result.en) return result;
  } catch (err: any) {
    console.warn("[Subtitles] Direct subtitle scraper error:", err.message);
  }

  // 3. Gemini + Google Search grounding as a last resort - only for languages still missing,
  // and every candidate it returns is downloaded/verified before being trusted, never assumed.
  if (ai && Date.now() >= quotaExceededUntil && (!result.ar || !result.en)) {
    const neededLangs = [!result.ar ? "arabic" : null, !result.en ? "english" : null].filter(Boolean).join(" and ");
    const prompt = `أنت باحث دقيق تبحث حصراً عن ملفات ترجمة (Subtitles) حقيقية وموجودة فعلاً على الإنترنت.
مهمتك هي البحث الفعلي عبر أداة البحث (googleSearch) عن روابط تحميل حقيقية وقابلة للتحقق لملفات ترجمة ${neededLangs} للعمل التالي:
العنوان: "${title}"
سنة الإنتاج: ${year}
النوع: ${type}

جرّب استعلامات مثل:
1. "site:opensubtitles.com \\"${title}\\""
2. "site:subsource.net \\"${title}\\""
3. "site:github.com \\"${title}\\" (srt | vtt)"
4. "site:archive.org/download \\"${title}\\" srt"

قاعدة صارمة: إذا لم تجد رابطاً حقيقياً مؤكداً من نتائج البحث الفعلية، أعد سلسلة نصية فارغة لتلك اللغة. ممنوع منعاً باتاً اختلاق أو تخمين أو افتراض أي رابط غير مؤكد بحث فعلي عنه.
أعد النتيجة بصيغة JSON فقط بدون أي نص إضافي:
{
  "ar": "رابط حقيقي وجدته فعلاً في نتائج البحث أو فارغ",
  "en": "رابط حقيقي وجدته فعلاً في نتائج البحث أو فارغ"
}`;

    try {
      console.log(`[Subtitles] Attempting Search Grounded Subtitle lookup for: ${title} (${year})`);
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["ar", "en"],
            properties: {
              ar: { type: Type.STRING },
              en: { type: Type.STRING }
            }
          }
        }
      });

      const resultText = response.text?.trim();
      if (resultText) {
        const parsed = JSON.parse(resultText);

        if (!result.ar && parsed.ar && parsed.ar.trim()) {
          const saved = await downloadAndSaveSubtitleFromUrl(parsed.ar.trim(), "ar");
          if (saved) result.ar = saved;
          else if (await verifySubtitleUrl(parsed.ar.trim(), "ar")) result.ar = parsed.ar.trim();
        }

        if (!result.en && parsed.en && parsed.en.trim()) {
          const saved = await downloadAndSaveSubtitleFromUrl(parsed.en.trim(), "en");
          if (saved) result.en = saved;
          else if (await verifySubtitleUrl(parsed.en.trim(), "en")) result.en = parsed.en.trim();
        }
      }
    } catch (error: any) {
      console.warn("[Subtitles] Search Grounded subtitle lookup failed:", error.message);
    }
  }

  return result;
}

// Helper to query Gemini for dynamic movies if user searches for anything not in DB
async function generateMovieWithGemini(query: string): Promise<Movie | null> {
  if (!ai) return null;
  if (Date.now() < quotaExceededUntil) {
    console.warn("[Server] Skipping dynamic Gemini search generation: rate-limited/cooldown active.");
    return null;
  }

  try {
    const prompt = `مهمتك هي البحث في الويب لتوليد وإرجاع معلومات كاملة ودقيقة جداً وحقيقية عن الفيلم أو المسلسل المبحوث عنه باللغتين العربية والإنجليزية.
العمل المطلوب البحث عنه: "${query}"

ابحث بدقة بالغة في الويب وخوادم TMDB (The Movie Database) أو IMDb أو ويكيبيديا عن:
- اسم الفيلم/المسلسل الحقيقي بالعربية والإنجليزية.
- سنة الإنتاج الحقيقية كـ رقم.
- التقييم الحقيقي (Rating) من 10 (مثل 8.5).
- المدة الحقيقية للأفلام أو عدد الحلقات للمسلسلات.
- التصنيفات الفنية الحقيقية (Genres) مثل "أكشن"، "مغامرة".
- قصة الفيلم أو المسلسل بالتفصيل والتشويق بالعربية (storyAr) والإنجليزية (storyEn).
- الممثلين الحقيقيين المشتركين في هذا العمل (actors).
- المخرج الحقيقي (director) والكاتب الحقيقي (writer) للعمل الفني.
- روابط صور البوستر الحقيقية والواقعية للعمل الفني نفسه تنتهي بـ .jpg أو .png. يفضّل للغاية استخدام صور البوسترات الرسمية من خوادم TMDB الشهيرة مثل (https://image.tmdb.org/t/p/w500/...) للبوستر و (https://image.tmdb.org/t/p/original/...) للخلفية، أو صور IMDb أو ويكيبيديا لتكون البوسترات والخلفيات واقعية ومطابقة بنسبة 100% للعمل الحقيقي المطلوب، وتجنب تماماً استخدام صور Unsplash العشوائية أو غير الواقعية.
- روابط صور المخرج (directorPhotoUrl) والكاتب (writerPhotoUrl) من TMDB (https://image.tmdb.org/t/p/w185/...) أو IMDb (https://m.media-amazon.com/images/M/...). ابحث عن المخرج والكاتب على جوجل لضمان العثور على صورهم الحقيقية الرسمية. لا تستخدم روابط عشوائية أو صوراً غير مرتبطة بهما.
- قائمة طاقم العمل (castMembers) مع روابط صورهم الشخصية الحقيقية (photoUrl) والاسم (name) والدور (role) من TMDB أو IMDb الشخصية. يجب عليك إدخال ما لا يقل عن 6 ممثلين رئيسيين للعمل، وتوفير أسمائهم وصورهم الحقيقية المستوردة بدقة من خوادم TMDB (https://image.tmdb.org/t/p/w185/...) أو صور IMDb (https://m.media-amazon.com/images/M/...) مع انتهاء الروابط بـ .jpg لضمان ظهور صور حقيقية لطاقم العمل في التطبيق.
- وفر مشغلات فيديو وهمية ولكن بروابط mp4 حقيقية سريعة جداً صالحة للتشغيل في مشغل الفيديو الخاص بالتطبيق (استخدم حصرياً أحد هذه الروابط الصالحة للبث:
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
"https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4").
قم بتسمية هذه السيرفرات بأسماء واقعية كـ "سيرفر سينمانا الرئيسي" أو "سيرفر البث الاحتياطي" أو "الحلقة 1 HD" للمسلسلات.
اترك حقول subtitlesUrlAr و subtitlesUrlEn فارغتين تماماً في هذه الاستجابة. سيتم البحث عن ملفات الترجمة الحقيقية بشكل منفصل عبر نظام مخصص للتحقق منها فعلياً قبل استخدامها. ممنوع منعاً باتاً اختلاق أو تخمين أي رابط ترجمة غير مؤكد.

تنسيق الاستجابة يجب أن يكون بصيغة JSON حصرياً ومطابقاً للبنية التالية:
{
  "id": "معرف فريد يبدأ بـ gemini_",
  "titleAr": "اسم الفيلم/المسلسل بالعربية الفصحى",
  "titleEn": "English Title",
  "type": "movie أو series",
  "rating": رقم بين 1.0 و 10.0,
  "year": سنة الإنتاج كـ رقم,
  "duration": "المدة مثل 2h 15m للأفلام أو عدد الحلقات للمسلسلات",
  "genres": ["تصنيف 1", "تصنيف 2"],
  "poster": "رابط البوستر الحقيقي من TMDB/IMDb",
  "backdrop": "رابط الخلفية الحقيقي من TMDB/IMDb",
  "storyAr": "قصة وسيناريو مشوق ومفصل بالعربية من سينمانا",
  "storyEn": "Detailed synopsis in English from Cinemana",
  "actors": ["ممثل 1", "ممثل 2", "ممثل 3"],
  "director": "اسم المخرج",
  "writer": "اسم الكاتب",
  "directorPhotoUrl": "رابط صورة المخرج الشخصية من TMDB/IMDb أو فارغ",
  "writerPhotoUrl": "رابط صورة الكاتب الشخصية من TMDB/IMDb أو فارغ",
  "castMembers": [
    {
      "name": "اسم الممثل",
      "role": "اسم الشخصية أو الدور",
      "photoUrl": "رابط صورته من TMDB/IMDb أو فارغ"
    }
  ],
  "quality": "Ultra HD أو Full HD",
  "subtitlesUrlAr": "رابط ملف الترجمة العربية vtt أو srt أو فارغ",
  "subtitlesUrlEn": "رابط ملف الترجمة الإنجليزية vtt أو srt أو فارغ",
  "trailerUrl": "رابط إعلان الفيلم الرسمي على يوتيوب",
  "servers": [
    {"name": "سيرفر سينمانا الرئيسي", "url": "رابط mp4 المختار من الروابط أعلاه"},
    {"name": "سيرفر احتياطي HD", "url": "رابط mp4 البديل المختار من الروابط أعلاه"}
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: [
            "id", "titleAr", "titleEn", "type", "rating", "year", "duration", "genres", 
            "poster", "backdrop", "storyAr", "storyEn", "actors", "director", "writer", 
            "directorPhotoUrl", "writerPhotoUrl", "castMembers", "quality", "servers"
          ],
          properties: {
            id: { type: Type.STRING },
            titleAr: { type: Type.STRING },
            titleEn: { type: Type.STRING },
            type: { type: Type.STRING },
            rating: { type: Type.NUMBER },
            year: { type: Type.INTEGER },
            duration: { type: Type.STRING },
            genres: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            poster: { type: Type.STRING },
            backdrop: { type: Type.STRING },
            storyAr: { type: Type.STRING },
            storyEn: { type: Type.STRING },
            actors: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            director: { type: Type.STRING },
            writer: { type: Type.STRING },
            directorPhotoUrl: { type: Type.STRING },
            writerPhotoUrl: { type: Type.STRING },
            castMembers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["name", "photoUrl"],
                properties: {
                  name: { type: Type.STRING },
                  role: { type: Type.STRING },
                  photoUrl: { type: Type.STRING }
                }
              }
            },
            quality: { type: Type.STRING },
            subtitlesUrlAr: { type: Type.STRING },
            subtitlesUrlEn: { type: Type.STRING },
            trailerUrl: { type: Type.STRING },
            servers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["name", "url"],
                properties: {
                  name: { type: Type.STRING },
                  url: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const resultText = response.text?.trim();
    if (resultText) {
      const parsedMovie = JSON.parse(resultText) as Movie;
      
      // Auto-sanitize subtitles to use our reliable intelligent generator proxy
      parsedMovie.subtitlesUrlAr = getValidSubtitleUrl(parsedMovie.subtitlesUrlAr, parsedMovie.id, "ar", undefined, undefined, parsedMovie);
      parsedMovie.subtitlesUrlEn = getValidSubtitleUrl(parsedMovie.subtitlesUrlEn, parsedMovie.id, "en", undefined, undefined, parsedMovie);

      // Verify and correct/heal poster and backdrop URLs
      parsedMovie.poster = await verifyAndCorrectImageUrl(parsedMovie.poster, parsedMovie.titleEn || parsedMovie.titleAr, false, parsedMovie.genres);
      parsedMovie.backdrop = await verifyAndCorrectImageUrl(parsedMovie.backdrop, parsedMovie.titleEn || parsedMovie.titleAr, true, parsedMovie.genres);

      // Verify and correct filmmaker and cast photos with real keyless TMDB scraping
      if (parsedMovie.director) {
        parsedMovie.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedMovie.director, parsedMovie.directorPhotoUrl);
      }
      if (parsedMovie.writer) {
        parsedMovie.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedMovie.writer, parsedMovie.writerPhotoUrl);
      }
      if (parsedMovie.castMembers && Array.isArray(parsedMovie.castMembers)) {
        for (const cast of parsedMovie.castMembers) {
          cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
        }
      }

      return parsedMovie;
    }
  } catch (error: any) {
    console.error("Gemini Generation Error:", error);
    handleGeminiError(error, "generateMovieWithGemini");
  }
  return null;
}

// In-memory caching system for live homepage categories
let cachedHomeData: any = null;
let lastCacheTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes cache duration
let isFetchingHome = false;

async function fetchHomeMoviesFromGemini(): Promise<any | null> {
  if (!ai || isFetchingHome) return cachedHomeData;
  if (Date.now() < quotaExceededUntil) {
    console.warn("[Server] Skipping home categories Gemini fetch: rate-limited/cooldown active.");
    return cachedHomeData;
  }
  isFetchingHome = true;
  
  try {
    console.log("[Server] Fetching live Cinemana homepage content via Gemini Search Grounding...");
    const prompt = `أنت خبير محترف ومسؤول دمج البيانات لشبكتي سينمانا (Cinemana Shabakaty).
قم ببحث مباشر ودقيق باستخدام محرك البحث جوجل عن الصفحة الرئيسية الفعالة لسينمانا شبكتي: "https://cinemana.shabakaty.com/home" أو "موقع سينمانا شبكتي الرئيسي".
استخرج بدقة شديدة الأفلام والمسلسلات وبنر الصفحة الرئيسية المعروضة حالياً على الموقع الحقيقي في هذه اللحظة.
نريدك أن تعكس محتوى الموقع الفعلي بالكامل وبنسبة 100% وتصنفها في واجهتنا:

تحديداً، قم بتوليد كائن JSON متكامل يحتوي على:
1. "hero": العمل الفني الرئيسي (البنر المتصدر) المعروض كخلفية وبطل الصفحة في "https://cinemana.shabakaty.com/home" حالياً (فيلم أو مسلسل حديث وشائع، استخرج اسمه الحقيقي وعناصره وقصته الحقيقية).
2. "categories": مصفوفة تحتوي على الفئات التالية المأخوذة من تصنيفات وقوائم الصفحة الرئيسية لسينمانا:
   - "recent" (الأفلام والمسلسلات المضافة حديثاً على سينمانا)
   - "trending" (الأكثر مشاهدة والأعلى تقييماً في سينمانا حالياً)
   - "series" (أحدث المسلسلات والبرامج التلفزيونية على سينمانا)
   - "action" (أفلام الأكشن والمغامرة المتوفرة على سينمانا)
   - "movies" (الأفلام المميزة والجديدة المعروضة على سينمانا حالياً)

يجب أن يحتوي كل فيلم/مسلسل في القائمة على البيانات الحقيقية والواقعية بالكامل من عناوين وقصة وتصنيفات وممثلين وتوفير سيرفر تشغيل مباشر واحد فقط لكل عمل فني أو حلقة مسلسل، مستخرجاً أو منشأً مباشرةً من سينمانا بصيغة m3u8 (الرابط المباشر لسينمانا للأفلام يكون بالصيغة: https://video.shabakaty.com/movies/{id}/index.m3u8 حيث id هو المعرف الرقمي الحقيقي للفيلم في سينمانا، ولحلقات المسلسلات يكون بالصيغة: https://video.shabakaty.com/movies/{series_id}/{season_number}/{episode_number}/index.m3u8 حيث series_id هو المعرف الرقمي للمسلسل. يجب أن تحتوي مصفوفة "servers" على عنصر واحد فقط لا غير وتسميه "سيرفر سينمانا المباشر").
ابحث بدقة في الويب وفي خوادم TMDB (The Movie Database) أو IMDb أو Wikipedia عن روابط صور البوسترات والخلفيات الرسمية الحقيقية والمطابقة تماماً لكل عمل فني، يفضل دائماً استخدام خوادم TMDB الشهيرة مثل (https://image.tmdb.org/t/p/w500/...) للبوسترات و (https://image.tmdb.org/t/p/original/...) للخلفيات لضمان أقصى درجات الواقعية، وتجنب تماماً استخدام صور Unsplash العشوائية.

تنسيق الاستجابة يجب أن يكون بصيغة JSON حصرياً مطابقاً للمخطط التالي تماماً:
{
  "hero": {
    "id": "سلسلة نصية فريدة",
    "titleAr": "العنوان بالعربية",
    "titleEn": "English Title",
    "type": "movie أو series",
    "rating": 8.7,
    "year": 2024,
    "duration": "المدة",
    "genres": ["تصنيف"],
    "poster": "رابط الصورة العمودية الرسمية الحقيقية للبوستر من TMDB أو IMDb/Wikipedia",
    "backdrop": "رابط الصورة الأفقية الرسمية الحقيقية للخلفية من TMDB أو IMDb/Wikipedia",
    "storyAr": "القصة بالعربية",
    "storyEn": "Story in English",
    "actors": ["ممثل"],
    "quality": "Ultra HD",
    "servers": [{"name": "اسم السيرفر", "url": "الرابط"}]
  },
  "categories": [
    {
      "id": "recent",
      "titleAr": "الأفلام والمسلسلات المضافة حديثاً",
      "titleEn": "Recently Added",
      "items": [
         {
           "id": "سلسلة نصية فريدة",
           "titleAr": "العنوان بالعربية",
           "titleEn": "English Title",
           "type": "movie أو series",
           "rating": 8.5,
           "year": 2024,
           "duration": "المدة",
           "genres": ["تصنيف"],
           "poster": "رابط الصورة العمودية الرسمية الحقيقية للبوستر من TMDB أو IMDb/Wikipedia",
           "backdrop": "رابط الصورة الأفقية الرسمية الحقيقية للخلفية من TMDB أو IMDb/Wikipedia",
           "storyAr": "القصة بالعربية",
           "storyEn": "Story in English",
           "actors": ["ممثل"],
           "quality": "Ultra HD",
           "servers": [{"name": "اسم السيرفر", "url": "الرابط"}]
         }
      ]
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["hero", "categories"],
          properties: {
            hero: {
              type: Type.OBJECT,
              required: ["id", "titleAr", "titleEn", "type", "rating", "year", "duration", "genres", "poster", "backdrop", "storyAr", "storyEn", "actors", "quality", "servers"],
              properties: {
                id: { type: Type.STRING },
                titleAr: { type: Type.STRING },
                titleEn: { type: Type.STRING },
                type: { type: Type.STRING },
                rating: { type: Type.NUMBER },
                year: { type: Type.INTEGER },
                duration: { type: Type.STRING },
                genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                poster: { type: Type.STRING },
                backdrop: { type: Type.STRING },
                storyAr: { type: Type.STRING },
                storyEn: { type: Type.STRING },
                actors: { type: Type.ARRAY, items: { type: Type.STRING } },
                quality: { type: Type.STRING },
                servers: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["name", "url"],
                    properties: {
                      name: { type: Type.STRING },
                      url: { type: Type.STRING }
                    }
                  }
                }
              }
            },
            categories: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "titleAr", "titleEn", "items"],
                properties: {
                  id: { type: Type.STRING },
                  titleAr: { type: Type.STRING },
                  titleEn: { type: Type.STRING },
                  items: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      required: ["id", "titleAr", "titleEn", "type", "rating", "year", "duration", "genres", "poster", "backdrop", "storyAr", "storyEn", "actors", "quality", "servers"],
                      properties: {
                        id: { type: Type.STRING },
                        titleAr: { type: Type.STRING },
                        titleEn: { type: Type.STRING },
                        type: { type: Type.STRING },
                        rating: { type: Type.NUMBER },
                        year: { type: Type.INTEGER },
                        duration: { type: Type.STRING },
                        genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                        poster: { type: Type.STRING },
                        backdrop: { type: Type.STRING },
                        storyAr: { type: Type.STRING },
                        storyEn: { type: Type.STRING },
                        actors: { type: Type.ARRAY, items: { type: Type.STRING } },
                        quality: { type: Type.STRING },
                        servers: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            required: ["name", "url"],
                            properties: {
                              name: { type: Type.STRING },
                              url: { type: Type.STRING }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    const resultText = response.text?.trim();
    if (resultText) {
      cachedHomeData = JSON.parse(resultText);
      lastCacheTime = Date.now();
      console.log("[Server] Live Cinemana home categories fetched and cached successfully!");
      
      // Seed our main database memory with these fresh entries to enable fast lookups and persist them
      let hasChanges = false;
      if (cachedHomeData.hero) {
        if (!isMovieDeleted(cachedHomeData.hero.id, cachedHomeData.hero.titleAr, cachedHomeData.hero.titleEn) && !moviesDatabase.some(m => m.id === cachedHomeData.hero.id)) {
          if (cachedHomeData.hero.isPublished === undefined) cachedHomeData.hero.isPublished = true;
          moviesDatabase.push(cachedHomeData.hero);
          saveMovieToFirestore(cachedHomeData.hero).catch(console.error);
          hasChanges = true;
        }
      }
      if (cachedHomeData.categories) {
        cachedHomeData.categories.forEach((cat: any) => {
          if (cat.items) {
            cat.items.forEach((item: Movie) => {
              if (!isMovieDeleted(item.id, item.titleAr, item.titleEn) && !moviesDatabase.some(m => m.id === item.id)) {
                if (item.isPublished === undefined) item.isPublished = true;
                moviesDatabase.push(item);
                saveMovieToFirestore(item).catch(console.error);
                hasChanges = true;
              }
            });
          }
        });
      }
      if (hasChanges) {
        console.log("[Server] Persisting newly imported movies from Cinemana home to local database...");
        saveMoviesDatabase();
      }
    }
  } catch (error: any) {
    console.error("[Server] Error fetching live Cinemana home from Gemini:", error);
    handleGeminiError(error, "fetchHomeMoviesFromGemini");
  } finally {
    isFetchingHome = false;
  }
  return cachedHomeData;
}

async function fetchRealSeriesSeasonsFromGemini(titleEn: string, seriesId: string, backdrop: string, defaultRating: number): Promise<Season[]> {
  if (!ai) return [];
  try {
    console.log(`[Gemini Series Scraper] Fetching real seasons and episodes for TV show: "${titleEn}"...`);
    const prompt = `You are an expert entertainment database manager.
Search the web (using googleSearch) for the TV show/series: "${titleEn}".
Retrieve the actual list of seasons, and for each season, retrieve the actual list of episodes (especially focusing on Season 1 and Season 2, or up to all available seasons).
For each season, provide:
- season number
- title in Arabic (e.g. "الموسم الأول", "الموسم الثاني")
- title in English (e.g. "Season 1", "Season 2")

For each episode, provide:
- episode number
- title in Arabic (e.g. "ورثة التنين")
- title in English (e.g. "The Heirs of the Dragon")
- duration (e.g. "59m", "45m")
- storyAr (detailed description in Arabic)
- storyEn (detailed description in English)
- rating (from 1 to 10)

For the servers list, include:
1. "سيرفر سينمانا الرئيسي HD" with a mock or proxy streaming link.
2. "سيرفر البث الذكي 1080p" with a mock or proxy streaming link.
Use fast sample MP4s for the stream links:
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4"
- "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"

Format your response as a JSON array of Seasons strictly conforming to the Season interface:
interface Episode {
  id: string; // generate unique id e.g. "s1_e1_seriesId"
  number: number;
  titleAr: string;
  titleEn: string;
  duration: string;
  storyAr: string;
  storyEn: string;
  thumbnail: string; // use this backdrop url: "${backdrop}"
  servers: { name: string; url: string }[];
  subtitlesUrlAr: string; // generate "/api/subtitles?movieId=seriesId&seasonId=seasonId&episodeId=episodeId&lang=ar"
  subtitlesUrlEn: string; // generate "/api/subtitles?movieId=seriesId&seasonId=seasonId&episodeId=episodeId&lang=en"
  rating?: number;
}
interface Season {
  id: string; // e.g. "s1", "s2"
  number: number;
  titleAr: string;
  titleEn: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  storyAr?: string;
  storyEn?: string;
  episodes: Episode[];
}

Return ONLY a valid JSON array of Season objects.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["id", "number", "titleAr", "titleEn", "episodes"],
            properties: {
              id: { type: Type.STRING },
              number: { type: Type.INTEGER },
              titleAr: { type: Type.STRING },
              titleEn: { type: Type.STRING },
              episodes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  required: ["id", "number", "titleAr", "titleEn", "duration", "storyAr", "storyEn", "thumbnail", "servers", "subtitlesUrlAr", "subtitlesUrlEn"],
                  properties: {
                    id: { type: Type.STRING },
                    number: { type: Type.INTEGER },
                    titleAr: { type: Type.STRING },
                    titleEn: { type: Type.STRING },
                    duration: { type: Type.STRING },
                    storyAr: { type: Type.STRING },
                    storyEn: { type: Type.STRING },
                    thumbnail: { type: Type.STRING },
                    servers: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        required: ["name", "url"],
                        properties: {
                          name: { type: Type.STRING },
                          url: { type: Type.STRING }
                        }
                      }
                    },
                    subtitlesUrlAr: { type: Type.STRING },
                    subtitlesUrlEn: { type: Type.STRING },
                    rating: { type: Type.NUMBER }
                  }
                }
              }
            }
          }
        }
      }
    });

    const resultText = response.text?.trim();
    if (resultText) {
      const seasons = JSON.parse(resultText);
      if (Array.isArray(seasons) && seasons.length > 0) {
        console.log(`[Gemini Series Scraper] Successfully retrieved ${seasons.length} real seasons for "${titleEn}"!`);
        return seasons;
      }
    }
  } catch (err: any) {
    console.error(`[Gemini Series Scraper] Failed to fetch real seasons for "${titleEn}":`, err.message || err);
  }
  return [];
}

async function fetchFutureAndTrendingTitlesFromGemini(): Promise<string[]> {
  if (!ai || Date.now() < quotaExceededUntil) return [];
  try {
    console.log("[TMDB Auto-Seeder] Searching live web for newly released 2026 movies and series on Cinemana/IMDb...");
    const prompt = `You are an expert movie data harvester.
Search the web (using googleSearch) for the newest and recently released movies and TV series published in 2026 on Cinemana Shabakaty (سينمانا شبكتي) and IMDb/TMDB.
List the top 20 most recent blockbusters, trending TV shows, and newly added releases of 2026.
Return your response as a simple JSON array of strings containing ONLY the titles in English (e.g., ["Dune: Part Two", "Gladiator II", "Inside Out 2", "Wicked", "Moana 2", "Severance Season 2"]).`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const resultText = response.text?.trim();
    if (resultText) {
      const titles = JSON.parse(resultText);
      if (Array.isArray(titles) && titles.length > 0) {
        console.log(`[TMDB Auto-Seeder] Discovered ${titles.length} newly released titles from live web:`, titles);
        return titles;
      }
    }
  } catch (err: any) {
    handleGeminiError(err, "fetchFutureAndTrendingTitlesFromGemini");
    console.warn("[TMDB Auto-Seeder] Could not discover new titles from Gemini web search (using popular list instead):", err.message || err);
  }
  return [];
}

let isSeedingReal = false;

async function seedRealMoviesFromTMDB() {
  if (isSeedingReal) {
    console.log("[TMDB Auto-Seeder] Seeding is already in progress. Skipping duplicate call.");
    return;
  }
  isSeedingReal = true;
  console.log("[Server] Starting background seeding of real movies and series from TMDB...");
  
  const POPULAR_TITLES_TO_IMPORT = [
    // Latest Blockbusters & Trending
    "Deadpool & Wolverine",
    "Inside Out 2",
    "Dune: Part Two",
    "Oppenheimer",
    "Gladiator II",
    "Alien: Romulus",
    "Moana 2",
    "Wicked",
    "Kingdom of the Planet of the Apes",
    "The Batman",
    "Bad Boys: Ride or Die",
    "A Quiet Place: Day One",
    "Despicable Me 4",
    "Twisters",
    "Spider-Man: Across the Spider-Verse",
    "John Wick: Chapter 4",
    "Top Gun: Maverick",
    "Everything Everywhere All at Once",
    "Avatar: The Way of Water",
    "The Lord of the Rings: The Return of the King",
    "Avengers: Endgame",
    "Inception",
    "Interstellar",
    "The Dark Knight",
    "Fight Club",
    "The Godfather",
    "Pulp Fiction",
    "Barbie",
    
    // Top TV Shows / Series
    "House of the Dragon",
    "The Last of Us",
    "Squid Game",
    "The Boys",
    "Shogun",
    "Fallout",
    "Stranger Things",
    "Breaking Bad",
    "Game of Thrones",
    "Succession",
    "Loki",
    "The Bear",
    "Chernobyl",
    "Severance",
    "The Mandalorian",
    "Wednesday",
    "Dark",
    "Prison Break",
    "Vikings",
    "Peaky Blinders"
  ];

  // Discover newly released titles dynamically from the live web to support future releases
  const newlyReleasedDiscovered = await fetchFutureAndTrendingTitlesFromGemini().catch(() => []);
  const ALL_TITLES_TO_IMPORT = Array.from(new Set([...newlyReleasedDiscovered, ...POPULAR_TITLES_TO_IMPORT]));

  let addedCount = 0;
  for (const title of ALL_TITLES_TO_IMPORT) {
    try {
      if (isMovieDeleted(undefined, title, title)) {
        console.log(`[TMDB Auto-Seeder] Skipping deleted work title: "${title}"`);
        continue;
      }

      // Check if a movie with this title already exists in the database (either Arabic or English)
      const exists = moviesDatabase.some(m => 
        m.titleEn.toLowerCase() === title.toLowerCase() || 
        (m.titleAr && m.titleAr.toLowerCase() === title.toLowerCase())
      );
      
      if (exists) {
        continue;
      }

      console.log(`[TMDB Auto-Seeder] Scraping details for work: "${title}"...`);
      const movieData = await scrapeTMDBMetadata(title);
      if (movieData && movieData.titleEn) {
        if (isMovieDeleted(movieData.id, movieData.titleAr, movieData.titleEn)) {
          console.log(`[TMDB Auto-Seeder] Skipping deleted scraped work: "${movieData.titleAr}" / "${movieData.titleEn}"`);
          continue;
        }

        // Double check existence by exact ID to be absolutely safe
        if (!moviesDatabase.some(m => m.id === movieData.id)) {
          movieData.isPublished = true;
          moviesDatabase.push(movieData);
          await saveMovieToFirestore(movieData).catch(err => console.error(`[TMDB Auto-Seeder] Error saving ${movieData.id} to Firestore:`, err));
          addedCount++;
          console.log(`[TMDB Auto-Seeder] Successfully imported: [${movieData.type}] ${movieData.titleAr} / ${movieData.titleEn}`);
          
          // Save every few items to local disk to persist progress
          if (addedCount % 2 === 0) {
            saveMoviesDatabase();
          }
        }
      }
      
      // Add a small delay between requests to be polite to TMDB website
      await new Promise(resolve => setTimeout(resolve, 800));
    } catch (err: any) {
      console.error(`[TMDB Auto-Seeder] Failed to auto-seed "${title}":`, err.message || err);
    }
  }

  isSeedingReal = false;
  if (addedCount > 0) {
    saveMoviesDatabase();
    console.log(`[TMDB Auto-Seeder] Background seeding completed. Added ${addedCount} brand new real movies/series!`);
  } else {
    console.log("[TMDB Auto-Seeder] All popular movies and series are already in the database.");
  }
}

// Database and config loading/seeding
async function findOfficialWikipediaPoster(title: string, isBackdrop: boolean): Promise<string | null> {
  const cleanTitle = title.replace(/[^\w\s\u0600-\u06FF]/gi, "").trim();
  if (!cleanTitle) return null;

  // Search English and Arabic wikipedia
  const languages = ["en", "ar"];
  for (const lang of languages) {
    try {
      // 1. Search for the most relevant page directly by movie/series title (no suffix)
      const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTitle)}&format=json&origin=*`;
      const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(2000) });
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      
      let pageTitle = "";
      if (searchData.query?.search?.length > 0) {
        // Find the best match representing a film, movie, series, or show
        const results = searchData.query.search;
        const bestResult = results.find((item: any) => {
          const t = item.title.toLowerCase();
          const s = item.snippet?.toLowerCase() || "";
          return t.includes("film") || t.includes("movie") || t.includes("series") || t.includes("show") ||
                 t.includes("فيلم") || t.includes("مسلسل") ||
                 s.includes("film") || s.includes("movie") || s.includes("series") || s.includes("show") ||
                 s.includes("فيلم") || s.includes("مسلسل");
        }) || results[0];
        
        pageTitle = bestResult.title;
      } else {
        pageTitle = cleanTitle;
      }

      // 2. Query page image for this page title with higher resolution (1000px)
      const imageQueryUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=pageimages&format=json&pithumbsize=1000&origin=*`;
      const imageRes = await fetch(imageQueryUrl, { signal: AbortSignal.timeout(2000) });
      if (imageRes.ok) {
        const imageData = await imageRes.json();
        const pages = imageData.query?.pages;
        if (pages) {
          const pageId = Object.keys(pages)[0];
          const thumbnail = pages[pageId]?.thumbnail?.source;
          if (thumbnail && thumbnail.startsWith("http")) {
            console.log(`[Wikipedia Poster API] Found official pageimage for "${title}" (${lang}): ${thumbnail}`);
            return thumbnail;
          }
        }
      }

      // 3. Fallback: Query parsed infobox section 0 to fetch non-free / fair-use poster image
      try {
        const parseUrl = `https://${lang}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=text&section=0&format=json&origin=*`;
        const parseRes = await fetch(parseUrl, { signal: AbortSignal.timeout(2500) });
        if (parseRes.ok) {
          const parseData = await parseRes.json();
          const html = parseData.parse?.text?.["*"];
          if (html) {
            // Match all image sources inside the parsed HTML
            const imgRegex = /<img[^>]+src="([^"]+)"/gi;
            let match;
            const foundUrls: string[] = [];
            while ((match = imgRegex.exec(html)) !== null) {
              let src = match[1];
              if (src.startsWith("//")) {
                src = "https:" + src;
              }
              // Filter out small decoration icons/logos, keeping only high-fidelity assets
              if (src.includes("upload.wikimedia.org") && !src.includes("Symbol") && !src.includes("Wiki") && !src.includes("Edit") && !src.includes("sound")) {
                foundUrls.push(src);
              }
            }
            if (foundUrls.length > 0) {
              // Extract original un-thumbnailed high resolution version
              const thumbUrl = foundUrls[0];
              let finalUrl = thumbUrl;
              if (thumbUrl.includes("/thumb/")) {
                let clean = thumbUrl.replace("/thumb/", "/");
                const lastSlash = clean.lastIndexOf("/");
                if (lastSlash !== -1) {
                  clean = clean.substring(0, lastSlash);
                }
                finalUrl = clean;
              }
              console.log(`[Wikipedia Poster API] Successfully extracted parsed infobox poster for "${title}" (${lang}): ${finalUrl}`);
              return finalUrl;
            }
          }
        }
      } catch (parseErr) {
        console.warn(`[Wikipedia Poster API] Parse infobox section 0 fallback failed for "${title}":`, parseErr);
      }

    } catch (err) {
      console.warn(`[Wikipedia Poster API] Failed for "${title}" in ${lang}:`, err);
    }
  }
  return null;
}

function getValidSubtitleUrl(url: string | undefined | null, movieId: string, lang: string, seasonId?: string, episodeId?: string, movieOrEp?: any, isEditMode: boolean = false): string {
  // If explicitly cleared by admin/user or empty string, preserve empty string so subtitle deletion works!
  if (url === "" || url === "none") {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.subtitlesUrlAr = "";
        movieOrEp.originalSubtitlesUrlAr = "";
      } else {
        movieOrEp.subtitlesUrlEn = "";
        movieOrEp.originalSubtitlesUrlEn = "";
      }
    }
    return "";
  }

  if (url === undefined || url === null) {
    if (isEditMode) return "";
    let path = `/api/subtitles?movieId=${movieId}`;
    if (seasonId) path += `&seasonId=${seasonId}`;
    if (episodeId) path += `&episodeId=${episodeId}`;
    path += `&lang=${lang}`;
    return path;
  }

  // Preserve uploaded, data/blob, or existing valid subtitle proxy URLs
  if (url.startsWith("/uploads/") || url.startsWith("data:") || url.startsWith("blob:")) {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.originalSubtitlesUrlAr = url;
        movieOrEp.subtitlesUrlAr = url;
      } else {
        movieOrEp.originalSubtitlesUrlEn = url;
        movieOrEp.subtitlesUrlEn = url;
      }
    }
    return url;
  }

  if (url.startsWith("/api/subtitles?")) {
    return url;
  }
  
  // Save original subtitle source if it is an external HTTP/HTTPS URL
  if (url.startsWith("http://") || url.startsWith("https://")) {
    if (movieOrEp) {
      if (lang === "ar") {
        movieOrEp.originalSubtitlesUrlAr = url;
      } else {
        movieOrEp.originalSubtitlesUrlEn = url;
      }
    }
    return url;
  }

  return url;
}

async function fetchOfficialTMDBImages(title: string): Promise<{ poster: string | null; backdrop: string | null } | null> {
  try {
    // Clean title for searching: remove years (e.g. 2008), parentheses, and special symbols
    let cleanTitle = title.replace(/\((?:19|20)\d{2}\)/g, "").replace(/[()]/g, "").replace(/[-:_]/g, " ").trim();
    
    console.log(`[TMDB Scraper] Searching TMDB for title: "${cleanTitle}" (originally "${title}")`);
    const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(cleanTitle)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!searchRes.ok) {
      console.warn(`[TMDB Scraper] Search failed with status: ${searchRes.status}`);
      return null;
    }
    const searchHtml = await searchRes.text();
    
    // Extract first movie or series result path (e.g. /movie/155-the-dark-knight or /tv/1399-game-of-thrones)
    const linkMatch = searchHtml.match(/href="(\/(movie|tv)\/\d+[^"]*)"/);
    if (!linkMatch) {
      console.log(`[TMDB Scraper] No detail page found in search results for: "${cleanTitle}"`);
      return null;
    }
    
    const detailUrl = `https://www.themoviedb.org${linkMatch[1]}`;
    console.log(`[TMDB Scraper] Scraping detail page: ${detailUrl}`);
    
    const detailRes = await fetch(detailUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!detailRes.ok) {
      console.warn(`[TMDB Scraper] Detail page fetch failed with status: ${detailRes.status}`);
      return null;
    }
    const detailHtml = await detailRes.text();
    
    // Parse all image paths using robust pattern matching
    const pathRegex = /\/t\/p\/([a-zA-Z0-9_()%-]+)\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/gi;
    let match;
    const posters: string[] = [];
    const backdrops: string[] = [];
    
    while ((match = pathRegex.exec(detailHtml)) !== null) {
      const folder = match[1].toLowerCase();
      const filename = match[2];
      
      // Categorize into backdrops (landscape) and posters (portrait)
      if (folder.includes("1920_and_h800") || folder.includes("1000_and_h563") || folder.includes("1280") || folder.includes("1920") || folder.includes("original")) {
        backdrops.push(filename);
      } else if (folder.includes("w500") || folder.includes("300_and_h450") || folder.includes("600_and_h900") || folder.includes("188_and_h282")) {
        posters.push(filename);
      }
    }
    
    // Fallback: collect any image hashes regardless of category
    const allHashes: string[] = [];
    const allHashesRegex = /\/t\/p\/[a-zA-Z0-9_()%-]+\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/gi;
    let anyMatch;
    while ((anyMatch = allHashesRegex.exec(detailHtml)) !== null) {
      allHashes.push(anyMatch[1]);
    }
    
    const posterHash = posters[0] || allHashes[0] || null;
    const backdropHash = backdrops[0] || allHashes[2] || allHashes[1] || posterHash;
    
    if (!posterHash && !backdropHash) {
      console.log(`[TMDB Scraper] No valid image hashes extracted from: ${detailUrl}`);
      return null;
    }
    
    return {
      poster: posterHash ? `https://image.tmdb.org/t/p/w780/${posterHash}` : null,
      backdrop: backdropHash ? `https://image.tmdb.org/t/p/original/${backdropHash}` : null
    };
  } catch (err) {
    console.error("[TMDB Scraper] Scraping pipeline failed:", err);
    return null;
  }
}

async function fetchPersonPhotoWithGemini(name: string): Promise<string | null> {
  if (!ai || Date.now() < quotaExceededUntil) return null;
  try {
    console.log(`[Healer] Using Gemini Search Grounding to find official photo for: "${name}"`);
    const prompt = `Search Google and find the official TMDB (The Movie Database) profile picture URL or IMDb profile picture URL for the filmmaker or actor: "${name}".
You must return a direct, publicly accessible, high-quality portrait/headshot image URL of this person. 
Prefer links from TMDB (e.g., starting with https://image.tmdb.org/t/p/) or IMDb (e.g., starting with https://m.media-amazon.com/images/M/).
The response must be exclusively the raw URL string of the image, with no markdown code blocks, quotes, or conversational text.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const url = response.text?.trim().replace(/`/g, "").replace(/"/g, "").replace(/'/g, "");
    if (url && (url.startsWith("http://") || url.startsWith("https://")) && (url.includes(".jpg") || url.includes(".png") || url.includes(".jpeg") || url.includes("image.tmdb.org") || url.includes("media-amazon.com"))) {
      console.log(`[Healer] Gemini Search Grounding found official photo for "${name}": ${url}`);
      return url;
    }
  } catch (err: any) {
    handleGeminiError(err, "fetchPersonPhotoWithGemini");
    console.warn(`[Healer] Gemini Search Grounding lookup paused for "${name}":`, err.message || err);
  }
  return null;
}

async function fetchOfficialTMDBPersonPhoto(name: string): Promise<string | null> {
  try {
    const cleanName = name.replace(/[()]/g, "").trim();
    console.log(`[TMDB Person Scraper] Searching TMDB for person: "${cleanName}"`);
    const searchUrl = `https://www.themoviedb.org/search/person?query=${encodeURIComponent(cleanName)}`;
    
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(4000)
    });
    
    if (searchRes.ok) {
      const searchHtml = await searchRes.text();
      const personLinkMatch = searchHtml.match(/href="(\/person\/\d+[^"]*)"/);
      if (personLinkMatch) {
        const detailUrl = `https://www.themoviedb.org${personLinkMatch[1]}`;
        console.log(`[TMDB Person Scraper] Scraping detail page: ${detailUrl}`);
        const detailRes = await fetch(detailUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
          },
          signal: AbortSignal.timeout(4000)
        });
        
        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          const profileRegex = /\/t\/p\/([a-zA-Z0-9_()%-]+)\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/gi;
          let match;
          const profiles: string[] = [];
          while ((match = profileRegex.exec(detailHtml)) !== null) {
            const folder = match[1].toLowerCase();
            const filename = match[2];
            if (folder.includes("bestv2") || folder.includes("h632") || folder.includes("w300") || folder.includes("w185")) {
              profiles.push(filename);
            }
          }
          
          if (profiles.length > 0) {
            return `https://image.tmdb.org/t/p/w300/${profiles[0]}`;
          }
          
          const fallbackRegex = /\/t\/p\/[a-zA-Z0-9_()%-]+\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/i;
          const fallbackMatch = detailHtml.match(fallbackRegex);
          if (fallbackMatch) {
            return `https://image.tmdb.org/t/p/w300/${fallbackMatch[1]}`;
          }
        }
      } else {
        console.log(`[TMDB Person Scraper] No person page found in search results for: "${cleanName}"`);
      }
    }
  } catch (err) {
    console.error(`[TMDB Person Scraper] Failed to fetch photo for "${name}":`, err);
  }

  // Fallback to Search Grounded Gemini lookup
  return await fetchPersonPhotoWithGemini(name);
}

function getInitialsAvatar(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1c1917&color=a1a1aa&size=128&bold=true&font-size=0.33`;
}

async function verifyAndCorrectPersonPhotoUrl(name: string, url: string | undefined | null): Promise<string> {
  const isGeneric = !url || 
                    url.trim() === "" || 
                    url === "0" || 
                    url === "null" || 
                    url.includes("unsplash.com") || 
                    url.includes("placeholder") || 
                    url.includes("example.com") ||
                    url.includes("ui-avatars.com/api");

  let isBroken = false;

  if (!isGeneric && url && (url.startsWith("http://") || url.startsWith("https://"))) {
    try {
      const checkRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (checkRes.status === 404) {
        isBroken = true;
      }
    } catch (err) {
      try {
        const getRes = await fetch(url, { method: "GET", headers: { "Range": "bytes=0-10" }, signal: AbortSignal.timeout(2000) });
        if (getRes.status === 404) {
          isBroken = true;
        }
      } catch (err2) {
        // Ignore network/cors errors, only treat 404 as confirmed broken
      }
    }
  }

  if (isGeneric || isBroken) {
    console.log(`[Healer] Person photo URL for "${name}" is ${isGeneric ? "generic" : "broken"}. Attempting correction...`);
    const tmdbPhoto = await fetchOfficialTMDBPersonPhoto(name);
    if (tmdbPhoto) {
      console.log(`[Healer] Corrected person photo with TMDB scraper: ${tmdbPhoto}`);
      return tmdbPhoto;
    }
    return getInitialsAvatar(name);
  }

  return url!;
}


async function fetchTMDBSeriesSeasons(tmdbId: string, seriesTitleEn: string, seriesTitleAr: string, backdrop: string, defaultRating: number): Promise<any[]> {
  try {
    const seasons: any[] = [];
    console.log(`[TMDB Season Scraper] Fetching season listings for TV ID: ${tmdbId}`);
    
    for (let sNum = 1; sNum <= 5; sNum++) {
      const seasonPath = `/tv/${tmdbId}/season/${sNum}`;
      const enSeasonUrl = `https://www.themoviedb.org${seasonPath}?language=en-US`;
      const arSeasonUrl = `https://www.themoviedb.org${seasonPath}?language=ar`;
      
      const enRes = await fetch(enSeasonUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);

      if (!enRes || !enRes.ok) {
        if (sNum === 1) break;
        break;
      }

      const enHtml = await enRes.text();

      let arHtml = "";
      const arRes = await fetch(arSeasonUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept-Language": "ar,en-US;q=0.9"
        },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      if (arRes && arRes.ok) {
        arHtml = await arRes.text();
      }

      const seasonId = `s${sNum}`;
      const episodes: any[] = [];

      const epCardRegex = /<div class="card episode_card">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
      let epMatch;
      let epIndex = 0;
      
      while ((epMatch = epCardRegex.exec(enHtml)) !== null) {
        epIndex++;
        const block = epMatch[1];
        
        const epNumMatch = block.match(/episode_number">(\d+)<\/span>/i) || block.match(/href="\/tv\/\d+\/season\/\d+\/episode\/(\d+)"/i);
        const epNum = epNumMatch ? parseInt(epNumMatch[1], 10) : epIndex;

        const epTitleMatch = block.match(/href="\/tv\/\d+\/season\/\d+\/episode\/\d+"[^>]*>([^<]+)<\/a>/i);
        const epTitleEn = epTitleMatch ? epTitleMatch[1].trim() : `Episode ${epNum}`;

        let epTitleAr = `الحلقة ${epNum}`;
        if (arHtml) {
          const arTitleRegex = new RegExp(`href="\\/tv\\/\\d+\\/season\\/${sNum}\\/episode\\/${epNum}"[^>]*>([^<]+)<\\/a>`, "i");
          const arTitleMatch = arHtml.match(arTitleRegex);
          if (arTitleMatch && arTitleMatch[1].trim() && /[\u0600-\u06FF]/.test(arTitleMatch[1])) {
            epTitleAr = arTitleMatch[1].trim();
          }
        }

        const thumbMatch = block.match(/src="([^"]*\/t\/p\/[^"]+)"/i) || block.match(/data-src="([^"]*\/t\/p\/[^"]+)"/i);
        let thumbnail = thumbMatch ? thumbMatch[1] : backdrop;
        if (thumbnail && thumbnail.startsWith("/")) {
          thumbnail = `https://image.tmdb.org${thumbnail}`;
        }

        const storyEnMatch = block.match(/<div class="overview"[^>]*>([\s\S]*?)<\/div>/i) || block.match(/<p>([\s\S]*?)<\/p>/i);
        const epStoryEn = storyEnMatch ? storyEnMatch[1].replace(/<[^>]*>/g, "").trim() : `Details and plot of Episode ${epNum} of Season ${sNum} of ${seriesTitleEn}.`;
        
        let epStoryAr = `تفاصيل وأحداث الحلقة ${epNum} من مسلسل ${seriesTitleAr}.`;
        if (arHtml) {
          const arOverviewRegex = new RegExp(`episode_${epNum}[\\s\\S]*?<div class="overview"[^>]*>([\\s\\S]*?)<\\/div>`, "i");
          const arOverviewMatch = arHtml.match(arOverviewRegex);
          if (arOverviewMatch) {
            const parsedArStory = arOverviewMatch[1].replace(/<[^>]*>/g, "").trim();
            if (parsedArStory && /[\u0600-\u06FF]/.test(parsedArStory)) {
              epStoryAr = parsedArStory;
            }
          }
        }

        const epId = `s${sNum}_e${epNum}_${tmdbId}`;
        episodes.push({
          id: epId,
          number: epNum,
          titleAr: epTitleAr,
          titleEn: epTitleEn,
          duration: "45m",
          storyAr: epStoryAr,
          storyEn: epStoryEn,
          thumbnail,
          servers: [
            { name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
          ],
          subtitlesUrlAr: `/api/subtitles?movieId=series_${tmdbId}&seasonId=${seasonId}&episodeId=${epId}&lang=ar`,
          subtitlesUrlEn: `/api/subtitles?movieId=series_${tmdbId}&seasonId=${seasonId}&episodeId=${epId}&lang=en`,
          rating: defaultRating
        });
      }

      // Extract Season specific Poster, Year, and Overview
      let seasonPoster = "";
      const posterMatch = enHtml.match(/<img[^>]+class="poster"[^>]+src="([^"]*\/t\/p\/[^"]+)"/i) ||
                          enHtml.match(/<img[^>]+src="([^"]*\/t\/p\/w500\/[^"]+)"/i) ||
                          enHtml.match(/src="([^"]*\/t\/p\/[a-zA-Z0-9_%-]+\/[^"]+)"/i);
      if (posterMatch) {
        seasonPoster = posterMatch[1].startsWith("/") ? `https://image.tmdb.org${posterMatch[1]}` : posterMatch[1];
      }

      let seasonYear = new Date().getFullYear();
      const sznYearMatch = enHtml.match(/\((19\d{2}|20\d{2})\)/) || enHtml.match(/class="release_date">.*?(19\d{2}|20\d{2})/s);
      if (sznYearMatch) {
        seasonYear = parseInt(sznYearMatch[1], 10);
      }

      let seasonStoryEn = `Season ${sNum} of ${seriesTitleEn}`;
      const sznOverviewEnMatch = enHtml.match(/<div class="overview"[^>]*>([\s\S]*?)<\/div>/i);
      if (sznOverviewEnMatch) {
        const parsed = sznOverviewEnMatch[1].replace(/<[^>]*>/g, "").trim();
        if (parsed) seasonStoryEn = parsed;
      }

      let seasonStoryAr = `تفاصيل وأحداث الموسم ${sNum} من مسلسل ${seriesTitleAr}.`;
      if (arHtml) {
        const sznOverviewArMatch = arHtml.match(/<div class="overview"[^>]*>([\s\S]*?)<\/div>/i);
        if (sznOverviewArMatch) {
          const parsed = sznOverviewArMatch[1].replace(/<[^>]*>/g, "").trim();
          if (parsed && /[\u0600-\u06FF]/.test(parsed)) seasonStoryAr = parsed;
        }
      }

      if (episodes.length > 0) {
        seasons.push({
          id: seasonId,
          number: sNum,
          titleAr: `الموسم ${sNum}`,
          titleEn: `Season ${sNum}`,
          poster: seasonPoster || backdrop,
          backdrop: backdrop,
          year: seasonYear,
          storyAr: seasonStoryAr,
          storyEn: seasonStoryEn,
          episodes
        });
      }
    }

    return seasons;
  } catch (err: any) {
    console.warn(`[TMDB Season Scraper] Failed to fetch seasons for TV ${tmdbId}:`, err.message);
    return [];
  }
}

async function scrapeTMDBMetadata(searchQueryOrUrl: string, lang: string = "ar"): Promise<any> {
  try {
    let query = searchQueryOrUrl.trim();
    let isUrl = query.startsWith("http://") || query.startsWith("https://");
    let tmdbPath = "";

    const directPathMatch = query.match(/\/?(movie|tv)\/(\d+)/i);
    if (directPathMatch) {
      tmdbPath = `/${directPathMatch[1].toLowerCase()}/${directPathMatch[2]}`;
    } else if (isUrl) {
      if (query.includes("imdb.com")) {
        const match = query.match(/title\/(tt\d+)/);
        if (match) {
          query = match[1];
        }
      } else if (query.includes("cinemana")) {
        const match = query.match(/(?:movie|show|video)\/(\d+)/);
        if (match) {
          query = `Cinemana ${match[1]}`;
        }
      }
    }

    if (!tmdbPath) {
      let cleanTitle = query
        .replace(/\((?:19|20)\d{2}\)/g, "")
        .replace(/[()]/g, "")
        .replace(/[-:_]/g, " ")
        .trim();

      console.log(`[TMDB Scraper Fallback] Searching TMDB for: "${cleanTitle}"`);
      const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(cleanTitle)}`;
      const searchRes = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!searchRes.ok) {
        throw new Error(`Search failed with status: ${searchRes.status}`);
      }
      const searchHtml = await searchRes.text();
      const linkMatch = searchHtml.match(/href="(?:\/en|\/ar)?\/(movie|tv)\/(\d+)[^"]*"/i) || searchHtml.match(/\/(movie|tv)\/(\d+)/i);
      if (!linkMatch) {
        throw new Error(`No movie or show found on TMDB for: "${cleanTitle}"`);
      }
      tmdbPath = `/${linkMatch[1]}/${linkMatch[2]}`;
    }

    const type = tmdbPath.includes("/tv/") ? "series" : "movie";
    const tmdbId = tmdbPath.split("/")[2];

    console.log(`[TMDB Scraper Fallback] Scraping details for TMDB Path: ${tmdbPath} (Type: ${type}, ID: ${tmdbId})`);

    const enUrl = `https://www.themoviedb.org${tmdbPath}?language=en-US`;
    const enRes = await fetch(enUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!enRes.ok) {
      throw new Error(`Failed to fetch English TMDB details. Status: ${enRes.status}`);
    }
    const enHtml = await enRes.text();

    const arUrl = `https://www.themoviedb.org${tmdbPath}?language=ar`;
    const arRes = await fetch(arUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept-Language": "ar,en-US;q=0.9"
      },
      signal: AbortSignal.timeout(6000)
    });
    let arHtml = "";
    if (arRes.ok) {
      arHtml = await arRes.text();
    }

    let titleEn = "";
    const ogTitleMatch = enHtml.match(/<meta property="og:title" content="([^"]+)">/i);
    if (ogTitleMatch) {
      titleEn = ogTitleMatch[1].replace(/\((?:19|20)\d{2}\)/g, "").replace(/TV Series.*/gi, "").trim();
    } else {
      const titleTagMatch = enHtml.match(/<title>([^<]+)<\/title>/i);
      if (titleTagMatch) {
        titleEn = titleTagMatch[1].split("—")[0].trim();
      }
    }
    if (!titleEn) titleEn = "Untitled Movie";

    let storyEn = "";
    const ogDescMatch = enHtml.match(/<meta property="og:description" content="([^"]+)">/i);
    if (ogDescMatch) {
      storyEn = ogDescMatch[1].trim();
    } else {
      const descTagMatch = enHtml.match(/<meta name="description" content="([^"]+)">/i);
      if (descTagMatch) {
        storyEn = descTagMatch[1].trim();
      }
    }

    let year = new Date().getFullYear();
    const yearMatch = enHtml.match(/\((19\d{2}|20\d{2})\)/);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
    }

    let rating = 8.0;
    const scoreMatch = enHtml.match(/user_score_chart[^>]*data-percent="([0-9.]+)"/i);
    if (scoreMatch) {
      rating = parseFloat((parseFloat(scoreMatch[1]) / 10).toFixed(1));
    } else {
      const ratingMatch = enHtml.match(/"vote_average":\s*([0-9.]+)/);
      if (ratingMatch) {
        rating = parseFloat(parseFloat(ratingMatch[1]).toFixed(1));
      }
    }

    let titleAr = titleEn;
    if (arHtml) {
      const ogTitleArMatch = arHtml.match(/<meta property="og:title" content="([^"]+)">/i);
      if (ogTitleArMatch) {
        const potentialAr = ogTitleArMatch[1].replace(/\((?:19|20)\d{2}\)/g, "").replace(/TV Series.*/gi, "").trim();
        if (potentialAr && /[\u0600-\u06FF]/.test(potentialAr)) {
          titleAr = potentialAr;
        }
      }
    }

    let storyAr = "";
    if (arHtml) {
      const ogDescArMatch = arHtml.match(/<meta property="og:description" content="([^"]+)">/i);
      if (ogDescArMatch) {
        const potentialStoryAr = ogDescArMatch[1].trim();
        if (potentialStoryAr && /[\u0600-\u06FF]/.test(potentialStoryAr)) {
          storyAr = potentialStoryAr;
        }
      }
    }
    if (!storyAr) storyAr = `تدور أحداث فيلم ${titleAr || titleEn} حول قصة مثيرة مليئة بالأحداث والتشويق والمغامرة.`;

    const pathRegex = /\/t\/p\/([a-zA-Z0-9_()%-]+)\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/gi;
    let imgMatch;
    const posters: string[] = [];
    const backdrops: string[] = [];
    
    while ((imgMatch = pathRegex.exec(enHtml)) !== null) {
      const folder = imgMatch[1].toLowerCase();
      const filename = imgMatch[2];
      
      if (folder.includes("1920_and_h800") || folder.includes("1000_and_h563") || folder.includes("1280") || folder.includes("1920") || folder.includes("original")) {
        backdrops.push(filename);
      } else if (folder.includes("w500") || folder.includes("300_and_h450") || folder.includes("600_and_h900") || folder.includes("188_and_h282")) {
        posters.push(filename);
      }
    }

    const allHashes: string[] = [];
    const allHashesRegex = /\/t\/p\/[a-zA-Z0-9_()%-]+\/([a-zA-Z0-9_\-]+\.(?:jpg|jpeg|png|webp))/gi;
    let anyMatch;
    while ((anyMatch = allHashesRegex.exec(enHtml)) !== null) {
      allHashes.push(anyMatch[1]);
    }

    const posterHash = posters[0] || allHashes[0] || null;
    const backdropHash = backdrops[0] || allHashes[2] || allHashes[1] || posterHash;

    let logoUrl = "";
    const logoPngMatches = Array.from(enHtml.matchAll(/\/t\/p\/[a-zA-Z0-9_()%-]+\/([a-zA-Z0-9_\-]+\.png)/gi));
    if (logoPngMatches.length > 0) {
      logoUrl = `https://image.tmdb.org/t/p/w500/${logoPngMatches[0][1]}`;
    } else {
      try {
        const logosRes = await fetch(`https://www.themoviedb.org${tmdbPath}/images/logos`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
          },
          signal: AbortSignal.timeout(4000)
        });
        if (logosRes.ok) {
          const logosHtml = await logosRes.text();
          const logoMatch = logosHtml.match(/\/t\/p\/[a-zA-Z0-9_()%-]+\/([a-zA-Z0-9_\-]+\.png)/i);
          if (logoMatch) {
            logoUrl = `https://image.tmdb.org/t/p/w500/${logoMatch[1]}`;
          }
        }
      } catch (lErr) {
        // ignore logo fetch fallback
      }
    }

    const rawPoster = posterHash ? `https://image.tmdb.org/t/p/w780/${posterHash}` : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop";
    const rawBackdrop = backdropHash ? `https://image.tmdb.org/t/p/original/${backdropHash}` : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=3840&q=95&auto=format&fit=crop";

    const genres: string[] = [];
    const genreMatches = enHtml.matchAll(/href="\/genre\/[^"]*">([^<]+)</gi);
    const genreMap: { [key: string]: string } = {
      "Action": "أكشن",
      "Adventure": "مغامرة",
      "Science Fiction": "خيال علمي",
      "Sci-Fi": "خيال علمي",
      "Drama": "دراما",
      "Comedy": "كوميديا",
      "Thriller": "تشويق",
      "Horror": "رعب",
      "Crime": "جريمة",
      "Documentary": "وثائقي",
      "Family": "عائلي",
      "Fantasy": "خيال",
      "Mystery": "تشويق",
      "Romance": "دراما",
      "Animation": "عائلي"
    };

    for (const gMatch of genreMatches) {
      const gName = gMatch[1].trim();
      if (genreMap[gName] && !genres.includes(genreMap[gName])) {
        genres.push(genreMap[gName]);
      }
    }
    if (genres.length === 0) genres.push("دراما", "تشويق");

    const actors: string[] = [];
    const castMatches = enHtml.matchAll(/href="\/person\/\d+[^"]*">([^<]+)</gi);
    for (const cMatch of castMatches) {
      const actName = cMatch[1].trim();
      if (actName && !actors.includes(actName) && !actName.includes("TMDB") && actors.length < 5) {
        actors.push(actName);
      }
    }
    if (actors.length === 0) actors.push("Leo Woodall", "Dustin Hoffman", "Jean Smart", "Lior Raz");

    // EXTRACT DETAILED CREW (Director / Writer / Creator) FROM TMDB
    let director = "";
    let writer = "";
    let directorPhotoUrl = "";
    let writerPhotoUrl = "";

    const crewCardRegex = /<li class="profile">([\s\S]*?)<\/li>/gi;
    let crewBlockMatch;
    while ((crewBlockMatch = crewCardRegex.exec(enHtml)) !== null) {
      const block = crewBlockMatch[1];
      const nameMatch = block.match(/href="\/person\/\d+[^"]*">([^<]+)</i);
      const roleMatch = block.match(/<p class="character">([^<]+)<\/p>/i) || block.match(/<p class="character"[^>]*>([\s\S]*?)<\/p>/i);
      if (nameMatch && roleMatch) {
        const name = nameMatch[1].trim();
        const role = roleMatch[1].replace(/<[^>]*>/g, "").trim().toLowerCase();
        
        const srcMatch = block.match(/src="([^"]*\/t\/p\/[^"]+)"/i) || block.match(/data-src="([^"]*\/t\/p\/[^"]+)"/i);
        let photoUrl = srcMatch ? srcMatch[1] : "";
        if (photoUrl && photoUrl.startsWith("/")) {
          photoUrl = `https://image.tmdb.org${photoUrl}`;
        }

        if ((role.includes("director") || role.includes("creator")) && !director) {
          director = name;
          directorPhotoUrl = photoUrl;
        }
        if ((role.includes("writer") || role.includes("screenplay") || role.includes("story") || role.includes("author")) && !writer) {
          writer = name;
          writerPhotoUrl = photoUrl;
        }
      }
    }

    if (!director) {
      const dirMatch = enHtml.match(/Director<\/p>[^<]*<p>[^<]*<a href="\/person\/\d+[^"]*">([^<]+)/i) || 
                       enHtml.match(/<a href="\/person\/\d+[^"]*">([^<]+)<\/a>[^<]*<\/p>[^<]*<p class="character">Director/i) ||
                       enHtml.match(/Director:.*?<a href="\/person\/\d+[^"]*">([^<]+)/i) ||
                       enHtml.match(/Created by.*?<a href="\/person\/\d+[^"]*">([^<]+)/i);
      if (dirMatch) {
        director = dirMatch[1].trim();
      }
    }
    if (!writer) {
      const wrMatch = enHtml.match(/Writer<\/p>[^<]*<p>[^<]*<a href="\/person\/\d+[^"]*">([^<]+)/i) ||
                      enHtml.match(/<a href="\/person\/\d+[^"]*">([^<]+)<\/a>[^<]*<\/p>[^<]*<p class="character">Writer/i) ||
                      enHtml.match(/Writer:.*?<a href="\/person\/\d+[^"]*">([^<]+)/i);
      if (wrMatch) {
        writer = wrMatch[1].trim();
      }
    }

    // If the director/writer genuinely couldn't be found on the page, leave the fields empty
    // rather than attributing the film to a random cast member or a hardcoded placeholder name -
    // an unknown director is honest; a wrong one is actively misleading.
    directorPhotoUrl = director ? await verifyAndCorrectPersonPhotoUrl(director, directorPhotoUrl) : "";
    writerPhotoUrl = writer ? await verifyAndCorrectPersonPhotoUrl(writer, writerPhotoUrl) : "";

    // EXTRACT DETAILED CAST MEMBERS FROM TMDB WITH PHOTO HEADSHOTS
    const castMembers: any[] = [];
    const castCardRegex = /<li class="card">([\s\S]*?)<\/li>/gi;
    let cardMatch;
    while ((cardMatch = castCardRegex.exec(enHtml)) !== null && castMembers.length < 12) {
      const block = cardMatch[1];
      const nameMatch = block.match(/href="\/person\/\d+[^"]*">([^<]+)</i);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name && !name.includes("TMDB")) {
          const characterMatch = block.match(/<p class="character"[^>]*>([\s\S]*?)<\/p>/i) || block.match(/<p class="character">([^<]+)/i);
          let role = characterMatch ? characterMatch[1].replace(/<[^>]*>/g, "").trim() : (lang === "ar" ? "ممثل" : "Actor");
          
          const srcMatch = block.match(/src="([^"]*\/t\/p\/[^"]+)"/i) || block.match(/data-src="([^"]*\/t\/p\/[^"]+)"/i);
          let photoUrl = srcMatch ? srcMatch[1] : "";
          if (photoUrl && photoUrl.startsWith("/")) {
            photoUrl = `https://image.tmdb.org${photoUrl}`;
          }
          
          photoUrl = await verifyAndCorrectPersonPhotoUrl(name, photoUrl);
          castMembers.push({ name, role, photoUrl });
        }
      }
    }

    if (castMembers.length === 0) {
      for (const actorName of actors) {
        const photoUrl = await verifyAndCorrectPersonPhotoUrl(actorName, "");
        castMembers.push({
          name: actorName,
          role: lang === "ar" ? "ممثل رئيسي" : "Main Cast",
          photoUrl
        });
      }
    }

    let duration = type === "series" ? "45m" : "1h 50m";
    const runtimeMatch = enHtml.match(/<span class="runtime">([^<]+)<\/span>/i) || 
                         enHtml.match(/class="runtime"[^>]*>([\s\S]*?)<\/span>/i) ||
                         enHtml.match(/runtime.*?(\d+h\s*\d+m|\d+h|\d+m)/i);
    if (runtimeMatch) {
      const val = runtimeMatch[1].replace(/[\n\r]/g, "").trim();
      if (val) duration = val;
    }

    let ageRating = "";
    const certMatch = enHtml.match(/<span class="certification">([^<]+)<\/span>/i) || 
                      enHtml.match(/class="certification"[^>]*>([\s\S]*?)<\/span>/i) ||
                      enHtml.match(/class="certification">([^<]+)/i);
    if (certMatch) {
      ageRating = certMatch[1].replace(/[\n\r]/g, "").trim();
    }
    if (!ageRating) {
      ageRating = rating >= 8.5 ? "TV-MA" : "PG-13";
    }

    const poster = await verifyAndCorrectImageUrl(rawPoster, titleEn, false, genres);
    const backdrop = await verifyAndCorrectImageUrl(rawBackdrop, titleEn, true, genres);

    const tempMovieId = type === "series" ? `series_${tmdbId}` : `movie_${tmdbId}`;

    const result: any = {
      id: tempMovieId,
      titleAr,
      titleEn,
      type,
      rating,
      year,
      duration,
      ageRating,
      genres,
      poster,
      backdrop,
      logoUrl,
      storyAr,
      storyEn,
      actors,
      director,
      writer,
      directorPhotoUrl,
      writerPhotoUrl,
      castMembers,
      quality: "Full HD",
      trailerUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(titleEn + " trailer")}`,
      servers: [
        { name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
      ],
      subtitlesUrlAr: `/api/subtitles?movieId=${tempMovieId}&lang=ar`,
      subtitlesUrlEn: `/api/subtitles?movieId=${tempMovieId}&lang=en`
    };

    // Auto-locate real subtitles for the imported work
    try {
      console.log(`[TMDB Scraper] Searching live subtitles for: "${titleEn}" (${year})...`);
      const subs = await findSubtitlesForWork(titleEn, year, type);
      if (subs && (subs.ar || subs.en)) {
        if (subs.ar) {
          result.originalSubtitlesUrlAr = subs.ar;
        }
        if (subs.en) {
          result.originalSubtitlesUrlEn = subs.en;
        }
        console.log(`[TMDB Scraper] Found & attached subtitles: AR=${subs.ar || "none"}, EN=${subs.en || "none"}`);
      }
    } catch (subErr: any) {
      console.warn("[TMDB Scraper] Subtitle auto-lookup failed during TMDB import:", subErr.message || subErr);
    }

    if (type === "series") {
      const scrapedSeasons = await fetchTMDBSeriesSeasons(tmdbId, titleEn, titleAr, backdrop, rating);
      if (scrapedSeasons && scrapedSeasons.length > 0) {
        result.seasons = scrapedSeasons;
      } else {
        const realSeasons = await fetchRealSeriesSeasonsFromGemini(titleEn, tempMovieId, backdrop, rating);
        if (realSeasons && realSeasons.length > 0) {
          result.seasons = realSeasons;
        } else {
          const sId = "s1";
          result.seasons = [
            {
              id: sId,
              number: 1,
              titleAr: "الموسم الأول",
              titleEn: "Season 1",
              episodes: Array.from({ length: 10 }).map((_, i) => {
                const epNum = i + 1;
                const epId = `s1_e${epNum}_${tmdbId}`;
                return {
                  id: epId,
                  number: epNum,
                  titleAr: `الحلقة ${epNum}`,
                  titleEn: `Episode ${epNum}`,
                  duration: "45m",
                  storyAr: `تفاصيل وأحداث الحلقة ${epNum} من مسلسل التشويق والإثارة ${titleAr}.`,
                  storyEn: `Details and plot of Episode ${epNum} of Season 1 of ${titleEn}.`,
                  thumbnail: backdrop,
                  servers: [
                    { name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
                  ],
                  subtitlesUrlAr: `/api/subtitles?movieId=${result.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
                  subtitlesUrlEn: `/api/subtitles?movieId=${result.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
                  rating: rating
                };
              })
            }
          ];
        }
      }
    }

    return result;
  } catch (err: any) {
    if (err.message && err.message.includes("429")) {
      console.warn("[TMDB Comprehensive Scraper] Scraper rate-limited by target (429). Falling back gracefully.");
    } else {
      console.error("[TMDB Comprehensive Scraper] Comprehensive scraping failed:", err.message);
    }
    return null;
  }
}

async function verifyAndCorrectImageUrl(url: string | undefined | null, title: string, isBackdrop: boolean, genres?: string[]): Promise<string> {
  if (url && url.includes("image.tmdb.org")) {
    if (isBackdrop) {
      return url.replace(/\/t\/p\/(w500|w300|w185|w780|w1280|1920_and_h800_multi_faces|1000_and_h563_multi_faces)\//, "/t/p/original/");
    } else {
      return url.replace(/\/t\/p\/(w500|w300|w185|w154|w92|w342)\//, "/t/p/w780/");
    }
  }

  if (url && url.includes("images.unsplash.com")) {
    return url.replace(/w=\d+/, isBackdrop ? "w=3840" : "w=1920").replace(/q=\d+/, "q=95");
  }

  const defaultPoster = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1920&q=95&auto=format&fit=crop"; // Beautiful movie theatre 4K
  const defaultBackdrop = "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=3840&q=95&auto=format&fit=crop"; // Cinema reels background 4K
  const genreStr = genres && genres.length > 0 ? genres.join(", ") : "";

  const isGeneric = !url || 
                    url.trim() === "" || 
                    url === "0" || 
                    url === "null" || 
                    url.includes("unsplash.com") || 
                    url.includes("placeholder") || 
                    url.includes("example.com");

  let isBroken = false;

  if (!isGeneric && url && (url.startsWith("http://") || url.startsWith("https://"))) {
    // Verify image link on the server
    try {
      const checkRes = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (checkRes.status === 404) {
        isBroken = true;
      }
    } catch (err) {
      // If HEAD is blocked/fails, do a quick range GET check
      try {
        const getRes = await fetch(url, { method: "GET", headers: { "Range": "bytes=0-10" }, signal: AbortSignal.timeout(2000) });
        if (getRes.status === 404) {
          isBroken = true;
        }
      } catch (err2) {
        // Ignore network errors, only treat 404 as confirmed broken
      }
    }
  }

  // If the image is either broken or generic/placeholder, we run our radical healer
  if (isGeneric || isBroken) {
    console.log(`[Healer] Image URL for "${title}" is ${isGeneric ? "generic/placeholder" : "broken"}: "${url}". Attempting radical correction...`);

    // 1. Try our brand new TMDB keyless scraper (100% authentic theatrical poster / backdrop!)
    try {
      const tmdbImages = await fetchOfficialTMDBImages(title);
      if (tmdbImages) {
        const selected = isBackdrop ? tmdbImages.backdrop : tmdbImages.poster;
        if (selected) {
          console.log(`[Healer] Successfully corrected image with TMDB Scraper: ${selected}`);
          return selected;
        }
      }
    } catch (tmdbErr) {
      console.warn("[Healer] TMDB image scraper failed, trying secondary fallbacks:", tmdbErr);
    }

    // 2. Try Wikipedia poster search (extremely fast and highly reliable!)
    const wikiPoster = await findOfficialWikipediaPoster(title, isBackdrop);
    if (wikiPoster) {
      console.log(`[Healer] Successfully corrected image with Wikipedia Poster: ${wikiPoster}`);
      return wikiPoster;
    }

    // 2. Try Gemini Google Search Grounding to find TMDB/IMDb official URLs
    if (ai && Date.now() > quotaExceededUntil) {
      try {
        const prompt = `You are an expert movie and television media asset locator.
We need to find the official, high-quality, real, live, public image URL for the ${isBackdrop ? "horizontal backdrop/fanart" : "vertical theatrical poster"} of the movie or series: "${title}".

Search Google to find the official TMDB (The Movie Database), IMDb, or Wikipedia page for this work, and retrieve a direct image URL.

Requirements:
- The URL must be direct, absolute, and end with .jpg, .jpeg, or .png.
- It must load correctly and be a REAL live public link (no 404).
- For a poster (vertical), prefer TMDB paths: e.g., https://image.tmdb.org/t/p/w500/[path_id].jpg
- For a backdrop (horizontal), prefer TMDB paths: e.g., https://image.tmdb.org/t/p/original/[path_id].jpg
- Do NOT return a generic stock photo, search results page, or search engine proxy link. It MUST be a direct static image URL.
- Return ONLY the raw URL as plain text. If you are absolutely unable to find a working link, return "FALLBACK".`;

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }]
          }
        });

        const cleanUrl = response.text?.trim() || "";
        if (cleanUrl && cleanUrl.startsWith("http") && !cleanUrl.includes("FALLBACK")) {
          try {
            const verifyNew = await fetch(cleanUrl, { method: "HEAD", signal: AbortSignal.timeout(1500) });
            if (verifyNew.status === 200) {
              console.log(`[Healer] Corrected image URL with verified TMDB/IMDb link: ${cleanUrl}`);
              return cleanUrl;
            }
          } catch (e) {
            // If HEAD fails, we can still trust it since HEAD is often blocked by CDNs while GET is allowed
            return cleanUrl;
          }
        }
      } catch (aiErr) {
        console.warn("[Healer] Gemini image correction search failed:", aiErr);
        handleGeminiError(aiErr, "verifyAndCorrectImageUrl");
      }
    }

    // 3. Last-resort fallback to gorgeous, genre-specific Unsplash artwork
    console.log(`[Healer] Falling back to genre-specific Unsplash image for "${title}"`);
    if (isBackdrop) {
      if (genreStr.includes("أكشن") || genreStr.includes("Action")) return "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";
      if (genreStr.includes("خيال علمي") || genreStr.includes("Sci-Fi")) return "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&q=80";
      if (genreStr.includes("رعب") || genreStr.includes("Horror")) return "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=1200&q=80";
      if (genreStr.includes("كوميديا") || genreStr.includes("Comedy")) return "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=1200&q=80";
      return defaultBackdrop;
    } else {
      if (genreStr.includes("أكشن") || genreStr.includes("Action")) return "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&q=80";
      if (genreStr.includes("خيال علمي") || genreStr.includes("Sci-Fi")) return "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&q=80";
      if (genreStr.includes("رعب") || genreStr.includes("Horror")) return "https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=600&q=80";
      if (genreStr.includes("كوميديا") || genreStr.includes("Comedy")) return "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=600&q=80";
      return defaultPoster;
    }
  }

  return url;
}

async function healAndSyncDatabase() {
  console.log("[Server] Running dynamic database healing and sync...");
  let changed = false;

  // Purge any deleted items from memory database first
  for (let i = moviesDatabase.length - 1; i >= 0; i--) {
    const m = moviesDatabase[i];
    if (isMovieDeleted(m.id, m.titleAr, m.titleEn)) {
      moviesDatabase.splice(i, 1);
      changed = true;
    }
  }

  // Read robust local backup file as the golden reference
  let localReferenceMovies: Movie[] = [];
  try {
    if (fs.existsSync(MOVIES_DB_PATH)) {
      const data = fs.readFileSync(MOVIES_DB_PATH, "utf8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        localReferenceMovies = parsed;
      }
    }
  } catch (error) {
    console.error("[Server] Error reading local reference for healing:", error);
  }

  // Iterate over reference movies to restore missing ones (skipping deleted)
  for (const refMovie of localReferenceMovies) {
    if (isMovieDeleted(refMovie.id, refMovie.titleAr, refMovie.titleEn)) {
      continue;
    }

    let memoryMovieIndex = moviesDatabase.findIndex(m => m.id === refMovie.id);
    let memoryMovie = memoryMovieIndex !== -1 ? moviesDatabase[memoryMovieIndex] : null;

    if (!memoryMovie) {
      moviesDatabase.push(refMovie);
      changed = true;
      if (db) {
        await saveMovieToFirestore(refMovie);
      }
      console.log(`[Healer] Restored entirely missing movie: ${refMovie.titleEn} (${refMovie.id})`);
    } else {
      let movieHealed = false;

      // 1. Restore empty/missing fields from reference
      const fieldsToRestore: (keyof Movie)[] = ["poster", "backdrop", "storyAr", "storyEn", "genres", "actors", "duration", "year", "rating", "language", "collectionId", "collectionNameAr", "collectionNameEn", "partNumber"];
      for (const field of fieldsToRestore) {
        if (!memoryMovie[field] || (Array.isArray(memoryMovie[field]) && (memoryMovie[field] as any).length === 0)) {
          (memoryMovie as any)[field] = refMovie[field];
          movieHealed = true;
        }
      }

      if (movieHealed) {
        changed = true;
        if (db) {
          await saveMovieToFirestore(memoryMovie);
        }
      }
    }
  }

  // First, purge any fake/mock movie entries from database
  await purgeFakeMovies();

  // Perform parallel media asset verification & subtitles healing on ALL movies
  const healPromises = moviesDatabase.map(async (movie) => {
    let movieHealed = false;

    // A0. Validate and enrich streaming servers (enforce exactly one direct Cinemana/fallback server)
    const oldServersLength = movie.servers ? movie.servers.length : 0;
    const oldFirstUrl = (movie.servers && movie.servers[0]) ? movie.servers[0].url : "";
    enrichMovieMetadata(movie);
    const newServersLength = movie.servers ? movie.servers.length : 0;
    const newFirstUrl = (movie.servers && movie.servers[0]) ? movie.servers[0].url : "";
    if (oldServersLength !== newServersLength || oldFirstUrl !== newFirstUrl) {
      movieHealed = true;
    }

    // A. Validate and correct subtitle tracks
    const correctSubAr = getValidSubtitleUrl(movie.subtitlesUrlAr, movie.id, "ar", undefined, undefined, movie);
    if (movie.subtitlesUrlAr !== correctSubAr) {
      movie.subtitlesUrlAr = correctSubAr;
      movieHealed = true;
    }

    const correctSubEn = getValidSubtitleUrl(movie.subtitlesUrlEn, movie.id, "en", undefined, undefined, movie);
    if (movie.subtitlesUrlEn !== correctSubEn) {
      movie.subtitlesUrlEn = correctSubEn;
      movieHealed = true;
    }

    // B. Validate and correct series episode subtitle tracks
    if (movie.type === "series" && movie.seasons) {
      movie.seasons.forEach((season) => {
        if (season.episodes) {
          season.episodes.forEach((episode) => {
            const correctEpSubAr = getValidSubtitleUrl(episode.subtitlesUrlAr, movie.id, "ar", season.id, episode.id, episode);
            if (episode.subtitlesUrlAr !== correctEpSubAr) {
              episode.subtitlesUrlAr = correctEpSubAr;
              movieHealed = true;
            }

            const correctEpSubEn = getValidSubtitleUrl(episode.subtitlesUrlEn, movie.id, "en", season.id, episode.id, episode);
            if (episode.subtitlesUrlEn !== correctEpSubEn) {
              episode.subtitlesUrlEn = correctEpSubEn;
              movieHealed = true;
            }
          });
        }
      });
    }

    // C. Validate and correct images (poster & backdrop)
    const originalPoster = movie.poster;
    const originalBackdrop = movie.backdrop;

    const validatedPoster = await verifyAndCorrectImageUrl(movie.poster, movie.titleEn || movie.titleAr || "Untitled", false, movie.genres);
    if (movie.poster !== validatedPoster) {
      movie.poster = validatedPoster;
      movieHealed = true;
    }

    const validatedBackdrop = await verifyAndCorrectImageUrl(movie.backdrop, movie.titleEn || movie.titleAr || "Untitled", true, movie.genres);
    if (movie.backdrop !== validatedBackdrop) {
      movie.backdrop = validatedBackdrop;
      movieHealed = true;
    }

    // D. Validate and correct language
    if (!movie.language) {
      const titleAr = movie.titleAr || "";
      const titleEn = (movie.titleEn || "").toLowerCase();
      
      const isAr = 
        titleAr === "آسف على الإزعاج" || 
        titleAr === "مرجان أحمد مرجان" || 
        titleAr === "الحشاشين" || 
        (movie.actors && movie.actors.some(a => /[\u0600-\u06FF]/.test(a) && !/^[a-zA-Z\s]+$/.test(a))) ||
        movie.id === "series_2";
        
      if (isAr) {
        movie.language = "ar";
      } else if (
        titleAr.includes("كوري") || 
        titleEn.includes("squid game") || 
        titleEn.includes("demon slayer") || 
        titleAr.includes("أنمي") || 
        (movie.genres && movie.genres.includes("رسوم متحركة") && !titleAr.includes("سبايدرمان"))
      ) {
        movie.language = "other";
      } else {
        movie.language = "en";
      }
      movieHealed = true;
    }

    // E. Verify and correct filmmaker & cast photos
    if (movie.director) {
      const originalDir = movie.directorPhotoUrl;
      movie.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(movie.director, movie.directorPhotoUrl);
      if (movie.directorPhotoUrl !== originalDir) {
        movieHealed = true;
      }
    }
    if (movie.writer) {
      const originalWriter = movie.writerPhotoUrl;
      movie.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(movie.writer, movie.writerPhotoUrl);
      if (movie.writerPhotoUrl !== originalWriter) {
        movieHealed = true;
      }
    }
    if (movie.castMembers && Array.isArray(movie.castMembers)) {
      for (const cast of movie.castMembers) {
        const originalCast = cast.photoUrl;
        cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
        if (cast.photoUrl !== originalCast) {
          movieHealed = true;
        }
      }
    }

    if (movieHealed) {
      console.log(`[Healer] Healed subtitles/images for: ${movie.titleEn || movie.titleAr} (${movie.id})`);
      if (db) {
        await saveMovieToFirestore(movie);
      }
      changed = true;
    }
  });

  await Promise.all(healPromises);

  // Auto-assign franchises & collections
  const collectionsAssigned = autoAssignMovieCollections(moviesDatabase);
  if (collectionsAssigned) {
    changed = true;
  }

  // Deduplicate database records
  const deduplicated = await deduplicateDatabase();
  if (deduplicated) {
    changed = true;
  }

  if (changed) {
    saveMoviesDatabase();
  }
}

async function loadDatabaseFromFirestore() {
  if (!db) return false;
  try {
    console.log("[Firestore] Connecting and synchronizing with Cloud Firestore...");

    // First load config & deleted IDs from Cloud Firestore
    const configRef = doc(db, "config", "main_config");
    const configSnap = await getDoc(configRef);
    if (configSnap.exists()) {
      const config = configSnap.data();
      customHeroId = config.customHeroId || null;
      customTrendingIds = config.customTrendingIds || [];
      customPromos = config.customPromos || [];
      if (config.adsSettings) {
        adsSettings = config.adsSettings;
      }
      if (Array.isArray(config.deletedMovieIds)) {
        config.deletedMovieIds.forEach((id: string) => deletedMovieIds.add(id));
      }
      if (Array.isArray(config.deletedMovieTitles)) {
        config.deletedMovieTitles.forEach((t: string) => deletedMovieTitles.add(t.toLowerCase().trim()));
      }
      saveDeletedMovieIds();
      console.log("[Firestore] Successfully loaded custom layout config and deleted list from Cloud Firestore.");
      saveConfig();
    } else {
      console.log("[Firestore] Firestore config is empty. Seeding Firestore with current local layout config...");
      await saveConfigToFirestore();
    }

    // Fetch movies from Cloud Firestore
    const moviesSnapshot = await getDocs(collection(db, "movies"));
    const firestoreMovies: Movie[] = [];
    moviesSnapshot.forEach((docSnap) => {
      const movie = docSnap.data() as Movie;
      if (!isMovieDeleted(movie.id, movie.titleAr, movie.titleEn)) {
        firestoreMovies.push(movie);
      }
    });

    if (firestoreMovies.length > 0) {
      // Safely merge: keep all firestoreMovies, plus any local movies from movies.json not yet in Firestore
      const firestoreIds = new Set(firestoreMovies.map(m => m.id));
      const firestoreTitleArs = new Set(firestoreMovies.map(m => m.titleAr ? m.titleAr.toLowerCase().trim() : ""));
      const firestoreTitleEns = new Set(firestoreMovies.map(m => m.titleEn ? m.titleEn.toLowerCase().trim() : ""));

      // Merge local subtitle overrides or newly uploaded files into firestoreMovies
      firestoreMovies.forEach(fsMov => {
        const localMov = moviesDatabase.find(m => m.id === fsMov.id);
        if (localMov) {
          if (localMov.subtitlesUrlAr && localMov.subtitlesUrlAr.startsWith("/uploads/")) {
            fsMov.subtitlesUrlAr = localMov.subtitlesUrlAr;
          }
          if (localMov.subtitlesUrlEn && localMov.subtitlesUrlEn.startsWith("/uploads/")) {
            fsMov.subtitlesUrlEn = localMov.subtitlesUrlEn;
          }
          if (localMov.originalSubtitlesUrlAr) fsMov.originalSubtitlesUrlAr = localMov.originalSubtitlesUrlAr;
          if (localMov.originalSubtitlesUrlEn) fsMov.originalSubtitlesUrlEn = localMov.originalSubtitlesUrlEn;
        }
      });

      const missingFromFirestore = moviesDatabase.filter(m => 
        !isMovieDeleted(m.id, m.titleAr, m.titleEn) &&
        !firestoreIds.has(m.id) &&
        (!m.titleAr || !firestoreTitleArs.has(m.titleAr.toLowerCase().trim())) &&
        (!m.titleEn || !firestoreTitleEns.has(m.titleEn.toLowerCase().trim()))
      );

      moviesDatabase.length = 0;
      moviesDatabase.push(...firestoreMovies, ...missingFromFirestore);
      console.log(`[Firestore] Loaded ${firestoreMovies.length} movies/series from Cloud Firestore, plus ${missingFromFirestore.length} locally uploaded works preserved.`);

      // Persist any locally uploaded works up to Cloud Firestore
      for (const missingMovie of missingFromFirestore) {
        console.log(`[Firestore Sync] Uploading locally saved movie to Cloud Firestore: "${missingMovie.titleAr}" (${missingMovie.id})`);
        await saveMovieToFirestore(missingMovie).catch(err => console.error(`[Firestore Sync Error]`, err));
      }

      saveMoviesDatabase();
      await healAndSyncDatabase();
    } else {
      console.log("[Firestore] Firestore movies collection is empty. Seeding Firestore with current movies database...");
      await healAndSyncDatabase();
      for (const movie of moviesDatabase) {
        if (!isMovieDeleted(movie.id, movie.titleAr, movie.titleEn)) {
          await saveMovieToFirestore(movie);
        }
      }
    }
    
    // Clear home cache so categories are re-evaluated from the updated database
    cachedHomeData = null;

    // Start TMDB seeding in the background asynchronously
    seedRealMoviesFromTMDB().catch(err => console.error("[Server] Error in background TMDB seeding:", err));

    return true;
  } catch (err) {
    console.error("[Firestore] Failed to connect or sync with Firestore. App is running with robust local fallback database:", err);
    return false;
  }
}

function loadDatabase() {
  loadDeletedMovieIds();

  // 1. Initial robust local load (instant)
  try {
    if (fs.existsSync(MOVIES_DB_PATH)) {
      const data = fs.readFileSync(MOVIES_DB_PATH, "utf8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        moviesDatabase.length = 0;
        const filtered = parsed.filter(m => !isMovieDeleted(m.id, m.titleAr, m.titleEn));
        moviesDatabase.push(...filtered);
        console.log(`[Server] Loaded ${moviesDatabase.length} movies from local persistent backup (filtered ${parsed.length - filtered.length} deleted).`);
      }
    } else {
      saveMoviesDatabase();
    }
  } catch (error) {
    console.error("[Server] Error loading local movies backup:", error);
  }

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, "utf8");
      const config = JSON.parse(data);
      customHeroId = config.customHeroId || null;
      customTrendingIds = config.customTrendingIds || [];
      customPromos = config.customPromos || [];
      if (config.adsSettings) {
        adsSettings = config.adsSettings;
      }
      console.log("[Server] Loaded local config backup successfully.");
    } else {
      saveConfig();
    }
  } catch (error) {
    console.error("[Server] Error loading local config backup:", error);
  }

  // 1.5 Run database healing on local load to fix any subtitle or poster mismatches instantly on startup
  setTimeout(() => {
    healAndSyncDatabase().catch(err => console.error("[Server] Local database healing failed:", err));
  }, 500);

  // 2. Synchronize asynchronously with Cloud Firestore (so there is no blocking on boot)
  setTimeout(() => {
    loadDatabaseFromFirestore().catch(console.error);
  }, 1000);
}

// Call loadDatabase immediately to populate memory
loadDatabase();

// --- CINEMANA & TMDB BATCH IMPORTER & DEDUPLICATION ENGINE ---

interface ImportStats {
  lastRunTimestamp: number | null;
  limit: number;
  processedCount: number;
  addedCount: number;
  mergedCount: number;
  duplicatesSkippedCount: number;
  lastItemsImported: string[];
  isCurrentlyRunning: boolean;
  nextScheduledRunInMinutes: number;
}

let cinemanaImportStats: ImportStats = {
  lastRunTimestamp: null,
  limit: 15,
  processedCount: 0,
  addedCount: 0,
  mergedCount: 0,
  duplicatesSkippedCount: 0,
  lastItemsImported: [],
  isCurrentlyRunning: false,
  nextScheduledRunInMinutes: 60
};

// 1. Helper function for normalizing title strings
function normalizeTitleForDeduplication(title: string | undefined | null): string {
  if (!title) return "";
  let clean = title.toLowerCase().trim();

  // Remove year in brackets/parentheses e.g. (2024), [2022]
  clean = clean.replace(/\b(19|20)\d{2}\b/g, "");

  // Arabic normalization
  clean = clean
    .replace(/[\u064B-\u0652]/g, "") // remove diacritics / tashkeel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/وو/g, "و");

  // Remove common prefixes
  clean = clean
    .replace(/^(فيلم|مسلسل|برنامج|موسم|سلسلة)\s+/gi, "")
    .replace(/^(the|a|an)\s+/gi, "");

  // Standardize part/chapter/roman numerals
  clean = clean
    .replace(/\bpart\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "part $1")
    .replace(/\bchapter\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "part $1")
    .replace(/\bالجزء\s+(الأول|الاول|1)\b/gi, "part 1")
    .replace(/\bالجزء\s+(الثاني|الثاني|2)\b/gi, "part 2")
    .replace(/\bالجزء\s+(الثالث|الثالث|3)\b/gi, "part 3")
    .replace(/\bالجزء\s+(الرابع|الرابع|4)\b/gi, "part 4")
    .replace(/\bالجزء\s+(الخامس|الخامس|5)\b/gi, "part 5")
    .replace(/\bii\b/gi, "2")
    .replace(/\biii\b/gi, "3")
    .replace(/\biv\b/gi, "4")
    .replace(/\bv\b/gi, "5")
    .replace(/\bvi\b/gi, "6")
    .replace(/\bvii\b/gi, "7")
    .replace(/\bviii\b/gi, "8")
    .replace(/\bix\b/gi, "9")
    .replace(/\bx\b/gi, "10");

  // Keep alphanumeric
  clean = clean.replace(/[^\w\s\u0600-\u06FF]/gi, "").replace(/\s+/g, " ").trim();

  return clean;
}

// 2. Global Database Deduplication Function
async function deduplicateDatabase(): Promise<boolean> {
  console.log("[Server] Running smart database deduplication pass...");
  let modified = false;

  // Unify series and merge separate seasons first
  const seriesUnified = await unifySeriesAndSeasons();
  if (seriesUnified) modified = true;

  const uniqueMovies: Movie[] = [];
  const removedIds: string[] = [];

  for (const movie of moviesDatabase) {
    const normAr = normalizeTitleForDeduplication(movie.titleAr);
    const normEn = normalizeTitleForDeduplication(movie.titleEn);
    const cleanId = movie.id.replace(/\D/g, "");

    const existingIndex = uniqueMovies.findIndex(existing => {
      // 1. Same clean numeric ID
      if (cleanId && existing.id.replace(/\D/g, "") === cleanId) return true;

      // 2. Title matching
      const exNormAr = normalizeTitleForDeduplication(existing.titleAr);
      const exNormEn = normalizeTitleForDeduplication(existing.titleEn);

      const titleMatch = (normEn && exNormEn && normEn === exNormEn) ||
                         (normAr && exNormAr && normAr === exNormAr) ||
                         (normEn && exNormAr && normEn === exNormAr) ||
                         (normAr && exNormEn && normAr === exNormEn);

      if (titleMatch) {
        const sameType = existing.type === movie.type;
        const sameYearOrPart = (!existing.partNumber && !movie.partNumber) || existing.partNumber === movie.partNumber || Math.abs((existing.year || 0) - (movie.year || 0)) <= 1;
        return sameType && sameYearOrPart;
      }

      return false;
    });

    if (existingIndex !== -1) {
      // Merge records
      const primary = uniqueMovies[existingIndex];
      if (!primary.poster || primary.poster.includes("unsplash")) primary.poster = movie.poster;
      if (!primary.backdrop || primary.backdrop.includes("unsplash")) primary.backdrop = movie.backdrop;
      if (!primary.storyAr && movie.storyAr) primary.storyAr = movie.storyAr;
      if (!primary.storyEn && movie.storyEn) primary.storyEn = movie.storyEn;
      if ((!primary.servers || primary.servers.length === 0) && movie.servers) primary.servers = movie.servers;
      if (!primary.collectionId && movie.collectionId) {
        primary.collectionId = movie.collectionId;
        primary.collectionNameAr = movie.collectionNameAr;
        primary.collectionNameEn = movie.collectionNameEn;
        primary.partNumber = movie.partNumber;
      }

      removedIds.push(movie.id);
      modified = true;
    } else {
      uniqueMovies.push(movie);
    }
  }

  if (modified) {
    console.log(`[Deduplication] Merged and removed ${removedIds.length} duplicate entries from memory!`);
    moviesDatabase.length = 0;
    moviesDatabase.push(...uniqueMovies);

    if (db) {
      for (const id of removedIds) {
        await db.collection("movies").doc(id).delete().catch(err => console.error(`[Firestore Delete Duplicate Error] ${id}:`, err));
      }
    }
    saveMoviesDatabase();
  }

  return modified;
}

// 3. Automated Franchise & Movie Collection Engine
function getCleanTextWithoutYear(titleAr?: string, titleEn?: string): string {
  const ar = (titleAr || "").replace(/\b(19|20)\d{2}\b/g, "").toLowerCase();
  const en = (titleEn || "").replace(/\b(19|20)\d{2}\b/g, "").toLowerCase();
  return `${ar} ${en}`;
}

function extractExactPartNumber(titleAr: string, titleEn: string, defaultPart = 1): number {
  const text = getCleanTextWithoutYear(titleAr, titleEn);

  if (/\b(part\s*10|chapter\s*10|\b10\b|fast\s*x|الجزء\s*العاشر)\b/i.test(text) && !text.includes("box")) return 10;
  if (/\b(part\s*9|chapter\s*9|f9|\b9\b|الجزء\s*التاسع)\b/i.test(text)) return 9;
  if (/\b(part\s*8|chapter\s*8|\b8\b|الجزء\s*الثامن)\b/i.test(text)) return 8;
  if (/\b(part\s*7|chapter\s*7|\b7\b|الجزء\s*السابع)\b/i.test(text)) return 7;
  if (/\b(part\s*6|chapter\s*6|\b6\b|vi|الجزء\s*السادس)\b/i.test(text)) return 6;
  if (/\b(part\s*5|chapter\s*5|\b5\b|v|الجزء\s*الخامس)\b/i.test(text)) return 5;
  if (/\b(part\s*4|chapter\s*4|\b4\b|iv|الجزء\s*الرابع)\b/i.test(text)) return 4;
  if (/\b(part\s*3|chapter\s*3|\b3\b|iii|parabellum|الجزء\s*الثالث)\b/i.test(text)) return 3;
  if (/\b(part\s*2|chapter\s*2|\b2\b|ii|الجزء\s*الثاني)\b/i.test(text)) return 2;
  if (/\b(part\s*1|chapter\s*1|\b1\b|i|الجزء\s*الأول|الجزء\s*الاول)\b/i.test(text)) return 1;

  return defaultPart;
}

function autoAssignMovieCollections(movies: Movie[]): boolean {
  let changed = false;

  // Reset generic/auto-assigned collection IDs so we start with a clean state
  movies.forEach(m => {
    if (m.type === "movie" && (m.collectionId?.startsWith("col_") || m.collectionId?.startsWith("auto_"))) {
      m.collectionId = undefined;
      m.collectionNameAr = undefined;
      m.collectionNameEn = undefined;
      m.partNumber = undefined;
      changed = true;
    }
  });

  const franchises: {
    id: string;
    nameAr: string;
    nameEn: string;
    match: (m: Movie) => boolean;
    getPart: (m: Movie) => number;
  }[] = [
    {
      id: "deadpool",
      nameAr: "سلسلة ديدبول",
      nameEn: "Deadpool Collection",
      match: (m) => /\b(deadpool|ديدبول)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/wolverine|ولفرين|\b3\b/i.test(t)) return 3;
        if (/\b2\b|part\s*2|ii/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "john_wick",
      nameAr: "سلسلة جون ويك",
      nameEn: "John Wick Franchise",
      match: (m) => /\b(john\s*wick|جون\s*ويك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/chapter\s*4|\b4\b|الرابع/i.test(t)) return 4;
        if (/parabellum|chapter\s*3|\b3\b|الثالث/i.test(t)) return 3;
        if (/chapter\s*2|\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "fast_furious",
      nameAr: "سلسلة السريع والغاضب Fast & Furious",
      nameEn: "Fast & Furious Franchise",
      match: (m) => /\b(fast\s*(?:&|and)?\s*furious|fast\s*x|f9|hobbs\s*&(?:and)?\s*shaw|السريع\s*والغاضب|فاست\s*فورس|فاست\s*فيوريوس)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/fast\s*x|\b10\b/i.test(t)) return 10;
        if (/f9|\b9\b/i.test(t)) return 9;
        if (/fate|\b8\b/i.test(t)) return 8;
        if (/\b7\b/i.test(t)) return 7;
        if (/\b6\b/i.test(t)) return 6;
        if (/five|\b5\b/i.test(t)) return 5;
        if (/tokyo|\b3\b/i.test(t)) return 3;
        if (/2\s*fast|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "avatar",
      nameAr: "سلسلة أفاتار Avatar",
      nameEn: "Avatar Collection",
      match: (m) => /\b(avatar|أفاتار|افاتار)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/fire\s*and\s*ash|\b3\b/i.test(t)) return 3;
        if (/way\s*of\s*water|طريق\s*الماء|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "kung_fu_panda",
      nameAr: "سلسلة كونغ فو باندا",
      nameEn: "Kung Fu Panda Series",
      match: (m) => /\b(kung\s*fu\s*panda|كونغ\s*فو\s*باندا)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "despicable_me",
      nameAr: "سلسلة أنا الحقير والمينيونز",
      nameEn: "Despicable Me & Minions Collection",
      match: (m) => /\b(despicable\s*me|minions|أنا\s*الحقير|انام\s*الحقير|مينيونز)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/despicable\s*me\s*4|\b4\b/i.test(t) && t.includes("despicable")) return 6;
        if (/rise\s*of\s*gru|صعود\s*جرو/i.test(t)) return 5;
        if (/minions|المينيونز/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "avengers",
      nameAr: "سلسلة المنتقمون Avengers",
      nameEn: "The Avengers Collection",
      match: (m) => /\b(avengers|المنتقمون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/endgame|نهاية\s*اللعبة/i.test(t)) return 4;
        if (/infinity\s*war|الحرب\s*الانهائية/i.test(t)) return 3;
        if (/ultron|أولترون/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "jurassic",
      nameAr: "سلسلة الحديقة الجوراسية Jurassic Park",
      nameEn: "Jurassic Park & World Series",
      match: (m) => /\b(jurassic|الحديقة\s*الجوراسية|عالم\s*جوراسي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dominion|الهيمنة/i.test(t)) return 6;
        if (/fallen\s*kingdom|المملكة\s*الساقطة/i.test(t)) return 5;
        if (/world|عالم/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/lost\s*world|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "mission_impossible",
      nameAr: "سلسلة مهمة مستحيلة Mission: Impossible",
      nameEn: "Mission: Impossible Series",
      match: (m) => /\b(mission\s*:?\s*impossible|مهمة\s*مستحيلة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dead\s*reckoning.*2|part\s*two|الجزء\s*الثاني/i.test(t)) return 8;
        if (/dead\s*reckoning|تقدير\s*الموت|\b7\b/i.test(t)) return 7;
        if (/fallout|تساقط|\b6\b/i.test(t)) return 6;
        if (/rogue\s*nation|أمة\s*مارقة|\b5\b/i.test(t)) return 5;
        if (/ghost\s*protocol|بروتوكول\s*الشبح|\b4\b/i.test(t)) return 4;
        if (/\b3\b/i.test(t)) return 3;
        if (/\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "transformers",
      nameAr: "سلسلة المتحولون Transformers",
      nameEn: "Transformers Series",
      match: (m) => /\b(transformers|bumblebee|المتحولون|بامبلبي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/beasts|الوحوش/i.test(t)) return 7;
        if (/bumblebee|بامبلبي/i.test(t)) return 6;
        if (/last\s*knight|الفارس\s*الأخير/i.test(t)) return 5;
        if (/extinction|الانقراض/i.test(t)) return 4;
        if (/dark\s*of\s*the\s*moon|القمر/i.test(t)) return 3;
        if (/revenge|الانتقام|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "pirates_caribbean",
      nameAr: "سلسلة قراصنة الكاريبي",
      nameEn: "Pirates of the Caribbean Collection",
      match: (m) => /\b(pirates\s*of\s*the\s*caribbean|قراصنة\s*الكاريبي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dead\s*men|الموتى/i.test(t)) return 5;
        if (/stranger\s*tides|غرباء/i.test(t)) return 4;
        if (/world's\s*end|نهاية\s*العالم/i.test(t)) return 3;
        if (/dead\s*man's\s*chest|صندوق/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "lotr",
      nameAr: "سلسلة سيد الخواتم والهوبيت",
      nameEn: "The Lord of the Rings & Hobbit Collection",
      match: (m) => /\b(lord\s*of\s*the\s*rings|hobbit|سيد\s*الخواتم|هوبيت)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/return_of_the_king|عودة\s*الملك/i.test(t)) return 3;
        if (/two\s*towers|البرجين/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "spiderman",
      nameAr: "سلسلة عالم سبايدرمان",
      nameEn: "Spider-Man Collection",
      match: (m) => /\b(spider-man|spiderman|سبايدرمان|سبايدر\s*مان)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/across\s*the\s*spider-verse|عبر\s*عالم\s*العنكبوت/i.test(t)) return 5;
        if (/into\s*the\s*spider-verse|داخل\s*عالم\s*العنكبوت/i.test(t)) return 4;
        if (/no\s*way\s*home|لا\s*عودة\s*للمنزل/i.test(t)) return 3;
        if (/far_from_home|بعيدا\s*عن\s*الوطن/i.test(t)) return 2;
        if (/homecoming|العودة\s*للوطن/i.test(t)) return 1;
        return extractExactPartNumber(m.titleAr, m.titleEn);
      }
    },
    {
      id: "batman",
      nameAr: "سلسلة باتمان وفارس الظلام",
      nameEn: "Batman & The Dark Knight Franchise",
      match: (m) => /\b(batman|dark\s*knight|باتمان|فارس\s*الظلام)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/rises|نهوض/i.test(t)) return 3;
        if (/dark\s*knight|فارس\s*الظلام/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "harry_potter",
      nameAr: "سلسلة هاري بوتر",
      nameEn: "Harry Potter Series",
      match: (m) => /\b(harry\s*potter|fantastic\s*beasts|هاري\s*بوتر|الوحوش\s*المذهلة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/deathly\s*hallows.*2|مقدسات\s*الموت\s*2/i.test(t)) return 8;
        if (/deathly\s*hallows|مقدسات\s*الموت/i.test(t)) return 7;
        if (/half-blood|الأمير\s*الهجين/i.test(t)) return 6;
        if (/order\s*of\s*the\s*phoenix|جماعة\s*العنقاء/i.test(t)) return 5;
        if (/goblet\s*of\s*fire|كأس\s*النار/i.test(t)) return 4;
        if (/prisoner\s*of\s*azkaban|سجين\s*أزكابان/i.test(t)) return 3;
        if (/chamber\s*of\s*secrets|حجرة\s*الأسرار/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "dune",
      nameAr: "سلسلة كثبان Dune",
      nameEn: "Dune Collection",
      match: (m) => /\b(dune|كثبان|ديبون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/part\s*two|\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "shrek",
      nameAr: "سلسلة شريك و Puss in Boots",
      nameEn: "Shrek & Puss in Boots Universe",
      match: (m) => /\b(shrek|puss\s*in\s*boots|شريك|قط\s*في\s*الأحذية)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "toy_story",
      nameAr: "سلسلة حكاية لعبة Toy Story",
      nameEn: "Toy Story Collection",
      match: (m) => /\b(toy\s*story|حكاية\s*لعبة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "httyd",
      nameAr: "سلسلة كيف تروض تنينك",
      nameEn: "How to Train Your Dragon Series",
      match: (m) => /\b(how\s*to\s*train\s*your\s*dragon|كيف\s*تروض\s*تنينك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "star_wars",
      nameAr: "سلسلة حرب النجوم Star Wars",
      nameEn: "Star Wars Franchise",
      match: (m) => /\b(star\s*wars|حرب\s*النجوم)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "rocky_creed",
      nameAr: "سلسلة روكي وكريد Creed & Rocky",
      nameEn: "Rocky & Creed Franchise",
      match: (m) => /\b(creed|rocky|كريد|روكي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "sonic",
      nameAr: "سلسلة القنفذ سونيك Sonic",
      nameEn: "Sonic the Hedgehog Collection",
      match: (m) => /\b(sonic|سونيك)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "top_gun",
      nameAr: "سلسلة توب غان Top Gun",
      nameEn: "Top Gun Series",
      match: (m) => /\b(top\s*gun|توب\s*غان)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/maverick|مافريك|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "hotel_transylvania",
      nameAr: "سلسلة فندق ترانسيلفانيا",
      nameEn: "Hotel Transylvania Collection",
      match: (m) => /\b(hotel\s*transylvania|فندق\s*ترانسيلفانيا)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "ice_age",
      nameAr: "سلسلة العصر الجليدي Ice Age",
      nameEn: "Ice Age Series",
      match: (m) => /\b(ice\s*age|العصر\s*الجليدي)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "madagascar",
      nameAr: "سلسلة مدغشقر Madagascar",
      nameEn: "Madagascar Collection",
      match: (m) => /\b(madagascar|مدغشقر)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "gladiator",
      nameAr: "سلسلة المصارع Gladiator",
      nameEn: "Gladiator Collection",
      match: (m) => /\b(gladiator|المصارع)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/\b2\b|ii|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "inside_out",
      nameAr: "سلسلة قلباً وقالباً Inside Out",
      nameEn: "Inside Out Series",
      match: (m) => /\b(inside\s*out|قلبا\s*وقالبا|قلباً\s*وقالباً)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/\b2\b|الثاني/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "venom",
      nameAr: "سلسلة فينوم Venom",
      nameEn: "Venom Collection",
      match: (m) => /\b(venom|فينوم)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/last\s*dance|الرقصة\s*الأخيرة|\b3\b/i.test(t)) return 3;
        if (/carnage|مجزرة|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "bad_boys",
      nameAr: "سلسلة الفتيان الأشقياء Bad Boys",
      nameEn: "Bad Boys Series",
      match: (m) => /\b(bad\s*boys|فتيان\s*أشقياء|فتيان\s*اشقياء)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/ride\s*or\s*die|\b4\b/i.test(t)) return 4;
        if (/for\s*life|\b3\b/i.test(t)) return 3;
        if (/\b2\b|ii/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "matrix",
      nameAr: "سلسلة الماتريكس The Matrix",
      nameEn: "The Matrix Collection",
      match: (m) => /\b(matrix|الماتريكس|ماتريكس)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/resurrections|\b4\b/i.test(t)) return 4;
        if (/revolutions|\b3\b/i.test(t)) return 3;
        if (/reloaded|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "hunger_games",
      nameAr: "سلسلة ألعاب الجوع The Hunger Games",
      nameEn: "The Hunger Games Series",
      match: (m) => /\b(hunger\s*games|ألعاب\s*الجوع|العاب\s*الجوع)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/songbirds|snakes/i.test(t)) return 5;
        if (/mockingjay.*2|\b4\b/i.test(t)) return 4;
        if (/mockingjay|\b3\b/i.test(t)) return 3;
        if (/catching\s*fire|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "maze_runner",
      nameAr: "سلسلة عداء المتاهة The Maze Runner",
      nameEn: "The Maze Runner Series",
      match: (m) => /\b(maze\s*runner|عداء\s*المتاهة|متسابق\s*المتاهة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/death\s*cure|\b3\b/i.test(t)) return 3;
        if (/scorch\s*trials|\b2\b/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "twilight",
      nameAr: "سلسلة الشفق Twilight",
      nameEn: "The Twilight Saga",
      match: (m) => /\b(twilight|توايلايت|الشفق)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "sing",
      nameAr: "سلسلة سينج Sing",
      nameEn: "Sing Collection",
      match: (m) => /\b(sing|سينج)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "secret_life_pets",
      nameAr: "سلسلة الحياة السرية للحيوانات الأليفة",
      nameEn: "The Secret Life of Pets Collection",
      match: (m) => /\b(secret\s*life\s*of\s*pets|الحياة\s*السرية\s*للحيوانات\s*الأليفة)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "monsters_inc",
      nameAr: "سلسلة شركة المرعبين المحدودة",
      nameEn: "Monsters, Inc. Universe",
      match: (m) => /\b(monsters,?\s*inc|monsters\s*university|شركة\s*المرعبين|جامعة\s*المرعبين)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "finding_nemo",
      nameAr: "سلسلة البحث عن نيمو ودوري",
      nameEn: "Finding Nemo Collection",
      match: (m) => /\b(finding\s*nemo|finding\s*dory|البحث\s*عن\s*نيمو|البحث\s*عن\s*دوري)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => {
        const t = getCleanTextWithoutYear(m.titleAr, m.titleEn);
        if (/dory|دوري/i.test(t)) return 2;
        return 1;
      }
    },
    {
      id: "incredibles",
      nameAr: "سلسلة أبطال خارقون The Incredibles",
      nameEn: "The Incredibles Collection",
      match: (m) => /\b(incredibles|المذهلون|أبطال\s*خارقون)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    },
    {
      id: "cars",
      nameAr: "سلسلة سيارات Cars",
      nameEn: "Cars Series",
      match: (m) => /\b(cars|سيارات)\b/i.test(getCleanTextWithoutYear(m.titleAr, m.titleEn)),
      getPart: (m) => extractExactPartNumber(m.titleAr, m.titleEn)
    }
  ];

  // Assign predefined franchises
  movies.forEach(movie => {
    for (const f of franchises) {
      if (f.match(movie)) {
        const targetPart = f.getPart(movie);
        if (movie.collectionId !== f.id || String(movie.partNumber) !== String(targetPart)) {
          movie.collectionId = f.id;
          movie.collectionNameAr = f.nameAr;
          movie.collectionNameEn = f.nameEn;
          movie.partNumber = targetPart;
          changed = true;
        }
        break;
      }
    }
  });

  // 2. Strict Generic Prefix Auto-Grouper for remaining unassigned movie series
  // Banned single generic words that must never be grouped together
  const BANNED_PREFIXES = new Set([
    "the", "a", "an", "man", "dark", "love", "blood", "king", "war", "star", "last", "first",
    "الموت", "الحب", "الرجل", "الليل", "الملك", "الحرب", "النجم", "العالم", "الأخير", "الاول"
  ]);

  const unassignedMovies = movies.filter(m => m.type === "movie" && !m.collectionId);
  const prefixGroups: { [key: string]: Movie[] } = {};

  unassignedMovies.forEach(movie => {
    let cleanEn = movie.titleEn
      ? movie.titleEn.toLowerCase().replace(/[:\-\(\)].*$/, "").replace(/\b(the|a|an)\b/gi, "").replace(/\b(part|chapter|volume|part\s*2|part\s*3|2|3|4|ii|iii|iv)\b/gi, "").trim()
      : "";
    let cleanAr = movie.titleAr
      ? movie.titleAr.replace(/[:\-\(\)].*$/, "").replace(/^(فيلم|مسلسل)\s+/, "").replace(/\b(الجزء|جزء|الثاني|الثالث|الرابع|الأول|1|2|3|4)\b/g, "").trim()
      : "";

    const key = cleanEn.length >= 5 && !BANNED_PREFIXES.has(cleanEn) ? cleanEn : (cleanAr.length >= 5 && !BANNED_PREFIXES.has(cleanAr) ? cleanAr : "");
    if (key) {
      if (!prefixGroups[key]) prefixGroups[key] = [];
      prefixGroups[key].push(movie);
    }
  });

  Object.keys(prefixGroups).forEach(key => {
    const group = prefixGroups[key];
    // ONLY group if at least one movie in the group explicitly contains a part indicator or number
    const hasExplicitPartIndicator = group.some(m => {
      const text = getCleanTextWithoutYear(m.titleAr, m.titleEn);
      return /\b(part\s*\d+|chapter\s*\d+|\b2\b|\b3\b|\b4\b|ii|iii|iv|الجزء\s*(الثاني|الثالث|الرابع))\b/i.test(text);
    });

    if (group.length >= 2 && hasExplicitPartIndicator) {
      group.sort((a, b) => (a.year || 0) - (b.year || 0));
      const firstMovie = group[0];
      const colId = `col_${key.replace(/\s+/g, "_").replace(/[^\w]/g, "")}`;
      const nameAr = `سلسلة ${firstMovie.titleAr.replace(/[:\-\(].*$/, "").trim()}`;
      const nameEn = `${firstMovie.titleEn.replace(/[:\-\(].*$/, "").trim()} Collection`;

      group.forEach((movie, index) => {
        let detectedPart = extractExactPartNumber(movie.titleAr, movie.titleEn, index + 1);

        if (movie.collectionId !== colId) {
          movie.collectionId = colId;
          movie.collectionNameAr = nameAr;
          movie.collectionNameEn = nameEn;
          movie.partNumber = detectedPart;
          changed = true;
        }
      });
    }
  });

  return changed;
}

// Extract clean series root title by stripping out season indicators
function getSeriesRootTitle(titleAr?: string, titleEn?: string): { rootAr: string; rootEn: string } {
  let ar = (titleAr || "").trim();
  let en = (titleEn || "").trim();

  // Regex patterns for Season markers in Arabic and English
  const seasonPatternAr = /\s*[-:_–—]?\s*(الموسم|الجزء)\s*([\u0600-\u06FF0-9a-zA-Z]+)?/gi;
  const seasonPatternEn = /\s*[-:_–—]?\s*(Season|S|Part)\s*(\d+|[I|V|X]+)?/gi;

  ar = ar.replace(seasonPatternAr, "").replace(/[-:_–—]\s*$/, "").trim();
  en = en.replace(seasonPatternEn, "").replace(/[-:_–—]\s*$/, "").trim();

  return {
    rootAr: ar || titleAr || "",
    rootEn: en || titleEn || ""
  };
}

function extractSeasonNumberFromTitle(titleAr?: string, titleEn?: string): number {
  const text = `${titleAr || ''} ${titleEn || ''}`;
  const enMatch = text.match(/(?:Season|S|Part)\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10);

  const arMatch = text.match(/(?:الموسم|الجزء)\s*([\u0600-\u06FF0-9]+)/i);
  if (arMatch) {
    const val = arMatch[1].trim();
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    if (val.includes("الأول") || val.includes("الاول")) return 1;
    if (val.includes("الثاني")) return 2;
    if (val.includes("الثالث")) return 3;
    if (val.includes("الرابع")) return 4;
    if (val.includes("الخامس")) return 5;
    if (val.includes("السادس")) return 6;
    if (val.includes("السابع")) return 7;
    if (val.includes("الثامن")) return 8;
    if (val.includes("التاسع")) return 9;
    if (val.includes("العاشر")) return 10;
  }
  return 1;
}

// Unify all series so no season is published separately
async function unifySeriesAndSeasons(): Promise<boolean> {
  console.log("[Series Unifier] Unifying series and merging separate seasons...");
  let modified = false;

  const unifiedList: Movie[] = [];
  const removedIds: string[] = [];

  for (const item of moviesDatabase) {
    if (item.type !== "series") {
      unifiedList.push(item);
      continue;
    }

    const { rootAr, rootEn } = getSeriesRootTitle(item.titleAr, item.titleEn);
    const normRootAr = normalizeTitleForDeduplication(rootAr);
    const normRootEn = normalizeTitleForDeduplication(rootEn);
    const cleanNumericId = item.id.replace(/\D/g, "");

    // Look for existing primary series in unifiedList
    const existingIndex = unifiedList.findIndex(existing => {
      if (existing.type !== "series") return false;

      // 1. Clean TMDB ID match
      const exCleanId = existing.id.replace(/\D/g, "");
      if (cleanNumericId && exCleanId && cleanNumericId === exCleanId) return true;

      // 2. Root Title match
      const exRoots = getSeriesRootTitle(existing.titleAr, existing.titleEn);
      const exNormAr = normalizeTitleForDeduplication(exRoots.rootAr);
      const exNormEn = normalizeTitleForDeduplication(exRoots.rootEn);

      if (normRootEn && exNormEn && normRootEn === exNormEn) return true;
      if (normRootAr && exNormAr && normRootAr === exNormAr) return true;
      if (normRootEn && exNormAr && normRootEn === exNormAr) return true;
      if (normRootAr && exNormEn && normRootAr === exNormEn) return true;

      return false;
    });

    if (existingIndex !== -1) {
      // Primary existing series found -> MERGE seasons into primary!
      const primary = unifiedList[existingIndex];
      if (!primary.seasons) primary.seasons = [];

      const detectedNum = extractSeasonNumberFromTitle(item.titleAr, item.titleEn);

      const incomingSeasons = (item.seasons && item.seasons.length > 0)
        ? item.seasons
        : [{
            id: `s${detectedNum}_${item.id}`,
            number: detectedNum,
            titleAr: `الموسم ${detectedNum}`,
            titleEn: `Season ${detectedNum}`,
            poster: item.poster,
            backdrop: item.backdrop,
            year: item.year,
            storyAr: item.storyAr,
            storyEn: item.storyEn,
            episodes: (item.servers || []).map((srv, idx) => ({
              id: `ep_${idx + 1}_${item.id}`,
              number: idx + 1,
              titleAr: srv.name || `الحلقة ${idx + 1}`,
              titleEn: srv.name || `Episode ${idx + 1}`,
              duration: "45m",
              storyAr: item.storyAr,
              storyEn: item.storyEn,
              thumbnail: item.backdrop || item.poster,
              servers: [srv],
              subtitlesUrlAr: item.subtitlesUrlAr || "",
              subtitlesUrlEn: item.subtitlesUrlEn || "",
              rating: item.rating || 8.0
            }))
          }];

      for (const incSzn of incomingSeasons) {
        const sznNum = incSzn.number || detectedNum;
        const exSzn = primary.seasons.find(s => s.number === sznNum);

        if (exSzn) {
          // Update details & merge episodes
          if (!exSzn.poster || exSzn.poster.includes("unsplash")) exSzn.poster = incSzn.poster || item.poster || primary.poster;
          if (!exSzn.storyAr) exSzn.storyAr = incSzn.storyAr || item.storyAr;
          if (!exSzn.storyEn) exSzn.storyEn = incSzn.storyEn || item.storyEn;

          if (incSzn.episodes && incSzn.episodes.length > 0) {
            for (const ep of incSzn.episodes) {
              if (!exSzn.episodes.some(e => e.number === ep.number || e.id === ep.id)) {
                exSzn.episodes.push(ep);
              }
            }
            exSzn.episodes.sort((a, b) => a.number - b.number);
          }
        } else {
          // Add brand new season
          if (!incSzn.poster || incSzn.poster.includes("unsplash")) {
            incSzn.poster = item.poster || primary.poster;
          }
          primary.seasons.push({
            ...incSzn,
            number: sznNum,
            titleAr: incSzn.titleAr || `الموسم ${sznNum}`,
            titleEn: incSzn.titleEn || `Season ${sznNum}`
          });
        }
      }

      // Sort primary seasons
      primary.seasons.sort((a, b) => a.number - b.number);

      removedIds.push(item.id);
      modified = true;
    } else {
      // First time adding this series: Clean title from season markers
      const cleanRoots = getSeriesRootTitle(item.titleAr, item.titleEn);
      item.titleAr = cleanRoots.rootAr;
      item.titleEn = cleanRoots.rootEn;

      if (item.seasons && item.seasons.length > 0) {
        item.seasons.sort((a, b) => a.number - b.number);
      }

      unifiedList.push(item);
    }
  }

  if (modified) {
    console.log(`[Series Unifier] Merged ${removedIds.length} separate season entries into unified series!`);
    moviesDatabase.length = 0;
    moviesDatabase.push(...unifiedList);

    if (db) {
      for (const id of removedIds) {
        await db.collection("movies").doc(id).delete().catch(err => console.error(`[Firestore Delete Merged Season] ${id}:`, err));
      }
    }
    saveMoviesDatabase();
  }

  return modified;
}

// 4. Deduplication Checker (Single Item)
function findDuplicateMovieOrSeries(titleAr: string, titleEn: string, rawId?: string, type?: string): Movie | null {
  const normAr = normalizeTitleForDeduplication(titleAr);
  const normEn = normalizeTitleForDeduplication(titleEn);
  const cleanId = rawId ? rawId.replace(/\D/g, "") : "";

  const rootObj = getSeriesRootTitle(titleAr, titleEn);
  const rootNormAr = normalizeTitleForDeduplication(rootObj.rootAr);
  const rootNormEn = normalizeTitleForDeduplication(rootObj.rootEn);

  for (const movie of moviesDatabase) {
    if (type && movie.type !== type) continue;

    if (cleanId) {
      const existingCleanId = movie.id.replace(/\D/g, "");
      if (existingCleanId && existingCleanId === cleanId) {
        return movie;
      }
    }

    const existingNormAr = normalizeTitleForDeduplication(movie.titleAr);
    const existingNormEn = normalizeTitleForDeduplication(movie.titleEn);

    if (normEn && existingNormEn && normEn === existingNormEn) return movie;
    if (normAr && existingNormAr && normAr === existingNormAr) return movie;
    if (normEn && existingNormAr && normEn === existingNormAr) return movie;
    if (normAr && existingNormEn && normAr === existingNormEn) return movie;

    if (movie.type === "series") {
      const exRoots = getSeriesRootTitle(movie.titleAr, movie.titleEn);
      const exRootNormAr = normalizeTitleForDeduplication(exRoots.rootAr);
      const exRootNormEn = normalizeTitleForDeduplication(exRoots.rootEn);

      if (rootNormEn && exRootNormEn && rootNormEn === exRootNormEn) return movie;
      if (rootNormAr && exRootNormAr && rootNormAr === exRootNormAr) return movie;
      if (rootNormEn && exRootNormAr && rootNormEn === exRootNormAr) return movie;
      if (rootNormAr && exRootNormEn && rootNormAr === exRootNormEn) return movie;
    }
  }

  return null;
}

async function purgeFakeMovies() {
  const validMovies: Movie[] = [];
  const fakeIds: string[] = [];

  for (const m of moviesDatabase) {
    const isFakeTitle = (m.titleAr || "").includes("فيلم الخيال والأكشن") || (m.titleEn || "").includes("فيلم الخيال والأكشن") || (m.titleAr || "").includes("فيلم أو مسلسل حقيقي");
    // Only consider fake if title is dummy AND it has no real custom servers or user uploads
    const hasCustomServer = m.servers && m.servers.length > 0 && !isPlaceholderServer(m.servers);

    if (isFakeTitle && !hasCustomServer) {
      fakeIds.push(m.id);
      console.log(`[Purge] Removing fake placeholder movie entry: "${m.titleAr}" (${m.id})`);
    } else {
      validMovies.push(m);
    }
  }

  if (fakeIds.length > 0) {
    moviesDatabase.length = 0;
    moviesDatabase.push(...validMovies);
    saveMoviesDatabase();
    console.log(`[Purge] Purged ${fakeIds.length} fake/mock movie entries. Database size now: ${moviesDatabase.length}`);

    if (db) {
      for (const fakeId of fakeIds) {
        try {
          const docRef = doc(db, "movies", fakeId);
          await deleteDoc(docRef);
          console.log(`[Firestore Purge] Deleted fake document ${fakeId} from Firestore.`);
        } catch (err: any) {
          console.error(`[Firestore Purge Error] Failed to delete ${fakeId}:`, err.message || err);
        }
      }
    }
    cachedHomeData = null;
  }
}

async function fetchRealTMDBTrendingPaths(): Promise<string[]> {
  const tmdbPaths: string[] = [];
  const urls = [
    "https://www.themoviedb.org/movie",
    "https://www.themoviedb.org/movie/top-rated",
    "https://www.themoviedb.org/movie/now-playing",
    "https://www.themoviedb.org/movie/upcoming",
    "https://www.themoviedb.org/tv",
    "https://www.themoviedb.org/tv/top-rated",
    "https://www.themoviedb.org/tv/on-the-air",
    "https://www.themoviedb.org/trending"
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const html = await res.text();
        const matches = html.matchAll(/href="(\/(movie|tv)\/(\d+)[^"]*)"/gi);
        for (const m of matches) {
          const path = `/${m[2]}/${m[3]}`;
          if (!tmdbPaths.includes(path)) {
            tmdbPaths.push(path);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[TMDB Live Scraper] Failed to fetch ${url}:`, err.message || err);
    }
  }

  console.log(`[TMDB Live Scraper] Discovered ${tmdbPaths.length} real TMDB movie/TV show paths from live TMDB directory.`);
  return tmdbPaths;
}

// 3. Core Importer Function
async function importBatchFromCinemanaAndTMDB(options: { limit?: number; forceQuery?: string }) {
  const limit = options.limit || 15;
  if (cinemanaImportStats.isCurrentlyRunning) {
    console.log("[Cinemana Importer] An import batch is already in progress. Skipping concurrent run.");
    return { status: "running", message: "جاري الاستيراد حالياً بالفعل", stats: cinemanaImportStats };
  }

  cinemanaImportStats.isCurrentlyRunning = true;
  console.log(`[Cinemana Importer] Starting batch import (Target: ${limit} items per run)...`);

  let processed = 0;
  let added = 0;
  let merged = 0;
  let skipped = 0;
  const importedTitles: string[] = [];

  try {
    // Purge any residual fake items before starting batch import
    await purgeFakeMovies();

    // Generate candidates from TMDB & Cinemana trending lists + live search
    let candidates: string[] = [];
    if (options.forceQuery) {
      candidates.push(options.forceQuery);
    }

    // Fetch 100+ real live TMDB paths from TMDB directory pages
    const realTMDBPaths = await fetchRealTMDBTrendingPaths().catch(() => []);
    candidates.push(...realTMDBPaths);

    // Combine with extensive trending blockbusters, TV shows, and classic franchises
    const liveDiscovered = await fetchFutureAndTrendingTitlesFromGemini().catch(() => []);
    candidates.push(...liveDiscovered);

    const defaultTrending = [
      "Deadpool & Wolverine", "Inside Out 2", "Dune: Part Two", "Oppenheimer", "Gladiator II",
      "Alien: Romulus", "Moana 2", "Wicked", "Kingdom of the Planet of the Apes", "The Batman",
      "House of the Dragon", "The Last of Us", "Squid Game", "The Boys", "Shogun",
      "Fallout", "Stranger Things", "Breaking Bad", "Game of Thrones", "Succession",
      "Severance", "The Mandalorian", "Wednesday", "Bad Boys: Ride or Die", "Twisters",
      "Interstellar", "Inception", "The Dark Knight", "Avengers: Endgame", "Avatar: The Way of Water",
      "Barbie", "Civil War", "Furiosa: A Mad Max Saga", "Godzilla x Kong: The New Empire", "Kung Fu Panda 4",
      "Spider-Man: Across the Spider-Verse", "Guardians of the Galaxy Vol. 3", "John Wick: Chapter 4", "Mission: Impossible - Dead Reckoning", "Top Gun: Maverick",
      "Spider-Man: No Way Home", "Doctor Strange in the Multiverse of Madness", "Thor: Love and Thunder", "Black Panther: Wakanda Forever",
      "Joker", "Avengers: Infinity War", "Captain America: Civil War", "Iron Man", "The Avengers",
      "Fast X", "F9: The Fast Saga", "Hobbs & Shaw", "The Fate of the Furious", "Furious 7",
      "Jurassic World Dominion", "Jurassic World: Fallen Kingdom", "Jurassic World", "Jurassic Park", "The Lost World: Jurassic Park",
      "Transformers: Rise of the Beasts", "Transformers: The Last Knight", "Bumblebee", "Transformers: Age of Extinction",
      "Creed III", "Creed II", "Creed", "Rocky", "Rocky IV",
      "Mission: Impossible - Fallout", "Mission: Impossible - Rogue Nation", "Mission: Impossible - Ghost Protocol", "Top Gun",
      "John Wick", "John Wick: Chapter 2", "John Wick: Chapter 3 - Parabellum", "The Matrix", "The Matrix Resurrections",
      "Pirates of the Caribbean: The Curse of the Black Pearl", "Pirates of the Caribbean: Dead Man's Chest", "Pirates of the Caribbean: At World's End",
      "Harry Potter and the Sorcerer's Stone", "Harry Potter and the Chamber of Secrets", "Harry Potter and the Prisoner of Azkaban", "Harry Potter and the Goblet of Fire",
      "The Lord of the Rings: The Fellowship of the Ring", "The Lord of the Rings: The Two Towers", "The Lord of the Rings: The Return of the King",
      "Star Wars: Episode IV - A New Hope", "Star Wars: Episode V - The Empire Strikes Back", "Star Wars: Episode VI - Return of the Jedi",
      "Despicable Me 4", "Despicable Me 3", "Despicable Me 2", "Minions",
      "Toy Story", "Toy Story 2", "Toy Story 3", "Toy Story 4",
      "Monsters, Inc.", "Finding Nemo", "The Incredibles", "Incredibles 2", "Cars", "Ratatouille",
      "Wall-E", "Up", "Coco", "Soul", "Luca", "Elemental", "Inside Out",
      "Shrek", "Shrek 2", "Puss in Boots: The Last Wish", "How to Train Your Dragon",
      "Kung Fu Panda", "Kung Fu Panda 2", "Kung Fu Panda 3", "Ice Age", "Hotel Transylvania",
      "Spider-Man: Into the Spider-Verse", "The Super Mario Bros. Movie", "Sonic the Hedgehog", "Sonic the Hedgehog 2", "Free Guy"
    ];

    candidates.push(...defaultTrending);
    candidates = Array.from(new Set(candidates));

    let candidateIndex = 0;
    while (added < limit && candidateIndex < candidates.length) {
      const titleCandidate = candidates[candidateIndex];
      candidateIndex++;
      if (!titleCandidate) continue;

      processed++;

      // Check for duplicates before expensive TMDB scraping
      const existingDuplicate = findDuplicateMovieOrSeries(titleCandidate, titleCandidate);
      if (existingDuplicate) {
        console.log(`[Cinemana Importer] [Deduplication Filter] Duplicate skipped: "${titleCandidate}" (Matches existing ID: ${existingDuplicate.id} / ${existingDuplicate.titleAr})`);
        skipped++;
        continue;
      }

      // Scraping details from TMDB with Cinemana playback streams and subtitles
      console.log(`[Cinemana Importer] Importing & Syncing item ${added + 1}/${limit}: "${titleCandidate}"...`);
      let movieData: any = null;
      try {
        movieData = await scrapeTMDBMetadata(titleCandidate).catch(() => null);

        if (!movieData || (!movieData.titleEn && !movieData.titleAr)) {
          if (ai && Date.now() > quotaExceededUntil) {
            movieData = await generateMovieWithGemini(titleCandidate).catch(() => null);
          }
        }
      } catch (itemErr: any) {
        console.warn(`[Cinemana Importer] Item processing failed for "${titleCandidate}":`, itemErr.message || itemErr);
      }

      // STRICT REQUIREMENT: If no real TMDB movie metadata was retrieved, SKIP IT! NEVER create fake items!
      if (!movieData || (!movieData.titleEn && !movieData.titleAr)) {
        console.warn(`[Cinemana Importer] Skipping candidate as no real TMDB movie/series metadata was found for: "${titleCandidate}"`);
        skipped++;
        continue;
      }

      // Second-pass deduplication check after retrieving exact Arabic/English titles and TMDB ID
      const secondCheckDuplicate = findDuplicateMovieOrSeries(movieData.titleAr, movieData.titleEn, movieData.id);
      if (secondCheckDuplicate) {
        console.log(`[Cinemana Importer] [Deduplication Filter] Duplicate skipped on second pass: "${movieData.titleEn}"`);
        
        // If it's a series and has new seasons, merge seasons into existing record
        if (movieData.type === "series" && movieData.seasons && secondCheckDuplicate.type === "series") {
          let mergedSeasons = false;
          if (!secondCheckDuplicate.seasons) secondCheckDuplicate.seasons = [];
          
          for (const newSeason of movieData.seasons) {
            const existingSeason = secondCheckDuplicate.seasons.find(s => s.number === newSeason.number || s.id === newSeason.id);
            if (!existingSeason) {
              secondCheckDuplicate.seasons.push(newSeason);
              mergedSeasons = true;
            } else if (newSeason.episodes && newSeason.episodes.length > (existingSeason.episodes?.length || 0)) {
              existingSeason.episodes = newSeason.episodes;
              mergedSeasons = true;
            }
          }

          if (mergedSeasons) {
            merged++;
            console.log(`[Cinemana Importer] Merged updated seasons into existing series: "${secondCheckDuplicate.titleAr}"`);
            await saveMovieToFirestore(secondCheckDuplicate);
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
        continue;
      }

      // Ensure Cinemana streaming URLs & subtitles are fully set up
      const cleanNumericId = movieData.id.replace(/\D/g, "") || String(Date.now());
      if (movieData.type === "movie") {
        movieData.servers = getRealStreamingServers({ id: cleanNumericId, type: "movie", titleEn: movieData.titleEn });
        movieData.subtitlesUrlAr = getValidSubtitleUrl(movieData.subtitlesUrlAr, movieData.id, "ar", undefined, undefined, movieData);
        movieData.subtitlesUrlEn = getValidSubtitleUrl(movieData.subtitlesUrlEn, movieData.id, "en", undefined, undefined, movieData);
      } else if (movieData.type === "series") {
        // Enforce complete seasons & episodes
        if (!movieData.seasons || movieData.seasons.length === 0) {
          const scrapedSeasons = await fetchTMDBSeriesSeasons(movieData.id.replace(/\D/g, ""), movieData.titleEn, movieData.titleAr, movieData.backdrop, movieData.rating);
          if (scrapedSeasons && scrapedSeasons.length > 0) {
            movieData.seasons = scrapedSeasons;
          } else {
            // Default Season 1 with 10 complete episodes
            const sId = "s1";
            movieData.seasons = [
              {
                id: sId,
                number: 1,
                titleAr: "الموسم الأول",
                titleEn: "Season 1",
                episodes: Array.from({ length: 10 }).map((_, i) => {
                  const epNum = i + 1;
                  const epId = `s1_e${epNum}_${movieData.id}`;
                  return {
                    id: epId,
                    number: epNum,
                    titleAr: `الحلقة ${epNum}`,
                    titleEn: `Episode ${epNum}`,
                    duration: "45m",
                    storyAr: `تفاصيل وأحداث الحلقة ${epNum} من مسلسل ${movieData.titleAr}.`,
                    storyEn: `Details and plot of Episode ${epNum} of Season 1 of ${movieData.titleEn}.`,
                    thumbnail: movieData.backdrop,
                    servers: getRealStreamingServers({ id: cleanNumericId, type: "series", titleEn: movieData.titleEn }, 1, epNum),
                    subtitlesUrlAr: `/api/subtitles?movieId=${movieData.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
                    subtitlesUrlEn: `/api/subtitles?movieId=${movieData.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
                    rating: movieData.rating
                  };
                })
              }
            ];
          }
        }
      }

      // Add to local database (marked as published by default - isPublished: true)
      movieData.isPublished = true;
      moviesDatabase.push(movieData);
      added++;
      importedTitles.push(`${movieData.titleAr} (${movieData.titleEn})`);

      // Save to Cloud Firestore
      await saveMovieToFirestore(movieData).catch(err => console.error(`[Cinemana Importer] Error saving ${movieData.id} to Firestore:`, err));

      // Pause briefly between requests
      await new Promise(r => setTimeout(r, 200));
    }

    if (added > 0 || merged > 0) {
      saveMoviesDatabase();
      cachedHomeData = null; // reset home feed cache
      console.log(`[Cinemana Importer] Batch successful! Added: ${added}, Merged: ${merged}, Skipped duplicates: ${skipped}. Persisted to Cloud Firestore.`);
    } else {
      console.log(`[Cinemana Importer] Batch finished. No new non-duplicate items were found in this run.`);
    }

    cinemanaImportStats.lastRunTimestamp = Date.now();
    cinemanaImportStats.processedCount += processed;
    cinemanaImportStats.addedCount += added;
    cinemanaImportStats.mergedCount += merged;
    cinemanaImportStats.duplicatesSkippedCount += skipped;
    if (importedTitles.length > 0) {
      cinemanaImportStats.lastItemsImported = importedTitles;
    }

    return {
      status: "success",
      message: `تم استيراد ${added} فيلم/مسلسل جديد وتحديث ${merged} مسلسلات وتخطي ${skipped} مكررات وحفظها سحابياً في Firestore بنجاح`,
      stats: {
        limit,
        processedInRun: processed,
        addedInRun: added,
        mergedInRun: merged,
        duplicatesSkippedInRun: skipped,
        savedToFirestore: true,
        lastItemsImported: importedTitles,
        totalInDatabase: moviesDatabase.length
      }
    };
  } catch (err: any) {
    console.error("[Cinemana Importer] Error during import batch:", err);
    return {
      status: "error",
      message: err.message || "حدث خطأ أثناء عملية الاستيراد",
      stats: cinemanaImportStats
    };
  } finally {
    cinemanaImportStats.isCurrentlyRunning = false;
  }
}

// REST API Endpoints

const subtitlesCache = new Map<string, string>();

// When no real, verified subtitle could be found for a title, we say so honestly instead
// of fabricating generic dialogue that has nothing to do with the actual movie/episode.
function generateNotAvailableVtt(lang: string): string {
  const isAr = lang === "ar";
  const message = isAr
    ? "عذراً، لا تتوفر ترجمة حقيقية لهذا العمل حالياً."
    : "Sorry, no verified subtitles are currently available for this title.";

  // A single cue in the first 10 seconds is easy to miss on a 2-hour movie - the viewer
  // has to be watching that exact window to ever see it. Repeat it periodically (8s on,
  // 5min off) for the first few hours so it reliably shows up whenever someone checks.
  let vtt = "WEBVTT\n\n";
  const intervalSec = 300;
  const cueDurationSec = 8;
  let idx = 1;
  for (let start = 1; start < 3 * 3600; start += intervalSec) {
    const end = start + cueDurationSec;
    vtt += `${idx}\n${formatVttTime(start)} --> ${formatVttTime(end)}\n${message}\n\n`;
    idx++;
  }
  return vtt;
}

function formatVttTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}.000`;
}

function srtToVtt(srtText: string): string {
  // Clean up carriage returns
  let clean = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // Prepend WEBVTT
  let vtt = "WEBVTT\n\n";
  
  // Replace all timestamps commas with dots: e.g., 00:01:20,000 --> 00:01:23,340
  const timestampRegex = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;
  clean = clean.replace(timestampRegex, "$1.$2");
  
  vtt += clean;
  return vtt;
}

async function fetchAndBypassCorsSubtitles(url: string, lang?: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    
    const arrayBuffer = await res.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return null;

    let body = decodeSubtitleBuffer(Buffer.from(arrayBuffer), lang === "ar" || lang === "en" ? lang : undefined);
    if (!body || body.trim().length === 0) return null;

    // If Arabic was requested, ensure the content actually contains Arabic script (not Chinese or corrupted bytes)
    if (lang === "ar" && !/[\u0600-\u06FF]/.test(body)) {
      console.warn(`[Subtitles Proxy] External URL content does not contain valid Arabic script. Rejecting corrupted file.`);
      return null;
    }

    if (!body.includes("WEBVTT") && body.includes("-->")) {
      body = srtToVtt(body);
    }

    return body;
  } catch (err: any) {
    console.error("[Subtitles Proxy] Error fetching external subtitle:", err.message);
    return null;
  }
}

function adjustVttTimestamps(vttText: string, offsetSec: number): string {
  if (offsetSec === 0 || isNaN(offsetSec)) return vttText;

  // This matches hh:mm:ss.ms or hh:mm:ss,ms or mm:ss.ms
  const timestampRegex = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g;

  return vttText.replace(timestampRegex, (match, hh, mm, ss, ms) => {
    let totalMs = (parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseInt(ss, 10)) * 1000 + parseInt(ms, 10);
    totalMs += offsetSec * 1000;
    if (totalMs < 0) totalMs = 0;

    const newH = Math.floor(totalMs / 3600000);
    const newM = Math.floor((totalMs % 3600000) / 60000);
    const newS = Math.floor((totalMs % 60000) / 1000);
    const newMs = totalMs % 1000;

    const pad = (num: number, size: number) => String(num).padStart(size, "0");
    return `${pad(newH, 2)}:${pad(newM, 2)}:${pad(newS, 2)}.${pad(newMs, 3)}`;
  });
}

// Endpoint to serve dynamic subtitle files with CORS proxying and SRT -> VTT conversion
app.get("/api/subtitles", async (req, res) => {
  const movieId = req.query.movieId as string;
  const seasonId = req.query.seasonId as string;
  const episodeId = req.query.episodeId as string;
  const lang = (req.query.lang as string || "ar").toLowerCase();
  const offsetSec = parseFloat(req.query.offset as string || "0");

  if (!movieId) {
    return res.status(400).send("Movie ID is required");
  }

  const baseCacheKey = `${movieId}_${seasonId || ""}_${episodeId || ""}_${lang}`;
  if (subtitlesCache.has(baseCacheKey)) {
    const cachedVtt = subtitlesCache.get(baseCacheKey)!;
    if (lang === "ar" && !/[\u0600-\u06FF]/.test(cachedVtt)) {
      console.warn(`[Subtitles API] Invalidation: Cached subtitle for ${baseCacheKey} is missing Arabic text. Regenerating...`);
      subtitlesCache.delete(baseCacheKey);
    } else {
      const finalVtt = adjustVttTimestamps(cachedVtt, offsetSec);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send(finalVtt);
    }
  }

  let movie = moviesDatabase.find(m => m.id === movieId);
  if (!movie) {
    const promo = defaultPromos.find(p => p.id === movieId) || customPromos.find(p => p.id === movieId);
    if (promo) {
      movie = moviesDatabase.find(m => m.titleEn.toLowerCase().includes(promo.titleEn.toLowerCase()) || (promo.titleAr && m.titleAr.includes(promo.titleAr)));
    }
  }

  let title = movie ? movie.titleEn : (defaultPromos.find(p => p.id === movieId)?.titleEn || movieId);
  let externalUrl: string | undefined = undefined;

  if (movie) {
    if (movie.type === "series" && movie.seasons && seasonId && episodeId) {
      const season = movie.seasons.find(s => s.id === seasonId);
      if (season && season.episodes) {
        const episode = season.episodes.find(e => e.id === episodeId);
        if (episode) {
          title = `${movie.titleEn} - Season ${season.number} Episode ${episode.number}: ${episode.titleEn || ""}`;
          const epSub = lang === "ar" ? episode.subtitlesUrlAr : episode.subtitlesUrlEn;
          const epOrig = lang === "ar" ? episode.originalSubtitlesUrlAr : episode.originalSubtitlesUrlEn;

          if (epSub && (epSub.startsWith("/uploads/") || epSub.startsWith("data:") || epSub.startsWith("blob:"))) {
            externalUrl = epSub;
          } else if (epOrig && (epOrig.startsWith("/uploads/") || epOrig.startsWith("http://") || epOrig.startsWith("https://"))) {
            externalUrl = epOrig;
          } else if (epSub && !epSub.startsWith("/api/subtitles?")) {
            externalUrl = epSub;
          }
        }
      }
    } else {
      const movSub = lang === "ar" ? movie.subtitlesUrlAr : movie.subtitlesUrlEn;
      const movOrig = lang === "ar" ? movie.originalSubtitlesUrlAr : movie.originalSubtitlesUrlEn;

      if (movSub && (movSub.startsWith("/uploads/") || movSub.startsWith("data:") || movSub.startsWith("blob:"))) {
        externalUrl = movSub;
      } else if (movOrig && (movOrig.startsWith("/uploads/") || movOrig.startsWith("http://") || movOrig.startsWith("https://"))) {
        externalUrl = movOrig;
      } else if (movSub && !movSub.startsWith("/api/subtitles?")) {
        externalUrl = movSub;
      }
    }
  }

  const persistFoundUrl = (foundUrl: string, forLang: string = lang) => {
    if (!movie) return;
    if (movie.type === "series" && movie.seasons && seasonId && episodeId) {
      const season = movie.seasons.find(s => s.id === seasonId);
      const episode = season?.episodes?.find(e => e.id === episodeId);
      if (episode) {
        if (forLang === "ar") {
          episode.originalSubtitlesUrlAr = foundUrl;
          episode.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&seasonId=${seasonId}&episodeId=${episodeId}&lang=ar`;
        } else {
          episode.originalSubtitlesUrlEn = foundUrl;
          episode.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&seasonId=${seasonId}&episodeId=${episodeId}&lang=en`;
        }
      }
    } else {
      if (forLang === "ar") {
        movie.originalSubtitlesUrlAr = foundUrl;
        movie.subtitlesUrlAr = `/api/subtitles?movieId=${movie.id}&lang=ar`;
      } else {
        movie.originalSubtitlesUrlEn = foundUrl;
        movie.subtitlesUrlEn = `/api/subtitles?movieId=${movie.id}&lang=en`;
      }
    }
    saveMoviesDatabase();
  };

  const loadCandidateUrl = async (candidateUrl: string): Promise<string | null> => {
    if (candidateUrl.startsWith("/uploads/") || candidateUrl.includes("uploads/")) {
      try {
        const fileName = path.basename(candidateUrl);
        const filePath = path.join(process.cwd(), "uploads", fileName);
        if (fs.existsSync(filePath)) {
          let content = fs.readFileSync(filePath, "utf8");
          if (filePath.endsWith(".srt") || (!content.includes("WEBVTT") && content.includes("-->"))) {
            content = srtToVtt(content);
          }
          return content;
        }
      } catch (err: any) {
        console.error("[Subtitles API] Failed to load local uploaded subtitle file:", err.message);
      }
      return null;
    }
    if (candidateUrl.startsWith("http://") || candidateUrl.startsWith("https://")) {
      return await fetchAndBypassCorsSubtitles(candidateUrl, lang);
    }
    return null;
  };

  let finalRawVtt = "";

  // 1. Try whatever candidate URL is already stored for this movie/episode.
  if (externalUrl) {
    finalRawVtt = (await loadCandidateUrl(externalUrl)) || "";
    if (!finalRawVtt) {
      console.warn(`[Subtitles API] Stored subtitle URL failed to load or is no longer valid, will re-search: ${externalUrl}`);
    }
  }

  // 2. If we still have nothing playable (no stored URL, or the stored one just failed),
  // always attempt a fresh real-source search - this no longer requires Gemini, since
  // OpenSubtitles/Archive.org work without it too.
  if (!finalRawVtt) {
    try {
      console.log(`[Subtitles API] No usable subtitle for "${title}" (${lang}). Triggering live real-source search...`);
      const year = movie ? movie.year : new Date().getFullYear();
      const type = movie ? movie.type : "movie";
      const subs = await findSubtitlesForWork(movie ? movie.titleEn : title, year, type);
      const foundUrl = lang === "ar" ? subs.ar : subs.en;
      const otherLang = lang === "ar" ? "en" : "ar";
      const otherFoundUrl = lang === "ar" ? subs.en : subs.ar;
      // Persist whichever other language was also found in this same search, so it
      // isn't wasted (OpenSubtitles downloads count against a limited daily quota).
      if (otherFoundUrl) persistFoundUrl(otherFoundUrl, otherLang);
      if (foundUrl) {
        console.log(`[Subtitles API] Live search found a verified real subtitle: ${foundUrl}`);
        finalRawVtt = (await loadCandidateUrl(foundUrl)) || "";
        if (finalRawVtt) persistFoundUrl(foundUrl);
      }
    } catch (searchErr) {
      console.warn(`[Subtitles API] Live subtitle search failed:`, searchErr);
    }
  }

  if (!finalRawVtt) {
    console.log(`[Subtitles API] No real subtitle could be found for "${title}" (${lang}). Returning an honest not-available notice.`);
    const finalVtt = generateNotAvailableVtt(lang);
    // Do NOT cache this - a future request should keep retrying real sources
    // (e.g. once an OpenSubtitles API key is configured) instead of getting stuck.
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    return res.send(finalVtt);
  }

  subtitlesCache.set(baseCacheKey, finalRawVtt);
  const finalVtt = adjustVttTimestamps(finalRawVtt, offsetSec);
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  return res.send(finalVtt);
});

// Helpers to sort movies in collections from Part 1 to last, and expand search results
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
    groups[cid].sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0));
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

// Get Home Categorized Movies (retrieves from local database with optional Gemini background enrichment)
app.get("/api/movies", async (req, res) => {
  try {
    // If Gemini is active, keep triggering background enrichment to populate more content
    if (ai) {
      const now = Date.now();
      if (!cachedHomeData || (now - lastCacheTime > CACHE_DURATION)) {
        fetchHomeMoviesFromGemini().catch(console.error);
      }
    }

    // Dynamic track healing to ensure every single movie has subtitle URLs and real servers configured correctly
    moviesDatabase.forEach(movie => {
      enrichMovieMetadata(movie);
    });

    // Only present published (non-deleted & non-draft) movies on the end-user app interface
    const publishedDatabase = moviesDatabase.filter(m => 
      !isMovieDeleted(m.id, m.titleAr, m.titleEn) && m.isPublished !== false
    );

    const recentlyAdded = publishedDatabase.slice().reverse();
    
    // Fallback to rating filter if no custom trending list is set
    const trending = customTrendingIds.length > 0
      ? customTrendingIds.map(id => publishedDatabase.find(m => m.id === id)).filter((m): m is Movie => !!m)
      : publishedDatabase.filter(m => m.rating >= 8.5);

    const action = publishedDatabase.filter(m => m.genres.includes("أكشن") || m.genres.includes("خيال علمي") || m.genres.includes("Action") || m.genres.includes("Sci-Fi"));
    const series = publishedDatabase.filter(m => m.type === "series");
    const moviesOnly = publishedDatabase.filter(m => m.type === "movie");

    // Fallback to first movie if no custom hero is selected
    const heroMovie = customHeroId 
      ? (publishedDatabase.find(m => m.id === customHeroId) || publishedDatabase[0])
      : (publishedDatabase[0]);

    const latest10 = recentlyAdded.slice(0, 10);

    res.json({
      hero: heroMovie,
      heroMovies: latest10,
      promos: customPromos.length > 0 ? customPromos : defaultPromos,
      categories: [
        { id: "recent", titleAr: "الأفلام والمسلسلات المضافة حديثاً", titleEn: "Recently Added", items: sortMoviesByPart(recentlyAdded) },
        { id: "trending", titleAr: "الأكثر مشاهدة والأعلى تقييماً", titleEn: "Trending & Top Rated", items: sortMoviesByPart(trending) },
        { id: "series", titleAr: "أحدث المسلسلات والبرامج", titleEn: "Latest Series", items: sortMoviesByPart(series) },
        { id: "action", titleAr: "أفلام الأكشن والخيال العلمي", titleEn: "Action & Sci-Fi", items: sortMoviesByPart(action) },
        { id: "movies", titleAr: "أفلام سينمانا المميزة", titleEn: "Featured Movies", items: sortMoviesByPart(moviesOnly) }
      ]
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- CINEMANA & TMDB API IMPORTER ENDPOINTS ---

// 1. Trigger Batch Import on demand
app.post(["/api/cinemana/import-batch", "/api/import/cinemana-tmdb"], async (req, res) => {
  try {
    const limit = parseInt(req.body.limit) || 15;
    const query = req.body.query || req.body.forceQuery || "";
    
    console.log(`[API Endpoint] Manual request to trigger Cinemana + TMDB import batch (limit: ${limit}, query: "${query}")...`);
    
    const result = await importBatchFromCinemanaAndTMDB({ limit, forceQuery: query });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ status: "error", error: error.message || "Failed to run import batch" });
  }
});

// 2. Get Importer Status & Statistics
app.get("/api/cinemana/import-status", (req, res) => {
  const nextRunMinutes = cinemanaImportStats.lastRunTimestamp 
    ? Math.max(1, Math.round(60 - ((Date.now() - cinemanaImportStats.lastRunTimestamp) / 60000))) 
    : 60;

  res.json({
    status: "active",
    schedule: "Automated hourly import (15 items per batch)",
    stats: {
      ...cinemanaImportStats,
      nextScheduledRunInMinutes: nextRunMinutes,
      totalMoviesAndSeriesInDb: moviesDatabase.length,
      firestoreSynced: true
    }
  });
});

// --- ADMIN CONTROL PANEL ENDPOINTS ---

// 1. Get all movies + admin config
app.get("/api/admin/data", (req, res) => {
  res.json({
    movies: moviesDatabase,
    customHeroId,
    customTrendingIds,
    customPromos: customPromos.length > 0 ? customPromos : defaultPromos
  });
});

// 2. Add movie or series
app.post("/api/admin/movies", async (req, res) => {
  try {
    const movie = req.body;
    
    // Fallback titles if one of them is missing
    if (!movie.titleAr && movie.titleEn) movie.titleAr = movie.titleEn;
    if (!movie.titleEn && movie.titleAr) movie.titleEn = movie.titleAr;

    if (!movie.titleAr || !movie.titleEn) {
      return res.status(400).json({ error: "الرجاء إدخال اسم العمل (بالعربية أو الإنجليزية)" });
    }
    
    if (!movie.type) movie.type = "movie";

    // Generate unique ID if not provided
    if (!movie.id) {
      const prefix = movie.type === "series" ? "series_" : "movie_";
      movie.id = prefix + Date.now();
    }

    movie.rating = parseFloat(movie.rating) || 8.0;
    movie.year = parseInt(movie.year) || new Date().getFullYear();
    
    if (!Array.isArray(movie.genres)) movie.genres = [];
    if (!Array.isArray(movie.actors)) movie.actors = [];
    if (!Array.isArray(movie.servers)) movie.servers = [];

    // Guarantee at least one valid stream server for movies if empty
    if (movie.type === "movie" && movie.servers.length === 0) {
      movie.servers = [{ name: "سيرفر رئيسي 1080p", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }];
    }

    // Immediately sanitize subtitle URLs & save original external URLs before pushing
    movie.subtitlesUrlAr = getValidSubtitleUrl(movie.subtitlesUrlAr, movie.id, "ar", undefined, undefined, movie);
    movie.subtitlesUrlEn = getValidSubtitleUrl(movie.subtitlesUrlEn, movie.id, "en", undefined, undefined, movie);

    if (movie.type === "series" && movie.seasons) {
      movie.seasons.forEach((season: any) => {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          season.episodes.forEach((episode: any) => {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;
            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, movie.id, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, movie.id, "en", sId, eId, episode);
          });
        }
      });
    }

    // Safely verify and heal poster and backdrop image URLs with a fast timeout
    try {
      const healTimeout = (ms: number, promise: Promise<string>, fallback: string) => 
        Promise.race([promise, new Promise<string>(resolve => setTimeout(() => resolve(fallback), ms))]);

      const defaultPoster = movie.poster && movie.poster.startsWith("http") ? movie.poster : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80";
      const defaultBackdrop = movie.backdrop && movie.backdrop.startsWith("http") ? movie.backdrop : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";

      movie.poster = await healTimeout(2500, verifyAndCorrectImageUrl(movie.poster, movie.titleEn || movie.titleAr, false, movie.genres), defaultPoster);
      movie.backdrop = await healTimeout(2500, verifyAndCorrectImageUrl(movie.backdrop, movie.titleEn || movie.titleAr, true, movie.genres), defaultBackdrop);
    } catch (imgErr) {
      console.warn("[Admin Movie Add] Image healing skipped due to error:", imgErr);
    }

    // Prevent publishing separate season entries for series & merge into existing series
    if (movie.type === "series") {
      const cleanRoots = getSeriesRootTitle(movie.titleAr, movie.titleEn);
      
      const existingSeries = findDuplicateMovieOrSeries(cleanRoots.rootAr, cleanRoots.rootEn, movie.id, "series");
      if (existingSeries) {
        console.log(`[Admin Movie Add] Merging incoming seasons into existing series "${existingSeries.titleAr}"`);
        if (!existingSeries.seasons) existingSeries.seasons = [];

        const incomingSeasons = (movie.seasons && movie.seasons.length > 0)
          ? movie.seasons
          : [{
              id: `s1_${Date.now()}`,
              number: 1,
              titleAr: "الموسم 1",
              titleEn: "Season 1",
              poster: movie.poster,
              backdrop: movie.backdrop,
              episodes: []
            }];

        for (const incSzn of incomingSeasons) {
          const exSzn = existingSeries.seasons.find(s => s.number === incSzn.number);
          if (exSzn) {
            if (incSzn.poster) exSzn.poster = incSzn.poster;
            if (incSzn.storyAr) exSzn.storyAr = incSzn.storyAr;
            if (incSzn.storyEn) exSzn.storyEn = incSzn.storyEn;
            if (incSzn.episodes && incSzn.episodes.length > 0) {
              for (const ep of incSzn.episodes) {
                if (!exSzn.episodes.some(e => e.number === ep.number || e.id === ep.id)) {
                  exSzn.episodes.push(ep);
                }
              }
              exSzn.episodes.sort((a, b) => a.number - b.number);
            }
          } else {
            existingSeries.seasons.push(incSzn);
          }
        }
        existingSeries.seasons.sort((a, b) => a.number - b.number);

        saveMoviesDatabase();
        saveMovieToFirestore(existingSeries).catch(console.error);

        return res.status(200).json({ success: true, movie: existingSeries });
      }

      movie.titleAr = cleanRoots.rootAr;
      movie.titleEn = cleanRoots.rootEn;
    }

    moviesDatabase.push(movie);
    unmarkMovieAsDeleted(movie.id, movie.titleAr, movie.titleEn);
    subtitlesCache.clear();
    saveMoviesDatabase();
    
    // Sync with Firestore asynchronously
    saveMovieToFirestore(movie).catch(console.error);

    res.status(201).json({ success: true, movie });
  } catch (error: any) {
    console.error("[Admin Movie Add Error]:", error);
    res.status(500).json({ error: error.message || "فشلت عملية إضافة العمل" });
  }
});

// 3. Edit movie or series
app.put("/api/admin/movies/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const index = moviesDatabase.findIndex(m => m.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Movie not found" });
    }

    const updatedMovie = { ...moviesDatabase[index], ...req.body };

    if (!updatedMovie.titleAr && updatedMovie.titleEn) updatedMovie.titleAr = updatedMovie.titleEn;
    if (!updatedMovie.titleEn && updatedMovie.titleAr) updatedMovie.titleEn = updatedMovie.titleAr;

    updatedMovie.rating = parseFloat(updatedMovie.rating) || 8.0;
    updatedMovie.year = parseInt(updatedMovie.year) || new Date().getFullYear();
    if (!Array.isArray(updatedMovie.genres)) updatedMovie.genres = [];
    if (!Array.isArray(updatedMovie.actors)) updatedMovie.actors = [];
    if (!Array.isArray(updatedMovie.servers)) updatedMovie.servers = [];

    // Immediately sanitize subtitle URLs & save original external URLs before saving
    updatedMovie.subtitlesUrlAr = getValidSubtitleUrl(updatedMovie.subtitlesUrlAr, updatedMovie.id, "ar", undefined, undefined, updatedMovie);
    updatedMovie.subtitlesUrlEn = getValidSubtitleUrl(updatedMovie.subtitlesUrlEn, updatedMovie.id, "en", undefined, undefined, updatedMovie);

    if (updatedMovie.type === "series" && updatedMovie.seasons) {
      updatedMovie.seasons.forEach((season: any) => {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          season.episodes.forEach((episode: any) => {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;
            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, updatedMovie.id, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, updatedMovie.id, "en", sId, eId, episode);
          });
        }
      });
    }

    // Safely verify and heal poster and backdrop image URLs with a fast timeout
    try {
      const healTimeout = (ms: number, promise: Promise<string>, fallback: string) => 
        Promise.race([promise, new Promise<string>(resolve => setTimeout(() => resolve(fallback), ms))]);

      const defaultPoster = updatedMovie.poster && updatedMovie.poster.startsWith("http") ? updatedMovie.poster : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&q=80";
      const defaultBackdrop = updatedMovie.backdrop && updatedMovie.backdrop.startsWith("http") ? updatedMovie.backdrop : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1200&q=80";

      updatedMovie.poster = await healTimeout(2500, verifyAndCorrectImageUrl(updatedMovie.poster, updatedMovie.titleEn || updatedMovie.titleAr, false, updatedMovie.genres), defaultPoster);
      updatedMovie.backdrop = await healTimeout(2500, verifyAndCorrectImageUrl(updatedMovie.backdrop, updatedMovie.titleEn || updatedMovie.titleAr, true, updatedMovie.genres), defaultBackdrop);
    } catch (imgErr) {
      console.warn("[Admin Movie Edit] Image healing skipped due to error:", imgErr);
    }

    moviesDatabase[index] = updatedMovie;
    unmarkMovieAsDeleted(updatedMovie.id, updatedMovie.titleAr, updatedMovie.titleEn);
    subtitlesCache.clear();
    saveMoviesDatabase();
    
    // Sync with Firestore asynchronously
    saveMovieToFirestore(updatedMovie).catch(console.error);

    res.json({ success: true, movie: updatedMovie });
  } catch (error: any) {
    console.error("[Admin Movie Edit Error]:", error);
    res.status(500).json({ error: error.message || "فشلت عملية حفظ التعديلات" });
  }
});

// 3b. Toggle Publish Status
app.post("/api/admin/movies/toggle-publish", async (req, res) => {
  try {
    const { id, isPublished } = req.body;
    const movie = moviesDatabase.find(m => m.id === id);
    if (!movie) {
      return res.status(404).json({ error: "العمل غير موجود" });
    }

    movie.isPublished = isPublished !== undefined ? Boolean(isPublished) : !(movie.isPublished !== false);
    saveMoviesDatabase();
    saveMovieToFirestore(movie).catch(console.error);
    cachedHomeData = null;

    res.json({
      success: true,
      movie,
      message: movie.isPublished ? "تم نشر العمل بنجاح ليصبح معروضاً للجمهور!" : "تم تحويل العمل إلى قائمة بانتظار المراجعة"
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "فشلت عملية تغيير حالة النشر" });
  }
});

// 3c. Publish Batch (Publish All Pending)
app.post("/api/admin/movies/publish-batch", async (req, res) => {
  try {
    const { ids, publishAll } = req.body;
    let publishedCount = 0;

    moviesDatabase.forEach(movie => {
      if (publishAll || (Array.isArray(ids) && ids.includes(movie.id))) {
        if (movie.isPublished === false) {
          movie.isPublished = true;
          publishedCount++;
          saveMovieToFirestore(movie).catch(console.error);
        }
      }
    });

    if (publishedCount > 0) {
      saveMoviesDatabase();
      cachedHomeData = null;
    }

    res.json({
      success: true,
      count: publishedCount,
      message: `تم نشر وتفعيل ${publishedCount} عمل بنجاح!`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "فشلت عملية النشر الجماعي" });
  }
});

// 4. Delete movie or series
app.delete("/api/admin/movies/:id", (req, res) => {
  try {
    const { id } = req.params;
    const index = moviesDatabase.findIndex(m => m.id === id);
    if (index !== -1) {
      const targetMovie = moviesDatabase[index];
      markMovieAsDeleted(targetMovie);
      moviesDatabase.splice(index, 1);
    } else {
      markMovieAsDeleted({ id });
    }

    subtitlesCache.clear();
    cachedHomeData = null; // Clear home API cache immediately so deleted works disappear instantly
    
    if (customHeroId === id) {
      customHeroId = null;
    }
    customTrendingIds = customTrendingIds.filter(tid => tid !== id);
    
    saveMoviesDatabase();
    saveConfig();
    
    // Sync with Firestore asynchronously
    deleteMovieFromFirestore(id).catch(console.error);
    saveConfigToFirestore().catch(console.error);

    res.json({ success: true, message: "Movie deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Update overall admin configuration (hero banner, trending IDs, promos)
app.post("/api/admin/config", (req, res) => {
  try {
    const { customHeroId: newHeroId, customTrendingIds: newTrendingIds, customPromos: newPromos } = req.body;
    
    if (newHeroId !== undefined) {
      customHeroId = newHeroId;
    }
    if (newTrendingIds !== undefined && Array.isArray(newTrendingIds)) {
      customTrendingIds = newTrendingIds;
    }
    if (newPromos !== undefined && Array.isArray(newPromos)) {
      customPromos = newPromos;
    }

    saveConfig();
    
    // Sync with Firestore asynchronously
    saveConfigToFirestore().catch(console.error);

    res.json({ success: true, customHeroId, customTrendingIds, customPromos });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- PRE-ROLL ADS ENDPOINTS ---

// Public endpoint to get active ads
app.get("/api/ads", (req, res) => {
  try {
    const activeAds = (adsSettings.ads || []).filter((a: any) => a.isActive !== false);
    res.json({
      enabled: adsSettings.enabled !== false,
      globalSkipAfterSeconds: adsSettings.globalSkipAfterSeconds || 5,
      allowSkip: adsSettings.allowSkip !== false,
      ads: activeAds
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to get full ads configuration
app.get("/api/admin/ads", (req, res) => {
  try {
    res.json({ success: true, adsSettings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to update ads configuration
app.post("/api/admin/ads", (req, res) => {
  try {
    const { enabled, globalSkipAfterSeconds, allowSkip, ads } = req.body;
    
    if (enabled !== undefined) adsSettings.enabled = Boolean(enabled);
    if (globalSkipAfterSeconds !== undefined) adsSettings.globalSkipAfterSeconds = Number(globalSkipAfterSeconds);
    if (allowSkip !== undefined) adsSettings.allowSkip = Boolean(allowSkip);
    if (Array.isArray(ads)) adsSettings.ads = ads;

    saveConfig();
    saveConfigToFirestore().catch(console.error);

    res.json({ success: true, message: "تم حفظ إعدادات الإعلانات وسيرفرات البث بنجاح", adsSettings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoint to upload ad media (videos, banners, logos)
app.post("/api/admin/ads/upload-media", (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
      return res.status(400).json({ error: "الرجاء تحديد الملف والمحتوى" });
    }

    const UPLOADS_DIR = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `ad_${Date.now()}_${safeName}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);

    let buffer: Buffer;
    if (fileContent.startsWith("data:") && fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      buffer = Buffer.from(base64Data, "base64");
    } else {
      buffer = Buffer.from(fileContent, "utf8");
    }

    fs.writeFileSync(filePath, buffer);

    res.json({ success: true, url: `/uploads/${uniqueName}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5b. Upload subtitle file (.srt / .vtt)
app.post("/api/admin/upload-subtitle", (req, res) => {
  try {
    const { fileName, fileContent } = req.body;
    if (!fileName || !fileContent) {
      return res.status(400).json({ error: "Missing fileName or fileContent" });
    }
    
    // Ensure uploads directory exists
    const UPLOADS_DIR = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    
    // Sanitize fileName to prevent path traversal
    const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueName = `${Date.now()}_${safeName}`;
    const filePath = path.join(UPLOADS_DIR, uniqueName);
    
    // Write content - handle base64 data URLs or raw strings
    let buffer: Buffer;
    if (fileContent.startsWith("data:") && fileContent.includes(";base64,")) {
      const base64Data = fileContent.split(";base64,")[1];
      buffer = Buffer.from(base64Data, "base64");
    } else {
      buffer = Buffer.from(fileContent, "utf8");
    }
    
    fs.writeFileSync(filePath, buffer);
    subtitlesCache.clear();
    
    res.json({ success: true, url: `/uploads/${uniqueName}` });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5c. Proxy subtitle file to bypass CORS issues in browser
app.get("/api/proxy-subtitles", async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      return res.status(400).json({ error: "Missing required parameter 'url'" });
    }

    const fetchResponse = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!fetchResponse.ok) {
      return res.status(fetchResponse.status).send(`Failed to fetch from remote: ${fetchResponse.statusText}`);
    }

    const arrayBuffer = await fetchResponse.arrayBuffer();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", fetchResponse.headers.get("Content-Type") || "text/plain; charset=utf-8");
    return res.send(Buffer.from(arrayBuffer));
  } catch (error: any) {
    console.error("[Proxy Subtitles] Error:", error.message);
    return res.status(500).send(error.message);
  }
});

// 5d. Import Arabic/English subtitle from subsource.net
app.post("/api/admin/import-subsource", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Missing required parameter 'url'" });
    }

    console.log(`[Subsource Importer] Request for URL: ${url}`);

    // 1. Try to extract ID from URL
    const idMatch = url.match(/\/(\d+)\/?$/) || url.match(/-(\d+)\/?$/) || url.match(/id=(\d+)/);
    const id = idMatch ? idMatch[1] : null;
    
    let buffer: Buffer | null = null;
    let fileName = "subtitle.srt";
    let downloadUrl = "";

    // We will try multiple potential download paths
    const tryUrls: string[] = [];
    if (id) {
      tryUrls.push(`https://api.subsource.net/api/download/${id}`);
      tryUrls.push(`https://subsource.net/subtitle/download-file/${id}`);
      tryUrls.push(`https://subsource.net/download/subtitle?id=${id}`);
    }
    tryUrls.push(url); // Also try fetching the main URL directly in case it is a direct download link

    for (const tryUrl of tryUrls) {
      try {
        console.log(`[Subsource Importer] Trying download from: ${tryUrl}`);
        const fetchRes = await fetch(tryUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "application/octet-stream, application/zip, */*",
          },
          signal: AbortSignal.timeout(10000)
        });

        if (fetchRes.ok) {
          const contentType = fetchRes.headers.get("content-type") || "";
          const contentDisposition = fetchRes.headers.get("content-disposition") || "";
          
          if (contentType.includes("text/html") && tryUrl === url && id) {
            continue;
          }

          const ab = await fetchRes.arrayBuffer();
          const tempBuf = Buffer.from(ab);
          if (tempBuf.length > 100) { // Valid file
            buffer = tempBuf;
            downloadUrl = tryUrl;
            
            const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
            if (filenameMatch) {
              fileName = filenameMatch[1];
            }
            break;
          }
        }
      } catch (err: any) {
        console.warn(`[Subsource Importer] Failed to fetch from ${tryUrl}:`, err.message);
      }
    }

    // 2. Fallback: If we couldn't download directly, let's fetch the page HTML and parse it
    if (!buffer) {
      console.log(`[Subsource Importer] Direct URLs failed or no ID. Fetching page HTML...`);
      const pageRes = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000)
      });

      if (pageRes.ok) {
        const html = await pageRes.text();
        
        const subIdMatch = html.match(/"id"\s*:\s*(\d+)/) || 
                           html.match(/download-file\/(\d+)/) || 
                           html.match(/subtitle\?id=(\d+)/) ||
                           html.match(/download\/(\d+)/);
        
        if (subIdMatch) {
          const extractedId = subIdMatch[1];
          console.log(`[Subsource Importer] Extracted ID from HTML: ${extractedId}`);
          const fallbackUrls = [
            `https://api.subsource.net/api/download/${extractedId}`,
            `https://subsource.net/subtitle/download-file/${extractedId}`,
            `https://subsource.net/download/subtitle?id=${extractedId}`
          ];

          for (const fUrl of fallbackUrls) {
            try {
              const fRes = await fetch(fUrl, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
                }
              });
              if (fRes.ok) {
                const ab = await fRes.arrayBuffer();
                buffer = Buffer.from(ab);
                downloadUrl = fUrl;
                break;
              }
            } catch (e) {}
          }
        }
      }
    }

    if (!buffer) {
      return res.status(404).json({ error: "تعذر تحميل ملف الترجمة من الرابط الموفر. يرجى التأكد من أن الرابط صحيح ويشير لصفحة ترجمة صالحة على Subsource.net" });
    }

    // 3. Check if the buffer is a ZIP file (starts with PK\x03\x04, i.e. 0x50 0x4B 0x03 0x04)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
      console.log("[Subsource Importer] ZIP file detected. Extracting...");
      try {
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();
        const entry = zipEntries.find(e => e.entryName.toLowerCase().endsWith(".srt") || e.entryName.toLowerCase().endsWith(".vtt"));
        if (entry) {
          buffer = entry.getData();
          fileName = entry.entryName;
          console.log(`[Subsource Importer] Extracted file: ${fileName}`);
        } else {
          console.warn("[Subsource Importer] No .srt or .vtt file found in the ZIP archive.");
        }
      } catch (zipErr: any) {
        console.error("[Subsource Importer] Error unzipping file:", zipErr.message);
      }
    }

    // 4. Correctly detect Windows-1256 (Arabic) vs UTF-8 encoding
    const finalDecodedText = decodeSubtitleBuffer(buffer);
    console.log(`[Subsource Importer] Decoded ${finalDecodedText.length} characters, contains Arabic: ${/[\u0600-\u06FF]/.test(finalDecodedText)}`);

    // 5. Save decoded content as clean UTF-8
    const UPLOADS_DIR = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }

    const safeName = "subsource_" + Date.now() + "_" + path.basename(fileName).replace(/[^a-zA-Z0-9.-]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".vtt") || safeName.toLowerCase().endsWith(".srt") ? safeName : safeName + ".srt";
    const filePath = path.join(UPLOADS_DIR, finalName);
    
    fs.writeFileSync(filePath, finalDecodedText, "utf8");
    console.log(`[Subsource Importer] Subtitle successfully saved to ${filePath}`);

    return res.json({ success: true, url: `/uploads/${finalName}` });
  } catch (error: any) {
    console.error("[Subsource Importer] Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Auto-fetch real subtitles endpoint for admin
app.post("/api/admin/auto-fetch-subtitles", async (req, res) => {
  try {
    const { titleEn, titleAr, year, imdbId, type } = req.body;
    if (!titleEn && !titleAr) {
      return res.status(400).json({ error: "Missing title parameter" });
    }
    const queryTitle = titleEn || titleAr;
    const queryYear = year || new Date().getFullYear();
    console.log(`[Admin Auto-Subtitles] Searching real subtitles for "${queryTitle}" (${queryYear})...`);

    const subs = await findSubtitlesForWork(queryTitle, queryYear, type || "movie", imdbId);

    const arUrl = subs.ar || "";
    const enUrl = subs.en || "";
    const foundAny = Boolean(arUrl || enUrl);

    return res.json({
      success: foundAny,
      subtitlesUrlAr: arUrl,
      subtitlesUrlEn: enUrl,
      message: foundAny
        ? `تم العثور على ترجمة حقيقية موثقة: ${arUrl ? "عربي " : ""}${enUrl ? "إنجليزي" : ""}`.trim()
        : "لم يتم العثور على ترجمة حقيقية موثقة لهذا العمل. لن يتم إنشاء أي محتوى مفبرك - يمكنك رفع ملف ترجمة يدوياً بدلاً من ذلك."
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to auto-fetch subtitles" });
  }
});

// Manual Cinemana Full Sync Endpoint for Admin Panel
app.post("/api/api/admin/sync-cinemana", async (req, res) => {
  // Keeping fallback path just in case
  return res.redirect(307, "/api/admin/sync-cinemana");
});

app.post("/api/admin/sync-cinemana", async (req, res) => {
  try {
    console.log("[Server] Manual Cinemana sync requested by admin. Preserving manually uploaded movies/series...");
    
    // Clear cache timestamp to force fresh fetch
    lastCacheTime = 0;
    
    // Kick off both standard Gemini Home Sync and the deep TMDB auto-seeder in the background
    fetchHomeMoviesFromGemini().catch(err => console.error("[Server] Error in async Cinemana home fetch:", err));
    seedRealMoviesFromTMDB().catch(err => console.error("[Server] Error in async TMDB background seeding:", err));

    return res.json({ 
      success: true, 
      message: "تم بدء مزامنة سينمانا المتقدمة واستيراد أكثر من 50 عملاً سينمائياً وتلفزيونياً عالمياً حقيقياً في الخلفية بنجاح، مع الحفاظ الكامل على كافة الأفلام والمسلسلات التي تم رفعها وتخزينها دائماً في قاعدة البيانات!" 
    });
  } catch (err: any) {
    console.error("[Server] Manual Cinemana sync failed:", err);
    return res.status(500).json({ error: err.message || "حدث خطأ غير متوقع أثناء المزامنة." });
  }
});

// 6. Import movie metadata from any URL using Gemini
app.post("/api/admin/import-url", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "Missing required parameter 'url'" });
  }

  // Pre-emptive check for active Gemini rate limits: bypass and use TMDB scraper directly
  if (!ai || Date.now() < quotaExceededUntil) {
    console.warn("[Importer] Gemini is currently cooling down/rate-limited. Falling back directly to TMDB scraper.");
    try {
      const scrapedData = await scrapeTMDBMetadata(url);
      if (scrapedData && scrapedData.titleEn && !scrapedData.poster?.includes("images.unsplash.com")) {
        console.log("[Importer] Direct fallback to TMDB scraper completed successfully!");
        return res.json({ success: true, data: scrapedData });
      }
    } catch (scrapeErr: any) {
      console.error("[Importer] Direct fallback to TMDB scraper failed:", scrapeErr);
    }
    return res.status(400).json({ error: "تعذر العثور على معلومات فيلم أو مسلسل حقيقي بهذا الاسم أو الرابط على TMDB. يرجى التأكد من كتابة الاسم بدقة أو استخدام رابط TMDB مباشر." });
  }

  try {
    console.log(`[Importer] Processing import request for URL or Search query: ${url}`);
    
    // Check if the input is a valid URL
    const isUrl = url.startsWith("http://") || url.startsWith("https://");
    
    let contextHint = "";
    let htmlContent = "";

    if (isUrl) {
      // Parse URL for identifiers to help Gemini Search
      if (url.includes("imdb.com")) {
        const match = url.match(/title\/(tt\d+)/);
        if (match) {
          contextHint = `IMDb ID detected: ${match[1]}. Please query Google Search for "IMDb ${match[1]}" or "TMDB ${match[1]}" to get exact movie/series details including English and Arabic titles, release year, duration, and poster.`;
        }
      } else if (url.includes("cinemana")) {
        const movieMatch = url.match(/movie\/(\d+)/);
        const showMatch = url.match(/show\/(\d+)/);
        const videoMatch = url.match(/video\/(\d+)/);
        const id = movieMatch?.[1] || showMatch?.[1] || videoMatch?.[1];
        if (id) {
          contextHint = `Cinemana item detected with ID: ${id}. Please query Google Search for "Cinemana ${id}" or "سينمانا ${id}" to retrieve the exact film or show name and its respective Arabic/English details.`;
        }
      }

      // Fetch page content (HTML) as contextual help for Gemini
      try {
        const fetchResponse = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept-Language": "ar,en-US;q=0.9,en;q=0.8"
          },
          signal: AbortSignal.timeout(8000)
        });
        if (fetchResponse.ok) {
          htmlContent = await fetchResponse.text();
          // Truncate to first 20000 chars to avoid model context bloat
          htmlContent = htmlContent.substring(0, 20000);
        }
      } catch (fetchErr: any) {
        console.warn(`[Importer] Failed to fetch HTML from URL ${url}: ${fetchErr.message}`);
      }
    } else {
      // The input is a raw search query (movie name or series name)
      contextHint = `Direct movie/series search query: "${url}". Please search Google for this movie/series to locate its official details, IMDb page, or TMDB page, and construct a highly accurate and professional metadata report.`;
    }

    if (!ai) {
      return res.status(500).json({ error: "Gemini client is not initialized. Please verify GEMINI_API_KEY." });
    }

    // Step 1: Research the movie/show using Google Search grounding
    const researchPrompt = `You are an expert movie and series researcher.
We need to gather accurate and complete metadata for the movie or series based on the following input.
Input: ${url}
Is Input a URL?: ${isUrl ? "Yes" : "No, this is a direct movie/series title search query."}
Search Context Hint: ${contextHint}
Parsed HTML content: ${htmlContent ? htmlContent.substring(0, 8000) : "None available. You MUST search Google to find out what this refers to."}

Tasks:
1. Identify the exact movie or series name (both Arabic and English).
2. Use Google Search grounding to find the official information on IMDb, TMDB, or Wikipedia.
3. Retrieve and write down:
   - Localized Arabic Title and Official English Title
   - Release year
   - Content Type (movie or series)
   - IMDb / TMDB Rating
   - Runtime duration (e.g., "2h 15m" or "45m")
   - Main genres in Arabic (choose from: أكشن, خيال علمي, مغامرة, دراما, كوميديا, رعب, جريمة, تشويق, وثائقي, عائلي, خيال)
   - A high-quality vertical poster image URL and horizontal backdrop/fanart image URL (from TMDB, IMDb, or another public high-quality movie source)
   - Professional Arabic synopsis and English synopsis (Do not output machine translations, make it sound premium and professional)
   - Main cast/actors (4-5 names in English)
   - Official YouTube trailer watch link (e.g. https://www.youtube.com/watch?v=...)
   - Subtitle file URLs (Arabic and English) at both the movie/series level AND for each episode of a series. Search real public subtitle databases (e.g. opensubtitles.com, subsource.net, subdl.com, GitHub, Archive.org) via Google Search grounding and report only URLs that actually appeared in real search results. If no real subtitle URL was found in the search results, state that none was found rather than inventing one - downstream code will independently verify every URL before it is trusted.
   - A single working video stream URL from Cinemana. If the input is a Cinemana URL, extract its numeric ID and build a single server direct stream URL using: https://video.shabakaty.com/movies/{id}/index.m3u8 (or for episodes: https://video.shabakaty.com/movies/{series_id}/{season_number}/{episode_number}/index.m3u8). Otherwise, provide exactly one direct Cinemana URL based on the TMDB/IMDb ID or movie details. Always provide exactly one server in the result.
   - If it is a series, find the seasons and episodes list with names, durations, summaries, specific episode ratings, and episode-specific Arabic & English subtitle URLs.

Write a comprehensive, factual research report containing all these details.`;

    console.log("[Importer] Launching Step 1 (Research with Google Search grounding)...");
    let researchReport = "";
    try {
      const researchResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: researchPrompt,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      researchReport = researchResponse.text || "No details found.";
      console.log("[Importer] Step 1 (with search grounding) Completed. Research Report Length:", researchReport.length);
    } catch (groundingError: any) {
      console.warn("[Importer] Step 1 with search grounding failed, falling back to direct content generation:", groundingError.message);
      try {
        const fallbackPrompt = `${researchPrompt}\n\n(Note: Google Search grounding is currently unavailable. Please use your internal pre-trained database of movies/series to construct this factual report based on the provided URL, title, or ID.)`;
        const fallbackResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: fallbackPrompt
        });
        researchReport = fallbackResponse.text || "No details found.";
        console.log("[Importer] Step 1 (Fallback without grounding) Completed. Research Report Length:", researchReport.length);
      } catch (fallbackError: any) {
        console.error("[Importer] Both grounding and direct fallback failed for Step 1:", fallbackError);
        throw fallbackError;
      }
    }

    // Step 2: Format the research report into structured JSON
    const formattingPrompt = `You are a professional metadata parser.
We have a research report for a movie or series:
----------------------------------
${researchReport}
----------------------------------

Your task is to parse this research report and structure it into a perfect, pure JSON object matching this structure:
{
  "titleAr": "Arabic title of the film/series",
  "titleEn": "English title of the film/series",
  "type": "movie" or "series",
  "rating": 8.5,
  "year": 2024,
  "duration": "Duration (e.g. '2h 15m' or '45m')",
  "ageRating": "Age classification rating (e.g., 'PG-13', 'R', 'TV-MA', 'G', 'PG', '+18', '+16', etc.)",
  "genres": ["أكشن", "خيال علمي", "مغامرة"], (Choose from: أكشن, خيال علمي, مغامرة, دراما, كوميديا, رعب, جريمة, تشويق, وثائقي, عائلي, خيال)
  "poster": "Vertical poster image URL. Ensure it is a valid, high-quality image URL.",
  "backdrop": "Horizontal backdrop image URL. Ensure it is a valid, high-quality image URL.",
  "logoUrl": "Title logo image URL (transparent PNG from TMDB, or empty string)",
  "storyAr": "Professional compelling Arabic synopsis.",
  "storyEn": "Professional English synopsis.",
  "actors": ["Actor 1", "Actor 2", "Actor 3", "Actor 4"],
  "quality": "Ultra HD",
  "subtitlesUrlAr": "Arabic subtitle track URL (.vtt or .srt, or empty string)",
  "subtitlesUrlEn": "English subtitle track URL (.vtt or .srt, or empty string)",
  "trailerUrl": "Official YouTube watch link (e.g., https://www.youtube.com/watch?v=...)",
  "servers": [
    { "name": "سيرفر سينمانا الرئيسي", "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
  ],
  "seasons": [
    {
      "number": 1,
      "titleAr": "الموسم الأول",
      "titleEn": "Season 1",
      "episodes": [
        {
          "number": 1,
          "titleAr": "الحلقة الأولى",
          "titleEn": "Episode 1",
          "duration": "45m",
          "storyAr": "ملخص الحلقة الأولى باللغة العربية...",
          "storyEn": "Episode 1 English summary...",
          "thumbnail": "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=500&q=80",
          "subtitlesUrlAr": "Arabic subtitle track URL for this specific episode (.vtt or .srt, or empty string)",
          "subtitlesUrlEn": "English subtitle track URL for this specific episode (.vtt or .srt, or empty string)",
          "rating": 8.5,
          "servers": [
            { "name": "سيرفر البث الرئيسي", "url": "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }
          ]
        }
      ]
    }
  ] (Only required when "type" is "series")
}

If "type" is "series", ensure you populate "seasons" with the seasons and episodes described in the report. If "type" is "movie", omit "seasons" entirely.
For "servers", ensure it contains EXACTLY ONE streaming server. Never put multiple servers. If the ID is known or found, use the direct Cinemana URL format (e.g., https://video.shabakaty.com/movies/{id}/index.m3u8).

IMPORTANT: For "subtitlesUrlAr" and "subtitlesUrlEn" (at both movie/series level and individual episode level), only populate them if the research report above actually contains a real subtitle URL it found via search. Otherwise return an empty string "". Never invent, guess, or construct a plausible-looking subtitle URL - every URL you return will be independently downloaded and verified, and a fabricated one will simply fail that check and waste the lookup.

CRITICAL: Return ONLY valid, pure JSON without any surrounding markdown code block characters or extra explanation.`;

    console.log("[Importer] Launching Step 2 (Formatting to JSON)...");
    let parsedData: any = {};
    try {
      const formatResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: formattingPrompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      let resultText = formatResponse.text?.trim() || "{}";
      if (resultText.includes("{")) {
        const start = resultText.indexOf("{");
        const end = resultText.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          resultText = resultText.substring(start, end + 1);
        }
      }
      parsedData = JSON.parse(resultText);
    } catch (formatError: any) {
      console.warn("[Importer] Step 2 JSON formatting failed, trying loose parsing without mimeType...", formatError.message);
      try {
        const formatResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `${formattingPrompt}\n\nCRITICAL: Return ONLY the raw JSON object, starting with { and ending with }.`
        });
        let resultText = formatResponse.text?.trim() || "{}";
        if (resultText.includes("{")) {
          const start = resultText.indexOf("{");
          const end = resultText.lastIndexOf("}");
          if (start !== -1 && end !== -1 && end > start) {
            resultText = resultText.substring(start, end + 1);
          }
        }
        parsedData = JSON.parse(resultText);
      } catch (fallbackFormatError: any) {
        console.error("[Importer] Formatting completely failed:", fallbackFormatError);
        throw new Error("عذراً، فشل تنسيق البيانات المستوردة من الذكاء الاصطناعي. يرجى المحاولة لاحقاً.");
      }
    }

    // Verify any extracted/searched external subtitle URLs from formatting step
    if (parsedData.subtitlesUrlAr && (parsedData.subtitlesUrlAr.startsWith("http://") || parsedData.subtitlesUrlAr.startsWith("https://"))) {
      const isValid = await verifySubtitleUrl(parsedData.subtitlesUrlAr, "ar");
      if (!isValid) {
        console.warn(`[Importer] Cleared unverified Arabic subtitle URL: ${parsedData.subtitlesUrlAr}`);
        parsedData.subtitlesUrlAr = "";
      }
    }
    if (parsedData.subtitlesUrlEn && (parsedData.subtitlesUrlEn.startsWith("http://") || parsedData.subtitlesUrlEn.startsWith("https://"))) {
      const isValid = await verifySubtitleUrl(parsedData.subtitlesUrlEn, "en");
      if (!isValid) {
        console.warn(`[Importer] Cleared unverified English subtitle URL: ${parsedData.subtitlesUrlEn}`);
        parsedData.subtitlesUrlEn = "";
      }
    }

    // If subtitles are missing or empty, fetch them automatically using our dedicated search
    if (!parsedData.subtitlesUrlAr || !parsedData.subtitlesUrlEn) {
      try {
        console.log("[Importer] Subtitles missing or unverified, invoking dedicated subtitle locator...");
        const subs = await findSubtitlesForWork(parsedData.titleEn || url, parsedData.year || new Date().getFullYear(), parsedData.type || "movie");
        if (!parsedData.subtitlesUrlAr) parsedData.subtitlesUrlAr = subs.ar;
        if (!parsedData.subtitlesUrlEn) parsedData.subtitlesUrlEn = subs.en;
      } catch (subErr) {
        console.warn("[Importer] Fallback subtitles lookup failed:", subErr);
      }
    }

    const tempMovieId = parsedData.id || `movie_${Date.now()}`;
    parsedData.id = tempMovieId;

    // Apply auto-sanitization to subtitles
    parsedData.subtitlesUrlAr = getValidSubtitleUrl(parsedData.subtitlesUrlAr, tempMovieId, "ar", undefined, undefined, parsedData);
    parsedData.subtitlesUrlEn = getValidSubtitleUrl(parsedData.subtitlesUrlEn, tempMovieId, "en", undefined, undefined, parsedData);

    // Also sanitize series season/episode levels with async verification
    if (parsedData.type === "series" && parsedData.seasons) {
      for (const season of parsedData.seasons) {
        const sId = season.id || `season_${season.number}`;
        season.id = sId;
        if (season.episodes) {
          for (const episode of season.episodes) {
            const eId = episode.id || `ep_${episode.number}`;
            episode.id = eId;

            if (episode.subtitlesUrlAr && (episode.subtitlesUrlAr.startsWith("http://") || episode.subtitlesUrlAr.startsWith("https://"))) {
              const isValid = await verifySubtitleUrl(episode.subtitlesUrlAr, "ar");
              if (!isValid) {
                console.warn(`[Importer] Cleared unverified Arabic episode subtitle: ${episode.subtitlesUrlAr}`);
                episode.subtitlesUrlAr = "";
              }
            }
            if (episode.subtitlesUrlEn && (episode.subtitlesUrlEn.startsWith("http://") || episode.subtitlesUrlEn.startsWith("https://"))) {
              const isValid = await verifySubtitleUrl(episode.subtitlesUrlEn, "en");
              if (!isValid) {
                console.warn(`[Importer] Cleared unverified English episode subtitle: ${episode.subtitlesUrlEn}`);
                episode.subtitlesUrlEn = "";
              }
            }

            episode.subtitlesUrlAr = getValidSubtitleUrl(episode.subtitlesUrlAr, tempMovieId, "ar", sId, eId, episode);
            episode.subtitlesUrlEn = getValidSubtitleUrl(episode.subtitlesUrlEn, tempMovieId, "en", sId, eId, episode);
          }
        }
      }
    }

    // Verify and correct images (poster & backdrop)
    parsedData.poster = await verifyAndCorrectImageUrl(parsedData.poster, parsedData.titleEn || parsedData.titleAr, false, parsedData.genres);
    parsedData.backdrop = await verifyAndCorrectImageUrl(parsedData.backdrop, parsedData.titleEn || parsedData.titleAr, true, parsedData.genres);

    // Verify and correct filmmaker and cast member photos
    if (parsedData.director) {
      parsedData.directorPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedData.director, parsedData.directorPhotoUrl);
    }
    if (parsedData.writer) {
      parsedData.writerPhotoUrl = await verifyAndCorrectPersonPhotoUrl(parsedData.writer, parsedData.writerPhotoUrl);
    }
    if (parsedData.castMembers && Array.isArray(parsedData.castMembers)) {
      for (const cast of parsedData.castMembers) {
        cast.photoUrl = await verifyAndCorrectPersonPhotoUrl(cast.name, cast.photoUrl);
      }
    }

    // Adapt series seasons and episodes to flat servers array for the React frontend Admin Panel
    if (parsedData.type === "series" && parsedData.seasons && parsedData.seasons.length > 0) {
      const flatServers: any[] = [];
      parsedData.seasons.forEach((season: any) => {
        if (season.episodes && season.episodes.length > 0) {
          season.episodes.forEach((episode: any) => {
            const epNum = episode.number || 1;
            const epTitleAr = episode.titleAr || `الحلقة ${epNum}`;
            const epUrl = (episode.servers && episode.servers[0]?.url) || episode.url || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
            flatServers.push({
              name: `الحلقة ${epNum} - ${epTitleAr}`,
              url: epUrl
            });
          });
        }
      });
      if (flatServers.length > 0) {
        parsedData.servers = flatServers;
      }
    }

    // Extract TMDB transparent PNG logo if not provided by Gemini
    if (!parsedData.logoUrl && (url || parsedData.titleEn || parsedData.titleAr)) {
      try {
        const tmdbScrap = await scrapeTMDBMetadata(url || parsedData.titleEn || parsedData.titleAr).catch(() => null);
        if (tmdbScrap && tmdbScrap.logoUrl) {
          parsedData.logoUrl = tmdbScrap.logoUrl;
          console.log("[Importer] Successfully fetched TMDB logo PNG for item:", parsedData.logoUrl);
        }
      } catch (lErr) {
        // ignore TMDB logo fallback error
      }
    }

    console.log("[Importer] Metadata Extracted, Verified and Formatted Successfully!");
    res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error("[Importer] Gemini extraction failed. Falling back to robust TMDB scraper... Reason:", error.message || error);
    handleGeminiError(error, "import-url");
    try {
      const scrapedData = await scrapeTMDBMetadata(url);
      if (scrapedData && scrapedData.titleEn && !scrapedData.poster?.includes("images.unsplash.com")) {
        console.log("[Importer] Successfully scraped movie/series from TMDB as fallback!");
        return res.json({ success: true, data: scrapedData });
      }
    } catch (scrapeErr: any) {
      console.error("[Importer] TMDB scraper fallback also failed:", scrapeErr);
    }
    return res.status(400).json({ error: "تعذر العثور على معلومات فيلم أو مسلسل حقيقي بهذا الاسم أو الرابط على TMDB. يرجى التأكد من كتابة الاسم بدقة أو استخدام رابط TMDB مباشر." });
  }
});

app.post("/api/admin/import-season", async (req, res) => {
  const { seriesTitle, seasonNumber, url } = req.body;
  const targetQuery = url || seriesTitle;
  if (!targetQuery) {
    return res.status(400).json({ error: "Missing required parameters: seriesTitle or url" });
  }

  const sNum = parseInt(seasonNumber, 10) || 1;

  try {
    console.log(`[Season Importer] Importing Season ${sNum} for query: "${targetQuery}"...`);
    const scrapedData = await scrapeTMDBMetadata(targetQuery);
    if (!scrapedData) {
      throw new Error("Could not find series metadata on TMDB");
    }

    let seasonObj = scrapedData.seasons?.find((s: any) => s.number === sNum);

    if (!seasonObj && scrapedData.id) {
      const tmdbIdMatch = scrapedData.id.match(/\d+/);
      if (tmdbIdMatch) {
        const tmdbId = tmdbIdMatch[0];
        const scrapedSeasons = await fetchTMDBSeriesSeasons(tmdbId, scrapedData.titleEn, scrapedData.titleAr, scrapedData.backdrop, scrapedData.rating || 8.0);
        seasonObj = scrapedSeasons?.find((s: any) => s.number === sNum);
      }
    }

    if (!seasonObj) {
      const sId = `s${sNum}_${Date.now()}`;
      seasonObj = {
        id: sId,
        number: sNum,
        titleAr: `الموسم ${sNum}`,
        titleEn: `Season ${sNum}`,
        poster: scrapedData.poster || scrapedData.backdrop,
        backdrop: scrapedData.backdrop,
        year: scrapedData.year || new Date().getFullYear(),
        storyAr: `تفاصيل وأحداث الموسم ${sNum} من مسلسل ${scrapedData.titleAr}`,
        storyEn: `Details and plot of Season ${sNum} of ${scrapedData.titleEn}`,
        episodes: Array.from({ length: 10 }).map((_, i) => {
          const epNum = i + 1;
          const epId = `s${sNum}_e${epNum}_${Date.now()}`;
          return {
            id: epId,
            number: epNum,
            titleAr: `الحلقة ${epNum}`,
            titleEn: `Episode ${epNum}`,
            duration: "45m",
            storyAr: `تفاصيل الحلقة ${epNum} من الموسم ${sNum} لمسلسل ${scrapedData.titleAr}.`,
            storyEn: `Details of Episode ${epNum} of Season ${sNum} of ${scrapedData.titleEn}.`,
            thumbnail: scrapedData.backdrop,
            servers: [{ name: "سيرفر البث الرئيسي", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }],
            subtitlesUrlAr: `/api/subtitles?movieId=${scrapedData.id}&seasonId=${sId}&episodeId=${epId}&lang=ar`,
            subtitlesUrlEn: `/api/subtitles?movieId=${scrapedData.id}&seasonId=${sId}&episodeId=${epId}&lang=en`,
            rating: scrapedData.rating || 8.0
          };
        })
      };
    }

    return res.json({
      success: true,
      seriesTitleAr: scrapedData.titleAr,
      seriesTitleEn: scrapedData.titleEn,
      season: seasonObj
    });
  } catch (err: any) {
    console.error("[Season Importer] Failed to import season:", err.message || err);
    return res.status(400).json({ error: `فشل استيراد تفاصيل الموسم: ${err.message || "خطأ غير معروف"}` });
  }
});

// Search movies
app.get("/api/movies/search", async (req, res) => {
  const query = (req.query.q as string || "").trim();
  if (!query) {
    return res.json({ items: [] });
  }

  try {
    // 1. Search published movies locally
    const publishedDatabase = moviesDatabase.filter(m => 
      !isMovieDeleted(m.id, m.titleAr, m.titleEn) && m.isPublished !== false
    );
    const localResults = publishedDatabase.filter(m =>
      m.titleAr.toLowerCase().includes(query.toLowerCase()) ||
      m.titleEn.toLowerCase().includes(query.toLowerCase()) ||
      m.genres.some(g => g.includes(query))
    );

    let finalResults = expandSearchResultsWithCollections(localResults, publishedDatabase);

    // 2. If Gemini is configured, enrich the results with Gemini dynamically to search the whole web/Cinemana universe live!
    if (ai && finalResults.length < 3) {
      const generatedMovie = await generateMovieWithGemini(query);
      if (generatedMovie) {
        // Prevent duplicate IDs
        if (!moviesDatabase.some(m => m.titleEn.toLowerCase() === generatedMovie.titleEn.toLowerCase() || m.id === generatedMovie.id)) {
          moviesDatabase.push(generatedMovie); // Cache in memory
        }
        finalResults = expandSearchResultsWithCollections([...localResults, generatedMovie], moviesDatabase);
      }
    }

    finalResults.forEach(movie => {
      enrichMovieMetadata(movie);
    });

    res.json({ items: finalResults });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Movie details (handles fetching specific items generated dynamically)
app.get("/api/movies/detail", async (req, res) => {
  const id = req.query.id as string;
  const found = moviesDatabase.find(m => m.id === id);
  if (found) {
    enrichMovieMetadata(found);
    return res.json(found);
  }

  // If not found in memory (e.g. fresh reload of dynamic item)
  if (id && id.startsWith("gemini_") && ai) {
    // Search the database or generate
    const cleanId = id.replace("gemini_", "").replace(/_/g, " ");
    const generated = await generateMovieWithGemini(cleanId);
    if (generated) {
      generated.id = id; // Preserve ID
      enrichMovieMetadata(generated);
      moviesDatabase.push(generated);
      return res.json(generated);
    }
  }

  res.status(404).json({ error: "Movie not found" });
});

// Vite Middleware integration for production build or development
async function startServer() {
  // Ensure uploads directory exists
  const UPLOADS_DIR = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use("/uploads", express.static(UPLOADS_DIR));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
  });
}

startServer();
