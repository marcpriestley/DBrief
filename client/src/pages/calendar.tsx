import { useState } from "react";
import { useLocation } from "wouter";
import AppLayout from "@/components/AppLayout";
import CalendarView from "@/components/CalendarView";

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayStr());
  const [, setLocation] = useLocation();

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setLocation(`/?date=${date}`);
  };

  return (
    <AppLayout>
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-black uppercase tracking-tight text-foreground">Session History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Tap any date to view your journal and scores</p>
        </div>
        <CalendarView selectedDate={selectedDate} onDateSelect={handleDateSelect} />
      </div>
    </AppLayout>
  );
}
