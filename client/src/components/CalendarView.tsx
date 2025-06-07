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

  const { data: journalEntries = [] } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal-entries"],
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
                    onClick={() => onDateSelect(dateStr)}
                    className={`
                      w-full h-full flex flex-col items-center justify-center text-sm rounded-lg
                      transition-all duration-200 hover:bg-gray-50 hover:border-gray-200
                      ${isSelected 
                        ? 'bg-primary/10 border border-primary/20 text-primary font-medium' 
                        : 'border border-transparent'
                      }
                      ${!isCurrentMonth ? 'text-gray-400' : 'text-gray-900'}
                      hover:transform hover:-translate-y-0.5
                    `}
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
        </div>
      </CardContent>
    </Card>
  );
}
