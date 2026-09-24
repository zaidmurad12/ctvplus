// Kept in sync BY HAND with android/app/build.gradle's versionCode/versionName on every release
// build - the in-app "check for update" (SettingsScreen) compares this against what the backend's
// own apps/backend/src/app-update/appVersion.ts (a different repo) currently offers. Forgetting to
// bump this here means the update check either never notices a real new release, or nags about a
// release that's actually this same build.
export const CURRENT_VERSION_CODE = 130;
export const CURRENT_VERSION_NAME = "1.22.90-exit-armatch";
