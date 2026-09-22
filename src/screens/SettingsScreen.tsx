import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, StyleSheet, findNodeHandle, NativeEventEmitter, NativeModules, Linking, ToastAndroid, ActivityIndicator } from "react-native";
import { Check, Settings as SettingsIcon, Captions, ChevronLeft, Download, RefreshCw } from "lucide-react-native";
import Focusable from "../components/Focusable";
import { useFocusClamp } from "../useFocusClamp";
import { colors, font, focusShadowTight, radius, spacing } from "../theme";
import { s, fs, UI_SCALE_OPTIONS } from "../scale";
import { Lang, t } from "../i18n";
import { useSidebarHomeHandle } from "../focusRefs";
import { pushBackHandler } from "../backStack";
import { fetchAppUpdate, AppUpdateInfo } from "../api";
import { CURRENT_VERSION_CODE, CURRENT_VERSION_NAME } from "../appVersion";
import { downloadAndInstallApk, isApkUpdaterAvailable, subscribeApkUpdaterEvents } from "../apkUpdater";
import {
  SUBTITLE_FONTS,
  SUBTITLE_SIZES,
  SUBTITLE_COLORS,
  SubtitleSettings,
  SubtitleFontKey,
  SubtitleSizeKey,
  subtitleFontFamily,
  subtitleFontSize,
  SubtitleLanguage,
} from "../subtitleSettings";

type Tab = "system" | "subtitles";

interface Props {
  lang: Lang;
  onChangeLang: (lang: Lang) => void;
  subtitleSettings: SubtitleSettings;
  onChangeSubtitleSettings: (settings: SubtitleSettings) => void;
  uiScale: number;
  onChangeUiScale: (scale: number) => void;
  onBack: () => void;
  // True only while `section === "settings"` in App.tsx - this component actually stays mounted
  // (hidden via style, never unmounted) for as long as a video isn't playing, the same "keep it
  // warm" treatment Library gets, for the exact reason documented at that render site: switching
  // back to Settings used to mean a full remount every time. The one thing that treatment doesn't
  // account for on its own is *this* screen's own back-handler push effect below - see its own
  // comment for why `active` has to gate it directly.
  active: boolean;
}

// A handful of *named*, fixed focus targets (not a variable-length list, so useFocusClamp's
// index-based version doesn't fit) - same "collect native handles once every ref has mounted,
// force one extra render" pattern Sidebar and useFocusClamp both already use. Used to wire an
// explicit up/down chain between rows/nav items and an explicit self-referencing left/right
// clamp, instead of trusting Android's geometric guess - which is what let a press escape to
// the wrong place (or find nothing at all) throughout this screen.
function useHandleGroup<K extends string>(keys: readonly K[]) {
  const nodes = useRef<Partial<Record<K, View | null>>>({});
  const [, setBump] = useState(0);
  const triggeredRef = useRef(false);

  const setRefFns = useRef<Partial<Record<K, (node: View | null) => void>> | null>(null);
  if (setRefFns.current === null) {
    const fns: Partial<Record<K, (node: View | null) => void>> = {};
    keys.forEach((key, i) => {
      fns[key] = (node: View | null) => {
        nodes.current[key] = node;
        if (i === keys.length - 1 && node && !triggeredRef.current) {
          triggeredRef.current = true;
          setBump((b) => b + 1);
        }
      };
    });
    setRefFns.current = fns;
  }

  return {
    setRef: (key: K) => setRefFns.current![key]!,
    handleOf: (key: K): number | undefined => {
      const node = nodes.current[key];
      return node ? findNodeHandle(node) ?? undefined : undefined;
    },
  };
}

const NAV_KEYS = ["system", "subtitles"] as const;
const SYSTEM_KEYS = ["lang", "uiSize", "update"] as const;
const SUBTITLE_KEYS = ["language", "font", "size", "color", "background"] as const;

// Two-pane layout (a fixed nav rail + a scrollable content panel) instead of pill tabs across
// the top - closer to how an actual TV settings app (or System Preferences) is organized, and
// gives the tab list room to grow past two entries without crowding a single row.
export default function SettingsScreen({ lang, onChangeLang, subtitleSettings, onChangeSubtitleSettings, uiScale, onChangeUiScale, onBack, active }: Props) {
  const [tab, setTab] = useState<Tab>("system");
  const patch = (partial: Partial<SubtitleSettings>) => onChangeSubtitleSettings({ ...subtitleSettings, ...partial });

  // LEFT reaches the nav rail (system/subtitles) from anywhere in the content panel below - see
  // each control's own nextFocusLeft - and from the nav rail itself reaches the app's outer
  // sidebar (still mounted behind this screen), the same as any other screen's leftmost column.
  // The hardware back button remains a second, always-available way out regardless of where
  // focus happens to be.
  // Pushed onto the shared backStack (see src/backStack.ts's own top comment) instead of calling
  // BackHandler.addEventListener directly - same reasoning as MovieDetailsScreen's identical
  // handler. Explicitly gated on `active` (NOT just mount/unmount) - this screen actually stays
  // mounted (hidden via style) for as long as a video isn't playing, regardless of which section
  // is showing (see App.tsx's own "keep it warm" comment at its render site), so a plain
  // mount-time push here would re-register on *every* play/exit round trip no matter which
  // section the viewer was actually looking at, landing back on top of whatever real screen (e.g.
  // MovieDetailsScreen) is still mounted underneath it. Reported as "back does nothing after
  // playing a movie, works fine after visiting a cast member instead" - a cast member's own
  // PersonScreen never touches `playing` at all, so this remount (and the stale re-push) never
  // happened on that path, which is exactly why the two cases behaved differently. A previous fix
  // already solved the closely related "Settings intercepts back *during* playback" bug (by
  // unmounting this screen for the duration of `playing`, see App.tsx) but didn't cover this
  // one - unmounting for playback and remounting after doesn't by itself know whether Settings is
  // the section actually being returned to.
  useEffect(() => {
    if (!active) return;
    return pushBackHandler(() => {
      onBack();
      return true;
    }, "SettingsScreen");
  }, [onBack, active]);

  const homeHandle = useSidebarHomeHandle();
  const nav = useHandleGroup(NAV_KEYS);
  const system = useHandleGroup(SYSTEM_KEYS);
  const subtitle = useHandleGroup(SUBTITLE_KEYS);
  // Same fix as SegmentedControl/StopsSlider above, just for the color swatch row specifically
  // (a plain row of same-sized buttons at this call site, not its own reusable component) -
  // every swatch gets an explicit handle to its neighbor instead of only the first one.
  const swatchClamp = useFocusClamp(SUBTITLE_COLORS.length);

  return (
    <View style={styles.root}>
      <View style={styles.nav}>
        <Text style={styles.pageTitle}>{t("settings", lang)}</Text>
        <NavItem
          ref={nav.setRef("system")}
          label={t("settingsTabSystem", lang)}
          Icon={SettingsIcon}
          active={tab === "system"}
          onPress={() => setTab("system")}
          hasTVPreferredFocus
          nextFocusUp={nav.handleOf("system")}
          nextFocusDown={nav.handleOf("subtitles")}
          nextFocusLeft={homeHandle ?? undefined}
        />
        <NavItem
          ref={nav.setRef("subtitles")}
          label={t("settingsTabSubtitles", lang)}
          Icon={Captions}
          active={tab === "subtitles"}
          onPress={() => setTab("subtitles")}
          nextFocusUp={nav.handleOf("system")}
          nextFocusDown={nav.handleOf("subtitles")}
          nextFocusLeft={homeHandle ?? undefined}
        />
      </View>

      <View style={styles.panel}>
        {tab === "system" ? (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <SettingsCard title={t("settingsLanguage", lang)} description={t("settingsLanguageDesc", lang)}>
              <SettingsRow>
                <SegmentedControl
                  ref={system.setRef("lang")}
                  options={[
                    { key: "ar", label: t("settingsArabic", lang) },
                    { key: "en", label: t("settingsEnglish", lang) },
                  ]}
                  value={lang}
                  onChange={onChangeLang}
                  nextFocusUp={system.handleOf("lang")}
                  nextFocusDown={system.handleOf("uiSize")}
                  nextFocusLeft={nav.handleOf("system")}
                />
              </SettingsRow>
            </SettingsCard>

            {/* Three automatic per-device size formulas each got some real device wrong in a
                different way - this hands the choice to the viewer instead. It can't apply
                live (every screen's styles are computed once, the moment that screen is first
                opened - see scale.ts) so the note below is doing real work, not just being
                cautious: silently doing nothing until a reopen would read as a broken button. */}
            <SettingsCard title={t("settingsUiSize", lang)} description={t("settingsUiSizeDesc", lang)}>
              <SettingsRow>
                <StopsSlider
                  ref={system.setRef("uiSize")}
                  count={UI_SCALE_OPTIONS.length}
                  index={Math.max(0, UI_SCALE_OPTIONS.indexOf(uiScale))}
                  onChange={(i) => onChangeUiScale(UI_SCALE_OPTIONS[i])}
                  valueLabel={`${Math.round(uiScale * 100)}%`}
                  nextFocusUp={system.handleOf("lang")}
                  nextFocusDown={system.handleOf("update")}
                  nextFocusLeft={nav.handleOf("system")}
                />
              </SettingsRow>
            </SettingsCard>
            <Text style={styles.uiScaleNote}>
              {lang === "ar"
                ? "سيقوم التطبيق بإعادة التشغيل تلقائيًا عند الخروج من الإعدادات لتطبيق الحجم الجديد."
                : "The app will restart automatically when you leave Settings to apply the new size."}
            </Text>

            <UpdateRow
              ref={system.setRef("update")}
              lang={lang}
              nextFocusUp={system.handleOf("uiSize")}
              nextFocusLeft={nav.handleOf("system")}
            />
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>{t("subtitlePreview", lang)}</Text>
              <View style={styles.previewFrame}>
                <Text
                  style={[
                    styles.previewText,
                    {
                      fontFamily: subtitleFontFamily(subtitleSettings.font),
                      fontSize: subtitleFontSize(subtitleSettings.size),
                      color: subtitleSettings.color,
                      backgroundColor: subtitleSettings.background ? "rgba(0,0,0,0.6)" : "transparent",
                    },
                  ]}
                >
                  {t("subtitlePreview", lang)}
                </Text>
              </View>
            </View>

            <SettingsCard title={t("settingsTabSubtitles", lang)} description={t("subtitleGroupDesc", lang)}>
              <SettingsRow title={t("subtitleLanguage", lang)} description={t("subtitleLanguageDesc", lang)}>
                <SegmentedControl
                  ref={subtitle.setRef("language")}
                  options={[
                    { key: "ar", label: "العربية" },
                    { key: "en", label: "English" },
                  ]}
                  value={subtitleSettings.language ?? "ar"}
                  onChange={(key) => patch({ language: key as SubtitleLanguage })}
                  nextFocusUp={subtitle.handleOf("language")}
                  nextFocusDown={subtitle.handleOf("font")}
                  nextFocusLeft={nav.handleOf("subtitles")}
                />
              </SettingsRow>

              <SettingsRow title={t("subtitleFont", lang)} description={t("subtitleFontDesc", lang)}>
                <SegmentedControl
                  ref={subtitle.setRef("font")}
                  options={SUBTITLE_FONTS.map((f) => ({ key: f.key, label: lang === "ar" ? f.labelAr : f.labelEn, fontFamily: f.family }))}
                  value={subtitleSettings.font}
                  onChange={(key) => patch({ font: key as SubtitleFontKey })}
                  nextFocusUp={subtitle.handleOf("language")}
                  nextFocusDown={subtitle.handleOf("size")}
                  nextFocusLeft={nav.handleOf("subtitles")}
                />
              </SettingsRow>

              <SettingsRow title={t("subtitleSize", lang)} description={t("subtitleSizeDesc", lang)}>
                <StopsSlider
                  ref={subtitle.setRef("size")}
                  count={SUBTITLE_SIZES.length}
                  index={Math.max(0, SUBTITLE_SIZES.findIndex((sz) => sz.key === subtitleSettings.size))}
                  onChange={(i) => patch({ size: SUBTITLE_SIZES[i].key as SubtitleSizeKey })}
                  valueLabel={lang === "ar" ? SUBTITLE_SIZES.find((sz) => sz.key === subtitleSettings.size)?.labelAr ?? "" : SUBTITLE_SIZES.find((sz) => sz.key === subtitleSettings.size)?.labelEn ?? ""}
                  nextFocusUp={subtitle.handleOf("font")}
                  nextFocusDown={subtitle.handleOf("color")}
                  nextFocusLeft={nav.handleOf("subtitles")}
                />
              </SettingsRow>

              <SettingsRow title={t("subtitleColor", lang)} description={t("subtitleColorDesc", lang)}>
                <View style={styles.swatchRow}>
                  {SUBTITLE_COLORS.map((c, i) => (
                    <ColorSwatch
                      key={c}
                      ref={(node) => {
                        swatchClamp.setRef(i)(node);
                        if (i === 0) subtitle.setRef("color")(node);
                      }}
                      color={c}
                      active={subtitleSettings.color === c}
                      onPress={() => patch({ color: c })}
                      nextFocusUp={subtitle.handleOf("size")}
                      nextFocusDown={subtitle.handleOf("background")}
                      nextFocusLeft={i === 0 ? nav.handleOf("subtitles") : swatchClamp.handleOf(i - 1)}
                      nextFocusRight={i === SUBTITLE_COLORS.length - 1 ? swatchClamp.clampRight() : swatchClamp.handleOf(i + 1)}
                    />
                  ))}
                </View>
              </SettingsRow>

              <SettingsRow title={t("subtitleBackgroundTitle", lang)} description={t("subtitleBackground", lang)}>
                <ToggleSwitch
                  ref={subtitle.setRef("background")}
                  value={subtitleSettings.background}
                  onChange={(v) => patch({ background: v })}
                  nextFocusUp={subtitle.handleOf("color")}
                  nextFocusDown={subtitle.handleOf("background")}
                  nextFocusLeft={nav.handleOf("subtitles")}
                />
              </SettingsRow>
            </SettingsCard>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const NavItem = React.forwardRef<
  View,
  {
    label: string;
    Icon: typeof SettingsIcon;
    active: boolean;
    onPress: () => void;
    hasTVPreferredFocus?: boolean;
    nextFocusUp?: number;
    nextFocusDown?: number;
    nextFocusLeft?: number;
  }
>(function NavItem({ label, Icon, active, onPress, hasTVPreferredFocus, nextFocusUp, nextFocusDown, nextFocusLeft }, ref) {
  return (
    <Focusable
      ref={ref}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      scaleTo={1.02}
      focusRadius={s(10)}
      clipFocusOverflow
    >
      {(focused: boolean) => (
        // No focusShadowTight here - navItemFocused already turns this solid white, so a white
        // glow behind an already-white fill is invisible at best and, on at least one real
        // device, rendered as a visible diagonal hatch artifact instead of a smooth glow
        // (reported as "the highlight is a plain white square with straight edges"). The glow
        // is only ever meaningful against a fill that *isn't* already the same color as it.
        <View style={[styles.navItem, active && !focused && styles.navItemActive, focused && styles.navItemFocused]}>
          {/* A leading accent bar instead of a filled pill for the active-but-unfocused state -
              reads as "this is the open section" without competing visually with the white
              filled state a focused row also uses. */}
          <View style={[styles.navItemAccent, active && styles.navItemAccentActive]} />
          <View style={[styles.navItemIconWrap, active && styles.navItemIconWrapActive, focused && styles.navItemIconWrapFocused]}>
            <Icon size={s(17)} color={focused ? "#000" : active ? "#fff" : colors.textMuted} strokeWidth={2.1} />
          </View>
          <Text style={[styles.navItemText, active && styles.navItemTextActive, focused && styles.navItemTextFocused]} numberOfLines={1}>
            {label}
          </Text>
          <ChevronLeft
            size={s(15)}
            color={focused ? "#000" : active ? "#fff" : "transparent"}
            style={styles.navItemChevron}
          />
        </View>
      )}
    </Focusable>
  );
});

type UpdateState = "idle" | "checking" | "upToDate" | "available" | "downloading" | "installPrompted" | "error";

// A single row, not a separate "check" button plus a separate "download" button - one Focusable
// with one focus handle to wire, matching every other single-control row on this screen (see this
// file's own top comment on why explicit nextFocus* chains are used at all here). Pressing it
// means whatever it currently says: "check for update" while idle, "download vX" once a newer
// build is confirmed available. Manual-only (no check on app launch) - this screen already has a
// documented history of startup-timing bugs (see App.tsx's own dataReady comment) not worth
// risking for a background check nothing is currently waiting on.
const UpdateRow = React.forwardRef<
  View,
  { lang: Lang; nextFocusUp?: number; nextFocusLeft?: number }
>(function UpdateRow({ lang, nextFocusUp, nextFocusLeft }, ref) {
  const [state, setState] = useState<UpdateState>("idle");
  const [info, setInfo] = useState<AppUpdateInfo | null>(null);
  const [progress, setProgress] = useState(0);
  // Cleared on unmount and on every fresh download attempt - see download()'s own watchdog
  // comment for why this exists at all.
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearStallTimer = () => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
  };
  useEffect(() => clearStallTimer, []);

  const check = async () => {
    setState("checking");
    try {
      const result = await fetchAppUpdate();
      setInfo(result);
      setState(result.versionCode > CURRENT_VERSION_CODE ? "available" : "upToDate");
    } catch {
      setState("error");
    }
  };

  // Opens the browser instead - used both as the very first attempt on a device with no
  // ApkUpdater module (shouldn't happen on a build that includes it, but costs nothing to guard)
  // and as the fallback if the native download/install path itself fails partway through.
  const openInBrowser = (url: string) => {
    Linking.openURL(url).catch(() => {
      ToastAndroid.show(lang === "ar" ? "تعذّر فتح رابط التنزيل" : "Could not open the download link", ToastAndroid.SHORT);
    });
    ToastAndroid.show(
      lang === "ar" ? "يُفتح رابط التنزيل في المتصفح..." : "Opening the download link in your browser...",
      ToastAndroid.SHORT
    );
  };

  const download = (targetInfo: AppUpdateInfo) => {
    if (!isApkUpdaterAvailable()) {
      openInBrowser(targetInfo.url);
      return;
    }
    setState("downloading");
    setProgress(0);
    // A download that genuinely fails (dead link, DownloadManager rejecting the request outright)
    // fires the native side's own "error" event, already handled below - but a download that gets
    // silently stuck (queued/paused and never actually transferring a single byte, seen on some TV
    // boxes' own restricted DownloadManager) fires nothing at all: no error, just a progress bar
    // that never moves, with no way out but force-closing the app. This watchdog is what actually
    // ends that: any real forward progress (a "progress" event reporting more bytes than last time)
    // pushes the deadline back out; if STALL_TIMEOUT_MS ever passes with zero forward progress
    // since the download started (or since it last moved), it's treated as failed and falls back
    // to the browser exactly like a real error would.
    const STALL_TIMEOUT_MS = 15000;
    let lastDownloaded = 0;
    const armStallTimer = () => {
      clearStallTimer();
      stallTimerRef.current = setTimeout(() => {
        unsubscribe();
        ToastAndroid.show(
          lang === "ar" ? "التنزيل عالق - يُفتح المتصفح بدلاً منه..." : "The download stalled - opening the browser instead...",
          ToastAndroid.SHORT
        );
        openInBrowser(targetInfo.url);
      }, STALL_TIMEOUT_MS);
    };
    armStallTimer();
    const unsubscribe = subscribeApkUpdaterEvents((event) => {
      if (event.type === "progress") {
        if (event.total > 0) setProgress(event.downloaded / event.total);
        if (event.downloaded > lastDownloaded) {
          lastDownloaded = event.downloaded;
          armStallTimer();
        }
      } else if (event.type === "installPrompted") {
        clearStallTimer();
        setState("installPrompted");
        unsubscribe();
      } else if (event.type === "error") {
        // The download itself failed (network, blocked DownloadManager on this device, etc.) -
        // the browser is the one path that has to work regardless of what's wrong with the
        // native one, so it's the fallback rather than just showing an error dead end. The real
        // message is surfaced too (not just a generic "failed") - the native side's own error
        // used to vanish the instant this silently jumped to the browser, so a device where
        // *neither* path works had nothing concrete left to report back.
        clearStallTimer();
        unsubscribe();
        ToastAndroid.show(event.message.slice(0, 120), ToastAndroid.LONG);
        openInBrowser(targetInfo.url);
      }
    });
    downloadAndInstallApk(targetInfo.url, "ctv-plus-update.apk").catch((err) => {
      clearStallTimer();
      unsubscribe();
      ToastAndroid.show(String(err?.message ?? err).slice(0, 120), ToastAndroid.LONG);
      openInBrowser(targetInfo.url);
    });
  };

  const handlePress = () => {
    if (state === "checking" || state === "downloading") return;
    if (state === "installPrompted") {
      // Pressing again after the installer already opened once just re-offers it - the installer
      // screen itself may have been backed out of by accident, or the APK simply isn't installed
      // yet because the viewer hasn't acted on that prompt.
      if (info) download(info);
      return;
    }
    if (state === "available" && info) {
      download(info);
      return;
    }
    check();
  };

  const notes = lang === "ar" ? info?.notesAr : info?.notesEn;
  const statusText = (() => {
    switch (state) {
      case "checking":
        return lang === "ar" ? "جارٍ التحقق..." : "Checking...";
      case "upToDate":
        return lang === "ar" ? "التطبيق محدّث لآخر إصدار" : "You're on the latest version";
      case "available":
        return lang === "ar" ? `إصدار جديد متاح: v${info?.versionName}` : `New version available: v${info?.versionName}`;
      case "downloading":
        return lang === "ar" ? `جارٍ التنزيل... ${Math.round(progress * 100)}%` : `Downloading... ${Math.round(progress * 100)}%`;
      case "installPrompted":
        return lang === "ar" ? "اكتمل التنزيل - تابع التثبيت من النافذة التي ظهرت" : "Download complete - continue from the install prompt";
      case "error":
        return lang === "ar" ? "تعذّر التحقق من التحديثات" : "Couldn't check for updates";
      default:
        return lang === "ar" ? "اضغط للتحقق من وجود تحديث جديد" : "Press to check for a new update";
    }
  })();

  return (
    <Focusable
      ref={ref}
      onPress={handlePress}
      nextFocusUp={nextFocusUp}
      nextFocusDown={undefined}
      nextFocusLeft={nextFocusLeft}
      scaleTo={1}
      focusRadius={s(14)}
      clipFocusOverflow
    >
      {(focused: boolean) => (
        <View style={[styles.versionCard, focused && styles.versionCardFocused]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.versionLabel, focused && styles.versionLabelFocused]}>
              {lang === "ar" ? "الإصدار الحالي" : "Current version"} · v{CURRENT_VERSION_NAME}
            </Text>
            <Text
              style={[
                styles.versionValue,
                focused && styles.versionValueFocused,
                (state === "available" || state === "installPrompted") && styles.versionValueAvailable,
              ]}
            >
              {statusText}
            </Text>
            {state === "downloading" && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} />
              </View>
            )}
            {state === "available" && !!notes && (
              <Text style={[styles.versionNotes, focused && styles.versionValueFocused]} numberOfLines={2}>
                {notes}
              </Text>
            )}
          </View>
          {state === "checking" || state === "downloading" ? (
            <ActivityIndicator color={focused ? "#000" : "#fff"} size="small" />
          ) : state === "available" || state === "installPrompted" ? (
            <Download size={s(18)} color={focused ? "#000" : "#fff"} strokeWidth={2.2} />
          ) : (
            <RefreshCw size={s(16)} color={focused ? "#000" : colors.textMuted} strokeWidth={2.2} />
          )}
        </View>
      )}
    </Focusable>
  );
});

// One card per settings group - a bold title + gray description at the top (matches the
// referenced subtitle-settings design), then each individual setting as its own row below,
// separated by a hairline divider instead of every control living in its own boxed section.
function SettingsCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const rows = React.Children.toArray(children);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {!!description && <Text style={styles.cardDescription}>{description}</Text>}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={[styles.settingsRow, i === rows.length - 1 && styles.settingsRowLast]}>
          {row}
        </View>
      ))}
    </View>
  );
}

// A row's own title+description is optional - the language/UI-size cards above only have one
// setting each, so their own row skips a second, redundant label and just holds the control.
function SettingsRow({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <>
      {!!title && (
        <View style={styles.settingsRowText}>
          <Text style={styles.settingsRowTitle}>{title}</Text>
          {!!description && <Text style={styles.settingsRowDesc}>{description}</Text>}
        </View>
      )}
      <View style={styles.settingsRowControl}>{children}</View>
    </>
  );
}

interface SegmentedControlProps<T extends string> {
  options: { key: T; label: string; fontFamily?: string }[];
  value: T;
  onChange: (key: T) => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
}
// React.forwardRef's own type declaration can't express a generic <T> - this is the standard
// workaround (a plain forwardRef call, cast to a generic function type), needed since the same
// component renders both the 2-option language row and the 4-option font row.
//
// Same fix as StopsSlider just above: every option now gets an explicit handle to its immediate
// neighbor instead of only option 0 having any wiring at all (and even that never covered
// right) - previously left/right between options past the first relied entirely on Android's
// geometric guess.
const SegmentedControl = React.forwardRef(function SegmentedControl<T extends string>(
  { options, value, onChange, nextFocusUp, nextFocusDown, nextFocusLeft }: SegmentedControlProps<T>,
  ref: React.Ref<View>
) {
  const optionRefs = useRef<Array<View | null>>([]);
  const [, setBump] = useState(0);
  const triggeredRef = useRef(false);
  const setOptionRefFns = useRef<Array<(node: View | null) => void> | null>(null);
  if (setOptionRefFns.current === null || setOptionRefFns.current.length !== options.length) {
    triggeredRef.current = false;
    setOptionRefFns.current = options.map((_, i) => (node: View | null) => {
      optionRefs.current[i] = node;
      if (i === options.length - 1 && node && !triggeredRef.current) {
        triggeredRef.current = true;
        setBump((b) => b + 1);
      }
    });
  }
  const optionHandleOf = (i: number): number | undefined => {
    const node = optionRefs.current[i];
    return node ? findNodeHandle(node) ?? undefined : undefined;
  };

  return (
    <View style={styles.segmented}>
      {options.map((opt, i) => (
        <Focusable
          key={opt.key}
          ref={(node) => {
            setOptionRefFns.current![i](node);
            if (i === 0 && typeof ref === "function") ref(node);
            else if (i === 0 && ref && "current" in ref) (ref as React.MutableRefObject<View | null>).current = node;
          }}
          onPress={() => onChange(opt.key)}
          hasTVPreferredFocus={value === opt.key}
          nextFocusUp={nextFocusUp}
          nextFocusDown={nextFocusDown}
          nextFocusLeft={i === 0 ? nextFocusLeft : optionHandleOf(i - 1)}
          nextFocusRight={i === options.length - 1 ? optionHandleOf(i) : optionHandleOf(i + 1)}
          scaleTo={1.04}
          focusRadius={radius.pill}
          clipFocusOverflow
        >
          {(focused: boolean) => (
            // See navItem's own comment above - segmentItemFocused already turns this solid
            // white, so the glow is redundant (and was the actual cause of the reported
            // artifact on this exact language-toggle pill).
            <View style={[styles.segmentItem, value === opt.key && !focused && styles.segmentItemActive, focused && styles.segmentItemFocused]}>
              <Text
                style={[
                  styles.segmentText,
                  value === opt.key && styles.segmentTextActive,
                  focused && styles.segmentTextFocused,
                  opt.fontFamily ? { fontFamily: opt.fontFamily } : null,
                ]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </View>
          )}
        </Focusable>
      ))}
    </View>
  );
}) as <T extends string>(props: SegmentedControlProps<T> & { ref?: React.Ref<View> }) => React.ReactElement;

// A slider look for a genuinely discrete set of options (subtitle size, UI scale) - real
// continuous dragging isn't reachable from a D-pad at all on this RN version (see VideoPlayer's
// SeekBar for the full explanation).
//
// This used to be a row of up to 8 tiny (22px) invisible focusable "stops," moved between via
// explicit nextFocusLeft/Right wiring on each one - reported as "control is bad" even after that
// wiring was made complete, because landing D-pad focus precisely on one small target among many
// is inherently fragile on Android TV, and every hop in an N-stop chain is one more place for a
// stale handle or a geometry quirk to lose the thread. This is now a *single* focusable control
// (trivial to land on, same as any other row) - held focus captures raw left/right the same way
// VideoPlayer's seek bar does (via KeyEventBridgeModule/MainActivity.kt, since stock React
// Native has no JS-level way to tell a directional press apart from ordinary focus movement) and
// steps the value directly, with no focus hop - and thus no broken-chain risk - involved at all.
const StopsSlider = React.forwardRef<
  View,
  {
    count: number;
    index: number;
    onChange: (i: number) => void;
    valueLabel: string;
    nextFocusUp?: number;
    nextFocusDown?: number;
    nextFocusLeft?: number;
  }
>(function StopsSlider({ count, index, onChange, valueLabel, nextFocusUp, nextFocusDown, nextFocusLeft }, ref) {
  const pct = count > 1 ? (index / (count - 1)) * 100 : 0;
  const indexRef = useRef(index);
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) return;
    const { KeyEventBridge } = NativeModules;
    // Renamed on the native side (see KeyEventBridgeModule.kt) when VideoPlayer's own left/right
    // capture became conditional on which of its controls is focused - this call site only ever
    // needed the left/right half of what used to be one combined flag, never OK/select.
    KeyEventBridge?.setLeftRightSeekActive(true);
    const emitter = new NativeEventEmitter(KeyEventBridge);
    const sub = emitter.addListener("onSeekKey", (event: any) => {
      const { direction, action } = event as { direction: "left" | "right"; action: "down" | "up" };
      if (action !== "down") return;
      const delta = direction === "right" ? 1 : -1;
      const next = Math.max(0, Math.min(countRef.current - 1, indexRef.current + delta));
      if (next !== indexRef.current) onChangeRef.current(next);
    });
    return () => {
      sub.remove();
      KeyEventBridge?.setLeftRightSeekActive(false);
    };
    // Deliberately only depends on `focused` - the ref mirrors above keep this listener reading
    // the latest index/count/onChange without needing to tear it down and resubscribe on every
    // value change, which held-repeat presses would otherwise do many times a second.
  }, [focused]);

  return (
    <Focusable
      ref={ref}
      onFocusChange={setFocused}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={undefined}
      scaleTo={1.02}
    >
      {(visualFocused: boolean) => (
        <View style={styles.sliderRow}>
          <Text style={styles.sliderValue}>{valueLabel}</Text>
          <View style={styles.sliderTrack}>
            <View style={styles.sliderTrackBg} pointerEvents="none" />
            <View style={[styles.sliderTrackFill, visualFocused && styles.sliderTrackFillFocused, { width: `${pct}%` }]} pointerEvents="none" />
            <View style={[styles.sliderThumb, visualFocused && styles.sliderThumbFocused, { left: `${pct}%` }]} pointerEvents="none" />
          </View>
        </View>
      )}
    </Focusable>
  );
});

const ToggleSwitch = React.forwardRef<
  View,
  { value: boolean; onChange: (v: boolean) => void; nextFocusUp?: number; nextFocusDown?: number; nextFocusLeft?: number }
>(function ToggleSwitch({ value, onChange, nextFocusUp, nextFocusDown, nextFocusLeft }, ref) {
  return (
    <Focusable
      ref={ref}
      onPress={() => onChange(!value)}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      scaleTo={1.04}
      focusRadius={s(13)}
    >
      {(focused: boolean) => (
        <View style={[styles.toggleFocusRing, focused && styles.toggleFocusRingFocused]}>
          <View style={[styles.toggleTrack, value && styles.toggleTrackActive]}>
            <View style={[styles.toggleKnob, value && styles.toggleKnobActive]} />
          </View>
        </View>
      )}
    </Focusable>
  );
});

const ColorSwatch = React.forwardRef<
  View,
  { color: string; active: boolean; onPress: () => void; nextFocusUp?: number; nextFocusDown?: number; nextFocusLeft?: number; nextFocusRight?: number }
>(function ColorSwatch({ color, active, onPress, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight }, ref) {
  return (
    <Focusable
      ref={ref}
      onPress={onPress}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={nextFocusLeft}
      nextFocusRight={nextFocusRight}
      scaleTo={1.1}
      focusRadius={s(14)}
    >
      {(focused: boolean) => (
        <View style={[styles.swatch, { backgroundColor: color }, focused && focusShadowTight, focused && styles.swatchFocused]}>
          {active && <Check size={s(13)} color="#000" strokeWidth={3.5} />}
        </View>
      )}
    </Focusable>
  );
});

const styles = StyleSheet.create({
  // paddingTop lowered (was 40) - per explicit request, to match BrowseScreen's own headerRow
  // level (see its own comment) - keeps every sidebar-adjacent screen's title at the same height.
  root: { flex: 1, flexDirection: "row", backgroundColor: colors.bg, paddingTop: s(30) },
  // Was 220 - with paddingLeft already eating spacing.contentStart (~94) to clear the sidebar,
  // that left barely ~110 of real width for icon+label+chevron combined, so "إعدادات النظام"/
  // "إعدادات الترجمة" (and their English equivalents) never actually fit and silently truncated
  // to a couple of characters plus an ellipsis - reported as "dots right after the icon". Widened
  // enough for the longer label ("Subtitle Settings"/"إعدادات الترجمة") to render on one full line
  // with room to spare, in either language.
  nav: { width: s(320), paddingLeft: spacing.contentStart, paddingRight: s(16), gap: s(8) },
  pageTitle: { color: "#fff", fontSize: fs(19), fontFamily: font.bold, marginBottom: s(20) },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(12),
    paddingHorizontal: s(16),
    paddingVertical: s(14),
    borderRadius: s(12),
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  navItemAccent: { width: s(3), height: s(18), borderRadius: 2, backgroundColor: "transparent" },
  navItemAccentActive: { backgroundColor: "rgba(255,255,255,0.5)" },
  navItemFocused: { backgroundColor: "#fff" },
  navItemActive: { backgroundColor: "rgba(255,255,255,0.08)" },
  // A soft round backdrop behind the icon itself (was a bare icon floating in the row) - gives
  // each tab a real anchor point instead of the label doing all the visual work, closer to how a
  // real TV settings app (Android TV Settings, Apple TV) treats its own nav icons.
  navItemIconWrap: {
    width: s(30),
    height: s(30),
    borderRadius: s(9),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  navItemIconWrapActive: { backgroundColor: "rgba(255,255,255,0.12)" },
  navItemIconWrapFocused: { backgroundColor: "transparent" },
  navItemText: { flex: 1, color: colors.textMuted, fontSize: fs(13), fontFamily: font.bold },
  navItemTextActive: { color: "#fff" },
  navItemTextFocused: { color: "#000" },
  navItemChevron: { transform: [{ scaleX: -1 }] },
  // A visually distinct panel (not just the bare background) for the content side - this,
  // more than any individual control, is what separates "a screen with some settings on it"
  // from a page that reads as an actual settings app.
  panel: {
    flex: 1,
    marginVertical: s(20),
    marginRight: s(32),
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: s(20),
  },
  content: { padding: s(28), paddingBottom: s(48) },
  previewBox: {
    borderRadius: s(16),
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: s(20),
    marginBottom: s(24),
  },
  previewLabel: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.bold, marginBottom: s(12) },
  previewFrame: {
    height: s(84),
    borderRadius: s(10),
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: { textAlign: "center", paddingHorizontal: s(10), paddingVertical: s(4), borderRadius: 6, overflow: "hidden" },
  // Each settings group now reads as its own card (subtle fill + hairline border) instead of
  // floating options directly on the black background - grouping via a bounded surface rather
  // than spacing alone is what makes a settings screen read as "designed" vs "a stack of rows".
  card: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: s(16),
    padding: s(22),
    marginBottom: s(16),
  },
  cardHeader: { marginBottom: s(6) },
  cardTitle: { color: "#fff", fontSize: fs(17), fontFamily: font.extraBold },
  cardDescription: { color: colors.textMuted, fontSize: fs(12), fontFamily: font.semiBold, marginTop: s(4) },
  // One row per individual setting - title+description on one side, its control on the other,
  // with a hairline divider between rows instead of each control living in its own boxed
  // section. The last row in a card skips the divider (settingsRowLast).
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: s(20),
    paddingVertical: s(13),
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
  },
  settingsRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  settingsRowText: { flex: 1, gap: s(4) },
  settingsRowTitle: { color: "#fff", fontSize: fs(14), fontFamily: font.bold },
  settingsRowDesc: { color: colors.textMuted, fontSize: fs(11), fontFamily: font.semiBold },
  settingsRowControl: { alignItems: "flex-end" },
  segmented: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radius.pill,
    padding: s(4),
    gap: s(2),
  },
  // A fixed height (not just vertical padding) - the four font options each render their own
  // label in *that* font, and different font files disagree enough on line-height/metrics at
  // the same point size that padding-only sizing produced visibly uneven pill heights across
  // the row. alignItems/justifyContent center the (now-clipped-if-needed) label inside it.
  segmentItem: { height: s(30), paddingHorizontal: s(16), borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentItemActive: { backgroundColor: "rgba(255,255,255,0.16)" },
  segmentItemFocused: { backgroundColor: "#fff" },
  segmentText: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold },
  segmentTextActive: { color: "#fff" },
  segmentTextFocused: { color: "#000" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: s(14), width: s(260) },
  sliderValue: { color: colors.textSecondary, fontSize: fs(12), fontFamily: font.bold, width: s(50) },
  sliderTrack: { flex: 1, height: s(20), justifyContent: "center" },
  sliderTrackBg: { position: "absolute", left: 0, right: 0, height: s(4), borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)" },
  sliderTrackFill: { position: "absolute", left: 0, height: s(4), borderRadius: 2, backgroundColor: "#fff" },
  // Track thickens and the thumb grows a bit while the slider itself has focus - the only visual
  // cue (there's no separate stop to land on anymore) that D-pad left/right will step this.
  sliderTrackFillFocused: { height: s(6), shadowColor: "#fff", shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  sliderThumb: {
    position: "absolute",
    top: "50%",
    marginTop: -s(7),
    marginLeft: -s(7),
    width: s(14),
    height: s(14),
    borderRadius: s(7),
    backgroundColor: "#fff",
  },
  sliderThumbFocused: {
    marginTop: -s(9),
    marginLeft: -s(9),
    width: s(18),
    height: s(18),
    borderRadius: s(9),
  },
  // A ring *around* the track (not a border on the track itself) - the track's own fill turns
  // solid white when active (see toggleTrackActive), and focusShadowTight (a no-op, see theme.ts)
  // used to be the only focus feedback here, so a focused-but-on toggle looked identical to an
  // unfocused one. Drawn on this screen's own dark background instead, the ring stays visible
  // regardless of whether the toggle is on or off.
  toggleFocusRing: { borderRadius: s(17), borderWidth: 2, borderColor: "transparent", padding: s(3) },
  toggleFocusRingFocused: { borderColor: "#fff" },
  toggleTrack: {
    width: s(46),
    height: s(26),
    borderRadius: s(13),
    backgroundColor: "rgba(255,255,255,0.15)",
    padding: s(3),
    justifyContent: "center",
  },
  toggleTrackActive: { backgroundColor: "#fff" },
  toggleKnob: {
    width: s(20),
    height: s(20),
    borderRadius: s(10),
    backgroundColor: "#fff",
    alignSelf: "flex-start",
  },
  toggleKnobActive: { backgroundColor: "#000", alignSelf: "flex-end" },
  swatchRow: { flexDirection: "row", gap: s(10) },
  swatch: {
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  swatchFocused: { borderColor: "#fff", transform: [{ scale: 1.1 }] },
  versionCard: {
    marginTop: s(4),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: s(16),
    paddingHorizontal: s(20),
    paddingVertical: s(16),
  },
  versionCardFocused: { backgroundColor: "#fff", borderColor: "#fff" },
  versionLabel: { color: colors.textMuted, fontSize: fs(11), fontFamily: font.semiBold, marginBottom: s(4) },
  versionLabelFocused: { color: "rgba(0,0,0,0.6)" },
  versionValue: { color: "#fff", fontSize: fs(14), fontFamily: font.bold },
  versionValueAvailable: { color: "#4ade80" },
  versionValueFocused: { color: "#000" },
  versionNotes: { color: colors.textFaint, fontSize: fs(11), fontFamily: font.semiBold, marginTop: s(4) },
  progressTrack: { height: s(4), borderRadius: 2, backgroundColor: "rgba(255,255,255,0.15)", marginTop: s(8), overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2, backgroundColor: "#4ade80" },
  uiScaleNote: { color: colors.textFaint, fontSize: fs(11), fontFamily: font.semiBold, marginTop: -s(8), marginBottom: s(16) },
});
