import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ScoreDashboard from "@/components/ScoreDashboard";
import CalendarView from "@/components/CalendarView";
import JournalPanel from "@/components/JournalPanel";
import AIInsights from "@/components/AIInsights";
import VoiceRecordingModal from "@/components/VoiceRecordingModal";
import CustomizeScoresModal from "@/components/CustomizeScoresModal";
import { Button } from "@/components/ui/button";
import { Settings, Plus, Flame, User, TrendingUp } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);

  const { data: streak } = useQuery<any>({
    queryKey: ["/api/streak"],
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-semibold">D</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">DBrief</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {streak && streak.currentStreak && (
                <div className="flex items-center space-x-2 bg-amber-50 px-3 py-1 rounded-full">
                  <Flame className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-700">
                    {streak.currentStreak} day streak
                  </span>
                </div>
              )}
              
              <Link href="/trends">
                <Button variant="ghost" size="icon">
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </Link>
              
              <Button variant="ghost" size="icon">
                <Settings className="h-4 w-4" />
              </Button>
              
              <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                <User className="h-4 w-4 text-gray-600" />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Score Dashboard */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">Today's Scores</h2>
            <Button 
              variant="ghost" 
              className="text-primary hover:text-primary/80"
              onClick={() => setIsCustomizeModalOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Customize
            </Button>
          </div>
          
          <ScoreDashboard selectedDate={selectedDate} />
        </section>

        {/* AI Insights */}
        <AIInsights />

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Calendar View */}
          <div className="lg:col-span-2">
            <CalendarView 
              selectedDate={selectedDate} 
              onDateSelect={setSelectedDate} 
            />
          </div>

          {/* Journal Panel */}
          <div className="space-y-6">
            <JournalPanel 
              selectedDate={selectedDate}
              onVoiceRecord={() => setIsVoiceModalOpen(true)}
            />
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6">
        <Button 
          size="lg"
          className="w-14 h-14 rounded-full shadow-lg hover:shadow-xl"
          onClick={() => setIsVoiceModalOpen(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      {/* Modals */}
      <VoiceRecordingModal 
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        selectedDate={selectedDate}
      />

      <CustomizeScoresModal
        isOpen={isCustomizeModalOpen}
        onClose={() => setIsCustomizeModalOpen(false)}
      />
    </div>
  );
}
