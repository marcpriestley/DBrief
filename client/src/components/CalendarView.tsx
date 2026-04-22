import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
import { getCalendarDays, formatDate } from "@/lib/dateUtils";
import type { JournalEntry } from "@shared/schema";

interface CalendarViewProps {
  selectedDate: string;
  onDateSelect: (date: string) => void;
}

export default function CalendarView({ selectedDate, onDateSelect }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate));

  const today = new Date().toISOString().split('T')[0];

  const { data: journalEntries = [] } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal-entries"],
  });

  const calendarDays = getCalendarDays(currentMonth);

  const datesSet = new Set(
    journalEntries
      .map(e => e.date?.split('T')[0])
      .filter(Boolean)
  );

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + (direction === 'prev' ? -1 : 1));
      return d;
    });
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
                    {isToday && !isSelected && (
                      <div className="w-4 h-0.5 rounded-full bg-primary mt-0.5" />
                    )}
                    {hasEntry && !isToday && (
                      <div className={`w-1 h-1 rounded-full mt-0.5 ${
                        isSelected ? 'bg-primary-foreground' : 'bg-emerald-500'
                      }`} />
                    )}
                    {hasEntry && isToday && !isSelected && (
                      <div className="w-1 h-1 rounded-full bg-emerald-500" />
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
          <span>Tap a date to view</span>
        </div>
      </CardContent>
    </Card>
  );
}
