import { useCallback, useRef, useState } from 'react';

const DEFAULT_DELAY = 500;

export interface LongPressHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

export function useLongPress(
  callback: (e: React.MouseEvent | React.TouchEvent) => void,
  delay: number = DEFAULT_DELAY
): LongPressHandlers {
  const [longPressTriggered, setLongPressTriggered] = useState(false);
  const timeout = useRef<NodeJS.Timeout>();

  const start = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      setLongPressTriggered(false);
      timeout.current = setTimeout(() => {
        callback(e);
        setLongPressTriggered(true);
      }, delay);
    },
    [callback, delay]
  );

  const clear = useCallback(() => {
    timeout.current && clearTimeout(timeout.current);
    setLongPressTriggered(false);
  }, []);

  return {
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: start,
    onTouchEnd: clear,
  };
}
