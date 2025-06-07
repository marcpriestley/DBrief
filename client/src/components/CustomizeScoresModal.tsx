import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Palette } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { UserMetric } from "@shared/schema";

interface CustomizeScoresModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PREDEFINED_COLORS = [
  "#10B981", "#4F46E5", "#F59E0B", "#8B5CF6", 
  "#EF4444", "#22C55E", "#F97316", "#06B6D4",
  "#84CC16", "#EC4899", "#6366F1", "#14B8A6"
];

export default function CustomizeScoresModal({ isOpen, onClose }: CustomizeScoresModalProps) {
  const [newMetricName, setNewMetricName] = useState("");
  const [selectedColor, setSelectedColor] = useState(PREDEFINED_COLORS[0]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: metrics = [] } = useQuery<UserMetric[]>({
    queryKey: ["/api/user-metrics"],
  });

  const createMetricMutation = useMutation({
    mutationFn: async (data: { name: string; color: string }) => {
      return apiRequest("POST", "/api/user-metrics", {
        name: data.name,
        color: data.color,
        isDefault: false,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
      setNewMetricName("");
      setSelectedColor(PREDEFINED_COLORS[0]);
      toast({
        title: "Metric added",
        description: "Your new metric has been added successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add metric. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMetricMutation = useMutation({
    mutationFn: async (data: { id: number; isActive: boolean }) => {
      return apiRequest("PUT", `/api/user-metrics/${data.id}`, {
        isActive: data.isActive,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-metrics"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update metric. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAddMetric = () => {
    if (!newMetricName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a metric name.",
        variant: "destructive",
      });
      return;
    }

    if (metrics.some(m => m.name.toLowerCase() === newMetricName.toLowerCase())) {
      toast({
        title: "Error",
        description: "A metric with this name already exists.",
        variant: "destructive",
      });
      return;
    }

    createMetricMutation.mutate({
      name: newMetricName.trim(),
      color: selectedColor,
    });
  };

  const handleToggleMetric = (metric: UserMetric) => {
    updateMetricMutation.mutate({
      id: metric.id,
      isActive: !metric.isActive,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize Your Metrics</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Add New Metric */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Add New Metric</h3>
              
              <div className="space-y-4">
                <div>
                  <Label htmlFor="metric-name">Metric Name</Label>
                  <Input
                    id="metric-name"
                    value={newMetricName}
                    onChange={(e) => setNewMetricName(e.target.value)}
                    placeholder="e.g., Stress Level, Motivation"
                    className="mt-1"
                  />
                </div>
                
                <div>
                  <Label>Color</Label>
                  <div className="grid grid-cols-6 gap-2 mt-2">
                    {PREDEFINED_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setSelectedColor(color)}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          selectedColor === color 
                            ? 'border-gray-800 scale-110' 
                            : 'border-gray-300 hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                
                <Button 
                  onClick={handleAddMetric}
                  disabled={createMetricMutation.isPending}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {createMetricMutation.isPending ? "Adding..." : "Add Metric"}
                </Button>
              </div>
            </CardContent>
          </Card>
          
          {/* Existing Metrics */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-4">Your Metrics</h3>
              
              <div className="space-y-3">
                {metrics.map((metric) => (
                  <div 
                    key={metric.id}
                    className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div 
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: metric.color }}
                      />
                      <span className="font-medium">{metric.name}</span>
                      {metric.isDefault && (
                        <Badge variant="secondary" className="text-xs">Default</Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Switch
                        checked={metric.isActive}
                        onCheckedChange={() => handleToggleMetric(metric)}
                        disabled={updateMetricMutation.isPending}
                      />
                      <span className="text-sm text-gray-500">
                        {metric.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                ))}
                
                {metrics.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Palette className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No metrics found.</p>
                    <p className="text-sm">Add your first metric above!</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        
        <div className="flex justify-end space-x-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
