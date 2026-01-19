import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Search, 
  Plus, 
  Edit2, 
  Trash2, 
  Tag, 
  Music, 
  Clock,
  Filter,
  Download,
  Upload
} from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  category?: string;
  mood?: string;
  tags?: string[];
  format?: string;
}

export default function Library() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set());

  // Mock data - replace with API calls
  const mockTracks: Track[] = [
    { id: "1", title: "Bohemian Rhapsody", artist: "Queen", album: "A Night at the Opera", duration: 355, category: "rock", format: "mp3" },
    { id: "2", title: "Enter Sandman", artist: "Metallica", album: "The Black Album", duration: 327, category: "metal", format: "mp3" },
    { id: "3", title: "Stairway to Heaven", artist: "Led Zeppelin", album: "Led Zeppelin IV", duration: 482, category: "rock", format: "flac" },
    { id: "4", title: "Smells Like Teen Spirit", artist: "Nirvana", album: "Nevermind", duration: 301, category: "grunge", format: "mp3" },
    { id: "5", title: "Sweet Child O' Mine", artist: "Guns N' Roses", album: "Appetite for Destruction", duration: 356, category: "rock", format: "mp3" },
  ];

  useEffect(() => {
    // Simulate loading tracks
    setLoading(true);
    setTimeout(() => {
      setTracks(mockTracks);
      setLoading(false);
    }, 500);
  }, []);

  const filteredTracks = tracks.filter(track => {
    const matchesSearch = search === "" || 
      track.title.toLowerCase().includes(search.toLowerCase()) ||
      track.artist.toLowerCase().includes(search.toLowerCase());
    
    const matchesCategory = category === "all" || track.category === category;
    
    return matchesSearch && matchesCategory;
  });

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
            <p className="text-muted-foreground mt-1 font-mono text-sm">{filteredTracks.length} tracks • {tracks.length} total</p>
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
                        checked={selectedTracks.size === filteredTracks.length && filteredTracks.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTracks(new Set(filteredTracks.map(t => t.id)));
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
                  ) : filteredTracks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No tracks found
                      </td>
                    </tr>
                  ) : (
                    filteredTracks.map((track) => (
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
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
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
