/**
 * @format
 */

import React from 'react';
import { AppRegistry, I18nManager } from 'react-native';
import App from './App';
import { ErrorBoundary } from './src/ErrorBoundary';
import { installCrashReporting } from './src/crashReporter';
import { name as appName } from './app.json';

// The whole app is laid out LTR-structurally on purpose (see the layout-direction comments
// in MovieDetailsScreen.tsx) - Arabic *text* still renders correctly regardless, since glyph
// shaping/bidi is handled by the text engine, not by this flag. But on a real device whose
// system language is Arabic, React Native auto-detects I18nManager.isRTL = true, which
// silently flips every logical style prop (paddingStart, marginEnd, insetInlineStart) used
// throughout this codebase to the *opposite* physical side - e.g. the sidebar-adjacent grid
// padding lands on the right instead of the left, leaving the first column flush against the
// sidebar with no gap at all. Forcing LTR here makes every logical prop resolve the same way
// on every device regardless of its locale. (Takes effect from the *next* app start, per
// React Native's own I18nManager semantics - not retroactive to whatever session is already
// running when this first ships.)
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

installCrashReporting();

function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

AppRegistry.registerComponent(appName, () => Root);
