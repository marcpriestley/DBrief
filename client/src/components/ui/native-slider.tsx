import { useRef, useEffect } from "react";
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
 * Touch-event slider that works reliably on iOS WKWebView.
 * Radix UI's Slider uses pointer-capture which iOS WKWebView handles inconsistently
 * (drag doesn't fire — only tap/click works). This implementation attaches
 * touchstart directly to the track element and listens for touchmove/touchend on
 * the document with capture:true so it fires even inside scroll containers or
 * modals that call stopPropagation.
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
  const lastEmittedVal = useRef(value);

  const range = max - min;
  const pct = range === 0 ? 0 : Math.max(0, Math.min(100, ((value - min) / range) * 100));
  const fillColor = color ?? "hsl(var(--primary))";

  const emitWithHaptic = (newVal: number) => {
    lastEmittedVal.current = newVal;
    onChangeRef.current(newVal);
    if (lastHapticVal.current === null || Math.abs(newVal - lastHapticVal.current) >= step) {
      haptic("light");
      lastHapticVal.current = newVal;
    }
  };

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    const getVal = (clientX: number) => {
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + ratio * range;
      const stepped = Math.round(raw / step) * step;
      return Math.max(min, Math.min(max, stepped));
    };

    const commit = () => { onCommitRef.current?.(lastEmittedVal.current); };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      if (e.touches[0]) emitWithHaptic(getVal(e.touches[0].clientX));
    };
    const onTouchEnd = () => {
      isDragging.current = false;
      commit();
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      isDragging.current = true;
      lastHapticVal.current = null;
      if (e.touches[0]) emitWithHaptic(getVal(e.touches[0].clientX));
      document.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
      document.addEventListener("touchend", onTouchEnd);
      document.addEventListener("touchcancel", onTouchEnd);
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      lastHapticVal.current = null;
      emitWithHaptic(getVal(e.clientX));
      const onMouseMove = (e: MouseEvent) => { if (isDragging.current) emitWithHaptic(getVal(e.clientX)); };
      const onMouseUp = () => {
        isDragging.current = false;
        commit();
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("mousedown", onMouseDown);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [min, max, step, range]);

  return (
    <div
      ref={trackRef}
      className={`relative w-full flex items-center cursor-pointer select-none ${className}`}
      style={{ touchAction: "none", userSelect: "none", height: 44 } as React.CSSProperties}
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
