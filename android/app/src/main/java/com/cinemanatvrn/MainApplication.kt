package com.cinemanatvrn

import android.app.Application
import java.io.File
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(KeyEventBridgePackage())
          add(AppRestartPackage())
          add(ApkUpdaterPackage())
          add(VideoCapsPackage())
          add(CrashInfoPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    installCrashRecorder()
    loadReactNative(this)
    disableViewPreallocation()
  }

  // Fabric "preallocates" a native view as soon as its node is created, before layout - a node
  // created inside a display:none screen (this app hides Home/Settings/etc. that way while a
  // details page is open, and rebuilds Home while hidden) gets recorded as layout-only, with no
  // view manager, and the real create is skipped later because the tag already counts as created.
  // The next state update to it (a ScrollView's scroll state, a Text's layout) then crashed the
  // app: "Unable to find ViewManager for tag" in SurfaceMountingManager.updateState - reported as
  // the app exiting when going back from a title's page to Home. disableViewPreallocationAndroid
  // is React Native's own kill switch for this; everything else keeps the stable defaults
  // loadReactNative() just applied.
  private fun disableViewPreallocation() {
    try {
      val stable = ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
      ReactNativeFeatureFlags.dangerouslyForceOverride(
          object : ReactNativeFeatureFlagsProvider by stable {
            override fun disableViewPreallocationAndroid(): Boolean = true
          }
      )
    } catch (_: Throwable) {
      // Never let a flag override be the thing that stops the app from starting.
    }
  }

  // Writes the stack trace of any uncaught crash (a fatal JS error included - React Native
  // rethrows it natively) to a file before the default handler kills the process; CrashInfoModule
  // hands it to the JS side on the next launch, which reports it to the backend.
  private fun installCrashRecorder() {
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        File(filesDir, CrashInfoModule.CRASH_FILE).writeText(
          "thread=${thread.name}\n" + android.util.Log.getStackTraceString(error).take(6000)
        )
      } catch (_: Throwable) {
      }
      previous?.uncaughtException(thread, error)
    }
  }
}
