import React, { useState } from "react";
import { NativeModules, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { sendCrashReport } from "./crashReporter";

// Nothing in this app ever caught a render-time error before this existed - React unmounts the
// *entire* tree on any single uncaught error (in a release build too, not just dev), which is
// indistinguishable from a blank/black screen to whoever's watching. Reported as unrelated-looking
// failures happening together ("Browse totally fails", "movie info fails", "playback fails") right
// after a change to a completely different, unrelated screen - the real common cause was never any
// one of those screens, it was that *something* threw once and took the whole app down with it.
// The error is reported to the backend (see crashReporter.ts), and the viewer gets a focused
// Restart button instead of being stuck on this screen with only the stack trace to look at.
interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.setState({ info: info.componentStack ?? null });
    sendCrashReport({
      kind: "render_error",
      message: String(error?.message ?? error),
      detail: `${error?.stack ?? ""}\n${info.componentStack ?? ""}`,
    });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>حدث خطأ غير متوقع</Text>
        <RestartButton />
        <Text style={styles.message}>{String(error.message || error)}</Text>
        {!!error.stack && <Text style={styles.stack}>{error.stack}</Text>}
        {!!info && <Text style={styles.stack}>{info}</Text>}
      </ScrollView>
    );
  }
}

function RestartButton() {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => NativeModules.AppRestart?.restart?.()}
      style={[styles.button, focused && styles.buttonFocused]}
    >
      <Text style={[styles.buttonText, focused && styles.buttonTextFocused]}>إعادة تشغيل التطبيق</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: { padding: 24 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 16 },
  button: { alignSelf: "flex-start", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, borderWidth: 2, borderColor: "#fff", marginBottom: 20 },
  buttonFocused: { backgroundColor: "#fff" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  buttonTextFocused: { color: "#000" },
  message: { color: "#f66", fontSize: 16, marginBottom: 16 },
  stack: { color: "#aaa", fontSize: 12, marginBottom: 8 },
});
