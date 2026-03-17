import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Target, Plus, X, Trash2, Edit2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";

interface LongTermGoal {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function LongTermGoals() {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const { data: goals = [] } = useQuery<LongTermGoal[]>({
    queryKey: ["/api/long-term-goals"],
  });

  const addMutation = useMutation({
    mutationFn: async ({ title, description }: { title: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/long-term-goals", { title, description });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
      setNewTitle("");
      setNewDescription("");
      setShowAddForm(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) => {
      const res = await apiRequest("PUT", `/api/long-term-goals/${id}`, { title });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/long-term-goals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/long-term-goals"] });
    },
  });

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    addMutation.mutate({ title: newTitle.trim(), description: newDescription.trim() || undefined });
  };

  if (goals.length === 0 && !isExpanded) {
    return (
      <button
        onClick={() => { setIsExpanded(true); setShowAddForm(true); }}
        className="w-full text-left flex items-center gap-3 p-3 rounded-xl border border-dashed border-border hover:border-primary/30 hover:bg-muted/30 transition-all"
      >
        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Target className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Set long-term targets</p>
          <p className="text-xs text-muted-foreground">Up to 3 bigger objectives you're working toward</p>
        </div>
        <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border/50 shadow-sm overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Long-Term Targets</h3>
          <span className="text-xs text-muted-foreground">{goals.length}/3</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {goals.map((goal, i) => (
                <motion.div
                  key={goal.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="group flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/30 border border-border/30"
                >
                  <div className="w-5 h-5 rounded-full border-2 border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-bold text-primary/50">{i + 1}</span>
                  </div>

                  {editingId === goal.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editTitle.trim()) updateMutation.mutate({ id: goal.id, title: editTitle.trim() });
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => setEditingId(null)}
                      className="flex-1 h-7 text-sm"
                      autoFocus
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">{goal.title}</p>
                      {goal.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{goal.description}</p>
                      )}
                    </div>
                  )}

                  {editingId !== goal.id && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingId(goal.id); setEditTitle(goal.title); }}
                        className="p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate(goal.id)}
                        className="p-1 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}

              {goals.length < 3 && !showAddForm && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(true)}
                  className="w-full h-8 text-xs text-muted-foreground"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add target ({3 - goals.length} remaining)
                </Button>
              )}

              <AnimatePresence>
                {showAddForm && goals.length < 3 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-2"
                  >
                    <Input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="What's the target?"
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd();
                        if (e.key === "Escape") { setShowAddForm(false); setNewTitle(""); setNewDescription(""); }
                      }}
                      autoFocus
                    />
                    <Textarea
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      placeholder="Brief description (optional)"
                      className="min-h-[40px] text-xs resize-none"
                      rows={1}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleAdd}
                        disabled={!newTitle.trim() || addMutation.isPending}
                        className="h-7 text-xs"
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setShowAddForm(false); setNewTitle(""); setNewDescription(""); }}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
