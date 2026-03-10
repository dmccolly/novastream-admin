"use client";

/**
 * CuePointEditor — precision waveform cue-point editor.
 *
 * Fixes in this version:
 *  - Canvas redraws on every animation frame when playing (RAF loop drives draw)
 *  - Canvas redraws immediately on any cue point or waveform state change
 *  - Play button always works: audio element is lazily created and src is set
 *    on open, not conditionally on filepath
 *  - Waveform decoding uses the stream endpoint with proper error handling
 *  - Numeric inputs use local string state to avoid cursor-jump on edit
 *  - "Jump to" buttons for Start/Fade/End let you audition each point
 *  - Segue visualised as amber gradient on waveform (not just a line)
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
import { Play, Pause, Square, SkipBack, SkipForward } from "lucide-react";
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

  // ── audio element (stable ref, never re-created) ──────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!audioRef.current) {
    audioRef.current = new Audio();
  }

  // ── canvas + timeline refs ────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // ── refs that shadow state (avoid stale closures in RAF / pointer handlers)
  const durationRef = useRef<number>(0);
  const cueInRef = useRef(initialCuePoints.cueIn || 0);
  const cueOutRef = useRef(initialCuePoints.cueOut || 0);
  const segueDurationRef = useRef(initialCuePoints.segueDuration || 0);
  const currentTimeRef = useRef(0);
  const waveformRef = useRef<Float32Array | null>(null);
  const snapModeRef = useRef<"off" | "0.10" | "0.01">("off");

  // ── state ─────────────────────────────────────────────────────────────────
  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [snapMode, setSnapMode] = useState<"off" | "0.10" | "0.01">("off");
  const [waveformLoading, setWaveformLoading] = useState(false);

  // Keep refs in sync with state
  useEffect(() => { cueInRef.current = cueIn; }, [cueIn]);
  useEffect(() => { cueOutRef.current = cueOut; }, [cueOut]);
  useEffect(() => { segueDurationRef.current = segueDuration; }, [segueDuration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { waveformRef.current = waveformData; }, [waveformData]);
  useEffect(() => { snapModeRef.current = snapMode; }, [snapMode]);

  // ── pointer interaction (ref — no re-render lag) ──────────────────────────
  type DragMode =
    | { kind: "none" }
    | { kind: "paint"; anchor: number }
    | { kind: "handle"; which: "start" | "fade" | "end" };
  const interactionRef = useRef<DragMode>({ kind: "none" });
  const tlDragRef = useRef<"start" | "fade" | "end" | null>(null);

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
    const d = durationRef.current || 1;
    const n = clamp(snap(finite(v)), 0, d);
    cueInRef.current = n;
    setCueIn(n);
    if (cueOutRef.current < n + segueDurationRef.current) {
      const newOut = clamp(n + segueDurationRef.current, n, d);
      cueOutRef.current = newOut;
      setCueOut(newOut);
    }
  }, [snap]);

  const setFadeStartSec = useCallback((fs: number) => {
    const co = cueOutRef.current;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(fs)), ci, co);
    const sg = clamp(co - n, 0, co - ci);
    segueDurationRef.current = sg;
    setSegueDuration(sg);
  }, [snap]);

  const setEnd = useCallback((v: number) => {
    const d = durationRef.current || 1;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(v)), ci, d);
    cueOutRef.current = n;
    setCueOut(n);
    const sg = clamp(segueDurationRef.current, 0, n - ci);
    segueDurationRef.current = sg;
    setSegueDuration(sg);
  }, [snap]);

  const applyAll = useCallback((next: Partial<CuePoints>) => {
    const d = durationRef.current || 1;
    let ni = finite(next.cueIn !== undefined ? next.cueIn : cueInRef.current);
    let no = finite(next.cueOut !== undefined ? next.cueOut : cueOutRef.current);
    let ns = finite(next.segueDuration !== undefined ? next.segueDuration : segueDurationRef.current);
    ni = clamp(snap(ni), 0, d);
    no = clamp(snap(no), 0, d);
    if (ni > no) [ni, no] = [no, ni];
    ns = clamp(snap(ns), 0, no - ni);
    cueInRef.current = ni;
    cueOutRef.current = no;
    segueDurationRef.current = ns;
    setCueIn(ni);
    setCueOut(no);
    setSegueDuration(ns);
  }, [snap]);

  // ── canvas draw (pure function reading refs — safe in RAF) ────────────────

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    const d = durationRef.current > 0 ? durationRef.current : (duration || cueOutRef.current || 1);
    const ci = cueInRef.current;
    const co = cueOutRef.current;
    const sg = segueDurationRef.current;
    const fs = Math.max(ci, co - sg);
    const ct = currentTimeRef.current;
    const data = waveformRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    const toX = (sec: number) => d > 0 ? clamp((sec / d) * W, 0, W) : 0;
    const ciX = toX(ci);
    const fsX = toX(fs);
    const coX = toX(co);
    const ctX = toX(ct);

    // Region tints
    if (ciX > 0) { ctx.fillStyle = "rgba(15,23,42,0.75)"; ctx.fillRect(0, 0, ciX, H); }
    if (coX > ciX) { ctx.fillStyle = "rgba(6,182,212,0.07)"; ctx.fillRect(ciX, 0, coX - ciX, H); }
    if (coX > fsX) { ctx.fillStyle = "rgba(251,191,36,0.15)"; ctx.fillRect(fsX, 0, coX - fsX, H); }
    if (coX < W) { ctx.fillStyle = "rgba(15,23,42,0.75)"; ctx.fillRect(coX, 0, W - coX, H); }

    // Waveform bars
    if (data) {
      const bw = W / data.length;
      for (let i = 0; i < data.length; i++) {
        const x = i * bw;
        const bh = Math.max(2, data[i] * (H - 44) * 0.88);
        const y = (H - bh) / 2;
        const pos = (i / data.length) * d;
        let color: string;
        if (pos < ci) color = "#1e293b";
        else if (pos < fs) color = "#22d3ee";
        else if (pos < co) color = "#fbbf24";
        else color = "#1e293b";
        ctx.fillStyle = color;
        ctx.fillRect(x, y, Math.max(bw - 0.5, 1), bh);
      }
    }

    // Marker lines
    const vline = (x: number, color: string, dash: number[] = []) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.restore();
    };

    if (d > 0) {
      vline(ciX, "#22c55e");
      vline(fsX, "#fbbf24", [6, 4]);
      vline(coX, "#ef4444");
    }

    // Handle triangles (at bottom of canvas)
    const tri = (x: number, color: string, label: string) => {
      const hy = H - 14;
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, hy + 10);
      ctx.lineTo(x - 7, hy - 6);
      ctx.lineTo(x + 7, hy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, H - 1);
      ctx.restore();
    };

    if (d > 0) {
      tri(ciX, "#22c55e", `▶ ${fmt(ci)}`);
      tri(fsX, "#fbbf24", `↘ ${fmt(fs)}`);
      tri(coX, "#ef4444", `■ ${fmt(co)}`);
    }

    // Playhead
    ctx.save();
    ctx.strokeStyle = "rgba(244,63,94,0.9)";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f43f5e";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(ctX, 0);
    ctx.lineTo(ctX, H - 20);
    ctx.stroke();
    // Playhead triangle at top
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(ctX, 0);
    ctx.lineTo(ctX - 5, 10);
    ctx.lineTo(ctX + 5, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }, [duration]); // only needs duration from state; everything else via refs

  // ── RAF loop (only runs while playing) ────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        currentTimeRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }
      drawCanvas();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, drawCanvas]);

  // ── Redraw on any cue point / waveform change (when not playing) ──────────

  useLayoutEffect(() => {
    if (!open) return;
    drawCanvas();
  }, [open, drawCanvas, cueIn, cueOut, segueDuration, waveformData, currentTime]);

  // ── Waveform generation ───────────────────────────────────────────────────

  const generatePlaceholder = useCallback(() => {
    const N = 600;
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      const base = 0.25 + Math.sin(p * Math.PI * 10) * 0.18;
      const noise = (Math.random() - 0.5) * 0.3;
      const env = Math.min(p * 8, 1) * Math.min((1 - p) * 8, 1);
      d[i] = Math.max(0, (base + noise) * env);
    }
    waveformRef.current = d;
    setWaveformData(d);
  }, []);

  const generateReal = useCallback(async (src: string) => {
    setWaveformLoading(true);
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12000);
      const resp = await fetch(src, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const actx = new Ctx();
      const ab = await actx.decodeAudioData(buf);
      await actx.close();
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
      waveformRef.current = out;
      setWaveformData(out);
    } catch (e) {
      // Keep placeholder — don't show error to user, waveform is cosmetic
      console.warn("Waveform decode failed:", e);
    } finally {
      setWaveformLoading(false);
    }
  }, []);

  // ── Duration detection ────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current!;
    let cancelled = false;

    const tryUpdate = () => {
      if (cancelled) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        durationRef.current = d;
        setDuration(d);
      }
    };

    const onEnded = () => {
      setIsPlaying(false);
      audio.currentTime = cueInRef.current;
      currentTimeRef.current = cueInRef.current;
      setCurrentTime(cueInRef.current);
    };
    const onTimeUpdate = () => {
      currentTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
    };

    audio.addEventListener("loadedmetadata", tryUpdate);
    audio.addEventListener("canplaythrough", tryUpdate);
    audio.addEventListener("durationchange", tryUpdate);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    // Always set src (even if no filepath — audioUrl may still work)
    if (audioUrl) {
      audio.src = audioUrl;
      audio.preload = "metadata";
      audio.load();
    }

    tryUpdate();
    let attempts = 0;
    const poll = setInterval(() => {
      tryUpdate();
      if (durationRef.current > 0 || ++attempts > 100) clearInterval(poll);
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
  }, [open, audioUrl]);

  // ── Reset on open ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) {
      // Stop playback when dialog closes
      const audio = audioRef.current!;
      audio.pause();
      setIsPlaying(false);
      return;
    }
    const ci = initialCuePoints.cueIn || 0;
    const co = initialCuePoints.cueOut || 0;
    const sg = initialCuePoints.segueDuration || 0;
    cueInRef.current = ci;
    cueOutRef.current = co;
    segueDurationRef.current = sg;
    setCueIn(ci);
    setCueOut(co);
    setSegueDuration(sg);
    setCurrentTime(ci);
    currentTimeRef.current = ci;
    setIsPlaying(false);
    durationRef.current = 0;
    setDuration(0);
    generatePlaceholder();
    if (audioUrl) {
      setTimeout(() => generateReal(audioUrl), 200);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Playback ──────────────────────────────────────────────────────────────

  const togglePlay = async () => {
    const audio = audioRef.current!;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (!audio.src && audioUrl) {
        audio.src = audioUrl;
        audio.load();
        await new Promise<void>((res) => {
          audio.addEventListener("canplay", () => res(), { once: true });
          setTimeout(res, 2000); // timeout fallback
        });
      }
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (err: any) {
        toast({
          title: "Playback failed",
          description: err?.message || "Could not play audio.",
          variant: "destructive",
        });
      }
    }
  };

  const handleStop = () => {
    const audio = audioRef.current!;
    audio.pause();
    audio.currentTime = cueInRef.current;
    currentTimeRef.current = cueInRef.current;
    setIsPlaying(false);
    setCurrentTime(cueInRef.current);
  };

  const jumpTo = (sec: number) => {
    const audio = audioRef.current!;
    audio.currentTime = sec;
    currentTimeRef.current = sec;
    setCurrentTime(sec);
    drawCanvas();
  };

  // ── Canvas pointer handling ───────────────────────────────────────────────

  const THRESH = 14;

  const secAt = (clientX: number, rect: DOMRect): number => {
    const d = durationRef.current || dur;
    return clamp(((clientX - rect.left) / rect.width) * d, 0, d);
  };

  const hitHandle = (clientX: number, rect: DOMRect): "start" | "fade" | "end" | null => {
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
    return hits[0][0] <= THRESH ? hits[0][1] : null;
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
      const t = secAt(e.clientX, rect);
      interactionRef.current = { kind: "paint", anchor: t };
      const ci = cueInRef.current;
      const co = clamp(t, ci, durationRef.current || dur);
      cueOutRef.current = co;
      setCueOut(co);
      segueDurationRef.current = 0;
      setSegueDuration(0);
    }
    drawCanvas();
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mode = interactionRef.current;
    if (mode.kind === "none") return;
    const rect = canvas.getBoundingClientRect();
    const t = secAt(e.clientX, rect);

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
        const co = clamp(t, anchor, d);
        cueOutRef.current = co;
        setCueOut(co);
        const sg = clamp(co - anchor, 0, co - ci);
        segueDurationRef.current = sg;
        setSegueDuration(sg);
      } else {
        cueOutRef.current = clamp(anchor, ci, d);
        setCueOut(clamp(anchor, ci, d));
        setFadeStartSec(t);
      }
    }
    drawCanvas();
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    interactionRef.current = { kind: "none" };
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
    drawCanvas();
  };

  // ── Timeline drag ─────────────────────────────────────────────────────────

  const handleTlMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const d = durationRef.current || dur;
    if (d <= 0) return;
    const W = rect.width;
    const x = e.clientX - rect.left;
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
    if (hits[0][0] <= THRESH) {
      tlDragRef.current = hits[0][1];
      e.preventDefault();
    } else {
      // Scrub
      const t = clamp((x / W) * d, 0, d);
      jumpTo(t);
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const tl = timelineRef.current;
      if (!tl || !tlDragRef.current) return;
      const rect = tl.getBoundingClientRect();
      const t = secAt(e.clientX, rect);
      switch (tlDragRef.current) {
        case "start": setStart(t); break;
        case "fade": setFadeStartSec(t); break;
        case "end": setEnd(t); break;
      }
      drawCanvas();
    };
    const onUp = () => { tlDragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [setStart, setFadeStartSec, setEnd, drawCanvas]);

  // ── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Saved", description: "Cue points saved." });
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 300);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "Could not save cue points.", variant: "destructive" });
    }
  };

  // ── Derived for timeline ──────────────────────────────────────────────────

  const d = durationRef.current || dur;
  const pct = (s: number) => d > 0 ? `${clamp((s / d) * 100, 0, 100).toFixed(4)}%` : "0%";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1300px] p-0 overflow-hidden border border-slate-700 bg-slate-950">
        <audio ref={audioRef} />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div>
            <DialogTitle className="text-lg font-bold text-cyan-400 font-mono tracking-wide">
              {trackTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-0.5">
              Drag ▶ ↘ ■ handles · click-drag waveform to paint fade region · timeline row for fine control
              {waveformLoading && <span className="ml-2 text-cyan-500 animate-pulse">Loading waveform…</span>}
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
          {/* Transport */}
          <div className="flex items-center gap-3 bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <button
              onClick={handleStop}
              className="flex items-center justify-center w-9 h-9 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors shrink-0"
              title="Stop / return to start"
            >
              <Square className="w-4 h-4" />
            </button>
            <button
              onClick={togglePlay}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black transition-colors shrink-0"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1 text-center font-mono text-2xl text-white tracking-widest select-none">
              {fmt(currentTime)}
              <span className="text-slate-500 text-base ml-3">/ {fmt(d)}</span>
            </div>
            {/* Jump buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => jumpTo(cueIn)}
                className="text-xs font-mono px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-400 border border-emerald-700/40 transition-colors"
                title="Jump to Start"
              >▶ START</button>
              <button
                onClick={() => jumpTo(fadeStart)}
                className="text-xs font-mono px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/60 text-amber-400 border border-amber-700/40 transition-colors"
                title="Jump to Fade"
              >↘ FADE</button>
              <button
                onClick={() => jumpTo(Math.max(0, cueOut - 2))}
                className="text-xs font-mono px-2 py-1 rounded bg-red-900/50 hover:bg-red-800/60 text-red-400 border border-red-700/40 transition-colors"
                title="Jump to End"
              >■ END</button>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />start</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />fade</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />end</span>
            </div>
          </div>

          {/* Waveform */}
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

          {/* Timeline row */}
          <div
            ref={timelineRef}
            className="relative h-10 bg-slate-800 rounded-lg border border-slate-700 cursor-pointer select-none overflow-hidden"
            onMouseDown={handleTlMouseDown}
          >
            <div className="absolute top-0 bottom-0 bg-cyan-500/15 pointer-events-none"
              style={{ left: pct(cueIn), width: `calc(${pct(cueOut)} - ${pct(cueIn)})` }} />
            <div className="absolute top-0 bottom-0 bg-amber-400/20 pointer-events-none"
              style={{ left: pct(fadeStart), width: `calc(${pct(cueOut)} - ${pct(fadeStart)})` }} />
            <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
              <span className="text-xs text-slate-500 font-mono">0:00</span>
              <span className="text-xs text-slate-500 font-mono">{fmt(d)}</span>
            </div>
            <TlPin pos={pct(cueIn)} color="bg-emerald-500" time={fmt(cueIn)} label="START" />
            <TlPin pos={pct(fadeStart)} color="bg-amber-400" time={fmt(fadeStart)} label="FADE" dark />
            <TlPin pos={pct(cueOut)} color="bg-red-500" time={fmt(cueOut)} label="END" />
            {/* Playhead on timeline */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/70 pointer-events-none"
              style={{ left: pct(currentTime) }} />
          </div>

          {/* Numeric inputs */}
          <div className="grid grid-cols-3 gap-4">
            <NumField label="Cue In (Start)" accent="text-emerald-400" border="border-emerald-500"
              value={cueIn} onChange={(v) => applyAll({ cueIn: v })} />
            <NumField label="Segue Duration" accent="text-amber-400" border="border-amber-500"
              value={segueDuration} onChange={(v) => applyAll({ segueDuration: v })} />
            <NumField label="Cue Out (End)" accent="text-red-400" border="border-red-500"
              value={cueOut} onChange={(v) => applyAll({ cueOut: v })} />
          </div>

          {/* Actions */}
          <div className="flex justify-between items-center pt-1 pb-1">
            <div className="text-xs font-mono text-slate-500">
              Active region: <span className="text-cyan-400">{fmt(cueIn)}</span>
              {" → "}
              <span className="text-red-400">{fmt(cueOut)}</span>
              {" · Segue: "}
              <span className="text-amber-400">{segueDuration.toFixed(2)}s</span>
            </div>
            <div className="flex gap-3">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TlPin({ pos, color, time, label, dark = false }: {
  pos: string; color: string; time: string; label: string; dark?: boolean;
}) {
  return (
    <div className="absolute top-0 bottom-0" style={{ left: pos, transform: "translateX(-50%)" }}>
      <div className={`w-0.5 h-full ${color} opacity-80`} />
      <div className={`absolute top-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-mono font-bold px-1 py-0.5 rounded ${color} ${dark ? "text-black" : "text-white"}`}>
        {label}
      </div>
    </div>
  );
}

function NumField({ label, accent, border, value, onChange }: {
  label: string; accent: string; border: string; value: number; onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value.toFixed(2));

  useEffect(() => {
    setLocal(value.toFixed(2));
  }, [value]);

  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
      <label className={`block text-xs font-bold mb-2 font-mono ${accent}`}>{label}</label>
      <input
        type="number"
        value={local}
        step="0.1"
        min="0"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n)) onChange(n);
          else setLocal(value.toFixed(2));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = parseFloat(local);
            if (!isNaN(n)) onChange(n);
          }
        }}
        className={`w-full bg-slate-950 border-2 ${border} rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`}
      />
    </div>
  );
}
