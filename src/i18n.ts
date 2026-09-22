export type Lang = "ar" | "en";

// Kept in-memory only (no AsyncStorage dependency for a same-day scope) - resets to Arabic
// on relaunch. Layout stays LTR-flow in both languages (no I18nManager.forceRTL mirroring,
// which needs a full app reload to take effect); only text content and copy switch.
const strings = {
  watchNow: { ar: "شاهد الآن", en: "Watch Now" },
  details: { ar: "تفاصيل", en: "Details" },
  addToFavorites: { ar: "أضف إلى المشاهدة لاحقاً", en: "Add to Watch Later" },
  removeFromFavorites: { ar: "إزالة من المشاهدة لاحقاً", en: "Remove from Watch Later" },
  cast: { ar: "طاقم العمل", en: "Cast" },

  home: { ar: "الرئيسية", en: "Home" },
  movies: { ar: "الأفلام", en: "Movies" },
  series: { ar: "المسلسلات", en: "Series" },
  library: { ar: "مكتبتي", en: "My List" },
  favorites: { ar: "المشاهدة لاحقاً", en: "Watch Later" },
  history: { ar: "سجل المشاهدة", en: "Watch History" },
  search: { ar: "البحث", en: "Search" },
  settings: { ar: "الإعدادات", en: "Settings" },

  searchPlaceholder: { ar: "ابحث عن فيلم أو مسلسل...", en: "Search for a movie or series..." },
  searchEmpty: { ar: "لا توجد نتائج", en: "No results found" },
  searchHint: { ar: "اكتب اسم فيلم أو مسلسل للبحث", en: "Type a title to search" },
  searching: { ar: "جارٍ البحث...", en: "Searching..." },

  settingsLanguage: { ar: "اللغة", en: "Language" },
  settingsLanguageDesc: { ar: "اختر لغة واجهة التطبيق.", en: "Choose the app's interface language." },
  settingsArabic: { ar: "العربية", en: "Arabic" },
  settingsEnglish: { ar: "الإنجليزية", en: "English" },
  settingsUiSize: { ar: "حجم الواجهات", en: "UI Size" },
  settingsUiSizeDesc: { ar: "اضبط حجم عناصر الواجهة لتناسب شاشتك.", en: "Adjust the interface size to fit your screen." },
  settingsVersion: { ar: "الإصدار", en: "Version" },
  settingsTabSystem: { ar: "إعدادات النظام", en: "System Settings" },
  settingsTabSubtitles: { ar: "إعدادات الترجمة", en: "Subtitle Settings" },
  subtitleGroupDesc: { ar: "حسّن وضوح الترجمة وخصّصها حسب رغبتك.", en: "Improve readability and customization for subtitles." },
  subtitleLanguage: { ar: "لغة الترجمة", en: "Subtitle language" },
  subtitleLanguageDesc: { ar: "اختر لغة الترجمة المفضلة عند توفر أكثر من لغة.", en: "Choose the preferred subtitle language when a title has more than one." },
  subtitleFont: { ar: "الخط", en: "Font" },
  subtitleFontDesc: { ar: "اختر الخط المفضل للترجمة.", en: "Choose your preferred subtitle font." },
  subtitleSize: { ar: "الحجم", en: "Size" },
  subtitleSizeDesc: { ar: "اضبط حجم نص الترجمة ليناسب شاشتك.", en: "Adjust subtitle size for your display." },
  subtitleColor: { ar: "اللون", en: "Color" },
  subtitleColorDesc: { ar: "اختر لون ترجمة واضح التباين.", en: "Pick a high-contrast subtitle color." },
  subtitleBackgroundTitle: { ar: "الخلفية", en: "Background" },
  subtitleBackground: { ar: "خلفية داكنة خلف النص", en: "Dark background behind text" },
  subtitlePreview: { ar: "معاينة الترجمة", en: "Subtitle Preview" },
  sizeSmall: { ar: "صغير", en: "Small" },
  sizeMedium: { ar: "متوسط", en: "Medium" },
  sizeLarge: { ar: "كبير", en: "Large" },

  emptyWatchLater: { ar: "لا توجد أعمال في قائمة المشاهدة لاحقاً بعد", en: "Nothing in Watch Later yet" },
  emptyHistory: { ar: "لم تشاهد أي عمل بعد", en: "No watch history yet" },

  comingSoon: { ar: "قريباً", en: "Coming soon" },
} as const;

export type StringKey = keyof typeof strings;

export function t(key: StringKey, lang: Lang): string {
  return strings[key][lang];
}

// Picks the language-appropriate field off a catalog object (movie/episode/season), falling
// back to whichever of the pair is non-empty - the catalog is inconsistently populated for
// English fields on older entries.
export function pickText(ar?: string, en?: string, lang: Lang = "ar"): string {
  if (lang === "en") return en || ar || "";
  return ar || en || "";
}

// movie.language on the catalog is a short code/label (e.g. "ar", "en", "hi") - the filter
// dropdown should read as a real language name, not the raw code, in whichever UI language
// is active.
// ISO 639-1 codes, as wide as TMDB's own original_language values realistically get across its
// full movie+TV catalog - a code missing here used to fall all the way back to the raw two-
// letter abbreviation (e.g. "th", "he", "id") instead of a real name in either language.
const LANGUAGE_NAMES: Record<string, { ar: string; en: string }> = {
  ar: { ar: "العربية", en: "Arabic" },
  en: { ar: "الإنجليزية", en: "English" },
  es: { ar: "الإسبانية", en: "Spanish" },
  hi: { ar: "الهندية", en: "Hindi" },
  fr: { ar: "الفرنسية", en: "French" },
  de: { ar: "الألمانية", en: "German" },
  it: { ar: "الإيطالية", en: "Italian" },
  tr: { ar: "التركية", en: "Turkish" },
  ko: { ar: "الكورية", en: "Korean" },
  ja: { ar: "اليابانية", en: "Japanese" },
  zh: { ar: "الصينية", en: "Chinese" },
  ru: { ar: "الروسية", en: "Russian" },
  pt: { ar: "البرتغالية", en: "Portuguese" },
  fa: { ar: "الفارسية", en: "Persian" },
  ur: { ar: "الأردية", en: "Urdu" },
  nl: { ar: "الهولندية", en: "Dutch" },
  sv: { ar: "السويدية", en: "Swedish" },
  no: { ar: "النرويجية", en: "Norwegian" },
  da: { ar: "الدنماركية", en: "Danish" },
  fi: { ar: "الفنلندية", en: "Finnish" },
  pl: { ar: "البولندية", en: "Polish" },
  cs: { ar: "التشيكية", en: "Czech" },
  sk: { ar: "السلوفاكية", en: "Slovak" },
  hu: { ar: "المجرية", en: "Hungarian" },
  ro: { ar: "الرومانية", en: "Romanian" },
  bg: { ar: "البلغارية", en: "Bulgarian" },
  el: { ar: "اليونانية", en: "Greek" },
  uk: { ar: "الأوكرانية", en: "Ukrainian" },
  sr: { ar: "الصربية", en: "Serbian" },
  hr: { ar: "الكرواتية", en: "Croatian" },
  sl: { ar: "السلوفينية", en: "Slovenian" },
  he: { ar: "العبرية", en: "Hebrew" },
  th: { ar: "التايلاندية", en: "Thai" },
  vi: { ar: "الفيتنامية", en: "Vietnamese" },
  id: { ar: "الإندونيسية", en: "Indonesian" },
  ms: { ar: "الماليزية", en: "Malay" },
  tl: { ar: "الفلبينية", en: "Filipino" },
  bn: { ar: "البنغالية", en: "Bengali" },
  ta: { ar: "التاميلية", en: "Tamil" },
  te: { ar: "التيلوغوية", en: "Telugu" },
  ml: { ar: "المالايالامية", en: "Malayalam" },
  mr: { ar: "الماراثية", en: "Marathi" },
  pa: { ar: "البنجابية", en: "Punjabi" },
  ku: { ar: "الكردية", en: "Kurdish" },
  he_IL: { ar: "العبرية", en: "Hebrew" },
  am: { ar: "الأمهرية", en: "Amharic" },
  sw: { ar: "السواحيلية", en: "Swahili" },
  af: { ar: "الأفريكانية", en: "Afrikaans" },
  is: { ar: "الآيسلندية", en: "Icelandic" },
  et: { ar: "الإستونية", en: "Estonian" },
  lv: { ar: "اللاتفية", en: "Latvian" },
  lt: { ar: "الليتوانية", en: "Lithuanian" },
  ka: { ar: "الجورجية", en: "Georgian" },
  az: { ar: "الأذربيجانية", en: "Azerbaijani" },
  hy: { ar: "الأرمنية", en: "Armenian" },
  mn: { ar: "المنغولية", en: "Mongolian" },
  km: { ar: "الخميرية", en: "Khmer" },
  lo: { ar: "اللاوية", en: "Lao" },
  my: { ar: "البورمية", en: "Burmese" },
  ne: { ar: "النيبالية", en: "Nepali" },
  si: { ar: "السنهالية", en: "Sinhala" },
  cn: { ar: "الصينية", en: "Chinese" },
  yue: { ar: "الكانتونية", en: "Cantonese" },
  eo: { ar: "الإسبرانتو", en: "Esperanto" },
  la: { ar: "اللاتينية", en: "Latin" },
  cy: { ar: "الويلزية", en: "Welsh" },
  ga: { ar: "الأيرلندية", en: "Irish" },
  eu: { ar: "الباسكية", en: "Basque" },
  ca: { ar: "الكاتالانية", en: "Catalan" },
  gl: { ar: "الغاليسية", en: "Galician" },
  // Codes TMDB really returns that showed up as raw abbreviations in the language filter.
  xx: { ar: "بدون حوار", en: "No spoken language" },
  kn: { ar: "الكانادية", en: "Kannada" },
  sh: { ar: "الصربية الكرواتية", en: "Serbo-Croatian" },
  sq: { ar: "الألبانية", en: "Albanian" },
  bs: { ar: "البوسنية", en: "Bosnian" },
  mk: { ar: "المقدونية", en: "Macedonian" },
  be: { ar: "البيلاروسية", en: "Belarusian" },
  kk: { ar: "الكازاخية", en: "Kazakh" },
  uz: { ar: "الأوزبكية", en: "Uzbek" },
  ps: { ar: "البشتوية", en: "Pashto" },
  gu: { ar: "الغوجاراتية", en: "Gujarati" },
  sd: { ar: "السندية", en: "Sindhi" },
  so: { ar: "الصومالية", en: "Somali" },
  zu: { ar: "الزولو", en: "Zulu" },
  yo: { ar: "اليوروبا", en: "Yoruba" },
  ha: { ar: "الهوسا", en: "Hausa" },
  ig: { ar: "الإيبو", en: "Igbo" },
  mt: { ar: "المالطية", en: "Maltese" },
  lb: { ar: "اللوكسمبورغية", en: "Luxembourgish" },
  jv: { ar: "الجاوية", en: "Javanese" },
  ky: { ar: "القيرغيزية", en: "Kyrgyz" },
  tg: { ar: "الطاجيكية", en: "Tajik" },
  tk: { ar: "التركمانية", en: "Turkmen" },
  sa: { ar: "السنسكريتية", en: "Sanskrit" },
  ti: { ar: "التغرينية", en: "Tigrinya" },
  ug: { ar: "الأويغورية", en: "Uyghur" },
  bo: { ar: "التبتية", en: "Tibetan" },
};

export function languageName(code: string, lang: Lang): string {
  const entry = LANGUAGE_NAMES[code.toLowerCase().trim()];
  // A raw, unmapped ISO code is still better shown as itself than not at all, but this should
  // now only ever be reached for a genuinely obscure code TMDB rarely returns.
  return entry ? entry[lang] : code;
}

// The catalog stores genre/country names exactly as TMDB returns them - English (see
// bootstrap-importer.mjs, which always fetches with language: 'en-US'). This used to be keyed
// the other way around (Arabic strings as the map keys) - presumably left over from an older
// backend that stored these fields in Arabic - so against real data every lookup missed and
// silently fell back to the raw (English) string no matter which UI language was active; genres
// and countries never actually translated. Keyed by the real English values now, covering both
// TMDB's movie and TV genre lists.
const GENRE_NAMES: Record<string, string> = {
  Action: "أكشن",
  Adventure: "مغامرة",
  Animation: "رسوم متحركة",
  Comedy: "كوميديا",
  Crime: "جريمة",
  Documentary: "وثائقي",
  Drama: "دراما",
  Family: "عائلي",
  Fantasy: "فانتازيا",
  History: "تاريخي",
  Horror: "رعب",
  Music: "موسيقى",
  Mystery: "غموض",
  Romance: "رومانسي",
  "Science Fiction": "خيال علمي",
  "TV Movie": "فيلم تلفزيوني",
  Thriller: "تشويق",
  War: "حرب",
  Western: "وسترن",
  // TV-only genres (TMDB names these differently from the movie list above).
  "Action & Adventure": "أكشن ومغامرة",
  Kids: "أطفال",
  News: "أخبار",
  Reality: "واقع",
  "Sci-Fi & Fantasy": "خيال علمي وفانتازيا",
  Soap: "مسلسل درامي",
  Talk: "حواري",
  "War & Politics": "حرب وسياسة",
};

// TMDB's production_countries[].name values (ISO 3166 English short names) - a title can list
// more than one, comma-joined into a single string server-side (see mapCountry in
// creditsMapper.ts), so this splits, translates each, and rejoins rather than looking up the
// whole string as one unit.
const COUNTRY_NAMES: Record<string, string> = {
  "United States of America": "الولايات المتحدة",
  "United Kingdom": "المملكة المتحدة",
  France: "فرنسا",
  Germany: "ألمانيا",
  Italy: "إيطاليا",
  Spain: "إسبانيا",
  Brazil: "البرازيل",
  India: "الهند",
  Japan: "اليابان",
  "South Korea": "كوريا الجنوبية",
  China: "الصين",
  "Hong Kong": "هونغ كونغ",
  Russia: "روسيا",
  Canada: "كندا",
  Australia: "أستراليا",
  Egypt: "مصر",
  Lebanon: "لبنان",
  "Saudi Arabia": "السعودية",
  "United Arab Emirates": "الإمارات",
  "Syrian Arab Republic": "سوريا",
  Iraq: "العراق",
  Jordan: "الأردن",
  Mexico: "المكسيك",
  Turkey: "تركيا",
  "Iran (Islamic Republic of)": "إيران",
  "New Zealand": "نيوزيلندا",
};

export function genreName(raw: string, lang: Lang): string {
  if (lang === "en") return raw;
  return GENRE_NAMES[raw.trim()] ?? raw;
}

export function countryName(raw: string, lang: Lang): string {
  if (lang === "en") return raw;
  // mapCountry (creditsMapper.ts) joins multiple production countries into one "A, B" string -
  // translate each independently rather than looking up the whole thing as one unformed key,
  // which would only ever match a title with exactly one production country.
  return raw
    .split(',')
    .map((part) => {
      const trimmed = part.trim();
      return COUNTRY_NAMES[trimmed] ?? trimmed;
    })
    .join("، ");
}

// Maps a raw age-rating code (whatever convention the catalog happens to use - MPAA-style,
// TV parental guidelines, or a plain "18+") to a short descriptive phrase for the in-player
// banner. Falls back to just showing the raw code by itself if it isn't one we recognize,
// rather than guessing at wording for a rating system we can't identify.
const AGE_RATING_DESCRIPTIONS: Record<string, { ar: string; en: string }> = {
  "G": { ar: "مناسب لجميع الأعمار", en: "Suitable for all ages" },
  "PG": { ar: "يُنصح بإشراف الوالدين", en: "Parental guidance suggested" },
  "PG-13": { ar: "غير مناسب لمن هم دون 13 عاماً", en: "Not suitable for under 13" },
  "R": { ar: "محتوى مقيد - يتطلب مرافقة ولي أمر", en: "Restricted - guardian accompaniment required" },
  "NC-17": { ar: "للبالغين فقط", en: "Adults only" },
  "18+": { ar: "محتوى مقيد للبالغين", en: "Restricted to adults" },
  "TV-Y": { ar: "مناسب للأطفال", en: "Suitable for children" },
  "TV-G": { ar: "مناسب لجميع الأعمار", en: "Suitable for all ages" },
  "TV-PG": { ar: "يُنصح بإشراف الوالدين", en: "Parental guidance suggested" },
  "TV-14": { ar: "غير مناسب لمن هم دون 14 عاماً", en: "Not suitable for under 14" },
  "TV-MA": { ar: "محتوى مقيد للبالغين", en: "Restricted to mature audiences" },
  "NR": { ar: "غير مصنّف", en: "Not Rated" },
};

export function ageRatingDescription(raw: string, lang: Lang): string {
  const entry = AGE_RATING_DESCRIPTIONS[raw.trim().toUpperCase()];
  return entry ? entry[lang] : raw;
}

// A color per severity tier (not per exact code - "TV-14" and "PG-13" mean roughly the same
// thing to a viewer) for the in-player age-rating banner's accent stripe.
const AGE_RATING_COLORS: Record<string, string> = {
  "G": "#22c55e",
  "TV-Y": "#22c55e",
  "TV-G": "#22c55e",
  "PG": "#38bdf8",
  "TV-PG": "#38bdf8",
  "PG-13": "#f59e0b",
  "TV-14": "#f59e0b",
  "R": "#ef4444",
  "NC-17": "#ef4444",
  "18+": "#ef4444",
  "TV-MA": "#ef4444",
  "NR": "#a1a1aa",
};

export function ageRatingColor(raw: string): string {
  return AGE_RATING_COLORS[raw.trim().toUpperCase()] ?? "#a1a1aa";
}

// A static month-name table instead of Intl.DateTimeFormat - Hermes on Android doesn't reliably
// ship full ICU data, so a locale-aware Intl call risks throwing or silently mis-formatting on
// a real device even though it works fine in a dev environment. Shared here (was duplicated
// locally in PersonScreen.tsx) now that a second screen needs the same day/month/year rendering
// (an episode/season's upcoming air date).
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function formatDate(iso: string, lang: Lang): string | null {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const months = lang === "ar" ? MONTHS_AR : MONTHS_EN;
  const day = d.getUTCDate();
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return lang === "ar" ? `${day} ${month} ${year}` : `${month} ${day}, ${year}`;
}

// An episode/season only ever gets imported once aired or airing within a week (see
// AIR_DATE_IMPORT_HORIZON_DAYS in bootstrap-importer.mjs) - a future airDate here specifically
// means "announced and imported, but not aired yet", worth its own "coming <date>" label instead
// of reading as a normal (just stream-less) entry. "قادم" (season, masculine) vs "قادمة"
// (episode, feminine) - grammatical gender in Arabic has to agree with which noun this is
// describing, unlike the English copy which doesn't distinguish at all.
export function upcomingLabel(airDate: string | null | undefined, lang: Lang, kind: "episode" | "season" = "episode"): string | null {
  if (!airDate) return null;
  const date = new Date(airDate);
  if (isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  const formatted = formatDate(airDate, lang);
  if (!formatted) return null;
  if (lang !== "ar") return `Coming ${formatted}`;
  return kind === "season" ? `قادم في ${formatted}` : `قادمة - ${formatted}`;
}
