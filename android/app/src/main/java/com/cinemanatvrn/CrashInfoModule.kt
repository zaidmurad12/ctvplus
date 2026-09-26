package com.cinemanatvrn

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Debug
import com.facebook.drawee.backends.pipeline.Fresco
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
      // The memory trail recorded during the previous session's playback (see recordMemory) -
      // what the process looked like in the minutes before it was killed, if it was.
      val trailPrefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      result.putString("memoryTrail", trailPrefs.getString(KEY_MEMORY_TRAIL, "") ?: "")
      trailPrefs.edit().remove(KEY_MEMORY_TRAIL).apply()
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("CRASH_INFO_FAILED", e)
    }
  }

  /**
   * One memory snapshot appended to a short on-disk trail (last MAX_TRAIL entries), called once a
   * minute while a video plays. Written locally, not sent: if the system kills the app mid-film the
   * trail survives, and collect() hands it to the next launch's crash report - showing which part
   * (Java heap, native heap, graphics) was growing before the kill.
   */
  @ReactMethod
  fun recordMemory(label: String) {
    try {
      val mi = Debug.MemoryInfo()
      Debug.getMemoryInfo(mi)
      val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val sys = ActivityManager.MemoryInfo()
      am.getMemoryInfo(sys)
      fun mb(kb: String?): Long = (kb?.toLongOrNull() ?: 0L) / 1024
      val line = "$label pss=${mi.totalPss / 1024} java=${mb(mi.getMemoryStat("summary.java-heap"))} " +
          "native=${mb(mi.getMemoryStat("summary.native-heap"))} gfx=${mb(mi.getMemoryStat("summary.graphics"))} " +
          "sysAvail=${sys.availMem / (1024 * 1024)}/${sys.totalMem / (1024 * 1024)}MB low=${sys.lowMemory}"
      val prefs = reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val trail = (prefs.getString(KEY_MEMORY_TRAIL, "") ?: "").split("\n").filter { it.isNotBlank() }
      prefs.edit().putString(KEY_MEMORY_TRAIL, (trail + line).takeLast(MAX_TRAIL).joinToString("\n")).apply()
    } catch (_: Exception) {
    }
  }

  /**
   * Drops every decoded image held in memory (Fresco's bitmap caches). Called as playback starts:
   * posters/backdrops decoded while browsing otherwise stay resident for the whole film, on TVs
   * whose memory killer ends the biggest foreground process once the video decoder needs room.
   * Images still on screen are simply re-decoded from the disk cache when next shown.
   */
  @ReactMethod
  fun trimImageMemory() {
    try {
      Fresco.getImagePipeline().clearMemoryCaches()
    } catch (_: Exception) {
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
    private const val KEY_MEMORY_TRAIL = "memory_trail"
    private const val MAX_TRAIL = 15
  }
}
