"use client";

/**
 * CuePointEditor — fully rewritten waveform / cue-point editor.
 *
 * Key UX improvements:
 *   1.  Click-and-drag directly on the waveform to SET the fade region.
 *       • Click sets the FADE-START at the cursor; drag right to widen to CUE-OUT.
 *       • Dragging left from the anchor adjusts fadeStart instead.
 *       • Region is painted in amber in real-time as you drag.
 *   2.  Three coloured handle triangles rendered on the waveform canvas itself
 *       (START ▲ green, FADE ▲ amber, END ▲ red) can be grabbed and dragged.
 *   3.  Pointer capture on the canvas so handles never drop on fast moves.
 *   4.  A compact timeline row below mirrors the same three handles for
 *       fine-positioning via mouse drag.
 *   5.  Numeric inputs for direct entry of all three values.
 *   6.  Duration detection: loadedmetadata + canplaythrough + poll fallback.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── types ───────────────────────────────────────────────────────────────────

interface CuePoints {
  cueIn: number;
  cueOut: number;
  segueDuration: number;
}

export interface CuePointEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  trackTitle: string;
  audioUrl: string;
  initialCuePoints: CuePoints;
  trackType?: string;
  onSuccess?: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

const finite = (v: number, fallback = 0) =>
  Number.isFinite(v) && !Number.isNaN(v) ? v : fallback;

const fmt = (s: number): string => {
  const n = finite(s);
  const mm = Math.floor(n / 60);
  const ss = Math.floor(n % 60);
  const hh = Math.floor((n - mm * 60 - ss) * 100);
  return `${mm}:${ss.toString().padStart(2, "0")}.${hh.toString().padStart(2, "0")}`;
};

// ─── component ───────────────────────────────────────────────────────────────

export default function CuePointEditor({
  open,
  onOpenChange,
  trackId,
  trackTitle,
  audioUrl,
  initialCuePoints,
  trackType = "other",
  onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  // ── refs ──────────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const durationRef = useRef<number>(0);

  // ── core state ────────────────────────────────────────────────────────────
  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [snapMode, setSnapMode] = useState<"off" | "0.10" | "0.01">("off");

  // ── interaction refs (avoid stale closures in event handlers) ─────────────
  // These mirror state so canvas pointer handlers can read current values.
  const cueInRef = useRef(cueIn);
  const cueOutRef = useRef(cueOut);
  const segueDurationRef = useRef(segueDuration);
  const snapModeRef = useRef(snapMode);
  useEffect(() => { cueInRef.current = cueIn; }, [cueIn]);
  useEffect(() => { cueOutRef.current = cueOut; }, [cueOut]);
  useEffect(() => { segueDurationRef.current = segueDuration; }, [segueDuration]);
  useEffect(() => { snapModeRef.current = snapMode; }, [snapMode]);

  // ── pointer interaction state stored in a ref (not state, to avoid lag) ──
  type DragMode =
    | { kind: "none" }
    | { kind: "paint"; anchor: number }
    | { kind: "handle"; which: "start" | "fade" | "end" };
  const interactionRef = useRef<DragMode>({ kind: "none" });

  // ── RAF ───────────────────────────────────────────────────────────────────
  const rafRef = useRef<number | null>(null);

  // ── derived ───────────────────────────────────────────────────────────────
  const dur = durationRef.current > 0 ? durationRef.current : (duration || cueOut || 1);
  const fadeStart = Math.max(cueIn, cueOut - segueDuration);

  // ── snap helper ───────────────────────────────────────────────────────────
  const snap = useCallback((v: number) => {
    const mode = snapModeRef.current;
    if (mode === "off") return v;
    const step = mode === "0.10" ? 0.1 : 0.01;
    return Math.round(v / step) * step;
  }, []);

  // ── constrained setters ───────────────────────────────────────────────────

  const setStart = useCallback((v: number) => {
    const d = durationRef.current || dur;
    const n = clamp(snap(finite(v)), 0, d);
    setCueIn(n);
    setCueOut(prev => Math.max(prev, n + segueDurationRef.current));
  }, [dur, snap]);

  const setFadeStartSec = useCallback((fs: number) => {
    const d = durationRef.current || dur;
    const co = cueOutRef.current;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(fs)), ci, co);
    setSegueDuration(clamp(co - n, 0, d));
  }, [dur, snap]);

  const setEnd = useCallback((v: number) => {
    const d = durationRef.current || dur;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(v)), ci, d);
    setCueOut(n);
    setSegueDuration(prev => clamp(prev, 0, n - ci));
  }, [dur, snap]);

  // Bulk constrained apply (used by numeric inputs)
  const applyAll = useCallback((next: Partial<CuePoints>) => {
    const d = durationRef.current || dur;
    let ni = finite(next.cueIn !== undefined ? next.cueIn : cueInRef.current);
    let no = finite(next.cueOut !== undefined ? next.cueOut : cueOutRef.current);
    let ns = finite(next.segueDuration !== undefined ? next.segueDuration : segueDurationRef.current);
    ni = clamp(snap(ni), 0, d);
    no = clamp(snap(no), 0, d);
    ns = clamp(snap(ns), 0, d);
    if (ni > no) [ni, no] = [no, ni];
    ns = clamp(ns, 0, no - ni);
    setCueIn(ni);
    setCueOut(no);
    setSegueDuration(ns);
  }, [dur, snap]);

  // ── waveform generation ───────────────────────────────────────────────────

  const generatePlaceholder = useCallback(() => {
    const N = 600;
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      const base = 0.25 + Math.sin(p * Math.PI * 10) * 0.18;
      const noise = Math.random() * 0.25;
      const env = Math.min(p * 8, 1) * Math.min((1 - p) * 8, 1);
      d[i] = (base + noise) * env;
    }
    setWaveformData(d);
  }, []);

  const generateReal = useCallback(async (src: string) => {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(src, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!resp.ok) throw new Error("fetch failed");
      const buf = await resp.arrayBuffer();
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      const ab = await ctx.decodeAudioData(buf);
      const raw = ab.getChannelData(0);
      const N = 600;
      const block = Math.floor(raw.length / N);
      const out = new Float32Array(N);
      let mx = 0;
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j]);
        out[i] = s / block;
        if (out[i] > mx) mx = out[i];
      }
      if (mx > 0) for (let i = 0; i < N; i++) out[i] /= mx;
      setWaveformData(out);
    } catch {
      // keep placeholder
    }
  }, []);

  // ── canvas draw ───────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    const d = durationRef.current || dur;
    const ci = cueInRef.current;
    const co = cueOutRef.current;
    const sg = segueDurationRef.current;
    const fs = Math.max(ci, co - sg);
    const ct = currentTime;
    const data = waveformData;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    const toX = (sec: number) => (d > 0 ? clamp((sec / d) * W, 0, W) : 0);
    const ciX = toX(ci);
    const fsX = toX(fs);
    const coX = toX(co);
    const ctX = toX(ct);

    // Region tints behind bars
    if (ciX > 0) { ctx.fillStyle = "rgba(15,23,42,0.7)"; ctx.fillRect(0, 0, ciX, H); }
    if (coX > ciX) { ctx.fillStyle = "rgba(6,182,212,0.07)"; ctx.fillRect(ciX, 0, coX - ciX, H); }
    if (coX > fsX) { ctx.fillStyle = "rgba(251,191,36,0.13)"; ctx.fillRect(fsX, 0, coX - fsX, H); }
    if (coX < W) { ctx.fillStyle = "rgba(15,23,42,0.7)"; ctx.fillRect(coX, 0, W - coX, H); }

    // Bars
    if (data) {
      const bw = W / data.length;
      for (let i = 0; i < data.length; i++) {
        const x = i * bw;
        const bh = Math.max(2, data[i] * (H - 40) * 0.88);
        const y = (H - bh) / 2;
        const pos = (i / data.length) * d;
        let color: string;
        if (pos < ci) color = "#1e293b";
        else if (pos < fs) color = "#22d3ee";
        else if (pos < co) color = "#fbbf24";
        else color = "#1e293b";
        ctx.fillStyle = color;
        ctx.fillRect(x, y, Math.max(bw - 1, 1), bh);
      }
    }

    // Marker lines
    const line = (x: number, color: string, dash: number[] = []) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
    };

    if (d > 0) {
      if (ci > 0) line(ciX, "#22c55e");
      line(fsX, "#fbbf24", [6, 4]);
      line(coX, "#ef4444");
    }

    // Handle triangles
    const handle = (x: number, color: string, labelTop: string, labelBot: string, atTop: boolean) => {
      const hy = atTop ? 12 : H - 12;
      const dir = atTop ? 1 : -1;
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hy - dir * 10);
      ctx.lineTo(x - 8, hy + dir * 8);
      ctx.lineTo(x + 8, hy + dir * 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "bold 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      if (atTop) {
        ctx.fillText(labelTop, x, 10);
      } else {
        ctx.fillText(labelTop, x, H - 4);
      }
      ctx.restore();
    };

    if (d > 0) {
      handle(ciX, "#22c55e", `▶ ${fmt(ci)}`, "", false);
      handle(fsX, "#fbbf24", `↘ ${fmt(fs)}`, "", true);
      handle(coX, "#ef4444", `■ ${fmt(co)}`, "", false);
    }

    // Playhead
    ctx.save();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#f43f5e";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ctX, 0);
    ctx.lineTo(ctX, H);
    ctx.stroke();
    ctx.restore();
  }, [waveformData, cueIn, cueOut, segueDuration, currentTime, dur]);

  useLayoutEffect(() => {
    if (!open) return;
    draw();
  }, [open, draw]);

  // ── duration detection ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;

    const tryUpdate = () => {
      if (cancelled) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        durationRef.current = d;
        setDuration(d);
      }
    };

    audio.addEventListener("loadedmetadata", tryUpdate);
    audio.addEventListener("canplaythrough", tryUpdate);
    audio.addEventListener("durationchange", tryUpdate);

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      audio.currentTime = 0;
      setCurrentTime(0);
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    if (audioUrl) {
      audio.src = audioUrl;
      audio.preload = "metadata";
      audio.load();
    } else {
      const fb = initialCuePoints.cueOut || 0;
      if (fb > 0) { durationRef.current = fb; setDuration(fb); }
    }

    tryUpdate();
    let attempts = 0;
    const poll = setInterval(() => {
      tryUpdate();
      if (durationRef.current > 0 || ++attempts > 80) clearInterval(poll);
    }, 50);

    return () => {
      cancelled = true;
      clearInterval(poll);
      audio.removeEventListener("loadedmetadata", tryUpdate);
      audio.removeEventListener("canplaythrough", tryUpdate);
      audio.removeEventListener("durationchange", tryUpdate);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
  }, [open, audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── reset on open ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setCueIn(initialCuePoints.cueIn || 0);
    setCueOut(initialCuePoints.cueOut || 0);
    setSegueDuration(initialCuePoints.segueDuration || 0);
    setCurrentTime(0);
    setIsPlaying(false);
    durationRef.current = 0;
    setDuration(0);
    generatePlaceholder();
    if (audioUrl) setTimeout(() => generateReal(audioUrl), 150);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── RAF playhead ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying]);

  // ── playback ──────────────────────────────────────────────────────────────

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause(); setIsPlaying(false);
    } else {
      // Ensure audio src is set
      if (!audio.src && audioUrl) {
        audio.src = audioUrl;
        audio.load();
      }
      try { 
        await audio.play(); 
        setIsPlaying(true); 
      }
      catch (err: any) { 
        console.error("Play error:", err);
        toast({ 
          title: "Playback failed", 
          description: err.message || "Could not play audio. Check that the file exists on the server.", 
          variant: "destructive" 
        }); 
      }
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause(); audio.currentTime = 0;
    setIsPlaying(false); setCurrentTime(0);
  };

  // ── canvas pointer handling ───────────────────────────────────────────────

  const HANDLE_THRESH = 14; // px hit radius for grabbing a handle

  const secAtClientX = (clientX: number, rect: DOMRect): number => {
    const d = durationRef.current || dur;
    return clamp(((clientX - rect.left) / rect.width) * d, 0, d);
  };

  const hitHandle = (
    clientX: number,
    rect: DOMRect
  ): "start" | "fade" | "end" | null => {
    const d = durationRef.current || dur;
    if (d <= 0) return null;
    const W = rect.width;
    const x = clientX - rect.left;
    const toX = (s: number) => (s / d) * W;
    const ci = cueInRef.current;
    const co = cueOutRef.current;
    const fs = Math.max(ci, co - segueDurationRef.current);
    const hits: [number, "start" | "fade" | "end"][] = [
      [Math.abs(x - toX(ci)), "start"],
      [Math.abs(x - toX(fs)), "fade"],
      [Math.abs(x - toX(co)), "end"],
    ];
    hits.sort((a, b) => a[0] - b[0]);
    return hits[0][0] <= HANDLE_THRESH ? hits[0][1] : null;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const h = hitHandle(e.clientX, rect);
    if (h) {
      interactionRef.current = { kind: "handle", which: h };
    } else {
      const t = secAtClientX(e.clientX, rect);
      interactionRef.current = { kind: "paint", anchor: t };
      // Initialise: anchor becomes fadeStart, cueOut = anchor, segue = 0
      const ci = cueInRef.current;
      const anchorClamped = clamp(t, ci, durationRef.current || dur);
      setCueOut(anchorClamped);
      setSegueDuration(0);
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mode = interactionRef.current;
    if (mode.kind === "none") return;
    const rect = canvas.getBoundingClientRect();
    const t = secAtClientX(e.clientX, rect);

    if (mode.kind === "handle") {
      switch (mode.which) {
        case "start": setStart(t); break;
        case "fade": setFadeStartSec(t); break;
        case "end": setEnd(t); break;
      }
    } else if (mode.kind === "paint") {
      const anchor = mode.anchor;
      const d = durationRef.current || dur;
      const ci = cueInRef.current;
      if (t >= anchor) {
        // Drag right: anchor = fadeStart, t = cueOut
        const co = clamp(t, anchor, d);
        setCueOut(co);
        setSegueDuration(clamp(co - anchor, 0, co - ci));
      } else {
        // Drag left: anchor = cueOut, t = fadeStart
        setCueOut(clamp(anchor, ci, d));
        setFadeStartSec(t);
      }
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    interactionRef.current = { kind: "none" };
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
  };

  // ── timeline mouse drag ───────────────────────────────────────────────────

  const tlDragRef = useRef<"start" | "fade" | "end" | null>(null);

  const tlHit = (clientX: number, rect: DOMRect): "start" | "fade" | "end" | null => {
    const d = durationRef.current || dur;
    if (d <= 0) return null;
    const W = rect.width;
    const x = clientX - rect.left;
    const ci = cueInRef.current;
    const co = cueOutRef.current;
    const fs = Math.max(ci, co - segueDurationRef.current);
    const toX = (s: number) => (s / d) * W;
    const hits: [number, "start" | "fade" | "end"][] = [
      [Math.abs(x - toX(ci)), "start"],
      [Math.abs(x - toX(fs)), "fade"],
      [Math.abs(x - toX(co)), "end"],
    ];
    hits.sort((a, b) => a[0] - b[0]);
    return hits[0][0] <= HANDLE_THRESH ? hits[0][1] : null;
  };

  const handleTlMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const h = tlHit(e.clientX, rect);
    if (h) {
      tlDragRef.current = h;
      e.preventDefault();
    } else {
      // Scrub playhead
      const audio = audioRef.current;
      const t = secAtClientX(e.clientX, rect);
      if (audio) audio.currentTime = t;
      setCurrentTime(t);
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const tl = timelineRef.current;
      if (!tl || !tlDragRef.current) return;
      const rect = tl.getBoundingClientRect();
      const t = secAtClientX(e.clientX, rect);
      switch (tlDragRef.current) {
        case "start": setStart(t); break;
        case "fade": setFadeStartSec(t); break;
        case "end": setEnd(t); break;
      }
    };
    const onUp = () => { tlDragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setStart, setFadeStartSec, setEnd]);

  // ── save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Saved", description: "Cue points saved." });
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 300);
    } catch {
      toast({ title: "Save failed", description: "Could not save cue points.", variant: "destructive" });
    }
  };

  // ── derived percentages for timeline ─────────────────────────────────────

  const d = durationRef.current || dur;
  const pct = (s: number) => (d > 0 ? `${clamp((s / d) * 100, 0, 100).toFixed(4)}%` : "0%");

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1300px] p-0 overflow-hidden border border-slate-700 bg-slate-950">
        <audio ref={audioRef} />

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div>
            <DialogTitle className="text-lg font-bold text-cyan-400 font-mono tracking-wide">
              {trackTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-0.5">
              Click waveform → drag right to paint fade region · drag ▶ ↘ ■ handles to adjust · timeline row for fine control
            </DialogDescription>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400 font-mono">Snap</label>
            <select
              value={snapMode}
              onChange={(e) => setSnapMode(e.target.value as typeof snapMode)}
              className="bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs font-mono"
            >
              <option value="off">Off</option>
              <option value="0.10">0.10s</option>
              <option value="0.01">0.01s</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* ── Transport ── */}
          <div className="flex items-center gap-3 bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <button
              onClick={togglePlay}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black transition-colors shrink-0"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <button
              onClick={handleStop}
              className="flex items-center justify-center w-9 h-9 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors shrink-0"
            >
              <Square className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center font-mono text-2xl text-white tracking-widest select-none">
              {fmt(currentTime)}
              <span className="text-slate-500 text-base ml-3">/ {fmt(d)}</span>
            </div>
            {/* Mini legend */}
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />start</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />fade</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />end</span>
            </div>
          </div>

          {/* ── Waveform canvas ── */}
          <div className="rounded-lg overflow-hidden border border-slate-700">
            <canvas
              ref={canvasRef}
              width={1200}
              height={180}
              className="w-full block"
              style={{ cursor: "crosshair", touchAction: "none", userSelect: "none" }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            />
          </div>

          {/* ── Timeline handles row ── */}
          <div
            ref={timelineRef}
            className="relative h-12 bg-slate-800 rounded-lg border border-slate-700 cursor-pointer select-none"
            onMouseDown={handleTlMouseDown}
          >
            {/* Active region */}
            <div
              className="absolute top-0 bottom-0 bg-cyan-500/15 pointer-events-none"
              style={{ left: pct(cueIn), width: `calc(${pct(cueOut)} - ${pct(cueIn)})` }}
            />
            {/* Fade region */}
            <div
              className="absolute top-0 bottom-0 bg-amber-400/20 pointer-events-none"
              style={{ left: pct(fadeStart), width: `calc(${pct(cueOut)} - ${pct(fadeStart)})` }}
            />
            {/* Labels */}
            <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
              <span className="text-xs text-slate-500 font-mono">0:00</span>
              <span className="text-xs text-slate-500 font-mono">{fmt(d)}</span>
            </div>
            {/* Marker pins */}
            <TlPin pos={pct(cueIn)} color="bg-emerald-500" time={fmt(cueIn)} label="START" />
            <TlPin pos={pct(fadeStart)} color="bg-amber-400" time={fmt(fadeStart)} label="FADE" dark />
            <TlPin pos={pct(cueOut)} color="bg-red-500" time={fmt(cueOut)} label="END" />
          </div>

          {/* ── Numeric inputs ── */}
          <div className="grid grid-cols-3 gap-4">
            <NumField label="Cue In (Start)" accent="text-emerald-400" border="border-emerald-500"
              value={cueIn} onChange={(v) => applyAll({ cueIn: v })} />
            <NumField label="Segue Duration" accent="text-amber-400" border="border-amber-500"
              value={segueDuration} onChange={(v) => applyAll({ segueDuration: v })} />
            <NumField label="Cue Out (End)" accent="text-red-400" border="border-red-500"
              value={cueOut} onChange={(v) => applyAll({ cueOut: v })} />
          </div>

          {/* ── Actions ── */}
          <div className="flex justify-end gap-3 pt-1 pb-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-white hover:border-slate-400">
              Cancel
            </Button>
            <Button onClick={handleSave}
              className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6">
              Save Cue Points
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function TlPin({ pos, color, time, label, dark = false }: {
  pos: string; color: string; time: string; label: string; dark?: boolean;
}) {
  return (
    <div className="absolute top-0 bottom-0" style={{ left: pos, transform: "translateX(-50%)" }}>
      <div className={`w-0.5 h-full ${color} opacity-80`} />
      <div
        className={`absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shadow-md ${color} ${dark ? "text-black" : "text-white"}`}
      >
        {label} {time}
      </div>
    </div>
  );
}

function NumField({ label, accent, border, value, onChange }: {
  label: string; accent: string; border: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
      <label className={`block text-xs font-bold mb-2 font-mono ${accent}`}>{label}</label>
      <input
        type="number"
        value={value.toFixed(2)}
        step="0.1"
        min="0"
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`w-full bg-slate-950 border-2 ${border} rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`}
      />
    </div>
  );
}
