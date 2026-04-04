import { createContext, useContext, useState, useEffect, useCallback } from "react";

export type DayView = "yesterday" | "today" | "tomorrow" | "historical";

interface DateContextValue {
  dayView: DayView;
  setDayView: (v: DayView) => void;
  historicalDate: string | null;
  setHistoricalDate: (d: string | null) => void;
  selectedDate: string;
  todayStr: string;
  yesterdayStr: string;
  tomorrowStr: string;
  goHome: () => void;
  journalPreference?: string;
}

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getSmartDefault(_journalPreference?: string): DayView {
  return "today";
}

export const DateContext = createContext<DateContextValue>({
  dayView: "today",
  setDayView: () => {},
  historicalDate: null,
  setHistoricalDate: () => {},
  selectedDate: getDateStr(0),
  todayStr: getDateStr(0),
  yesterdayStr: getDateStr(-1),
  tomorrowStr: getDateStr(1),
  goHome: () => {},
});

export function useDateContext() {
  return useContext(DateContext);
}

interface DateProviderProps {
  children: React.ReactNode;
  journalPreference?: string;
  goalPreference?: string;
  userReady: boolean;
}

export function DateProvider({ children, journalPreference, userReady }: DateProviderProps) {
  const [dayView, setDayViewRaw] = useState<DayView>("today");
  const [historicalDate, setHistoricalDate] = useState<string | null>(null);
  const [defaultApplied, setDefaultApplied] = useState(false);

  const todayStr = getDateStr(0);
  const yesterdayStr = getDateStr(-1);
  const tomorrowStr = getDateStr(1);

  const selectedDate =
    dayView === "today" ? todayStr :
    dayView === "yesterday" ? yesterdayStr :
    dayView === "tomorrow" ? tomorrowStr :
    (historicalDate ?? todayStr);

  const setDayView = useCallback((v: DayView) => {
    setDayViewRaw(v);
    if (v !== "historical") setHistoricalDate(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  const goHome = useCallback(() => {
    setDayViewRaw(getSmartDefault(journalPreference));
    setHistoricalDate(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [journalPreference]);

  // Read URL params on mount once user data is ready
  useEffect(() => {
    if (!userReady || defaultApplied) return;
    setDefaultApplied(true);

    const params = new URLSearchParams(window.location.search);
    const dateParam = params.get("date");

    if (dateParam) {
      window.history.replaceState({}, "", window.location.pathname);
      if (dateParam === todayStr) {
        setDayViewRaw("today");
      } else if (dateParam === yesterdayStr) {
        setDayViewRaw("yesterday");
      } else {
        setHistoricalDate(dateParam);
        setDayViewRaw("historical");
      }
    } else {
      setDayViewRaw(getSmartDefault(journalPreference));
    }
  }, [userReady, defaultApplied, todayStr, yesterdayStr, journalPreference]);

  return (
    <DateContext.Provider value={{
      dayView, setDayView,
      historicalDate, setHistoricalDate,
      selectedDate, todayStr, yesterdayStr, tomorrowStr,
      goHome, journalPreference,
    }}>
      {children}
    </DateContext.Provider>
  );
}
