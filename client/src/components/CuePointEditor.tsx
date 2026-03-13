import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

// ─── helpers ────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ─── types ───────────────────────────────────────────────────────────────────
interface CuePoints { cueIn: number; cueOut: number; segueDuration: number; }

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

// ─── NumField ────────────────────────────────────────────────────────────────
function NumField({
  value, onChange, accent,
}: { value: number; onChange: (v: number) => void; accent: string }) {
  const [local, setLocal] = useState(value.toFixed(2));
  useEffect(() => { setLocal(value.toFixed(2)); }, [value]);
  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(n);
    else setLocal(value.toFixed(2));
  };
  return (
    <input
      type="number" value={local} step="0.01" min="0"
      onChange={e => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => e.key === "Enter" && commit()}
      className={`w-full border rounded px-2 py-1 text-sm font-mono bg-white focus:outline-none focus:ring-2 ${accent}`}
    />
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function CuePointEditor({
  open, onOpenChange, trackId, trackTitle, audioUrl,
  initialCuePoints, onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  // ── audio ──
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    audioRef.current = new Audio();
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  // ── canvas refs ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // ── mutable refs (avoid stale closures in RAF/events) ──
  const durRef = useRef(0);
  const ciRef = useRef(0);
  const coRef = useRef(0);
  const sgRef = useRef(0);
  const ctRef = useRef(0);
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);
  const dragRef = useRef<"cueIn" | "cueOut" | "segue" | null>(null);
  const playingRef = useRef(false);

  // ── react state (for rendering) ──
  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(0);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [waveReady, setWaveReady] = useState(false);

  // keep refs in sync with state
  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  // ── coordinate helpers ──
  const winSize = () => (durRef.current || 1) / zoomRef.current;
  const toX = (sec: number, W: number) =>
    clamp(((sec - panRef.current) / winSize()) * W, 0, W);
  const toSec = (x: number, W: number) =>
    clamp(panRef.current + (x / W) * winSize(), 0, durRef.current || 1);

  // ─────────────────────────────────────────────────────────────────────────
  // OVERVIEW MINIMAP
  // ─────────────────────────────────────────────────────────────────────────
  const drawOverview = useCallback(() => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const d = durRef.current || 1;
    const wave = waveRef.current;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);

    // background
    ctx.fillStyle = "#e8edf2";
    ctx.fillRect(0, 0, W, H);

    // waveform bars
    if (wave) {
      for (let i = 0; i < wave.length; i++) {
        const sec = (i / wave.length) * d;
        const bh = Math.max(1, wave[i] * H * 0.85);
        const bw = W / wave.length;
        if (sec < ci || sec > co) ctx.fillStyle = "#b0bec5";
        else if (sec >= fs) ctx.fillStyle = "#ff9800";
        else ctx.fillStyle = "#1976d2";
        ctx.fillRect(i * bw, (H - bh) / 2, Math.max(1, bw - 0.3), bh);
      }
    }

    // cue region outline
    const ciX = (ci / d) * W, coX = (co / d) * W;
    ctx.strokeStyle = "rgba(25,118,210,0.6)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ciX, 1, coX - ciX, H - 2);

    // viewport box
    const ws = winSize();
    const vpX = (panRef.current / d) * W;
    const vpW = (ws / d) * W;
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(vpX, 0, vpW, H);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(vpX, 0, vpW, H);

    // playhead
    const phX = (ctRef.current / d) * W;
    ctx.strokeStyle = "#e53935";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, H); ctx.stroke();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN WAVEFORM CANVAS
  // ─────────────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const RULER_H = 28;
    const WAVE_H = H - RULER_H;
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const ph = ctRef.current;
    const wave = waveRef.current;
    const ws = winSize();

    // ── background ──
    ctx.fillStyle = "#f5f7fa";
    ctx.fillRect(0, 0, W, H);

    const ciX = toX(ci, W), fsX = toX(fs, W), coX = toX(co, W), phX = toX(ph, W);

    // ── region fills ──
    // before cue-in: muted grey
    ctx.fillStyle = "rgba(180,190,200,0.25)";
    ctx.fillRect(0, 0, ciX, WAVE_H);
    // active region (cue-in → segue start): light blue tint
    ctx.fillStyle = "rgba(25,118,210,0.06)";
    ctx.fillRect(ciX, 0, fsX - ciX, WAVE_H);
    // fade region (segue start → cue-out): light amber tint
    ctx.fillStyle = "rgba(255,152,0,0.10)";
    ctx.fillRect(fsX, 0, coX - fsX, WAVE_H);
    // after cue-out: muted grey
    ctx.fillStyle = "rgba(180,190,200,0.25)";
    ctx.fillRect(coX, 0, W - coX, WAVE_H);

    // ── grid lines ──
    const tickSec = ws <= 5 ? 0.5 : ws <= 20 ? 1 : ws <= 60 ? 5 : ws <= 300 ? 10 : 30;
    const firstTick = Math.ceil(panRef.current / tickSec) * tickSec;
    ctx.strokeStyle = "rgba(0,0,0,0.07)";
    ctx.lineWidth = 1;
    for (let t = firstTick; t < panRef.current + ws; t += tickSec) {
      const x = toX(t, W);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WAVE_H); ctx.stroke();
    }

    // ── waveform bars ──
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
        const bh = Math.max(2, amp * (WAVE_H - 8) * 0.9);
        const x = i * bw;
        const y = (WAVE_H - bh) / 2;
        if (sec < ci || sec > co) ctx.fillStyle = "#90a4ae";
        else if (sec >= fs) ctx.fillStyle = "#fb8c00";
        else ctx.fillStyle = "#1e88e5";
        ctx.fillRect(x + 0.3, y, Math.max(1, bw - 0.6), bh);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // MARKER LINES — tall, clearly visible, with flag labels
    // Each marker is drawn at a different vertical band so they NEVER overlap
    // visually even when the times are close together:
    //   CUE IN   → green line, flag at top-left
    //   SEGUE    → amber dashed line, flag at mid-left
    //   CUE OUT  → red line, flag at top-right
    // ─────────────────────────────────────────────────────────────────────

    // shadow helper
    const shadow = (color: string) => {
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
    };

    // CUE IN — green
    if (ciX >= 0 && ciX <= W) {
      ctx.save();
      shadow("#2e7d32");
      ctx.strokeStyle = "#2e7d32";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(ciX, 0); ctx.lineTo(ciX, WAVE_H); ctx.stroke();
      ctx.restore();

      // flag
      ctx.save();
      ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
      const label = `▶ IN  ${fmt(ci)}`;
      const tw = ctx.measureText(label).width;
      const fw = tw + 10, fh = 20, fx = ciX + 3, fy = 6;
      ctx.fillStyle = "#2e7d32";
      ctx.beginPath();
      ctx.roundRect(fx, fy, fw, fh, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, fx + 5, fy + fh / 2);
      ctx.restore();
    }

    // SEGUE — amber dashed
    if (fsX >= 0 && fsX <= W) {
      ctx.save();
      shadow("#e65100");
      ctx.strokeStyle = "#e65100";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(fsX, 0); ctx.lineTo(fsX, WAVE_H); ctx.stroke();
      ctx.restore();

      // flag — placed at mid-height, flipped if near right edge
      ctx.save();
      ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
      const label = `↘ SEG  ${fmt(fs)}`;
      const tw = ctx.measureText(label).width;
      const fw = tw + 10, fh = 20;
      const flip = fsX > W * 0.72;
      const fx = flip ? fsX - fw - 3 : fsX + 3;
      const fy = WAVE_H / 2 - fh / 2;
      ctx.fillStyle = "#e65100";
      ctx.beginPath();
      ctx.roundRect(fx, fy, fw, fh, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, fx + 5, fy + fh / 2);
      ctx.restore();
    }

    // CUE OUT — red
    if (coX >= 0 && coX <= W) {
      ctx.save();
      shadow("#b71c1c");
      ctx.strokeStyle = "#c62828";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(coX, 0); ctx.lineTo(coX, WAVE_H); ctx.stroke();
      ctx.restore();

      // flag — right-aligned to line
      ctx.save();
      ctx.font = "bold 11px Segoe UI, Arial, sans-serif";
      const label = `OUT ■  ${fmt(co)}`;
      const tw = ctx.measureText(label).width;
      const fw = tw + 10, fh = 20;
      const fx = coX - fw - 3;
      const fy = 6;
      ctx.fillStyle = "#c62828";
      ctx.beginPath();
      ctx.roundRect(fx, fy, fw, fh, 3);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(label, fx + 5, fy + fh / 2);
      ctx.restore();
    }

    // ── playhead ──
    ctx.save();
    ctx.strokeStyle = "#e53935";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#e53935";
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, WAVE_H); ctx.stroke();
    ctx.fillStyle = "#e53935";
    ctx.beginPath();
    ctx.moveTo(phX - 6, 0);
    ctx.lineTo(phX + 6, 0);
    ctx.lineTo(phX, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // ── time ruler ──
    ctx.fillStyle = "#dde3ea";
    ctx.fillRect(0, WAVE_H, W, RULER_H);
    ctx.strokeStyle = "#b0bec5";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, WAVE_H); ctx.lineTo(W, WAVE_H); ctx.stroke();
    ctx.fillStyle = "#546e7a";
    ctx.font = "10px 'Segoe UI', Arial, monospace";
    ctx.textAlign = "center";
    for (let t = firstTick; t < panRef.current + ws; t += tickSec) {
      const x = toX(t, W);
      ctx.fillStyle = "#546e7a";
      ctx.fillText(fmt(t), x, WAVE_H + 18);
      ctx.strokeStyle = "#b0bec5";
      ctx.beginPath(); ctx.moveTo(x, WAVE_H); ctx.lineTo(x, WAVE_H + 6); ctx.stroke();
    }

    drawOverview();
  }, [drawOverview]); // eslint-disable-line

  // ── resize observers ──
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) { canvas.width = w; canvas.height = 280; draw(); }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  useEffect(() => {
    if (!open) return;
    const canvas = overviewRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) { canvas.width = w; canvas.height = 44; draw(); }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  // redraw on any state change
  useEffect(() => {
    if (open) draw();
  }, [open, draw, cueIn, cueOut, segue, ct, zoom, pan, waveReady]);

  // ── RAF loop during playback ──
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
        // auto-pan to keep playhead visible
        const d = durRef.current || 1;
        const ws = d / zoomRef.current;
        const end = panRef.current + ws;
        if (audio.currentTime > end - ws * 0.1) {
          const np = clamp(audio.currentTime - ws * 0.1, 0, Math.max(0, d - ws));
          panRef.current = np;
          setPan(np);
        }
      }
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, draw]);

  // ── load audio + waveform when dialog opens ──
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlaying(false);
      playingRef.current = false;
      return;
    }
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

    const audio = audioRef.current;
    if (!audio) return;
    const src = audioUrl || `/api/tracks/${trackId}/stream`;

    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durRef.current = audio.duration;
        setDur(audio.duration);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      playingRef.current = false;
      audio.currentTime = ciRef.current;
      ctRef.current = ciRef.current;
      setCt(ciRef.current);
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.src = src;
    audio.preload = "metadata";
    audio.load();

    // placeholder waveform
    const N = 800;
    const ph2 = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      ph2[i] = Math.max(0,
        (0.3 + Math.sin(p * Math.PI * 18) * 0.2 + (Math.random() - 0.5) * 0.25)
        * Math.min(p * 10, 1) * Math.min((1 - p) * 10, 1)
      );
    }
    waveRef.current = ph2;
    draw();

    // real waveform decode
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
      } catch (e) {
        console.warn("waveform decode:", e);
      }
    })();

    return () => {
      ctrl.abort();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [open]); // eslint-disable-line

  // ─────────────────────────────────────────────────────────────────────────
  // POINTER EVENTS
  // ─────────────────────────────────────────────────────────────────────────
  const THRESH = 12; // px hit zone around each marker

  const hitHandle = (x: number, W: number): "cueIn" | "cueOut" | "segue" | null => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const hits: [number, "cueIn" | "cueOut" | "segue"][] = [
      [Math.abs(x - toX(ci, W)), "cueIn"],
      [Math.abs(x - toX(co, W)), "cueOut"],
      [Math.abs(x - toX(fs, W)), "segue"],
    ];
    hits.sort((a, b) => a[0] - b[0]);
    return hits[0][0] <= THRESH ? hits[0][1] : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const h = hitHandle(x, rect.width);
    if (h) {
      dragRef.current = h;
    } else {
      // click = move playhead
      const t = toSec(x, rect.width);
      ctRef.current = t;
      setCt(t);
      if (audioRef.current) audioRef.current.currentTime = t;
      draw();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !dragRef.current) return;
    const rect = canvas.getBoundingClientRect();
    const t = toSec(e.clientX - rect.left, rect.width);
    const d = durRef.current || 1;
    if (dragRef.current === "cueIn") {
      const n = clamp(t, 0, coRef.current - 0.01);
      ciRef.current = n; setCueIn(n);
    } else if (dragRef.current === "cueOut") {
      const n = clamp(t, ciRef.current + 0.01, d);
      coRef.current = n; setCueOut(n);
      sgRef.current = clamp(sgRef.current, 0, n - ciRef.current);
      setSegue(sgRef.current);
    } else if (dragRef.current === "segue") {
      const fs = clamp(t, ciRef.current, coRef.current);
      sgRef.current = coRef.current - fs;
      setSegue(sgRef.current);
    }
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const d = durRef.current || 1;
    const factor = e.deltaY < 0 ? 1.5 : 1 / 1.5;
    const newZ = clamp(zoomRef.current * factor, 1, 64);
    const ws = d / newZ;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseT = toSec(e.clientX - rect.left, rect.width);
    const np = clamp(mouseT - (mouseT - panRef.current) / (zoomRef.current / newZ), 0, Math.max(0, d - ws));
    zoomRef.current = newZ; panRef.current = np;
    setZoom(newZ); setPan(np);
    draw();
  };

  const onOverviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overviewRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const d = durRef.current || 1;
    const t = clamp(((e.clientX - rect.left) / rect.width) * d, 0, d);
    const ws = winSize();
    const np = clamp(t - ws / 2, 0, d - ws);
    panRef.current = np; setPan(np); draw();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ZOOM / NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────
  const doZoom = (newZ: number) => {
    const d = durRef.current || 1;
    const z = clamp(newZ, 1, 64);
    const ws = d / z;
    const np = clamp(ctRef.current - ws / 2, 0, Math.max(0, d - ws));
    zoomRef.current = z; panRef.current = np;
    setZoom(z); setPan(np); draw();
  };

  const fitRegion = () => {
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current;
    const span = Math.max(co - ci, 0.5);
    const pad = span * 0.25;
    const ws = span + pad * 2;
    const z = clamp(d / ws, 1, 64);
    const actualWs = d / z;
    const np = clamp(ci - pad, 0, Math.max(0, d - actualWs));
    zoomRef.current = z; panRef.current = np;
    setZoom(z); setPan(np); draw();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSPORT
  // ─────────────────────────────────────────────────────────────────────────
  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      playingRef.current = false;
      return;
    }
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    if (!audio.src || audio.src === window.location.href || audio.src === "") {
      audio.src = src;
      audio.load();
    }
    try {
      await audio.play();
      setPlaying(true);
      playingRef.current = true;
    } catch (err: any) {
      toast({ title: "Playback failed", description: err?.message, variant: "destructive" });
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = ciRef.current;
    ctRef.current = ciRef.current;
    setCt(ciRef.current);
    setPlaying(false);
    playingRef.current = false;
    draw();
  };

  const jumpTo = (t: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
    ctRef.current = t;
    setCt(t);
    draw();
  };

  const setToPlayhead = (which: "cueIn" | "cueOut" | "segue") => {
    const t = ctRef.current;
    const d = durRef.current || 1;
    if (which === "cueIn") {
      const n = clamp(t, 0, coRef.current - 0.01);
      ciRef.current = n; setCueIn(n);
    } else if (which === "cueOut") {
      const n = clamp(t, ciRef.current + 0.01, d);
      coRef.current = n; setCueOut(n);
      sgRef.current = clamp(sgRef.current, 0, n - ciRef.current);
      setSegue(sgRef.current);
    } else {
      const fs = clamp(t, ciRef.current, coRef.current);
      sgRef.current = coRef.current - fs;
      setSegue(sgRef.current);
    }
    draw();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SAVE
  // ─────────────────────────────────────────────────────────────────────────
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
  const d = dur || cueOut || 1;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] w-[1300px] p-0 overflow-hidden"
        style={{
          background: "#f0f2f5",
          border: "1px solid #c8d0da",
          borderRadius: "8px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* ── TITLE BAR ── */}
        <div style={{
          background: "linear-gradient(to bottom, #e8ecf0, #dde2e8)",
          borderBottom: "1px solid #b8c0cc",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* icon */}
            <div style={{
              width: 28, height: 28, borderRadius: 4,
              background: "linear-gradient(135deg, #1976d2, #42a5f5)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
                <rect x="1" y="4" width="2" height="6" rx="1"/>
                <rect x="4" y="2" width="2" height="10" rx="1"/>
                <rect x="7" y="5" width="2" height="5" rx="1"/>
                <rect x="10" y="3" width="2" height="8" rx="1"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#607080", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Cue Point Editor
              </div>
              <div style={{ fontSize: 14, color: "#1a2535", fontWeight: 700, marginTop: 1 }}>
                {trackTitle}
              </div>
            </div>
          </div>

          {/* zoom controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "#607080", marginRight: 4 }}>Zoom:</span>
            <button onClick={() => doZoom(zoom / 1.5)} disabled={zoom <= 1}
              style={btnStyle("#fff", "#b8c0cc", zoom <= 1 ? "#ccc" : "#1976d2")}>−</button>
            <span style={{ fontSize: 12, color: "#334", fontWeight: 600, width: 60, textAlign: "center", fontFamily: "monospace" }}>
              {zoom.toFixed(1)}×
            </span>
            <button onClick={() => doZoom(zoom * 1.5)} disabled={zoom >= 64}
              style={btnStyle("#fff", "#b8c0cc", zoom >= 64 ? "#ccc" : "#1976d2")}>+</button>
            <button onClick={fitRegion}
              style={btnStyle("#e3f0fb", "#90c4e8", "#1976d2")}>Fit Region</button>
            <button onClick={() => doZoom(1)}
              style={btnStyle("#fff", "#b8c0cc", "#546e7a")}>Full View</button>
          </div>
        </div>

        {/* ── TRANSPORT BAR ── */}
        <div style={{
          background: "#e4e8ed",
          borderBottom: "1px solid #c0c8d4",
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}>
          {/* stop */}
          <button onClick={stop} title="Stop & Return to Cue In"
            style={{ ...transportBtn, background: "#fff", color: "#546e7a", border: "1px solid #b8c0cc" }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect width="10" height="10" rx="1.5"/>
            </svg>
          </button>

          {/* play/pause */}
          <button onClick={togglePlay} title={playing ? "Pause" : "Play"}
            style={{
              ...transportBtn,
              width: 40, height: 40,
              background: playing ? "#fff3e0" : "#e3f2fd",
              color: playing ? "#e65100" : "#1565c0",
              border: `1.5px solid ${playing ? "#ffb74d" : "#64b5f6"}`,
              fontSize: 16,
            }}>
            {playing
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <rect x="1" y="1" width="4" height="10" rx="1"/>
                  <rect x="7" y="1" width="4" height="10" rx="1"/>
                </svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <polygon points="2,1 11,6 2,11"/>
                </svg>
            }
          </button>

          {/* timecode */}
          <div style={{
            fontFamily: "'Courier New', Courier, monospace",
            fontSize: 22,
            fontWeight: 700,
            color: "#1a2535",
            background: "#fff",
            border: "1px solid #c0c8d4",
            borderRadius: 4,
            padding: "2px 12px",
            letterSpacing: "0.04em",
            minWidth: 120,
            textAlign: "center",
          }}>
            {fmt(ct)}
          </div>
          <div style={{ fontSize: 12, color: "#78909c", fontFamily: "monospace" }}>
            / {fmt(d)}
          </div>

          <div style={{ flex: 1 }}/>

          {/* jump buttons */}
          <button onClick={() => jumpTo(cueIn)} title="Jump to Cue In"
            style={jumpBtn("#e8f5e9", "#a5d6a7", "#2e7d32")}>▶ IN</button>
          <button onClick={() => jumpTo(fadeStart)} title="Jump to Segue"
            style={jumpBtn("#fff3e0", "#ffcc80", "#e65100")}>↘ SEG</button>
          <button onClick={() => jumpTo(Math.max(0, cueOut - 3))} title="Preview Cue Out"
            style={jumpBtn("#ffebee", "#ef9a9a", "#c62828")}>OUT ▶</button>
        </div>

        {/* ── WAVEFORM CANVAS ── */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <canvas
            ref={canvasRef}
            height={280}
            style={{
              width: "100%",
              display: "block",
              cursor: "crosshair",
              touchAction: "none",
              userSelect: "none",
              background: "#f5f7fa",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          />
          <div style={{
            position: "absolute",
            bottom: 30,
            right: 10,
            fontSize: 10,
            color: "#90a4ae",
            fontFamily: "monospace",
            pointerEvents: "none",
          }}>
            Drag markers · Scroll to zoom · Click to seek
          </div>
        </div>

        {/* ── OVERVIEW MINIMAP ── */}
        <canvas
          ref={overviewRef}
          height={44}
          style={{
            width: "100%",
            display: "block",
            cursor: "pointer",
            borderTop: "1px solid #c8d0da",
            background: "#e8edf2",
            flexShrink: 0,
          }}
          onClick={onOverviewClick}
        />

        {/* ── THREE CUE POINT PANELS ── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          borderTop: "1px solid #c8d0da",
          flexShrink: 0,
        }}>
          {/* CUE IN */}
          <CuePanel
            color="#2e7d32" lightBg="#f1f8f1" borderColor="#a5d6a7"
            label="CUE IN" icon="▶"
            timeDisplay={fmt(cueIn)}
            value={cueIn}
            max={d}
            sliderAccent="#2e7d32"
            inputAccent="border-green-400 focus:ring-green-300"
            onSlider={v => { const n = clamp(v, 0, coRef.current - 0.01); ciRef.current = n; setCueIn(n); draw(); }}
            onInput={v => { const n = clamp(v, 0, coRef.current - 0.01); ciRef.current = n; setCueIn(n); draw(); }}
            onSet={() => setToPlayhead("cueIn")}
          />

          {/* SEGUE */}
          <CuePanel
            color="#e65100" lightBg="#fff8f0" borderColor="#ffcc80"
            label="SEGUE START" icon="↘"
            timeDisplay={fmt(fadeStart)}
            subLabel={`${segue.toFixed(2)}s fade duration`}
            value={segue}
            max={Math.max(0.01, cueOut - cueIn)}
            sliderAccent="#e65100"
            inputAccent="border-orange-400 focus:ring-orange-300"
            onSlider={v => { const n = clamp(v, 0, coRef.current - ciRef.current); sgRef.current = n; setSegue(n); draw(); }}
            onInput={v => { const n = clamp(v, 0, coRef.current - ciRef.current); sgRef.current = n; setSegue(n); draw(); }}
            onSet={() => setToPlayhead("segue")}
            isSegue
          />

          {/* CUE OUT */}
          <CuePanel
            color="#c62828" lightBg="#fff5f5" borderColor="#ef9a9a"
            label="CUE OUT" icon="■"
            timeDisplay={fmt(cueOut)}
            value={cueOut}
            max={d}
            sliderAccent="#c62828"
            inputAccent="border-red-400 focus:ring-red-300"
            onSlider={v => { const n = clamp(v, ciRef.current + 0.01, d); coRef.current = n; setCueOut(n); sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current); draw(); }}
            onInput={v => { const n = clamp(v, ciRef.current + 0.01, d); coRef.current = n; setCueOut(n); sgRef.current = clamp(sgRef.current, 0, n - ciRef.current); setSegue(sgRef.current); draw(); }}
            onSet={() => setToPlayhead("cueOut")}
          />
        </div>

        {/* ── BOTTOM STATUS + SAVE ── */}
        <div style={{
          background: "linear-gradient(to bottom, #e8ecf0, #dde2e8)",
          borderTop: "1px solid #b8c0cc",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", gap: 20, fontSize: 12, color: "#546e7a", fontFamily: "monospace" }}>
            <span>
              <span style={{ color: "#2e7d32", fontWeight: 700 }}>{fmt(cueIn)}</span>
              {" → "}
              <span style={{ color: "#c62828", fontWeight: 700 }}>{fmt(cueOut)}</span>
            </span>
            <span>Active: <strong style={{ color: "#1a2535" }}>{fmt(cueOut - cueIn)}</strong></span>
            <span>Segue: <strong style={{ color: "#e65100" }}>{segue.toFixed(2)}s</strong></span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => onOpenChange(false)}
              style={btnStyle("#fff", "#b8c0cc", "#546e7a", "8px 20px")}>
              Cancel
            </button>
            <button onClick={save}
              style={{
                padding: "7px 28px",
                background: "linear-gradient(to bottom, #1e88e5, #1565c0)",
                color: "#fff",
                border: "1px solid #1565c0",
                borderRadius: 5,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(21,101,192,0.3)",
              }}>
              Save Cue Points
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CuePanel sub-component
// ─────────────────────────────────────────────────────────────────────────────
function CuePanel({
  color, lightBg, borderColor, label, icon,
  timeDisplay, subLabel, value, max,
  sliderAccent, inputAccent,
  onSlider, onInput, onSet, isSegue,
}: {
  color: string; lightBg: string; borderColor: string;
  label: string; icon: string;
  timeDisplay: string; subLabel?: string;
  value: number; max: number;
  sliderAccent: string; inputAccent: string;
  onSlider: (v: number) => void;
  onInput: (v: number) => void;
  onSet: () => void;
  isSegue?: boolean;
}) {
  return (
    <div style={{
      padding: "14px 16px",
      background: lightBg,
      borderRight: `1px solid ${borderColor}`,
    }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: color,
            boxShadow: `0 0 0 2px ${borderColor}`,
          }}/>
          <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {icon} {label}
          </span>
        </div>
        <button onClick={onSet}
          style={{
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 600,
            background: "#fff",
            color,
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            cursor: "pointer",
          }}>
          ◉ Set
        </button>
      </div>

      {/* time display */}
      <div style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: 24,
        fontWeight: 700,
        color,
        marginBottom: 2,
        letterSpacing: "0.02em",
      }}>
        {timeDisplay}
      </div>
      {subLabel && (
        <div style={{ fontSize: 11, color: "#8d6e63", marginBottom: 6 }}>{subLabel}</div>
      )}

      {/* slider */}
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={e => onSlider(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: sliderAccent, marginBottom: 8, marginTop: isSegue ? 6 : 2 }}
      />

      {/* numeric input */}
      <NumField value={value} accent={inputAccent} onChange={onInput} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Style helpers
// ─────────────────────────────────────────────────────────────────────────────
function btnStyle(bg: string, border: string, color: string, padding = "5px 12px"): React.CSSProperties {
  return {
    padding,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 4,
    color,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

const transportBtn: React.CSSProperties = {
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 5,
  cursor: "pointer",
  border: "1px solid #b8c0cc",
};

function jumpBtn(bg: string, border: string, color: string): React.CSSProperties {
  return {
    padding: "5px 12px",
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 4,
    color,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "monospace",
  };
}
