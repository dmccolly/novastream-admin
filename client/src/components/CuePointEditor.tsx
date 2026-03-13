"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ─── helpers ──────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

// ─── types ────────────────────────────────────────────────────────────────────
interface CuePoints { cueIn: number; cueOut: number; segueDuration: number; }
export interface CuePointEditorProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  trackId: string; trackTitle: string; audioUrl: string;
  initialCuePoints: CuePoints; trackType?: string; onSuccess?: () => void;
}

// ─── component ────────────────────────────────────────────────────────────────
export default function CuePointEditor({
  open, onOpenChange, trackId, trackTitle, audioUrl, initialCuePoints, onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  // Single audio element — never rendered in JSX
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    audioRef.current = new Audio();
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // All mutable values in refs to avoid stale closures
  const durRef = useRef(0);
  const ciRef = useRef(0);   // cue in
  const coRef = useRef(0);   // cue out
  const sgRef = useRef(0);   // segue duration
  const ctRef = useRef(0);   // current time
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);  // window start in seconds
  const dragRef = useRef<"cueIn" | "cueOut" | "segue" | "pan" | null>(null);
  const panStartRef = useRef({ x: 0, panOrig: 0 });
  const playingRef = useRef(false);

  // React state drives renders
  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(0);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [waveReady, setWaveReady] = useState(false);

  // Sync refs
  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const winSize = () => (durRef.current || 1) / zoomRef.current;

  const toX = (sec: number, W: number) => {
    const ws = winSize();
    return clamp(((sec - panRef.current) / ws) * W, 0, W);
  };

  const toSec = (x: number, W: number) => {
    const ws = winSize();
    return clamp(panRef.current + (x / W) * ws, 0, durRef.current || 1);
  };

  // ── DRAW ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const ph = ctRef.current;
    const wave = waveRef.current;
    const ws = winSize();

    // Background
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    // Region colors
    const ciX = toX(ci, W), fsX = toX(fs, W), coX = toX(co, W), phX = toX(ph, W);

    // Dead zone before cue in
    ctx.fillStyle = "#111122";
    ctx.fillRect(0, 0, ciX, H);

    // Active (intro) zone — green tint
    ctx.fillStyle = "rgba(34,197,94,0.06)";
    ctx.fillRect(ciX, 0, fsX - ciX, H);

    // Segue zone — amber tint
    ctx.fillStyle = "rgba(251,191,36,0.1)";
    ctx.fillRect(fsX, 0, coX - fsX, H);

    // Dead zone after cue out
    ctx.fillStyle = "#111122";
    ctx.fillRect(coX, 0, W - coX, H);

    // Waveform
    if (wave) {
      const startFrac = panRef.current / d;
      const endFrac = Math.min(1, (panRef.current + ws) / d);
      const si = Math.floor(startFrac * wave.length);
      const ei = Math.ceil(endFrac * wave.length);
      const count = Math.max(1, ei - si);
      const bw = W / count;

      for (let i = 0; i < count; i++) {
        const idx = si + i;
        if (idx >= wave.length) break;
        const sec = panRef.current + (i / count) * ws;
        const amp = wave[idx];
        const bh = Math.max(2, amp * (H - 2) * 0.85);
        const x = i * bw;
        const y = (H - bh) / 2;

        if (sec < ci || sec > co) ctx.fillStyle = "#2a2a4a";
        else if (sec >= fs) ctx.fillStyle = "#d97706";
        else ctx.fillStyle = "#0891b2";

        ctx.fillRect(x + 0.5, y, Math.max(1, bw - 1), bh);
      }
    }

    // ── Marker lines ──
    // Trim In (green)
    if (ciX >= 0 && ciX <= W) {
      ctx.save();
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2;
      ctx.shadowColor = "#22c55e"; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(ciX, 0); ctx.lineTo(ciX, H); ctx.stroke();
      ctx.restore();
      // Flag label at top
      drawFlag(ctx, ciX, 4, "#22c55e", `◀ IN  ${fmt(ci)}`, "right");
    }

    // Segue point (amber)
    if (fsX >= 0 && fsX <= W) {
      ctx.save();
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 2;
      ctx.shadowColor = "#f59e0b"; ctx.shadowBlur = 4;
      ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(fsX, 0); ctx.lineTo(fsX, H); ctx.stroke();
      ctx.restore();
      drawFlag(ctx, fsX, 28, "#f59e0b", `↘ SEG ${fmt(fs)}`, "right");
    }

    // Trim Out (red)
    if (coX >= 0 && coX <= W) {
      ctx.save();
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2;
      ctx.shadowColor = "#ef4444"; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.moveTo(coX, 0); ctx.lineTo(coX, H); ctx.stroke();
      ctx.restore();
      drawFlag(ctx, coX, 52, "#ef4444", `OUT ▶ ${fmt(co)}`, "left");
    }

    // Playhead
    ctx.save();
    ctx.strokeStyle = "#f43f5e"; ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f43f5e"; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, H); ctx.stroke();
    // Diamond at top
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.moveTo(phX, 10); ctx.lineTo(phX - 5, 0); ctx.lineTo(phX + 5, 0);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }, []); // eslint-disable-line

  // Draw a flag label attached to a vertical marker
  function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, label: string, side: "left" | "right") {
    ctx.save();
    ctx.font = "bold 11px 'Courier New', monospace";
    const tw = ctx.measureText(label).width;
    const pad = 6, h = 18, w = tw + pad * 2;
    const lx = side === "right" ? x - w - 2 : x + 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    if (side === "right") {
      ctx.roundRect(lx, y, w, h, [3, 0, 0, 3]);
    } else {
      ctx.roundRect(lx, y, w, h, [0, 3, 3, 0]);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color === "#f59e0b" ? "#000" : "#fff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(label, lx + pad, y + h / 2);
    ctx.restore();
  }

  // Resize canvas
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) {
        canvas.width = w; canvas.height = 300; draw();
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  // Redraw on state changes
  useEffect(() => { if (open) draw(); }, [open, draw, cueIn, cueOut, segue, ct, zoom, pan, waveReady]);

  // RAF while playing
  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        ctRef.current = audio.currentTime;
        setCt(audio.currentTime);
        // Auto-scroll
        const d = durRef.current || 1;
        const ws = d / zoomRef.current;
        const end = panRef.current + ws;
        if (audio.currentTime > end - ws * 0.15) {
          const np = clamp(audio.currentTime - ws * 0.15, 0, d - ws);
          panRef.current = np; setPan(np);
        }
      }
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, draw]);

  // Load on open
  useEffect(() => {
    if (!open) { audioRef.current?.pause(); setPlaying(false); playingRef.current = false; return; }

    const ci = initialCuePoints.cueIn ?? 0;
    const co = initialCuePoints.cueOut ?? 0;
    const sg = initialCuePoints.segueDuration ?? 0;
    ciRef.current = ci; coRef.current = co; sgRef.current = sg;
    setCueIn(ci); setCueOut(co); setSegue(sg);
    ctRef.current = ci; setCt(ci);
    setPlaying(false); playingRef.current = false;
    durRef.current = 0; setDur(0);
    zoomRef.current = 1; setZoom(1);
    panRef.current = 0; setPan(0);
    setWaveReady(false);

    const audio = audioRef.current; if (!audio) return;
    const src = audioUrl || `/api/tracks/${trackId}/stream`;

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durRef.current = audio.duration; setDur(audio.duration);
      }
    };
    const onEnded = () => {
      setPlaying(false); playingRef.current = false;
      audio.currentTime = ciRef.current;
      ctRef.current = ciRef.current; setCt(ciRef.current);
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.src = src; audio.preload = "metadata"; audio.load();

    // Placeholder waveform
    const N = 600;
    const ph = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      ph[i] = Math.max(0, (0.35 + Math.sin(p * Math.PI * 14) * 0.18 + (Math.random() - 0.5) * 0.22)
        * Math.min(p * 8, 1) * Math.min((1 - p) * 8, 1));
    }
    waveRef.current = ph; draw();

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
          let s = 0; for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j]);
          out[i] = s / block; if (out[i] > mx) mx = out[i];
        }
        if (mx > 0) for (let i = 0; i < N; i++) out[i] /= mx;
        waveRef.current = out; setWaveReady(true);
      } catch (e) { console.warn("waveform:", e); }
    })();

    return () => {
      ctrl.abort();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [open]); // eslint-disable-line

  // ── Pointer handling ──────────────────────────────────────────────────────
  const THRESH = 12;

  const hitHandle = (x: number, W: number): "cueIn" | "cueOut" | "segue" | null => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const candidates: [number, "cueIn" | "cueOut" | "segue"][] = [
      [Math.abs(x - toX(ci, W)), "cueIn"],
      [Math.abs(x - toX(co, W)), "cueOut"],
      [Math.abs(x - toX(fs, W)), "segue"],
    ];
    candidates.sort((a, b) => a[0] - b[0]);
    return candidates[0][0] <= THRESH ? candidates[0][1] : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const h = hitHandle(x, rect.width);
    if (h) { dragRef.current = h; }
    else {
      // scrub
      const t = toSec(x, rect.width);
      ctRef.current = t; setCt(t);
      if (audioRef.current) audioRef.current.currentTime = t;
      draw();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    if (!dragRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const t = toSec(e.clientX - rect.left, rect.width);
    const d = durRef.current || 1;

    if (dragRef.current === "cueIn") {
      const n = clamp(t, 0, coRef.current);
      ciRef.current = n; setCueIn(n);
    } else if (dragRef.current === "cueOut") {
      const n = clamp(t, ciRef.current, d);
      coRef.current = n; setCueOut(n);
      sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current);
    } else if (dragRef.current === "segue") {
      const fs = clamp(t, ciRef.current, coRef.current);
      sgRef.current = coRef.current - fs; setSegue(sgRef.current);
    }
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  // Zoom with wheel
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const d = durRef.current || 1;
    const factor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
    const newZ = clamp(zoomRef.current * factor, 1, 32);
    const ws = d / newZ;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseT = toSec(e.clientX - rect.left, rect.width);
    const np = clamp(mouseT - (mouseT - panRef.current) / (zoomRef.current / newZ), 0, d - ws);
    zoomRef.current = newZ; panRef.current = np;
    setZoom(newZ); setPan(np); draw();
  };

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const doZoom = (newZ: number) => {
    const d = durRef.current || 1;
    const z = clamp(newZ, 1, 32);
    const ws = d / z;
    const center = ctRef.current;
    const np = clamp(center - ws / 2, 0, Math.max(0, d - ws));
    zoomRef.current = z; panRef.current = np;
    setZoom(z); setPan(np); draw();
  };

  const fitRegion = () => {
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current;
    const span = Math.max(co - ci, 0.5);
    const pad = span * 0.3;
    const ws = span + pad * 2;
    const z = clamp(d / ws, 1, 32);
    const actualWs = d / z;
    const np = clamp(ci - pad, 0, Math.max(0, d - actualWs));
    zoomRef.current = z; panRef.current = np;
    setZoom(z); setPan(np); draw();
  };

  // ── Playback ──────────────────────────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current; if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); playingRef.current = false; return; }
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    if (!audio.src || audio.src === window.location.href) { audio.src = src; audio.load(); }
    try { await audio.play(); setPlaying(true); playingRef.current = true; }
    catch (err: any) { toast({ title: "Playback failed", description: err?.message, variant: "destructive" }); }
  };

  const stop = () => {
    const audio = audioRef.current; if (!audio) return;
    audio.pause(); audio.currentTime = ciRef.current;
    ctRef.current = ciRef.current; setCt(ciRef.current);
    setPlaying(false); playingRef.current = false; draw();
  };

  const jumpTo = (t: number) => {
    const audio = audioRef.current; if (audio) audio.currentTime = t;
    ctRef.current = t; setCt(t); draw();
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const save = async () => {
    try {
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration: segue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Saved", description: "Cue points updated." });
      onSuccess?.(); setTimeout(() => onOpenChange(false), 300);
    } catch (e: any) { toast({ title: "Save failed", description: e?.message, variant: "destructive" }); }
  };

  const fadeStart = Math.max(cueIn, cueOut - segue);
  const d = dur || cueOut || 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[1400px] p-0 bg-[#12122a] border border-[#2a2a4a] shadow-2xl overflow-hidden">
        <div className="flex flex-col h-full">

          {/* ── Title bar ── */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#0e0e22] border-b border-[#2a2a4a]">
            <div className="flex items-center gap-4">
              <span className="text-[11px] font-bold text-[#4a4a8a] uppercase tracking-widest font-mono">Cue Editor</span>
              <span className="text-sm font-bold text-white font-mono truncate max-w-[400px]">{trackTitle}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <button onClick={() => doZoom(zoom / 2)} disabled={zoom <= 1}
                className="px-2.5 py-1 text-xs font-mono bg-[#1e1e3a] hover:bg-[#2a2a4a] text-[#6b6baa] hover:text-white border border-[#2a2a4a] rounded disabled:opacity-30 transition-colors">
                −
              </button>
              <span className="text-xs font-mono text-[#6b6baa] w-14 text-center">{zoom.toFixed(1)}× zoom</span>
              <button onClick={() => doZoom(zoom * 2)} disabled={zoom >= 32}
                className="px-2.5 py-1 text-xs font-mono bg-[#1e1e3a] hover:bg-[#2a2a4a] text-[#6b6baa] hover:text-white border border-[#2a2a4a] rounded disabled:opacity-30 transition-colors">
                +
              </button>
              <button onClick={fitRegion}
                className="px-3 py-1 text-xs font-mono bg-[#1e1e3a] hover:bg-[#2a2a4a] text-cyan-400 hover:text-cyan-300 border border-[#2a2a4a] rounded transition-colors">
                Fit Region
              </button>
              <button onClick={() => doZoom(1)}
                className="px-3 py-1 text-xs font-mono bg-[#1e1e3a] hover:bg-[#2a2a4a] text-[#6b6baa] hover:text-white border border-[#2a2a4a] rounded transition-colors">
                Full
              </button>
            </div>
          </div>

          {/* ── Transport bar ── */}
          <div className="flex items-center gap-4 px-5 py-2.5 bg-[#0e0e22] border-b border-[#2a2a4a]">
            {/* Stop */}
            <button onClick={stop}
              className="w-8 h-8 flex items-center justify-center bg-[#1e1e3a] hover:bg-[#2a2a4a] border border-[#3a3a5a] rounded text-[#6b6baa] hover:text-white transition-colors">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect width="12" height="12" rx="1"/></svg>
            </button>
            {/* Play/Pause */}
            <button onClick={togglePlay}
              className={`w-10 h-10 flex items-center justify-center rounded border transition-colors ${playing ? "bg-amber-500/20 border-amber-500 text-amber-400 hover:bg-amber-500/30" : "bg-cyan-500/20 border-cyan-500 text-cyan-400 hover:bg-cyan-500/30"}`}>
              {playing
                ? <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="4" height="12" rx="1"/><rect x="9" y="1" width="4" height="12" rx="1"/></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><polygon points="2,1 13,7 2,13"/></svg>}
            </button>
            {/* Timecode */}
            <div className="font-mono text-2xl text-white tracking-widest tabular-nums select-none w-32">
              {fmt(ct)}
            </div>
            <div className="font-mono text-sm text-[#4a4a8a] tabular-nums">/ {fmt(d)}</div>
            <div className="flex-1" />
            {/* Jump buttons */}
            <button onClick={() => jumpTo(cueIn)}
              className="px-3 py-1.5 text-xs font-mono bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/50 rounded transition-colors">
              ◀ IN
            </button>
            <button onClick={() => jumpTo(fadeStart)}
              className="px-3 py-1.5 text-xs font-mono bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 border border-amber-800/50 rounded transition-colors">
              ↘ SEG
            </button>
            <button onClick={() => jumpTo(Math.max(0, cueOut - 3))}
              className="px-3 py-1.5 text-xs font-mono bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 rounded transition-colors">
              OUT ▶
            </button>
          </div>

          {/* ── Waveform ── */}
          <div className="px-0 bg-[#12122a]">
            <canvas
              ref={canvasRef}
              height={300}
              className="w-full block"
              style={{ cursor: "crosshair", touchAction: "none", userSelect: "none" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            />
          </div>

          {/* ── Cue point panels — Zetta-style left/center/right ── */}
          <div className="grid grid-cols-3 border-t border-[#2a2a4a]">

            {/* Cue In */}
            <div className="flex flex-col border-r border-[#2a2a4a] p-4 bg-[#0e1a0e]">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs font-bold text-green-400 font-mono uppercase tracking-wider">Trim In (Cue Start)</span>
              </div>
              <div className="font-mono text-3xl text-green-300 tracking-widest mb-3 tabular-nums">{fmt(cueIn)}</div>
              <input type="range" min={0} max={d} step={0.01} value={cueIn}
                onChange={e => { const n = clamp(+e.target.value, 0, coRef.current); ciRef.current = n; setCueIn(n); draw(); }}
                className="w-full accent-green-500 mb-2" />
              <NumField value={cueIn} accent="border-green-500 focus:ring-green-500/30"
                onChange={v => { const n = clamp(v, 0, coRef.current); ciRef.current = n; setCueIn(n); draw(); }} />
              <button onClick={() => { const t = ctRef.current; ciRef.current = clamp(t, 0, coRef.current); setCueIn(ciRef.current); draw(); }}
                className="mt-2 py-1 text-xs font-mono bg-green-900/30 hover:bg-green-900/50 text-green-400 border border-green-800/40 rounded transition-colors">
                Set to Playhead
              </button>
            </div>

            {/* Segue */}
            <div className="flex flex-col border-r border-[#2a2a4a] p-4 bg-[#1a1500]">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="text-xs font-bold text-amber-400 font-mono uppercase tracking-wider">Segue Point</span>
              </div>
              <div className="font-mono text-3xl text-amber-300 tracking-widest mb-1 tabular-nums">{fmt(fadeStart)}</div>
              <div className="font-mono text-xs text-amber-700 mb-2">duration: {segue.toFixed(2)}s</div>
              <input type="range" min={0} max={Math.max(0, cueOut - cueIn)} step={0.01} value={segue}
                onChange={e => { const n = clamp(+e.target.value, 0, coRef.current - ciRef.current); sgRef.current = n; setSegue(n); draw(); }}
                className="w-full accent-amber-500 mb-2" />
              <NumField value={segue} accent="border-amber-500 focus:ring-amber-500/30"
                onChange={v => { const n = clamp(v, 0, coRef.current - ciRef.current); sgRef.current = n; setSegue(n); draw(); }} />
              <button onClick={() => { const fs = clamp(ctRef.current, ciRef.current, coRef.current); sgRef.current = coRef.current - fs; setSegue(sgRef.current); draw(); }}
                className="mt-2 py-1 text-xs font-mono bg-amber-900/30 hover:bg-amber-900/50 text-amber-400 border border-amber-800/40 rounded transition-colors">
                Set to Playhead
              </button>
            </div>

            {/* Cue Out */}
            <div className="flex flex-col p-4 bg-[#1a0e0e]">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-xs font-bold text-red-400 font-mono uppercase tracking-wider">Trim Out (Cue End)</span>
              </div>
              <div className="font-mono text-3xl text-red-300 tracking-widest mb-3 tabular-nums">{fmt(cueOut)}</div>
              <input type="range" min={0} max={d} step={0.01} value={cueOut}
                onChange={e => { const n = clamp(+e.target.value, ciRef.current, d); coRef.current = n; setCueOut(n); sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current); draw(); }}
                className="w-full accent-red-500 mb-2" />
              <NumField value={cueOut} accent="border-red-500 focus:ring-red-500/30"
                onChange={v => { const n = clamp(v, ciRef.current, d); coRef.current = n; setCueOut(n); sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current); draw(); }} />
              <button onClick={() => { const n = clamp(ctRef.current, ciRef.current, durRef.current || 9999); coRef.current = n; setCueOut(n); sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current); draw(); }}
                className="mt-2 py-1 text-xs font-mono bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/40 rounded transition-colors">
                Set to Playhead
              </button>
            </div>
          </div>

          {/* ── Bottom bar ── */}
          <div className="flex items-center justify-between px-5 py-3 bg-[#0e0e22] border-t border-[#2a2a4a]">
            <div className="font-mono text-xs text-[#4a4a8a]">
              <span className="text-green-500">{fmt(cueIn)}</span>
              <span className="mx-2">→</span>
              <span className="text-red-400">{fmt(cueOut)}</span>
              <span className="mx-2 text-[#3a3a5a]">·</span>
              <span>active <span className="text-white">{fmt(cueOut - cueIn)}</span></span>
              <span className="mx-2 text-[#3a3a5a]">·</span>
              <span>segue <span className="text-amber-400">{segue.toFixed(2)}s</span></span>
            </div>
            <div className="flex gap-3">
              <button onClick={() => onOpenChange(false)}
                className="px-5 py-2 text-sm font-mono bg-[#1e1e3a] hover:bg-[#2a2a4a] text-[#6b6baa] hover:text-white border border-[#3a3a5a] rounded transition-colors">
                Cancel
              </button>
              <button onClick={save}
                className="px-8 py-2 text-sm font-bold font-mono bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors shadow-lg shadow-cyan-500/20">
                Save
              </button>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

function NumField({ value, accent, onChange }: { value: number; accent: string; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(value.toFixed(2));
  useEffect(() => { setLocal(value.toFixed(2)); }, [value]);
  const commit = () => { const n = parseFloat(local); if (!isNaN(n)) onChange(n); else setLocal(value.toFixed(2)); };
  return (
    <input type="number" value={local} step="0.01" min="0"
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === "Enter" && commit()}
      className={`w-full bg-[#0a0a1a] border-2 ${accent} rounded px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:ring-2`}
    />
  );
}
