import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  Copy, 
  Trash2, 
  Clock, 
  Calendar,
  Play,
  Pause
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

interface ClockSlot {
  id: string;
  time: string;
  duration: number;
  category?: string;
  mood?: string;
  description?: string;
}

interface Clock {
  id: string;
  name: string;
  description?: string;
  duration: number;
  slots: ClockSlot[];
  isActive: boolean;
}

export default function Scheduler() {
  const [clocks, setClocks] = useState<Clock[]>([
    {
      id: "1",
      name: "Morning Drive",
      description: "6 AM - 10 AM weekday format",
      duration: 240,
      isActive: true,
      slots: [
        { id: "s1", time: "06:00", duration: 30, category: "news", description: "Morning News" },
        { id: "s2", time: "06:30", duration: 90, category: "rock", description: "Rock Classics" },
        { id: "s3", time: "08:00", duration: 60, category: "pop", description: "Pop Hits" },
        { id: "s4", time: "09:00", duration: 60, category: "mixed", description: "Mixed Rotation" },
      ],
    },
    {
      id: "2",
      name: "Afternoon Mix",
      description: "10 AM - 4 PM weekday format",
      duration: 360,
      isActive: true,
      slots: [
        { id: "s5", time: "10:00", duration: 120, category: "pop", description: "Pop Hour" },
        { id: "s6", time: "12:00", duration: 60, category: "news", description: "Noon News" },
        { id: "s7", time: "13:00", duration: 180, category: "mixed", description: "Afternoon Mix" },
      ],
    },
  ]);

  const [selectedClock, setSelectedClock] = useState<Clock | null>(clocks[0]);
  const [editingSlot, setEditingSlot] = useState<ClockSlot | null>(null);

  const formatTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const duplicateClock = (clock: Clock) => {
    const newClock: Clock = {
      ...clock,
      id: `clock_${Date.now()}`,
      name: `${clock.name} (Copy)`,
      slots: clock.slots.map(slot => ({ ...slot, id: `slot_${Date.now()}_${Math.random()}` })),
    };
    setClocks([...clocks, newClock]);
  };

  const deleteClock = (id: string) => {
    setClocks(clocks.filter(c => c.id !== id));
    if (selectedClock?.id === id) {
      setSelectedClock(clocks[0] || null);
    }
  };

  const toggleClockActive = (id: string) => {
    setClocks(clocks.map(c => 
      c.id === id ? { ...c, isActive: !c.isActive } : c
    ));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Scheduler</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{clocks.length} clocks configured</p>
          </div>
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            NEW CLOCK
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Clocks List */}
          <div className="space-y-3">
            <h2 className="text-sm font-display font-bold text-foreground uppercase tracking-wider">Available Clocks</h2>
            {clocks.map((clock) => (
              <Card 
                key={clock.id}
                className={`glass-panel cursor-pointer transition-all ${
                  selectedClock?.id === clock.id 
                    ? "border-primary/50 bg-primary/10" 
                    : "hover:border-primary/30"
                }`}
                onClick={() => setSelectedClock(clock)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">{clock.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{clock.description}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleClockActive(clock.id);
                        }}
                      >
                        {clock.isActive ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                    <span>{clock.slots.length} slots</span>
                    <span>{formatTime(clock.duration)}</span>
                  </div>
                  
                  <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/50">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-muted-foreground hover:text-primary flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateClock(clock);
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-6 w-6 text-muted-foreground hover:text-destructive flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteClock(clock.id);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Clock Details */}
          <div className="lg:col-span-2">
            {selectedClock ? (
              <Card className="glass-panel">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="font-display tracking-wider flex items-center">
                      <Clock className="h-5 w-5 mr-2 text-primary" />
                      {selectedClock.name}
                    </CardTitle>
                    <span className={`px-2 py-1 rounded text-xs font-mono ${
                      selectedClock.isActive 
                        ? "bg-green-500/10 text-green-500 border border-green-500/20" 
                        : "bg-muted text-muted-foreground border border-border"
                    }`}>
                      {selectedClock.isActive ? "ACTIVE" : "INACTIVE"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Clock Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-mono text-muted-foreground uppercase">Total Duration</label>
                      <p className="text-lg font-bold text-foreground mt-1">{formatTime(selectedClock.duration)}</p>
                    </div>
                    <div>
                      <label className="text-xs font-mono text-muted-foreground uppercase">Slots</label>
                      <p className="text-lg font-bold text-foreground mt-1">{selectedClock.slots.length}</p>
                    </div>
                  </div>

                  {/* Slots Timeline */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-display font-bold text-foreground uppercase">Clock Slots</h3>
                    <div className="space-y-2">
                      {selectedClock.slots.map((slot, index) => (
                        <div 
                          key={slot.id}
                          className="flex items-center gap-3 p-3 rounded bg-secondary/50 border border-border/50 hover:border-primary/30 transition-colors group cursor-pointer"
                          onClick={() => setEditingSlot(slot)}
                        >
                          <div className="h-8 w-8 rounded bg-primary/20 flex items-center justify-center text-primary font-mono text-xs font-bold">
                            {index + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-foreground">{slot.time}</span>
                              <span className="text-xs text-muted-foreground">({formatTime(slot.duration)})</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">{slot.description || "No description"}</p>
                          </div>
                          {slot.category && (
                            <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono border border-primary/20">
                              {slot.category}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Add Slot Button */}
                  <Button className="w-full bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30">
                    <Plus className="h-4 w-4 mr-2" />
                    ADD SLOT
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-panel flex items-center justify-center h-96">
                <div className="text-center">
                  <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <p className="text-muted-foreground">Select a clock to view details</p>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Schedule Preview */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display tracking-wider">Weekly Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-2">
              {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => (
                <div key={day} className="text-center">
                  <div className="text-xs font-mono font-bold text-muted-foreground mb-2">{day}</div>
                  <div className="space-y-1">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-8 rounded bg-primary/20 border border-primary/30 text-xs flex items-center justify-center text-primary font-mono">
                        {i}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
