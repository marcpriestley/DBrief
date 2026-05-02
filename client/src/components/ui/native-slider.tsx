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

// Permanent fix for WebKit/iOS Safari pseudo-element limitation.
//
// The root cause of the recurring "slider freeze" was that all previous
// approaches relied on styling ::-webkit-slider-runnable-track via either:
//   (a) CSS custom properties — don't cascade into pseudo-elements reliably
//   (b) Injected <style> tags — Safari can stop honouring dynamic stylesheets
//       after certain repaint/re-render cycles
//
// This implementation abandons pseudo-elements entirely.  The native
// <input type="range"> is made fully transparent and acts only as the touch/
// mouse interaction target (iOS respects it perfectly that way).  Three plain
// <div> elements provide the visual track background, fill, and thumb — all
// styled with normal inline styles that are 100% immune to pseudo-element bugs.
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
  const inputRef = useRef<HTMLInputElement>(null);

  const pct = max === min ? 0 : Math.max(0, Math.min(100, ((displayValue - min) / (max - min)) * 100));

  useEffect(() => {
    if (!isDragging.current) {
      setDisplayValue(value);
      if (inputRef.current) inputRef.current.value = String(value);
    }
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    isDragging.current = true;
    setDisplayValue(v);
    onChange(v);
    if (lastHapticVal.current === null || Math.abs(v - lastHapticVal.current) >= step * 5) {
      haptic("light");
      lastHapticVal.current = v;
    }
  }, [onChange, step]);

  const handleCommit = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    isDragging.current = false;
    lastHapticVal.current = null;
    const v = Number((e.target as HTMLInputElement).value);
    setDisplayValue(v);
    onCommit?.(v);
  }, [onCommit]);

  return (
    <div
      className={`relative ${className}`}
      style={{ height: 28 }}
    >
      {/* Background track — from thumb-min to thumb-max position */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          left: 14,
          right: 14,
          top: 10,
          height: 8,
          background: "var(--muted)",
        }}
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
      {/* Transparent native input — handles all touch/mouse events */}
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onChange={handleChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          margin: 0,
          padding: 0,
          WebkitAppearance: "none",
        }}
      />
    </div>
  );
}
