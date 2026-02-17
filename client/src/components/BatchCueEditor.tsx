"use client";

/**
 * BatchCueEditor
 *
 * Lets the user numerically set the fade (cue-out) and end point for:
 *   • ALL tracks on the server, OR
 *   • A filtered subset (category, track type, or a hand-picked selection)
 *
 * The editor hits the existing PATCH /api/tracks/:id/cuepoints endpoint for
 * each track in a sequential, throttled fashion so the server is not hammered.
 * Progress is shown live with a per-track status indicator.
 *
 * Three modes:
 *   1. ABSOLUTE — set cue_out = X seconds and segue_duration = Y seconds
 *   2. RELATIVE FROM END — set cue_out = (duration - X) seconds
 *   3. RELATIVE SEGUE ONLY — keep cue_out, just change segue_duration
 *
 * Only tracks with a known duration can use relative mode; tracks without a
 * duration are skipped in that mode with a warning.
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { tracksApi, Track } from "@/lib/api";

// ─── types ───────────────────────────────────────────────────────────────────

type Mode = "absolute" | "relativeFromEnd" | "segueOnly";
type ApplyTo = "all" | "category" | "selected";
type Status = "pending" | "skipped" | "saving" | "saved" | "error";

interface TrackRow extends Track {
  batchStatus: Status;
  batchError?: string;
}

export interface BatchCueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-selected track IDs */
  selectedIds?: Set<string>;
  onComplete?: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number, fb = 0) => (Number.isFinite(v) && !Number.isNaN(v) ? v : fb);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── component ───────────────────────────────────────────────────────────────

export default function BatchCueEditor({
  open,
  onOpenChange,
  selectedIds = new Set(),
  onComplete,
}: BatchCueEditorProps) {
  const { toast } = useToast();

  // ── form state ────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>("absolute");
  const [applyTo, setApplyTo] = useState<ApplyTo>(selectedIds.size > 0 ? "selected" : "all");

  // Absolute mode values
  const [absCueOut, setAbsCueOut] = useState(180.0);  // e.g. 3:00
  const [absSegue, setAbsSegue] = useState(3.0);

  // Relative-from-end mode: trim X seconds from duration
  const [trimEnd, setTrimEnd] = useState(3.0);       // cue_out = duration - trimEnd
  const [relSegue, setRelSegue] = useState(3.0);

  // Segue-only mode
  const [segueSec, setSegueSec] = useState(3.0);

  // Category filter (only used when applyTo === "category")
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [categories, setCategories] = useState<string[]>([]);

  // ── tracks + progress ─────────────────────────────────────────────────────
  const [allTracks, setAllTracks] = useState<TrackRow[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);

  // ── load tracks on open ───────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setDone(false);
    setRunning(false);
    abortRef.current = false;
    loadTracks();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTracks = async () => {
    setLoadingTracks(true);
    try {
      // Fetch up to 2000 tracks (batch ops need the full list)
      const res = await tracksApi.getAll({ limit: 2000, page: 1 });
      const tracks: TrackRow[] = (res.data || []).map((t: Track) => ({
        ...t,
        batchStatus: "pending",
      }));
      setAllTracks(tracks);

      // Derive unique categories
      const cats = Array.from(
        new Set(tracks.map((t) => t.category_name || t.category || "").filter(Boolean))
      ).sort();
      setCategories(cats);
    } catch {
      toast({ title: "Failed to load tracks", variant: "destructive" });
    } finally {
      setLoadingTracks(false);
    }
  };

  // ── filtered track list for preview ──────────────────────────────────────

  const filteredTracks = useCallback((): TrackRow[] => {
    return allTracks.filter((t) => {
      if (applyTo === "selected") return selectedIds.has(String(t.id));
      if (applyTo === "category") {
        if (filterCategory === "all") return true;
        return (t.category_name || t.category || "") === filterCategory;
      }
      return true; // "all"
    });
  }, [allTracks, applyTo, selectedIds, filterCategory]);

  // ── compute target cue points for a track ────────────────────────────────

  const computeTargets = (
    t: TrackRow
  ): { cueIn: number; cueOut: number; segueDuration: number } | null => {
    const d = finite(t.duration ?? 0);
    const existingCueIn = finite(t.cue_in ?? 0);

    if (mode === "absolute") {
      const co = clamp(absCueOut, 0, d > 0 ? d : absCueOut);
      const sg = clamp(absSegue, 0, co - existingCueIn);
      return { cueIn: existingCueIn, cueOut: co, segueDuration: sg };
    }

    if (mode === "relativeFromEnd") {
      if (d <= 0) return null; // skip — no duration
      const co = clamp(d - trimEnd, existingCueIn, d);
      const sg = clamp(relSegue, 0, co - existingCueIn);
      return { cueIn: existingCueIn, cueOut: co, segueDuration: sg };
    }

    if (mode === "segueOnly") {
      const existingCueOut = finite(t.cue_out ?? 0, d > 0 ? d : absCueOut);
      const sg = clamp(segueSec, 0, existingCueOut - existingCueIn);
      return { cueIn: existingCueIn, cueOut: existingCueOut, segueDuration: sg };
    }

    return null;
  };

  // ── run batch ─────────────────────────────────────────────────────────────

  const handleRun = async () => {
    const targets = filteredTracks();
    if (targets.length === 0) {
      toast({ title: "No tracks to update", variant: "destructive" });
      return;
    }

    setRunning(true);
    abortRef.current = false;
    setDone(false);

    // Reset statuses
    setAllTracks((prev) =>
      prev.map((t) => ({
        ...t,
        batchStatus: targets.find((x) => x.id === t.id) ? "pending" : t.batchStatus,
        batchError: undefined,
      }))
    );

    let savedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const track of targets) {
      if (abortRef.current) break;

      const payload = computeTargets(track);
      if (!payload) {
        // Skip (e.g. no duration for relative mode)
        setAllTracks((prev) =>
          prev.map((t) =>
            t.id === track.id ? { ...t, batchStatus: "skipped", batchError: "No duration" } : t
          )
        );
        skippedCount++;
        continue;
      }

      setAllTracks((prev) =>
        prev.map((t) => (t.id === track.id ? { ...t, batchStatus: "saving" } : t))
      );

      try {
        await tracksApi.updateCuePoints(String(track.id), payload);
        setAllTracks((prev) =>
          prev.map((t) => (t.id === track.id ? { ...t, batchStatus: "saved", ...payload } : t))
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

      // Brief throttle to avoid hammering the DB
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

  const handleAbort = () => {
    abortRef.current = true;
  };

  // ── derived ───────────────────────────────────────────────────────────────

  const preview = filteredTracks();
  const totalCount = preview.length;
  const savedCount = allTracks.filter((t) => t.batchStatus === "saved").length;
  const progress = totalCount > 0 ? Math.round((savedCount / totalCount) * 100) : 0;
  const hasDurationTracks = preview.some((t) => (t.duration || 0) > 0);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[900px] p-0 overflow-hidden border border-slate-700 bg-slate-950">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-900">
          <DialogTitle className="text-lg font-bold text-cyan-400 font-mono tracking-wide">
            Batch Cue Point Editor
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400 mt-0.5">
            Numerically set fade and end points for multiple tracks at once.
          </DialogDescription>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* ── Apply-to section ── */}
          <section className="space-y-2">
            <h3 className="text-sm font-bold font-mono text-slate-300">Apply to</h3>
            <div className="flex gap-3 flex-wrap">
              {(["all", "category", "selected"] as const).map((opt) => (
                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="applyTo"
                    value={opt}
                    checked={applyTo === opt}
                    onChange={() => setApplyTo(opt)}
                    className="accent-cyan-500"
                  />
                  <span className="text-sm text-slate-300 font-mono capitalize">
                    {opt === "selected"
                      ? `Selected (${selectedIds.size})`
                      : opt === "all"
                      ? `All tracks (${allTracks.length})`
                      : "By category"}
                  </span>
                </label>
              ))}
            </div>

            {applyTo === "category" && (
              <div className="flex items-center gap-3 mt-2">
                <label className="text-xs text-slate-400 font-mono w-24">Category</label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-slate-800 border border-slate-600 text-slate-200 rounded px-3 py-1.5 text-sm font-mono flex-1"
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
          </section>

          {/* ── Mode section ── */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold font-mono text-slate-300">Edit mode</h3>
            <div className="grid grid-cols-1 gap-2">
              {/* Absolute */}
              <ModeCard
                active={mode === "absolute"}
                onClick={() => setMode("absolute")}
                label="Absolute values"
                description="Set cue-out and segue to exact second values for every track."
              >
                {mode === "absolute" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Cue Out (End)" accent="text-red-400" border="border-red-500"
                      value={absCueOut} step={1} onChange={setAbsCueOut} />
                    <NumInput label="Segue Duration" accent="text-amber-400" border="border-amber-500"
                      value={absSegue} step={0.5} onChange={setAbsSegue} />
                  </div>
                )}
              </ModeCard>

              {/* Relative from end */}
              <ModeCard
                active={mode === "relativeFromEnd"}
                onClick={() => setMode("relativeFromEnd")}
                label="Relative to file end"
                description="Set cue-out = (track duration − X seconds). Requires known duration; tracks without it are skipped."
              >
                {mode === "relativeFromEnd" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Trim from end (s)" accent="text-red-400" border="border-red-500"
                      value={trimEnd} step={0.5} onChange={setTrimEnd} />
                    <NumInput label="Segue Duration (s)" accent="text-amber-400" border="border-amber-500"
                      value={relSegue} step={0.5} onChange={setRelSegue} />
                  </div>
                )}
                {mode === "relativeFromEnd" && !hasDurationTracks && (
                  <p className="mt-2 text-xs text-amber-400 font-mono">
                    ⚠ None of the filtered tracks have a known duration. All will be skipped.
                  </p>
                )}
              </ModeCard>

              {/* Segue only */}
              <ModeCard
                active={mode === "segueOnly"}
                onClick={() => setMode("segueOnly")}
                label="Segue duration only"
                description="Keep existing cue-out but adjust the crossfade (segue) duration for all tracks."
              >
                {mode === "segueOnly" && (
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <NumInput label="Segue Duration (s)" accent="text-amber-400" border="border-amber-500"
                      value={segueSec} step={0.5} onChange={setSegueSec} />
                  </div>
                )}
              </ModeCard>
            </div>
          </section>

          {/* ── Preview count ── */}
          <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-mono text-slate-300">
              Tracks to update: <span className="text-cyan-400 font-bold">{totalCount}</span>
              {mode === "relativeFromEnd" && (
                <span className="text-slate-500 ml-2">
                  ({preview.filter((t) => !t.duration).length} will be skipped — no duration)
                </span>
              )}
            </span>
            {loadingTracks && (
              <span className="text-xs text-slate-500 font-mono animate-pulse">Loading…</span>
            )}
          </div>

          {/* ── Progress bar (shown while running) ── */}
          {(running || done) && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-mono text-slate-400">
                <span>{done ? "Complete" : "Running…"}</span>
                <span>{savedCount} / {totalCount}</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 transition-all duration-200 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* ── Track status list (scrollable, shown once run) ── */}
          {(running || done) && (
            <div className="border border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-900 px-4 py-2 border-b border-slate-700">
                <span className="text-xs font-mono text-slate-400 font-bold">Track Progress</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {preview.map((t) => (
                  <StatusRow key={t.id} track={t} />
                ))}
              </div>
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="flex justify-end gap-3 pt-1 pb-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-white hover:border-slate-400"
            >
              {done ? "Close" : "Cancel"}
            </Button>
            {running ? (
              <Button
                onClick={handleAbort}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-6"
              >
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
      </DialogContent>
    </Dialog>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function ModeCard({
  active,
  onClick,
  label,
  description,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-4 cursor-pointer transition-colors ${
        active
          ? "border-cyan-500 bg-cyan-950/30"
          : "border-slate-700 bg-slate-900 hover:border-slate-500"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
            active ? "border-cyan-500 bg-cyan-500" : "border-slate-500"
          }`}
        />
        <div className="flex-1">
          <p className={`text-sm font-bold font-mono ${active ? "text-cyan-300" : "text-slate-300"}`}>
            {label}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

function NumInput({
  label,
  accent,
  border,
  value,
  step,
  onChange,
}: {
  label: string;
  accent: string;
  border: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
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
  const statusColors: Record<Status, string> = {
    pending: "text-slate-500",
    saving: "text-cyan-400 animate-pulse",
    saved: "text-emerald-400",
    skipped: "text-amber-400",
    error: "text-red-400",
  };
  const statusIcons: Record<Status, string> = {
    pending: "–",
    saving: "⟳",
    saved: "✓",
    skipped: "↷",
    error: "✗",
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 last:border-0 hover:bg-slate-800/30">
      <span className={`text-sm font-mono w-4 text-center shrink-0 ${statusColors[track.batchStatus]}`}>
        {statusIcons[track.batchStatus]}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-200 truncate font-mono">
          {track.artist ? `${track.artist} — ` : ""}{track.title}
        </p>
        {track.batchError && (
          <p className="text-xs text-red-400">{track.batchError}</p>
        )}
      </div>
      <span className={`text-xs font-mono shrink-0 ${statusColors[track.batchStatus]}`}>
        {track.batchStatus}
      </span>
    </div>
  );
}
