package com.cinemanatvrn

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Why did the app last stop? Read once per launch by src/crashReporter.ts and sent to the backend,
 * so sudden exits reported from real TVs can be diagnosed from actual data instead of guessed at:
 *  - Android 11+ records every process exit with a reason (crash, native crash, low-memory kill,
 *    ANR, ...) - only exits newer than the last one already reported are returned.
 *  - A Java/Kotlin crash (a fatal JS error included - React Native rethrows it natively) also gets
 *    its stack trace written by MainApplication's uncaught-exception handler; returned and cleared
 *    here.
 */
class CrashInfoModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "CrashInfo"

  @ReactMethod
  fun collect(promise: Promise) {
    try {
      val result = Arguments.createMap()
      result.putString("device", "${Build.MANUFACTURER} ${Build.MODEL}")
      result.putString("android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")

      val crashFile = File(reactContext.filesDir, CRASH_FILE)
      if (crashFile.exists()) {
        result.putString("javaCrash", crashFile.readText().take(4000))
        crashFile.delete()
      }

      val exits = Arguments.createArray()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val lastReported = prefs.getLong(KEY_LAST_EXIT, 0L)
        val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        var newest = lastReported
        for (info in am.getHistoricalProcessExitReasons(reactContext.packageName, 0, 5)) {
          if (info.timestamp <= lastReported) continue
          newest = maxOf(newest, info.timestamp)
          // A normal exit (the user backing out, the update installer replacing the app) isn't
          // a problem worth reporting.
          if (info.reason == ApplicationExitInfo.REASON_EXIT_SELF ||
              info.reason == ApplicationExitInfo.REASON_USER_REQUESTED ||
              info.reason == ApplicationExitInfo.REASON_PACKAGE_UPDATED) continue
          val entry = Arguments.createMap()
          entry.putString("reason", reasonName(info.reason))
          entry.putDouble("timestamp", info.timestamp.toDouble())
          entry.putString("description", info.description ?: "")
          entry.putDouble("pssKb", info.pss.toDouble())
          entry.putDouble("rssKb", info.rss.toDouble())
          entry.putInt("importance", info.importance)
          // ANR and native-crash exits come with a trace (the ANR thread dump / tombstone).
          if (info.reason == ApplicationExitInfo.REASON_ANR || info.reason == ApplicationExitInfo.REASON_CRASH_NATIVE) {
            try {
              info.traceInputStream?.use { entry.putString("trace", it.bufferedReader().readText().take(3000)) }
            } catch (_: Exception) {
            }
          }
          exits.pushMap(entry)
        }
        if (newest > lastReported) prefs.edit().putLong(KEY_LAST_EXIT, newest).apply()
      }
      result.putArray("exits", exits)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("CRASH_INFO_FAILED", e)
    }
  }

  private fun reasonName(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_ANR -> "ANR"
    ApplicationExitInfo.REASON_CRASH -> "CRASH"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
    ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
    ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
    ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
    ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
    ApplicationExitInfo.REASON_OTHER -> "OTHER"
    else -> "UNKNOWN($reason)"
  }

  companion object {
    const val CRASH_FILE = "last_crash.txt"
    private const val PREFS = "crash_info"
    private const val KEY_LAST_EXIT = "last_exit_timestamp"
  }
}
