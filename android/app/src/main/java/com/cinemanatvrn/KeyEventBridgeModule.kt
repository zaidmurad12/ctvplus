package com.cinemanatvrn

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Lets VideoPlayer.tsx capture raw D-pad left/right/OK presses while it's on screen - stock
 * React Native (not the tvos fork) exposes no JS-level TVEventHandler, so a focused element only
 * ever sees "focus moved," never a distinguishable key press. MainActivity's own dispatchKeyEvent
 * checks the two flags below and, when active, intercepts the matching keys before Android's
 * focus system does anything with them, forwarding them as "onSeekKey"/"onOkKey" JS events
 * instead - every other screen is unaffected since interception only ever happens while these are
 * turned on.
 *
 * Two independent flags, not one, because they're active under different conditions: left/right
 * should only ever mean "seek" while the seek bar itself is focused (JS toggles this on/off as
 * focus moves between controls, letting left/right fall through to Android's normal focus
 * navigation the rest of the time) - OK's own reliability problem (see emitOkKey below) applies
 * regardless of which control has focus, so it stays on for as long as the player screen itself
 * is open.
 */
class KeyEventBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "KeyEventBridge"

  init {
    instance = this
  }

  companion object {
    @Volatile
    var leftRightSeekActive: Boolean = false
      private set

    @Volatile
    var okCaptureActive: Boolean = false
      private set

    // The root fix for "control gets lost on the video controls" reported repeatedly throughout
    // this screen's whole navigation history: real Android focus (nextFocusUp/Down/Left/Right,
    // imperative .focus() calls, focus-after-view-removed recovery) has proven unreliable on this
    // hardware in every shape it's been tried in - a flaky first cause each time (a stale node
    // handle, a lost race, a bad recovery guess), but the same *symptom* every time. Rather than
    // patching yet another specific race, this flag - active for as long as the player's own
    // three controls (seek bar/play-pause/subtitles) are the relevant navigation context (i.e.
    // never while the subtitle panel itself is open, which still uses ordinary Android focus for
    // its own controls) - captures all four D-pad directions here and hands them to JS as plain
    // events. VideoPlayer.tsx owns which of the three is "active" as a plain piece of state from
    // then on, with zero dependency on any view ever actually holding real Android focus.
    @Volatile
    var dpadNavActive: Boolean = false
      private set

    // HomeScreen's own narrower need: the recent-items strip above its rails fully unmounts once
    // focus moves down into any other rail (see its own comment on why - kept re-enlarging/
    // reflowing every other way this was tried), which means there's no real native view left for
    // a plain nextFocusUp on the first rail to point *at* to bring it back. Unlike dpadNavActive
    // above, this only ever needs to capture the single up press that means "bring it back" -
    // left/right/down must keep working exactly as Android's own normal focus engine already
    // handles them for every rail (reimplementing all four directions in JS, the way dpadNavActive
    // does for the player's own controls, would risk regressing that already-working navigation
    // for no benefit here). Same one-direction-only shape as leftRightSeekActive above, just a
    // different single key.
    @Volatile
    var upEscapeActive: Boolean = false
      private set

    // A grid-navigation equivalent of this (capturing up/down entirely in JS to move focus
    // imperatively, the same way upEscapeActive above does for a single key) has been tried twice
    // for BrowseScreen's grid, in two different shapes - once with an 8-frame retry loop, once as
    // a single deterministic scroll+focus call with no retry at all - and reverted both times,
    // the second attempt reported as *worse* than the first ("loses control a lot, hard to
    // navigate"). Whatever the exact mechanism, JS-owned imperative .focus() for *continuous*
    // back-to-back grid navigation has now failed under two structurally different
    // implementations on this hardware - unlike upEscapeActive below, which only ever fires once
    // per screen visit and has never had this problem. BrowseScreen's grid goes back to reacting
    // to Android's own native up/down focus search plus explicit nextFocusUp node routing instead
    // of intercepting the key at all.
    //
    // A third attempt applied this same capture+imperative-focus shape to HomeScreen's own rows
    // (up/down continuously captured, redirecting to each row's own first card; left captured only
    // at column 0, redirecting to the sidebar) - explicit nextFocusUp/Down node routing had already
    // been confirmed (on-device diagnostic toasts) silently ignored there, so this seemed like the
    // same "non-standard focus graph" case dpadNavActive already handles well for the player. It
    // was reported as *worse* still - up/down stopped working at all past the first row, matching
    // the imperative-focus call itself silently failing to land on the target, not just picking
    // the wrong one. Reverted; HomeScreen's rows are back to plain native focus search plus
    // nextFocusLeft, the same starting point this whole investigation began from.

    private var instance: KeyEventBridgeModule? = null

    fun emitSeekKey(direction: String, action: String) {
      val module = instance ?: return
      module.reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(
          "onSeekKey",
          Arguments.createMap().apply {
            putString("direction", direction)
            putString("action", action)
          },
        )
    }

    // Same reasoning as emitSeekKey, applied to OK/select - a focused Pressable's onPress
    // *should* fire on DPAD_CENTER/ENTER without any of this, but in practice focus on Android TV
    // has proven unreliable to keep pinned to the right view across a hidden/visible controls
    // transition (reported repeatedly as "can't reach the pause button"). Routing OK through this
    // always-on (while the player is open) native channel makes toggling play/pause independent
    // of whatever Android's focus system currently thinks is focused.
    fun emitOkKey(action: String) {
      val module = instance ?: return
      module.reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("onOkKey", Arguments.createMap().apply { putString("action", action) })
    }

    // See dpadNavActive's own comment - direction is one of up/down/left/right, action is
    // down/up (a held key repeats as further "down" events at the OS's own repeat rate, same as
    // emitSeekKey already relied on for hold-to-seek).
    fun emitNavKey(direction: String, action: String) {
      val module = instance ?: return
      module.reactApplicationContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(
          "onNavKey",
          Arguments.createMap().apply {
            putString("direction", direction)
            putString("action", action)
          },
        )
    }
  }

  @ReactMethod
  fun setLeftRightSeekActive(active: Boolean) {
    leftRightSeekActive = active
  }

  @ReactMethod
  fun setOkCaptureActive(active: Boolean) {
    okCaptureActive = active
  }

  @ReactMethod
  fun setDpadNavActive(active: Boolean) {
    dpadNavActive = active
  }

  @ReactMethod
  fun setUpEscapeActive(active: Boolean) {
    upEscapeActive = active
  }
}
