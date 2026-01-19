import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tracksApi, Track } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Tag, 
  Music, 
  Filter,
  Download,
  Upload
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

export default function Library() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());
  const [totalTracks, setTotalTracks] = useState(0);

  const fetchTracks = async () => {
    try {
      setLoading(true);
      // Use simple params first to ensure it works
      const response = await tracksApi.getAll({
        limit: 50,
        // Only add search/category if they have values
        ...(search ? { search } : {}),
        ...(category !== "all" ? { category } : {})
      });
      
      if (response && Array.isArray(response.data)) {
        setTracks(response.data);
        setTotalTracks(response.pagination?.total || 0);
      } else {
        setTracks([]);
        setTotalTracks(0);
      }
    } catch (error) {
      console.error("Failed to fetch tracks:", error);
      toast.error("Failed to load tracks");
      setTracks([]);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    fetchTracks();
  }, []);

  // Debounced search/filter
  useEffect(() => {
    // Skip initial render as the first useEffect handles it
    if (search === "" && category === "all" && tracks.length === 0 && !loading) return;

    const debounce = setTimeout(() => {
      fetchTracks();
    }, 500);
    return () => clearTimeout(debounce);
  }, [search, category]);

  const handleDelete = async (id: string) => {
    try {
      await tracksApi.delete(id);
      toast.success("Track deleted");
      fetchTracks();
    } catch (error) {
      toast.error("Failed to delete track");
    }
  };

  const handleDownload = async (id: string) => {
    try {
      toast.info("Starting download...");
      await tracksApi.download(id);
      toast.success("Track downloaded");
      fetchTracks();
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

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "--:--";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Track Library</h1>
            <p className="text-muted-foreground mt-1 font-mono text-sm">{totalTracks} tracks total</p>
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

        {/* Search and Filters */}
        <Card className="glass-panel">
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
                  className="px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm font-mono focus:outline-none focus:border-primary"
                >
                  <option value="all">All Categories</option>
                  <option value="rock">Rock</option>
                  <option value="metal">Metal</option>
                  <option value="grunge">Grunge</option>
                  <option value="pop">Pop</option>
                  <option value="jazz">Jazz</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Actions */}
        {selectedTracks.size > 0 && (
          <Card className="glass-panel border-l-4 border-l-primary bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-muted-foreground">
                  {selectedTracks.size} track{selectedTracks.size !== 1 ? "s" : ""} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="border-primary/20 hover:border-primary text-primary">
                    <Tag className="h-3 w-3 mr-1" />
                    TAG
                  </Button>
                  <Button variant="outline" size="sm" className="border-primary/20 hover:border-primary text-primary">
                    <Download className="h-3 w-3 mr-1" />
                    EXPORT
                  </Button>
                  <Button variant="outline" size="sm" className="border-destructive/20 hover:border-destructive text-destructive">
                    <Trash2 className="h-3 w-3 mr-1" />
                    DELETE
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tracks Table */}
        <Card className="glass-panel">
          <CardHeader>
            <CardTitle className="font-display tracking-wider">ACTIVE TRACKS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground font-mono text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 text-left">
                        <input 
                          type="checkbox" 
                          checked={selectedTracks.size === tracks.length && tracks.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTracks(new Set(tracks.map(t => t.id)));
                            } else {
                              setSelectedTracks(new Set());
                            }
                          }}
                          className="w-4 h-4 rounded border-border bg-input cursor-pointer"
                        />
                    </th>
                    <th className="px-4 py-3 text-left">Title</th>
                    <th className="px-4 py-3 text-left">Artist</th>
                    <th className="px-4 py-3 text-left">Album</th>
                    <th className="px-4 py-3 text-center">Duration</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <Music className="h-4 w-4 animate-pulse" />
                          Loading tracks...
                        </div>
                      </td>
                    </tr>
                  ) : tracks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No tracks found
                      </td>
                    </tr>
                  ) : (
                    tracks.map((track) => (
                      <tr 
                        key={track.id} 
                        className="border-b border-border/50 hover:bg-white/5 transition-colors group"
                      >
                        <td className="px-4 py-3">
                          <input 
                            type="checkbox" 
                            checked={selectedTracks.has(track.id)}
                            onChange={() => toggleTrackSelection(track.id)}
                            className="w-4 h-4 rounded border-border bg-input cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Music className="h-3 w-3 text-muted-foreground" />
                            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                              {track.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{track.artist}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{track.album || "--"}</td>
                        <td className="px-4 py-3 text-center font-mono text-xs text-muted-foreground">
                          {formatDuration(track.duration)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-mono border border-primary/20">
                            {track.category || "uncategorized"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {track.isDownloaded ? (
                            <span className="text-green-500 text-xs font-mono">READY</span>
                          ) : (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="h-6 text-xs text-blue-400 hover:text-blue-300"
                              onClick={() => handleDownload(track.id)}
                            >
                              <Download className="h-3 w-3 mr-1" />
                              GET
                            </Button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDelete(track.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
