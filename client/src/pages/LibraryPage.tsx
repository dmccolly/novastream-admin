import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tracksApi, categoriesApi, Track, Category } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Music, 
  Filter,
  Download,
  Upload,
  Check,
  Cloud,
  Play,
  Pause,
  Loader2,
  Square,
  Volume2,
  Sliders
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { Virtuoso } from "react-virtuoso";
import { Badge } from "@/components/ui/badge";
import { EditTrackDialog } from "@/components/EditTrackDialog";
import CuePointEditor from "@/components/CuePointEditor";

export default function Library() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
    const [editingTrack, setEditingTrack] = useState<Track | null>(null);
    const [cueEditingTrack, setCueEditingTrack] = useState<Track | null>(null);
    const [showCueEditor, setShowCueEditor] = useState(false);
    const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null);
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  
  const isFirstRun = useRef(true);

  // Fetch categories on mount
  useEffect(() => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  }, []);

  // Debounce search input
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset page on search change
      setTracks([]); // Clear tracks on search change
      setHasMore(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reset on category change
  useEffect(() => {
    if (isFirstRun.current) return; 
    
    setPage(1);
    setTracks([]);
    setHasMore(true);
  }, [category]);

  // Reset on status change
  useEffect(() => {
    if (isFirstRun.current) return;
    
    setPage(1);
    setTracks([]);
    setHasMore(true);
  }, [status]);

  // Fetch tracks
  const loadTracks = useCallback(async (pageNum: number, isNewSearch: boolean) => {
    if (loading) return;
    
    try {
      setLoading(true);
      const response = await tracksApi.getAll({ 
        page: pageNum, 
        limit: 50, 
        search: debouncedSearch,
        status, 
        category 
      });
      
      if (response && response.data) {
        setTracks(prev => {
          if (isNewSearch) return response.data;
          
          // Create a map of new tracks for O(1) lookup
          const newTracksMap = new Map(response.data.map(t => [t.id, t]));
          
          // Update existing tracks if they are in the new batch
          const updatedPrev = prev.map(t => newTracksMap.has(t.id) ? newTracksMap.get(t.id)! : t);
          
          // Find tracks that are in the new batch but not in prev (truly new items from pagination)
          const existingIds = new Set(prev.map(t => t.id));
          const trulyNewTracks = response.data.filter(t => !existingIds.has(t.id));
          
          return [...updatedPrev, ...trulyNewTracks];
        });
        setTotal(response.pagination.total);
        const currentCount = isNewSearch ? response.data.length : tracks.length + response.data.length;
        setHasMore(currentCount < response.pagination.total);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Failed to fetch tracks:", error);
      toast.error("Failed to load tracks");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, category, status]);

  // Initial load and subsequent pages
  useEffect(() => {
    loadTracks(page, page === 1);
  }, [page, loadTracks]);

  // Polling for status updates
  useEffect(() => {
    // Only poll if there are tracks downloading
    const hasDownloading = tracks.some(t => t.status === 'downloading');
    if (!hasDownloading) return;

    const interval = setInterval(() => {
      // Silent reload (pass false to avoid clearing tracks)
      loadTracks(page, false);
    }, 3000);

    return () => clearInterval(interval);
  }, [tracks, page, loadTracks]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setPage(prev => prev + 1);
    }
  }, [loading, hasMore]);

  const handleDelete = async (id: string) => {
    try {
      await tracksApi.delete(id);
      toast.success("Track deleted");
      // Fix: Convert t.id to string for comparison
      setTracks(prev => prev.filter(t => String(t.id) !== id));
    } catch (error) {
      toast.error("Failed to delete track");
    }
  };

  const handleDownload = async (id: string) => {
    try {
      toast.info("Starting download...");
      await tracksApi.download(id);
      toast.success("Track downloaded");
      // Fix: Convert t.id to string for comparison
      setTracks(prev => prev.map(t => String(t.id) === id ? { ...t, status: 'downloading' } : t));
    } catch (error) {
      toast.error("Failed to download track");
    }
  };

  const toggleTrackSelection = (id: string) => {
    const newSelected = new Set(selectedTracks);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTracks(newSelected);
  };

  const handlePlay = async (track: Track) => {
    const trackId = String(track.id);
    if (playingTrackId === trackId) {
      audioRef.current?.pause();
      setPlayingTrackId(null);
      setPlayingTrack(null);
    } else {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      let url: string | undefined;
      
      // If track is on server, use streaming endpoint
      if (track.filepath) {
        url = `/api/tracks/${trackId}/stream`;
      } else {
        // Otherwise, fetch preview URL from Dropbox
        try {
          setLoadingPreviewId(trackId);
          url = await tracksApi.getPreviewUrl(trackId);
        } catch (error) {
          toast.error("Failed to get preview URL");
          setLoadingPreviewId(null);
          return;
        } finally {
          setLoadingPreviewId(null);
        }
      }

      if (url) {
        const audio = new Audio(url);
        audio.onended = () => {
          setPlayingTrackId(null);
          setPlayingTrack(null);
        };
        audio.play().catch(e => toast.error("Failed to play audio: " + e.message));
        audioRef.current = audio;
        setPlayingTrackId(trackId);
        setPlayingTrack(track);
      }
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlayingTrackId(null);
    setPlayingTrack(null);
  };

    const formatDuration = (seconds?: number) => {
      if (!seconds) return "--:--";
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const handleEditCuePoints = (track: Track) => {
      setCueEditingTrack(track);
      setShowCueEditor(true);
    };

    const handleSaveCuePoints = async (cuePoints: { 
      cueIn: number; 
      cueOut: number; 
      segueDuration: number 
    }) => {
      if (!cueEditingTrack) return;
    
      try {
        await tracksApi.updateCuePoints(String(cueEditingTrack.id), cuePoints);
        toast.success("Cue points saved successfully");
        loadTracks(page, false);
      } catch (error) {
        toast.error("Failed to save cue points");
      }
    };

    const Row = (index: number) => {
    try {
      const track = tracks[index];
      if (!track) return null;

      const trackId = track.id ? String(track.id) : "";
      if (!trackId) return null;

      return (
        <div className="flex items-center border-b border-border/50 hover:bg-white/5 transition-colors group px-4 py-2 h-[50px]">
          <div className="w-10 flex-shrink-0">
            <input 
              type="checkbox" 
              checked={selectedTracks.has(trackId)}
              onChange={() => toggleTrackSelection(trackId)}
              className="w-4 h-4 rounded border-border bg-input cursor-pointer"
            />
          </div>
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <Music className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <span className="font-medium text-foreground truncate block">
                  {track.title || "Unknown Title"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground md:hidden truncate mt-0.5 pl-5">
                {track.artist || "Unknown Artist"}
              </div>
            </div>
          </div>
          <div className="w-1/4 min-w-0 pr-4 text-muted-foreground truncate hidden md:block">{track.artist || "Unknown Artist"}</div>
          
          <div className="w-20 text-center font-mono text-xs text-muted-foreground hidden sm:block">
            {formatDuration(track.duration)}
          </div>
          <div className="w-32 px-2 hidden xl:block">
            <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono border border-primary/20 truncate block text-center">
              {track.subcategory_name || track.category_name || track.category || "uncategorized"}
            </span>
          </div>
          <div className="w-24 text-center">
            {track.filepath ? (
               <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                 <Check className="w-3 h-3 mr-1" /> On Server
               </Badge>
            ) : (
               <Badge variant="outline" className="text-muted-foreground">
                 <Cloud className="w-3 h-3 mr-1" /> Cloud
               </Badge>
            )}
          </div>
          <div className="w-48 text-right">
            <div className="flex items-center justify-end gap-1 ">
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${playingTrackId === trackId ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
                onClick={() => handlePlay(track)}
                disabled={loadingPreviewId === trackId}
                title={track.url ? "Play Preview" : "Preview from Dropbox"}
              >
                {loadingPreviewId === trackId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : playingTrackId === trackId ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => setEditingTrack(track)}
                              title="Edit Track Info"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            {track.filepath && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-muted-foreground hover:text-yellow-400"
                                onClick={() => handleEditCuePoints(track)}
                                title="Edit Cue Points"
                              >
                                <Sliders className="h-3 w-3" />
                              </Button>
                            )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className={`h-8 w-8 text-muted-foreground hover:text-blue-400 ${track.status === 'downloading' ? 'animate-pulse text-blue-400' : ''}`}
                              onClick={() => handleDownload(trackId)}
                              disabled={track.status === 'downloading'}
                              title={track.filepath ? "Re-download from Dropbox" : "Download from Dropbox"}
                            >
                {track.status === 'downloading' ? (
                  <Download className="h-3 w-3 animate-bounce" />
                ) : track.filepath ? (
                  <Download className="h-3 w-3 text-green-500" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(trackId)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      );
    } catch (e) {
      console.error("Row render error:", e);
      return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 h-[calc(100vh-2rem)] flex flex-col pb-16">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 flex-shrink-0">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Track Library</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{total} tracks found</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="border-primary/20 hover:border-primary hover:bg-primary/10">
              <Upload className="h-4 w-4 mr-2" />
              IMPORT
            </Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4 mr-2" />
              ADD TRACK
            </Button>
          </div>
        </div>

        <Card className="glass-panel flex-shrink-0">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tracks, artists, albums..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 bg-input border-border/50 focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm font-mono focus:outline-none focus:border-primary max-w-[200px]"
                >
                  <option value="all">All Categories</option>
                  {categories.map(c => (
                    <option key={c.id} value={String(c.id)}>
                      {c.parent_id ? `- ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm font-mono focus:outline-none focus:border-primary"
                >
                  <option value="all">All Status</option>
                  <option value="on_server">On Server</option>
                  <option value="cloud">Cloud Only</option>
                </select>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel flex-1 overflow-hidden flex flex-col">
          <CardHeader className="pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-medium">Tracks</CardTitle>
              <div className="text-xs text-muted-foreground font-mono">
                {selectedTracks.size} selected
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-hidden">
            <div className="flex items-center border-b border-border/50 bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">
              <div className="w-10"></div>
              <div className="flex-1">TITLE</div>
              <div className="w-1/4 hidden md:block">ARTIST</div>
              
              <div className="w-20 text-center hidden sm:block">TIME</div>
              <div className="w-32 hidden xl:block">CATEGORY</div>
              <div className="w-24 text-center">STATUS</div>
              <div className="w-48 text-right">ACTIONS</div>
            </div>
            
            {tracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                {loading ? (
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                ) : (
                  <>
                    <Music className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-lg font-medium">No tracks found</p>
                    <p className="text-sm opacity-70 mt-1">Try adjusting your search or filters</p>
                  </>
                )}
              </div>
            ) : (
              <Virtuoso
                style={{ height: '100%' }}
                totalCount={tracks.length}
                itemContent={Row}
                endReached={loadMore}
                overscan={200}
                className="scrollbar-thin"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Floating Mini Player */}
      {playingTrack && (
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border shadow-lg z-50">
          <div className="max-w-screen-xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 flex-shrink-0">
                  <Volume2 className="h-5 w-5 text-primary animate-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">
                    {playingTrack.title || "Unknown Title"}
                  </p>
                  <p className="text-sm text-muted-foreground truncate">
                    {playingTrack.artist || "Unknown Artist"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className="hidden sm:flex">
                  {playingTrack.filepath ? (
                    <><Check className="w-3 h-3 mr-1 text-green-500" /> Local</>
                  ) : (
                    <><Cloud className="w-3 h-3 mr-1" /> Dropbox</>
                  )}
                </Badge>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full border-primary/20 hover:border-primary hover:bg-primary/10"
                  onClick={() => handlePlay(playingTrack)}
                >
                  <Pause className="h-5 w-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 rounded-full border-destructive/20 hover:border-destructive hover:bg-destructive/10 text-destructive"
                  onClick={handleStop}
                >
                  <Square className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

          <EditTrackDialog 
            track={editingTrack} 
            open={!!editingTrack} 
            onOpenChange={(open) => !open && setEditingTrack(null)}
            onSuccess={() => loadTracks(page, false)}
          />

          {cueEditingTrack && (
            <CuePointEditor
              open={showCueEditor}
              onOpenChange={setShowCueEditor}
              trackId={String(cueEditingTrack.id)}
              trackTitle={cueEditingTrack.title || "Unknown Track"}
              audioUrl={cueEditingTrack.filepath ? `/api/tracks/${cueEditingTrack.id}/stream` : ""}
              initialCuePoints={{
                cueIn: cueEditingTrack.cue_in || 0,
                cueOut: cueEditingTrack.cue_out || cueEditingTrack.duration || 0,
                segueDuration: cueEditingTrack.segue_duration || (cueEditingTrack.category_name === 'Music' ? 3 : 0.5),
              }}
              onSave={handleSaveCuePoints}
            />
          )}
        </DashboardLayout>
  );
}
