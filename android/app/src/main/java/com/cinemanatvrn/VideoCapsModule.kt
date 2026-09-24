package com.cinemanatvrn

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Whether this device has a *hardware* decoder able to play 2160p at 30fps (H.264 or HEVC).
 * Without one, ExoPlayer still plays a 4K stream (decoder fallback is on) but through a software
 * decoder that can't keep up - reported as 4K motion turning slow/choppy. VideoPlayer uses this to
 * step a 4K pick down to the next quality instead.
 */
class VideoCapsModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "VideoCaps"

  @ReactMethod
  fun canDecode4K(promise: Promise) {
    try {
      val infos = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
      val supported = infos.any { info ->
        !info.isEncoder && isHardware(info) && info.supportedTypes.any { type ->
          (type.equals("video/hevc", true) || type.equals("video/avc", true)) &&
              runCatching {
                info.getCapabilitiesForType(type).videoCapabilities
                    ?.areSizeAndRateSupported(3840, 2160, 30.0) == true
              }.getOrDefault(false)
        }
      }
      promise.resolve(supported)
    } catch (e: Exception) {
      // Unknown - don't block 4K on a failed probe.
      promise.resolve(true)
    }
  }

  private fun isHardware(info: MediaCodecInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) return info.isHardwareAccelerated
    val name = info.name.lowercase()
    return !(name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.contains("ffmpeg") || name.contains(".sw."))
  }
}
