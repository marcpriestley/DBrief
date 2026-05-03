import { useState, useRef, useEffect, useCallback } from "react";
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
// Strategy:
//   - Pointer Events + setPointerCapture for desktop / mouse input
//   - Imperative addEventListener('touchstart', { passive: false }) to call
//     preventDefault() on the raw touch event, which stops iOS from interpreting
//     the gesture as a scroll and issuing a pointercancel that kills the drag.
//     React synthetic onTouchStart is passive in React 17+ and cannot preventDefault.
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
  const isDragging = useRef(false);
  const activePtrId = useRef<number | null>(null);
  const lastHapticVal = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayValueRef = useRef(displayValue);
  useEffect(() => { displayValueRef.current = displayValue; }, [displayValue]);

  useEffect(() => {
    if (!isDragging.current) setDisplayValue(value);
  }, [value]);

  const pct = max === min ? 0 : Math.max(0, Math.min(100, ((displayValue - min) / (max - min)) * 100));

  const updateFromX = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left - 14;
    const trackWidth = Math.max(1, rect.width - 28);
    const fraction = Math.max(0, Math.min(1, x / trackWidth));
    const raw = min + fraction * (max - min);
    const stepped = Math.round(raw / step) * step;
    const clamped = Math.max(min, Math.min(max, stepped));
    setDisplayValue(clamped);
    onChange(clamped);
    if (lastHapticVal.current === null || Math.abs(clamped - lastHapticVal.current) >= step * 5) {
      haptic("light");
      lastHapticVal.current = clamped;
    }
  }, [min, max, step, onChange]);

  // Pointer events for desktop/mouse — setPointerCapture keeps move working outside element
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // handled by touch path below
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activePtrId.current = e.pointerId;
    isDragging.current = true;
    updateFromX(e.clientX);
  }, [updateFromX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromX(e.clientX);
  }, [updateFromX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    isDragging.current = false;
    activePtrId.current = null;
    lastHapticVal.current = null;
    onCommit?.(displayValueRef.current);
  }, [onCommit]);

  // Touch events — imperative listener with passive:false so preventDefault() works,
  // which stops iOS from cancelling the touch for scroll mid-drag.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // Block scroll — must be non-passive
      const touch = e.changedTouches[0];
      if (!touch) return;
      isDragging.current = true;
      activePtrId.current = touch.identifier;
      lastHapticVal.current = null;
      updateFromX(touch.clientX);
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!isDragging.current) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === activePtrId.current);
      if (!touch) return;
      updateFromX(touch.clientX);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!isDragging.current) return;
      const touch = Array.from(e.changedTouches).find(t => t.identifier === activePtrId.current);
      isDragging.current = false;
      activePtrId.current = null;
      lastHapticVal.current = null;
      onCommit?.(displayValueRef.current);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [updateFromX, onCommit]);

  const handleKeyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setDisplayValue(v);
    onChange(v);
  }, [onChange]);

  const handleKeyCommit = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
      onCommit?.(Number((e.target as HTMLInputElement).value));
    }
  }, [onCommit]);

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
      <div
        className="absolute pointer-events-none rounded-full"
        style={{ left: 14, right: 14, top: 10, height: 8, background: "var(--muted)" }}
      />
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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={handleKeyChange}
        onKeyUp={handleKeyCommit}
        tabIndex={0}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          margin: 0,
          padding: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
