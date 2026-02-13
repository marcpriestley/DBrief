import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, Paperclip, Keyboard, Save, TrendingUp, X, FileText, Image, File as FileIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatDate } from "@/lib/dateUtils";
import { useUpload } from "@/hooks/use-upload";
import type { JournalEntry, DailyScore, UserMetric, JournalAttachment } from "@shared/schema";

interface JournalPanelProps {
  selectedDate: string;
  onVoiceRecord: () => void;
}

function getFileIcon(contentType: string) {
  if (contentType.startsWith("image/")) return Image;
  return FileText;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function JournalPanel({ selectedDate, onVoiceRecord }: JournalPanelProps) {
  const [content, setContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: currentEntry } = useQuery<JournalEntry | null>({
    queryKey: ["/api/journal-entries", selectedDate],
    queryFn: async () => {
      const response = await fetch(`/api/journal-entries/${selectedDate}`);
      if (!response.ok) return null;
      return response.json();
    },
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

  const { data: attachments = [] } = useQuery<JournalAttachment[]>({
    queryKey: ["/api/journal-attachments", currentEntry?.id],
    queryFn: async () => {
      if (!currentEntry?.id) return [];
      const response = await fetch(`/api/journal-attachments/${currentEntry.id}`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!currentEntry?.id,
  });

  const { uploadFile, isUploading } = useUpload({
    onSuccess: async (response) => {
      if (!currentEntry?.id) {
        toast({ title: "Save your entry first", description: "Please save your journal entry before adding attachments.", variant: "destructive" });
        return;
      }
      try {
        await apiRequest("POST", "/api/journal-attachments", {
          journalEntryId: currentEntry.id,
          objectPath: response.objectPath,
          filename: response.metadata.name,
          contentType: response.metadata.contentType,
          size: response.metadata.size,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/journal-attachments", currentEntry.id] });
        toast({ title: "File attached", description: `${response.metadata.name} has been attached to this entry.` });
      } catch {
        toast({ title: "Error", description: "Failed to save attachment metadata.", variant: "destructive" });
      }
    },
    onError: (error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/journal-attachments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/journal-attachments", currentEntry?.id] });
      toast({ title: "Attachment removed" });
    },
  });

  const saveEntryMutation = useMutation({
    mutationFn: async (data: { content: string; date: string; isVoiceEntry: boolean }) => {
      const response = await apiRequest("POST", "/api/journal-entries", data);
      return response.json() as Promise<JournalEntry>;
    },
    onSuccess: (data: JournalEntry, variables) => {
      setContent(data.content);
      setInitialContent(data.content);
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries", variables.date] });
      queryClient.invalidateQueries({ queryKey: ["/api/streak"] });
      toast({ title: "Entry saved", description: "Your journal entry has been saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save journal entry. Please try again.", variant: "destructive" });
    },
  });

  useEffect(() => {
    const entryContent = currentEntry?.content || "";
    setContent(entryContent);
    setInitialContent(entryContent);
  }, [currentEntry]);

  const handleSave = () => {
    if (!content.trim()) {
      toast({ title: "Error", description: "Please enter some content before saving.", variant: "destructive" });
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const isToday = selectedDate === today;
    let finalContent = content;

    if (isToday) {
      if (initialContent && content.startsWith(initialContent)) {
        const afterInitial = content.substring(initialContent.length);
        const newContent = afterInitial.trim();
        if (newContent) {
          const timestamp = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          finalContent = `${initialContent}\n\n[${timestamp}]\n${newContent}`;
        } else {
          finalContent = initialContent;
        }
      } else if (!initialContent) {
        const timestamp = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        finalContent = `[${timestamp}]\n${content.trim()}`;
      }
    }

    saveEntryMutation.mutate({ content: finalContent, date: selectedDate, isVoiceEntry: false });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentEntry?.id) {
      toast({ title: "Save entry first", description: "Please save your journal entry before attaching files.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 10MB.", variant: "destructive" });
      e.target.value = "";
      return;
    }

    await uploadFile(file);
    e.target.value = "";
  };

  const handleEntryClick = (entry: JournalEntry) => {
    setContent(entry.content);
  };

  const getPreview = (text: string): string => {
    return text.length > 100 ? text.substring(0, 100) + "..." : text;
  };

  return (
    <>
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

            {attachments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Attachments</p>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att) => {
                    const Icon = getFileIcon(att.contentType);
                    const isImage = att.contentType.startsWith("image/");
                    return (
                      <div key={att.id} className="group relative flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                        {isImage ? (
                          <a href={att.objectPath} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-gray-700 hover:text-primary">
                            <Icon className="h-4 w-4 text-blue-500" />
                            <span className="max-w-[120px] truncate">{att.filename}</span>
                          </a>
                        ) : (
                          <a href={att.objectPath} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-gray-700 hover:text-primary">
                            <Icon className="h-4 w-4 text-gray-500" />
                            <span className="max-w-[120px] truncate">{att.filename}</span>
                          </a>
                        )}
                        <span className="text-xs text-gray-400">{formatFileSize(att.size)}</span>
                        <button
                          onClick={() => deleteAttachmentMutation.mutate(att.id)}
                          className="p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  title={currentEntry?.id ? "Attach a file" : "Save entry first to attach files"}
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
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
