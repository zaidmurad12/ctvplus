package com.cinemanatvrn

import android.content.Intent
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * A real process restart - BackHandler.exitApp() (finishAffinity() under the hood) only ever
 * finishes the current Activity; the Application object (and with it the single ReactHost/JS
 * engine instance every screen was imported into) is a process-lifetime singleton that keeps
 * right on living whenever Android reuses the same process for the next launch, which it very
 * often does. Every screen's StyleSheet.create() call only ever runs once, at first import (see
 * scale.ts's own comment), so reusing that same JS engine after "restarting" left every screen
 * still built against whatever UI-scale value was active the first time it was ever imported -
 * reported as the size setting only ever visibly affecting icons (those read the live scale value
 * at render time via s()/fs() instead of baking it into a module-level style object). Restarting
 * via Intent.makeRestartActivityTask + Runtime.exit(0) - the same mechanism react-native-restart
 * itself uses - actually kills this process, guaranteeing the next launch is a genuine cold start
 * that re-imports (and so re-scales) every screen from scratch.
 */
class AppRestartModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AppRestart"

  @ReactMethod
  fun restart() {
    val packageManager = reactContext.packageManager
    val launchIntent = packageManager.getLaunchIntentForPackage(reactContext.packageName) ?: return
    val componentName = launchIntent.component ?: return
    val mainIntent = Intent.makeRestartActivityTask(componentName)
    reactContext.startActivity(mainIntent)
    Runtime.getRuntime().exit(0)
  }
}
