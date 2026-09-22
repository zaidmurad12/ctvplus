package com.cinemanatvrn

import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "CinemanaTVRN"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // See KeyEventBridgeModule's own doc comment - only intercepts left/right while the seek bar is
  // focused, and only intercepts OK while the player screen is open at all (both toggled from
  // VideoPlayer.tsx), so every other screen's normal D-pad focus navigation is completely
  // unaffected, and left/right navigate normally between the player's own other controls too.
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    // See KeyEventBridgeModule.dpadNavActive's own comment - this is the root fix for the video
    // player's three main controls, capturing all four directions and handing them to JS as
    // plain events instead of ever routing them through Android's own real focus engine. Checked
    // before leftRightSeekActive below since the two are never meant to be on at the same time
    // (dpadNavActive is specifically off whenever the subtitle panel - the only other place
    // leftRightSeekActive turns on - is open), but even if they somehow overlapped, JS-driven nav
    // owning these keys outright is the intended behavior.
    if (KeyEventBridgeModule.dpadNavActive &&
        (event.keyCode == KeyEvent.KEYCODE_DPAD_UP || event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN ||
            event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT || event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
      val direction = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        else -> "right"
      }
      when (event.action) {
        KeyEvent.ACTION_DOWN -> KeyEventBridgeModule.emitNavKey(direction, "down")
        KeyEvent.ACTION_UP -> KeyEventBridgeModule.emitNavKey(direction, "up")
      }
      return true
    }

    // See KeyEventBridgeModule.upEscapeActive's own comment - only ever intercepts the single up
    // key, and only while HomeScreen's own first rail is focused with its recent strip collapsed;
    // left/right/down fall through unchanged to Android's normal focus engine right below.
    if (KeyEventBridgeModule.upEscapeActive && event.keyCode == KeyEvent.KEYCODE_DPAD_UP) {
      when (event.action) {
        KeyEvent.ACTION_DOWN -> KeyEventBridgeModule.emitNavKey("up", "down")
        KeyEvent.ACTION_UP -> KeyEventBridgeModule.emitNavKey("up", "up")
      }
      return true
    }

    if (KeyEventBridgeModule.leftRightSeekActive &&
        (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT || event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT)) {
      val direction = if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT) "left" else "right"
      when (event.action) {
        KeyEvent.ACTION_DOWN -> KeyEventBridgeModule.emitSeekKey(direction, "down")
        KeyEvent.ACTION_UP -> KeyEventBridgeModule.emitSeekKey(direction, "up")
      }
      return true
    }

    if (KeyEventBridgeModule.okCaptureActive &&
        (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER)) {
      // repeatCount > 0 is Android's own key-repeat firing while OK is held down - only the
      // original down/up pair should ever toggle play/pause, so those repeats are swallowed
      // (still returning true, so they don't fall through to a stray onPress elsewhere) instead
      // of forwarded as a second event.
      if (event.repeatCount == 0) {
        when (event.action) {
          KeyEvent.ACTION_DOWN -> KeyEventBridgeModule.emitOkKey("down")
          KeyEvent.ACTION_UP -> KeyEventBridgeModule.emitOkKey("up")
        }
      }
      return true
    }

    return super.dispatchKeyEvent(event)
  }
}
