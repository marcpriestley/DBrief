import { useState, useRef, useEffect } from "react";
import { haptic } from "@/lib/haptics";

interface NativeSliderProps {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  className?: string;
}

// Custom slider that works reliably on iOS WebKit inside scroll containers.
//
// Key design decisions:
// 1. Touch events registered imperatively with { passive: false } so
//    preventDefault() actually works — this stops iOS from cancelling the
//    touch gesture for scroll mid-drag.
// 2. onChange / onCommit stored in refs so the touch-event useEffect has
//    NO changing dependencies and therefore NEVER tears down & re-registers
//    listeners during an active drag.  The previous version had updateFromX
//    in the dep array — every state update from the parent caused a new
//    onChange ref → new updateFromX → effect cleanup → listeners removed
//    mid-drag → slider froze.
export default function NativeSlider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  color,
  className = "",
}: NativeSliderProps) {
  const fillColor = color ?? "hsl(40, 95%, 48%)";
  const [displayValue, setDisplayValue] = useState(value);

  // ── Stable refs — never go stale, never trigger re-registration ──────────
  const containerRef      = useRef<HTMLDivElement>(null);
  const isDragging        = useRef(false);
  const activeTouchId     = useRef<number | null>(null);
  const lastHapticVal     = useRef<number | null>(null);
  const displayValueRef   = useRef(displayValue);
  const minRef            = useRef(min);
  const maxRef            = useRef(max);
  const stepRef           = useRef(step);
  const onChangeRef       = useRef(onChange);
  const onCommitRef       = useRef(onCommit);

  // Keep refs in sync on every render — safe because refs never trigger effects
  displayValueRef.current = displayValue;
  minRef.current          = min;
  maxRef.current          = max;
  stepRef.current         = step;
  onChangeRef.current     = onChange;
  onCommitRef.current     = onCommit;

  // Sync display value from outside only when not dragging
  useEffect(() => {
    if (!isDragging.current) setDisplayValue(value);
  }, [value]);

  const pct = max === min ? 0 : Math.max(0, Math.min(100,
    ((displayValue - min) / (max - min)) * 100
  ));

  // Stable helper — reads everything from refs so it never changes identity
  const updateFromX = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect  = el.getBoundingClientRect();
    const x     = clientX - rect.left - 14;
    const track = Math.max(1, rect.width - 28);
    const frac  = Math.max(0, Math.min(1, x / track));
    const raw   = minRef.current + frac * (maxRef.current - minRef.current);
    const stepped = Math.round(raw / stepRef.current) * stepRef.current;
    const clamped = Math.max(minRef.current, Math.min(maxRef.current, stepped));
    setDisplayValue(clamped);
    displayValueRef.current = clamped;
    onChangeRef.current(clamped);
    if (lastHapticVal.current === null ||
        Math.abs(clamped - lastHapticVal.current) >= stepRef.current * 5) {
      haptic("light");
      lastHapticVal.current = clamped;
    }
  };

  // ── Touch events — registered once, never re-registered ──────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (!t) return;
      isDragging.current    = true;
      activeTouchId.current = t.identifier;
      lastHapticVal.current = null;
      updateFromX(t.clientX);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!isDragging.current) return;
      const t = Array.from(e.changedTouches)
        .find(x => x.identifier === activeTouchId.current);
      if (t) updateFromX(t.clientX);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!isDragging.current) return;
      isDragging.current    = false;
      activeTouchId.current = null;
      lastHapticVal.current = null;
      onCommitRef.current?.(displayValueRef.current);
    };

    el.addEventListener("touchstart",  onTouchStart, { passive: false });
    el.addEventListener("touchmove",   onTouchMove,  { passive: false });
    el.addEventListener("touchend",    onTouchEnd,   { passive: false });
    el.addEventListener("touchcancel", onTouchEnd,   { passive: false });

    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []); // ← empty: runs once, never tears down during a drag

  // ── Pointer events for mouse / stylus ────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    lastHapticVal.current = null;
    updateFromX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromX(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    isDragging.current = false;
    lastHapticVal.current = null;
    onCommitRef.current?.(displayValueRef.current);
  };

  return (
    <div
      ref={containerRef}
      className={`relative select-none ${className}`}
      style={{ height: 28, touchAction: "none", cursor: "pointer" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Track background */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{ left: 14, right: 14, top: 10, height: 8, background: "var(--muted)" }}
      />
      {/* Track fill */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          left: 14,
          top: 10,
          height: 8,
          width: `calc(${pct / 100} * (100% - 28px))`,
          background: fillColor,
        }}
      />
      {/* Thumb */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 28,
          height: 28,
          top: 0,
          left: `calc(${pct / 100} * (100% - 28px))`,
          background: fillColor,
          border: "2px solid hsl(0, 0%, 8%)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}
      />
      {/* Hidden native range for keyboard a11y */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={e => {
          const v = Number(e.target.value);
          setDisplayValue(v);
          onChangeRef.current(v);
        }}
        onKeyUp={e => {
          const keys = ["ArrowLeft","ArrowRight","Home","End"];
          if (keys.includes(e.key))
            onCommitRef.current?.(Number((e.target as HTMLInputElement).value));
        }}
        tabIndex={0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          margin: 0,
          padding: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
