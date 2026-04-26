import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Users,
  Music,
  Clock,
  Play,
  RefreshCw,
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { tracksApi } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function Home() {
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [stats, setStats] = useState({
    activeTracks: 0,
    totalTracks: 0,
    listeners: 1248,
    uptime: "14d 02h",
  });
  const [nowPlaying, setNowPlaying] = useState<{
    current: { title: string; artist: string } | null;
    recent: { title: string; artist: string }[];
  }>({ current: null, recent: [] });

  useEffect(() => {
    const loadStats = async () => {
      try {
        const data = await tracksApi.getStats();
        setStats(prev => ({
          ...prev,
          activeTracks: data.active,
          totalTracks: data.total,
        }));
      } catch (error) {
        console.error("Failed to load stats");
      }
    };
    loadStats();
  }, []);

  useEffect(() => {
    const fetchNowPlaying = async () => {
      try {
        const res = await fetch(`${API_URL}/api/stream/now`);
        const data = await res.json();
        setNowPlaying({ current: data.current || null, recent: data.recent || [] });
      } catch {
        // silent
      }
    };
    fetchNowPlaying();
    const interval = setInterval(fetchNowPlaying, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-1">Mission Control</h1>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-display font-bold text-foreground">System Overview</h2>
              <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500 text-xs font-mono border border-green-500/20 animate-pulse">
                OPERATIONAL
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              className="border-primary/20 hover:border-primary hover:bg-primary/10"
              onClick={async () => {
                try {
                  setIsSyncing(true);
                  toast({ title: "Sync Started", description: "Indexing Dropbox files..." });
                  const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/sync`, { method: 'POST' });
                  const data = await res.json();
                  if (data.success) {
                    toast({ title: "Sync Complete", description: `Indexed ${data.count} new files.` });
                    // Refresh stats
                    const statsData = await tracksApi.getStats();
                    setStats(prev => ({ ...prev, activeTracks: statsData.active, totalTracks: statsData.total }));
                  } else {
                    throw new Error(data.error || "Sync failed");
                  }
                } catch (e) {
                  toast({ title: "Sync Failed", description: String(e), variant: "destructive" });
                } finally {
                  setIsSyncing(false);
                }
              }}
              disabled={isSyncing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'SYNCING...' : 'SYNC DROPBOX'}
            </Button>
            <Button 
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(var(--primary),0.5)]"
              onClick={() => {
                toast({ title: "Stream Active", description: "The stream is already running. Listen at https://streamofdan.com" });
              }}
            >
              <Play className="h-4 w-4 mr-2" />
              START STREAM
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="glass-panel border-l-4 border-l-primary">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-muted-foreground uppercase">Current Listeners</span>
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="text-3xl font-display font-bold text-foreground">{stats.listeners.toLocaleString()}</div>
              <div className="text-xs text-green-500 mt-1 font-mono">+12% from last hour</div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-l-4 border-l-blue-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-muted-foreground uppercase">Active Tracks</span>
                <Music className="h-4 w-4 text-blue-500" />
              </div>
              <div className="text-3xl font-display font-bold text-foreground">{stats.activeTracks.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{stats.totalTracks.toLocaleString()} in Cold Storage</div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-l-4 border-l-orange-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-muted-foreground uppercase">Uptime</span>
                <Clock className="h-4 w-4 text-orange-500" />
              </div>
              <div className="text-3xl font-display font-bold text-foreground">{stats.uptime}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">Since last reboot</div>
            </CardContent>
          </Card>

          <Card className="glass-panel border-l-4 border-l-green-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono text-muted-foreground uppercase">Server Load</span>
                <Activity className="h-4 w-4 text-green-500" />
              </div>
              <div className="text-3xl font-display font-bold text-foreground">12%</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">CPU Usage</div>
            </CardContent>
          </Card>
        </div>

        {/* Now Playing & Up Next */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Now Playing */}
          <Card className="glass-panel lg:col-span-2 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-50" />
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-mono font-bold text-foreground uppercase tracking-wider">On Air</span>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="flex flex-col md:flex-row gap-6 items-center">
                <div className="h-48 w-48 rounded-lg bg-black/50 border border-border flex items-center justify-center shadow-2xl">
                  <Music className="h-16 w-16 text-primary/50" />
                </div>
                <div className="flex-1 text-center md:text-left space-y-2">
                  <h3 className="text-4xl font-display font-bold text-foreground">
                    {nowPlaying.current?.title ?? "—"}
                  </h3>
                  <p className="text-xl text-primary font-medium">
                    {nowPlaying.current?.artist ?? ""}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recently Played */}
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="font-display tracking-wider text-sm uppercase">Recently Played</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {nowPlaying.recent.length === 0 ? (
                  <p className="text-xs text-muted-foreground font-mono">No history yet</p>
                ) : nowPlaying.recent.map((track, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded hover:bg-white/5 transition-colors group">
                    <div className="h-8 w-8 rounded bg-secondary/50 flex items-center justify-center text-xs font-mono text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-foreground truncate">{track.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{track.artist}</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
