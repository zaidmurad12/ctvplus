import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

// Nothing in this app ever caught a render-time error before this existed - React unmounts the
// *entire* tree on any single uncaught error (in a release build too, not just dev), which is
// indistinguishable from a blank/black screen to whoever's watching. Reported as unrelated-looking
// failures happening together ("Browse totally fails", "movie info fails", "playback fails") right
// after a change to a completely different, unrelated screen - the real common cause was never any
// one of those screens, it was that *something* threw once and took the whole app down with it.
// This at least shows what actually threw instead of leaving a silent black screen next time.
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
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>حدث خطأ غير متوقع</Text>
        <Text style={styles.message}>{String(error.message || error)}</Text>
        {!!error.stack && <Text style={styles.stack}>{error.stack}</Text>}
        {!!info && <Text style={styles.stack}>{info}</Text>}
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: { padding: 24 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 12 },
  message: { color: "#f66", fontSize: 16, marginBottom: 16 },
  stack: { color: "#aaa", fontSize: 12, marginBottom: 8 },
});
