import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { categoriesApi, clocksApi, tracksApi, Category } from "@/lib/api";
import { toast } from "sonner";
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent
} from "@dnd-kit/core";
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Trash2, GripVertical, Clock as ClockIcon, Save, Music, Tag, Pin, Search, Repeat, PlayCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// --- Types ---
interface Clock {
  id: number;
  name: string;
  color: string;
  mode: 'loop' | 'sequential';
}

interface ClockItem {
  id: string;           // unique temp id for dnd
  slot_type: 'category' | 'track';
  // category slot fields
  category_id?: number;
  category_name?: string;
  category_color?: string;
  // track slot fields
  track_id?: number;
  track_title?: string;
  track_artist?: string;
  track_duration?: number;
  duration_target?: number;
}

interface TrackResult {
  id: number;
  title: string;
  artist: string;
  duration?: number;
  category_id?: number;
}

// --- Helper ---
function formatDuration(seconds?: number): string {
  if (!seconds) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// --- SortableItem ---
function SortableItem({ id, item, onRemove }: { id: string; item: ClockItem; onRemove: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const isTrack = item.slot_type === 'track';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-2 mb-2 border rounded-md group ${
        isTrack
          ? "bg-purple-950/30 border-purple-500/30"
          : "bg-card border-border/50"
      }`}
    >
      <div {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground">
        <GripVertical className="h-4 w-4" />
      </div>

      {isTrack ? (
        <Pin className="h-3 w-3 text-purple-400 flex-shrink-0" />
      ) : (
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: item.category_color || "#ccc" }}
        />
      )}

      <div className="flex-1 min-w-0">
        {isTrack ? (
          <div>
            <div className="font-medium text-sm truncate text-purple-200">{item.track_title || "Unknown Track"}</div>
            <div className="text-xs text-muted-foreground truncate">{item.track_artist || ""} · {formatDuration(item.track_duration)}</div>
          </div>
        ) : (
          <div className="font-medium text-sm truncate">{item.category_name}</div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-60 hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0"
        onClick={() => onRemove(id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// --- Main Page ---
export default function ClocksPage() {
  const [clocks, setClocks] = useState<Clock[]>([]);
  const [selectedClockId, setSelectedClockId] = useState<number | null>(null);
  const [clockItems, setClockItems] = useState<ClockItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [newClockName, setNewClockName] = useState("");

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<'categories' | 'tracks'>('categories');

  // Track search
  const [trackSearch, setTrackSearch] = useState("");
  const [trackResults, setTrackResults] = useState<TrackResult[]>([]);
  const [trackSearchLoading, setTrackSearchLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Fetch initial data
  useEffect(() => {
    Promise.all([categoriesApi.getAll(), clocksApi.getAll()])
      .then(([cats, clks]) => {
        setCategories(cats);
        setClocks(clks);
        if (clks.length > 0) setSelectedClockId(clks[0].id);
      })
      .catch(console.error);
  }, []);

  // Fetch clock items when selected
  useEffect(() => {
    if (!selectedClockId) return;
    setLoading(true);
    clocksApi.getById(selectedClockId)
      .then(data => {
        const items: ClockItem[] = data.items.map((item: any) => ({
          id: `item-${item.id}-${Date.now()}-${Math.random()}`,
          slot_type: item.slot_type || 'category',
          category_id: item.category_id,
          category_name: item.category_name,
          category_color: item.category_color,
          track_id: item.track_id,
          track_title: item.track_title,
          track_artist: item.track_artist,
          track_duration: item.track_duration,
          duration_target: item.duration_target,
        }));
        setClockItems(items);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedClockId]);

  // Track search with debounce
  const searchTracks = useCallback(async (query: string) => {
    if (!query.trim()) { setTrackResults([]); return; }
    setTrackSearchLoading(true);
    try {
      const data = await tracksApi.getAll({ search: query, limit: 30 });
      // Handle both array and paginated object response formats
      const tracks = Array.isArray(data) ? data : (data.data || data.tracks || []);
      setTrackResults(tracks);
    } catch {
      setTrackResults([]);
    } finally {
      setTrackSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchTracks(trackSearch), 300);
    return () => clearTimeout(timer);
  }, [trackSearch, searchTracks]);

  const handleCreateClock = async () => {
    if (!newClockName.trim()) return;
    try {
      const palette = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#16a085", "#e67e22", "#34495e"];
      const color = palette[clocks.length % palette.length];
      const newClock = await clocksApi.create({ name: newClockName, color, mode: 'loop' });
      setClocks([...clocks, newClock]);
      setSelectedClockId(newClock.id);
      setNewClockName("");
      toast.success("Clock created");
    } catch {
      toast.error("Failed to create clock");
    }
  };

  const handleToggleMode = async (clockId: number, currentMode: string) => {
    const newMode = currentMode === 'loop' ? 'sequential' : 'loop';
    try {
      await clocksApi.update(clockId, { mode: newMode });
      setClocks(prev => prev.map(c => c.id === clockId ? { ...c, mode: newMode as 'loop' | 'sequential' } : c));
      toast.success(newMode === 'sequential' ? 'Set to Play Once (Sequential)' : 'Set to Loop');
    } catch {
      toast.error('Failed to update clock mode');
    }
  };

  const handleDeleteClock = async (id: number) => {
    if (!confirm("Are you sure you want to delete this clock?")) return;
    try {
      await clocksApi.delete(id);
      setClocks(clocks.filter(c => c.id !== id));
      if (selectedClockId === id) { setSelectedClockId(null); setClockItems([]); }
      toast.success("Clock deleted");
    } catch {
      toast.error("Failed to delete clock");
    }
  };

  const handleSaveClock = async () => {
    if (!selectedClockId) return;
    try {
      const itemsToSave = clockItems.map(item => ({
        slot_type: item.slot_type,
        category_id: item.slot_type === 'category' ? item.category_id : undefined,
        track_id: item.slot_type === 'track' ? item.track_id : undefined,
        duration_target: item.duration_target,
      }));
      await clocksApi.updateItems(selectedClockId, itemsToSave);
      toast.success("Clock saved successfully");
    } catch {
      toast.error("Failed to save clock");
    }
  };

  const handleAddCategory = (category: Category) => {
    setClockItems(prev => [...prev, {
      id: `new-${Date.now()}-${Math.random()}`,
      slot_type: 'category',
      category_id: category.id,
      category_name: category.name,
      category_color: category.color,
    }]);
  };

  const handleAddTrack = (track: TrackResult) => {
    setClockItems(prev => [...prev, {
      id: `new-${Date.now()}-${Math.random()}`,
      slot_type: 'track',
      track_id: track.id,
      track_title: track.title,
      track_artist: track.artist,
      track_duration: track.duration,
    }]);
    toast.success(`Added: ${track.title}`);
  };

  const handleRemoveItem = (id: string) => {
    setClockItems(items => items.filter(i => i.id !== id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      setClockItems(items => {
        const oldIndex = items.findIndex(i => i.id === active.id);
        const newIndex = items.findIndex(i => i.id === over?.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Chart data — category slots only
  const chartData = useMemo(() => {
    const counts: Record<string, number> = {};
    const colors: Record<string, string> = {};
    clockItems.forEach(item => {
      if (item.slot_type === 'category' && item.category_name) {
        counts[item.category_name] = (counts[item.category_name] || 0) + 1;
        colors[item.category_name] = item.category_color || "#888";
      } else if (item.slot_type === 'track') {
        counts["Pinned Tracks"] = (counts["Pinned Tracks"] || 0) + 1;
        colors["Pinned Tracks"] = "#a855f7";
      }
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value, color: colors[name] }));
  }, [clockItems]);

  const pinnedCount = clockItems.filter(i => i.slot_type === 'track').length;

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-2rem)] flex flex-col gap-4">
        <div className="flex items-center justify-between flex-shrink-0">
          <h1 className="text-3xl font-display font-bold">Clock Builder</h1>
          <Button onClick={handleSaveClock} disabled={!selectedClockId || loading}>
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </Button>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-4 min-h-0">

          {/* Left: Categories / Tracks sidebar */}
          <Card className="col-span-2 glass-panel flex flex-col min-h-0">
            {/* Tab bar */}
            <div className="flex border-b border-border/50 flex-shrink-0">
              <button
                onClick={() => setSidebarTab('categories')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'categories'
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Tag className="h-3 w-3" />
                Categories
              </button>
              <button
                onClick={() => setSidebarTab('tracks')}
                className={`flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'tracks'
                    ? "text-purple-400 border-b-2 border-purple-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Music className="h-3 w-3" />
                Tracks
              </button>
            </div>

            <CardContent className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
              {sidebarTab === 'categories' ? (
                <ScrollArea className="h-full pr-1">
                  {categories.map(cat => (
                    <div
                      key={cat.id}
                      onClick={() => handleAddCategory(cat)}
                      className="flex items-center gap-2 p-2 mb-1 rounded-md hover:bg-accent cursor-pointer transition-colors border border-transparent hover:border-border/50"
                    >
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color || "#ccc" }} />
                      <span className="text-sm font-medium">{cat.name}</span>
                    </div>
                  ))}
                </ScrollArea>
              ) : (
                <>
                  <div className="relative flex-shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input
                      placeholder="Search tracks..."
                      value={trackSearch}
                      onChange={e => setTrackSearch(e.target.value)}
                      className="h-7 text-xs pl-7"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 pr-1">
                    {trackSearchLoading && (
                      <div className="text-xs text-muted-foreground text-center py-4">Searching...</div>
                    )}
                    {!trackSearchLoading && trackSearch && trackResults.length === 0 && (
                      <div className="text-xs text-muted-foreground text-center py-4">No tracks found</div>
                    )}
                    {!trackSearch && (
                      <div className="text-xs text-muted-foreground text-center py-4 px-1">
                        Search for a track to pin it to a specific clock position
                      </div>
                    )}
                    {trackResults.map(track => (
                      <div
                        key={track.id}
                        onClick={() => handleAddTrack(track)}
                        className="p-2 mb-1 rounded-md hover:bg-purple-950/40 cursor-pointer transition-colors border border-transparent hover:border-purple-500/30"
                      >
                        <div className="text-xs font-medium truncate text-purple-200">{track.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{track.artist} · {formatDuration(track.duration)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Center: Clock Editor */}
          <Card className="col-span-7 glass-panel flex flex-col min-h-0">
            <CardHeader className="pb-2 border-b border-border/50">
              <div className="flex items-center justify-between">
                <CardTitle>
                  {clocks.find(c => c.id === selectedClockId)?.name || "Select a Clock"}
                </CardTitle>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span>{clockItems.length} items</span>
                  {pinnedCount > 0 && (
                    <span className="flex items-center gap-1 text-purple-400">
                      <Pin className="h-3 w-3" />
                      {pinnedCount} pinned
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0 flex">
              {/* List View */}
              <div className="flex-1 p-4 overflow-y-auto">
                {selectedClockId ? (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={clockItems.map(i => i.id)} strategy={verticalListSortingStrategy}>
                      {clockItems.map(item => (
                        <SortableItem key={item.id} id={item.id} item={item} onRemove={handleRemoveItem} />
                      ))}
                    </SortableContext>
                    {clockItems.length === 0 && (
                      <div className="text-center text-muted-foreground py-10 border-2 border-dashed border-border/50 rounded-lg">
                        <p className="text-sm">Click categories or tracks on the left to add items</p>
                        <p className="text-xs mt-1 text-purple-400">Use the Tracks tab to pin specific files in order</p>
                      </div>
                    )}
                  </DndContext>
                ) : (
                  <div className="text-center text-muted-foreground py-10">
                    Select or create a clock to get started
                  </div>
                )}
              </div>

              {/* Visualizer */}
              <div className="w-1/3 border-l border-border/50 p-4 flex flex-col items-center justify-center bg-muted/10">
                <h3 className="text-sm font-medium mb-4">Distribution</h3>
                <div className="w-full aspect-square">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chartData} cx="50%" cy="50%" innerRadius={40} outerRadius={80} paddingAngle={2} dataKey="value">
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                        itemStyle={{ color: '#fff' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 w-full space-y-1">
                  {chartData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                        <span className="truncate max-w-[80px]">{d.name}</span>
                      </div>
                      <span className="font-mono">{clockItems.length > 0 ? Math.round(d.value / clockItems.length * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right: Clock List */}
          <Card className="col-span-3 glass-panel flex flex-col min-h-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">My Clocks</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-2 flex flex-col gap-2">
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="New Clock Name"
                  value={newClockName}
                  onChange={e => setNewClockName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateClock()}
                  className="h-8 text-xs"
                />
                <Button size="sm" className="h-8" onClick={handleCreateClock}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="space-y-1">
                  {clocks.map(clock => (
                    <div
                      key={clock.id}
                      className={`p-2 rounded-md cursor-pointer transition-colors ${
                        selectedClockId === clock.id
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "hover:bg-accent border border-transparent"
                      }`}
                      onClick={() => setSelectedClockId(clock.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <ClockIcon className="w-4 h-4 flex-shrink-0" />
                          <span className="text-sm font-medium truncate">{clock.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                          onClick={e => { e.stopPropagation(); handleDeleteClock(clock.id); }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 mt-1 ml-6">
                        <button
                          onClick={e => { e.stopPropagation(); handleToggleMode(clock.id, clock.mode || 'loop'); }}
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                            (clock.mode || 'loop') === 'sequential'
                              ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                              : 'bg-muted text-muted-foreground hover:bg-accent'
                          }`}
                          title={clock.mode === 'sequential' ? 'Play Once — click to switch to Loop' : 'Loop — click to switch to Play Once'}
                        >
                          {(clock.mode || 'loop') === 'sequential'
                            ? <><PlayCircle className="w-3 h-3" /> Play Once</>
                            : <><Repeat className="w-3 h-3" /> Loop</>
                          }
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

        </div>
      </div>
    </DashboardLayout>
  );
}
