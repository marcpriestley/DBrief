import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Paperclip, Keyboard, Save, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/dateUtils";
import type { JournalEntry, DailyScore, UserMetric } from "@shared/schema";

interface JournalPanelProps {
  selectedDate: string;
  onVoiceRecord: () => void;
}

export default function JournalPanel({ selectedDate, onVoiceRecord }: JournalPanelProps) {
  const [content, setContent] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: currentEntry } = useQuery<JournalEntry | null>({
    queryKey: ["/api/journal-entries", selectedDate],
  });

  const { data: recentEntries = [] } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal-entries"],
  });

  const { data: dayScores = [] } = useQuery<DailyScore[]>({
    queryKey: ["/api/daily-scores", selectedDate],
  });

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const saveEntryMutation = useMutation({
    mutationFn: async (data: { content: string; date: string; isVoiceEntry: boolean }) => {
      return apiRequest("POST", "/api/journal-entries", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      toast({
        title: "Entry saved",
        description: "Your journal entry has been saved successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save journal entry. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    setContent(currentEntry?.content || "");
  }, [currentEntry]);

  const handleSave = () => {
    if (!content.trim()) {
      toast({
        title: "Error",
        description: "Please enter some content before saving.",
        variant: "destructive",
      });
      return;
    }

    saveEntryMutation.mutate({
      content: content.trim(),
      date: selectedDate,
      isVoiceEntry: false,
    });
  };

  const handleEntryClick = (entry: JournalEntry) => {
    // This would typically navigate to the entry's date
    // For now, we'll just update the content
    setContent(entry.content);
  };

  const getPreview = (text: string): string => {
    return text.length > 100 ? text.substring(0, 100) + "..." : text;
  };

  return (
    <>
      {/* Today's Entry */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {selectedDate === new Date().toISOString().split('T')[0] 
                ? "Today's Entry" 
                : `Entry for ${formatDate(new Date(selectedDate), 'MMM d, yyyy')}`
              }
            </h3>
            <span className="text-sm text-gray-500">
              {formatDate(new Date(selectedDate), 'MMM d, yyyy')}
            </span>
          </div>
          
          <div className="space-y-4">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What's on your mind today?"
              className="min-h-[128px] resize-none"
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Button
                  variant="destructive"
                  onClick={onVoiceRecord}
                  className="flex items-center space-x-2"
                >
                  <Mic className="h-4 w-4" />
                  <span>Record</span>
                </Button>
                
                <Button variant="ghost" size="icon">
                  <Paperclip className="h-4 w-4" />
                </Button>
              </div>
              
              <Button 
                onClick={handleSave}
                disabled={saveEntryMutation.isPending}
                className="flex items-center space-x-2"
              >
                <Save className="h-4 w-4" />
                <span>{saveEntryMutation.isPending ? "Saving..." : "Save Entry"}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily Scores for Selected Date */}
      {dayScores.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center mb-4">
              <TrendingUp className="h-5 w-5 text-primary mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">
                Scores for {formatDate(new Date(selectedDate), 'MMM d, yyyy')}
              </h3>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {dayScores.map((score) => {
                const metric = metrics.find(m => m.name === score.metricName);
                const color = metric?.color || "#6B7280";
                
                return (
                  <div key={score.id} className="bg-gray-50 rounded-lg p-3 text-center">
                    <div 
                      className="w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center text-white font-semibold"
                      style={{ backgroundColor: color }}
                    >
                      {score.value}
                    </div>
                    <p className="text-sm font-medium text-gray-700">{score.metricName}</p>
                    {score.isAutoSynced && (
                      <Badge variant="secondary" className="text-xs mt-1">
                        Auto-synced
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Entries */}
      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Entries</h3>
          
          <div className="space-y-3">
            {recentEntries.slice(0, 5).map((entry) => (
              <div
                key={entry.id}
                onClick={() => handleEntryClick(entry)}
                className="p-3 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer transition-all duration-200 hover:shadow-sm hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">
                    {formatDate(new Date(entry.date), 'MMM d, yyyy')}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {entry.isVoiceEntry ? (
                      <>
                        <Mic className="h-3 w-3 mr-1" />
                        Voice
                      </>
                    ) : (
                      <>
                        <Keyboard className="h-3 w-3 mr-1" />
                        Text
                      </>
                    )}
                  </Badge>
                </div>
                <p className="text-sm text-gray-600 line-clamp-2">
                  {getPreview(entry.content)}
                </p>
              </div>
            ))}
            
            {recentEntries.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No journal entries yet.</p>
                <p className="text-sm">Start writing to see your entries here!</p>
              </div>
            )}
          </div>
          
          {recentEntries.length > 5 && (
            <Button variant="ghost" className="w-full mt-4 text-primary hover:text-primary/80">
              View All Entries
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
