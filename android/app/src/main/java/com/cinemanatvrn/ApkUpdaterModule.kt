package com.cinemanatvrn

import android.content.Intent
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Downloads the update APK the Settings screen's "check for update" found, then hands it straight
 * to the system package installer - what used to be "open a browser, wait for its own download,
 * pull down the notification shade, tap it, choose Package Installer" per explicit request to
 * remove that browser round trip.
 *
 * OkHttp (was: java.net.HttpURLConnection, before that Android's own DownloadManager - see git
 * history) downloads into the app's own cache folder. DownloadManager is backed by a separate
 * system Download Manager app/service several real Android TV/set-top boxes ship stripped down or
 * fully disabled - enqueue() returned a valid-looking id without anything ever actually running
 * it, no error, just a progress bar frozen at zero forever. Its plain HttpURLConnection
 * replacement fixed that, but then reliably connected-and-stalled at zero bytes on a *different*
 * real device - the same URL downloaded instantly in that exact device's own browser seconds
 * later, which is what points at java.net's own older, less robust TLS/HTTP2/redirect handling
 * specifically, not the network or the file. OkHttp is the connection stack real browsers and
 * effectively every modern Android app (React Native's own networking included - see build.gradle's
 * own comment on why this needs no new dependency to add) already rely on instead, for exactly
 * this class of reliability.
 *
 * The APK is handed to the installer via FileProvider's own content:// URI (see file_paths.xml
 * and the manifest's <provider> entry) - a raw file:// URI across the app boundary throws
 * FileUriExposedException on modern Android.
 *
 * Real install still needs one tap on Android's own "Install this app?" confirmation - no app
 * without system/device-owner privileges can skip that dialog, this module just removes every
 * step before it.
 */
class ApkUpdaterModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "ApkUpdater"

  // How often a progress event is emitted while bytes are still arriving - not on every single
  // read (the JS bridge doesn't need to know about every 8KB chunk, and flooding it costs real
  // work on both sides for no visible benefit at this resolution).
  private val PROGRESS_INTERVAL_MS = 300L

  private val client =
    OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(15, TimeUnit.SECONDS)
      .writeTimeout(15, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .build()

  @Volatile private var currentCall: Call? = null

  private fun emit(params: com.facebook.react.bridge.WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("ApkUpdaterEvent", params)
  }

  private fun emitError(message: String?) {
    emit(Arguments.createMap().apply {
      putString("type", "error")
      putString("message", message ?: "download failed")
    })
  }

  @ReactMethod
  fun downloadAndInstall(url: String, fileName: String, promise: Promise) {
    // Only one in-flight download at a time (matches the JS side, which never starts a second one
    // while the first is still running) - a stale call from an abandoned previous attempt is
    // simply cancelled rather than fought over shared state.
    currentCall?.cancel()

    val destination = File(reactContext.cacheDir, fileName)
    val request = Request.Builder().url(url).build()
    val call = client.newCall(request)
    currentCall = call

    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: java.io.IOException) {
        if (call.isCanceled()) return // superseded by a newer request - not a real failure
        emitError(e.message)
      }

      override fun onResponse(call: Call, response: Response) {
        try {
          response.use { resp ->
            if (!resp.isSuccessful) {
              emitError("HTTP ${resp.code}")
              return
            }
            val body = resp.body ?: run {
              emitError("empty response body")
              return
            }
            val total = body.contentLength() // -1 if the server didn't send one
            var downloaded = 0L
            var lastEmitAt = 0L

            body.byteStream().use { input ->
              FileOutputStream(destination).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                  if (call.isCanceled()) return
                  val read = input.read(buffer)
                  if (read == -1) break
                  output.write(buffer, 0, read)
                  downloaded += read
                  val now = System.currentTimeMillis()
                  if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
                    lastEmitAt = now
                    emit(Arguments.createMap().apply {
                      putString("type", "progress")
                      putDouble("downloaded", downloaded.toDouble())
                      putDouble("total", total.toDouble())
                    })
                  }
                }
              }
            }
            // A final progress event at the real end - the loop's own throttling can otherwise
            // leave the last-seen percentage a little short of 100% right as installPrompted fires.
            emit(Arguments.createMap().apply {
              putString("type", "progress")
              putDouble("downloaded", downloaded.toDouble())
              putDouble("total", if (total > 0) total.toDouble() else downloaded.toDouble())
            })

            val authority = "${reactContext.packageName}.fileprovider"
            val uri = FileProvider.getUriForFile(reactContext, authority, destination)
            val installIntent =
              Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
              }
            reactContext.startActivity(installIntent)
            emit(Arguments.createMap().apply { putString("type", "installPrompted") })
          }
        } catch (e: Exception) {
          destination.delete()
          emitError(e.message)
        }
      }
    })
    promise.resolve(null)
  }

  // NativeEventEmitter (JS side) requires these two to exist even though nothing here needs to
  // react to (un)subscription itself.
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}
}
