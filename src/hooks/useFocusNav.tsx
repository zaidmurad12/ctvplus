/**
 * Generic D-pad/remote focus-navigation primitive.
 *
 * Replaces the old flat `navSection` string + scattered `*FocusArea`/`focused*Index`
 * state variables with a small zone/node tree: a "zone" is a screen or sub-region
 * (sidebar, a filter row, a dropdown menu, the player control bar, ...) that declares
 * its own row/col layout and what happens at its edges; a "node" is one focusable leaf
 * inside a zone. Screens register zones/nodes with hooks; this file owns the single
 * global keydown listener and all directional/RTL resolution.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type Dir = "up" | "down" | "left" | "right" | "ok" | "back";

export interface FocusTarget {
  zoneId: string;
  nodeId?: string;
}

export type EdgeResult = FocusTarget | "bubble" | "stay" | void;

export interface FocusZoneConfig {
  id: string;
  /** Used for back/edge bubbling when this zone doesn't handle a move itself. */
  parentZoneId?: string;
  /** Rows of node ids. Ragged rows are fine; called fresh on every move, not memoized. */
  layout: () => string[][];
  /** Called when a directional move would leave this zone's own layout bounds. Return
   * a target to move focus, "bubble"/void to let the parent zone decide, or "stay" to
   * consume the move and do nothing (e.g. trap focus inside a modal panel). */
  onEdge?: (dir: Dir, row: number, col: number) => EdgeResult;
  /** Return true if this zone consumed "back" (e.g. closed its own sub-panel). */
  onBack?: () => boolean | void;
  /** While this zone is active, the global listener does nothing at all (no
   * preventDefault, no dispatch) — used during incremental migration so an
   * old, not-yet-migrated screen's own key handling can take over cleanly. */
  passthrough?: boolean;
}

export interface FocusNodeConfig {
  zoneId: string;
  id: string;
  onSelect?: () => void;
  disabled?: boolean;
}

interface ZoneRuntime {
  id: string;
  parentZoneId?: string;
  layout: () => string[][];
  onEdge: (dir: Dir, row: number, col: number) => EdgeResult;
  onBack: () => boolean | void;
  passthrough: boolean;
}

interface NodeRuntime {
  onSelect?: () => void;
  disabled?: boolean;
  el: HTMLElement | null;
}

interface Registry {
  zones: Map<string, ZoneRuntime>;
  nodes: Map<string, NodeRuntime>; // keyed by `${zoneId}::${nodeId}`
  anyInputListeners: Set<() => void>;
}

interface FocusNavContextValue {
  registry: Registry;
  activeZoneId: string;
  activeNodeId: string | null;
  setFocus: (zoneId: string, nodeId?: string) => void;
  shouldSuppressInitialAutoFocus: () => boolean;
}

const FocusNavContext = createContext<FocusNavContextValue | null>(null);

function nodeKey(zoneId: string, nodeId: string) {
  return `${zoneId}::${nodeId}`;
}

function findPos(layout: string[][], nodeId: string | null): [number, number] {
  if (nodeId) {
    for (let r = 0; r < layout.length; r++) {
      const c = layout[r].indexOf(nodeId);
      if (c !== -1) return [r, c];
    }
  }
  return [0, 0];
}

function firstNodeId(layout: string[][]): string | null {
  for (const row of layout) {
    if (row.length) return row[0];
  }
  return null;
}

interface FocusNavProviderProps {
  children: React.ReactNode;
  /** Text direction — the single point where physical Left/Right get resolved to logical order. */
  dir: "rtl" | "ltr";
  initialZoneId: string;
  /** Called when "back" bubbles past every registered zone's onBack. */
  onUnhandledBack?: () => void;
  /** Don't show any focus ring until the user's first key press (no default
   * highlight on mount) — the first directional press still lands correctly, and
   * "ok" still activates the zone's default node, just without a ring beforehand. */
  startUnfocused?: boolean;
}

export function FocusNavProvider({ children, dir, initialZoneId, onUnhandledBack, startUnfocused }: FocusNavProviderProps) {
  const registryRef = useRef<Registry>({ zones: new Map(), nodes: new Map(), anyInputListeners: new Set() });
  const [activeZoneId, setActiveZoneId] = useState(initialZoneId);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const suppressInitialAutoFocusRef = useRef(!!startUnfocused);

  const dirRef = useRef(dir);
  dirRef.current = dir;
  const onUnhandledBackRef = useRef(onUnhandledBack);
  onUnhandledBackRef.current = onUnhandledBack;
  const activeZoneIdRef = useRef(activeZoneId);
  activeZoneIdRef.current = activeZoneId;

  const setFocus = useCallback((zoneId: string, nodeId?: string) => {
    const zone = registryRef.current.zones.get(zoneId);
    const resolvedNode = nodeId ?? (zone ? firstNodeId(zone.layout()) : null);
    setActiveZoneId(zoneId);
    setActiveNodeId(resolvedNode);
  }, []);

  // A pure read, never mutated here — StrictMode double-invokes effects in dev
  // mode, so a "consume on first effect call" flag would get un-consumed by the
  // simulated remount and re-fire. Instead this only flips false in handleDir,
  // driven by a genuine key event, which StrictMode does not double-invoke.
  const shouldSuppressInitialAutoFocus = useCallback(() => suppressInitialAutoFocusRef.current, []);

  // If the active zone unmounts, fall back to its parent (or the initial zone) instead
  // of leaving activeZoneId pointing at a dead zone — this is what makes a blank/dead
  // focus state structurally impossible rather than something each screen must avoid.
  const reconcileActiveZone = useCallback(() => {
    const { zones } = registryRef.current;
    if (zones.has(activeZoneId)) return;
    let fallback: string | undefined = undefined;
    // We no longer know the dead zone's parent (it's gone from the registry), so fall
    // back to the app's declared initial zone, which is always expected to be alive.
    fallback = zones.has(initialZoneId) ? initialZoneId : undefined;
    if (fallback) {
      const zone = zones.get(fallback)!;
      setActiveZoneId(fallback);
      setActiveNodeId(firstNodeId(zone.layout()));
    }
  }, [activeZoneId, initialZoneId]);

  useEffect(() => {
    reconcileActiveZone();
  }, [reconcileActiveZone]);

  const handleDir = useCallback((rawDir: Dir) => {
    const { zones, nodes, anyInputListeners } = registryRef.current;
    anyInputListeners.forEach((fn) => fn());

    // A genuine key event has now occurred — any zone that mounts from here on
    // should self-heal/auto-focus normally (see shouldSuppressInitialAutoFocus).
    suppressInitialAutoFocusRef.current = false;

    // Self-heal: if the active zone vanished (e.g. its DOM/registration was removed
    // without transitioning focus away first — a control bar fading out taking its
    // zone with it, say), fall back to the root zone rather than letting the next
    // "back" press silently escape further than intended, or any other move no-op
    // forever against a zone that no longer exists.
    let effectiveZoneId = activeZoneId;
    let effectiveNodeId = activeNodeId;
    if (!zones.has(effectiveZoneId)) {
      effectiveZoneId = initialZoneId;
      effectiveNodeId = null;
      setActiveZoneId(effectiveZoneId);
      setActiveNodeId(effectiveNodeId);
    }

    if (rawDir === "back") {
      let zoneId: string | undefined = effectiveZoneId;
      while (zoneId) {
        const zone = zones.get(zoneId);
        if (!zone) break;
        if (zone.onBack()) return;
        zoneId = zone.parentZoneId;
      }
      onUnhandledBackRef.current?.();
      return;
    }

    const zone = zones.get(effectiveZoneId);
    if (!zone) return;

    if (rawDir === "ok") {
      // No node has ever been visually focused yet (startUnfocused) — still
      // activate the zone's default node so "ok" isn't a dead key on first press.
      const nodeId = effectiveNodeId ?? firstNodeId(zone.layout());
      if (nodeId) {
        nodes.get(nodeKey(effectiveZoneId, nodeId))?.onSelect?.();
      }
      return;
    }

    const layout = zone.layout();
    let [row, col] = findPos(layout, effectiveNodeId);
    const dRow = rawDir === "up" ? -1 : rawDir === "down" ? 1 : 0;
    const dCol = rawDir === "left" ? -1 : rawDir === "right" ? 1 : 0;

    let r = row;
    let c = col;
    let steps = 0;
    const maxSteps = 50; // guards against an all-disabled row/col looping forever
    while (steps++ < maxSteps) {
      const nr = r + dRow;
      const nc = c + dCol;
      if (dRow !== 0) {
        if (nr < 0 || nr >= layout.length) {
          resolveEdge(rawDir, row, col);
          return;
        }
        const targetRow = layout[nr];
        const targetCol = Math.min(c, Math.max(0, targetRow.length - 1));
        const candidate = targetRow[targetCol];
        if (candidate && !nodes.get(nodeKey(effectiveZoneId, candidate))?.disabled) {
          setActiveNodeId(candidate);
          return;
        }
        r = nr;
        c = targetCol;
      } else if (dCol !== 0) {
        if (nc < 0 || nc >= layout[r].length) {
          resolveEdge(rawDir, row, col);
          return;
        }
        const candidate = layout[r][nc];
        if (candidate && !nodes.get(nodeKey(effectiveZoneId, candidate))?.disabled) {
          setActiveNodeId(candidate);
          return;
        }
        c = nc;
      } else {
        return;
      }
    }

    function resolveEdge(dir: Dir, row: number, col: number) {
      let currentZoneId: string | undefined = effectiveZoneId;
      let currentRow = row;
      let currentCol = col;
      while (currentZoneId) {
        const currentZone = zones.get(currentZoneId);
        if (!currentZone) return;
        const result = currentZone.onEdge?.(dir, currentRow, currentCol);
        if (result === "stay") return;
        if (result && result !== "bubble") {
          setActiveZoneId(result.zoneId);
          const targetZone = zones.get(result.zoneId);
          setActiveNodeId(result.nodeId ?? (targetZone ? firstNodeId(targetZone.layout()) : null));
          return;
        }
        currentZoneId = currentZone.parentZoneId;
        currentRow = -1;
        currentCol = -1;
      }
      // No zone in the chain handled it — no-op, never a blank/broken state.
    }
  }, [activeZoneId, activeNodeId, initialZoneId]);

  const handleDirRef = useRef(handleDir);
  handleDirRef.current = handleDir;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeZone = registryRef.current.zones.get(activeZoneIdRef.current);
      if (activeZone?.passthrough) return;

      const activeIsTextInput = document.activeElement?.tagName === "INPUT";
      if (activeIsTextInput && e.key !== "Enter" && e.key !== "Escape" && e.key !== "ArrowDown" && e.key !== "ArrowUp") {
        return;
      }
      if (activeIsTextInput && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        (document.activeElement as HTMLElement).blur();
      }

      const key = e.key;
      const keyCode = e.keyCode;
      let physical: "up" | "down" | "left" | "right" | "ok" | "back" | null = null;

      if (key === "ArrowUp" || key === "Up" || keyCode === 38) physical = "up";
      else if (key === "ArrowDown" || key === "Down" || keyCode === 40) physical = "down";
      else if (key === "ArrowLeft" || key === "Left" || keyCode === 37) physical = "left";
      else if (key === "ArrowRight" || key === "Right" || keyCode === 39) physical = "right";
      else if (key === "Enter" || key === "Select" || key === "Accept" || keyCode === 13 || keyCode === 23 || keyCode === 66) physical = "ok";
      else if (
        key === "Escape" || key === "Backspace" || key === "GoBack" || key === "BrowserBack" || key === "Back" ||
        keyCode === 27 || keyCode === 8 || keyCode === 4 || keyCode === 10009 || keyCode === 461
      ) physical = "back";

      if (!physical) return;
      e.preventDefault();

      // Single RTL flip point: physical Left/Right become logical "toward start"/"toward
      // end" of reading order. Every zone downstream reasons in logical terms only —
      // this is what eliminates the old per-branch `lang === "ar" ? ... : ...` checks.
      let logical: Dir = physical;
      if (dirRef.current === "rtl") {
        if (physical === "left") logical = "right";
        else if (physical === "right") logical = "left";
      }

      handleDirRef.current(logical);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const contextValue = useMemo<FocusNavContextValue>(() => ({
    registry: registryRef.current,
    activeZoneId,
    activeNodeId,
    setFocus,
    shouldSuppressInitialAutoFocus,
  }), [activeZoneId, activeNodeId, setFocus, shouldSuppressInitialAutoFocus]);

  return <FocusNavContext.Provider value={contextValue}>{children}</FocusNavContext.Provider>;
}

function useFocusNavContext(): FocusNavContextValue {
  const ctx = useContext(FocusNavContext);
  if (!ctx) throw new Error("useFocusNav hooks must be used within a FocusNavProvider");
  return ctx;
}

/** Register a zone (a screen or sub-region). Safe to call unconditionally on every render. */
export function useFocusZone(config: FocusZoneConfig) {
  const { registry, activeZoneId, activeNodeId, setFocus, shouldSuppressInitialAutoFocus } = useFocusNavContext();
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const runtime: ZoneRuntime = {
      id: config.id,
      get parentZoneId() {
        return configRef.current.parentZoneId;
      },
      layout: () => configRef.current.layout(),
      onEdge: (dir, row, col) => configRef.current.onEdge?.(dir, row, col),
      onBack: () => configRef.current.onBack?.(),
      get passthrough() {
        return !!configRef.current.passthrough;
      },
    };
    registry.zones.set(config.id, runtime);

    // Self-heal a race where setFocus(zoneId) targeted this zone before it had
    // registered (e.g. activating a just-opened panel from within the same event
    // handler that reveals it) — the zone didn't exist yet to resolve "first node",
    // so activeNodeId was left null even though this zone is now the active one.
    // Suppressed until the user's first real key press if the provider asked to
    // start with no visible focus (see shouldSuppressInitialAutoFocus).
    if (activeZoneId === config.id && activeNodeId == null) {
      if (!shouldSuppressInitialAutoFocus()) {
        setFocus(config.id);
      }
    }

    return () => {
      registry.zones.delete(config.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.id]);

  const isActive = activeZoneId === config.id;
  const activate = useCallback((nodeId?: string) => setFocus(config.id, nodeId), [config.id, setFocus]);

  return { isActive, activate };
}

/** Register a focusable leaf inside a zone. Returns isFocused + a ref for scroll-into-view. */
export function useFocusNode(config: FocusNodeConfig) {
  const { registry, activeZoneId, activeNodeId } = useFocusNavContext();
  const configRef = useRef(config);
  configRef.current = config;
  const elRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const key = nodeKey(config.zoneId, config.id);
    const runtime: NodeRuntime = {
      get onSelect() {
        return configRef.current.onSelect;
      },
      get disabled() {
        return configRef.current.disabled;
      },
      get el() {
        return elRef.current;
      },
    } as NodeRuntime;
    registry.nodes.set(key, runtime);
    return () => {
      registry.nodes.delete(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.zoneId, config.id]);

  const isFocused = activeZoneId === config.zoneId && activeNodeId === config.id;

  useEffect(() => {
    if (isFocused) {
      elRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [isFocused]);

  return { isFocused, ref: elRef as React.RefObject<HTMLElement> };
}

/** Register a variable-length, dynamically-loading list of nodes (e.g. movie cards from
 * an API) in one hook call. `useFocusNode` per item breaks the Rules of Hooks the moment
 * the list's length changes between renders (data loading in, filters changing, ...) —
 * this registers/deregisters the whole id array from a single effect instead, and hands
 * back plain functions (`isFocused`/`getRef`) safe to call per item inside a .map(). */
export function useFocusNodes(zoneId: string, ids: string[], options?: { onSelect?: (id: string) => void; isDisabled?: (id: string) => boolean }) {
  const { registry, activeZoneId, activeNodeId } = useFocusNavContext();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const elsRef = useRef(new Map<string, HTMLElement | null>());
  const idsKey = ids.join(" ");

  useEffect(() => {
    const currentIds = idsKey.length ? idsKey.split(" ") : [];
    for (const id of currentIds) {
      registry.nodes.set(nodeKey(zoneId, id), {
        get onSelect() {
          return () => optionsRef.current?.onSelect?.(id);
        },
        get disabled() {
          return optionsRef.current?.isDisabled?.(id);
        },
        get el() {
          return elsRef.current.get(id) ?? null;
        },
      } as NodeRuntime);
    }
    return () => {
      for (const id of currentIds) {
        registry.nodes.delete(nodeKey(zoneId, id));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, idsKey]);

  useEffect(() => {
    if (activeZoneId === zoneId && activeNodeId) {
      elsRef.current.get(activeNodeId)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeZoneId, activeNodeId, zoneId]);

  return {
    isFocused: (id: string) => activeZoneId === zoneId && activeNodeId === id,
    getRef: (id: string) => (el: HTMLElement | null) => {
      elsRef.current.set(id, el);
    },
  };
}

/** Imperative focus control (e.g. jump into a zone on selection, like opening the player). */
export function useFocusNavActions() {
  const { setFocus } = useFocusNavContext();
  return { setFocus };
}

/** Subscribe to every processed key event, regardless of direction — used by the video
 * player to re-arm its auto-hiding control bar on D-pad activity, not just mouse events. */
export function useFocusAnyInput(callback: () => void) {
  const { registry } = useFocusNavContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const fn = () => callbackRef.current();
    registry.anyInputListeners.add(fn);
    return () => {
      registry.anyInputListeners.delete(fn);
    };
  }, [registry]);
}

/** Read-only current focus state, for the dev debug overlay. */
export function useFocusNavState() {
  const { activeZoneId, activeNodeId } = useFocusNavContext();
  return { activeZoneId, activeNodeId };
}
