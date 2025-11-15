import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useState, useRef, useEffect } from "react";
import { getCalendarDays, formatDate } from "@/lib/dateUtils";
import type { JournalEntry, DailyScore, UserMetric } from "@shared/schema";

interface CalendarViewProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

export default function CalendarView({ selectedDate, onDateSelect }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate));
  const [longPressDate, setLongPressDate] = useState<string | null>(null);
  const pressTimers = useRef<Record<string, NodeJS.Timeout>>({});

  const { data: journalEntries = [] } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal-entries"],
  });

  const { data: longPressEntry } = useQuery<JournalEntry | null>({
    queryKey: ["/api/journal-entries", longPressDate],
    queryFn: async () => {
      if (!longPressDate) return null;
      const response = await fetch(`/api/journal-entries/${longPressDate}`);
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!longPressDate,
  });

  const { data: longPressScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", longPressDate],
    queryFn: () => fetch(`/api/daily-scores/${longPressDate}`).then(res => res.json()),
    enabled: !!longPressDate,
  });

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const calendarDays = getCalendarDays(currentMonth);
  const today = new Date().toISOString().split('T')[0];

  const hasEntryForDate = (date: string): boolean => {
    return journalEntries.some(entry => entry.date === date);
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const newMonth = new Date(currentMonth);
    newMonth.setMonth(currentMonth.getMonth() + (direction === 'next' ? 1 : -1));
    setCurrentMonth(newMonth);
  };

  const handleLongPress = (dateStr: string) => {
    setLongPressDate(dateStr);
  };

  const getScoreForMetric = (metricName: string): DailyScore | undefined => {
    return longPressScores.find(score => score.metricName === metricName);
  };

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pressTimers.current).forEach(timer => clearTimeout(timer));
      pressTimers.current = {};
    };
  }, []);

  const createLongPressHandlers = (dateStr: string) => {
    const startPress = (e: React.MouseEvent | React.TouchEvent) => {
      // Clear any existing timer for this date
      if (pressTimers.current[dateStr]) {
        clearTimeout(pressTimers.current[dateStr]);
      }
      
      // Create new timer (2 seconds)
      pressTimers.current[dateStr] = setTimeout(() => {
        handleLongPress(dateStr);
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
    <Card>
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {formatDate(currentMonth, 'MMMM yyyy')}
          </h2>
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigateMonth('prev')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigateMonth('next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      
      <CardContent className="p-6">
        <div className="grid grid-cols-7 gap-1 mb-4">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-sm font-medium text-gray-500 py-2">
              {day}
            </div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            const dateStr = day ? day.toISOString().split('T')[0] : '';
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasEntry = day && hasEntryForDate(dateStr);
            const isCurrentMonth = day && day.getMonth() === currentMonth.getMonth();

            return (
              <div key={index} className="h-12">
                {day && (
                  <button
                    {...createLongPressHandlers(dateStr)}
                    onClick={() => onDateSelect(dateStr)}
                    className={`
                      w-full h-full flex flex-col items-center justify-center text-sm rounded-lg
                      transition-all duration-200 hover:bg-gray-50 hover:border-gray-200
                      select-none
                      ${isSelected 
                        ? 'bg-primary/10 border border-primary/20 text-primary font-medium' 
                        : 'border border-transparent'
                      }
                      ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                      hover:transform hover:-translate-y-0.5
                    `}
                    style={{
                      WebkitTapHighlightColor: 'transparent',
                      WebkitTouchCallout: 'none',
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                    }}
                    data-testid={`calendar-date-${dateStr}`}
                  >
                    <span className={isToday ? 'font-semibold' : ''}>{day.getDate()}</span>
                    {hasEntry && (
                      <div className={`w-1 h-1 rounded-full mt-1 ${
                        isSelected ? 'bg-primary' : 'bg-emerald-500'
                      }`} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        
        <div className="mt-4 flex items-center justify-center space-x-4 text-xs text-gray-500">
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span>Journal Entry</span>
          </div>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-primary rounded-full" />
            <span>Selected</span>
          </div>
          <div className="flex items-center space-x-1">
            <span>Hold date to view details</span>
          </div>
        </div>
      </CardContent>

      {/* Journal Entry & Scores Dialog */}
      <Dialog open={!!longPressDate} onOpenChange={(open) => !open && setLongPressDate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {longPressDate && new Date(longPressDate).toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </DialogTitle>
            <DialogDescription>
              Journal entry and daily scores
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Daily Scores Section */}
            {longPressScores.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Scores</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {metrics.map((metric) => {
                    const score = getScoreForMetric(metric.name);
                    const value = score?.value;
                    const maxValue = metric.maxValue || 100;
                    const percentage = value !== undefined ? Math.min(100, Math.max(0, (value / maxValue) * 100)) : 0;

                    return (
                      <div key={metric.id} className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="relative w-12 h-12 mx-auto mb-2">
                          <div 
                            className="w-full h-full rounded-full"
                            style={{
                              background: value !== undefined
                                ? `conic-gradient(from 0deg, ${metric.color} ${percentage}%, #E5E7EB ${percentage}%)`
                                : '#E5E7EB'
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-sm font-semibold text-gray-900">
                              {value !== undefined ? value : '—'}
                            </span>
                          </div>
                        </div>
                        <h4 className="text-xs font-medium text-gray-700">{metric.name}</h4>
                        {score?.isAutoSynced && (
                          <span className="text-xs text-blue-600">Auto-synced</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Journal Entry Section */}
            {longPressEntry ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Journal Entry</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  {longPressEntry.isVoiceEntry && (
                    <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded-md mb-2">
                      Voice Entry
                    </span>
                  )}
                  <p className="text-gray-800 whitespace-pre-wrap">{longPressEntry.content}</p>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                <p>No journal entry for this date</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
