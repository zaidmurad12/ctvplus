import React, { useState, useEffect } from "react";
import { 
  Plus, Edit2, Trash2, Save, Film, Tv, Image, Video, Sliders, 
  Star, Upload, Check, X, Search, Sparkles, AlertCircle, RefreshCw, 
  Play, Eye, HelpCircle, ArrowLeft, ArrowRight, User, Lock, ShieldAlert,
  Download, Globe, Loader2, CheckCircle2, Clock, EyeOff, Radio, Volume2, Megaphone, ExternalLink, Layers
} from "lucide-react";
import { Movie, Season, Episode, CastMember, AdServer, Ad, AdsSettings } from "../types";
import { formatMovieDuration } from "./MovieCard";
import { getApiUrl } from "../utils/apiUtils";
import { safeStorage } from "../utils/safeStorage";

interface AdminPanelProps {
  lang: "ar" | "en";
  onClose?: () => void;
  onRefreshData?: () => void;
  onLogout?: () => void;
  adminRemoteAction?: {action: "up" | "down" | "left" | "right" | "ok" | "back"; time: number} | null;
  setAdminRemoteAction?: (action: {action: "up" | "down" | "left" | "right" | "ok" | "back"; time: number} | null) => void;
}

export default function AdminPanel({ lang, onClose, onRefreshData, onLogout, adminRemoteAction, setAdminRemoteAction }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<"list" | "form" | "banner" | "admins" | "ads">("list");

  // TV Remote Navigation States in Admin Panel
  const [adminFocusArea, setAdminFocusArea] = useState<"header" | "tabs" | "list" | "form" | "banner" | "admins" | "ads">("tabs");
  const [headerFocusIndex, setHeaderFocusIndex] = useState<number>(0); // 0: logout, 1: back to app
  const [adminFocusedTabIndex, setAdminFocusedTabIndex] = useState<number>(0); // 0: list, 1: form, 2: banner, 3: admins, 4: ads
  
  // Tab 0 (List) navigation
  const [focusedListElement, setFocusedListElement] = useState<number>(0); // -3: import input, -2: import btn, -1: sync btn, 0: search, 1: movie grid
  const [focusedMovieIndex, setFocusedMovieIndex] = useState<number>(0);
  const [focusedMovieBtnIndex, setFocusedMovieBtnIndex] = useState<number>(0); // 0: edit, 1: delete, 2: banner, 3: trending
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // Tab 1 (Form) navigation
  const [focusedFormFieldIndex, setFocusedFormFieldIndex] = useState<number>(0);
  const [focusedGenreIndex, setFocusedGenreIndex] = useState<number>(0);
  const [focusedServerRowIndex, setFocusedServerRowIndex] = useState<number>(0);
  const [focusedServerColIndex, setFocusedServerColIndex] = useState<number>(0); // 0: name, 1: url, 2: delete

  // Tab 2 (Banner & Promos) navigation
  const [bannerFocusIndex, setBannerFocusIndex] = useState<number>(0); // 0: add promo btn, 1+: promo item index
  const [bannerPromoBtnIndex, setBannerPromoBtnIndex] = useState<number>(0); // 0: edit, 1: delete
  // Promo Form navigation
  const [focusedPromoFormIndex, setFocusedPromoFormIndex] = useState<number>(0);

  // Tab 3 (Admins) navigation
  const [focusedAdminFormIndex, setFocusedAdminFormIndex] = useState<number>(0); // 0: username, 1: password, 2: submit, 3+: admin item delete

  // Tab 4 (Ads) navigation
  const [focusedAdIndex, setFocusedAdIndex] = useState<number>(0);

  // Virtual Keyboard Modal State
  const [showKeyboardModal, setShowKeyboardModal] = useState<boolean>(false);
  const [keyboardModalTarget, setKeyboardModalTarget] = useState<{
    label: string;
    value: string;
    onChange: (val: string) => void;
  } | null>(null);
  const [keyboardValue, setKeyboardValue] = useState<string>("");
  const [keyboardLang, setKeyboardLang] = useState<"ar" | "en">("ar");
  const [keyboardFocusedKey, setKeyboardFocusedKey] = useState<{row: number, col: number}>({row: 0, col: 0});


  // State for Custom Confirmation Modal
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    show: boolean;
    type: "movie" | "promo";
    id: string;
    name: string;
  }>({ show: false, type: "movie", id: "", name: "" });
  const [confirmModalFocus, setConfirmModalFocus] = useState<"cancel" | "confirm">("cancel");

  const arabicKeys = [
    ["أ", "ب", "ت", "ث", "ج", "ح", "خ", "د", "ذ"],
    ["ر", "ز", "س", "ش", "ص", "ض", "ط", "ظ", "ع"],
    ["غ", "ف", "ق", "ك", "ل", "م", "ن", "هـ", "و"],
    ["ي", "ة", "ى", "ء", "أو", "إ", "أ", "آ", "ؤ"],
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
  ];

  const englishKeys = [
    ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    ["J", "K", "L", "M", "N", "O", "P", "Q", "R"],
    ["S", "T", "U", "V", "W", "X", "Y", "Z", "_"],
    ["/", ":", ".", "-", "@", "?", "!", "&", "="],
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
  ];

  // Keep active tab state aligned with TV remote tab state
  useEffect(() => {
    const tabs: ("list" | "form" | "banner" | "admins" | "ads")[] = ["list", "form", "banner", "admins", "ads"];
    const idx = tabs.indexOf(activeTab);
    if (idx !== -1) {
      setAdminFocusedTabIndex(idx);
    }
  }, [activeTab]);

  // Ads Management State
  const [adsSettings, setAdsSettings] = useState<AdsSettings>({
    enabled: false,
    globalSkipAfterSeconds: 5,
    allowSkip: true,
    ads: []
  });
  const [showAdModal, setShowAdModal] = useState<boolean>(false);
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [adFormData, setAdFormData] = useState<{
    titleAr: string;
    titleEn: string;
    sponsorNameAr: string;
    sponsorNameEn: string;
    sponsorLogo: string;
    sponsorUrl: string;
    skipAfterSeconds: number;
    durationSeconds: number;
    isActive: boolean;
    targetType: "all" | "movie" | "series";
    servers: AdServer[];
  }>({
    titleAr: "",
    titleEn: "",
    sponsorNameAr: "",
    sponsorNameEn: "",
    sponsorLogo: "",
    sponsorUrl: "",
    skipAfterSeconds: 5,
    durationSeconds: 15,
    isActive: true,
    targetType: "all",
    servers: [
      { id: "srv_1", name: "سيرفر الإعلان الرئيسي (MP4)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", type: "video" }
    ]
  });
  const [uploadingAdMedia, setUploadingAdMedia] = useState<boolean>(false);
  const [adStatusMsg, setAdStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchAdsSettings = async () => {
    try {
      const res = await fetch(getApiUrl("/api/admin/ads"));
      if (res.ok) {
        const data = await res.json();
        if (data.adsSettings) {
          setAdsSettings(data.adsSettings);
        }
      }
    } catch (err) {
      console.error("Failed to load ads settings:", err);
    }
  };

  const saveAdsSettings = async (updatedSettings: AdsSettings) => {
    try {
      setIsLoading(true);
      const res = await fetch(getApiUrl("/api/admin/ads"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.adsSettings) {
          setAdsSettings(data.adsSettings);
        }
        setAdStatusMsg({ type: "success", text: lang === "ar" ? "تم حفظ إعدادات الإعلانات بنجاح!" : "Ads settings saved successfully!" });
        setTimeout(() => setAdStatusMsg(null), 3500);
      }
    } catch (err: any) {
      setAdStatusMsg({ type: "error", text: err.message || "Failed to save ads settings" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleGlobalAds = () => {
    const updated = { ...adsSettings, enabled: !adsSettings.enabled };
    setAdsSettings(updated);
    saveAdsSettings(updated);
  };

  const handleSaveAdForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adFormData.titleAr && !adFormData.titleEn) {
      alert(lang === "ar" ? "الرجاء كتابة عنوان الإعلان" : "Please enter ad title");
      return;
    }

    const cleanServers = adFormData.servers.filter(s => s.name && s.url);
    if (cleanServers.length === 0) {
      alert(lang === "ar" ? "يجب إضافة سيرفر تشغيل واحد على الأقل للإعلان" : "At least one ad streaming server is required");
      return;
    }

    const currentAds = [...(adsSettings.ads || [])];
    if (editingAdId) {
      const index = currentAds.findIndex(a => a.id === editingAdId);
      if (index !== -1) {
        currentAds[index] = {
          ...currentAds[index],
          titleAr: adFormData.titleAr || adFormData.titleEn,
          titleEn: adFormData.titleEn || adFormData.titleAr,
          sponsorNameAr: adFormData.sponsorNameAr,
          sponsorNameEn: adFormData.sponsorNameEn,
          sponsorLogo: adFormData.sponsorLogo,
          sponsorUrl: adFormData.sponsorUrl,
          skipAfterSeconds: Number(adFormData.skipAfterSeconds) || 5,
          durationSeconds: Number(adFormData.durationSeconds) || 15,
          isActive: adFormData.isActive,
          targetType: adFormData.targetType,
          servers: cleanServers
        };
      }
    } else {
      const newAd: Ad = {
        id: `ad_${Date.now()}`,
        titleAr: adFormData.titleAr || adFormData.titleEn,
        titleEn: adFormData.titleEn || adFormData.titleAr,
        sponsorNameAr: adFormData.sponsorNameAr,
        sponsorNameEn: adFormData.sponsorNameEn,
        sponsorLogo: adFormData.sponsorLogo,
        sponsorUrl: adFormData.sponsorUrl,
        skipAfterSeconds: Number(adFormData.skipAfterSeconds) || 5,
        durationSeconds: Number(adFormData.durationSeconds) || 15,
        isActive: adFormData.isActive,
        targetType: adFormData.targetType,
        createdAt: new Date().toISOString(),
        servers: cleanServers
      };
      currentAds.push(newAd);
    }

    const updated = { ...adsSettings, ads: currentAds };
    setAdsSettings(updated);
    saveAdsSettings(updated);
    setShowAdModal(false);
    resetAdForm();
  };

  const handleEditAdClick = (ad: Ad) => {
    setEditingAdId(ad.id);
    setAdFormData({
      titleAr: ad.titleAr || "",
      titleEn: ad.titleEn || "",
      sponsorNameAr: ad.sponsorNameAr || "",
      sponsorNameEn: ad.sponsorNameEn || "",
      sponsorLogo: ad.sponsorLogo || "",
      sponsorUrl: ad.sponsorUrl || "",
      skipAfterSeconds: ad.skipAfterSeconds || 5,
      durationSeconds: ad.durationSeconds || 15,
      isActive: ad.isActive !== false,
      targetType: ad.targetType || "all",
      servers: ad.servers && ad.servers.length > 0 ? ad.servers : [
        { id: "srv_1", name: "سيرفر الإعلان الرئيسي (MP4)", url: "", type: "video" }
      ]
    });
    setShowAdModal(true);
  };

  const handleDeleteAdClick = (adId: string) => {
    if (window.confirm(lang === "ar" ? "هل أنت تأكد من حذف هذا الإعلان وسيرفرات البث الخاصة به؟" : "Are you sure you want to delete this ad and its servers?")) {
      const filtered = (adsSettings.ads || []).filter(a => a.id !== adId);
      const updated = { ...adsSettings, ads: filtered };
      setAdsSettings(updated);
      saveAdsSettings(updated);
    }
  };

  const handleToggleAdStatus = (adId: string) => {
    const updatedAds = (adsSettings.ads || []).map(a => {
      if (a.id === adId) {
        return { ...a, isActive: !a.isActive };
      }
      return a;
    });
    const updated = { ...adsSettings, ads: updatedAds };
    setAdsSettings(updated);
    saveAdsSettings(updated);
  };

  const resetAdForm = () => {
    setEditingAdId(null);
    setAdFormData({
      titleAr: "",
      titleEn: "",
      sponsorNameAr: "",
      sponsorNameEn: "",
      sponsorLogo: "",
      sponsorUrl: "",
      skipAfterSeconds: 5,
      durationSeconds: 15,
      isActive: true,
      targetType: "all",
      servers: [
        { id: "srv_1", name: "سيرفر الإعلان الرئيسي (MP4)", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", type: "video" }
      ]
    });
  };

  const handleAdFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetIndex?: number) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAdMedia(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result as string;
        const res = await fetch(getApiUrl("/api/admin/ads/upload-media"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileContent: base64 })
        });
        if (res.ok) {
          const data = await res.json();
          if (targetIndex !== undefined) {
            // Server video upload
            setAdFormData(prev => {
              const newServers = [...prev.servers];
              if (newServers[targetIndex]) {
                newServers[targetIndex].url = data.url;
              }
              return { ...prev, servers: newServers };
            });
          } else {
            // Sponsor logo upload
            setAdFormData(prev => ({ ...prev, sponsorLogo: data.url }));
          }
        }
        setUploadingAdMedia(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("Upload error:", err);
      setUploadingAdMedia(false);
    }
  };
  
  // Administrators management state
  const [adminUsers, setAdminUsers] = useState<{username: string; password: string}[]>(() => {
    const saved = safeStorage.getItem("cinemana_admin_users");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        // ignore
      }
    }
    const initial = [{ username: "zaid", password: "1995" }];
    safeStorage.setItem("cinemana_admin_users", JSON.stringify(initial));
    return initial;
  });
  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  // Data States
  const [movies, setMovies] = useState<Movie[]>([]);
  const [customHeroId, setCustomHeroId] = useState<string | null>(null);
  const [customTrendingIds, setCustomTrendingIds] = useState<string[]>([]);
  const [customPromos, setCustomPromos] = useState<any[]>([]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState("");
  const [publishFilter, setPublishFilter] = useState<"pending" | "published" | "all">("pending");
  const [isBatchImporting, setIsBatchImporting] = useState(false);
  
  // Form State
  const [editingMovieId, setEditingMovieId] = useState<string | null>(null);
  const [activeFormSeasonIndex, setActiveFormSeasonIndex] = useState<number>(0);
  const [expandedEpisodeIndex, setExpandedEpisodeIndex] = useState<number | null>(0);
  const [formData, setFormData] = useState({
    titleAr: "",
    titleEn: "",
    type: "movie" as "movie" | "series",
    rating: 8.0,
    year: new Date().getFullYear(),
    duration: "",
    ageRating: "",
    genres: [] as string[],
    poster: "",
    backdrop: "",
    storyAr: "",
    storyEn: "",
    actors: [] as string[],
    director: "",
    writer: "",
    directorPhotoUrl: "",
    writerPhotoUrl: "",
    castMembers: [] as CastMember[],
    quality: "Full HD",
    servers: [{ name: "سيرفر رئيسي 1080p", url: "" }],
    subtitlesUrlAr: "",
    subtitlesUrlEn: "",
    originalSubtitlesUrlAr: "",
    originalSubtitlesUrlEn: "",
    trailerUrl: "",
    seasons: [] as Season[],
    language: "en",
    country: "",
    collectionId: "",
    collectionNameAr: "",
    collectionNameEn: "",
    partNumber: "",
    logoUrl: "",
    isPublished: true
  });

  // Importer State
  const [importUrl, setImportUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploadingAr, setIsUploadingAr] = useState(false);
  const [isUploadingEn, setIsUploadingEn] = useState(false);
  const [isImportingSubsource, setIsImportingSubsource] = useState(false);
  const [isAutoFetchingSubtitles, setIsAutoFetchingSubtitles] = useState(false);
  const [isImportingSeason, setIsImportingSeason] = useState(false);

  // New Promo Form State
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoFormData, setPromoFormData] = useState({
    id: "",
    titleAr: "",
    titleEn: "",
    tagAr: "",
    tagEn: "",
    descriptionAr: "",
    descriptionEn: "",
    image: "",
    actionType: "search",
    actionValue: ""
  });

  // Genres Helper
  const availableGenres = [
    { ar: "أكشن", en: "Action" },
    { ar: "جريمة", en: "Crime" },
    { ar: "دراما", en: "Drama" },
    { ar: "كوميديا", en: "Comedy" },
    { ar: "خيال علمي", en: "Sci-Fi" },
    { ar: "رعب", en: "Horror" },
    { ar: "غموض", en: "Mystery" },
    { ar: "تشويق", en: "Thriller" },
    { ar: "مغامرة", en: "Adventure" },
    { ar: "خيال", en: "Fantasy" },
    { ar: "حرب", en: "War" },
    { ar: "رومانسية", en: "Romance" },
    { ar: "أنيميشن", en: "Animation" },
    { ar: "أنمي", en: "Anime" },
    { ar: "تاريخي", en: "Historical" },
    { ar: "سيرة ذاتية", en: "Biography" },
    { ar: "عائلي", en: "Family" },
    { ar: "وثائقي", en: "Documentary" },
    { ar: "إثارة", en: "Suspense" },
    { ar: "موسيقى", en: "Music" },
    { ar: "رياضي", en: "Sport" }
  ];

  // Load Admin Data from Server
  const fetchAdminData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl("/api/admin/data"));
      if (res.ok) {
        const data = await res.json();
        const fetchedMovies: Movie[] = data.movies || [];
        setMovies(fetchedMovies);
        setCustomHeroId(data.customHeroId);
        setCustomTrendingIds(data.customTrendingIds || []);
        setCustomPromos(data.customPromos || []);

        const hasPending = fetchedMovies.some(m => m.isPublished === false);
        if (hasPending) {
          setPublishFilter("pending");
        }
      } else {
        setError(lang === "ar" ? "فشل تحميل البيانات من السيرفر" : "Failed to load admin data");
      }
      await fetchAdsSettings();
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, []);

  const openKeyboard = (label: string, initialValue: string, onChange: (val: string) => void) => {
    setKeyboardModalTarget({ label, value: initialValue, onChange });
    setKeyboardValue(initialValue);
    setKeyboardFocusedKey({ row: 0, col: 0 });
    setShowKeyboardModal(true);
  };

  // Auto-scroll focused element into view in Admin Panel
  useEffect(() => {
    const focusedEl = document.querySelector('[data-admin-focused="true"]');
    if (focusedEl) {
      focusedEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
      });
    }
  }, [
    adminFocusArea,
    headerFocusIndex,
    adminFocusedTabIndex,
    focusedListElement,
    focusedMovieIndex,
    focusedMovieBtnIndex,
    focusedFormFieldIndex,
    focusedGenreIndex,
    focusedServerRowIndex,
    focusedServerColIndex,
    bannerFocusIndex,
    bannerPromoBtnIndex,
    focusedAdminFormIndex,
    focusedAdIndex,
    showPromoForm,
    focusedPromoFormIndex,
    activeTab
  ]);

  // Native keydown handler for TV Remote / Keyboard directly in Admin Panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea";

      if (e.key === "ArrowUp") {
        if (!isInput || showKeyboardModal) { e.preventDefault(); handleAdminRemote("up"); }
      } else if (e.key === "ArrowDown") {
        if (!isInput || showKeyboardModal) { e.preventDefault(); handleAdminRemote("down"); }
      } else if (e.key === "ArrowLeft") {
        if (!isInput || showKeyboardModal) { e.preventDefault(); handleAdminRemote("left"); }
      } else if (e.key === "ArrowRight") {
        if (!isInput || showKeyboardModal) { e.preventDefault(); handleAdminRemote("right"); }
      } else if (e.key === "Enter") {
        if (!isInput || showKeyboardModal) { e.preventDefault(); handleAdminRemote("ok"); }
      } else if (e.key === "Escape" || e.key === "Backspace") {
        if (showKeyboardModal || deleteConfirmState.show) {
          e.preventDefault();
          handleAdminRemote("back");
        } else if (!isInput && e.key === "Escape") {
          e.preventDefault();
          handleAdminRemote("back");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    adminFocusArea, activeTab, searchTerm, formData, promoFormData, showPromoForm,
    focusedFormFieldIndex, focusedGenreIndex, focusedServerRowIndex, focusedServerColIndex,
    focusedPromoFormIndex, bannerFocusIndex, bannerPromoBtnIndex, focusedAdminFormIndex,
    focusedAdIndex, showKeyboardModal, keyboardModalTarget, keyboardLang, keyboardValue, keyboardFocusedKey,
    movies, customPromos, adminUsers, deleteConfirmState, confirmModalFocus
  ]);

  const handleAdminRemote = (action: string) => {
    // Intercept if custom delete confirmation is open
    if (deleteConfirmState.show) {
      if (action === "left" || action === "right") {
        setConfirmModalFocus(prev => prev === "cancel" ? "confirm" : "cancel");
      } else if (action === "back") {
        setDeleteConfirmState({ show: false, type: "movie", id: "", name: "" });
      } else if (action === "ok") {
        if (confirmModalFocus === "confirm") {
          if (deleteConfirmState.type === "movie") {
            executeDeleteMovie(deleteConfirmState.id);
          } else {
            executeDeletePromo(deleteConfirmState.id);
          }
        } else {
          setDeleteConfirmState({ show: false, type: "movie", id: "", name: "" });
        }
      }
      return;
    }

    // 1. If Virtual Keyboard Modal is open, intercept EVERYTHING
    if (showKeyboardModal && keyboardModalTarget) {
      const keys = keyboardLang === "ar" ? arabicKeys : englishKeys;
      let r = keyboardFocusedKey.row;
      let c = keyboardFocusedKey.col;
      
      if (action === "up") {
        r = Math.max(r - 1, 0);
      } else if (action === "down") {
        r = Math.min(r + 1, 5);
      } else if (action === "left") {
        const rowLen = r === 5 ? 4 : keys[r].length;
        c = (c > 0) ? c - 1 : rowLen - 1;
      } else if (action === "right") {
        const rowLen = r === 5 ? 4 : keys[r].length;
        c = (c < rowLen - 1) ? c + 1 : 0;
      } else if (action === "back") {
        setShowKeyboardModal(false);
      } else if (action === "ok") {
        if (r < 5) {
          const char = keys[r][c];
          setKeyboardValue(prev => prev + char);
        } else {
          // Action buttons row
          if (c === 0) {
            setKeyboardValue(prev => prev + " ");
          } else if (c === 1) {
            setKeyboardValue(prev => prev.slice(0, -1));
          } else if (c === 2) {
            setKeyboardLang(prev => prev === "ar" ? "en" : "ar");
            c = 0;
          } else if (c === 3) {
            keyboardModalTarget.onChange(keyboardValue);
            setShowKeyboardModal(false);
          }
        }
      }
      
      const rowLen = r === 5 ? 4 : keys[r].length;
      if (c >= rowLen) {
        c = rowLen - 1;
      }
      setKeyboardFocusedKey({ row: r, col: c });
      return;
    }

    // 2. HEADER FOCUS AREA
    if (adminFocusArea === "header") {
      if (action === "left" || action === "right") {
        setHeaderFocusIndex(prev => prev === 0 ? 1 : 0);
      } else if (action === "down") {
        setAdminFocusArea("tabs");
      } else if (action === "ok") {
        if (headerFocusIndex === 0 && onLogout) {
          onLogout();
        } else if (headerFocusIndex === 1 && onClose) {
          onClose();
        }
      } else if (action === "back") {
        onClose?.();
      }
      return;
    }

    // 3. TABS FOCUS AREA
    if (adminFocusArea === "tabs") {
      if (action === "left") {
        if (lang === "ar") {
          setAdminFocusedTabIndex(prev => Math.min(prev + 1, 4));
        } else {
          setAdminFocusedTabIndex(prev => Math.max(prev - 1, 0));
        }
      } else if (action === "right") {
        if (lang === "ar") {
          setAdminFocusedTabIndex(prev => Math.max(prev - 1, 0));
        } else {
          setAdminFocusedTabIndex(prev => Math.min(prev + 1, 4));
        }
      } else if (action === "up") {
        setAdminFocusArea("header");
      } else if (action === "down" || action === "ok") {
        const tabs: ("list" | "form" | "banner" | "admins" | "ads")[] = ["list", "form", "banner", "admins", "ads"];
        const selectedTab = tabs[adminFocusedTabIndex] || "list";
        setActiveTab(selectedTab);
        setAdminFocusArea(selectedTab);
        if (selectedTab === "list") {
          setFocusedListElement(-3);
        } else if (selectedTab === "form") {
          setFocusedFormFieldIndex(0);
        } else if (selectedTab === "banner") {
          setBannerFocusIndex(0);
        } else if (selectedTab === "admins") {
          setFocusedAdminFormIndex(0);
        } else if (selectedTab === "ads") {
          setFocusedAdIndex(0);
        }
      } else if (action === "back") {
        onClose?.();
      }
      return;
    }

    // 4. TAB 0: LIST FOCUS AREA
    if (adminFocusArea === "list") {
      const filteredMovies = movies.filter(m => {
        const term = searchTerm.toLowerCase();
        return (
          m.titleAr.toLowerCase().includes(term) ||
          m.titleEn.toLowerCase().includes(term) ||
          m.genres.some(g => g.toLowerCase().includes(term))
        );
      });

      if (focusedListElement < 0) {
        if (action === "up") {
          setAdminFocusArea("tabs");
        } else if (action === "down") {
          setFocusedListElement(0);
        } else if (action === "left") {
          if (lang === "ar") {
            setFocusedListElement(prev => Math.min(prev + 1, -1));
          } else {
            setFocusedListElement(prev => Math.max(prev - 1, -3));
          }
        } else if (action === "right") {
          if (lang === "ar") {
            setFocusedListElement(prev => Math.max(prev - 1, -3));
          } else {
            setFocusedListElement(prev => Math.min(prev + 1, -1));
          }
        } else if (action === "ok") {
          if (focusedListElement === -3) {
            openKeyboard(
              lang === "ar" ? "رابط أو اسم الفيلم/المسلسل..." : "Type show name or paste link...",
              importUrl,
              (val) => setImportUrl(val)
            );
          } else if (focusedListElement === -2) {
            handleImportUrl();
          } else if (focusedListElement === -1) {
            handleSyncCinemana();
          }
        } else if (action === "back") {
          setAdminFocusArea("tabs");
        }
        return;
      }

      if (focusedListElement === 0) { // Search Bar
        if (action === "up") {
          setFocusedListElement(-3);
        } else if (action === "down") {
          if (filteredMovies.length > 0) {
            setFocusedListElement(1);
            setFocusedMovieIndex(0);
            setFocusedMovieBtnIndex(0);
          }
        } else if (action === "ok") {
          openKeyboard(lang === "ar" ? "ابحث بالاسم..." : "Search by title...", searchTerm, (val) => setSearchTerm(val));
        } else if (action === "back") {
          if (searchTerm) setSearchTerm("");
          else setAdminFocusArea("tabs");
        }
        return;
      }

      if (focusedListElement === 1) { // Movie Card Grid
        if (action === "up") {
          if (focusedMovieIndex >= 3) {
            setFocusedMovieIndex(prev => prev - 3);
          } else {
            setFocusedListElement(0);
          }
        } else if (action === "down") {
          if (focusedMovieIndex + 3 < filteredMovies.length) {
            setFocusedMovieIndex(prev => prev + 3);
          } else {
            setFocusedMovieIndex(filteredMovies.length - 1);
          }
        } else if (action === "left") {
          if (lang === "ar") {
            if (focusedMovieBtnIndex < 3) {
              setFocusedMovieBtnIndex(prev => prev + 1);
            } else if (focusedMovieIndex < filteredMovies.length - 1) {
              setFocusedMovieIndex(prev => prev + 1);
              setFocusedMovieBtnIndex(0);
            }
          } else {
            if (focusedMovieBtnIndex > 0) {
              setFocusedMovieBtnIndex(prev => prev - 1);
            } else if (focusedMovieIndex > 0) {
              setFocusedMovieIndex(prev => prev - 1);
              setFocusedMovieBtnIndex(3);
            } else {
              setFocusedListElement(0);
            }
          }
        } else if (action === "right") {
          if (lang === "ar") {
            if (focusedMovieBtnIndex > 0) {
              setFocusedMovieBtnIndex(prev => prev - 1);
            } else if (focusedMovieIndex > 0) {
              setFocusedMovieIndex(prev => prev - 1);
              setFocusedMovieBtnIndex(3);
            } else {
              setFocusedListElement(0);
            }
          } else {
            if (focusedMovieBtnIndex < 3) {
              setFocusedMovieBtnIndex(prev => prev + 1);
            } else if (focusedMovieIndex < filteredMovies.length - 1) {
              setFocusedMovieIndex(prev => prev + 1);
              setFocusedMovieBtnIndex(0);
            }
          }
        } else if (action === "ok") {
          const m = filteredMovies[focusedMovieIndex];
          if (m) {
            if (focusedMovieBtnIndex === 0) {
              handleEditMovieClick(m);
              setAdminFocusArea("form");
              setFocusedFormFieldIndex(0);
            } else if (focusedMovieBtnIndex === 1) {
              handleDeleteMovie(m.id, lang === "ar" ? m.titleAr : m.titleEn);
            } else if (focusedMovieBtnIndex === 2) {
              handleSetHero(m.id);
            } else if (focusedMovieBtnIndex === 3) {
              handleToggleTrending(m.id);
            }
          }
        } else if (action === "back") {
          setFocusedListElement(0);
        }
        return;
      }
    }

    // AREA: FORM (Tab 1)
    if (adminFocusArea === "form") {
      if (action === "up") {
        if (focusedFormFieldIndex === 0) {
          setAdminFocusArea("tabs");
        } else {
          setFocusedFormFieldIndex(prev => prev - 1);
        }
      } else if (action === "down") {
        setFocusedFormFieldIndex(prev => Math.min(prev + 1, 17));
      } else if (action === "left" || action === "right") {
        // Side movements for toggle rows / grids
        if (focusedFormFieldIndex === 2 || focusedFormFieldIndex === 3) {
          // Movie vs Series button
          setFocusedFormFieldIndex(prev => prev === 2 ? 3 : 2);
        } else if (focusedFormFieldIndex === 12) {
          // Genre select grid (14 available genres)
          const dir = action === "left" ? -1 : 1;
          const delta = lang === "ar" ? -dir : dir;
          setFocusedGenreIndex(prev => {
            const next = prev + delta;
            return (next >= 0 && next < availableGenres.length) ? next : prev;
          });
        } else if (focusedFormFieldIndex === 14) {
          // Servers list inputs / buttons
          const maxCols = 3; // 0: name input, 1: url input, 2: delete button
          if (action === "left") {
            setFocusedServerColIndex(prev => Math.max(prev - 1, 0));
          } else if (action === "right") {
            setFocusedServerColIndex(prev => Math.min(prev + 1, maxCols - 1));
          }
        } else if (focusedFormFieldIndex === 16 || focusedFormFieldIndex === 17) {
          // Submit vs Cancel button
          setFocusedFormFieldIndex(prev => prev === 16 ? 17 : 16);
        }
      } else if (action === "ok") {
        if (focusedFormFieldIndex === 0) {
          openKeyboard("العنوان بالعربية / Arabic Title", formData.titleAr, (val) => setFormData(p => ({ ...p, titleAr: val })));
        } else if (focusedFormFieldIndex === 1) {
          openKeyboard("العنوان بالإنجليزية / English Title", formData.titleEn, (val) => setFormData(p => ({ ...p, titleEn: val })));
        } else if (focusedFormFieldIndex === 2) {
          setFormData(p => ({ ...p, type: "movie" }));
        } else if (focusedFormFieldIndex === 3) {
          setFormData(p => ({ ...p, type: "series" }));
        } else if (focusedFormFieldIndex === 4) {
          openKeyboard("التقييم / Rating (e.g. 8.5)", String(formData.rating), (val) => setFormData(p => ({ ...p, rating: parseFloat(val) || 0 })));
        } else if (focusedFormFieldIndex === 5) {
          openKeyboard("سنة الإنتاج / Release Year", String(formData.year), (val) => setFormData(p => ({ ...p, year: parseInt(val) || 0 })));
        } else if (focusedFormFieldIndex === 6) {
          openKeyboard("المدة / Duration (e.g. 1h 45m / 10 Episodes)", formData.duration, (val) => setFormData(p => ({ ...p, duration: val })));
        } else if (focusedFormFieldIndex === 7) {
          const qList = ["HD 720p", "Full HD", "Ultra HD 4K"];
          const curIdx = qList.indexOf(formData.quality);
          const nextIdx = (curIdx + 1) % qList.length;
          setFormData(p => ({ ...p, quality: qList[nextIdx] }));
        } else if (focusedFormFieldIndex === 8) {
          openKeyboard("رابط صورة البوستر / Poster URL", formData.poster, (val) => setFormData(p => ({ ...p, poster: val })));
        } else if (focusedFormFieldIndex === 9) {
          openKeyboard("رابط الخلفية العريضة / Backdrop URL", formData.backdrop, (val) => setFormData(p => ({ ...p, backdrop: val })));
        } else if (focusedFormFieldIndex === 10) {
          openKeyboard("قصة الفيلم بالعربية / Synopsis (Ar)", formData.storyAr, (val) => setFormData(p => ({ ...p, storyAr: val })));
        } else if (focusedFormFieldIndex === 11) {
          openKeyboard("قصة الفيلم بالإنجليزية / Synopsis (En)", formData.storyEn, (val) => setFormData(p => ({ ...p, storyEn: val })));
        } else if (focusedFormFieldIndex === 12) {
          // Toggle Genre checkbox
          const g = availableGenres[focusedGenreIndex]?.ar;
          if (g) {
            const hasG = formData.genres.includes(g);
            setFormData(p => ({
              ...p,
              genres: hasG ? p.genres.filter(x => x !== g) : [...p.genres, g]
            }));
          }
        } else if (focusedFormFieldIndex === 13) {
          openKeyboard("الممثلين / Actors (comma separated)", formData.actors.join(", "), (val) => setFormData(p => ({ ...p, actors: val.split(",").map(x => x.trim()).filter(Boolean) })));
        } else if (focusedFormFieldIndex === 14) {
          // Edit server Name, URL, or Delete
          if (focusedServerColIndex === 0) {
            openKeyboard("اسم السيرفر / Server Name", formData.servers[focusedServerRowIndex]?.name || "", (val) => {
              const updated = [...formData.servers];
              if (updated[focusedServerRowIndex]) {
                updated[focusedServerRowIndex].name = val;
                setFormData(p => ({ ...p, servers: updated }));
              }
            });
          } else if (focusedServerColIndex === 1) {
            openKeyboard("رابط البث والفيديو / Stream URL", formData.servers[focusedServerRowIndex]?.url || "", (val) => {
              const updated = [...formData.servers];
              if (updated[focusedServerRowIndex]) {
                updated[focusedServerRowIndex].url = val;
                setFormData(p => ({ ...p, servers: updated }));
              }
            });
          } else if (focusedServerColIndex === 2) {
            if (formData.servers.length > 1) {
              const updated = formData.servers.filter((_, idx) => idx !== focusedServerRowIndex);
              setFormData(p => ({ ...p, servers: updated }));
              setFocusedServerRowIndex(0);
            }
          }
        } else if (focusedFormFieldIndex === 15) {
          setFormData(p => ({ ...p, servers: [...p.servers, { name: `سيرفر إضافي ${p.servers.length + 1}`, url: "" }] }));
        } else if (focusedFormFieldIndex === 16) {
          handleMovieFormSubmit({ preventDefault: () => {} } as any);
        } else if (focusedFormFieldIndex === 17) {
          resetMovieForm();
          setActiveTab("list");
          setAdminFocusArea("list");
        }
      } else if (action === "back") {
        setAdminFocusArea("tabs");
      }
      return;
    }

    // AREA: BANNER & PROMOS (Tab 2)
    if (adminFocusArea === "banner") {
      if (showPromoForm) {
        // Promo Form Navigation (0 to 11)
        if (action === "up") {
          if (focusedPromoFormIndex === 0) {
            setShowPromoForm(false);
          } else {
            setFocusedPromoFormIndex(prev => prev - 1);
          }
        } else if (action === "down") {
          setFocusedPromoFormIndex(prev => Math.min(prev + 1, 11));
        } else if (action === "left" || action === "right") {
          if (focusedPromoFormIndex === 10 || focusedPromoFormIndex === 11) {
            setFocusedPromoFormIndex(prev => prev === 10 ? 11 : 10);
          }
        } else if (action === "ok") {
          if (focusedPromoFormIndex === 0) {
            openKeyboard("معرف السلايدر (ID)", promoFormData.id, (val) => setPromoFormData(p => ({ ...p, id: val })));
          } else if (focusedPromoFormIndex === 1) {
            openKeyboard("العنوان بالعربية", promoFormData.titleAr, (val) => setPromoFormData(p => ({ ...p, titleAr: val })));
          } else if (focusedPromoFormIndex === 2) {
            openKeyboard("العنوان بالإنجليزية", promoFormData.titleEn, (val) => setPromoFormData(p => ({ ...p, titleEn: val })));
          } else if (focusedPromoFormIndex === 3) {
            openKeyboard("الوسم (تاغ) بالعربية", promoFormData.tagAr, (val) => setPromoFormData(p => ({ ...p, tagAr: val })));
          } else if (focusedPromoFormIndex === 4) {
            openKeyboard("الوسم بالإنجليزية", promoFormData.tagEn, (val) => setPromoFormData(p => ({ ...p, tagEn: val })));
          } else if (focusedPromoFormIndex === 5) {
            openKeyboard("الوصف بالعربية", promoFormData.descriptionAr, (val) => setPromoFormData(p => ({ ...p, descriptionAr: val })));
          } else if (focusedPromoFormIndex === 6) {
            openKeyboard("الوصف بالإنجليزية", promoFormData.descriptionEn, (val) => setPromoFormData(p => ({ ...p, descriptionEn: val })));
          } else if (focusedPromoFormIndex === 7) {
            openKeyboard("رابط الصورة العريضة", promoFormData.image, (val) => setPromoFormData(p => ({ ...p, image: val })));
          } else if (focusedPromoFormIndex === 8) {
            const nextType = promoFormData.actionType === "search" ? "play" : "search";
            setPromoFormData(p => ({ ...p, actionType: nextType }));
          } else if (focusedPromoFormIndex === 9) {
            openKeyboard("قيمة الحدث (اسم بحث أو معرف)", promoFormData.actionValue, (val) => setPromoFormData(p => ({ ...p, actionValue: val })));
          } else if (focusedPromoFormIndex === 10) {
            // Save Promo
            handleAddOrEditPromo({ preventDefault: () => {} } as any);
          } else if (focusedPromoFormIndex === 11) {
            // Cancel Promo
            setShowPromoForm(false);
          }
        } else if (action === "back") {
          setShowPromoForm(false);
        }
      } else {
        // Banner promo list
        if (action === "up") {
          if (bannerFocusIndex === 0) {
            setAdminFocusArea("tabs");
          } else {
            setBannerFocusIndex(prev => prev - 1);
          }
        } else if (action === "down") {
          setBannerFocusIndex(prev => Math.min(prev + 1, customPromos.length));
        } else if (action === "left" || action === "right") {
          if (bannerFocusIndex > 0) {
            setBannerPromoBtnIndex(prev => prev === 0 ? 1 : 0);
          }
        } else if (action === "ok") {
          if (bannerFocusIndex === 0) {
            setPromoFormData({
              id: "promo-" + Date.now(),
              titleAr: "",
              titleEn: "",
              tagAr: "",
              tagEn: "",
              descriptionAr: "",
              descriptionEn: "",
              image: "",
              actionType: "search",
              actionValue: ""
            });
            setShowPromoForm(true);
            setFocusedPromoFormIndex(0);
          } else {
            const p = customPromos[bannerFocusIndex - 1];
            if (p) {
              if (bannerPromoBtnIndex === 0) {
                // Edit Promo
                setPromoFormData(p);
                setShowPromoForm(true);
                setFocusedPromoFormIndex(0);
              } else {
                // Delete Promo
                handleDeletePromo(p.id);
                setBannerFocusIndex(0);
              }
            }
          }
        } else if (action === "back") {
          setAdminFocusArea("tabs");
        }
      }
      return;
    }

    // AREA: ADMINS (Tab 3)
    if (adminFocusArea === "admins") {
      if (action === "up") {
        if (focusedAdminFormIndex === 0) {
          setAdminFocusArea("tabs");
        } else {
          setFocusedAdminFormIndex(prev => prev - 1);
        }
      } else if (action === "down") {
        setFocusedAdminFormIndex(prev => Math.min(prev + 1, 2 + adminUsers.length));
      } else if (action === "ok") {
        if (focusedAdminFormIndex === 0) {
          openKeyboard("اسم المستخدم الجديد / Username", newAdminUsername, (val) => setNewAdminUsername(val));
        } else if (focusedAdminFormIndex === 1) {
          openKeyboard("كلمة المرور الجديدة / Password", newAdminPassword, (val) => setNewAdminPassword(val));
        } else if (focusedAdminFormIndex === 2) {
          // Trigger Add Admin Submit
          handleAddAdmin({ preventDefault: () => {} } as any);
        } else {
          // Delete admin item
          const adminIdx = focusedAdminFormIndex - 3;
          const u = adminUsers[adminIdx];
          if (u) {
            handleDeleteAdmin(u.username);
            setFocusedAdminFormIndex(0);
          }
        }
      } else if (action === "back") {
        setAdminFocusArea("tabs");
      }
      return;
    }

    // AREA: ADS (Tab 4)
    if (adminFocusArea === "ads") {
      if (action === "up") {
        if (focusedAdIndex === 0) {
          setAdminFocusArea("tabs");
        } else {
          setFocusedAdIndex(prev => prev - 1);
        }
      } else if (action === "down") {
        setFocusedAdIndex(prev => Math.min(prev + 1, 3 + (adsSettings?.ads?.length || 0)));
      } else if (action === "left" || action === "right") {
        if (focusedAdIndex === 1 || focusedAdIndex === 2) {
          setFocusedAdIndex(prev => prev === 1 ? 2 : 1);
        }
      } else if (action === "ok") {
        if (focusedAdIndex === 0) {
          handleToggleGlobalAds();
        } else if (focusedAdIndex === 1) {
          openKeyboard(
            lang === "ar" ? "مدة المشاهدة الإجبارية (ثواني)" : "Skip Seconds",
            String(adsSettings?.globalSkipAfterSeconds || 5),
            (val) => {
              const num = parseInt(val) || 0;
              const updated = { ...adsSettings, globalSkipAfterSeconds: num };
              setAdsSettings(updated);
              saveAdsSettings(updated);
            }
          );
        } else if (focusedAdIndex === 2) {
          const updated = { ...adsSettings, allowSkip: !adsSettings?.allowSkip };
          setAdsSettings(updated);
          saveAdsSettings(updated);
        } else if (focusedAdIndex === 3) {
          resetAdForm();
          setShowAdModal(true);
        } else {
          const adIdx = focusedAdIndex - 4;
          const ad = adsSettings?.ads?.[adIdx];
          if (ad) {
            handleEditAdClick(ad);
          }
        }
      } else if (action === "back") {
        setAdminFocusArea("tabs");
      }
      return;
    }
  };

  const handleAddAdmin = (e: any) => {
    e.preventDefault();
    setAdminError(null);
    setAdminSuccess(null);

    const cleanUsername = newAdminUsername.trim().toLowerCase();
    const cleanPassword = newAdminPassword.trim();

    if (!cleanUsername || !cleanPassword) {
      setAdminError(lang === "ar" ? "يرجى تعبئة جميع الحقول" : "Please fill in all fields");
      return;
    }

    if (adminUsers.some(u => u.username === cleanUsername)) {
      setAdminError(lang === "ar" ? "اسم المستخدم هذا موجود مسبقاً!" : "This username already exists!");
      return;
    }

    const updated = [...adminUsers, { username: cleanUsername, password: cleanPassword }];
    setAdminUsers(updated);
    safeStorage.setItem("cinemana_admin_users", JSON.stringify(updated));
    setNewAdminUsername("");
    setNewAdminPassword("");
    setAdminSuccess(lang === "ar" ? "تم إضافة حساب مسؤول جديد بنجاح" : "New admin account added successfully");
  };

  const handleDeleteAdmin = (username: string) => {
    setAdminError(null);
    setAdminSuccess(null);

    // Check if logged-in user in localStorage matches
    const sessionSaved = safeStorage.getItem("cinemana_session");
    if (sessionSaved) {
      try {
        const session = JSON.parse(sessionSaved);
        if (session.username === username) {
          setAdminError(lang === "ar" ? "لا يمكنك حذف حسابك أثناء تسجيل الدخول به!" : "You cannot delete your own account while logged in!");
          return;
        }
      } catch (e) {}
    }

    const updated = adminUsers.filter(u => u.username !== username);
    setAdminUsers(updated);
    safeStorage.setItem("cinemana_admin_users", JSON.stringify(updated));
    setAdminSuccess(lang === "ar" ? "تم حذف حساب المسؤول بنجاح" : "Admin account deleted successfully");
  };

  useEffect(() => {
    if (adminRemoteAction) {
      handleAdminRemote(adminRemoteAction.action);
      if (setAdminRemoteAction) setAdminRemoteAction(null);
    }
  }, [
    adminRemoteAction, adminFocusArea, activeTab, searchTerm, formData, promoFormData, showPromoForm,
    focusedFormFieldIndex, focusedGenreIndex, focusedServerRowIndex, focusedServerColIndex,
    focusedPromoFormIndex, bannerFocusIndex, bannerPromoBtnIndex, focusedAdminFormIndex,
    showKeyboardModal, keyboardModalTarget, keyboardLang, keyboardValue, keyboardFocusedKey,
    movies, customPromos, adminUsers
  ]);

  const showToast = (message: string, isSuccess = true) => {
    if (isSuccess) {
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 4000);
    } else {
      setError(message);
      setTimeout(() => setError(null), 5000);
    }
  };

  const handleImportSubsource = async (targetLang: "ar" | "en") => {
    const url = targetLang === "ar" ? formData.subtitlesUrlAr : formData.subtitlesUrlEn;
    if (!url) {
      showToast(lang === "ar" ? "يرجى كتابة رابط الترجمة من Subsource أولاً" : "Please enter a Subsource subtitle URL first", false);
      return;
    }
    setIsImportingSubsource(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/import-subsource"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.success) {
        if (targetLang === "ar") {
          setFormData(prev => ({ ...prev, subtitlesUrlAr: data.url }));
        } else {
          setFormData(prev => ({ ...prev, subtitlesUrlEn: data.url }));
        }
        showToast(lang === "ar" ? "تم استيراد وترجمة ملف Subsource وتشفيره لـ UTF-8 بنجاح!" : "Subsource subtitle downloaded and converted to UTF-8 successfully!", true);
      } else {
        showToast(data.error || "Failed to import", false);
      }
    } catch (err: any) {
      showToast(err.message || "Network error", false);
    } finally {
      setIsImportingSubsource(false);
    }
  };

  const handleImportSubsourceForEpisode = async (seasonIdx: number, epIdx: number, langKey: "ar" | "en") => {
    const season = formData.seasons?.[seasonIdx];
    const episode = season?.episodes?.[epIdx];
    if (!episode) return;
    const url = langKey === "ar" ? episode.subtitlesUrlAr : episode.subtitlesUrlEn;
    if (!url) {
      showToast(lang === "ar" ? "يرجى كتابة رابط الترجمة من Subsource أولاً في حقل الترجمة" : "Please enter a Subsource subtitle URL in the field first", false);
      return;
    }
    setIsImportingSubsource(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/import-subsource"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.success) {
        updateEpisodeField(seasonIdx, epIdx, langKey === "ar" ? "subtitlesUrlAr" : "subtitlesUrlEn", data.url);
        showToast(lang === "ar" ? "تم استيراد وترجمة ملف Subsource وتشفيره لـ UTF-8 بنجاح!" : "Subsource subtitle downloaded and converted to UTF-8 successfully!", true);
      } else {
        showToast(data.error || "Failed to import", false);
      }
    } catch (err: any) {
      showToast(err.message || "Network error", false);
    } finally {
      setIsImportingSubsource(false);
    }
  };

  const handleSubtitleUpload = async (e: React.ChangeEvent<HTMLInputElement>, langKey: "ar" | "en") => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (langKey === "ar") setIsUploadingAr(true);
    else setIsUploadingEn(true);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (!arrayBuffer) {
          showToast(lang === "ar" ? "تعذر قراءة ملف الترجمة" : "Failed to read subtitle file", false);
          if (langKey === "ar") setIsUploadingAr(false);
          else setIsUploadingEn(false);
          return;
        }

        let fileContent = "";
        try {
          // Attempt UTF-8 decoding first
          const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
          fileContent = utf8Decoder.decode(arrayBuffer);
        } catch (e) {
          // Fallback to windows-1256 for Arabic subtitles if UTF-8 fails
          try {
            const win1256Decoder = new TextDecoder("windows-1256");
            fileContent = win1256Decoder.decode(arrayBuffer);
          } catch (err) {
            const looseDecoder = new TextDecoder("utf-8");
            fileContent = looseDecoder.decode(arrayBuffer);
          }
        }

        try {
          const response = await fetch(getApiUrl("/api/admin/upload-subtitle"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileName: file.name, fileContent }),
          });

          if (response.ok) {
            const data = await response.json();
            if (langKey === "ar") {
              setFormData(prev => ({ ...prev, subtitlesUrlAr: data.url }));
              showToast(lang === "ar" ? "تم رفع ملف الترجمة العربية بنجاح!" : "Arabic subtitle uploaded successfully!", true);
            } else {
              setFormData(prev => ({ ...prev, subtitlesUrlEn: data.url }));
              showToast(lang === "ar" ? "تم رفع ملف الترجمة الإنجليزية بنجاح!" : "English subtitle uploaded successfully!", true);
            }
          } else {
            const errData = await response.json();
            showToast(errData.error || (lang === "ar" ? "فشل الرفع" : "Upload failed"), false);
          }
        } catch (err: any) {
          showToast(err.message || "Network error", false);
        } finally {
          if (langKey === "ar") setIsUploadingAr(false);
          else setIsUploadingEn(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      showToast(err.message || "Failed to process file", false);
      if (langKey === "ar") setIsUploadingAr(false);
      else setIsUploadingEn(false);
    }
  };

  const handleAutoFetchSubtitles = async () => {
    if (!formData.titleEn && !formData.titleAr) {
      showToast(lang === "ar" ? "يرجى كتابة اسم العمل أولاً" : "Please enter title first", false);
      return;
    }
    setIsAutoFetchingSubtitles(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/auto-fetch-subtitles"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleEn: formData.titleEn,
          titleAr: formData.titleAr,
          year: formData.year ? parseInt(String(formData.year)) : undefined,
          type: formData.type || "movie"
        })
      });
      const data = await res.json();
      if (data.success) {
        setFormData(prev => ({
          ...prev,
          subtitlesUrlAr: data.subtitlesUrlAr || prev.subtitlesUrlAr,
          subtitlesUrlEn: data.subtitlesUrlEn || prev.subtitlesUrlEn
        }));
        showToast(data.message, !!(data.subtitlesUrlAr || data.subtitlesUrlEn));
      } else {
        showToast(data.error || "Auto fetch failed", false);
      }
    } catch (err: any) {
      showToast(err.message || "Network error", false);
    } finally {
      setIsAutoFetchingSubtitles(false);
    }
  };

  // Delete Movie Handlers
  const handleDeleteMovie = (id: string, name: string) => {
    setDeleteConfirmState({
      show: true,
      type: "movie",
      id,
      name
    });
    setConfirmModalFocus("cancel");
  };

  const executeDeleteMovie = async (id: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/admin/movies/${id}`), {
        method: "DELETE"
      });
      if (res.ok) {
        showToast(lang === "ar" ? "تم حذف العمل بنجاح!" : "Deleted successfully!");
        fetchAdminData();
        if (onRefreshData) onRefreshData();
      } else {
        const errData = await res.json();
        showToast(errData.error || "Error", false);
      }
    } catch (err: any) {
      showToast(err.message || "Network error", false);
    } finally {
      setDeleteConfirmState({ show: false, type: "movie", id: "", name: "" });
    }
  };

  // Toggle Hero Banner
  const handleSetHero = async (movieId: string) => {
    const nextHeroId = customHeroId === movieId ? null : movieId;
    try {
      const res = await fetch(getApiUrl("/api/admin/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customHeroId: nextHeroId })
      });
      if (res.ok) {
        setCustomHeroId(nextHeroId);
        showToast(lang === "ar" ? "تم تغيير البانر الرئيسي واجهة بنجاح!" : "Hero banner updated successfully!");
        if (onRefreshData) onRefreshData();
      }
    } catch (err) {
      showToast("Error updating configuration", false);
    }
  };

  // Toggle Trending Status
  const handleToggleTrending = async (movieId: string) => {
    let nextTrendingIds = [...customTrendingIds];
    if (nextTrendingIds.includes(movieId)) {
      nextTrendingIds = nextTrendingIds.filter(id => id !== movieId);
    } else {
      nextTrendingIds.push(movieId);
    }

    try {
      const res = await fetch(getApiUrl("/api/admin/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customTrendingIds: nextTrendingIds })
      });
      if (res.ok) {
        setCustomTrendingIds(nextTrendingIds);
        showToast(lang === "ar" ? "تم تحديث الأفلام الرائجة!" : "Trending movies updated!");
        if (onRefreshData) onRefreshData();
      }
    } catch (err) {
      showToast("Error updating trending", false);
    }
  };

  const handleImportUrl = async () => {
    const trimmed = importUrl.trim();
    if (!trimmed) {
      showToast(lang === "ar" ? "الرجاء إدخال رابط صالح" : "Please enter a valid URL", false);
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/import-url"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed })
      });
      if (!res.ok) {
        throw new Error(`Server returned error status ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.data) {
        const item = data.data;
        setFormData({
          titleAr: item.titleAr || "",
          titleEn: item.titleEn || "",
          type: item.type || "movie",
          rating: item.rating || 8.0,
          year: item.year || new Date().getFullYear(),
          duration: item.duration || "",
          ageRating: item.ageRating || "",
          genres: Array.isArray(item.genres) ? item.genres : [],
          poster: item.poster || "",
          backdrop: item.backdrop || "",
          storyAr: item.storyAr || "",
          storyEn: item.storyEn || "",
          actors: Array.isArray(item.actors) ? item.actors : [],
          director: item.director || "",
          writer: item.writer || "",
          directorPhotoUrl: item.directorPhotoUrl || "",
          writerPhotoUrl: item.writerPhotoUrl || "",
          castMembers: Array.isArray(item.castMembers) ? item.castMembers : [],
          quality: item.quality || "Full HD",
          servers: item.servers && item.servers.length > 0 ? item.servers : [{ name: "سيرفر رئيسي 1080p", url: "" }],
          subtitlesUrlAr: item.subtitlesUrlAr || "",
          subtitlesUrlEn: item.subtitlesUrlEn || "",
          originalSubtitlesUrlAr: item.originalSubtitlesUrlAr || "",
          originalSubtitlesUrlEn: item.originalSubtitlesUrlEn || "",
          trailerUrl: item.trailerUrl || "",
          seasons: item.seasons || [],
          language: item.language || "en",
          country: item.country || "",
          collectionId: item.collectionId || "",
          collectionNameAr: item.collectionNameAr || "",
          collectionNameEn: item.collectionNameEn || "",
          partNumber: item.partNumber || "",
          logoUrl: item.logoUrl || item.titleLogo || "",
          isPublished: false
        });
        showToast(lang === "ar" ? "تم استيراد تفاصيل العمل والترجمات بنجاح!" : "Imported movie details and subtitles successfully!", true);
        setImportUrl("");
      } else {
        showToast(data.error || "Failed to import from URL", false);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to import from URL", false);
    } finally {
      setIsImporting(false);
    }
  };

  const handleSyncCinemana = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/sync-cinemana"), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(lang === "ar" ? "تمت مزامنة واستيراد سينمانا بالكامل وتحديث قاعدة البيانات!" : "Cinemana synced and imported fully, database updated!", true);
        if (onRefreshData) onRefreshData();
      } else {
        showToast(data.error || "Failed to sync Cinemana", false);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to sync Cinemana", false);
    } finally {
      setIsSyncing(false);
    }
  };

  // Submit Movie Add/Edit Form
  const handleMovieFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Auto fill title if one language is provided
    let titleAr = (formData.titleAr || "").trim();
    let titleEn = (formData.titleEn || "").trim();
    if (!titleAr && titleEn) titleAr = titleEn;
    if (!titleEn && titleAr) titleEn = titleAr;

    if (!titleAr || !titleEn) {
      showToast(lang === "ar" ? "الرجاء كتابة اسم العمل بالعربية أو الإنجليزية" : "Please enter a movie title", false);
      return;
    }

    // Clean up empty servers
    let filteredServers = formData.servers.filter(s => s.name.trim() && s.url.trim());
    if (formData.type === "movie" && filteredServers.length === 0) {
      // If user provided a server name or left it blank, assign default working server
      const defaultUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
      filteredServers = [{
        name: formData.servers[0]?.name?.trim() || "سيرفر رئيسي 1080p",
        url: formData.servers[0]?.url?.trim() || defaultUrl
      }];
    }

    // Prepare seasons & backward-compatible servers
    let finalizedSeasons: Season[] | undefined = undefined;
    let finalServers = filteredServers;

    if (formData.type === "series") {
      const seasonsList = formData.seasons || [];
      if (seasonsList.length === 0) {
        // Automatically build a season and episodes from flat servers if they just put episodes in servers
        const epServers = filteredServers.length > 0 ? filteredServers : [{ name: "الحلقة 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }];
        finalizedSeasons = [
          {
            id: `s1_${Date.now()}`,
            number: 1,
            titleAr: "الموسم الأول",
            titleEn: "Season 1",
            episodes: epServers.map((srv, idx) => ({
              id: `s1_e${idx+1}_${Date.now()}`,
              number: idx + 1,
              titleAr: srv.name || `الحلقة ${idx + 1}`,
              titleEn: `Episode ${idx + 1}`,
              duration: "45m",
              storyAr: `تفاصيل الحلقة ${idx + 1} من الموسم الأول لمسلسل ${titleAr}.`,
              storyEn: `Details of Episode ${idx + 1} of Season 1 of ${titleEn}.`,
              thumbnail: formData.backdrop || formData.poster || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=480&q=80",
              servers: [srv],
              subtitlesUrlAr: formData.subtitlesUrlAr || "",
              subtitlesUrlEn: formData.subtitlesUrlEn || "",
              rating: formData.rating || 8.0
            }))
          }
        ];
      } else {
        // Clean up and finalize user-defined seasons and episodes
        finalizedSeasons = seasonsList.map((season, sIndex) => {
          const sNum = season.number || (sIndex + 1);
          const cleanedEpisodes = (season.episodes || []).map((episode, eIndex) => {
            const epNum = episode.number || (eIndex + 1);
            const epId = episode.id || `s${sNum}_e${epNum}_${Date.now()}`;
            const epSrvs = (episode.servers || []).filter(s => s.name.trim() && s.url.trim());
            return {
              ...episode,
              id: epId,
              number: epNum,
              servers: epSrvs.length > 0 ? epSrvs : [{ name: `سيرفر الحلقة ${epNum}`, url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }],
              rating: episode.rating || 8.0
            };
          });

          return {
            ...season,
            id: season.id || `s${sNum}`,
            number: sNum,
            episodes: cleanedEpisodes
          };
        });

        // Set flat servers array for backward-compatibility
        const flatServers: any[] = [];
        finalizedSeasons.forEach((season) => {
          season.episodes.forEach((episode) => {
            const epNum = episode.number;
            const epTitleAr = episode.titleAr || `الحلقة ${epNum}`;
            const epUrl = (episode.servers && episode.servers[0]?.url) || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
            flatServers.push({
              name: `الحلقة ${epNum} - ${epTitleAr}`,
              url: epUrl
            });
          });
        });
        if (flatServers.length > 0) {
          finalServers = flatServers;
        } else {
          finalServers = [{ name: "الحلقة 1 HD", url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" }];
        }
      }
    }

    const payload = {
      ...formData,
      titleAr,
      titleEn,
      servers: finalServers,
      seasons: finalizedSeasons,
      partNumber: formData.partNumber && formData.partNumber.trim() ? parseInt(formData.partNumber) : undefined
    };

    const cleanPayload = JSON.parse(JSON.stringify(payload));

    const url = editingMovieId ? `/api/admin/movies/${editingMovieId}` : "/api/admin/movies";
    const method = editingMovieId ? "PUT" : "POST";

    try {
      const res = await fetch(getApiUrl(url), {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanPayload)
      });

      if (res.ok) {
        showToast(
          editingMovieId 
            ? (lang === "ar" ? "تم تعديل العمل بنجاح!" : "Updated successfully!")
            : (lang === "ar" ? "تم رفع وإضافة العمل الجديد بنجاح!" : "Uploaded successfully!")
        );
        resetMovieForm();
        setActiveTab("list");
        fetchAdminData();
        if (onRefreshData) onRefreshData();
      } else {
        const errData = await res.json().catch(() => ({ error: "فشل الاتصال بالخادم" }));
        showToast(errData.error || (lang === "ar" ? "حدث خطأ في استمارة إضافة العمل" : "Form submission error"), false);
      }
    } catch (err: any) {
      showToast(err.message || (lang === "ar" ? "خطأ في الاتصال بالشبكة" : "Network error"), false);
    }
  };

  const handleTogglePublish = async (movieId: string, currentPublishedStatus: boolean) => {
    try {
      const nextStatus = !currentPublishedStatus;
      const res = await fetch(getApiUrl("/api/admin/movies/toggle-publish"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: movieId, isPublished: nextStatus })
      });
      if (res.ok) {
        setMovies(prev => prev.map(m => m.id === movieId ? { ...m, isPublished: nextStatus } : m));
        setSuccessMessage(
          nextStatus 
            ? (lang === "ar" ? "تم نشر العمل الفني بنجاح ليصبح معروضاً للجمهور!" : "Published successfully!")
            : (lang === "ar" ? "تم إلغاء النشر وتحويل العمل بقائمة بانتظار المراجعة" : "Unpublished successfully")
        );
        setTimeout(() => setSuccessMessage(null), 3000);
        if (onRefreshData) onRefreshData();
      } else {
        const err = await res.json();
        setError(err.error || (lang === "ar" ? "فشلت عملية تغيير حالة النشر" : "Failed to toggle publish status"));
        setTimeout(() => setError(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || "Network error");
      setTimeout(() => setError(null), 3000);
    }
  };

  const handlePublishAllPending = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(getApiUrl("/api/admin/movies/publish-batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishAll: true })
      });
      if (res.ok) {
        const data = await res.json();
        setMovies(prev => prev.map(m => ({ ...m, isPublished: true })));
        setSuccessMessage(lang === "ar" ? `تم نشر وتفعيل جميع الأعمال المعروضة (${data.count || ''}) بنجاح!` : "All pending works published!");
        setTimeout(() => setSuccessMessage(null), 4000);
        setPublishFilter("published");
        if (onRefreshData) onRefreshData();
      } else {
        const err = await res.json();
        setError(err.error || (lang === "ar" ? "فشلت عملية النشر الجماعي" : "Batch publish failed"));
        setTimeout(() => setError(null), 3000);
      }
    } catch (err: any) {
      setError(err.message || "Network error");
      setTimeout(() => setError(null), 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerBatchImport = async () => {
    try {
      setIsBatchImporting(true);
      const res = await fetch(getApiUrl("/api/cinemana/import-batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 15 })
      });
      const data = await res.json();
      if (res.ok && (data.success || data.status === "success" || data.added !== undefined)) {
        const addedCount = data.added ?? data.stats?.recentlyAdded?.length ?? 15;
        setSuccessMessage(
          lang === "ar"
            ? `تم استيراد ${addedCount} عمل جديد بنجاح وإضافتها إلى قائمة 'بانتظار المراجعة' للمعاينة والنشر!`
            : `Imported ${addedCount} new items to 'Pending Review'!`
        );
        setTimeout(() => setSuccessMessage(null), 5000);
        setPublishFilter("pending");
        await fetchAdminData();
        if (onRefreshData) onRefreshData();
      } else {
        setError(data.message || data.error || (lang === "ar" ? "حدث خطأ أثناء الاستيراد" : "Import failed"));
        setTimeout(() => setError(null), 4000);
      }
    } catch (err: any) {
      setError(err.message || "Network error");
      setTimeout(() => setError(null), 4000);
    } finally {
      setIsBatchImporting(false);
    }
  };

  const handleEditMovieClick = (movie: Movie) => {
    setEditingMovieId(movie.id);
    setFormData({
      titleAr: movie.titleAr || "",
      titleEn: movie.titleEn || "",
      type: movie.type || "movie",
      rating: movie.rating || 8.0,
      year: movie.year || new Date().getFullYear(),
      duration: movie.duration || "",
      ageRating: (movie as any).ageRating || "",
      genres: Array.isArray(movie.genres) ? movie.genres : [],
      poster: movie.poster || "",
      backdrop: movie.backdrop || "",
      storyAr: movie.storyAr || "",
      storyEn: movie.storyEn || "",
      actors: Array.isArray(movie.actors) ? movie.actors : [],
      director: movie.director || "",
      writer: movie.writer || "",
      directorPhotoUrl: movie.directorPhotoUrl || "",
      writerPhotoUrl: movie.writerPhotoUrl || "",
      castMembers: movie.castMembers || [],
      quality: movie.quality || "Full HD",
      servers: movie.servers && movie.servers.length > 0 ? movie.servers : [{ name: "سيرفر رئيسي 1080p", url: "" }],
      subtitlesUrlAr: (movie as any).subtitlesUrlAr || "",
      subtitlesUrlEn: (movie as any).subtitlesUrlEn || "",
      originalSubtitlesUrlAr: (movie as any).originalSubtitlesUrlAr || "",
      originalSubtitlesUrlEn: (movie as any).originalSubtitlesUrlEn || "",
      trailerUrl: movie.trailerUrl || "",
      seasons: movie.seasons || [],
      language: movie.language || "en",
      country: movie.country || "",
      collectionId: movie.collectionId || "",
      collectionNameAr: movie.collectionNameAr || "",
      collectionNameEn: movie.collectionNameEn || "",
      partNumber: movie.partNumber !== undefined ? String(movie.partNumber) : "",
      logoUrl: movie.logoUrl || movie.titleLogo || "",
      isPublished: movie.isPublished !== false
    });
    setActiveFormSeasonIndex(0);
    setExpandedEpisodeIndex(0);
    setActiveTab("form");
  };

  const resetMovieForm = () => {
    setEditingMovieId(null);
    setFormData({
      titleAr: "",
      titleEn: "",
      type: "movie",
      rating: 8.0,
      year: new Date().getFullYear(),
      duration: "",
      ageRating: "",
      genres: [] as string[],
      poster: "",
      backdrop: "",
      storyAr: "",
      storyEn: "",
      actors: [] as string[],
      director: "",
      writer: "",
      directorPhotoUrl: "",
      writerPhotoUrl: "",
      castMembers: [] as CastMember[],
      quality: "Full HD",
      servers: [{ name: "سيرفر رئيسي 1080p", url: "" }],
      subtitlesUrlAr: "",
      subtitlesUrlEn: "",
      originalSubtitlesUrlAr: "",
      originalSubtitlesUrlEn: "",
      trailerUrl: "",
      seasons: [] as Season[],
      language: "en",
      country: "",
      collectionId: "",
      collectionNameAr: "",
      collectionNameEn: "",
      partNumber: "",
      logoUrl: "",
      isPublished: true
    });
    setActiveFormSeasonIndex(0);
    setExpandedEpisodeIndex(0);
  };

  // Add Server Row to Form
  const addServerRow = () => {
    const serverDefaultName = formData.type === "series" 
      ? `الحلقة ${formData.servers.length + 1} HD` 
      : `سيرفر ${formData.servers.length + 1} HD`;
    setFormData({
      ...formData,
      servers: [...formData.servers, { name: serverDefaultName, url: "" }]
    });
  };

  const updateServerRow = (index: number, key: "name" | "url", value: string) => {
    const newServers = [...formData.servers];
    newServers[index] = { ...newServers[index], [key]: value };
    setFormData({ ...formData, servers: newServers });
  };

  const removeServerRow = (index: number) => {
    if (formData.servers.length === 1) return;
    const newServers = formData.servers.filter((_, i) => i !== index);
    setFormData({ ...formData, servers: newServers });
  };

  // Seasons & Episodes Helpers
  const handleImportSeasonForForm = async (seasonIdx?: number) => {
    const title = formData.titleEn || formData.titleAr;
    if (!title.trim()) {
      showToast(lang === "ar" ? "يرجى إدخال عنوان المسلسل أولاً" : "Please enter series title first", false);
      return;
    }

    const currentSeasons = formData.seasons || [];
    let seasonNumberToFetch = 1;
    if (seasonIdx !== undefined && currentSeasons[seasonIdx]) {
      seasonNumberToFetch = currentSeasons[seasonIdx].number || (seasonIdx + 1);
    } else {
      seasonNumberToFetch = currentSeasons.length + 1;
    }

    setIsImportingSeason(true);
    try {
      const res = await fetch(getApiUrl("/api/admin/import-season"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesTitle: title,
          seasonNumber: seasonNumberToFetch,
          url: importUrl.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to import season");
      }

      const importedSeason: Season = data.season;
      const updatedSeasons = [...currentSeasons];

      if (seasonIdx !== undefined && updatedSeasons[seasonIdx]) {
        updatedSeasons[seasonIdx] = {
          ...updatedSeasons[seasonIdx],
          ...importedSeason,
          id: updatedSeasons[seasonIdx].id || importedSeason.id,
          number: seasonNumberToFetch
        };
      } else {
        updatedSeasons.push(importedSeason);
        setActiveFormSeasonIndex(updatedSeasons.length - 1);
      }

      setFormData(prev => ({
        ...prev,
        titleAr: prev.titleAr || data.seriesTitleAr || "",
        titleEn: prev.titleEn || data.seriesTitleEn || "",
        seasons: updatedSeasons
      }));

      showToast(
        lang === "ar" 
          ? `تم استيراد بوسترات ومعلومات وحلقات الموسم ${seasonNumberToFetch} بنجاح!` 
          : `Imported posters, metadata and episodes for Season ${seasonNumberToFetch} successfully!`, 
        true
      );
    } catch (err: any) {
      showToast(err.message || "Failed to import season details", false);
    } finally {
      setIsImportingSeason(false);
    }
  };

  const addSeasonToForm = () => {
    const nextNum = (formData.seasons || []).length + 1;
    const newSeason: Season = {
      id: `s${Date.now()}`,
      number: nextNum,
      titleAr: `الموسم ${nextNum}`,
      titleEn: `Season ${nextNum}`,
      episodes: []
    };
    setFormData(prev => ({
      ...prev,
      seasons: [...(prev.seasons || []), newSeason]
    }));
    setActiveFormSeasonIndex((formData.seasons || []).length);
  };

  const updateSeasonField = (seasonIdx: number, field: keyof Season, value: any) => {
    const updatedSeasons = [...(formData.seasons || [])];
    if (!updatedSeasons[seasonIdx]) return;
    updatedSeasons[seasonIdx] = {
      ...updatedSeasons[seasonIdx],
      [field]: value
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
  };

  const removeSeasonFromForm = (seasonIdx: number) => {
    if (!confirm(lang === "ar" ? "هل أنت متأكد من حذف هذا الموسم بكل حلقاته؟" : "Are you sure you want to delete this season and all its episodes?")) return;
    const updated = (formData.seasons || []).filter((_, idx) => idx !== seasonIdx)
      .map((s, idx) => ({ ...s, number: idx + 1 })); // renumber
    setFormData(prev => ({
      ...prev,
      seasons: updated
    }));
    setActiveFormSeasonIndex(Math.max(0, seasonIdx - 1));
  };

  const addEpisodeToForm = (seasonIdx: number) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const nextNum = (season.episodes || []).length + 1;
    const newEpisode: Episode = {
      id: `ep_${Date.now()}`,
      number: nextNum,
      titleAr: `الحلقة ${nextNum}`,
      titleEn: `Episode ${nextNum}`,
      duration: "45m",
      storyAr: "",
      storyEn: "",
      thumbnail: formData.backdrop || formData.poster || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=480&q=80",
      servers: [{ name: "سيرفر البث الرئيسي", url: "" }],
      subtitlesUrlAr: "",
      subtitlesUrlEn: "",
      rating: 8.0
    };
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: [...(season.episodes || []), newEpisode]
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
    setExpandedEpisodeIndex((season.episodes || []).length);
  };

  const removeEpisodeFromForm = (seasonIdx: number, episodeIdx: number) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const updatedEpisodes = (season.episodes || []).filter((_, idx) => idx !== episodeIdx)
      .map((e, idx) => ({ ...e, number: idx + 1 })); // renumber
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: updatedEpisodes
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
    setExpandedEpisodeIndex(null);
  };

  const updateEpisodeField = (seasonIdx: number, episodeIdx: number, field: keyof Episode, value: any) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const updatedEpisodes = [...(season.episodes || [])];
    updatedEpisodes[episodeIdx] = {
      ...updatedEpisodes[episodeIdx],
      [field]: value
    };
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: updatedEpisodes
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
  };

  const updateEpisodeServerField = (seasonIdx: number, episodeIdx: number, serverIdx: number, field: "name" | "url", value: string) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const updatedEpisodes = [...(season.episodes || [])];
    const episode = updatedEpisodes[episodeIdx];
    const updatedServers = [...(episode.servers || [])];
    updatedServers[serverIdx] = {
      ...updatedServers[serverIdx],
      [field]: value
    };
    updatedEpisodes[episodeIdx] = {
      ...episode,
      servers: updatedServers
    };
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: updatedEpisodes
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
  };

  const addEpisodeServerRow = (seasonIdx: number, episodeIdx: number) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const updatedEpisodes = [...(season.episodes || [])];
    const episode = updatedEpisodes[episodeIdx];
    const updatedServers = [...(episode.servers || []), { name: `سيرفر بديل ${episode.servers.length + 1}`, url: "" }];
    updatedEpisodes[episodeIdx] = {
      ...episode,
      servers: updatedServers
    };
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: updatedEpisodes
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
  };

  const removeEpisodeServerRow = (seasonIdx: number, episodeIdx: number, serverIdx: number) => {
    const season = (formData.seasons || [])[seasonIdx];
    if (!season) return;
    const updatedEpisodes = [...(season.episodes || [])];
    const episode = updatedEpisodes[episodeIdx];
    if (episode.servers.length <= 1) return;
    const updatedServers = episode.servers.filter((_, idx) => idx !== serverIdx);
    updatedEpisodes[episodeIdx] = {
      ...episode,
      servers: updatedServers
    };
    const updatedSeasons = [...(formData.seasons || [])];
    updatedSeasons[seasonIdx] = {
      ...season,
      episodes: updatedEpisodes
    };
    setFormData(prev => ({
      ...prev,
      seasons: updatedSeasons
    }));
  };

  const handleEpisodeSubtitleUpload = async (e: React.ChangeEvent<HTMLInputElement>, seasonIdx: number, episodeIdx: number, langKey: "ar" | "en") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const fileContent = event.target?.result as string;
      if (!fileContent) return;

      try {
        const response = await fetch(getApiUrl("/api/admin/upload-subtitle"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, fileContent }),
        });

        if (response.ok) {
          const data = await response.json();
          updateEpisodeField(seasonIdx, episodeIdx, langKey === "ar" ? "subtitlesUrlAr" : "subtitlesUrlEn", data.url);
          showToast(lang === "ar" ? "تم رفع ملف الترجمة للحلقة بنجاح!" : "Episode subtitle uploaded successfully!", true);
        } else {
          const errData = await response.json();
          showToast(errData.error || (lang === "ar" ? "فشل الرفع" : "Upload failed"), false);
        }
      } catch (err: any) {
        showToast(err.message || "Upload error", false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Toggle Genre Checked
  const toggleFormGenre = (genreAr: string) => {
    let nextGenres = [...formData.genres];
    if (nextGenres.includes(genreAr)) {
      nextGenres = nextGenres.filter(g => g !== genreAr);
    } else {
      nextGenres.push(genreAr);
    }
    setFormData({ ...formData, genres: nextGenres });
  };

  // Manage Promos Slider Handlers
  const handleAddOrEditPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoFormData.titleAr || !promoFormData.titleEn || !promoFormData.image) {
      showToast(lang === "ar" ? "الرجاء تعبئة العناوين وصورة العرض" : "Please fill title and image URL", false);
      return;
    }

    let nextPromos = [...customPromos];
    const isEditing = !!promoFormData.id;

    if (isEditing) {
      nextPromos = nextPromos.map(p => p.id === promoFormData.id ? promoFormData : p);
    } else {
      const newPromo = {
        ...promoFormData,
        id: "promo_" + Date.now()
      };
      nextPromos.push(newPromo);
    }

    try {
      const res = await fetch(getApiUrl("/api/admin/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPromos: nextPromos })
      });
      if (res.ok) {
        setCustomPromos(nextPromos);
        showToast(isEditing ? (lang === "ar" ? "تم تعديل السلايدر!" : "Promo edited!") : (lang === "ar" ? "تم إضافة السلايدر!" : "Promo added!"));
        resetPromoForm();
        if (onRefreshData) onRefreshData();
      }
    } catch (err) {
      showToast("Error updating promos", false);
    }
  };

  const handleDeletePromo = (promoId: string) => {
    const promo = customPromos.find(p => p.id === promoId);
    const name = promo ? (lang === "ar" ? promo.titleAr : promo.titleEn) : promoId;
    setDeleteConfirmState({
      show: true,
      type: "promo",
      id: promoId,
      name
    });
    setConfirmModalFocus("cancel");
  };

  const executeDeletePromo = async (promoId: string) => {
    const nextPromos = customPromos.filter(p => p.id !== promoId);
    try {
      const res = await fetch(getApiUrl("/api/admin/config"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPromos: nextPromos })
      });
      if (res.ok) {
        setCustomPromos(nextPromos);
        showToast(lang === "ar" ? "تم الحذف بنجاح" : "Deleted successfully");
        if (onRefreshData) onRefreshData();
      }
    } catch (err) {
      showToast("Error deleting promo", false);
    } finally {
      setDeleteConfirmState({ show: false, type: "promo", id: "", name: "" });
    }
  };

  const handleEditPromoClick = (promo: any) => {
    setPromoFormData(promo);
    setShowPromoForm(true);
  };

  const resetPromoForm = () => {
    setShowPromoForm(false);
    setPromoFormData({
      id: "",
      titleAr: "",
      titleEn: "",
      tagAr: "",
      tagEn: "",
      descriptionAr: "",
      descriptionEn: "",
      image: "",
      actionType: "search",
      actionValue: ""
    });
  };

  const pendingCount = movies.filter(m => m.isPublished === false).length;
  const publishedCount = movies.filter(m => m.isPublished !== false).length;

  // Filter movies by publish tab and search term
  const filteredMovies = movies.filter(m => {
    if (publishFilter === "pending" && m.isPublished !== false) return false;
    if (publishFilter === "published" && m.isPublished === false) return false;

    const term = searchTerm.toLowerCase();
    return (
      m.titleAr.toLowerCase().includes(term) ||
      m.titleEn.toLowerCase().includes(term) ||
      m.genres.some(g => g.toLowerCase().includes(term))
    );
  });

  return (
    <div className="w-full h-full flex flex-col bg-neutral-950/60 rounded-3xl border border-neutral-900/80 overflow-hidden shadow-2xl relative select-text">
      
      {/* Dynamic Status / Toast Messages */}
      {successMessage && (
        <div className="absolute top-4 left-4 right-4 bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 px-4 py-3.5 rounded-xl flex items-center gap-2 z-50 shadow-xl animate-bounce">
          <Check className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-4 right-4 bg-rose-950/90 border border-rose-500/50 text-rose-300 px-4 py-3.5 rounded-xl flex items-center gap-2 z-50 shadow-xl">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span className="text-xs font-bold">{error}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-900 bg-neutral-900/40 shrink-0">
        <div className="flex items-center gap-2.5">
          <Sliders className="w-5.5 h-5.5 text-zinc-300" />
          <div>
            <h1 className="text-base md:text-lg font-black text-white">
              {lang === "ar" ? "لوحة تحكم المدير" : "Admin Management Console"}
            </h1>
            <p className="text-[10px] text-zinc-500">
              {lang === "ar" 
                ? "إدارة المحتوى، البنر والترويج، رفع الأفلام والمسلسلات وتعديل البث" 
                : "Manage movies, banner configuration, slider promos & links"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onLogout && (
            <button 
              onClick={onLogout}
              data-admin-focused={adminFocusArea === "header" && headerFocusIndex === 0 ? "true" : "false"}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                adminFocusArea === "header" && headerFocusIndex === 0
                  ? "bg-red-600 text-white border-white ring-2 ring-red-500 scale-105"
                  : "bg-red-950/40 hover:bg-red-900/50 text-red-400 hover:text-red-300 border-red-900/30"
              }`}
            >
              {lang === "ar" ? "تسجيل الخروج" : "Logout"}
            </button>
          )}
          {onClose && (
            <button 
              onClick={onClose}
              data-admin-focused={adminFocusArea === "header" && headerFocusIndex === 1 ? "true" : "false"}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                adminFocusArea === "header" && headerFocusIndex === 1
                  ? "bg-white text-black border-white ring-2 ring-white/50 scale-105"
                  : "bg-neutral-900 hover:bg-neutral-800 text-zinc-400 hover:text-white border-transparent"
              }`}
            >
              {lang === "ar" ? "العودة للتطبيق" : "Back to App"}
            </button>
          )}
        </div>
      </div>

      {/* Tab Selector Nav */}
      <div className="flex items-center gap-1 border-b border-neutral-900/50 bg-neutral-950 px-4 py-2 shrink-0">
        <button
          onClick={() => { setActiveTab("list"); resetMovieForm(); }}
          data-admin-focused={adminFocusArea === "tabs" && adminFocusedTabIndex === 0 ? "true" : "false"}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
            adminFocusArea === "tabs" && adminFocusedTabIndex === 0 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
          } ${
            activeTab === "list" 
              ? "bg-white text-black font-extrabold shadow-md shadow-white/5" 
              : "text-zinc-400 hover:text-white hover:bg-neutral-900"
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>{lang === "ar" ? "الأعمال المعروضة" : "All Movies & Series"}</span>
          <span className="text-[10px] bg-neutral-800 text-zinc-400 px-1.5 py-0.5 rounded-full">
            {movies.length}
          </span>
        </button>

        <button
          onClick={() => { resetMovieForm(); setActiveTab("form"); }}
          data-admin-focused={adminFocusArea === "tabs" && adminFocusedTabIndex === 1 ? "true" : "false"}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
            adminFocusArea === "tabs" && adminFocusedTabIndex === 1 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
          } ${
            activeTab === "form" && !editingMovieId
              ? "bg-white text-black font-extrabold shadow-md" 
              : "text-zinc-400 hover:text-white hover:bg-neutral-900"
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{lang === "ar" ? "رفع فيلم أو مسلسل" : "Upload New Video"}</span>
        </button>

        <button
          onClick={() => setActiveTab("banner")}
          data-admin-focused={adminFocusArea === "tabs" && adminFocusedTabIndex === 2 ? "true" : "false"}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
            adminFocusArea === "tabs" && adminFocusedTabIndex === 2 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
          } ${
            activeTab === "banner" 
              ? "bg-white text-black font-extrabold shadow-md" 
              : "text-zinc-400 hover:text-white hover:bg-neutral-900"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{lang === "ar" ? "البانر والسلايدر الترويجي" : "Banner & Promos"}</span>
        </button>

        <button
          onClick={() => setActiveTab("admins")}
          data-admin-focused={adminFocusArea === "tabs" && adminFocusedTabIndex === 3 ? "true" : "false"}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
            adminFocusArea === "tabs" && adminFocusedTabIndex === 3 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
          } ${
            activeTab === "admins" 
              ? "bg-white text-black font-extrabold shadow-md" 
              : "text-zinc-400 hover:text-white hover:bg-neutral-900"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>{lang === "ar" ? "إدارة المشرفين" : "Manage Admins"}</span>
        </button>

        <button
          onClick={() => setActiveTab("ads")}
          data-admin-focused={adminFocusArea === "tabs" && adminFocusedTabIndex === 4 ? "true" : "false"}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
            adminFocusArea === "tabs" && adminFocusedTabIndex === 4 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
          } ${
            activeTab === "ads" 
              ? "bg-white text-black font-extrabold shadow-md" 
              : "text-zinc-400 hover:text-white hover:bg-neutral-900"
          }`}
        >
          <Radio className="w-3.5 h-3.5 text-amber-400" />
          <span>{lang === "ar" ? "إدارة الإعلانات والسيرفرات" : "Ads & Pre-Roll Servers"}</span>
          <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full border border-amber-500/30 font-bold">
            {adsSettings?.ads?.length || 0}
          </span>
        </button>

        <button
          onClick={fetchAdminData}
          className="p-2 rounded-xl hover:bg-neutral-900 text-zinc-500 hover:text-white transition-all cursor-pointer mr-auto"
          title={lang === "ar" ? "تحديث البيانات" : "Refresh Data"}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main Container Scrollable */}
      <div className="flex-1 overflow-y-auto p-5 no-scrollbar min-h-0 bg-neutral-950/45">
        {isLoading && movies.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="w-8 h-8 text-white animate-spin" />
            <span className="text-xs text-zinc-500 font-bold">
              {lang === "ar" ? "جاري الاتصال بقاعدة البيانات..." : "Connecting to persistent storage..."}
            </span>
          </div>
        ) : (
          <>
            {/* TAB 1: ALL ITEMS LIST */}
            {activeTab === "list" && (
              <div className="space-y-4">
                {/* Search Bar & Sub-Tabs Row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div 
                    data-admin-focused={adminFocusArea === "list" && focusedListElement === 0 ? "true" : "false"}
                    className={`flex items-center gap-2 w-full md:max-w-xs bg-neutral-900 border rounded-xl px-3 py-2 transition-all ${
                      adminFocusArea === "list" && (isSearchFocused || focusedListElement === 0) ? "border-red-600 ring-2 ring-red-600/50 scale-[1.02]" : "border-neutral-800"
                    }`}
                  >
                    <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={lang === "ar" ? "ابحث بالاسم أو التصنيف..." : "Search by title, genre..."}
                      className="bg-transparent border-none text-xs text-white focus:outline-none w-full"
                    />
                    {searchTerm && (
                      <button onClick={() => setSearchTerm("")} className="text-zinc-500 hover:text-white cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Publish Status Sub-Tabs */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPublishFilter("pending")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                        publishFilter === "pending"
                          ? "bg-amber-500 text-black border-amber-400 font-extrabold shadow-md shadow-amber-500/20 scale-[1.02]"
                          : "bg-neutral-900 text-amber-400/80 border-amber-500/30 hover:bg-neutral-850 hover:text-amber-300"
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                      <span>{lang === "ar" ? "بانتظار المراجعة" : "Pending Review"}</span>
                      <span className="bg-black/30 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                        {pendingCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPublishFilter("published")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                        publishFilter === "published"
                          ? "bg-emerald-500 text-black border-emerald-400 font-extrabold shadow-md shadow-emerald-500/20 scale-[1.02]"
                          : "bg-neutral-900 text-emerald-400/80 border-emerald-500/30 hover:bg-neutral-850 hover:text-emerald-300"
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{lang === "ar" ? "الأعمال المنشورة" : "Published"}</span>
                      <span className="bg-black/30 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                        {publishedCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPublishFilter("all")}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                        publishFilter === "all"
                          ? "bg-white text-black border-white font-extrabold shadow-md scale-[1.02]"
                          : "bg-neutral-900 text-zinc-400 border-neutral-800 hover:bg-neutral-850 hover:text-white"
                      }`}
                    >
                      <Film className="w-3.5 h-3.5 shrink-0" />
                      <span>{lang === "ar" ? "الكل" : "All"}</span>
                      <span className="bg-black/30 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                        {movies.length}
                      </span>
                    </button>

                    {pendingCount > 0 && (
                      <button
                        type="button"
                        onClick={handlePublishAllPending}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/50 flex items-center gap-1.5 cursor-pointer border border-emerald-400/30 transition-all hover:scale-[1.03]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{lang === "ar" ? `نشر جميع المعلقة (${pendingCount})` : `Publish All Pending (${pendingCount})`}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={handleTriggerBatchImport}
                      disabled={isBatchImporting}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-black bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white shadow-lg shadow-red-950/50 flex items-center gap-1.5 cursor-pointer border border-red-400/30 transition-all hover:scale-[1.03] ${
                        isBatchImporting ? "opacity-75 pointer-events-none" : ""
                      }`}
                    >
                      {isBatchImporting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-amber-300" />
                          <span>{lang === "ar" ? "جاري استيراد 15 عمل..." : "Importing 15 items..."}</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                          <span>{lang === "ar" ? "استيراد 15 عمل جديد (غير منشور)" : "Import 15 Items (Pending)"}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Grid of movies */}
                {filteredMovies.length === 0 ? (
                  <div className="bg-neutral-900/30 border border-neutral-900 rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs">
                    <Film className="w-8 h-8 text-zinc-600" />
                    <span>
                      {publishFilter === "pending"
                        ? (lang === "ar" ? "لا توجد أعمال معلقة بانتظار المراجعة حالياً." : "No pending works awaiting review.")
                        : publishFilter === "published"
                        ? (lang === "ar" ? "لا توجد أعمال منشورة مطابقة لبحثك." : "No published works match your search.")
                        : (lang === "ar" ? "لا توجد نتائج مطابقة لبحثك." : "No matching items found.")}
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredMovies.map((movie, idx) => {
                      const isHero = customHeroId === movie.id;
                      const isTrending = customTrendingIds.includes(movie.id);
                      const isCardFocused = adminFocusArea === "list" && focusedListElement === 1 && focusedMovieIndex === idx;
                      
                      return (
                        <div 
                          key={movie.id} 
                          data-admin-focused={isCardFocused ? "true" : "false"}
                          className={`bg-neutral-900/60 border rounded-2xl p-4 flex gap-3 transition-all relative group shadow-lg ${
                            isCardFocused
                              ? "border-red-600 bg-neutral-900 ring-2 ring-red-600/30 scale-[1.02]"
                              : movie.isPublished === false
                              ? "border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50"
                              : "border-neutral-850 hover:border-neutral-700"
                          }`}
                        >
                          {/* Poster thumbnail */}
                          <div className="w-16 h-24 rounded-lg overflow-hidden shrink-0 bg-neutral-950 border border-neutral-800 relative">
                            <img 
                              src={movie.poster || "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=200&q=80"} 
                              alt={movie.titleEn}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                e.currentTarget.src = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=200&q=80";
                              }}
                            />
                            <div className="absolute top-1 left-1 bg-neutral-950/80 px-1 py-0.5 rounded text-[8px] font-black text-white font-mono">
                              ★ {movie.rating.toFixed(1)}
                            </div>
                          </div>

                          {/* Meta details */}
                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                <span className={`text-[8px] px-1.5 py-0.5 rounded font-black font-mono uppercase tracking-wide inline-block ${
                                  movie.type === "series" ? "bg-amber-500/10 text-amber-400 border border-amber-500/35" : "bg-sky-500/10 text-sky-400 border border-sky-500/35"
                                }`}>
                                  {movie.type === "series" ? (lang === "ar" ? "مسلسل" : "Series") : (lang === "ar" ? "فيلم" : "Movie")}
                                </span>

                                {movie.isPublished === false ? (
                                  <span className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[8px] font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 animate-pulse">
                                    <Clock className="w-2.5 h-2.5 shrink-0 text-amber-400" />
                                    {lang === "ar" ? "بانتظار المراجعة" : "Pending Review"}
                                  </span>
                                ) : (
                                  <span className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[8px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                                    {lang === "ar" ? "منشور" : "Published"}
                                  </span>
                                )}
                              </div>

                              <h3 className="text-xs font-bold text-white truncate block">
                                {lang === "ar" ? movie.titleAr : movie.titleEn}
                              </h3>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {movie.year} • {formatMovieDuration(movie.duration)}
                              </span>
                            </div>

                            {/* Active badges */}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {isHero && (
                                <span className="bg-red-500/10 text-red-400 border border-red-500/30 text-[8px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Sparkles className="w-2.5 h-2.5 shrink-0" />
                                  {lang === "ar" ? "البانر النشط" : "Hero Banner"}
                                </span>
                              )}
                              {isTrending && (
                                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[8px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Star className="w-2.5 h-2.5 shrink-0" />
                                  {lang === "ar" ? "رائج حالياً" : "Trending"}
                                </span>
                              )}
                            </div>

                            {/* Quick Management Actions Grid */}
                            <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-neutral-850 flex-wrap">
                              <button
                                onClick={() => handleTogglePublish(movie.id, movie.isPublished !== false)}
                                className={`px-2 py-1 text-[9px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1 border ${
                                  movie.isPublished === false
                                    ? "bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-950/40"
                                    : "bg-neutral-850 hover:bg-neutral-800 text-zinc-400 hover:text-zinc-200 border-neutral-750"
                                }`}
                                title={movie.isPublished === false ? (lang === "ar" ? "الموافقة ونشر العمل الفني" : "Approve & Publish") : (lang === "ar" ? "إلغاء النشر وتحويل للمراجعة" : "Unpublish")}
                              >
                                {movie.isPublished === false ? (
                                  <>
                                    <CheckCircle2 className="w-2.5 h-2.5 shrink-0 text-white" />
                                    <span>{lang === "ar" ? "نشر الآن" : "Publish"}</span>
                                  </>
                                ) : (
                                  <>
                                    <EyeOff className="w-2.5 h-2.5 shrink-0 text-zinc-400" />
                                    <span>{lang === "ar" ? "إلغاء النشر" : "Unpublish"}</span>
                                  </>
                                )}
                              </button>

                              <button
                                onClick={() => handleEditMovieClick(movie)}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                  isCardFocused && focusedMovieBtnIndex === 0
                                    ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                    : "bg-neutral-850 hover:bg-neutral-800 text-zinc-400 hover:text-white"
                                }`}
                                title={lang === "ar" ? "تعديل العمل الفني" : "Edit Details"}
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>

                              <button
                                onClick={() => handleDeleteMovie(movie.id, lang === "ar" ? movie.titleAr : movie.titleEn)}
                                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                  isCardFocused && focusedMovieBtnIndex === 1
                                    ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                    : "bg-red-950/20 hover:bg-red-900/30 text-rose-400"
                                }`}
                                title={lang === "ar" ? "حذف بالكامل" : "Delete Video"}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>

                              <button
                                onClick={() => handleSetHero(movie.id)}
                                className={`px-2 py-1 text-[9px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-0.5 ${
                                  isCardFocused && focusedMovieBtnIndex === 2
                                    ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                    : isHero 
                                      ? "bg-red-600 text-white" 
                                      : "bg-neutral-850 hover:bg-neutral-800 text-zinc-300 hover:text-white"
                                }`}
                                title={lang === "ar" ? "تثبيت كبنر رئيسي للموقع" : "Set as main hero banner"}
                              >
                                <Sparkles className="w-2.5 h-2.5 shrink-0" />
                                <span>{lang === "ar" ? "البانر" : "Banner"}</span>
                              </button>

                              <button
                                onClick={() => handleToggleTrending(movie.id)}
                                className={`px-2 py-1 text-[9px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-0.5 ${
                                  isCardFocused && focusedMovieBtnIndex === 3
                                    ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                    : isTrending 
                                      ? "bg-emerald-600 text-white" 
                                      : "bg-neutral-850 hover:bg-neutral-800 text-zinc-300 hover:text-white"
                                }`}
                                title={lang === "ar" ? "إضافة/إزالة من الرائجة" : "Add or remove from trending shelf"}
                              >
                                <Star className="w-2.5 h-2.5 shrink-0" />
                                <span>{lang === "ar" ? "رائج" : "Trend"}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: MOVIE & SERIES FORM (UPLOAD & EDIT) */}
            {activeTab === "form" && (
              <form onSubmit={handleMovieFormSubmit} className="max-w-4xl bg-neutral-900/30 border border-neutral-900 rounded-3xl p-6 space-y-6">
                <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
                  <div className="flex items-center gap-1.5">
                    {editingMovieId ? <Edit2 className="w-4 h-4 text-amber-400" /> : <Upload className="w-4 h-4 text-emerald-400" />}
                    <h2 className="text-sm font-bold text-white">
                      {editingMovieId 
                        ? (lang === "ar" ? `تعديل تفاصيل العمل الفني: ${formData.titleAr}` : `Edit details for: ${formData.titleEn}`)
                        : (lang === "ar" ? "رفع عمل فني جديد بجودة 4K" : "Upload and Host New Movie / Series")}
                    </h2>
                  </div>
                  {editingMovieId && (
                    <button
                      type="button"
                      onClick={resetMovieForm}
                      className="text-xs text-rose-400 hover:text-rose-300 bg-neutral-900 hover:bg-neutral-850 px-2 py-1 rounded-lg cursor-pointer"
                    >
                      {lang === "ar" ? "إلغاء التعديل والعودة" : "Cancel Edit"}
                    </button>
                  )}
                </div>

                {/* Quick Link Importer */}
                <div className="bg-neutral-950/60 border border-neutral-900 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-1">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-red-500 animate-pulse" />
                      {lang === "ar" ? "الاستيراد التلقائي الذكي بالذكاء الاصطناعي" : "Smart AI Automated Importer"}
                    </span>
                    <span className="text-[10px] text-zinc-500 font-medium">
                      {lang === "ar" ? "اكتب اسم الفيلم/المسلسل أو ضع رابط IMDb أو سينمانا لتعبئة البيانات تلقائياً" : "Type movie/show name or paste IMDb/Cinemana link to auto-fill details"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      data-admin-focused={adminFocusArea === "list" && focusedListElement === -3 ? "true" : "false"}
                      placeholder={lang === "ar" ? "اكتب اسم الفيلم/المسلسل (مثال: Interstellar) أو ضع الرابط هنا..." : "Type movie/series name (e.g., Oppenheimer) or paste link here..."}
                      className={`flex-1 bg-neutral-900/60 border rounded-xl px-3.5 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none transition-all ${
                        adminFocusArea === "list" && focusedListElement === -3 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.02]" : "border-neutral-800"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={handleImportUrl}
                      disabled={isImporting || isSyncing}
                      data-admin-focused={adminFocusArea === "list" && focusedListElement === -2 ? "true" : "false"}
                      className={`px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:from-zinc-800 disabled:to-zinc-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg active:scale-95 cursor-pointer ${
                        adminFocusArea === "list" && focusedListElement === -2 ? "ring-2 ring-white scale-105" : ""
                      }`}
                    >
                      {isImporting ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>{lang === "ar" ? "جاري الاستيراد..." : "Importing..."}</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>{lang === "ar" ? "استيراد" : "Import"}</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleSyncCinemana}
                      disabled={isImporting || isSyncing || isBatchImporting}
                      data-admin-focused={adminFocusArea === "list" && focusedListElement === -1 ? "true" : "false"}
                      className={`px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:from-zinc-800 disabled:to-zinc-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg active:scale-95 cursor-pointer ${
                        adminFocusArea === "list" && focusedListElement === -1 ? "ring-2 ring-white scale-105" : ""
                      }`}
                    >
                      {isSyncing ? (
                        <>
                          <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>{lang === "ar" ? "جاري المزامنة..." : "Syncing..."}</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{lang === "ar" ? "مزامنة سينمانا" : "Sync Cinemana"}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleTriggerBatchImport}
                      disabled={isBatchImporting || isImporting || isSyncing}
                      className="px-4 py-2 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:from-zinc-800 disabled:to-zinc-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg active:scale-95 cursor-pointer shrink-0"
                    >
                      {isBatchImporting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{lang === "ar" ? "جاري الاستيراد..." : "Importing..."}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                          <span>{lang === "ar" ? "استيراد 15 عمل جديدة (غير منشور)" : "Import 15 Pending Works"}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Cinemana Stream & Subtitle Instructions Tip Box */}
                  <div className="bg-red-950/15 border border-red-950/40 rounded-xl p-3 text-[11px] text-zinc-300 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-red-400">
                      <span className="flex h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
                      <span>
                        {lang === "ar" ? "💡 تنبيه هام بخصوص سيرفر التشغيل والترجمة من سينمانا:" : "💡 Important Note on Cinemana Streams & Subtitles:"}
                      </span>
                    </div>
                    <p className="leading-relaxed">
                      {lang === "ar" ? (
                        <>
                          بسبب نظام الحماية والتشفير في سينمانا، روابط الفيديو والترجمات تتغير وتتطلب جلسة مستخدم نشطة. الذكاء الاصطناعي سيقوم بتعبئة كافة تفاصيل الفيلم والبوسترات والقصة بدقة عالية جداً، ولكن <span className="text-red-400 font-bold">لإضافة البث الفعلي:</span> قم بفتح الفيلم في سينمانا على متصفحك وابدأ تشغيله، ثم اضغط على مشغل الفيديو بالزر الأيمن أو (لمس مطول للهاتف) واختر <span className="text-white font-bold">"نسخ رابط الفيديو" (Copy Video URL)</span> ورابط الترجمة، ثم ألصقها يدوياً بالأسفل في قسم السيرفرات والترجمات.
                        </>
                      ) : (
                        <>
                          Due to Cinemana's protection mechanisms, direct video streaming URLs and subtitle files change dynamically and require an active user session. While the AI will instantly retrieve the entire metadata, high-res posters, and synopses, <span className="text-red-400 font-bold">to provide the stream itself:</span> play the content on Cinemana, right-click the video player (or long-press on mobile), click <span className="text-white font-bold">"Copy Video Address"</span>, and paste it manually into the stream servers and subtitle fields below.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* Input Fields Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Arabic Title */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "العنوان بالعربية *" : "Arabic Title *"}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.titleAr}
                      onChange={(e) => setFormData({ ...formData, titleAr: e.target.value })}
                      placeholder={lang === "ar" ? "مثال: ولاد رزق 3" : "e.g. Welad Rizk 3"}
                      className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                        adminFocusArea === "form" && focusedFormFieldIndex === 0 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                      }`}
                    />
                  </div>

                  {/* English Title */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "العنوان بالإنجليزية *" : "English Title *"}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.titleEn}
                      onChange={(e) => setFormData({ ...formData, titleEn: e.target.value })}
                      placeholder={lang === "ar" ? "مثال: Dune Part Two" : "e.g. Dune Part Two"}
                      className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                        adminFocusArea === "form" && focusedFormFieldIndex === 1 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                      }`}
                    />
                  </div>

                  {/* Work Type */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "نوع العمل الفني" : "Type"}
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: "movie" })}
                        className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 2 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : ""
                        } ${
                          formData.type === "movie"
                            ? "bg-white text-black border-white"
                            : "bg-neutral-950 text-zinc-400 border-neutral-850 hover:text-white"
                        }`}
                      >
                        <Film className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "فيلم سينمائي" : "Movie"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, type: "series" })}
                        className={`flex-1 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 3 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : ""
                        } ${
                          formData.type === "series"
                            ? "bg-white text-black border-white"
                            : "bg-neutral-950 text-zinc-400 border-neutral-850 hover:text-white"
                        }`}
                      >
                        <Tv className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "مسلسل تلفزيوني" : "TV Series"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Rating & Year */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400 block">
                        {lang === "ar" ? "تقييم العمل (10/)" : "Rating (out of 10)"}
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="10"
                        value={formData.rating}
                        onChange={(e) => setFormData({ ...formData, rating: parseFloat(e.target.value) || 8.0 })}
                        className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 4 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400 block">
                        {lang === "ar" ? "سنة الإنتاج" : "Release Year"}
                      </label>
                      <input
                        type="number"
                        value={formData.year}
                        onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || 2024 })}
                        className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 5 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                    </div>
                  </div>

                  {/* Duration or episodes */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "مدة التشغيل أو الحلقات" : "Duration or Number of Episodes"}
                    </label>
                    <input
                      type="text"
                      value={formData.duration}
                      onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                      placeholder={formData.type === "series" ? (lang === "ar" ? "مثال: 10 حلقات" : "e.g. 10 Episodes") : (lang === "ar" ? "مثال: 2h 15m" : "e.g. 2h 15m")}
                      className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                        adminFocusArea === "form" && focusedFormFieldIndex === 6 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                      }`}
                    />
                  </div>

                  {/* Age Rating / Classification */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "التصنيف العمري للمشاهدة" : "Age Classification / Rating"}
                    </label>
                    <select
                      value={formData.ageRating || ""}
                      onChange={(e) => setFormData({ ...formData, ageRating: e.target.value })}
                      className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all"
                    >
                      <option value="" className="bg-black text-white font-bold">{lang === "ar" ? "اختر التصنيف..." : "Choose rating..."}</option>
                      <option value="G" className="bg-black text-white font-bold">G - {lang === "ar" ? "عام" : "General"}</option>
                      <option value="PG" className="bg-black text-white font-bold">PG - {lang === "ar" ? "بإشراف عائلي" : "Parental Guidance"}</option>
                      <option value="PG-13" className="bg-black text-white font-bold">PG-13 - {lang === "ar" ? "للإرشاد العائلي فوق 13 سنة" : "Parents Strongly Cautioned"}</option>
                      <option value="R" className="bg-black text-white font-bold">R - {lang === "ar" ? "مقيد للبالغين" : "Restricted"}</option>
                      <option value="NC-17" className="bg-black text-white font-bold">NC-17 - {lang === "ar" ? "للبالغين فقط" : "Adults Only"}</option>
                      <option value="TV-Y" className="bg-black text-white font-bold">TV-Y</option>
                      <option value="TV-G" className="bg-black text-white font-bold">TV-G</option>
                      <option value="TV-PG" className="bg-black text-white font-bold">TV-PG</option>
                      <option value="TV-14" className="bg-black text-white font-bold">TV-14</option>
                      <option value="TV-MA" className="bg-black text-white font-bold">TV-MA - {lang === "ar" ? "للجمهور الناضج" : "Mature Audience"}</option>
                      <option value="+18" className="bg-black text-white font-bold">+18 - {lang === "ar" ? "للبالغين فقط" : "For Adults Only"}</option>
                      <option value="+16" className="bg-black text-white font-bold">+16</option>
                      <option value="+12" className="bg-black text-white font-bold">+12</option>
                    </select>
                  </div>

                  {/* Video Quality */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "جودة الفيديو والعرض" : "Video Display Quality"}
                    </label>
                    <select
                      value={formData.quality}
                      onChange={(e) => setFormData({ ...formData, quality: e.target.value })}
                      className={`w-full bg-black border rounded-lg px-3 py-2 text-xs text-white font-bold focus:outline-none transition-all ${
                        adminFocusArea === "form" && focusedFormFieldIndex === 7 ? "border-white ring-2 ring-white scale-[1.01]" : "border-white/20 hover:border-white"
                      }`}
                    >
                      <option value="Ultra HD" className="bg-black text-white font-bold">Ultra HD 4K</option>
                      <option value="Full HD" className="bg-black text-white font-bold">Full HD 1080p</option>
                      <option value="HD Ready" className="bg-black text-white font-bold">HD 720p</option>
                      <option value="SD" className="bg-black text-white font-bold">SD standard</option>
                    </select>
                  </div>

                  {/* Language */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "لغة العمل الفني" : "Artwork Language"}
                    </label>
                    <select
                      value={formData.language}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all"
                    >
                      <option value="ar" className="bg-black text-white font-bold">{lang === "ar" ? "اللغة العربية" : "Arabic"}</option>
                      <option value="en" className="bg-black text-white font-bold">{lang === "ar" ? "اللغة الإنجليزية" : "English"}</option>
                      <option value="other" className="bg-black text-white font-bold">{lang === "ar" ? "لغة أخرى (كوري، ياباني...)" : "Other Language"}</option>
                    </select>
                  </div>

                  {/* Production Country */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "بلد الإنتاج" : "Production Country"}
                    </label>
                    <input
                      type="text"
                      value={formData.country}
                      onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                      placeholder={lang === "ar" ? "مثال: الولايات المتحدة" : "e.g. United States"}
                      className="w-full bg-black border border-white/20 rounded-lg px-3 py-2 text-xs text-white font-bold focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition-all"
                    />
                  </div>

                  {/* Collection / Franchise Info */}
                  <div className="col-span-1 md:col-span-2 p-4 bg-zinc-900/30 border border-zinc-800/40 rounded-2xl space-y-4 my-2">
                    <h3 className="text-xs font-bold text-red-500 flex items-center gap-1.5 border-b border-zinc-800 pb-2">
                      <Film className="w-4 h-4" />
                      <span>{lang === "ar" ? "ربط العمل بسلسلة أفلام (اختياري)" : "Link to Movie Franchise/Series (Optional)"}</span>
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Collection ID */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "معرّف السلسلة (مثل: spiderman أو lotr)" : "Collection/Franchise ID (e.g. spiderman)"}
                        </label>
                        <input
                          type="text"
                          value={formData.collectionId}
                          onChange={(e) => setFormData({ ...formData, collectionId: e.target.value })}
                          placeholder="e.g. spiderman"
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      {/* Part Number */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "رقم الجزء (مثل: 1 أو 2)" : "Part Number (e.g. 1 or 2)"}
                        </label>
                        <input
                          type="number"
                          value={formData.partNumber}
                          onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
                          placeholder="e.g. 1"
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      {/* Collection Name Arabic */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "اسم السلسلة بالعربية" : "Collection Name in Arabic"}
                        </label>
                        <input
                          type="text"
                          value={formData.collectionNameAr}
                          onChange={(e) => setFormData({ ...formData, collectionNameAr: e.target.value })}
                          placeholder={lang === "ar" ? "مثال: سلسلة أفلام سبايدرمان" : "e.g. Spider-Man Franchise"}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>

                      {/* Collection Name English */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "اسم السلسلة بالإنجليزية" : "Collection Name in English"}
                        </label>
                        <input
                          type="text"
                          value={formData.collectionNameEn}
                          onChange={(e) => setFormData({ ...formData, collectionNameEn: e.target.value })}
                          placeholder="e.g. Spider-Man Franchise"
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Poster Image URL */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "رابط بوستر العمل (صورة عمودية)" : "Poster Image URL (vertical)"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.poster}
                        onChange={(e) => setFormData({ ...formData, poster: e.target.value })}
                        placeholder="https://images.unsplash.com/..."
                        className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none font-mono transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 8 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, poster: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80" })}
                        className={`px-2.5 rounded-xl bg-neutral-950 text-zinc-400 hover:text-white border hover:bg-neutral-900 cursor-pointer transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 8 && false ? "border-red-600" : "border-neutral-850"
                        }`}
                        title={lang === "ar" ? "صورة عشوائية ملائمة" : "Set fallback random poster"}
                      >
                        <Image className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Backdrop Image URL */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400 block">
                      {lang === "ar" ? "رابط خلفية العمل (صورة أفقية عريضة)" : "Backdrop Image URL (horizontal)"}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={formData.backdrop}
                        onChange={(e) => setFormData({ ...formData, backdrop: e.target.value })}
                        placeholder="https://images.unsplash.com/..."
                        className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none font-mono transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 9 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, backdrop: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&q=80" })}
                        className={`px-2.5 rounded-xl bg-neutral-950 text-zinc-400 hover:text-white border hover:bg-neutral-900 cursor-pointer transition-all ${
                          adminFocusArea === "form" && focusedFormFieldIndex === 9 && false ? "border-red-600" : "border-neutral-850"
                        }`}
                        title={lang === "ar" ? "خلفية عشوائية ملائمة" : "Set fallback random backdrop"}
                      >
                        <Image className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title Logo Image URL (PNG with transparent background) */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-zinc-400 block">
                        {lang === "ar" ? "رابط شعار/اسم العمل الأصلي (صورة PNG شفافة من TMDB)" : "Original Title Logo Image URL (Transparent PNG)"}
                      </label>
                      {formData.logoUrl ? (
                        <span className="text-[9.5px] font-bold text-emerald-400 flex items-center gap-1">
                          <span>✓</span> {lang === "ar" ? "الشعار متوفر" : "Logo Available"}
                        </span>
                      ) : (
                        <span className="text-[9.5px] font-medium text-amber-400/80">
                          {lang === "ar" ? "سيتم استخدام النص القياسي" : "Standard text fallback will be used"}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={formData.logoUrl || ""}
                      onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                      placeholder="https://image.tmdb.org/t/p/w500/...png"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none font-mono transition-all focus:border-red-600"
                    />
                    
                    {/* Live Logo Preview Box */}
                    {formData.logoUrl && (
                      <div className="p-3 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center gap-3.5 mt-2">
                        <div className="w-32 h-14 rounded-lg bg-neutral-900 border border-white/10 flex items-center justify-center p-2 shrink-0 overflow-hidden backdrop-blur-md shadow-inner">
                          <img 
                            src={formData.logoUrl} 
                            alt="Logo Preview" 
                            className="max-h-full max-w-full object-contain filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-zinc-400 leading-tight space-y-0.5 overflow-hidden">
                          <p className="font-bold text-zinc-200">{lang === "ar" ? "معاينة شعار العنوان الأصلي" : "Title Logo Preview"}</p>
                          <p className="text-zinc-500 font-mono text-[9px] truncate">{formData.logoUrl}</p>
                          <p className="text-[9px] text-emerald-400/90 font-medium">
                            {lang === "ar" ? "سيعرض هذا الشعار بدلاً من اسم النص بأسلوب سينمائي" : "Will display on hero banner & detail modal"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* YouTube Trailer URL */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    {lang === "ar" ? "رابط الإعلان الترويجي للفيلم (يوتيوب)" : "YouTube Trailer / Promo URL"}
                  </label>
                  <input
                    type="text"
                    value={formData.trailerUrl}
                    onChange={(e) => setFormData({ ...formData, trailerUrl: e.target.value })}
                    placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono transition-all"
                  />
                </div>

                {/* Subtitle Tracks Header & Controls */}
                <div className="space-y-2 border border-neutral-800 rounded-2xl p-3 bg-neutral-900/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-red-500" />
                      <span className="text-xs font-bold text-white">
                        {lang === "ar" ? "إدارة وتنزيل الترجمات الحقيقية (.srt / .vtt)" : "Real Subtitles Management (.srt / .vtt)"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleAutoFetchSubtitles}
                      disabled={isAutoFetchingSubtitles}
                      className="px-3 py-1.5 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isAutoFetchingSubtitles ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>{lang === "ar" ? "جاري البحث واستخراج الترجمة..." : "Searching subtitles..."}</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                          <span>{lang === "ar" ? "استيراد ترجمة حقيقية تلقائياً" : "Auto-Fetch Real Subtitle"}</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    {/* Arabic Subtitle Track */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "رابط أو ملف الترجمة العربية" : "Arabic Subtitle Track"}
                        </label>
                        {formData.subtitlesUrlAr && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            formData.subtitlesUrlAr.startsWith("/uploads/") ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400"
                          }`}>
                            {formData.subtitlesUrlAr.startsWith("/uploads/") ? (lang === "ar" ? "🟢 ملف محمل محلياً" : "🟢 Local File") : (lang === "ar" ? "🟡 رابط خارجي" : "🟡 External Link")}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={formData.subtitlesUrlAr}
                          onChange={(e) => setFormData({ ...formData, subtitlesUrlAr: e.target.value })}
                          placeholder="https://example.com/arabic.vtt أو /uploads/..."
                          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleImportSubsource("ar")}
                          disabled={isImportingSubsource}
                          title={lang === "ar" ? "استيراد من Subsource" : "Import from Subsource"}
                          className="px-2.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white flex items-center justify-center text-xs transition-all shrink-0 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                        <label className={`px-3 py-2 bg-neutral-900 border border-neutral-800 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white cursor-pointer flex items-center justify-center gap-1.5 text-xs transition-all shrink-0 ${isUploadingAr ? "opacity-50 pointer-events-none" : ""}`}>
                          <Upload className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isUploadingAr ? (lang === "ar" ? "جاري..." : "Uploading...") : (lang === "ar" ? "رفع" : "Upload")}</span>
                          <input
                            type="file"
                            accept=".srt,.vtt"
                            onChange={(e) => handleSubtitleUpload(e, "ar")}
                            className="hidden"
                          />
                        </label>
                        {formData.subtitlesUrlAr && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, subtitlesUrlAr: "" })}
                            title={lang === "ar" ? "حذف الترجمة العربية" : "Delete Arabic Subtitle"}
                            className="px-2.5 py-2 bg-red-950/60 border border-red-800/60 hover:bg-red-900 rounded-xl text-red-400 hover:text-white flex items-center justify-center text-xs transition-all shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* English Subtitle Track */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-zinc-400 block">
                          {lang === "ar" ? "رابط أو ملف الترجمة الإنجليزية" : "English Subtitle Track"}
                        </label>
                        {formData.subtitlesUrlEn && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
                            formData.subtitlesUrlEn.startsWith("/uploads/") ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-amber-500/20 text-amber-400"
                          }`}>
                            {formData.subtitlesUrlEn.startsWith("/uploads/") ? (lang === "ar" ? "🟢 ملف محمل محلياً" : "🟢 Local File") : (lang === "ar" ? "🟡 رابط خارجي" : "🟡 External Link")}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={formData.subtitlesUrlEn}
                          onChange={(e) => setFormData({ ...formData, subtitlesUrlEn: e.target.value })}
                          placeholder="https://example.com/english.vtt أو /uploads/..."
                          className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono transition-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleImportSubsource("en")}
                          disabled={isImportingSubsource}
                          title={lang === "ar" ? "استيراد من Subsource" : "Import from Subsource"}
                          className="px-2.5 py-2 bg-neutral-900 border border-neutral-800 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white flex items-center justify-center text-xs transition-all shrink-0 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-blue-400" />
                        </button>
                        <label className={`px-3 py-2 bg-neutral-900 border border-neutral-800 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white cursor-pointer flex items-center justify-center gap-1.5 text-xs transition-all shrink-0 ${isUploadingEn ? "opacity-50 pointer-events-none" : ""}`}>
                          <Upload className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isUploadingEn ? (lang === "ar" ? "جاري..." : "Uploading...") : (lang === "ar" ? "رفع" : "Upload")}</span>
                          <input
                            type="file"
                            accept=".srt,.vtt"
                            onChange={(e) => handleSubtitleUpload(e, "en")}
                            className="hidden"
                          />
                        </label>
                        {formData.subtitlesUrlEn && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, subtitlesUrlEn: "" })}
                            title={lang === "ar" ? "حذف الترجمة الإنجليزية" : "Delete English Subtitle"}
                            className="px-2.5 py-2 bg-red-950/60 border border-red-800/60 hover:bg-red-900 rounded-xl text-red-400 hover:text-white flex items-center justify-center text-xs transition-all shrink-0 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Genre Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    {lang === "ar" ? "تصنيفات العمل الفني (اختر ما ينطبق)" : "Genres (Select all that apply)"}
                  </label>
                  <div className={`flex flex-wrap gap-1.5 bg-neutral-950 border rounded-2xl p-3 transition-all ${
                    adminFocusArea === "form" && focusedFormFieldIndex === 12 ? "border-red-600 ring-2 ring-red-600/50" : "border-neutral-850"
                  }`}>
                    {availableGenres.map((g, gIdx) => {
                      const isChecked = formData.genres.includes(g.ar);
                      return (
                        <button
                          key={g.ar}
                          type="button"
                          onClick={() => toggleFormGenre(g.ar)}
                          className={`px-2.5 py-1 rounded-xl text-[10px] font-bold border transition-all cursor-pointer flex items-center gap-1 ${
                            adminFocusArea === "form" && focusedFormFieldIndex === 12 && focusedGenreIndex === gIdx
                              ? "border-red-600 bg-neutral-800 ring-2 ring-red-500/50 scale-[1.04]"
                              : isChecked
                                ? "bg-white text-black border-white"
                                : "bg-neutral-900 text-zinc-400 border-neutral-850 hover:text-white"
                          }`}
                        >
                          {isChecked && <Check className="w-2.5 h-2.5 shrink-0" />}
                          <span>{lang === "ar" ? g.ar : g.en}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Arabic Story */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    {lang === "ar" ? "قصة العمل بالعربية" : "Story/Description in Arabic"}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.storyAr}
                    onChange={(e) => setFormData({ ...formData, storyAr: e.target.value })}
                    placeholder={lang === "ar" ? "اكتب تفاصيل القصة أو الحبكة الفنية بالكامل..." : "Story text in Arabic..."}
                    className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none font-sans leading-relaxed transition-all ${
                      adminFocusArea === "form" && focusedFormFieldIndex === 10 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                    }`}
                  />
                </div>

                {/* English Story */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    {lang === "ar" ? "قصة العمل بالإنجليزية" : "Story/Description in English"}
                  </label>
                  <textarea
                    rows={3}
                    value={formData.storyEn}
                    onChange={(e) => setFormData({ ...formData, storyEn: e.target.value })}
                    placeholder={lang === "ar" ? "اكتب قصة العمل الفني باللغة الإنجليزية..." : "Story text in English..."}
                    className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none font-sans leading-relaxed transition-all ${
                      adminFocusArea === "form" && focusedFormFieldIndex === 11 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                    }`}
                  />
                </div>

                {/* Cast / Actors (Comma separated) */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-zinc-400 block">
                    {lang === "ar" ? "طاقم التمثيل والنجوم (تفصل بفاصلة عربية أو إنجليزية)" : "Starring Cast / Actors (comma separated)"}
                  </label>
                  <input
                    type="text"
                    value={formData.actors.join(" ، ")}
                    onChange={(e) => {
                      const split = e.target.value.split(/[،,]/).map(actor => actor.trim()).filter(Boolean);
                      setFormData({ ...formData, actors: split });
                    }}
                    placeholder={lang === "ar" ? "مثال: كريم عبد العزيز ، فتحي عبد الوهاب ، ميرنا نور الدين" : "e.g. Karim Abdel Aziz, Timothée Chalamet, Zendaya"}
                    className={`w-full bg-neutral-950 border rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all ${
                      adminFocusArea === "form" && focusedFormFieldIndex === 13 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                    }`}
                  />
                </div>

                {/* Dynamic Server / Episode Streaming URLs for Movie OR Seasons & Episodes Manager for Series */}
                {formData.type === "movie" ? (
                  <div className="space-y-3 pt-2 border-t border-neutral-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-white">
                          {lang === "ar" ? "روابط سيرفرات التشغيل (للفيلم)" : "Movie Video Servers"}
                        </h4>
                        <p className="text-[10px] text-zinc-500">
                          {lang === "ar" ? "وفر روابط mp4 صالحة أو روابط بث مباشرة سريعة" : "Provide direct .mp4 streaming links or HLS links"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={addServerRow}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold bg-neutral-950 hover:bg-neutral-900 text-zinc-300 hover:text-white border cursor-pointer flex items-center gap-1 transition-all border-neutral-850`}
                      >
                        <Plus className="w-3 h-3" />
                        <span>{lang === "ar" ? "إضافة سيرفر" : "Add Server"}</span>
                      </button>
                    </div>

                    <div className="space-y-2 bg-neutral-950 border rounded-2xl p-4 border-neutral-850">
                      {formData.servers.map((server, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <span className="text-[10px] font-bold font-mono text-zinc-500 w-4 shrink-0 text-center">
                            {idx + 1}
                          </span>

                          {/* Name (e.g. Server 1) */}
                          <input
                            type="text"
                            required
                            value={server.name}
                            onChange={(e) => updateServerRow(idx, "name", e.target.value)}
                            placeholder={`سيرفر ${idx + 1}`}
                            className="bg-neutral-900 border border-neutral-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none transition-all w-1/4"
                          />

                          {/* Stream URL */}
                          <input
                            type="text"
                            required
                            value={server.url}
                            onChange={(e) => updateServerRow(idx, "url", e.target.value)}
                            placeholder="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                            className="bg-neutral-900 border border-neutral-850 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none transition-all flex-1 font-mono text-[10px]"
                          />

                          {/* Remove */}
                          <button
                            type="button"
                            disabled={formData.servers.length === 1}
                            onClick={() => removeServerRow(idx)}
                            className="p-1.5 rounded-lg disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer shrink-0 bg-red-950/20 hover:bg-red-900/30 text-rose-400"
                            title={lang === "ar" ? "إزالة الرابط" : "Remove link"}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  // Seasons & Episodes Manager (إدارة المواسم والحلقات)
                  <div className="space-y-4 pt-3 border-t border-neutral-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Tv className="w-4 h-4 text-red-600 animate-pulse" />
                          <span>{lang === "ar" ? "إدارة المواسم والحلقات" : "Seasons & Episodes Manager"}</span>
                        </h4>
                        <p className="text-[10px] text-zinc-500">
                          {lang === "ar" ? "قم بتقسيم المسلسل إلى مواسم وحلقات، ورفع الترجمات وإضافة التصنيف لكل حلقة على حدة" : "Organize the series into seasons and episodes, upload subtitles, and set rating per episode."}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleImportSeasonForForm()}
                          disabled={isImportingSeason}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-amber-950 hover:bg-amber-900 text-amber-300 hover:text-white border border-amber-900 flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                          title={lang === "ar" ? "جلب واستيراد بوسترات ومعلومات وحلقات موسم جديد تلقائياً" : "Auto-import posters, metadata & episodes for new season"}
                        >
                          <Sparkles className={`w-3 h-3 text-amber-400 ${isImportingSeason ? "animate-spin" : ""}`} />
                          <span>{isImportingSeason ? (lang === "ar" ? "جاري الاستيراد..." : "Importing...") : (lang === "ar" ? "استيراد موسم جديد" : "Import New Season")}</span>
                        </button>
                        <button
                          type="button"
                          onClick={addSeasonToForm}
                          className="px-3 py-1.5 rounded-xl text-[10px] font-bold bg-neutral-900 hover:bg-neutral-800 text-zinc-300 hover:text-white border border-neutral-800 flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{lang === "ar" ? "إضافة موسم يدوي" : "Add Season Manually"}</span>
                        </button>
                      </div>
                    </div>

                    {/* Season Tabs */}
                    {(formData.seasons && formData.seasons.length > 0) ? (
                      <div className="flex flex-wrap gap-2 border-b border-neutral-900 pb-2">
                        {formData.seasons.map((season, idx) => {
                          const isActive = activeFormSeasonIndex === idx;
                          return (
                            <div key={season.id || idx} className="flex items-center">
                              <button
                                type="button"
                                onClick={() => { setActiveFormSeasonIndex(idx); setExpandedEpisodeIndex(0); }}
                                className={`px-4 py-1.5 rounded-l-xl text-[11px] font-black border transition-all cursor-pointer ${
                                  isActive
                                    ? "bg-red-600 text-white border-red-600 shadow-md"
                                    : "bg-neutral-950 text-zinc-400 border-neutral-850 hover:border-neutral-750 hover:text-white"
                                }`}
                              >
                                {lang === "ar" ? season.titleAr : season.titleEn}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSeasonFromForm(idx)}
                                className={`px-2 py-1.5 border-y border-r rounded-r-xl text-zinc-500 hover:text-red-500 transition-all cursor-pointer ${
                                  isActive ? "border-red-600 bg-red-950/20" : "border-neutral-850 bg-neutral-950 hover:bg-neutral-900"
                                }`}
                                title={lang === "ar" ? "حذف الموسم" : "Delete Season"}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-6 bg-neutral-950 border border-neutral-850 rounded-2xl text-zinc-500 text-xs">
                        {lang === "ar" ? "لا توجد مواسم مضافة حالياً. يرجى الضغط على 'إضافة موسم جديد'." : "No seasons added yet. Click 'Add New Season'."}
                      </div>
                    )}

                    {/* Episodes List under active Season */}
                    {(formData.seasons && formData.seasons[activeFormSeasonIndex]) && (
                      <div className="space-y-3 bg-neutral-950 border border-neutral-850 rounded-2xl p-4">
                        {/* Active Season Poster & Overview */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-neutral-900">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-bold text-zinc-400">
                                {lang === "ar" ? "رابط بوستر الموسم" : "Season Poster URL"}
                              </label>
                              <button
                                type="button"
                                onClick={() => handleImportSeasonForForm(activeFormSeasonIndex)}
                                disabled={isImportingSeason}
                                className="text-[10px] font-medium text-amber-400 hover:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <Sparkles className={`w-2.5 h-2.5 ${isImportingSeason ? "animate-spin" : ""}`} />
                                <span>{lang === "ar" ? "استيراد بيانات هذا الموسم" : "Import This Season Info"}</span>
                              </button>
                            </div>
                            <input
                              type="text"
                              value={formData.seasons[activeFormSeasonIndex].poster || ""}
                              onChange={(e) => updateSeasonField(activeFormSeasonIndex, "poster", e.target.value)}
                              placeholder="https://image.tmdb.org/t/p/w500/..."
                              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-red-600"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-zinc-400 mb-1">
                              {lang === "ar" ? "تفاصيل / ملخص الموسم" : "Season Overview"}
                            </label>
                            <input
                              type="text"
                              value={formData.seasons[activeFormSeasonIndex].storyAr || ""}
                              onChange={(e) => updateSeasonField(activeFormSeasonIndex, "storyAr", e.target.value)}
                              placeholder={lang === "ar" ? "تفاصيل وقصة الموسم..." : "Season story overview..."}
                              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-red-600"
                            />
                          </div>
                        </div>

                        <div className="flex justify-between items-center pb-2 border-b border-neutral-900">
                          <h5 className="text-[11px] font-black text-zinc-300">
                            {lang === "ar" ? "الحلقات في " : "Episodes in "}
                            {lang === "ar" ? formData.seasons[activeFormSeasonIndex].titleAr : formData.seasons[activeFormSeasonIndex].titleEn}
                          </h5>
                          <button
                            type="button"
                            onClick={() => addEpisodeToForm(activeFormSeasonIndex)}
                            className="px-2.5 py-1 rounded-lg text-[9px] font-bold bg-neutral-900 hover:bg-neutral-855 text-zinc-300 hover:text-white border border-neutral-800 flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{lang === "ar" ? "إضافة حلقة جديدة" : "Add Episode"}</span>
                          </button>
                        </div>

                        {/* Episodes Map */}
                        {(formData.seasons[activeFormSeasonIndex].episodes && formData.seasons[activeFormSeasonIndex].episodes.length > 0) ? (
                          <div className="space-y-3 pt-2">
                            {formData.seasons[activeFormSeasonIndex].episodes.map((episode, epIdx) => {
                              const isExpanded = expandedEpisodeIndex === epIdx;
                              return (
                                <div key={episode.id || epIdx} className="border border-neutral-850 rounded-xl overflow-hidden bg-neutral-900/40">
                                  {/* Episode Header */}
                                  <div
                                    onClick={() => setExpandedEpisodeIndex(isExpanded ? null : epIdx)}
                                    className="px-3.5 py-2.5 bg-neutral-900 flex justify-between items-center cursor-pointer hover:bg-neutral-850/60 transition-all select-none"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] font-black font-mono text-red-500 bg-red-950/40 px-2 py-0.5 rounded border border-red-900/30">
                                        EP {episode.number}
                                      </span>
                                      <span className="text-[11px] font-bold text-white">
                                        {lang === "ar" ? episode.titleAr : episode.titleEn}
                                      </span>
                                      <span className="text-[10px] text-zinc-500 font-mono">
                                        ({episode.duration || "45m"})
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                                      {/* Episode Rating badge */}
                                      <div className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-950/20 px-1.5 py-0.5 rounded border border-amber-900/30">
                                        <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                        <span>{episode.rating || "8.0"}</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => removeEpisodeFromForm(activeFormSeasonIndex, epIdx)}
                                        className="p-1 rounded bg-red-950/20 hover:bg-red-900/30 text-rose-400 transition-all cursor-pointer"
                                        title={lang === "ar" ? "حذف الحلقة" : "Delete Episode"}
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                      <span className="text-zinc-500 text-[10px]">
                                        {isExpanded ? "▲" : "▼"}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Episode Fields (if expanded) */}
                                  {isExpanded && (
                                    <div className="p-4 border-t border-neutral-850/60 space-y-4 bg-neutral-950/40">
                                      {/* Title Inputs */}
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "عنوان الحلقة (عربي)" : "Episode Title (Arabic)"}</label>
                                          <input
                                            type="text"
                                            value={episode.titleAr}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "titleAr", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "عنوان الحلقة (إنجليزي)" : "Episode Title (English)"}</label>
                                          <input
                                            type="text"
                                            value={episode.titleEn}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "titleEn", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all"
                                          />
                                        </div>
                                      </div>

                                      {/* Duration, Rating, Thumbnail */}
                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "مدة التشغيل (مثل: 45m)" : "Duration (e.g. 45m)"}</label>
                                          <input
                                            type="text"
                                            value={episode.duration}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "duration", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all font-mono"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "التصنيف / التقييم (مثال: 8.5)" : "Rating / Score (e.g. 8.5)"}</label>
                                          <input
                                            type="number"
                                            step="0.1"
                                            value={episode.rating}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "rating", parseFloat(e.target.value) || 8.0)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all font-mono"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "رابط الصورة المصغرة" : "Thumbnail Image URL"}</label>
                                          <input
                                            type="text"
                                            value={episode.thumbnail}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "thumbnail", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all text-[10px] font-mono"
                                          />
                                        </div>
                                      </div>

                                      {/* Synopsis / Story */}
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "ملخص الحلقة (عربي)" : "Episode Story (Arabic)"}</label>
                                          <textarea
                                            rows={2}
                                            value={episode.storyAr}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "storyAr", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all font-sans text-right"
                                          />
                                        </div>
                                        <div className="space-y-1">
                                          <label className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "ملخص الحلقة (إنجليزي)" : "Episode Story (English)"}</label>
                                          <textarea
                                            rows={2}
                                            value={episode.storyEn}
                                            onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "storyEn", e.target.value)}
                                            className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-red-600 transition-all font-sans text-left"
                                          />
                                        </div>
                                      </div>

                                      {/* Episode Subtitles (Arabic & English Uploads) */}
                                      <div className="border border-neutral-850 rounded-xl p-3 bg-neutral-900/20 space-y-3">
                                        <div className="text-[10px] font-bold text-white">{lang === "ar" ? "ملفات ترجمة الحلقة الذكية والآلية" : "Episode Intelligent Subtitle Tracks"}</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                          {/* Episode Ar Subs */}
                                          <div className="space-y-1">
                                            <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "الترجمة العربية (.vtt/.srt)" : "Arabic Subtitles (.vtt/.srt)"}</label>
                                            <div className="flex gap-2">
                                              <input
                                                type="text"
                                                value={episode.subtitlesUrlAr || ""}
                                                onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "subtitlesUrlAr", e.target.value)}
                                                placeholder="https://example.com/arabic_ep.vtt"
                                                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1 text-xs text-white focus:outline-none font-mono text-[10px]"
                                              />
                                              <label className="px-2 py-1 bg-neutral-800 border border-neutral-700 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white cursor-pointer flex items-center gap-1 text-[10px] shrink-0 transition-all">
                                                <Upload className="w-3 h-3" />
                                                <input
                                                  type="file"
                                                  accept=".srt,.vtt"
                                                  className="hidden"
                                                  onChange={(e) => handleEpisodeSubtitleUpload(e, activeFormSeasonIndex, epIdx, "ar")}
                                                />
                                              </label>
                                            </div>
                                          </div>
                                          {/* Episode En Subs */}
                                          <div className="space-y-1">
                                            <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "الترجمة الإنجليزية (.vtt/.srt)" : "English Subtitles (.vtt/.srt)"}</label>
                                            <div className="flex gap-2">
                                              <input
                                                type="text"
                                                value={episode.subtitlesUrlEn || ""}
                                                onChange={(e) => updateEpisodeField(activeFormSeasonIndex, epIdx, "subtitlesUrlEn", e.target.value)}
                                                placeholder="https://example.com/english_ep.vtt"
                                                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-1 text-xs text-white focus:outline-none font-mono text-[10px]"
                                              />
                                              <label className="px-2 py-1 bg-neutral-800 border border-neutral-700 hover:border-red-600 rounded-xl text-zinc-300 hover:text-white cursor-pointer flex items-center gap-1 text-[10px] shrink-0 transition-all">
                                                <Upload className="w-3 h-3" />
                                                <input
                                                  type="file"
                                                  accept=".srt,.vtt"
                                                  className="hidden"
                                                  onChange={(e) => handleEpisodeSubtitleUpload(e, activeFormSeasonIndex, epIdx, "en")}
                                                />
                                              </label>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Episode Servers / Stream Links */}
                                      <div className="space-y-2 border-t border-neutral-850/65 pt-3">
                                        <div className="flex justify-between items-center">
                                          <label className="text-[10px] font-black text-white">{lang === "ar" ? "سيرفرات بث الحلقة" : "Episode Video Stream Links"}</label>
                                          <button
                                            type="button"
                                            onClick={() => addEpisodeServerRow(activeFormSeasonIndex, epIdx)}
                                            className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-750 text-zinc-300 hover:text-white text-[9px] border border-neutral-700 cursor-pointer flex items-center gap-1"
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                            <span>{lang === "ar" ? "إضافة سيرفر للبث" : "Add Server"}</span>
                                          </button>
                                        </div>

                                        <div className="space-y-1.5">
                                          {(episode.servers || []).map((srv, srvIdx) => (
                                            <div key={srvIdx} className="flex gap-2 items-center">
                                              <span className="text-[9px] font-black text-zinc-500 font-mono w-4 shrink-0 text-center">
                                                {srvIdx + 1}
                                              </span>
                                              <input
                                                type="text"
                                                required
                                                value={srv.name}
                                                onChange={(e) => updateEpisodeServerField(activeFormSeasonIndex, epIdx, srvIdx, "name", e.target.value)}
                                                placeholder={lang === "ar" ? `سيرفر رئيسي` : `Server ${srvIdx + 1}`}
                                                className="bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-[11px] text-white focus:outline-none focus:border-red-600 transition-all w-1/4"
                                              />
                                              <input
                                                type="text"
                                                required
                                                value={srv.url}
                                                onChange={(e) => updateEpisodeServerField(activeFormSeasonIndex, epIdx, srvIdx, "url", e.target.value)}
                                                placeholder="https://..."
                                                className="bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1 text-[11px] text-white focus:outline-none focus:border-red-600 transition-all flex-1 font-mono text-[10px]"
                                              />
                                              <button
                                                type="button"
                                                disabled={episode.servers.length === 1}
                                                onClick={() => removeEpisodeServerRow(activeFormSeasonIndex, epIdx, srvIdx)}
                                                className="p-1 rounded bg-red-955/20 hover:bg-red-900/30 text-rose-450 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
                                              >
                                                <X className="w-3 h-3" />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-zinc-500 text-xs font-bold">
                            {lang === "ar" ? "لا توجد حلقات مضافة في هذا الموسم حالياً. يرجى الضغط على 'إضافة حلقة جديدة'." : "No episodes in this season. Click 'Add Episode' to add one."}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Publish status toggle in form */}
                <div className="bg-neutral-950/80 border border-neutral-850 p-4 rounded-2xl flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className={`w-5 h-5 shrink-0 ${formData.isPublished ? 'text-emerald-400' : 'text-amber-400'}`} />
                    <div>
                      <h4 className="text-xs font-bold text-white">
                        {lang === "ar" ? "حالة نشر العمل على التطبيق" : "App Publication Status"}
                      </h4>
                      <p className="text-[10px] text-zinc-500">
                        {lang === "ar" 
                          ? "عند التفعيل، يظهر العمل مباشرة للجمهور في التطبيق. إذا تم تعطيله، يُحفظ كمسودة بانتظار المراجعة" 
                          : "When enabled, work will immediately appear in home feed and categories"}
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-neutral-900 border border-neutral-800 px-3.5 py-2 rounded-xl text-xs font-bold text-white hover:bg-neutral-850 transition-all shrink-0">
                    <input
                      type="checkbox"
                      checked={formData.isPublished}
                      onChange={(e) => setFormData(prev => ({ ...prev, isPublished: e.target.checked }))}
                      className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
                    />
                    <span>{formData.isPublished ? (lang === "ar" ? "نشر العمل فوراً" : "Publish Immediately") : (lang === "ar" ? "حفظ كمسودة (بانتظار المراجعة)" : "Save as Draft")}</span>
                  </label>
                </div>

                {/* Submit button */}
                <div className="pt-3 border-t border-neutral-900 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { resetMovieForm(); setActiveTab("list"); }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold bg-neutral-900 hover:bg-neutral-850 text-zinc-400 hover:text-white transition-all cursor-pointer border ${
                      adminFocusArea === "form" && focusedFormFieldIndex === 17 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
                    }`}
                  >
                    {lang === "ar" ? "إلغاء والعودة" : "Cancel"}
                  </button>
                  
                  <button
                    type="submit"
                    className={`px-5 py-2 rounded-xl text-xs font-black bg-white hover:bg-neutral-200 text-black shadow-lg transition-all cursor-pointer flex items-center gap-1.5 border ${
                      adminFocusArea === "form" && focusedFormFieldIndex === 16 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.04]" : "border-transparent"
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>
                      {editingMovieId 
                        ? (lang === "ar" ? "حفظ التعديلات" : "Save Movie Updates")
                        : (lang === "ar" ? "نشر وتوفير البث الآن" : "Publish Video & Host Stream")}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* TAB 3: BANNER & PROMO SLIDER */}
            {activeTab === "banner" && (
              <div className="space-y-6">
                {/* 1. Hero Banner Selection */}
                <div className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-5 space-y-4">
                  <div className="flex items-center gap-2 border-b border-neutral-900 pb-3">
                    <Sparkles className="w-4.5 h-4.5 text-red-400 animate-pulse" />
                    <div>
                      <h2 className="text-xs font-bold text-white">
                        {lang === "ar" ? "تعديل البانر الترويجي الكبير" : "Main Hero Backdrop Banner Selection"}
                      </h2>
                      <p className="text-[10px] text-zinc-500">
                        {lang === "ar" ? "اختر العمل الفني المميز الذي سيظهر بخلفيته الواسعة وقصته في أعلى واجهة التطبيق الرئيسية" : "Choose the featured showcase film that plays inside the backdrop of the home dashboard"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-4 items-center">
                    <select
                      value={customHeroId || ""}
                      onChange={(e) => handleSetHero(e.target.value)}
                      className={`w-full md:max-w-md bg-black border rounded-lg px-3 py-2 text-xs text-white font-bold focus:outline-none cursor-pointer transition-all ${
                        adminFocusArea === "banner" && bannerFocusIndex === 0 ? "border-white ring-2 ring-white scale-[1.01]" : "border-white/20 hover:border-white"
                      }`}
                    >
                      <option value="">{lang === "ar" ? "-- اختر تلقائي (أول عمل فني) --" : "-- Default Showcase (First movie) --"}</option>
                      {movies.map(m => (
                        <option key={m.id} value={m.id}>
                          [{m.type === "series" ? (lang === "ar" ? "مسلسل" : "Series") : (lang === "ar" ? "فيلم" : "Movie")}] {lang === "ar" ? m.titleAr : m.titleEn}
                        </option>
                      ))}
                    </select>

                    <div className="text-[10px] text-emerald-400 font-bold bg-emerald-950/35 border border-emerald-500/20 rounded-xl px-3 py-2 text-center md:text-right">
                      {lang === "ar" 
                        ? "✓ يتم الآن عرض العمل المعين كخلفية سينمائية كاملة." 
                        : "✓ Chosen movie will display as the full-width cinema backdrop!"}
                    </div>
                  </div>
                </div>

                {/* 2. Top Promo Slider Management */}
                <div className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-900 pb-3">
                    <div className="flex items-center gap-2">
                      <Image className="w-4.5 h-4.5 text-amber-400" />
                      <div>
                        <h2 className="text-xs font-bold text-white">
                          {lang === "ar" ? "إدارة سلايدر العروض الترويجية العلوي" : "Top Carousel Promo Slider Slider"}
                        </h2>
                        <p className="text-[10px] text-zinc-500">
                          {lang === "ar" ? "إضافة لافتات وعروض في أعلى الشاشة وربطها بعمليات البحث أو البث الفوري" : "Add banners at top screen to trigger searches, play video instantly, or open profiles"}
                        </p>
                      </div>
                    </div>
                    
                    {!showPromoForm && (
                      <button
                        type="button"
                        onClick={() => setShowPromoForm(true)}
                        className={`px-3 py-1.5 bg-white text-black font-black text-[10px] rounded-lg shadow cursor-pointer flex items-center gap-1 transition-transform border ${
                          adminFocusArea === "banner" && bannerFocusIndex === 1 ? "border-red-600 ring-2 ring-red-600/50 scale-105" : "border-transparent"
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "إضافة لافتة ترويجية" : "Create Promo Banner"}</span>
                      </button>
                    )}
                  </div>

                  {/* Promo Form */}
                  {showPromoForm && (
                    <form onSubmit={handleAddOrEditPromo} className="bg-neutral-950 border border-neutral-850 rounded-2xl p-4 space-y-4">
                      <div className="flex items-center justify-between border-b border-neutral-850 pb-2">
                        <span className="text-[10px] font-bold text-white">
                          {promoFormData.id ? (lang === "ar" ? "تعديل اللافتة الترويجية" : "Edit Promo Banner") : (lang === "ar" ? "إنشاء لافتة ترويجية جديدة" : "Create New Promo Banner")}
                        </span>
                        <button type="button" onClick={resetPromoForm} className="text-zinc-500 hover:text-white cursor-pointer">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Title Ar */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "العنوان بالعربية *" : "Arabic Title *"}</label>
                          <input
                            type="text" required
                            value={promoFormData.titleAr}
                            onChange={(e) => setPromoFormData({ ...promoFormData, titleAr: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 2 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Title En */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "العنوان بالإنجليزية *" : "English Title *"}</label>
                          <input
                            type="text" required
                            value={promoFormData.titleEn}
                            onChange={(e) => setPromoFormData({ ...promoFormData, titleEn: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 3 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Tag Ar */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "شارة اللافتة (مثال: عرض حصري)" : "Tag Line Arabic (e.g. Premium)"}</label>
                          <input
                            type="text"
                            value={promoFormData.tagAr}
                            onChange={(e) => setPromoFormData({ ...promoFormData, tagAr: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 4 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Tag En */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "شارة اللافتة بالإنجليزية" : "Tag Line English"}</label>
                          <input
                            type="text"
                            value={promoFormData.tagEn}
                            onChange={(e) => setPromoFormData({ ...promoFormData, tagEn: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 5 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Image URL */}
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "رابط صورة الخلفية العريضة لافتة العرض *" : "Wide Promo Image Background URL *"}</label>
                          <input
                            type="text" required
                            value={promoFormData.image}
                            onChange={(e) => setPromoFormData({ ...promoFormData, image: e.target.value })}
                            placeholder="https://images.unsplash.com/..."
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none font-mono transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 6 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Description Ar */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "الوصف الترويجي بالعربية" : "Promo description in Arabic"}</label>
                          <textarea
                            rows={2}
                            value={promoFormData.descriptionAr}
                            onChange={(e) => setPromoFormData({ ...promoFormData, descriptionAr: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 7 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Description En */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "الوصف بالإنجليزية" : "Promo description in English"}</label>
                          <textarea
                            rows={2}
                            value={promoFormData.descriptionEn}
                            onChange={(e) => setPromoFormData({ ...promoFormData, descriptionEn: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 8 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>

                        {/* Action Type */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">{lang === "ar" ? "نوع الإجراء عند الضغط" : "Click Action Action"}</label>
                          <select
                            value={promoFormData.actionType}
                            onChange={(e) => setPromoFormData({ ...promoFormData, actionType: e.target.value })}
                            className={`w-full bg-neutral-900 border rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 9 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          >
                            <option value="search">{lang === "ar" ? "البحث الذكي (Search)" : "Trigger Search Query"}</option>
                            <option value="play">{lang === "ar" ? "تشغيل الفيلم فورا (Play)" : "Play Movie Immediately"}</option>
                            <option value="settings">{lang === "ar" ? "فتح صفحة الإعدادات (Settings)" : "Navigate to Settings / VIP"}</option>
                          </select>
                        </div>

                        {/* Action Value */}
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-400 block">
                            {promoFormData.actionType === "search" 
                              ? (lang === "ar" ? "كلمة البحث (مثال: ولاد رزق)" : "Search keyword (e.g. Dune)")
                              : promoFormData.actionType === "play"
                                ? (lang === "ar" ? "مُعرّف الفيلم (Movie ID)" : "Video/Movie ID (e.g. series_1)")
                                : (lang === "ar" ? "القيمة (مثل: vip)" : "Action argument (e.g. vip)")}
                          </label>
                          <input
                            type="text"
                            value={promoFormData.actionValue}
                            onChange={(e) => setPromoFormData({ ...promoFormData, actionValue: e.target.value })}
                            placeholder="e.g. series_1"
                            className={`w-full bg-neutral-900 border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none font-mono transition-all ${
                              adminFocusArea === "banner" && bannerFocusIndex === 10 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                            }`}
                          />
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={resetPromoForm}
                          className={`px-3 py-1.5 text-[10px] font-bold bg-neutral-900 text-zinc-400 hover:text-white rounded-lg cursor-pointer border transition-all ${
                            adminFocusArea === "banner" && bannerFocusIndex === 12 ? "border-red-600 ring-2 ring-red-600/50 scale-105" : "border-transparent"
                          }`}
                        >
                          {lang === "ar" ? "إلغاء" : "Cancel"}
                        </button>
                        <button
                          type="submit"
                          className={`px-4 py-1.5 text-[10px] font-black bg-white text-black rounded-lg cursor-pointer flex items-center gap-1 border transition-all ${
                            adminFocusArea === "banner" && bannerFocusIndex === 11 ? "border-red-600 ring-2 ring-red-600/50 scale-105" : "border-transparent"
                          }`}
                        >
                          <Check className="w-3 h-3" />
                          <span>{promoFormData.id ? (lang === "ar" ? "حفظ التعديل" : "Update") : (lang === "ar" ? "إضافة السلايدر" : "Add Banner")}</span>
                        </button>
                      </div>
                    </form>
                  )}

                  {/* List of current promos */}
                  <div className="space-y-2.5">
                    <span className="text-[9px] font-bold text-zinc-400 block">{lang === "ar" ? "اللافتات النشطة حالياً في السلايدر:" : "Currently Active Slider Banners:"}</span>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {customPromos.map((promo, idx) => {
                        const isPromoCardFocused = adminFocusArea === "banner" && !showPromoForm && bannerFocusIndex === (idx + 1);
                        return (
                          <div 
                            key={promo.id || idx} 
                            className={`bg-neutral-950/70 border rounded-2xl p-3 flex gap-3 relative overflow-hidden shadow-lg transition-all ${
                              isPromoCardFocused
                                ? "border-red-600 ring-2 ring-red-600/30 scale-[1.02]"
                                : "border-neutral-850"
                            }`}
                          >
                            {/* Image preview */}
                            <div className="w-20 h-12 rounded-lg bg-neutral-900 overflow-hidden shrink-0 border border-neutral-800">
                               <img 
                                src={promo.image || undefined} 
                                alt={promo.titleEn} 
                                className="w-full h-full object-cover" 
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  e.currentTarget.src = "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=200&q=80";
                                }}
                              />
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-1">
                                  {promo.tagAr && (
                                    <span className="text-[7px] bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1 rounded">
                                      {lang === "ar" ? promo.tagAr : promo.tagEn}
                                    </span>
                                  )}
                                  <span className="text-[7px] bg-zinc-900 text-zinc-500 px-1 rounded font-mono">
                                    {promo.actionType}: {promo.actionValue}
                                  </span>
                                </div>
                                <h4 className="text-xs font-bold text-white truncate block mt-1">
                                  {lang === "ar" ? promo.titleAr : promo.titleEn}
                                </h4>
                              </div>

                              <div className="flex items-center gap-1.5 mt-2">
                                <button
                                  type="button"
                                  onClick={() => handleEditPromoClick(promo)}
                                  className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all cursor-pointer ${
                                    isPromoCardFocused && bannerPromoBtnIndex === 0
                                      ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                      : "bg-neutral-900 hover:bg-neutral-800 text-zinc-400 hover:text-white"
                                  }`}
                                >
                                  {lang === "ar" ? "تعديل" : "Edit"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePromo(promo.id)}
                                  className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all cursor-pointer ${
                                    isPromoCardFocused && bannerPromoBtnIndex === 1
                                      ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110"
                                      : "bg-red-950/10 hover:bg-red-900/20 text-rose-400"
                                  }`}
                                >
                                  {lang === "ar" ? "حذف" : "Delete"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: MANAGE ADMINISTRATORS */}
            {activeTab === "admins" && (
              <div className="space-y-6 anim-fade-in">
                <div className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-5 space-y-5">
                  <div className="flex items-center gap-3 border-b border-neutral-900 pb-4">
                    <div className="w-10 h-10 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center justify-center text-red-500 shrink-0">
                      <ShieldAlert className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {lang === "ar" ? "إدارة مشرفي النظام" : "System Administrators Management"}
                      </h3>
                      <p className="text-[10px] text-zinc-500">
                        {lang === "ar" 
                          ? "يمكنك إضافة حسابات مشرفين جديدة لإدارة المحتوى والتحكم في الإعدادات."
                          : "You can add new administrator accounts to manage content and control settings."}
                      </p>
                    </div>
                  </div>

                  {/* Status Messages */}
                  {adminError && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-[11px] text-red-400 font-bold">
                      {adminError}
                    </div>
                  )}
                  {adminSuccess && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-[11px] text-emerald-400 font-bold">
                      {adminSuccess}
                    </div>
                  )}

                  <form onSubmit={handleAddAdmin} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-neutral-950/40 border border-neutral-900 rounded-2xl p-4">
                    <div className="md:col-span-4 flex flex-col gap-1.5">
                      <label className="text-[10px] text-zinc-400 font-bold px-1 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>{lang === "ar" ? "اسم المستخدم للمسؤول الجديد" : "New Admin Username"}</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={newAdminUsername}
                        onChange={(e) => setNewAdminUsername(e.target.value)}
                        placeholder="e.g. murtadha"
                        className={`w-full bg-neutral-900 border rounded-xl py-2 px-3 text-xs text-white placeholder-zinc-700 outline-none transition-all ${
                          adminFocusArea === "admins" && focusedAdminFormIndex === 0 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                    </div>

                    <div className="md:col-span-4 flex flex-col gap-1.5">
                      <label className="text-[10px] text-zinc-400 font-bold px-1 flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        <span>{lang === "ar" ? "كلمة المرور" : "Password"}</span>
                      </label>
                      <input
                        type="password"
                        required
                        value={newAdminPassword}
                        onChange={(e) => setNewAdminPassword(e.target.value)}
                        placeholder="••••••••"
                        className={`w-full bg-neutral-900 border rounded-xl py-2 px-3 text-xs text-white placeholder-zinc-700 outline-none transition-all ${
                          adminFocusArea === "admins" && focusedAdminFormIndex === 1 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.01]" : "border-neutral-800"
                        }`}
                      />
                    </div>

                    <div className="md:col-span-4">
                      <button
                        type="submit"
                        className={`w-full py-2 bg-white hover:bg-zinc-200 text-black font-extrabold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer border ${
                          adminFocusArea === "admins" && focusedAdminFormIndex === 2 ? "border-red-600 ring-2 ring-red-600/50 scale-[1.02]" : "border-transparent"
                        }`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "إنشاء حساب مسؤول" : "Create Admin"}</span>
                      </button>
                    </div>
                  </form>

                  {/* Registered Admins List */}
                  <div className="space-y-3">
                    <span className="text-[10px] font-bold text-zinc-400 block px-1">
                      {lang === "ar" ? "المشرفون المسجلون حالياً في النظام:" : "Currently Authorized Administrators:"}
                    </span>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {adminUsers.map((admin, idx) => {
                        const isAdminCardFocused = adminFocusArea === "admins" && focusedAdminFormIndex >= 3 && (focusedAdminFormIndex - 3) === idx;
                        return (
                          <div 
                            key={admin.username || idx} 
                            className={`border rounded-2xl p-4 flex justify-between items-center relative overflow-hidden transition-all ${
                              isAdminCardFocused
                                ? "bg-neutral-900 border-red-600 ring-2 ring-red-600/30 scale-[1.02]"
                                : "bg-neutral-950/70 border-neutral-900"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-850 flex items-center justify-center text-zinc-400 font-bold text-xs shrink-0 shadow-inner">
                                {admin.username.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-white">@{admin.username}</span>
                                  {admin.username === "zaid" && (
                                    <span className="text-[8px] bg-red-950/50 text-red-400 px-1.5 py-0.5 rounded border border-red-900/30 font-bold">
                                      {lang === "ar" ? "المسؤول الأول" : "Primary"}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-zinc-600 block mt-0.5 font-mono">
                                  {lang === "ar" ? "كلمة المرور: " : "Pass: "}
                                  {admin.username === "zaid" ? "••••" : admin.password}
                                </span>
                              </div>
                            </div>

                            {admin.username !== "zaid" && (
                              <button
                                type="button"
                                onClick={() => handleDeleteAdmin(admin.username)}
                                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${
                                  isAdminCardFocused
                                    ? "bg-red-600 text-white font-extrabold ring-2 ring-red-500/50 scale-110 border-red-500"
                                    : "bg-red-950/10 hover:bg-red-900/20 text-rose-400 border-transparent hover:border-red-900/20 shadow-md"
                                }`}
                                title={lang === "ar" ? "حذف المسؤول" : "Remove Admin Access"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: PRE-ROLL ADS & SERVERS MANAGEMENT */}
            {activeTab === "ads" && (
              <div className="space-y-6 anim-fade-in">
                <div className="bg-neutral-900/30 border border-neutral-900 rounded-3xl p-5 space-y-6">
                  
                  {/* Status Banner */}
                  {adStatusMsg && (
                    <div className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center justify-between ${
                      adStatusMsg.type === "success" 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                        : "bg-red-500/10 border-red-500/30 text-red-400"
                    }`}>
                      <div className="flex items-center gap-2">
                        {adStatusMsg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        <span>{adStatusMsg.text}</span>
                      </div>
                      <button onClick={() => setAdStatusMsg(null)} className="text-zinc-500 hover:text-white cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Header & Main Toggle Controls */}
                  <div className="bg-neutral-950/70 border border-neutral-900 rounded-2xl p-5 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-900 pb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center text-amber-400 shrink-0">
                          <Radio className="w-5 h-5 animate-pulse" />
                        </div>
                        <div>
                          <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                            <span>{lang === "ar" ? "نظام الإعلانات قبل عرض الفيديو (Pre-Roll Ads)" : "Pre-Roll Video Ads System"}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                              adsSettings.enabled 
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                                : "bg-neutral-800 text-zinc-500 border-neutral-700"
                            }`}>
                              {adsSettings.enabled ? (lang === "ar" ? "مفعل تلقائياً" : "Active") : (lang === "ar" ? "معطل" : "Disabled")}
                            </span>
                          </h3>
                          <p className="text-[11px] text-zinc-500 mt-0.5">
                            {lang === "ar" 
                              ? "عرض مقطع إعلاني قصير أو شعار راعي البث مع سيرفرات تشغيل مخصصة قبل بدء مشاهدة الفيلم أو الحلقة." 
                              : "Display video advertisement or sponsor message before movie or episode playback starts."}
                          </p>
                        </div>
                      </div>

                      {/* Main System Switch */}
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          type="button"
                          onClick={handleToggleGlobalAds}
                          className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer border ${
                            adsSettings.enabled 
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 shadow-lg shadow-amber-500/10" 
                              : "bg-neutral-800 text-zinc-400 border-neutral-700 hover:bg-neutral-700 hover:text-white"
                          }`}
                        >
                          <Megaphone className="w-4 h-4" />
                          <span>
                            {adsSettings.enabled 
                              ? (lang === "ar" ? "إيقاف تشغيل الإعلانات" : "Disable All Ads") 
                              : (lang === "ar" ? "تفعيل تشغيل الإعلانات" : "Enable All Ads")}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Global Skip Settings */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      <div className="bg-neutral-900/40 border border-neutral-850 rounded-xl p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <label className="text-xs font-bold text-zinc-300 block">
                            {lang === "ar" ? "مدة المشاهدة الإجبارية لزر التخطي (ثواني)" : "Mandatory Watch Before Skip (Seconds)"}
                          </label>
                          <span className="text-[10px] text-zinc-500 block mt-0.5">
                            {lang === "ar" ? "بعد هذه المدة يظهر زر «تخطي الإعلان» للمشاهد" : "Skip button will appear after this duration"}
                          </span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max="60"
                          value={adsSettings.globalSkipAfterSeconds || 5}
                          onChange={(e) => {
                            const val = Number(e.target.value) || 0;
                            const updated = { ...adsSettings, globalSkipAfterSeconds: val };
                            setAdsSettings(updated);
                            saveAdsSettings(updated);
                          }}
                          className="w-20 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-1.5 text-xs text-white font-mono text-center focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="bg-neutral-900/40 border border-neutral-850 rounded-xl p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <label className="text-xs font-bold text-zinc-300 block">
                            {lang === "ar" ? "إمكانية تخطي الإعلانات" : "Allow Skipping Ads"}
                          </label>
                          <span className="text-[10px] text-zinc-500 block mt-0.5">
                            {lang === "ar" ? "السماح للمستخدم بتخطي الإعلان بعد انتهاء الوقت المحدد" : "Allow users to skip after mandatory timer"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = { ...adsSettings, allowSkip: !adsSettings.allowSkip };
                            setAdsSettings(updated);
                            saveAdsSettings(updated);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                            adsSettings.allowSkip 
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                              : "bg-red-500/20 text-red-400 border-red-500/30"
                          }`}
                        >
                          {adsSettings.allowSkip ? (lang === "ar" ? "مسموح" : "Allowed") : (lang === "ar" ? "إجباري" : "Forced")}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Ads Section Header */}
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-amber-400" />
                      <h4 className="text-sm font-bold text-white">
                        {lang === "ar" ? "قائمة الإعلانات المضافة وسيرفرات تشغيلها" : "Configured Pre-Roll Ads & Streaming Servers"}
                      </h4>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        resetAdForm();
                        setShowAdModal(true);
                      }}
                      className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold text-xs rounded-xl transition-all shadow-md shadow-amber-500/10 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{lang === "ar" ? "إضافة إعلان جديد" : "Add New Ad"}</span>
                    </button>
                  </div>

                  {/* Ads Cards List */}
                  {(!adsSettings.ads || adsSettings.ads.length === 0) ? (
                    <div className="bg-neutral-950/50 border border-neutral-900 border-dashed rounded-2xl p-8 text-center space-y-3">
                      <Radio className="w-8 h-8 text-zinc-600 mx-auto" />
                      <p className="text-xs text-zinc-400 font-bold">
                        {lang === "ar" ? "لا توجد إعلانات مضافة حالياً في النظام." : "No pre-roll ads added yet."}
                      </p>
                      <button
                        onClick={() => { resetAdForm(); setShowAdModal(true); }}
                        className="px-4 py-2 bg-neutral-900 hover:bg-neutral-850 text-amber-400 border border-amber-500/30 text-xs font-bold rounded-xl transition-all inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{lang === "ar" ? "إضافة إعلانك الأول الآن" : "Add Your First Ad Now"}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-4">
                      {adsSettings.ads.map((ad, index) => (
                        <div 
                          key={ad.id || index}
                          className={`bg-neutral-950/80 border rounded-2xl p-5 space-y-4 transition-all relative ${
                            ad.isActive ? "border-neutral-850 hover:border-neutral-700" : "border-neutral-900/60 opacity-60"
                          }`}
                        >
                          {/* Ad Top Row */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-900 pb-3">
                            <div className="flex items-center gap-3">
                              {ad.sponsorLogo ? (
                                <img 
                                  src={ad.sponsorLogo} 
                                  alt={ad.sponsorNameAr || "Sponsor"} 
                                  className="w-10 h-10 rounded-xl object-cover bg-neutral-900 border border-neutral-800 shrink-0" 
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-xs shrink-0">
                                  AD
                                </div>
                              )}
                              <div>
                                <div className="flex items-center gap-2">
                                  <h5 className="text-sm font-extrabold text-white">
                                    {lang === "ar" ? (ad.titleAr || ad.titleEn) : (ad.titleEn || ad.titleAr)}
                                  </h5>
                                  <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${
                                    ad.isActive 
                                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                                      : "bg-neutral-800 text-zinc-500 border-neutral-700"
                                  }`}>
                                    {ad.isActive ? (lang === "ar" ? "نشط حالياً" : "Active") : (lang === "ar" ? "معطل" : "Disabled")}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3 text-[11px] text-zinc-400 mt-1">
                                  {ad.sponsorNameAr && (
                                    <span className="font-bold text-amber-400/90">
                                      {lang === "ar" ? `الراعي: ${ad.sponsorNameAr}` : `Sponsor: ${ad.sponsorNameEn || ad.sponsorNameAr}`}
                                    </span>
                                  )}
                                  <span className="text-zinc-600">•</span>
                                  <span>
                                    {ad.targetType === "movie" 
                                      ? (lang === "ar" ? "مستهدف: الأفلام فقط" : "Movies only") 
                                      : ad.targetType === "series" 
                                      ? (lang === "ar" ? "مستهدف: المسلسلات فقط" : "Series only") 
                                      : (lang === "ar" ? "مستهدف: جميع الأعمال" : "All media")}
                                  </span>
                                  <span className="text-zinc-600">•</span>
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-zinc-500" />
                                    <span>{lang === "ar" ? `تخطي بعد: ${ad.skipAfterSeconds}ث` : `Skip after: ${ad.skipAfterSeconds}s`}</span>
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 self-end sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleToggleAdStatus(ad.id)}
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                                  ad.isActive 
                                    ? "bg-neutral-900 text-zinc-400 border-neutral-800 hover:text-white" 
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                                }`}
                              >
                                {ad.isActive ? (lang === "ar" ? "تعطيل الإعلان" : "Disable") : (lang === "ar" ? "تفعيل الإعلان" : "Enable")}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleEditAdClick(ad)}
                                className="p-2 bg-neutral-900 hover:bg-neutral-850 text-zinc-300 hover:text-white border border-neutral-800 rounded-xl transition-all cursor-pointer"
                                title={lang === "ar" ? "تعديل الإعلان والسيرفرات" : "Edit Ad & Servers"}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteAdClick(ad.id)}
                                className="p-2 bg-red-950/20 hover:bg-red-900/30 text-rose-400 border border-red-900/30 rounded-xl transition-all cursor-pointer"
                                title={lang === "ar" ? "حذف الإعلان" : "Delete Ad"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Ad Servers Sub-List */}
                          <div className="space-y-2">
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Layers className="w-3 h-3 text-amber-400" />
                              <span>{lang === "ar" ? "سيرفرات بث مقطع الإعلان المتاحة (" : "Ad Streaming Servers ("}{ad.servers?.length || 0}):</span>
                            </span>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {(ad.servers || []).map((srv, sIdx) => (
                                <div key={srv.id || sIdx} className="bg-neutral-900/50 border border-neutral-850/80 rounded-xl p-2.5 flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                                    <span className="font-bold text-zinc-200 truncate">{srv.name}</span>
                                    <span className="text-[9px] bg-neutral-950 text-zinc-400 border border-neutral-800 px-1.5 py-0.5 rounded font-mono shrink-0 uppercase">
                                      {srv.type || "video"}
                                    </span>
                                  </div>
                                  <a 
                                    href={srv.url} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    className="text-amber-400/80 hover:text-amber-300 transition-colors shrink-0 ml-2"
                                    title={srv.url}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>

                          {ad.sponsorUrl && (
                            <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 pt-1 border-t border-neutral-900/50">
                              <Globe className="w-3 h-3 text-zinc-600" />
                              <span>{lang === "ar" ? "رابط زر الانتقال لموقع الراعي: " : "Sponsor Button Link: "}</span>
                              <a href={ad.sponsorUrl} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline truncate">
                                {ad.sponsorUrl}
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* AD MODAL FOR ADD / EDIT AD & SERVERS */}
            {showAdModal && (
              <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fade-in">
                <div className="bg-neutral-950 border border-neutral-850 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-6 my-8 max-h-[90vh] overflow-y-auto">
                  
                  {/* Modal Header */}
                  <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-bold shrink-0">
                        <Radio className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-extrabold text-white">
                          {editingAdId 
                            ? (lang === "ar" ? "تعديل بيانات الإعلان وسيرفرات البث" : "Edit Ad & Streaming Servers")
                            : (lang === "ar" ? "إضافة إعلان وسيرفرات بث جديدة" : "Add New Ad & Streaming Servers")}
                        </h3>
                        <p className="text-[11px] text-zinc-500">
                          {lang === "ar" ? "حدد تفاصيل الإعلان ومعلومات الراعي وسيرفرات تشغيل الفيديو" : "Configure ad details, sponsor info, and video streaming servers"}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowAdModal(false)}
                      className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-neutral-900 transition-all cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleSaveAdForm} className="space-y-5">
                    
                    {/* Basic Ad Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "عنوان الإعلان (بالعربية)" : "Ad Title (Arabic)"}
                        </label>
                        <input
                          type="text"
                          required
                          value={adFormData.titleAr}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, titleAr: e.target.value }))}
                          placeholder="مثلاً: إعلان سينمانا العرض الذهبي 4K"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "عنوان الإعلان (بالإنجليزية)" : "Ad Title (English)"}
                        </label>
                        <input
                          type="text"
                          value={adFormData.titleEn}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, titleEn: e.target.value }))}
                          placeholder="e.g. Cinemana Gold Premiere Ad"
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Sponsor Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-neutral-900/30 border border-neutral-900 rounded-2xl p-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "اسم الشراكة / الراعي (بالعربية)" : "Sponsor Name (Arabic)"}
                        </label>
                        <input
                          type="text"
                          value={adFormData.sponsorNameAr}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, sponsorNameAr: e.target.value }))}
                          placeholder="مثلاً: سينمانا برو"
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "رابط موقع الراعي (زر زيارة الموقع)" : "Sponsor Website URL"}
                        </label>
                        <input
                          type="url"
                          value={adFormData.sponsorUrl}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, sponsorUrl: e.target.value }))}
                          placeholder="https://sponsor-website.com"
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none font-mono"
                        />
                      </div>

                      <div className="md:col-span-2 space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 flex items-center justify-between">
                          <span>{lang === "ar" ? "رابط شعار الراعي (أو رفع صورة)" : "Sponsor Logo Image URL"}</span>
                          {uploadingAdMedia && <span className="text-[10px] text-amber-400 font-bold animate-pulse">{lang === "ar" ? "جاري الرفع..." : "Uploading..."}</span>}
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={adFormData.sponsorLogo}
                            onChange={(e) => setAdFormData(prev => ({ ...prev, sponsorLogo: e.target.value }))}
                            placeholder="https://images.unsplash.com/... or /uploads/..."
                            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none font-mono"
                          />
                          <label className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-zinc-200 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shrink-0">
                            <Upload className="w-3.5 h-3.5" />
                            <span>{lang === "ar" ? "رفع صورة" : "Upload Logo"}</span>
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={(e) => handleAdFileUpload(e)} 
                              className="hidden" 
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Targeting & Timers */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "مكـان العــرض" : "Target Type"}
                        </label>
                        <select
                          value={adFormData.targetType}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, targetType: e.target.value as "all" | "movie" | "series" }))}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
                        >
                          <option value="all">{lang === "ar" ? "جميع الأفلام والمسلسلات" : "All Movies & Series"}</option>
                          <option value="movie">{lang === "ar" ? "الأفلام فقط" : "Movies Only"}</option>
                          <option value="series">{lang === "ar" ? "المسلسلات فقط" : "Series Only"}</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "انتظار التخطي (ثواني)" : "Skip Timer (Sec)"}
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="60"
                          value={adFormData.skipAfterSeconds}
                          onChange={(e) => setAdFormData(prev => ({ ...prev, skipAfterSeconds: Number(e.target.value) || 0 }))}
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white text-center font-mono focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-zinc-300 block">
                          {lang === "ar" ? "حالة الإعلان" : "Status"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setAdFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                          className={`w-full py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                            adFormData.isActive 
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" 
                              : "bg-neutral-800 text-zinc-400 border-neutral-700"
                          }`}
                        >
                          {adFormData.isActive ? (lang === "ar" ? "مفعل (نشط)" : "Active") : (lang === "ar" ? "معطل" : "Disabled")}
                        </button>
                      </div>
                    </div>

                    {/* AD STREAMING SERVERS SECTION */}
                    <div className="space-y-3 bg-neutral-900/40 border border-neutral-850 rounded-2xl p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Video className="w-4 h-4 text-amber-400" />
                          <h4 className="text-xs font-extrabold text-white">
                            {lang === "ar" ? "سيرفرات تشغيل فيديو الإعلان (Ad Video Servers)" : "Ad Video Streaming Servers"}
                          </h4>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setAdFormData(prev => ({
                              ...prev,
                              servers: [
                                ...prev.servers,
                                { id: `srv_${Date.now()}`, name: `سيرفر بديل ${prev.servers.length + 1}`, url: "", type: "video" }
                              ]
                            }));
                          }}
                          className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{lang === "ar" ? "إضافة سيرفر إعلان" : "Add Ad Server"}</span>
                        </button>
                      </div>

                      <p className="text-[10px] text-zinc-500">
                        {lang === "ar" 
                          ? "يمكنك إدخال روابط سيرفرات إعلانية مباشرة (MP4, HLS, m3u8) أو رفع فيديو الإعلان مباشرة من جهازك." 
                          : "Enter direct ad video URLs (MP4, HLS, m3u8) or upload video files directly."}
                      </p>

                      <div className="space-y-3">
                        {adFormData.servers.map((srv, sIdx) => (
                          <div key={srv.id || sIdx} className="bg-neutral-950 border border-neutral-800 rounded-xl p-3 space-y-2">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                              
                              {/* Server Name */}
                              <div className="md:col-span-4">
                                <input
                                  type="text"
                                  value={srv.name}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAdFormData(prev => {
                                      const updated = [...prev.servers];
                                      updated[sIdx].name = val;
                                      return { ...prev, servers: updated };
                                    });
                                  }}
                                  placeholder="اسم السيرفر e.g. سيرفر الإعلان الرئيسي"
                                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                />
                              </div>

                              {/* Server Type */}
                              <div className="md:col-span-3">
                                <select
                                  value={srv.type || "video"}
                                  onChange={(e) => {
                                    const val = e.target.value as "video" | "hls" | "embed";
                                    setAdFormData(prev => {
                                      const updated = [...prev.servers];
                                      updated[sIdx].type = val;
                                      return { ...prev, servers: updated };
                                    });
                                  }}
                                  className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                                >
                                  <option value="video">MP4 Direct Video</option>
                                  <option value="hls">HLS Stream (.m3u8)</option>
                                  <option value="embed">Embed iFrame</option>
                                </select>
                              </div>

                              {/* Delete Server */}
                              <div className="md:col-span-5 flex items-center justify-end gap-1">
                                <label className="px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-amber-400 rounded-lg text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1">
                                  <Upload className="w-3 h-3" />
                                  <span>{lang === "ar" ? "رفع فيديو" : "Upload Video"}</span>
                                  <input 
                                    type="file" 
                                    accept="video/*" 
                                    onChange={(e) => handleAdFileUpload(e, sIdx)} 
                                    className="hidden" 
                                  />
                                </label>

                                {adFormData.servers.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAdFormData(prev => ({
                                        ...prev,
                                        servers: prev.servers.filter((_, i) => i !== sIdx)
                                      }));
                                    }}
                                    className="p-1.5 text-rose-400 hover:bg-red-950/30 rounded-lg transition-all cursor-pointer"
                                    title={lang === "ar" ? "حذف السيرفر" : "Remove Server"}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Server URL Input */}
                            <div>
                              <input
                                type="text"
                                value={srv.url}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setAdFormData(prev => {
                                    const updated = [...prev.servers];
                                    updated[sIdx].url = val;
                                    return { ...prev, servers: updated };
                                  });
                                }}
                                placeholder="رابط سيرفر فيديو الإعلان e.g. https://.../ad.mp4"
                                className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Submit Buttons */}
                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-900">
                      <button
                        type="button"
                        onClick={() => setShowAdModal(false)}
                        className="px-4 py-2 bg-neutral-900 hover:bg-neutral-850 text-zinc-400 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                      >
                        {lang === "ar" ? "إلغاء" : "Cancel"}
                      </button>

                      <button
                        type="submit"
                        disabled={isLoading || uploadingAdMedia}
                        className="px-5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-extrabold text-xs rounded-xl transition-all shadow-lg shadow-amber-500/10 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        <span>{lang === "ar" ? "حفظ الإعلان وسيرفرات البث" : "Save Ad & Servers"}</span>
                      </button>
                    </div>

                  </form>
                </div>
              </div>
            )}
          </>
        )}

        {/* Virtual Keyboard Modal Overlay */}
        {showKeyboardModal && keyboardModalTarget && (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white animate-fade-in">
            <div className="w-full max-w-3xl bg-neutral-950 border border-neutral-850 rounded-3xl p-6 shadow-2xl space-y-6">
              
              {/* Input Details */}
              <div className="space-y-2 text-center">
                <span className="text-xs font-bold text-red-500 uppercase tracking-widest">
                  {lang === "ar" ? "لوحة المفاتيح الافتراضية" : "ON-SCREEN VIRTUAL KEYBOARD"}
                </span>
                <h3 className="text-sm font-bold text-zinc-400">
                  {keyboardModalTarget.label}
                </h3>
                
                {/* Active Input Box */}
                <div className="relative max-w-xl mx-auto mt-4">
                  <input
                    type="text"
                    readOnly
                    value={keyboardValue}
                    className="w-full bg-neutral-900 border-2 border-zinc-800 rounded-2xl px-5 py-4 text-center text-lg font-bold text-white focus:outline-none tracking-wide"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-red-500 animate-pulse" />
                </div>
              </div>

              {/* Grid of keys */}
              <div className="space-y-2 max-w-2xl mx-auto">
                {(keyboardLang === "ar" ? arabicKeys : englishKeys).map((row, rIdx) => (
                  <div key={rIdx} className="flex justify-center gap-1.5">
                    {row.map((key, cIdx) => {
                      const isKeyFocused = keyboardFocusedKey.row === rIdx && keyboardFocusedKey.col === cIdx;
                      return (
                        <button
                          key={cIdx}
                          type="button"
                          onClick={() => {
                            setKeyboardFocusedKey({ row: rIdx, col: cIdx });
                            setKeyboardValue(prev => prev + key);
                          }}
                          className={`w-11 h-11 rounded-xl text-xs font-extrabold flex items-center justify-center transition-all duration-150 transform ${
                            isKeyFocused
                              ? "bg-red-600 text-white ring-4 ring-red-500/50 scale-110 z-10 shadow-lg"
                              : "bg-neutral-900 hover:bg-neutral-850 text-zinc-300 border border-neutral-800"
                          }`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* Actions Row (rIdx = 5) */}
                <div className="flex justify-center gap-2 pt-4 border-t border-neutral-900 mt-4">
                  {[
                    { idx: 0, labelAr: "مسافة", labelEn: "Space", width: "w-32" },
                    { idx: 1, labelAr: "تراجع", labelEn: "Backspace", width: "w-32" },
                    { idx: 2, labelAr: keyboardLang === "ar" ? "English" : "العربية", labelEn: keyboardLang === "ar" ? "English" : "العربية", width: "w-36" },
                    { idx: 3, labelAr: "حفظ وإغلاق ✔", labelEn: "Done & Save ✔", width: "w-44" }
                  ].map((btn) => {
                    const isBtnFocused = keyboardFocusedKey.row === 5 && keyboardFocusedKey.col === btn.idx;
                    return (
                      <button
                        key={btn.idx}
                        type="button"
                        onClick={() => {
                          setKeyboardFocusedKey({ row: 5, col: btn.idx });
                          if (btn.idx === 0) {
                            setKeyboardValue(prev => prev + " ");
                          } else if (btn.idx === 1) {
                            setKeyboardValue(prev => prev.slice(0, -1));
                          } else if (btn.idx === 2) {
                            setKeyboardLang(prev => prev === "ar" ? "en" : "ar");
                          } else if (btn.idx === 3) {
                            keyboardModalTarget.onChange(keyboardValue);
                            setShowKeyboardModal(false);
                          }
                        }}
                        className={`${btn.width} h-11 rounded-xl text-xs font-black transition-all duration-150 transform flex items-center justify-center ${
                          isBtnFocused
                            ? "bg-red-600 text-white ring-4 ring-red-500/50 scale-105 z-10 shadow-lg"
                            : "bg-neutral-900 hover:bg-neutral-850 text-zinc-400 border border-neutral-850"
                        }`}
                      >
                        {lang === "ar" ? btn.labelAr : btn.labelEn}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Info Tip */}
              <div className="text-center text-[10px] text-zinc-600">
                {lang === "ar"
                  ? "استخدم أزرار الاتجاهات للتنقل، و زر OK للتحديد. اضغط BACK للإغلاق دون حفظ."
                  : "Use remote arrow keys to navigate and OK to select. Press BACK to close without saving."}
              </div>

            </div>
          </div>
        )}

        {/* Custom Delete Confirmation Modal */}
        {deleteConfirmState.show && (
          <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 text-white animate-fade-in">
            <div className="w-full max-w-md bg-neutral-950 border border-neutral-850 rounded-3xl p-6 shadow-2xl text-center space-y-6">
              
              {/* Icon & Title */}
              <div className="mx-auto w-14 h-14 rounded-full bg-rose-950/40 border border-rose-900/30 flex items-center justify-center text-rose-500 animate-bounce">
                <Trash2 className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  {lang === "ar" ? "تأكيد حذف العنصر" : "Confirm Deletion Request"}
                </h3>
                <p className="text-xs text-zinc-400">
                  {lang === "ar"
                    ? `هل أنت متأكد تماماً من رغبتك في حذف "${deleteConfirmState.name}"؟ لا يمكن التراجع عن هذا الإجراء.`
                    : `Are you sure you want to delete "${deleteConfirmState.name}"? This action cannot be undone.`}
                </p>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => {
                    if (deleteConfirmState.type === "movie") {
                      executeDeleteMovie(deleteConfirmState.id);
                    } else {
                      executeDeletePromo(deleteConfirmState.id);
                    }
                  }}
                  className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${
                    confirmModalFocus === "confirm"
                      ? "bg-red-600 text-white ring-4 ring-red-500/50 scale-105"
                      : "bg-neutral-900 hover:bg-neutral-850 text-zinc-400 border border-neutral-800"
                  }`}
                >
                  {lang === "ar" ? "نعم، حذف نهائي" : "Yes, Delete Permanently"}
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteConfirmState({ show: false, type: "movie", id: "", name: "" })}
                  className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    confirmModalFocus === "cancel"
                      ? "bg-white text-black ring-4 ring-white/50 scale-105"
                      : "bg-neutral-900 hover:bg-neutral-850 text-zinc-400 border border-neutral-800"
                  }`}
                >
                  {lang === "ar" ? "تراجع وإلغاء" : "Cancel & Return"}
                </button>
              </div>

              {/* Tip */}
              <div className="text-[9px] text-zinc-600">
                {lang === "ar"
                  ? "استخدم الأزرار الجانبية للتنقل، وزر OK للتأكيد."
                  : "Use left/right buttons to toggle, and OK to select."}
              </div>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
