import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  FolderTree,
  Tag as TagIcon,
  Trash2,
  AlertTriangle,
  X,
  Plus,
} from "lucide-react";
import { tracksApi, categoriesApi, tagsApi, Category } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: Set<string>;
  totalCount: number; // for "Apply to all filtered" mode
  currentFilter?: { search?: string; category?: string; status?: string };
  onComplete?: () => void;
}

type Mode = "setCategory" | "tag" | "delete";

// Common preset tags users reach for most often. They can also type their own.
const PRESET_TAGS = ["review", "needs-edit", "broken", "featured", "archive"];

export default function BatchEditDialog({
  open,
  onOpenChange,
  selectedIds,
  totalCount,
  currentFilter,
  onComplete,
}: Props) {
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Scope: apply to the user's current selection, or to all filtered results
  const [scope, setScope] = useState<"selected" | "all">(
    hasSelection ? "selected" : "all"
  );

  const [mode, setMode] = useState<Mode>("setCategory");

  // setCategory state
  const [categories, setCategories] = useState<Category[]>([]);
  const [targetCategoryId, setTargetCategoryId] = useState<string>("");

  // tag state
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tagAction, setTagAction] = useState<"add" | "remove" | "clear">("add");
  const [tagValue, setTagValue] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setScope(hasSelection ? "selected" : "all");
    setMode("setCategory");
    setTargetCategoryId("");
    setTagAction("add");
    setTagValue("");
    categoriesApi.getAll().then(setCategories).catch(() => {});
    tagsApi.getAll().then(setKnownTags).catch(() => setKnownTags([]));
  }, [open, hasSelection]);

  const effectiveCount =
    scope === "selected" ? selectedCount : totalCount;

  const submit = async () => {
    if (effectiveCount === 0) {
      toast.error("Nothing to update");
      return;
    }

    const ids =
      scope === "selected"
        ? Array.from(selectedIds).map((x) => Number(x))
        : ("all" as const);

    try {
      setSubmitting(true);

      if (mode === "setCategory") {
        if (!targetCategoryId) {
          toast.error("Pick a category");
          return;
        }
        const result = await tracksApi.batch(
          ids,
          "setCategory",
          Number(targetCategoryId),
          scope === "all" ? currentFilter : undefined
        );
        toast.success(`Updated ${result.updated} track(s)`);
      } else if (mode === "tag") {
        if (tagAction === "clear") {
          const result = await tracksApi.batch(
            ids,
            "clearTags",
            undefined,
            scope === "all" ? currentFilter : undefined
          );
          toast.success(`Cleared tags on ${result.updated} track(s)`);
        } else {
          const tag = tagValue.trim();
          if (!tag) {
            toast.error("Enter a tag");
            return;
          }
          const result = await tracksApi.batch(
            ids,
            tagAction === "add" ? "addTag" : "removeTag",
            tag,
            scope === "all" ? currentFilter : undefined
          );
          toast.success(
            `${tagAction === "add" ? "Added" : "Removed"} "${tag}" ${
              tagAction === "add" ? "on" : "from"
            } ${result.updated} track(s)`
          );
        }
      } else if (mode === "delete") {
        const ok = window.confirm(
          `Permanently delete ${effectiveCount} track(s) and their files from the server? This cannot be undone.`
        );
        if (!ok) return;
        const result = await tracksApi.batch(
          ids,
          "delete",
          undefined,
          scope === "all" ? currentFilter : undefined
        );
        toast.success(`Deleted ${result.updated} track(s)`);
      }

      onComplete?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Batch operation failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Batch Edit Tracks</DialogTitle>
          <DialogDescription>
            Apply changes to many tracks at once.
          </DialogDescription>
        </DialogHeader>

        {/* Scope selector */}
        <div className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 p-2">
          <button
            onClick={() => setScope("selected")}
            disabled={!hasSelection}
            className={`flex-1 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors ${
              scope === "selected"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:bg-white/5"
            } ${!hasSelection ? "opacity-40 cursor-not-allowed" : ""}`}
          >
            Selected ({selectedCount})
          </button>
          <button
            onClick={() => setScope("all")}
            className={`flex-1 px-3 py-1.5 rounded-sm text-sm font-medium transition-colors ${
              scope === "all"
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            All filtered ({totalCount})
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 border-b border-border/50">
          <ModeTab
            active={mode === "setCategory"}
            onClick={() => setMode("setCategory")}
            icon={<FolderTree className="h-4 w-4" />}
            label="Change Category"
          />
          <ModeTab
            active={mode === "tag"}
            onClick={() => setMode("tag")}
            icon={<TagIcon className="h-4 w-4" />}
            label="Mark / Tag"
          />
          <ModeTab
            active={mode === "delete"}
            onClick={() => setMode("delete")}
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete"
            destructive
          />
        </div>

        {/* Mode content */}
        <div className="py-2 min-h-[120px]">
          {mode === "setCategory" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Move to category</label>
              <select
                value={targetCategoryId}
                onChange={(e) => setTargetCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-sm bg-input border border-border/50 text-foreground text-sm"
              >
                <option value="">-- Select a category --</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent_id ? `↳ ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "tag" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={tagAction === "add" ? "default" : "outline"}
                  onClick={() => setTagAction("add")}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add
                </Button>
                <Button
                  size="sm"
                  variant={tagAction === "remove" ? "default" : "outline"}
                  onClick={() => setTagAction("remove")}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Remove
                </Button>
                <Button
                  size="sm"
                  variant={tagAction === "clear" ? "default" : "outline"}
                  onClick={() => setTagAction("clear")}
                >
                  Clear all
                </Button>
              </div>

              {tagAction !== "clear" && (
                <>
                  <Input
                    placeholder="Tag name (e.g. review, needs-edit)"
                    value={tagValue}
                    onChange={(e) => setTagValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_TAGS.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTagValue(t)}
                        className="text-xs px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 hover:bg-primary/10 hover:border-primary/40 text-muted-foreground hover:text-primary transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                    {knownTags
                      .filter((t) => !PRESET_TAGS.includes(t))
                      .map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTagValue(t)}
                          className="text-xs px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </>
              )}

              {tagAction === "clear" && (
                <div className="text-sm text-muted-foreground rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  This will remove <em>all</em> tags from the {effectiveCount}{" "}
                  track(s) in scope.
                </div>
              )}
            </div>
          )}

          {mode === "delete" && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <div className="font-medium text-foreground">
                  Permanently delete {effectiveCount} track(s)?
                </div>
                <div className="text-muted-foreground mt-1">
                  Removes the database row AND the audio file from the server.
                  Cloud copies (Dropbox) are not touched. This cannot be undone.
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <div className="flex-1 text-xs text-muted-foreground">
            Scope:{" "}
            <Badge variant="outline" className="ml-1">
              {effectiveCount} track(s)
            </Badge>
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || effectiveCount === 0}
            variant={mode === "delete" ? "destructive" : "default"}
          >
            {submitting
              ? "Applying..."
              : mode === "delete"
              ? "Delete"
              : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  icon,
  label,
  destructive,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? destructive
            ? "border-destructive text-destructive"
            : "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
