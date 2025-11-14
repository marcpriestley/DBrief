import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Save, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSpeechToText } from "@/hooks/useSpeechToText";
import { apiRequest } from "@/lib/queryClient";
import type { JournalEntry } from "@shared/schema";

interface VoiceRecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
}

export default function VoiceRecordingModal({ 
  isOpen, 
  onClose, 
  selectedDate 
}: VoiceRecordingModalProps) {
  const [transcription, setTranscription] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: currentEntry } = useQuery<JournalEntry | null>({
    queryKey: ["/api/journal-entries", selectedDate],
    enabled: isOpen,
  });
  
  const {
    isRecording,
    isSupported,
    startRecording,
    stopRecording,
    transcript,
  } = useSpeechToText();

  const saveEntryMutation = useMutation({
    mutationFn: async (data: { content: string; date: string; isVoiceEntry: boolean }) => {
      const response = await apiRequest("POST", "/api/journal-entries", data);
      return response.json() as Promise<JournalEntry>;
    },
    onSuccess: (data: JournalEntry, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries", variables.date] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      toast({
        title: "Voice entry saved",
        description: "Your voice journal entry has been saved successfully.",
      });
      handleClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save voice entry. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (transcript) {
      setTranscription(transcript);
    }
  }, [transcript]);

  useEffect(() => {
    if (isOpen && !isSupported) {
      toast({
        title: "Voice recording not supported",
        description: "Your browser doesn't support voice recording. Please use a modern browser.",
        variant: "destructive",
      });
    }
  }, [isOpen, isSupported, toast]);

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      setTranscription("");
      startRecording();
    }
  };

  const handleSave = () => {
    if (!transcription.trim()) {
      toast({
        title: "Error",
        description: "No transcription available. Please record something first.",
        variant: "destructive",
      });
      return;
    }

    // Check if this is today's date
    const today = new Date().toISOString().split('T')[0];
    const isToday = selectedDate === today;
    
    let finalContent = transcription.trim();
    
    if (isToday) {
      // Only add timestamps for today's entries
      if (currentEntry?.content) {
        // Append with timestamp if there's existing content
        const timestamp = new Date().toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        finalContent = `${currentEntry.content}\n\n[${timestamp}]\n${transcription.trim()}`;
      } else {
        // First entry of today, add timestamp
        const timestamp = new Date().toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true 
        });
        finalContent = `[${timestamp}]\n${transcription.trim()}`;
      }
    } else if (currentEntry?.content) {
      // For past dates, append without timestamp to preserve existing content
      finalContent = `${currentEntry.content}\n\n${transcription.trim()}`;
    }

    saveEntryMutation.mutate({
      content: finalContent,
      date: selectedDate,
      isVoiceEntry: true,
    });
  };

  const handleClose = () => {
    if (isRecording) {
      stopRecording();
    }
    setTranscription("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <div className="text-center p-6">
          <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center transition-all duration-300 ${
            isRecording 
              ? 'bg-red-500 animate-pulse shadow-lg shadow-red-200' 
              : 'bg-gray-500 hover:bg-gray-600'
          }`}>
            {isRecording ? (
              <Mic className="h-8 w-8 text-white" />
            ) : (
              <MicOff className="h-8 w-8 text-white" />
            )}
          </div>
          
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            {isRecording ? "Recording..." : "Voice Recording"}
          </h3>
          
          <p className="text-gray-600 mb-6">
            {isRecording 
              ? "Speak clearly and we'll transcribe your words"
              : "Click the microphone to start recording"
            }
          </p>
          
          {/* Transcription Display */}
          <Card className="bg-gray-50 p-4 mb-6 min-h-[100px] text-left">
            {transcription ? (
              <p className="text-gray-700">{transcription}</p>
            ) : (
              <p className="text-gray-400 italic">
                {isRecording ? "Listening..." : "Your transcription will appear here"}
              </p>
            )}
          </Card>
          
          {!isSupported && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                Voice recording is not supported in your browser. Please try a different browser.
              </p>
            </div>
          )}
          
          <div className="flex space-x-3">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={handleClose}
              disabled={saveEntryMutation.isPending}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            
            {isSupported && (
              <Button 
                variant={isRecording ? "destructive" : "default"}
                className="flex-1"
                onClick={handleToggleRecording}
                disabled={saveEntryMutation.isPending}
              >
                {isRecording ? (
                  <>
                    <MicOff className="h-4 w-4 mr-2" />
                    Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4 mr-2" />
                    Record
                  </>
                )}
              </Button>
            )}
            
            {transcription && (
              <Button 
                className="flex-1"
                onClick={handleSave}
                disabled={saveEntryMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {saveEntryMutation.isPending ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
