"use client";

/**
 * BatchCueEditor — search-driven bulk cue-point editor.
 *
 * Filter tracks by any combination of:
 *   • Text search  (title, artist, album, filename)
 *   • Category / subcategory
 *   • Duration range (min/max seconds)
 *   • Cue status  (all | no cue points set | cue points already set)
 *   • Pre-selected IDs passed in from the Library checkboxes
 *
 * Three edit modes:
 *   1. Absolute     — set exact cue-out + segue seconds
 *   2. Relative     — cue-out = (duration − X); segue = Y  (skips tracks with no duration)
 *   3. Segue only   — keep existing cue-out, just update segue duration
 *
 * Progress is shown per-track with an Abort button.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { tracksApi, Track } from "@/lib/api";

// ─── types ───────────────────────────────────────────────────────────────────

type Mode = "absolute" | "relativeFromEnd" | "segueOnly";
type ApplyTo = "all" | "category" | "selected" | "filtered";
type CueStatus = "any" | "none" | "has";
type Status = "pending" | "skipped" | "saving" | "saved" | "error";

interface TrackRow extends Track {
  batchStatus: Status;
  batchError?: string;
}

export interface BatchCueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds?: Set<string>;
  onComplete?: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number | undefined | null, fb = 0) =>
  v !== undefined && v !== null && Number.isFinite(v) && !Number.isNaN(v) ? v : fb;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtDur = (s: number) => {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const hasCuePoints = (t: Track) =>
  (finite(t.cue_out) > 0 || finite(t.cue_in) > 0 || finite(t.segue_duration) > 0);

// ─── component ───────────────────────────────────────────────────────────────

export default function BatchCueEditor({
  open,
  onOpenChange,
  selectedIds = new Set(),
  onComplete,
}: BatchCueEditorProps) {
  const { toast } = useToast();

  // ── filter state ─────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterSubcategory, setFilterSubcategory] = useState("all");
  const [filterCueStatus, setFilterCueStatus] = useState<CueStatus>("any");
  const [minDuration, setMinDuration] = useState("");
  const [maxDuration, setMaxDuration] = useState("");
  const [applyTo, setApplyTo] = useState<ApplyTo>(selectedIds.size > 0 ? "selected" : "filtered");

  // ── edit mode state ───────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("relativeFromEnd");
  const [absCueOut, setAbsCueOut] = useState(180.0);
  const [absSegue, setAbsSegue] = useState(3.0);
  const [trimEnd, setTrimEnd] = useState(3.0);
  const [relSegue, setRelSegue] = useState(3.0);
  const [segueSec, setSegueSec] = useState(3.0);

  // ── data + progress ───────────────────────────────────────────────────────
  const [allTracks, setAllTracks] = useState<TrackRow[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);

  // ── derived lists ─────────────────────────────────────────────────────────
  const categories = useMemo(() =>
    Array.from(new Set(allTracks.map((t) => t.category_name || t.category || "").filter(Boolean))).sort(),
    [allTracks]);

  const subcategories = useMemo(() => {
    if (filterCategory === "all") return [];
    return Array.from(new Set(
      allTracks
        .filter((t) => (t.category_name || t.category || "") === filterCategory)
        .map((t) => t.subcategory_name || "")
        .filter(Boolean)
    )).sort();
  }, [allTracks, filterCategory]);

  // ── filtered tracks ───────────────────────────────────────────────────────

  const filteredTracks = useMemo((): TrackRow[] => {
    const q = searchText.trim().toLowerCase();
    const minD = parseFloat(minDuration);
    const maxD = parseFloat(maxDuration);

    return allTracks.filter((t) => {
      // Scope filter
      if (applyTo === "selected") return selectedIds.has(String(t.id));

      // Text search
      if (q) {
        const haystack = [t.title, t.artist, t.album, t.filepath, t.category_name, t.subcategory_name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      // Category
      if (filterCategory !== "all") {
        if ((t.category_name || t.category || "") !== filterCategory) return false;
      }

      // Subcategory
      if (filterSubcategory !== "all") {
        if ((t.subcategory_name || "") !== filterSubcategory) return false;
      }

      // Duration
      const dur = finite(t.duration);
      if (!isNaN(minD) && dur > 0 && dur < minD) return false;
      if (!isNaN(maxD) && maxD > 0 && dur > 0 && dur > maxD) return false;

      // Cue status
      if (filterCueStatus === "none" && hasCuePoints(t)) return false;
      if (filterCueStatus === "has" && !hasCuePoints(t)) return false;

      return true;
    });
  }, [allTracks, applyTo, selectedIds, searchText, filterCategory, filterSubcategory, minDuration, maxDuration, filterCueStatus]);

  // ── load tracks ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setRunning(false);
    abortRef.current = false;
    setApplyTo(selectedIds.size > 0 ? "selected" : "filtered");
    loadTracks();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTracks = async () => {
    setLoadingTracks(true);
    try {
      const res = await tracksApi.getAll({ limit: 5000, page: 1 });
      const tracks: TrackRow[] = (res.data || []).map((t: Track) => ({
        ...t,
        batchStatus: "pending" as Status,
      }));
      setAllTracks(tracks);
    } catch {
      toast({ title: "Failed to load tracks", variant: "destructive" });
    } finally {
      setLoadingTracks(false);
    }
  };

  // ── compute targets ───────────────────────────────────────────────────────

  const computeTargets = (t: TrackRow): { cueIn: number; cueOut: number; segueDuration: number } | null => {
    const d = finite(t.duration);
    const ci = finite(t.cue_in);

    if (mode === "absolute") {
      const co = clamp(absCueOut, 0, d > 0 ? d : absCueOut);
      return { cueIn: ci, cueOut: co, segueDuration: clamp(absSegue, 0, co - ci) };
    }

    if (mode === "relativeFromEnd") {
      if (d <= 0) return null; // skip — no duration
      const co = clamp(d - trimEnd, ci, d);
      return { cueIn: ci, cueOut: co, segueDuration: clamp(relSegue, 0, co - ci) };
    }

    if (mode === "segueOnly") {
      const co = finite(t.cue_out, d > 0 ? d : 0);
      return { cueIn: ci, cueOut: co, segueDuration: clamp(segueSec, 0, co - ci) };
    }

    return null;
  };

  // ── run batch ─────────────────────────────────────────────────────────────

  const handleRun = async () => {
    const targets = filteredTracks;
    if (targets.length === 0) {
      toast({ title: "No tracks match the current filters", variant: "destructive" });
      return;
    }

    setRunning(true);
    abortRef.current = false;
    setDone(false);

    // Reset statuses
    const targetIds = new Set(targets.map((t) => String(t.id)));
    setAllTracks((prev) =>
      prev.map((t) => ({
        ...t,
        batchStatus: targetIds.has(String(t.id)) ? "pending" : t.batchStatus,
        batchError: targetIds.has(String(t.id)) ? undefined : t.batchError,
      }))
    );

    let savedCount = 0, skippedCount = 0, errorCount = 0;

    for (const track of targets) {
      if (abortRef.current) break;

      const payload = computeTargets(track);
      if (!payload) {
        setAllTracks((prev) =>
          prev.map((t) => t.id === track.id ? { ...t, batchStatus: "skipped", batchError: "No duration" } : t)
        );
        skippedCount++;
        continue;
      }

      setAllTracks((prev) =>
        prev.map((t) => t.id === track.id ? { ...t, batchStatus: "saving" } : t)
      );

      try {
        await tracksApi.updateCuePoints(String(track.id), payload);
        setAllTracks((prev) =>
          prev.map((t) => t.id === track.id ? { ...t, batchStatus: "saved", ...payload } : t)
        );
        savedCount++;
      } catch (err: any) {
        setAllTracks((prev) =>
          prev.map((t) =>
            t.id === track.id
              ? { ...t, batchStatus: "error", batchError: err?.message || "Failed" }
              : t
          )
        );
        errorCount++;
      }

      await sleep(40);
    }

    setRunning(false);
    setDone(true);
    toast({
      title: "Batch complete",
      description: `Saved: ${savedCount} · Skipped: ${skippedCount} · Errors: ${errorCount}`,
      variant: errorCount > 0 ? "destructive" : "default",
    });
    onComplete?.();
  };

  const handleAbort = () => { abortRef.current = true; };

  // ── derived counts ────────────────────────────────────────────────────────

  const totalCount = filteredTracks.length;
  const savedCount = allTracks.filter((t) => t.batchStatus === "saved").length;
  const progress = totalCount > 0 ? Math.round((savedCount / totalCount) * 100) : 0;
  const noCueTracks = filteredTracks.filter((t) => !hasCuePoints(t)).length;
  const noDateTracks = filteredTracks.filter((t) => !t.duration).length;

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[960px] p-0 overflow-hidden border border-slate-700 bg-slate-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900">
          <DialogTitle className="text-lg font-bold text-cyan-400 font-mono tracking-wide">
            Batch Cue Point Editor
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400 mt-0.5">
            Search and filter your library, then bulk-apply cue points.
          </DialogDescription>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[82vh] overflow-y-auto">

          {/* ── SCOPE SELECTOR ── */}
          <section>
            <h3 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider mb-2">Scope</h3>
            <div className="flex gap-4 flex-wrap">
              {([
                ["selected", `Checked in library (${selectedIds.size})`],
                ["filtered", "Use search filters below"],
              ] as const).map(([val, label]) => (
                <label key={val} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="applyTo"
                    value={val}
                    checked={applyTo === val}
                    onChange={() => setApplyTo(val)}
                    className="accent-cyan-500"
                  />
                  <span className="text-sm text-slate-300 font-mono">{label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* ── SEARCH & FILTERS (only when not using selection) ── */}
          {applyTo === "filtered" && (
            <section className="space-y-3 border border-slate-700 rounded-lg p-4 bg-slate-900/50">
              <h3 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Search & Filter</h3>

              {/* Text search */}
              <div>
                <label className="block text-xs text-slate-400 font-mono mb-1">Search (title, artist, album, filename)</label>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="e.g. Beatles, jingle, news, .mp3…"
                  className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-2 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {/* Category + Subcategory row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-mono mb-1">Category</label>
                  <select
                    value={filterCategory}
                    onChange={(e) => { setFilterCategory(e.target.value); setFilterSubcategory("all"); }}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-cyan-500"
                  >
                    <option value="all">All categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-mono mb-1">Subcategory</label>
                  <select
                    value={filterSubcategory}
                    onChange={(e) => setFilterSubcategory(e.target.value)}
                    disabled={filterCategory === "all" || subcategories.length === 0}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-cyan-500 disabled:opacity-40"
                  >
                    <option value="all">All subcategories</option>
                    {subcategories.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Duration range + Cue status row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 font-mono mb-1">Min duration (s)</label>
                  <input
                    type="number"
                    value={minDuration}
                    onChange={(e) => setMinDuration(e.target.value)}
                    placeholder="e.g. 30"
                    min="0"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-mono mb-1">Max duration (s)</label>
                  <input
                    type="number"
                    value={maxDuration}
                    onChange={(e) => setMaxDuration(e.target.value)}
                    placeholder="e.g. 300"
                    min="0"
                    className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 font-mono mb-1">Cue status</label>
                  <select
                    value={filterCueStatus}
                    onChange={(e) => setFilterCueStatus(e.target.value as CueStatus)}
                    className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-cyan-500"
                  >
                    <option value="any">Any</option>
                    <option value="none">No cue points set</option>
                    <option value="has">Has cue points</option>
                  </select>
                </div>
              </div>

              {/* Filter summary */}
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-1">
                <span>
                  <span className="text-cyan-400 font-bold">{totalCount}</span> tracks match
                  {mode === "relativeFromEnd" && noDateTracks > 0 && (
                    <span className="text-amber-400 ml-2">· {noDateTracks} will be skipped (no duration)</span>
                  )}
                  {noCueTracks > 0 && filterCueStatus === "any" && (
                    <span className="text-slate-500 ml-2">· {noCueTracks} have no cue points yet</span>
                  )}
                </span>
                {(searchText || filterCategory !== "all" || filterCueStatus !== "any" || minDuration || maxDuration) && (
                  <button
                    onClick={() => {
                      setSearchText(""); setFilterCategory("all"); setFilterSubcategory("all");
                      setFilterCueStatus("any"); setMinDuration(""); setMaxDuration("");
                    }}
                    className="text-slate-500 hover:text-slate-300 underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </section>
          )}

          {/* ── EDIT MODE ── */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Edit mode</h3>
            <div className="space-y-2">
              <ModeCard active={mode === "relativeFromEnd"} onClick={() => setMode("relativeFromEnd")}
                label="Relative to file end"
                description="Cue-out = (duration − X seconds). Recommended for music. Skips tracks with no known duration.">
                {mode === "relativeFromEnd" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Trim from end (s)" accent="text-red-400" border="border-red-500"
                      value={trimEnd} step={0.5} onChange={setTrimEnd} />
                    <NumInput label="Segue Duration (s)" accent="text-amber-400" border="border-amber-500"
                      value={relSegue} step={0.5} onChange={setRelSegue} />
                  </div>
                )}
              </ModeCard>

              <ModeCard active={mode === "absolute"} onClick={() => setMode("absolute")}
                label="Absolute values"
                description="Set cue-out and segue to exact seconds for every matched track.">
                {mode === "absolute" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Cue Out / End (s)" accent="text-red-400" border="border-red-500"
                      value={absCueOut} step={1} onChange={setAbsCueOut} />
                    <NumInput label="Segue Duration (s)" accent="text-amber-400" border="border-amber-500"
                      value={absSegue} step={0.5} onChange={setAbsSegue} />
                  </div>
                )}
              </ModeCard>

              <ModeCard active={mode === "segueOnly"} onClick={() => setMode("segueOnly")}
                label="Segue duration only"
                description="Keep existing cue-out point. Only adjust the crossfade length.">
                {mode === "segueOnly" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Segue Duration (s)" accent="text-amber-400" border="border-amber-500"
                      value={segueSec} step={0.5} onChange={setSegueSec} />
                  </div>
                )}
              </ModeCard>
            </div>
          </section>

          {/* ── PROGRESS ── */}
          {(running || done) && (
            <section className="space-y-2">
              <div className="flex justify-between text-xs font-mono text-slate-400">
                <span>{done ? (abortRef.current ? "Aborted" : "Complete") : "Running…"}</span>
                <span>{savedCount} / {totalCount}</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-cyan-500 transition-all duration-150 rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <div className="border border-slate-700 rounded-lg overflow-hidden">
                <div className="bg-slate-900 px-4 py-2 border-b border-slate-700">
                  <span className="text-xs font-mono text-slate-400 font-bold">Progress</span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredTracks.map((t) => (
                    <StatusRow key={t.id} track={t} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* ── ACTIONS ── */}
          <div className="flex justify-between items-center pt-1 pb-1">
            <div className="text-xs font-mono text-slate-500">
              {loadingTracks
                ? <span className="text-cyan-500 animate-pulse">Loading library…</span>
                : <span><span className="text-cyan-400 font-bold">{totalCount}</span> tracks will be updated</span>
              }
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}
                className="border-slate-600 text-slate-300 hover:text-white hover:border-slate-400">
                {done ? "Close" : "Cancel"}
              </Button>
              {running ? (
                <Button onClick={handleAbort}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold px-6">
                  Abort
                </Button>
              ) : (
                <Button
                  onClick={handleRun}
                  disabled={loadingTracks || totalCount === 0}
                  className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 disabled:opacity-50"
                >
                  {done ? "Run Again" : `Apply to ${totalCount} track${totalCount !== 1 ? "s" : ""}`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ModeCard({ active, onClick, label, description, children }: {
  active: boolean; onClick: () => void; label: string; description: string; children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${active ? "border-cyan-500 bg-cyan-950/30" : "border-slate-700 bg-slate-900 hover:border-slate-500"}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${active ? "border-cyan-500 bg-cyan-500" : "border-slate-500"}`} />
        <div className="flex-1">
          <p className={`text-sm font-bold font-mono ${active ? "text-cyan-300" : "text-slate-300"}`}>{label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function NumInput({ label, accent, border, value, step, onChange }: {
  label: string; accent: string; border: string; value: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className={`block text-xs font-bold mb-1 font-mono ${accent}`}>{label}</label>
      <input
        type="number"
        value={value.toFixed(2)}
        step={step}
        min="0"
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-slate-950 border-2 ${border} rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`}
      />
    </div>
  );
}

function StatusRow({ track }: { track: TrackRow }) {
  const colors: Record<Status, string> = {
    pending: "text-slate-500", saving: "text-cyan-400 animate-pulse",
    saved: "text-emerald-400", skipped: "text-amber-400", error: "text-red-400",
  };
  const icons: Record<Status, string> = {
    pending: "–", saving: "⟳", saved: "✓", skipped: "↷", error: "✗",
  };

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
      <span className={`text-sm font-mono w-4 text-center shrink-0 ${colors[track.batchStatus]}`}>
        {icons[track.batchStatus]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-200 truncate font-mono">
          {track.artist ? `${track.artist} — ` : ""}{track.title}
        </p>
        {track.batchError && <p className="text-xs text-red-400">{track.batchError}</p>}
      </div>
      <span className="text-xs font-mono text-slate-500 shrink-0">
        {track.duration ? fmtDur(track.duration) : "—"}
      </span>
      <span className={`text-xs font-mono shrink-0 ${colors[track.batchStatus]}`}>
        {track.batchStatus}
      </span>
    </div>
  );
}
