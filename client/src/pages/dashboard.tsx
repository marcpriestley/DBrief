import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import ScoreDashboard from "@/components/ScoreDashboard";
import CalendarView from "@/components/CalendarView";
import JournalPanel from "@/components/JournalPanel";
import AIInsights from "@/components/AIInsights";
import VoiceRecordingModal from "@/components/VoiceRecordingModal";
import CustomizeScoresModal from "@/components/CustomizeScoresModal";
import SettingsModal from "@/components/SettingsModal";
import StreakDisplay from "@/components/StreakDisplay";
import GoalsSection from "@/components/GoalsSection";
import { Button } from "@/components/ui/button";
import { Settings, Plus, User, TrendingUp, LogOut } from "lucide-react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isCustomizeModalOpen, setIsCustomizeModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const { toast } = useToast();

  const { data: streak } = useQuery<any>({
    queryKey: ["/api/streak"],
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      window.location.href = "/";
    },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between items-center h-auto md:h-16 py-3 md:py-0 gap-3">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white text-sm font-semibold">D</span>
              </div>
              <h1 className="text-xl font-semibold text-gray-900">DBrief</h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <StreakDisplay streak={streak} />
              
              <Link href="/trends">
                <Button variant="ghost" size="icon">
                  <TrendingUp className="h-4 w-4" />
                </Button>
              </Link>
              
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setIsSettingsModalOpen(true)}
                data-testid="button-settings"
              >
                <Settings className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => logoutMutation.mutate()}
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
          
          <ScoreDashboard />
        </section>

        <section className="mb-8 bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <GoalsSection selectedDate={selectedDate} />
        </section>

        <section className="mb-8">
          <JournalPanel 
            selectedDate={selectedDate}
            onVoiceRecord={() => setIsVoiceModalOpen(true)}
          />
        </section>

        <section className="mb-8">
          <CalendarView 
            selectedDate={selectedDate} 
            onDateSelect={setSelectedDate} 
          />
        </section>

        <AIInsights />
      </main>

      <div className="fixed bottom-6 right-6">
        <Button 
          size="lg"
          className="w-14 h-14 rounded-full shadow-lg hover:shadow-xl"
          onClick={() => setIsVoiceModalOpen(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>
      </div>

      <VoiceRecordingModal 
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        selectedDate={selectedDate}
      />

      <CustomizeScoresModal
        isOpen={isCustomizeModalOpen}
        onClose={() => setIsCustomizeModalOpen(false)}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
