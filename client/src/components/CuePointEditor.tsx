"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, ZoomIn, ZoomOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CuePoints { cueIn: number; cueOut: number; segueDuration: number; }
export interface CuePointEditorProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  trackId: string; trackTitle: string; audioUrl: string;
  initialCuePoints: CuePoints; trackType?: string; onSuccess?: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
};

export default function CuePointEditor({ open, onOpenChange, trackId, trackTitle, audioUrl, initialCuePoints, onSuccess }: CuePointEditorProps) {
  const { toast } = useToast();

  // Audio — single element, created once
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    audioRef.current = new Audio();
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // All mutable state in refs to avoid stale closures in RAF/pointer handlers
  const durRef = useRef(0);
  const ciRef = useRef(0);
  const coRef = useRef(0);
  const sgRef = useRef(0);
  const ctRef = useRef(0);
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const winStartRef = useRef(0);
  const playingRef = useRef(false);
  const dragRef = useRef<null | "cueIn" | "cueOut" | "segue">(null);

  // React state (drives re-renders)
  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(0);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [winStart, setWinStart] = useState(0);
  const [waveReady, setWaveReady] = useState(false);

  // Sync refs from state
  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { winStartRef.current = winStart; }, [winStart]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // Window size in seconds
  const winSize = () => (durRef.current || 1) / zoomRef.current;

  // Convert seconds to canvas X
  const toX = useCallback((sec: number, W: number): number => {
    const ws = winSize();
    return clamp(((sec - winStartRef.current) / ws) * W, 0, W);
  }, []);

  // Convert canvas X to seconds
  const toSec = useCallback((x: number, W: number): number => {
    const ws = winSize();
    return clamp(winStartRef.current + (x / W) * ws, 0, durRef.current || 1);
  }, []);

  // DRAW — reads only refs, called from RAF and on state changes
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const playhead = ctRef.current;
    const wave = waveRef.current;

    // Background
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, W, H);

    // Region shading
    const ciX = toX(ci, W), fsX = toX(fs, W), coX = toX(co, W);

    // Before cue in — dark
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, ciX, H - 40);

    // Active region — subtle cyan tint
    ctx.fillStyle = "rgba(6,182,212,0.08)";
    ctx.fillRect(ciX, 0, coX - ciX, H - 40);

    // Segue region — amber tint
    ctx.fillStyle = "rgba(251,191,36,0.15)";
    ctx.fillRect(fsX, 0, coX - fsX, H - 40);

    // After cue out — dark
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(coX, 0, W - coX, H - 40);

    // Waveform bars
    if (wave) {
      const ws = winSize();
      const startFrac = winStartRef.current / d;
      const endFrac = Math.min(1, (winStartRef.current + ws) / d);
      const startIdx = Math.floor(startFrac * wave.length);
      const endIdx = Math.ceil(endFrac * wave.length);
      const visible = endIdx - startIdx;
      const bw = W / visible;

      for (let i = 0; i < visible; i++) {
        const idx = startIdx + i;
        if (idx >= wave.length) break;
        const sec = winStartRef.current + (i / visible) * ws;
        const amp = wave[idx];
        const bh = Math.max(2, amp * (H - 60) * 0.9);
        const x = i * bw;
        const y = (H - 40 - bh) / 2;

        if (sec < ci) ctx.fillStyle = "#1e3a4a";
        else if (sec < fs) ctx.fillStyle = "#22d3ee";
        else if (sec < co) ctx.fillStyle = "#f59e0b";
        else ctx.fillStyle = "#1e3a4a";

        ctx.fillRect(x, y, Math.max(1, bw - 0.5), bh);
      }
    }

    // Vertical marker lines
    const drawLine = (x: number, color: string, dashed = false) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      if (dashed) ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 40);
      ctx.stroke();
      ctx.restore();
    };
    drawLine(ciX, "#22c55e");
    drawLine(fsX, "#f59e0b", true);
    drawLine(coX, "#ef4444");

    // ── HANDLES — staggered vertically so they NEVER overlap ──
    // Each handle is a large diamond/arrow at a different row
    // Row 0 (bottom): CUE IN (green)
    // Row 1 (middle): SEGUE/FADE (amber)  
    // Row 2 (top): CUE OUT (red)
    const HANDLE_H = H - 40; // waveform area height

    const drawHandle = (x: number, color: string, label: string, row: number) => {
      // row 0 = bottom area, row 1 = middle, row 2 = top area
      const zones = [HANDLE_H - 20, HANDLE_H / 2, 20];
      const cy = zones[row];
      const r = 12; // radius

      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;

      // Circle handle
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Border
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.stroke();

      // Line from handle to top of waveform area
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, cy - r);
      ctx.lineTo(x, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Label
      ctx.font = "bold 10px monospace";
      const tw = ctx.measureText(label).width + 10;
      const lx = clamp(x - tw / 2, 2, W - tw - 2);
      const ly = row === 0 ? cy + r + 14 : row === 1 ? cy - r - 16 : cy - r - 16;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(lx, ly - 10, tw, 14, 3);
      ctx.fill();

      ctx.fillStyle = color === "#f59e0b" ? "#000" : "#fff";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 5, ly - 3);

      ctx.restore();
    };

    // Only draw if in visible window (with margin)
    const inView = (x: number) => x > -30 && x < W + 30;
    if (inView(ciX)) drawHandle(ciX, "#22c55e", `▶ ${fmt(ci)}`, 0);
    if (inView(fsX)) drawHandle(fsX, "#f59e0b", `↘ ${fmt(fs)}`, 1);
    if (inView(coX)) drawHandle(coX, "#ef4444", `■ ${fmt(co)}`, 2);

    // Playhead
    const phX = toX(playhead, W);
    ctx.save();
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f43f5e";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, H - 40);
    ctx.stroke();
    // Triangle at top
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(phX - 6, 0);
    ctx.lineTo(phX + 6, 0);
    ctx.lineTo(phX, 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Time ruler
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, H - 40, W, 40);
    ctx.strokeStyle = "#1f2937";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H - 40);
    ctx.lineTo(W, H - 40);
    ctx.stroke();

    const ws2 = winSize();
    const ticks = Math.min(10, Math.floor(W / 80));
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    for (let i = 0; i <= ticks; i++) {
      const t = winStartRef.current + (i / ticks) * ws2;
      const tx = (i / ticks) * W;
      ctx.fillText(fmt(t), clamp(tx, 24, W - 24), H - 14);
      ctx.strokeStyle = "#1f2937";
      ctx.beginPath();
      ctx.moveTo(tx, H - 40);
      ctx.lineTo(tx, H - 32);
      ctx.stroke();
    }
  }, [toX]);

  // Resize canvas to match rendered width
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) {
        canvas.width = w;
        canvas.height = 400;
        draw();
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  // Redraw when any display state changes
  useEffect(() => {
    if (open) draw();
  }, [open, draw, cueIn, cueOut, segue, ct, zoom, winStart, waveReady]);

  // RAF while playing
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        ctRef.current = audio.currentTime;
        setCt(audio.currentTime);
        // Auto-scroll to follow playhead
        const d = durRef.current || 1;
        const ws = d / zoomRef.current;
        const ph = audio.currentTime;
        const end = winStartRef.current + ws;
        if (ph > end - ws * 0.1) {
          const newStart = clamp(ph - ws * 0.1, 0, d - ws);
          winStartRef.current = newStart;
          setWinStart(newStart);
        }
      }
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, draw]);

  // Load audio + waveform on open
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlaying(false);
      playingRef.current = false;
      return;
    }
    // Reset state
    const ci = initialCuePoints.cueIn || 0;
    const co = initialCuePoints.cueOut || 0;
    const sg = initialCuePoints.segueDuration || 0;
    ciRef.current = ci; coRef.current = co; sgRef.current = sg;
    setCueIn(ci); setCueOut(co); setSegue(sg);
    ctRef.current = ci; setCt(ci);
    setPlaying(false); playingRef.current = false;
    durRef.current = 0; setDur(0);
    zoomRef.current = 1; setZoom(1);
    winStartRef.current = 0; setWinStart(0);
    setWaveReady(false);

    // Load audio
    const audio = audioRef.current;
    if (!audio) return;
    const src = audioUrl || `/api/tracks/${trackId}/stream`;

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durRef.current = audio.duration;
        setDur(audio.duration);
      }
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", () => {
      setPlaying(false); playingRef.current = false;
      audio.currentTime = ciRef.current;
      ctRef.current = ciRef.current; setCt(ciRef.current);
    });
    audio.src = src;
    audio.preload = "metadata";
    audio.load();

    // Placeholder waveform
    const N = 500;
    const placeholder = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      placeholder[i] = Math.max(0, (0.3 + Math.sin(p * Math.PI * 10) * 0.2 + (Math.random() - 0.5) * 0.25) * Math.min(p * 6, 1) * Math.min((1 - p) * 6, 1));
    }
    waveRef.current = placeholder;
    draw();

    // Real waveform
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(src, { signal: ctrl.signal });
        if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const ac = new AC();
        const decoded = await ac.decodeAudioData(buf);
        await ac.close();
        const raw = decoded.getChannelData(0);
        const out = new Float32Array(N);
        const block = Math.floor(raw.length / N);
        let mx = 0;
        for (let i = 0; i < N; i++) {
          let s = 0;
          for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j]);
          out[i] = s / block;
          if (out[i] > mx) mx = out[i];
        }
        if (mx > 0) for (let i = 0; i < N; i++) out[i] /= mx;
        waveRef.current = out;
        setWaveReady(true);
      } catch {}
    })();

    return () => {
      ctrl.abort();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
    };
  }, [open]); // eslint-disable-line

  // Hit test — which handle is at this canvas X?
  const hitHandle = (x: number, W: number): "cueIn" | "cueOut" | "segue" | null => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const ciX = toX(ci, W), fsX = toX(fs, W), coX = toX(co, W);
    const hits: [number, "cueIn" | "cueOut" | "segue"][] = [
      [Math.abs(x - ciX), "cueIn"],
      [Math.abs(x - fsX), "segue"],
      [Math.abs(x - coX), "cueOut"],
    ];
    hits.sort((a, b) => a[0] - b[0]);
    return hits[0][0] <= 24 ? hits[0][1] : null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const h = hitHandle(x, rect.width);
    if (h) {
      dragRef.current = h;
    } else {
      // Scrub playhead
      const t = toSec(x, rect.width);
      ctRef.current = t; setCt(t);
      if (audioRef.current) audioRef.current.currentTime = t;
      draw();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const t = toSec(e.clientX - rect.left, rect.width);
    const d = durRef.current || 1;

    if (dragRef.current === "cueIn") {
      const n = clamp(t, 0, coRef.current);
      ciRef.current = n; setCueIn(n);
    } else if (dragRef.current === "cueOut") {
      const n = clamp(t, ciRef.current, d);
      coRef.current = n; setCueOut(n);
      // Keep segue in range
      const sg = clamp(sgRef.current, 0, n - ciRef.current);
      sgRef.current = sg; setSegue(sg);
    } else if (dragRef.current === "segue") {
      // Dragging fade start point
      const co = coRef.current;
      const fadeStart = clamp(t, ciRef.current, co);
      const sg = co - fadeStart;
      sgRef.current = sg; setSegue(sg);
    }
    draw();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  // Zoom
  const doZoom = (newZ: number) => {
    const d = durRef.current || 1;
    const z = clamp(newZ, 1, 32);
    const ws = d / z;
    const center = ctRef.current;
    const newStart = clamp(center - ws / 2, 0, d - ws);
    zoomRef.current = z; winStartRef.current = newStart;
    setZoom(z); setWinStart(newStart); draw();
  };

  const fitToCueRegion = () => {
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current;
    const span = Math.max(co - ci, 0.5);
    const pad = span * 0.25;
    const ws = span + pad * 2;
    const newZ = clamp(d / ws, 1, 32);
    const actualWs = d / newZ;
    const newStart = clamp(ci - pad, 0, d - actualWs);
    zoomRef.current = newZ; winStartRef.current = newStart;
    setZoom(newZ); setWinStart(newStart); draw();
  };

  // Playback
  const togglePlay = async () => {
    const audio = audioRef.current; if (!audio) return;
    if (playing) {
      audio.pause(); setPlaying(false); playingRef.current = false; return;
    }
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    if (!audio.src || audio.src === window.location.href) { audio.src = src; audio.load(); }
    try {
      await audio.play();
      setPlaying(true); playingRef.current = true;
    } catch (err: any) {
      toast({ title: "Playback failed", description: err?.message, variant: "destructive" });
    }
  };

  const stop = () => {
    const audio = audioRef.current; if (!audio) return;
    audio.pause();
    audio.currentTime = ciRef.current;
    ctRef.current = ciRef.current; setCt(ciRef.current);
    setPlaying(false); playingRef.current = false; draw();
  };

  const jumpTo = (t: number) => {
    const audio = audioRef.current; if (audio) audio.currentTime = t;
    ctRef.current = t; setCt(t); draw();
  };

  // Save
  const save = async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration: segue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Saved", description: "Cue points updated." });
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 300);
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    }
  };

  const fadeStart = Math.max(cueIn, cueOut - segue);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] w-[1400px] p-0 overflow-hidden bg-gray-950 border border-gray-800">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
          <div>
            <DialogTitle className="text-base font-bold text-cyan-400 font-mono tracking-wide">
              {trackTitle}
            </DialogTitle>
            <DialogDescription className="text-xs text-gray-500 mt-0.5">
              Drag the colored handles to set cue points · click waveform to scrub
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => doZoom(zoom / 2)} disabled={zoom <= 1}
              className="p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 transition-colors">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-gray-400 w-12 text-center">{zoom.toFixed(1)}x</span>
            <button onClick={() => doZoom(zoom * 2)} disabled={zoom >= 32}
              className="p-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30 transition-colors">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={fitToCueRegion}
              className="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-cyan-400 text-xs font-mono transition-colors">
              fit
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">

          {/* ── Transport ── */}
          <div className="flex items-center gap-3 bg-gray-900 rounded-xl px-5 py-3 border border-gray-800">
            <button onClick={stop}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
              <Square className="w-4 h-4" />
            </button>
            <button onClick={togglePlay}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-cyan-500 hover:bg-cyan-400 text-black transition-colors shadow-lg shadow-cyan-500/30">
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <div className="flex-1 font-mono text-3xl text-white text-center tracking-widest select-none">
              {fmt(ct)}
              <span className="text-gray-600 text-lg ml-4">/ {fmt(dur || cueOut)}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => jumpTo(cueIn)}
                className="px-3 py-1.5 rounded-lg bg-green-900/40 hover:bg-green-800/60 text-green-400 text-xs font-mono border border-green-800/50 transition-colors">
                ▶ START
              </button>
              <button onClick={() => jumpTo(fadeStart)}
                className="px-3 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-800/60 text-amber-400 text-xs font-mono border border-amber-800/50 transition-colors">
                ↘ FADE
              </button>
              <button onClick={() => jumpTo(Math.max(0, cueOut - 3))}
                className="px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-400 text-xs font-mono border border-red-800/50 transition-colors">
                ■ END
              </button>
            </div>
          </div>

          {/* ── Waveform Canvas ── */}
          <div className="rounded-xl overflow-hidden border border-gray-800 w-full bg-gray-950">
            <canvas
              ref={canvasRef}
              height={400}
              className="w-full block"
              style={{ cursor: "crosshair", touchAction: "none", userSelect: "none" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>

          {/* ── Legend ── */}
          <div className="flex gap-6 px-1 text-xs font-mono">
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-green-500 inline-block shadow-sm shadow-green-500/50" />CUE IN (Start)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block shadow-sm shadow-amber-500/50" />FADE (Segue start)</span>
            <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500 inline-block shadow-sm shadow-red-500/50" />CUE OUT (End)</span>
            <span className="flex items-center gap-2 ml-auto text-gray-600">drag handles · click to scrub · zoom for precision</span>
          </div>

          {/* ── Numeric inputs ── */}
          <div className="grid grid-cols-3 gap-4">
            <NumField label="Cue In (Start)" color="border-green-500" accent="text-green-400"
              value={cueIn} max={cueOut}
              onChange={v => { const n = clamp(v, 0, coRef.current); ciRef.current = n; setCueIn(n); draw(); }} />
            <NumField label="Segue Duration" color="border-amber-500" accent="text-amber-400"
              value={segue} max={cueOut - cueIn}
              onChange={v => { const n = clamp(v, 0, coRef.current - ciRef.current); sgRef.current = n; setSegue(n); draw(); }} />
            <NumField label="Cue Out (End)" color="border-red-500" accent="text-red-400"
              value={cueOut} max={dur || cueOut}
              onChange={v => { const n = clamp(v, ciRef.current, durRef.current || 9999); coRef.current = n; setCueOut(n); draw(); }} />
          </div>

          {/* ── Summary + Actions ── */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-xs font-mono text-gray-500">
              <span className="text-green-400">{fmt(cueIn)}</span>
              {" → "}
              <span className="text-red-400">{fmt(cueOut)}</span>
              {" · segue "}
              <span className="text-amber-400">{segue.toFixed(2)}s</span>
              {" · active "}
              <span className="text-cyan-400">{fmt(cueOut - cueIn)}</span>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => onOpenChange(false)}
                className="border-gray-700 text-gray-400 hover:text-white">
                Cancel
              </Button>
              <Button onClick={save}
                className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-8">
                Save Cue Points
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ label, color, accent, value, max, onChange }: {
  label: string; color: string; accent: string; value: number; max: number; onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value.toFixed(2));
  useEffect(() => { setLocal(value.toFixed(2)); }, [value]);
  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(n); else setLocal(value.toFixed(2));
  };
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <label className={`block text-xs font-bold mb-2 font-mono ${accent}`}>{label}</label>
      <input type="number" value={local} step="0.01" min="0"
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === "Enter" && commit()}
        className={`w-full bg-gray-950 border-2 ${color} rounded-lg px-3 py-2.5 text-sm font-mono text-white focus:outline-none`}
      />
    </div>
  );
}
