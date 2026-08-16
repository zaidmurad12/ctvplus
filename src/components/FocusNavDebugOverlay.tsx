import { useFocusNavState } from "../hooks/useFocusNav";

/** Dev-only visualizer for the focus-nav primitive — shows which zone/node is active
 * so navigation bugs can be diagnosed without instrumenting each screen individually. */
export function FocusNavDebugOverlay() {
  const { activeZoneId, activeNodeId } = useFocusNavState();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        insetInlineStart: 8,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        color: "#22c55e",
        font: "12px/1.4 monospace",
        padding: "6px 10px",
        borderRadius: 6,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      zone: {activeZoneId} · node: {activeNodeId ?? "—"}
    </div>
  );
}
