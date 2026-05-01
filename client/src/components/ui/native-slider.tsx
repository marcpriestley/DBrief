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

  const updateFill = useCallback(
    (v: number) => {
      const el = inputRef.current;
      if (!el) return;
      const range = max - min;
      const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((v - min) / range) * 100));
      el.style.setProperty(
        "--range-fill",
        `linear-gradient(to right, ${fillColor} ${pct}%, hsl(var(--muted)) ${pct}%)`
      );
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
