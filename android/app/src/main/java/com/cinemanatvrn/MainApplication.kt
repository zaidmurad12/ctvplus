package com.cinemanatvrn

import android.app.Application
import java.io.File
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

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
