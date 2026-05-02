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

// Uses Pointer Events API (mouse + touch unified) with setPointerCapture so
// that drag works correctly even when the slider sits inside a scroll container.
// The previous approach relied on <input type="range"> native touch handling —
// on iOS WebKit inside overflow:auto containers the browser intercepts the
// touch for scrolling before the range input sees it, so only taps registered.
// Pointer Events + setPointerCapture hands exclusive ownership of the gesture
// to this element for the lifetime of the drag, regardless of the parent scroll.
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
  const lastHapticVal = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref so pointer-event callbacks always see the latest value
  const displayValueRef = useRef(displayValue);
  useEffect(() => { displayValueRef.current = displayValue; }, [displayValue]);

  useEffect(() => {
    if (!isDragging.current) {
      setDisplayValue(value);
    }
  }, [value]);

  const pct = max === min ? 0 : Math.max(0, Math.min(100, ((displayValue - min) / (max - min)) * 100));

  const updateFromX = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Thumb is 28px wide — track starts at 14px and ends 14px before right edge
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

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isDragging.current = true;
    updateFromX(e.clientX);
  }, [updateFromX]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    updateFromX(e.clientX);
  }, [updateFromX]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    isDragging.current = false;
    lastHapticVal.current = null;
    onCommit?.(displayValueRef.current);
  }, [onCommit]);

  // Keyboard accessibility via a hidden native range input
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
      {/* Background track */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{ left: 14, right: 14, top: 10, height: 8, background: "var(--muted)" }}
      />
      {/* Fill track */}
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
      {/* Hidden native input — keyboard / VoiceOver accessibility only */}
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
