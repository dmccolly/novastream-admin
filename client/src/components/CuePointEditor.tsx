"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: number, fb = 0) => (Number.isFinite(v) && !Number.isNaN(v) ? v : fb);

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
  onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  // ── Single audio element — created once, never recreated ─────────────────
  // FIX: Do NOT render <audio> in JSX. Create it here and manage it entirely
  // in JS. A JSX <audio ref={x}/> and new Audio() stored in the same ref
  // are two different elements and they conflict.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    audioRef.current = new Audio();
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Refs that shadow state (no stale closures in pointer/RAF handlers) ────
  const durationRef = useRef(0);
  const cueInRef = useRef(initialCuePoints.cueIn || 0);
  const cueOutRef = useRef(initialCuePoints.cueOut || 0);
  const segueDurRef = useRef(initialCuePoints.segueDuration || 0);
  const currentTimeRef = useRef(0);
  const waveformRef = useRef<Float32Array | null>(null);
  const snapRef = useRef<"off" | "0.10" | "0.01">("off");
  const canvasWidthRef = useRef(800); // tracks actual rendered pixel width

  // ── State (drives re-renders / display) ──────────────────────────────────
  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [snapMode, setSnapMode] = useState<"off" | "0.10" | "0.01">("off");
  const [waveformStatus, setWaveformStatus] = useState<"loading" | "real" | "placeholder">("loading");

  // Sync refs → state
  useEffect(() => { cueInRef.current = cueIn; }, [cueIn]);
  useEffect(() => { cueOutRef.current = cueOut; }, [cueOut]);
  useEffect(() => { segueDurRef.current = segueDuration; }, [segueDuration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { snapRef.current = snapMode; }, [snapMode]);

  // ── Interaction state in refs (no re-render lag during drag) ─────────────
  type Drag = { kind: "none" } | { kind: "paint"; anchor: number } | { kind: "handle"; which: "start" | "fade" | "end" };
  const dragRef = useRef<Drag>({ kind: "none" });
  const tlDragRef = useRef<"start" | "fade" | "end" | null>(null);
  const rafRef = useRef<number | null>(null);

  // ── Snap ──────────────────────────────────────────────────────────────────
  const snap = (v: number) => {
    const m = snapRef.current;
    if (m === "off") return v;
    const step = m === "0.10" ? 0.1 : 0.01;
    return Math.round(v / step) * step;
  };

  // ── Constrained setters ───────────────────────────────────────────────────
  const setStart = useCallback((v: number) => {
    const d = durationRef.current || 1;
    const n = clamp(snap(finite(v)), 0, d);
    cueInRef.current = n;
    setCueIn(n);
    if (cueOutRef.current < n) { cueOutRef.current = n; setCueOut(n); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFadeStart = useCallback((fs: number) => {
    const co = cueOutRef.current;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(fs)), ci, co);
    const sg = clamp(co - n, 0, co - ci);
    segueDurRef.current = sg;
    setSegueDuration(sg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setEnd = useCallback((v: number) => {
    const d = durationRef.current || 1;
    const ci = cueInRef.current;
    const n = clamp(snap(finite(v)), ci, d);
    cueOutRef.current = n;
    setCueOut(n);
    const sg = clamp(segueDurRef.current, 0, n - ci);
    segueDurRef.current = sg;
    setSegueDuration(sg);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyAll = useCallback((next: Partial<CuePoints>) => {
    const d = durationRef.current || 1;
    let ni = finite(next.cueIn !== undefined ? next.cueIn : cueInRef.current);
    let no = finite(next.cueOut !== undefined ? next.cueOut : cueOutRef.current);
    let ns = finite(next.segueDuration !== undefined ? next.segueDuration : segueDurRef.current);
    ni = clamp(snap(ni), 0, d);
    no = clamp(snap(no), 0, d);
    if (ni > no) [ni, no] = [no, ni];
    ns = clamp(snap(ns), 0, no - ni);
    cueInRef.current = ni; cueOutRef.current = no; segueDurRef.current = ns;
    setCueIn(ni); setCueOut(no); setSegueDuration(ns);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas draw — reads only refs, safe to call from RAF ─────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // FIX: Use actual canvas pixel dimensions, not hardcoded 1200
    const W = canvas.width;
    const H = canvas.height;

    const d = durationRef.current > 0 ? durationRef.current : (cueOutRef.current || 1);
    const ci = cueInRef.current;
    const co = cueOutRef.current;
    const sg = segueDurRef.current;
    const fs = Math.max(ci, co - sg);
    const ct = currentTimeRef.current;
    const data = waveformRef.current;

    const toX = (s: number) => clamp((s / d) * W, 0, W);
    const ciX = toX(ci), fsX = toX(fs), coX = toX(co), ctX = toX(ct);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);

    // Region tints
    if (ciX > 0) { ctx.fillStyle = "rgba(15,23,42,0.8)"; ctx.fillRect(0, 0, ciX, H); }
    if (coX > ciX) { ctx.fillStyle = "rgba(6,182,212,0.07)"; ctx.fillRect(ciX, 0, coX - ciX, H); }
    if (coX > fsX) { ctx.fillStyle = "rgba(251,191,36,0.15)"; ctx.fillRect(fsX, 0, coX - fsX, H); }
    if (coX < W) { ctx.fillStyle = "rgba(15,23,42,0.8)"; ctx.fillRect(coX, 0, W - coX, H); }

    // Waveform bars
    if (data) {
      const bw = W / data.length;
      for (let i = 0; i < data.length; i++) {
        const x = i * bw;
        const bh = Math.max(2, data[i] * (H - 40) * 0.88);
        const y = (H - bh) / 2;
        const pos = (i / data.length) * d;
        ctx.fillStyle = pos < ci ? "#1e293b" : pos < fs ? "#22d3ee" : pos < co ? "#fbbf24" : "#1e293b";
        ctx.fillRect(x, y, Math.max(bw - 0.5, 1), bh);
      }
    }

    // Marker lines
    const vline = (x: number, color: string, dash: number[] = []) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.restore();
    };
    vline(ciX, "#22c55e");
    vline(fsX, "#fbbf24", [6, 4]);
    vline(coX, "#ef4444");

    // Handle triangles at bottom
    const tri = (x: number, color: string, label: string) => {
      const hy = H - 16;
      ctx.save();
      ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, hy + 12); ctx.lineTo(x - 8, hy - 4); ctx.lineTo(x + 8, hy - 4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
      ctx.fillText(label, x, H - 1);
      ctx.restore();
    };
    tri(ciX, "#22c55e", `▶ ${fmt(ci)}`);
    tri(fsX, "#fbbf24", `↘ ${fmt(fs)}`);
    tri(coX, "#ef4444", `■ ${fmt(co)}`);

    // Playhead
    ctx.save();
    ctx.strokeStyle = "rgba(244,63,94,0.9)"; ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f43f5e"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(ctX, 0); ctx.lineTo(ctX, H - 20); ctx.stroke();
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath(); ctx.moveTo(ctX, 0); ctx.lineTo(ctX - 5, 10); ctx.lineTo(ctX + 5, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }, []);

  // ── Resize canvas to match actual rendered width ──────────────────────────
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.round(rect.width);
      if (w > 0 && canvas.width !== w) {
        canvas.width = w;
        canvas.height = 180;
        canvasWidthRef.current = w;
        draw();
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [open, draw]);

  // ── Waveform generation ───────────────────────────────────────────────────
  const generatePlaceholder = () => {
    const N = 400;
    const d = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      d[i] = Math.max(0, (0.25 + Math.sin(p * Math.PI * 8) * 0.15 + (Math.random() - 0.5) * 0.25) * Math.min(p * 6, 1) * Math.min((1 - p) * 6, 1));
    }
    waveformRef.current = d;
    setWaveformStatus("placeholder");
    draw();
  };

  const generateReal = async (src: string) => {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(src, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const actx = new Ctx();
      const ab = await actx.decodeAudioData(buf);
      await actx.close();
      const raw = ab.getChannelData(0);
      const N = 400;
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
      setWaveformStatus("real");
      draw();
    } catch (e) {
      console.warn("Waveform decode:", e);
      // Keep placeholder — not a fatal error
    }
  };

  // ── Duration detection ────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;

    const tryUpdate = () => {
      if (cancelled) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) { durationRef.current = d; setDuration(d); }
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

    // FIX: Always use stream endpoint by trackId — don't gate on filepath.
    // LibraryPage passes audioUrl="" when filepath is null, so we build it here.
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    audio.src = src;
    audio.preload = "metadata";
    audio.load();
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
  }, [open, audioUrl, trackId]);

  // ── Reset on open/close ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setIsPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const ci = initialCuePoints.cueIn || 0;
    const co = initialCuePoints.cueOut || 0;
    const sg = initialCuePoints.segueDuration || 0;
    cueInRef.current = ci; cueOutRef.current = co; segueDurRef.current = sg;
    setCueIn(ci); setCueOut(co); setSegueDuration(sg);
    currentTimeRef.current = ci; setCurrentTime(ci);
    setIsPlaying(false);
    durationRef.current = 0; setDuration(0);
    generatePlaceholder();
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    setTimeout(() => generateReal(src), 300);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── RAF — drives canvas + currentTime while playing ───────────────────────
  useEffect(() => {
    if (!isPlaying) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) { currentTimeRef.current = audio.currentTime; setCurrentTime(audio.currentTime); }
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isPlaying, draw]);

  // ── Redraw on cue point / waveform state changes ──────────────────────────
  useEffect(() => {
    if (open) draw();
  }, [open, draw, cueIn, cueOut, segueDuration, waveformStatus, currentTime]);

  // ── Playback ──────────────────────────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }
    // Ensure src is set
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    if (!audio.src || audio.src === window.location.href) {
      audio.src = src;
      audio.load();
    }
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err: any) {
      toast({ title: "Playback failed", description: err?.message || "Could not play audio.", variant: "destructive" });
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = cueInRef.current;
    currentTimeRef.current = cueInRef.current;
    setIsPlaying(false);
    setCurrentTime(cueInRef.current);
    draw();
  };

  const jumpTo = (sec: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = sec;
    currentTimeRef.current = sec;
    setCurrentTime(sec);
    draw();
  };

  // ── Canvas pointer handling ───────────────────────────────────────────────
  const THRESH = 16;

  // FIX: Use canvas.getBoundingClientRect() width for coordinate math,
  // NOT canvas.width (which is the pixel buffer size)
  const secAt = (clientX: number, rect: DOMRect): number => {
    const d = durationRef.current || cueOutRef.current || 1;
    return clamp(((clientX - rect.left) / rect.width) * d, 0, d);
  };

  const hitHandle = (clientX: number, rect: DOMRect): "start" | "fade" | "end" | null => {
    const d = durationRef.current || cueOutRef.current || 1;
    if (d <= 0) return null;
    const W = rect.width; // rendered width, not buffer width
    const x = clientX - rect.left;
    const ci = cueInRef.current, co = cueOutRef.current, sg = segueDurRef.current;
    const fs = Math.max(ci, co - sg);
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
      dragRef.current = { kind: "handle", which: h };
    } else {
      const t = secAt(e.clientX, rect);
      dragRef.current = { kind: "paint", anchor: t };
      const ci = cueInRef.current;
      const co = clamp(t, ci, durationRef.current || 1);
      cueOutRef.current = co; setCueOut(co);
      segueDurRef.current = 0; setSegueDuration(0);
    }
    draw();
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mode = dragRef.current;
    if (mode.kind === "none") return;
    const rect = canvas.getBoundingClientRect();
    const t = secAt(e.clientX, rect);
    if (mode.kind === "handle") {
      if (mode.which === "start") setStart(t);
      else if (mode.which === "fade") setFadeStart(t);
      else setEnd(t);
    } else if (mode.kind === "paint") {
      const anchor = mode.anchor;
      const d = durationRef.current || 1;
      const ci = cueInRef.current;
      if (t >= anchor) {
        const co = clamp(t, anchor, d);
        cueOutRef.current = co; setCueOut(co);
        const sg = clamp(co - anchor, 0, co - ci);
        segueDurRef.current = sg; setSegueDuration(sg);
      } else {
        cueOutRef.current = clamp(anchor, ci, d); setCueOut(clamp(anchor, ci, d));
        setFadeStart(t);
      }
    }
    draw();
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { kind: "none" };
    canvasRef.current?.releasePointerCapture(e.pointerId);
    draw();
  };

  // ── Timeline drag ─────────────────────────────────────────────────────────
  const handleTlMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const rect = tl.getBoundingClientRect();
    const d = durationRef.current || cueOutRef.current || 1;
    const W = rect.width;
    const x = e.clientX - rect.left;
    const ci = cueInRef.current, co = cueOutRef.current, sg = segueDurRef.current;
    const fs = Math.max(ci, co - sg);
    const toX = (s: number) => (s / d) * W;
    const hits: [number, "start" | "fade" | "end"][] = [
      [Math.abs(x - toX(ci)), "start"],
      [Math.abs(x - toX(fs)), "fade"],
      [Math.abs(x - toX(co)), "end"],
    ];
    hits.sort((a, b) => a[0] - b[0]);
    if (hits[0][0] <= THRESH) { tlDragRef.current = hits[0][1]; e.preventDefault(); }
    else jumpTo(clamp((x / W) * d, 0, d));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const tl = timelineRef.current;
      if (!tl || !tlDragRef.current) return;
      const rect = tl.getBoundingClientRect();
      const t = secAt(e.clientX, rect);
      if (tlDragRef.current === "start") setStart(t);
      else if (tlDragRef.current === "fade") setFadeStart(t);
      else setEnd(t);
      draw();
    };
    const onUp = () => { tlDragRef.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [setStart, setFadeStart, setEnd, draw]);

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
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const d = durationRef.current || duration || cueOut || 1;
  const fadeStart = Math.max(cueIn, cueOut - segueDuration);
  const pct = (s: number) => d > 0 ? `${clamp((s / d) * 100, 0, 100).toFixed(3)}%` : "0%";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] p-0 overflow-hidden border border-slate-700 bg-slate-950">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900">
          <div>
            <DialogTitle className="text-lg font-bold text-cyan-400 font-mono tracking-wide">
              {trackTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400 mt-0.5">
              Drag ▶ ↘ ■ handles · click-drag waveform to set fade region · scrub timeline
              {waveformStatus === "loading" && <span className="ml-2 text-cyan-500 animate-pulse">· Loading waveform…</span>}
              {waveformStatus === "placeholder" && <span className="ml-2 text-slate-600">· Approximate waveform</span>}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">Snap</span>
            <select value={snapMode} onChange={(e) => setSnapMode(e.target.value as typeof snapMode)}
              className="bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs font-mono">
              <option value="off">Off</option>
              <option value="0.10">0.10s</option>
              <option value="0.01">0.01s</option>
            </select>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[82vh] overflow-y-auto">

          {/* Transport */}
          <div className="flex items-center gap-3 bg-slate-900 rounded-lg px-4 py-3 border border-slate-800">
            <button onClick={handleStop}
              className="flex items-center justify-center w-9 h-9 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
              <Square className="w-4 h-4" />
            </button>
            <button onClick={togglePlay}
              className="flex items-center justify-center w-11 h-11 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black transition-colors">
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1 text-center font-mono text-2xl text-white tracking-widest select-none">
              {fmt(currentTime)}<span className="text-slate-500 text-base ml-3">/ {fmt(d)}</span>
            </div>
            {/* Jump buttons */}
            <div className="flex items-center gap-1">
              <button onClick={() => jumpTo(cueIn)}
                className="text-xs font-mono px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/70 text-emerald-400 border border-emerald-700/50 transition-colors">
                ▶ START
              </button>
              <button onClick={() => jumpTo(fadeStart)}
                className="text-xs font-mono px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/70 text-amber-400 border border-amber-700/50 transition-colors">
                ↘ FADE
              </button>
              <button onClick={() => jumpTo(Math.max(0, cueOut - 3))}
                className="text-xs font-mono px-2 py-1 rounded bg-red-900/50 hover:bg-red-800/70 text-red-400 border border-red-700/50 transition-colors">
                ■ END
              </button>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />start</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />fade</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />end</span>
            </div>
          </div>

          {/* Waveform canvas */}
          <div ref={containerRef} className="rounded-lg overflow-hidden border border-slate-700 w-full">
            <canvas
              ref={canvasRef}
              height={180}
              className="w-full block"
              style={{ cursor: "crosshair", touchAction: "none", userSelect: "none", display: "block" }}
              onPointerDown={handleCanvasPointerDown}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={handleCanvasPointerUp}
              onPointerCancel={handleCanvasPointerUp}
            />
          </div>

          {/* Timeline */}
          <div ref={timelineRef}
            className="relative h-10 bg-slate-800 rounded-lg border border-slate-700 cursor-pointer select-none overflow-hidden"
            onMouseDown={handleTlMouseDown}>
            <div className="absolute top-0 bottom-0 bg-cyan-500/15 pointer-events-none"
              style={{ left: pct(cueIn), width: `calc(${pct(cueOut)} - ${pct(cueIn)})` }} />
            <div className="absolute top-0 bottom-0 bg-amber-400/20 pointer-events-none"
              style={{ left: pct(fadeStart), width: `calc(${pct(cueOut)} - ${pct(fadeStart)})` }} />
            <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
              <span className="text-xs text-slate-500 font-mono">0:00</span>
              <span className="text-xs text-slate-500 font-mono">{fmt(d)}</span>
            </div>
            <TlPin pos={pct(cueIn)} color="bg-emerald-500" label="START" dark={false} />
            <TlPin pos={pct(fadeStart)} color="bg-amber-400" label="FADE" dark={true} />
            <TlPin pos={pct(cueOut)} color="bg-red-500" label="END" dark={false} />
            <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/60 pointer-events-none"
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

          {/* Summary + Actions */}
          <div className="flex justify-between items-center pt-1 pb-1">
            <div className="text-xs font-mono text-slate-500">
              <span className="text-emerald-400">{fmt(cueIn)}</span>
              {" → "}
              <span className="text-red-400">{fmt(cueOut)}</span>
              {" · segue "}
              <span className="text-amber-400">{segueDuration.toFixed(2)}s</span>
              {" · active "}
              <span className="text-cyan-400">{fmt(cueOut - cueIn)}</span>
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

function TlPin({ pos, color, label, dark }: { pos: string; color: string; label: string; dark: boolean }) {
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
  useEffect(() => { setLocal(value.toFixed(2)); }, [value]);
  return (
    <div className="bg-slate-900 rounded-lg p-3 border border-slate-800">
      <label className={`block text-xs font-bold mb-2 font-mono ${accent}`}>{label}</label>
      <input type="number" value={local} step="0.1" min="0"
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { const n = parseFloat(local); if (!isNaN(n)) onChange(n); else setLocal(value.toFixed(2)); }}
        onKeyDown={(e) => { if (e.key === "Enter") { const n = parseFloat(local); if (!isNaN(n)) onChange(n); } }}
        className={`w-full bg-slate-950 border-2 ${border} rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50`}
      />
    </div>
  );
}
