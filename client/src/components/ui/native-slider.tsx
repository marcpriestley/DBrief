import { useRef } from "react";
import { haptic } from "@/lib/haptics";

interface NativeSliderProps {
  value: number;
  onChange: (v: number) => void;
  /** Called once when the user releases the thumb — use for save-on-release. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  color?: string;
  className?: string;
}

/**
 * PERMANENT FIX: uses a native <input type="range"> element.
 *
 * iOS WKWebView handles range inputs at the OS/native layer, completely
 * bypassing JavaScript touch event competition with Capacitor's gesture
 * recognizers. This is more reliable than any custom touch handler approach.
 *
 * The track fill is implemented as a CSS linear-gradient on the element
 * background, updated reactively with value changes.
 */
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
  const lastHapticVal = useRef<number | null>(null);
  const fillColor = color ?? "hsl(var(--primary))";
  const range = max - min;
  const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((value - min) / range) * 100));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    onChange(v);
    if (lastHapticVal.current === null || Math.abs(v - lastHapticVal.current) >= step * 5) {
      haptic("light");
      lastHapticVal.current = v;
    }
  };

  const handleCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    lastHapticVal.current = null;
    onCommit?.(Number((e.target as HTMLInputElement).value));
  };

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={handleChange}
      onMouseUp={handleCommit}
      onTouchEnd={handleCommit}
      className={`native-range ${className}`}
      style={{
        background: `linear-gradient(to right, ${fillColor} ${pct}%, hsl(var(--muted)) ${pct}%)`,
        "--thumb-color": fillColor,
      } as React.CSSProperties}
    />
  );
}
