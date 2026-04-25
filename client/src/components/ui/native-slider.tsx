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
 * Touch-event slider for iOS WKWebView.
 *
 * Implementation notes:
 * - Uses React onTouchStart/onTouchMove/onTouchEnd props as the primary mechanism.
 *   React's synthetic events work reliably in WKWebView because Capacitor is built
 *   to integrate with React's event delegation model.
 * - Adds document-level native listeners for touchmove/touchend so the drag continues
 *   even when the finger leaves the slider bounds.
 * - Avoids setPointerCapture (breaks in WKWebView) and native-only addEventListener
 *   on the element (competes with Capacitor's gesture recognizers).
 * - touch-action: none on the root div prevents native scroll/zoom on this element.
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
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  const lastHapticVal = useRef<number | null>(null);
  const lastVal = useRef(value);
  lastVal.current = value;

  const range = max - min;
  const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((value - min) / range) * 100));
  const fillColor = color ?? "hsl(var(--primary))";

  const calcVal = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return lastVal.current;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * range;
    return Math.max(min, Math.min(max, Math.round(raw / step) * step));
  };

  const emit = (newVal: number) => {
    lastVal.current = newVal;
    onChangeRef.current(newVal);
    if (lastHapticVal.current === null || Math.abs(newVal - lastHapticVal.current) >= step) {
      haptic("light");
      lastHapticVal.current = newVal;
    }
  };

  const commit = () => { onCommitRef.current?.(lastVal.current); };

  // — React touch handlers (primary path) —
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    isDragging.current = true;
    lastHapticVal.current = null;
    if (e.touches[0]) emit(calcVal(e.touches[0].clientX));

    // Add document-level listeners so drag continues outside the element bounds
    const onMove = (ev: TouchEvent) => {
      if (!isDragging.current) return;
      ev.preventDefault();
      if (ev.touches[0]) emit(calcVal(ev.touches[0].clientX));
    };
    const onEnd = () => {
      isDragging.current = false;
      commit();
      document.removeEventListener("touchmove", onMove, { capture: true });
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
    document.addEventListener("touchmove", onMove, { passive: false, capture: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
  };

  // — Mouse handlers (desktop browser) —
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    lastHapticVal.current = null;
    emit(calcVal(e.clientX));
    const onMove = (ev: MouseEvent) => { if (isDragging.current) emit(calcVal(ev.clientX)); };
    const onUp = () => {
      isDragging.current = false;
      commit();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={trackRef}
      className={`relative w-full flex items-center cursor-pointer select-none ${className}`}
      style={{ touchAction: "none", userSelect: "none", height: 44 } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onMouseDown={handleMouseDown}
    >
      <div className="absolute inset-x-0 h-2 rounded-full bg-muted" />
      <div
        className="absolute h-2 rounded-full transition-none"
        style={{ width: `${pct}%`, backgroundColor: fillColor }}
      />
      <div
        className="absolute w-7 h-7 rounded-full shadow-md border-2 border-background"
        style={{ left: `calc(${pct}% - 14px)`, backgroundColor: fillColor }}
      />
    </div>
  );
}
