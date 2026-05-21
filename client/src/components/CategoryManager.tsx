import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Check, X, AlertTriangle, Shuffle } from "lucide-react";
import { categoriesApi, Category } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange?: () => void; // called after any mutation so parent can refresh
}

export default function CategoryManager({ open, onOpenChange, onChange }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // Add form
  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState<string>("");
  const [newType, setNewType] = useState<string>("music");

  // Inline rename state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");

  // Delete-with-reassignment state
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<{
    trackCount: number;
    childCount: number;
    clockItemCount: number;
  } | null>(null);
  const [moveToId, setMoveToId] = useState<string>("");

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await categoriesApi.getAll();
      setCategories(list);
    } catch (e: any) {
      toast.error(e.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Name is required");
      return;
    }
    try {
      await categoriesApi.create({
        name,
        parent_id: newParentId ? Number(newParentId) : null,
        type: newParentId ? null : newType, // type inherits from parent if subcategory
      });
      toast.success(`Created "${name}"`);
      setNewName("");
      setNewParentId("");
      await refresh();
      onChange?.();
    } catch (e: any) {
      toast.error(e.message || "Create failed");
    }
  };

  const startRename = (c: Category) => {
    setEditingId(c.id);
    setEditingName(c.name);
  };

  const saveRename = async () => {
    if (editingId == null) return;
    const name = editingName.trim();
    if (!name) {
      toast.error("Name required");
      return;
    }
    try {
      await categoriesApi.update(editingId, { name });
      toast.success("Renamed");
      setEditingId(null);
      setEditingName("");
      await refresh();
      onChange?.();
    } catch (e: any) {
      toast.error(e.message || "Rename failed");
    }
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingName("");
  };

  const askDelete = async (c: Category) => {
    setDeleteTarget(c);
    setMoveToId("");
    setDeleteUsage(null);
    try {
      const usage = await categoriesApi.usage(c.id);
      setDeleteUsage({
        trackCount: usage.trackCount,
        childCount: usage.childCount,
        clockItemCount: usage.clockItemCount,
      });
    } catch (e: any) {
      toast.error(e.message || "Failed to check usage");
      setDeleteTarget(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const needsMoveTo =
      (deleteUsage?.trackCount || 0) > 0 ||
      (deleteUsage?.childCount || 0) > 0 ||
      (deleteUsage?.clockItemCount || 0) > 0;
    if (needsMoveTo && !moveToId) {
      toast.error("Pick a category to move tracks into");
      return;
    }
    try {
      await categoriesApi.delete(deleteTarget.id, moveToId || undefined);
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      setDeleteUsage(null);
      setMoveToId("");
      await refresh();
      onChange?.();
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    }
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setDeleteUsage(null);
    setMoveToId("");
  };

  const handleShuffle = async (c: Category) => {
    try {
      const result = await categoriesApi.shuffle(c.id);
      toast.success(`Shuffled "${c.name}" (${result.queued} tracks queued)`);
    } catch (e: any) {
      toast.error(e.message || "Shuffle failed");
    }
  };

  // Group: top-level, then children under each
  const topLevel = categories.filter((c) => !c.parent_id);
  const childrenOf = (parentId: number) =>
    categories.filter((c) => c.parent_id === parentId);

  const flatReassignOptions = categories.filter(
    (c) => !deleteTarget || c.id !== deleteTarget.id
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
        </DialogHeader>

        {/* Reassignment view takes over the body when deleting */}
        {deleteTarget ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium text-foreground">
                  Delete "{deleteTarget.name}"?
                </div>
                {deleteUsage ? (
                  <div className="text-muted-foreground mt-1">
                    {deleteUsage.trackCount} tracks
                    {deleteUsage.childCount > 0
                      ? `, ${deleteUsage.childCount} subcategories`
                      : ""}
                    {deleteUsage.clockItemCount > 0
                      ? `, ${deleteUsage.clockItemCount} clock slots`
                      : ""}{" "}
                    reference this category.
                  </div>
                ) : (
                  <div className="text-muted-foreground mt-1">
                    Checking usage...
                  </div>
                )}
              </div>
            </div>

            {deleteUsage &&
              (deleteUsage.trackCount > 0 ||
                deleteUsage.childCount > 0 ||
                deleteUsage.clockItemCount > 0) && (
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Move everything to:
                  </label>
                  <select
                    value={moveToId}
                    onChange={(e) => setMoveToId(e.target.value)}
                    className="mt-1 w-full px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm"
                  >
                    <option value="">-- Select a category --</option>
                    {flatReassignOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? `↳ ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

            <DialogFooter>
              <Button variant="outline" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            {/* Add new category */}
            <div className="space-y-2 rounded-md border border-border/50 bg-muted/20 p-3">
              <div className="text-xs font-medium text-muted-foreground uppercase">
                Add Category
              </div>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="New category name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  className="flex-1 min-w-[160px]"
                />
                <select
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                  className="px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm"
                >
                  <option value="">Top-level</option>
                  {topLevel.map((c) => (
                    <option key={c.id} value={c.id}>
                      Under: {c.name}
                    </option>
                  ))}
                </select>
                {!newParentId && (
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value)}
                    className="px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm"
                  >
                    <option value="music">music</option>
                    <option value="spot">spot</option>
                    <option value="voice">voice</option>
                    <option value="news">news</option>
                    <option value="other">other</option>
                  </select>
                )}
                <Button onClick={handleCreate}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto -mx-2 px-2">
              {loading ? (
                <div className="text-center text-muted-foreground py-6">
                  Loading...
                </div>
              ) : topLevel.length === 0 ? (
                <div className="text-center text-muted-foreground py-6">
                  No categories yet.
                </div>
              ) : (
                <div className="space-y-1">
                  {topLevel.map((parent) => {
                    const kids = childrenOf(parent.id);
                    return (
                      <div key={parent.id}>
                        <CategoryRow
                          category={parent}
                          editingId={editingId}
                          editingName={editingName}
                          setEditingName={setEditingName}
                          onStartRename={() => startRename(parent)}
                          onSaveRename={saveRename}
                          onCancelRename={cancelRename}
                          onDelete={() => askDelete(parent)}
                          onShuffle={() => handleShuffle(parent)}
                        />
                        {kids.length > 0 && (
                          <div className="ml-6 border-l border-border/50 pl-3 mt-1 mb-2 space-y-1">
                            {kids.map((child) => (
                              <CategoryRow
                                key={child.id}
                                category={child}
                                editingId={editingId}
                                editingName={editingName}
                                setEditingName={setEditingName}
                                onStartRename={() => startRename(child)}
                                onSaveRename={saveRename}
                                onCancelRename={cancelRename}
                                onDelete={() => askDelete(child)}
                                onShuffle={() => handleShuffle(child)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryRow({
  category,
  editingId,
  editingName,
  setEditingName,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
  onShuffle,
}: {
  category: Category;
  editingId: number | null;
  editingName: string;
  setEditingName: (v: string) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onDelete: () => void;
  onShuffle: () => void;
}) {
  const isEditing = editingId === category.id;
  return (
    <div className="flex items-center gap-2 rounded-sm hover:bg-white/5 px-2 py-1.5 group">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {isEditing ? (
          <Input
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSaveRename();
              if (e.key === "Escape") onCancelRename();
            }}
            autoFocus
            className="h-7 text-sm"
          />
        ) : (
          <>
            <span className="font-medium text-foreground truncate">
              {category.name}
            </span>
            {category.type && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 font-mono opacity-60"
              >
                {category.type}
              </Badge>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
        {isEditing ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onSaveRename}
              title="Save"
            >
              <Check className="h-3.5 w-3.5 text-green-500" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onCancelRename}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 gap-1.5 text-muted-foreground hover:text-amber-400"
              onClick={onShuffle}
              title="Shuffle this category (build a fresh rotation queue — every track plays once before any repeats)"
            >
              <Shuffle className="h-3.5 w-3.5" />
              <span className="text-xs font-mono">Shuffle</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary"
              onClick={onStartRename}
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
