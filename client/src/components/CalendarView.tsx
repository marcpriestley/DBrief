import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import { getCalendarDays, formatDate } from "@/lib/dateUtils";
import type { JournalEntry, DailyScore, UserMetric } from "@shared/schema";

interface DebriefMessage {
  id: number;
  role: string;
  content: string;
}

interface Debrief {
  id: number;
  summary: string | null;
  isComplete: boolean;
  messages: DebriefMessage[];
}

interface CalendarViewProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

export default function CalendarView({ selectedDate, onDateSelect }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate));
  const [longPressDate, setLongPressDate] = useState<string | null>(null);
  const pressTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const { data: datesWithData = [] } = useQuery<string[]>({
    queryKey: ["/api/dates-with-data"],
  });

  const { data: longPressEntry } = useQuery<JournalEntry | null>({
    queryKey: ["/api/journal-entries", longPressDate],
    queryFn: async () => {
      if (!longPressDate) return null;
      const response = await fetch(`/api/journal-entries/${longPressDate}`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!longPressDate,
  });

  const { data: longPressDebrief } = useQuery<Debrief | null>({
    queryKey: ["/api/debriefs", longPressDate],
    queryFn: async () => {
      if (!longPressDate) return null;
      const response = await fetch(`/api/debriefs/${longPressDate}`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!longPressDate,
  });

  const { data: longPressScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", longPressDate],
    queryFn: () => fetch(`/api/daily-scores/${longPressDate}`, { credentials: "include" }).then(res => res.json()),
    enabled: !!longPressDate,
  });

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const calendarDays = getCalendarDays(currentMonth);
  const today = new Date().toISOString().split('T')[0];
  const datesSet = new Set(datesWithData);

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(currentMonth.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentMonth(newMonth);
  };

  const getScoreForMetric = (metricName: string): DailyScore | undefined => {
    return longPressScores.find(score => score.metricName === metricName);
  };

  useEffect(() => {
    return () => {
      Object.values(pressTimers.current).forEach(timer => clearTimeout(timer));
      pressTimers.current = {};
    };
  }, []);

  const createLongPressHandlers = (dateStr: string) => {
    const startPress = () => {
      if (pressTimers.current[dateStr]) clearTimeout(pressTimers.current[dateStr]);
      pressTimers.current[dateStr] = setTimeout(() => {
        setLongPressDate(dateStr);
        delete pressTimers.current[dateStr];
      }, 2000);
    };
    const cancelPress = () => {
      if (pressTimers.current[dateStr]) {
        clearTimeout(pressTimers.current[dateStr]);
        delete pressTimers.current[dateStr];
      }
    };
    return {
      onMouseDown: startPress,
      onMouseUp: cancelPress,
      onMouseLeave: cancelPress,
      onTouchStart: startPress,
      onTouchEnd: cancelPress,
    };
  };

  return (
    <Card className="border-0 shadow-sm">
      <div className="px-5 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {formatDate(currentMonth, 'MMMM yyyy')}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateMonth('prev')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateMonth('next')}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <CardContent className="p-4">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
            <div key={i} className="text-center text-xs font-medium text-muted-foreground py-1.5">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            const dateStr = day ? day.toISOString().split('T')[0] : '';
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasEntry = day && datesSet.has(dateStr);
            const isCurrentMonth = day && day.getMonth() === currentMonth.getMonth();

            return (
              <div key={index} className="h-10">
                {day && (
                  <button
                    {...createLongPressHandlers(dateStr)}
                    onClick={() => onDateSelect(dateStr)}
                    className={`
                      w-full h-full flex flex-col items-center justify-center text-sm rounded-lg
                      transition-all duration-150 select-none
                      ${isSelected
                        ? 'bg-primary text-primary-foreground font-medium'
                        : isToday
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted/60'
                      }
                      ${!isCurrentMonth ? 'text-muted-foreground/40' : isSelected ? '' : 'text-foreground'}
                    `}
                    style={{ WebkitTapHighlightColor: 'transparent', WebkitTouchCallout: 'none', userSelect: 'none' }}
                  >
                    <span>{day.getDate()}</span>
                    {hasEntry && (
                      <div className={`w-1 h-1 rounded-full mt-0.5 ${
                        isSelected ? 'bg-primary-foreground' : 'bg-emerald-500'
                      }`} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
            <span>Has data</span>
          </div>
          <span>Hold to preview</span>
        </div>
      </CardContent>

      <Dialog open={!!longPressDate} onOpenChange={(open) => !open && setLongPressDate(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {longPressDate && new Date(longPressDate + "T12:00:00").toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              })}
            </DialogTitle>
            <DialogDescription>Daily summary</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {longPressScores.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Scores</h3>
                <div className="grid grid-cols-3 gap-2">
                  {metrics.map((metric) => {
                    const score = getScoreForMetric(metric.name);
                    const value = score?.value;
                    const maxValue = metric.maxValue || 100;
                    const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;
                    return (
                      <div key={metric.id} className="bg-muted/50 rounded-lg p-2.5 text-center">
                        <div className="relative w-10 h-10 mx-auto mb-1.5">
                          <div
                            className="w-full h-full rounded-full"
                            style={{
                              background: value !== undefined
                                ? `conic-gradient(from 0deg, ${metric.color} ${percentage}%, var(--border) ${percentage}%)`
                                : 'var(--border)'
                            }}
                          />
                          <div className="absolute inset-1 rounded-full bg-card flex items-center justify-center">
                            <span className="text-xs font-semibold">{value ?? '—'}</span>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground">{metric.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {longPressDebrief && longPressDebrief.messages?.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageCircle className="h-3 w-3" />
                  Debrief
                </h3>
                {longPressDebrief.summary && (
                  <p className="text-sm text-muted-foreground italic mb-3">{longPressDebrief.summary}</p>
                )}
                <div className="space-y-2">
                  {longPressDebrief.messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted rounded-bl-md"
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {longPressEntry && !longPressEntry.content.startsWith("[Debrief]") && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Journal</h3>
                <div className="bg-muted/50 rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">{longPressEntry.content}</p>
                </div>
              </div>
            )}

            {!longPressScores.length && !longPressDebrief && !longPressEntry && (
              <div className="text-center text-muted-foreground py-6">
                <p className="text-sm">No data for this date</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
