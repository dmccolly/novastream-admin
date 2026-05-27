import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { clocksApi, scheduleApi, categoriesApi, rulesApi, Category } from "@/lib/api";
import { toast } from "sonner";
import { Save, Clock as ClockIcon, Calendar, Settings, PlayCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Clock {
  id: number;
  name: string;
  color: string;
}

interface GridCell {
  id: number;
  day_of_week: number;
  hour: number;
  clock_id: number;
  clock_name: string;
  clock_color: string;
}

interface Rule {
  id?: number;
  category_id: number;
  min_separation: number;
  tempo_range_min?: number;
  tempo_range_max?: number;
  selection_mode: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export default function Scheduler() {
  const [clocks, setClocks] = useState<Clock[]>([]);
  const [grid, setGrid] = useState<GridCell[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedClockId, setSelectedClockId] = useState<number | null>(null);
  const [isMasterClockMode, setIsMasterClockMode] = useState(() => {
    return localStorage.getItem("isMasterClockMode") === "true";
  });
  const [masterClockId, setMasterClockId] = useState<string>(() => {
    return localStorage.getItem("masterClockId") || "0";
  });

  useEffect(() => {
    localStorage.setItem("isMasterClockMode", String(isMasterClockMode));
  }, [isMasterClockMode]);

  useEffect(() => {
    localStorage.setItem("masterClockId", masterClockId);
  }, [masterClockId]);
  const [loading, setLoading] = useState(false);
  
  // Dialog states
  const [rulesOpen, setRulesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [rules, setRules] = useState<Record<number, Rule>>({});
  const [previewLog, setPreviewLog] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Fetch data
  useEffect(() => {
    Promise.all([
      clocksApi.getAll(),
      scheduleApi.getGrid(),
      categoriesApi.getAll(),
      rulesApi.getAll()
    ]).then(([clks, grd, cats, rls]) => {
      setClocks(clks);
      setGrid(grd);
      setCategories(cats);
      
      // Map rules by category_id
      const rulesMap: Record<number, Rule> = {};
      rls.forEach((r: Rule) => {
        rulesMap[r.category_id] = r;
      });
      setRules(rulesMap);

      if (clks.length > 0) {
        setSelectedClockId(clks[0].id);
      }
    }).catch(console.error);
  }, []);

  const handleCellClick = (day: number, hour: number) => {
    if (!selectedClockId) {
      toast.error("Select a clock from the right sidebar first");
      return;
    }

    const selectedClock = clocks.find(c => c.id === selectedClockId);
    if (!selectedClock) return;

    const newGrid = [...grid];
    const existingIndex = newGrid.findIndex(c => c.day_of_week === day && c.hour === hour);
    
    const newCell = {
      id: existingIndex >= 0 ? newGrid[existingIndex].id : 0,
      day_of_week: day,
      hour: hour,
      clock_id: selectedClockId,
      clock_name: selectedClock.name,
      clock_color: selectedClock.color
    };

    if (existingIndex >= 0) {
      newGrid[existingIndex] = newCell;
    } else {
      newGrid.push(newCell);
    }

    setGrid(newGrid);
  };

  const handleSaveGrid = async () => {
    setLoading(true);
    try {
      let assignments;
      if (isMasterClockMode) {
        const mid = parseInt(masterClockId, 10);
        if (!mid) {
          toast.error("Pick a master clock first");
          setLoading(false);
          return;
        }
        // Fill every day/hour with the master clock
        assignments = [];
        for (let d = 0; d < 7; d++) {
          for (let h = 0; h < 24; h++) {
            assignments.push({ day: d, hour: h, clock_id: mid });
          }
        }
      } else {
        assignments = grid.map(cell => ({
          day: cell.day_of_week,
          hour: cell.hour,
          clock_id: cell.clock_id
        }));
      }
      await scheduleApi.updateGrid(assignments);
      // Refresh grid so the (now-hidden) state matches the server
      const fresh = await scheduleApi.getGrid();
      setGrid(fresh);
      toast.success(isMasterClockMode ? "Master clock applied to all 168 hours" : "Schedule saved successfully");
    } catch (error) {
      toast.error("Failed to save schedule");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRule = async (categoryId: number, ruleData: Partial<Rule>) => {
    try {
      const currentRule = rules[categoryId] || { 
        category_id: categoryId, 
        min_separation: 0, 
        selection_mode: 'random' 
      };
      const newRule = { ...currentRule, ...ruleData };
      
      await rulesApi.save(newRule);
      setRules(prev => ({ ...prev, [categoryId]: newRule }));
      toast.success("Rule saved");
    } catch (error) {
      toast.error("Failed to save rule");
    }
  };

  const generatePreview = async () => {
    if (!selectedClockId) return;
    setPreviewLoading(true);
    try {
      // Use axios directly or add to api.ts. For now assuming api.ts is updated or using fetch
      // Since I didn't update api.ts with preview, I'll use fetch here for simplicity or assume api.post works
      // Use the api client which handles the base URL correctly
      const response = await scheduleApi.generatePreview(selectedClockId);
      setPreviewLog(response.log);
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const getCellClock = (day: number, hour: number) => {
    return grid.find(c => c.day_of_week === day && c.hour === hour);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-2rem)] flex flex-col gap-4">
        <div className="flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-3xl font-display font-bold">Scheduler</h1>
            <p className="text-muted-foreground text-sm">Manage weekly programming</p>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setRulesOpen(true)}>
              <Settings className="w-4 h-4 mr-2" />
              Rules
            </Button>
            <Button variant="outline" onClick={() => {
              setPreviewOpen(true);
              if (selectedClockId) generatePreview();
            }}>
              <PlayCircle className="w-4 h-4 mr-2" />
              Preview
            </Button>
            <div className="flex items-center gap-2 bg-card border border-border/50 p-2 rounded-md">
              <Switch 
                id="mode-toggle" 
                checked={isMasterClockMode}
                onCheckedChange={setIsMasterClockMode}
              />
              <Label htmlFor="mode-toggle" className="cursor-pointer">Master Clock Mode</Label>
            </div>
            <Button onClick={handleSaveGrid} disabled={loading}>
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          </div>
        </div>

        {isMasterClockMode ? (
          <Card className="glass-panel flex-1 flex items-center justify-center">
            <div className="text-center space-y-4 max-w-md">
              <ClockIcon className="w-16 h-16 mx-auto text-primary opacity-50" />
              <h2 className="text-2xl font-bold">Master Clock Active</h2>
              <p className="text-muted-foreground">
                In Master Clock mode, a single clock template is repeated 24/7.
                This is useful for consistent formats.
              </p>
              <div className="space-y-2 text-left">
                <Label>Select Master Clock</Label>
                <Select value={masterClockId} onValueChange={setMasterClockId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a clock" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None</SelectItem>
                    {clocks.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>
        ) : (
          <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">
            {/* Grid */}
            <Card className="col-span-9 glass-panel flex flex-col min-h-0">
              <CardContent className="flex-1 overflow-auto p-0">
                <div className="grid grid-cols-[50px_repeat(7,1fr)] min-w-[800px]">
                  {/* Header Row */}
                  <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/50 p-2"></div>
                  {DAYS.map((day, i) => (
                    <div key={day} className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/50 border-l border-border/50 p-2 text-center font-bold text-sm">
                      {day}
                    </div>
                  ))}

                  {/* Rows */}
                  {HOURS.map(hour => (
                    <>
                      {/* Time Label */}
                      <div key={`label-${hour}`} className="sticky left-0 z-10 bg-background/95 backdrop-blur border-b border-border/50 border-r border-border/50 p-2 text-xs text-muted-foreground text-center flex items-center justify-center">
                        {hour}:00
                      </div>
                      
                      {/* Cells */}
                      {DAYS.map((_, dayIndex) => {
                        const cell = getCellClock(dayIndex, hour);
                        return (
                          <div 
                            key={`cell-${dayIndex}-${hour}`}
                            className="border-b border-r border-border/50 h-12 cursor-pointer hover:brightness-110 transition-all relative group"
                            style={{ backgroundColor: cell?.clock_color || 'transparent' }}
                            onClick={() => handleCellClick(dayIndex, hour)}
                          >
                            {cell ? (
                              <div className="w-full h-full flex items-center justify-center text-xs font-medium text-white truncate px-1">
                                {cell.clock_name}
                              </div>
                            ) : (
                              <div className="w-full h-full opacity-0 group-hover:opacity-100 bg-primary/10 flex items-center justify-center text-xs text-muted-foreground">
                                +
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Sidebar Palette */}
            <Card className="col-span-3 glass-panel flex flex-col min-h-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Clock Palette</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto p-2 space-y-2">
                {clocks.map(clock => (
                  <div 
                    key={clock.id}
                    className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-all border ${
                      selectedClockId === clock.id 
                        ? "border-primary ring-1 ring-primary" 
                        : "border-transparent hover:bg-accent"
                    }`}
                    onClick={() => setSelectedClockId(clock.id)}
                  >
                    <div 
                      className="w-4 h-4 rounded-full border border-white/20" 
                      style={{ backgroundColor: clock.color }}
                    />
                    <span className="text-sm font-medium">{clock.name}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Rules Dialog */}
        <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
          <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Scheduling Rules</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                {categories.map(cat => (
                  <div key={cat.id} className="grid grid-cols-12 gap-4 items-center p-3 border rounded-md">
                    <div className="col-span-3 font-medium flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                      {cat.name}
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Min Separation (min)</Label>
                      <Input 
                        type="number" 
                        className="h-8" 
                        value={rules[cat.id]?.min_separation || 0}
                        onChange={(e) => handleSaveRule(cat.id, { min_separation: parseInt(e.target.value) })}
                      />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Selection Mode</Label>
                      <Select 
                        value={rules[cat.id]?.selection_mode || 'random'}
                        onValueChange={(val) => handleSaveRule(cat.id, { selection_mode: val })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="random">Random</SelectItem>
                          <SelectItem value="oldest">Oldest</SelectItem>
                          <SelectItem value="least_played">Least Played</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3 text-xs text-muted-foreground">
                      {cat.parent_id ? "Subcategory rules override parent" : "Applies to all subcategories unless overridden"}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Preview Dialog */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Schedule Preview</DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-4 mb-4">
              <Select 
                value={selectedClockId ? String(selectedClockId) : ""} 
                onValueChange={(val) => setSelectedClockId(Number(val))}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Clock" />
                </SelectTrigger>
                <SelectContent>
                  {clocks.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={generatePreview} disabled={previewLoading}>
                {previewLoading ? "Generating..." : "Regenerate"}
              </Button>
            </div>
            <ScrollArea className="flex-1 border rounded-md bg-muted/10 p-4">
              {previewLog.length > 0 ? (
                <div className="space-y-1 font-mono text-sm">
                  {previewLog.map((entry, i) => (
                    <div
                      key={i}
                      className={`flex gap-4 border-b border-border/50 pb-1 ${
                        entry.slot_type === 'track' ? 'bg-purple-950/20 rounded px-1' : ''
                      }`}
                    >
                      <div className="w-16 text-muted-foreground flex-shrink-0">
                        +{formatDuration(entry.time_offset)}
                      </div>
                      <div className="flex-1 min-w-0">
                        {entry.track ? (
                          <>
                            {entry.slot_type === 'track' && (
                              <span className="text-purple-400 mr-1" title="Pinned track">📌</span>
                            )}
                            <span className={`font-bold ${
                              entry.slot_type === 'track' ? 'text-purple-200' : 'text-primary'
                            }`}>{entry.track.title}</span>
                            <span className="text-muted-foreground"> — {entry.track.artist}</span>
                            <span className="text-xs text-muted-foreground ml-2">({formatDuration(entry.track.duration)})</span>
                          </>
                        ) : (
                          <span className="text-destructive italic">{entry.message}</span>
                        )}
                      </div>
                      <div className="w-28 text-right text-xs text-muted-foreground flex-shrink-0">
                        {entry.track?.category}
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 text-xs text-muted-foreground text-right">
                    Total runtime: {formatDuration(previewLog.reduce((sum: number, e: any) => sum + (e.track?.duration || 0), 0))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-10">
                  {previewLoading ? 'Generating preview...' : 'Select a clock and click Regenerate'}
                </div>
              )}
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
