import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tracksApi, categoriesApi, Track, Category } from "@/lib/api";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EditTrackDialogProps {
  track: Track | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function EditTrackDialog({ track, open, onOpenChange, onSuccess }: EditTrackDialogProps) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [categoryId, setCategoryId] = useState<string>("0");
  const [subcategoryId, setSubcategoryId] = useState<string>("0");
  const [cueOut, setCueOut] = useState<string>("");
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch categories on mount
  useEffect(() => {
    categoriesApi.getAll().then(setCategories).catch(console.error);
  }, []);

  // Update state when track changes
  useEffect(() => {
    if (track) {
      setTitle(track.title || "");
      setArtist(track.artist || "");
      setAlbum(track.album || "");
      setCategoryId(track.category_id ? String(track.category_id) : "0");
      setSubcategoryId(track.subcategory_id ? String(track.subcategory_id) : "0");
      setCueOut(track.cue_out !== undefined ? String(track.cue_out) : "");
    }
  }, [track]);

  // Derived lists
  const mainCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subCategories = useMemo(() => {
    if (categoryId === "0") return [];
    return categories.filter(c => c.parent_id === Number(categoryId));
  }, [categories, categoryId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!track) return;

    setLoading(true);
    try {
      await tracksApi.update(track.id, { 
        title, 
        artist, 
        album,
        category_id: Number(categoryId) || undefined,
        subcategory_id: Number(subcategoryId) || undefined,
        cue_out: cueOut ? parseFloat(cueOut) : undefined
      });
      toast.success("Track updated successfully");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error("Failed to update track");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Track Metadata</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="artist">Artist</Label>
            <Input id="artist" value={artist} onChange={(e) => setArtist(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="album">Album</Label>
            <Input id="album" value={album} onChange={(e) => setAlbum(e.target.value)} />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={(val) => {
                setCategoryId(val);
                setSubcategoryId("0"); // Reset subcategory
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">None</SelectItem>
                  {mainCategories.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subcategory</Label>
              <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={subCategories.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Subcategory" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">None</SelectItem>
                  {subCategories.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cueOut">Segue Point (Cue Out)</Label>
            <div className="flex items-center gap-2">
              <Input 
                id="cueOut" 
                type="number" 
                step="0.1" 
                value={cueOut} 
                onChange={(e) => setCueOut(e.target.value)} 
                placeholder="Auto-calculated if empty"
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">seconds</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Default: 3.0s for Music, 0.5s for others (before end).
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
