import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, RefreshCw, History, Pause, Play } from "lucide-react";

interface HistoryEntry {
  id: number;
  track_id: number;
  title: string;
  artist: string;
  category_id: number;
  category_name: string;
  played_at: string;
}

export default function PlayHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const limit = 50;

  const fetchHistory = async () => {
    try {
      const offset = (page - 1) * limit;
      const response = await fetch(`/api/stream/history?limit=${limit}&offset=${offset}`);
      const data = await response.json();
      setHistory(data.history || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error("Failed to fetch history:", error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHistory();
  }, [page]);

  // Auto-refresh every 10 seconds when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (page === 1) fetchHistory();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, page]);

  const handleExport = () => {
    window.open("/api/stream/history/export", "_blank");
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr + "Z");
    return date.toLocaleString();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">Play History</h1>
          </div>
          <div className="flex gap-2">
            <Button 
              variant={autoRefresh ? "default" : "outline"} 
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? "Auto-refresh ON (every 10s)" : "Auto-refresh OFF"}
            >
              {autoRefresh ? <Pause className="h-4 w-4 mr-2" /> : <Play className="h-4 w-4 mr-2" />}
              {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
            </Button>
            <Button variant="outline" onClick={fetchHistory} disabled={loading}>
              <RefreshCw className={"h-4 w-4 mr-2 " + (loading ? "animate-spin" : "")} />
              Refresh
            </Button>
            <Button onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Plays ({total} total) {autoRefresh && <span className="text-sm font-normal text-muted-foreground ml-2">(auto-refreshing)</span>}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No play history yet</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Played At</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Artist</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">{formatDate(entry.played_at)}</TableCell>
                        <TableCell>{entry.title || "Unknown"}</TableCell>
                        <TableCell>{entry.artist || "Unknown Artist"}</TableCell>
                        <TableCell>{entry.category_name || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
