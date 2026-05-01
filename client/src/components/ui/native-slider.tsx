import { useRef, useEffect, useCallback } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);
  const lastHapticVal = useRef<number | null>(null);
  const fillColor = color ?? "hsl(40, 95%, 48%)";

  // Unique ID so we can target this specific input's pseudo-elements from an
  // injected <style> tag. CSS custom properties don't reliably cascade into
  // ::-webkit-slider-runnable-track in WebKit/iOS Safari — the only reliable
  // solution is to emit a real CSS rule that targets the element by ID.
  const sliderId = useRef(`ns-${Math.random().toString(36).slice(2, 8)}`);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    const style = document.createElement("style");
    document.head.appendChild(style);
    styleRef.current = style;
    return () => { style.remove(); styleRef.current = null; };
  }, []);

  const updateFill = useCallback(
    (v: number) => {
      const el = inputRef.current;
      const style = styleRef.current;
      if (!el || !style) return;
      const range = max - min;
      const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((v - min) / range) * 100));
      // Read the current computed muted colour from the root element via JS.
      // This works even though var(--muted) in a pseudo-element stylesheet
      // doesn't inherit reliably in WebKit.
      const mutedColor =
        getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() ||
        "hsl(0, 0%, 20%)";
      const gradient = `linear-gradient(to right, ${fillColor} ${pct}%, ${mutedColor} ${pct}%)`;
      style.textContent = `
        #${sliderId.current}::-webkit-slider-runnable-track { background: ${gradient} !important; }
        #${sliderId.current}::-moz-range-track { background: ${mutedColor}; }
        #${sliderId.current}::-moz-range-progress { background: ${fillColor}; height: 8px; border-radius: 4px; }
      `;
      el.style.setProperty("--thumb-color", fillColor);
    },
    [min, max, fillColor]
  );

  useEffect(() => {
    updateFill(value);
  }, []);

  useEffect(() => {
    if (!isDragging.current) {
      if (inputRef.current) inputRef.current.value = String(value);
      updateFill(value);
    }
  }, [value, updateFill]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    isDragging.current = true;
    updateFill(v);
    onChange(v);
    if (lastHapticVal.current === null || Math.abs(v - lastHapticVal.current) >= step * 5) {
      haptic("light");
      lastHapticVal.current = v;
    }
  };

  const handleCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    isDragging.current = false;
    lastHapticVal.current = null;
    onCommit?.(Number((e.target as HTMLInputElement).value));
  };

  return (
    <input
      ref={inputRef}
      id={sliderId.current}
      type="range"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      onChange={handleChange}
      onMouseUp={handleCommit}
      onTouchEnd={handleCommit}
      className={`native-range ${className}`}
    />
  );
}
