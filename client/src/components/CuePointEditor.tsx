"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
};

interface CuePoints { cueIn: number; cueOut: number; segueDuration: number; }
export interface CuePointEditorProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  trackId: string; trackTitle: string; audioUrl: string;
  initialCuePoints: CuePoints; trackType?: string; onSuccess?: () => void;
}

export default function CuePointEditor({ open, onOpenChange, trackId, trackTitle, audioUrl, initialCuePoints, onSuccess }: CuePointEditorProps) {
  const { toast } = useToast();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    audioRef.current = new Audio();
    return () => { audioRef.current?.pause(); audioRef.current = null; };
  }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const durRef = useRef(0);
  const ciRef = useRef(0);
  const coRef = useRef(0);
  const sgRef = useRef(0);
  const ctRef = useRef(0);
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);
  const dragRef = useRef<"cueIn"|"cueOut"|"segue"|null>(null);
  const playingRef = useRef(false);

  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(0);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [waveReady, setWaveReady] = useState(false);

  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const winSize = () => (durRef.current || 1) / zoomRef.current;

  const toX = (sec: number, W: number) => clamp(((sec - panRef.current) / winSize()) * W, 0, W);
  const toSec = (x: number, W: number) => clamp(panRef.current + (x / W) * winSize(), 0, durRef.current || 1);

  const drawOverview = useCallback(() => {
    const canvas = overviewRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const d = durRef.current || 1;
    const wave = waveRef.current;

    ctx.fillStyle = "#0a0a1a"; ctx.fillRect(0, 0, W, H);

    // Waveform
    if (wave) {
      const bw = W / wave.length;
      for (let i = 0; i < wave.length; i++) {
        const sec = (i / wave.length) * d;
        const bh = Math.max(1, wave[i] * H * 0.8);
        const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
        const fs = Math.max(ci, co - sg);
        ctx.fillStyle = sec < ci || sec > co ? "#1e1e3a" : sec >= fs ? "#92400e" : "#164e63";
        ctx.fillRect(i * bw, (H - bh) / 2, Math.max(1, bw - 0.5), bh);
      }
    }

    // Cue region highlight
    const ciX = (ciRef.current / d) * W;
    const coX = (coRef.current / d) * W;
    ctx.strokeStyle = "rgba(6,182,212,0.5)"; ctx.lineWidth = 1;
    ctx.strokeRect(ciX, 0, coX - ciX, H);

    // Viewport box
    const ws = winSize();
    const vpX = (panRef.current / d) * W;
    const vpW = (ws / d) * W;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(vpX, 0, vpW, H);
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1;
    ctx.strokeRect(vpX, 0, vpW, H);

    // Playhead
    const phX = (ctRef.current / d) * W;
    ctx.strokeStyle = "#f43f5e"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, H); ctx.stroke();
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const RULER_H = 24;
    const WAVE_H = H - RULER_H;
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fs = Math.max(ci, co - sg);
    const ph = ctRef.current;
    const wave = waveRef.current;
    const ws = winSize();

    ctx.fillStyle = "#0d0d1f"; ctx.fillRect(0, 0, W, H);

    const ciX = toX(ci, W), fsX = toX(fs, W), coX = toX(co, W), phX = toX(ph, W);

    // Region fills
    ctx.fillStyle = "#080812"; ctx.fillRect(0, 0, ciX, WAVE_H);
    ctx.fillStyle = "rgba(8,145,178,0.07)"; ctx.fillRect(ciX, 0, fsX - ciX, WAVE_H);
    ctx.fillStyle = "rgba(217,119,6,0.12)"; ctx.fillRect(fsX, 0, coX - fsX, WAVE_H);
    ctx.fillStyle = "#080812"; ctx.fillRect(coX, 0, W - coX, WAVE_H);

    // Grid lines
    ctx.strokeStyle = "#1a1a2e"; ctx.lineWidth = 1;
    const tickSec = ws <= 5 ? 0.5 : ws <= 20 ? 1 : ws <= 60 ? 5 : ws <= 300 ? 10 : 30;
    const firstTick = Math.ceil(panRef.current / tickSec) * tickSec;
    for (let t = firstTick; t < panRef.current + ws; t += tickSec) {
      const x = toX(t, W);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WAVE_H); ctx.stroke();
    }

    // Waveform bars
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
        const bh = Math.max(2, amp * (WAVE_H - 4) * 0.9);
        const x = i * bw;
        const y = (WAVE_H - bh) / 2;
        if (sec < ci || sec > co) ctx.fillStyle = "#1e1e40";
        else if (sec >= fs) ctx.fillStyle = "#b45309";
        else ctx.fillStyle = "#0e7490";
        ctx.fillRect(x + 0.3, y, Math.max(1, bw - 0.6), bh);
      }
    }

    // Marker lines — draw directly on waveform, no handles needed
    // Just click within 10px of the line to drag it
    const drawMarker = (x: number, color: string, dashed = false) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      if (dashed) ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WAVE_H); ctx.stroke();
      ctx.restore();
    };

    if (ciX >= 0 && ciX <= W) drawMarker(ciX, "#22c55e");
    if (fsX >= 0 && fsX <= W) drawMarker(fsX, "#f59e0b", true);
    if (coX >= 0 && coX <= W) drawMarker(coX, "#ef4444");

    // Flag labels — attached to top of each marker
    const drawFlag = (x: number, color: string, label: string, flip = false) => {
      ctx.save();
      ctx.font = "bold 11px 'Courier New', monospace";
      const tw = ctx.measureText(label).width;
      const pad = 5, fh = 17, fw = tw + pad * 2;
      const fx = flip ? x - fw - 1 : x + 1;
      const fy = 4;
      ctx.fillStyle = color; ctx.globalAlpha = 0.92;
      ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color === "#f59e0b" ? "#000" : "#fff";
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.fillText(label, fx + pad, fy + fh / 2);
      ctx.restore();
    };

    if (ciX >= 0 && ciX <= W) drawFlag(ciX, "#22c55e", `IN ${fmt(ci)}`);
    if (fsX >= 0 && fsX <= W) drawFlag(fsX, "#f59e0b", `SEG ${fmt(fs)}`, fsX > W * 0.7);
    if (coX >= 0 && coX <= W) drawFlag(coX, "#ef4444", `OUT ${fmt(co)}`, true);

    // Playhead
    ctx.save();
    ctx.strokeStyle = "#f43f5e"; ctx.lineWidth = 1.5; ctx.shadowColor = "#f43f5e"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(phX, 0); ctx.lineTo(phX, WAVE_H); ctx.stroke();
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath(); ctx.moveTo(phX - 5, 0); ctx.lineTo(phX + 5, 0); ctx.lineTo(phX, 8); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Time ruler
    ctx.fillStyle = "#111127"; ctx.fillRect(0, WAVE_H, W, RULER_H);
    ctx.strokeStyle = "#2a2a4a"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, WAVE_H); ctx.lineTo(W, WAVE_H); ctx.stroke();
    ctx.fillStyle = "#4a4a7a"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    for (let t = firstTick; t < panRef.current + ws; t += tickSec) {
      const x = toX(t, W);
      ctx.fillText(fmt(t), x, WAVE_H + 15);
      ctx.strokeStyle = "#2a2a4a";
      ctx.beginPath(); ctx.moveTo(x, WAVE_H); ctx.lineTo(x, WAVE_H + 5); ctx.stroke();
    }

    drawOverview();
  }, [drawOverview]); // eslint-disable-line

  // Resize
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) { canvas.width = w; canvas.height = 220; draw(); }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  useEffect(() => {
    if (!open) return;
    const canvas = overviewRef.current; if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.round(canvas.getBoundingClientRect().width);
      if (w > 0 && canvas.width !== w) { canvas.width = w; canvas.height = 48; draw(); }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [open, draw]);

  useEffect(() => { if (open) draw(); }, [open, draw, cueIn, cueOut, segue, ct, zoom, pan, waveReady]);

  useEffect(() => {
    if (!playing) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        ctRef.current = audio.currentTime; setCt(audio.currentTime);
        const d = durRef.current || 1, ws = d / zoomRef.current;
        const end = panRef.current + ws;
        if (audio.currentTime > end - ws * 0.15) {
          const np = clamp(audio.currentTime - ws * 0.15, 0, d - ws);
          panRef.current = np; setPan(np);
        }
      }
      draw(); rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, draw]);

  useEffect(() => {
    if (!open) { audioRef.current?.pause(); setPlaying(false); playingRef.current = false; return; }
    const ci = initialCuePoints.cueIn ?? 0, co = initialCuePoints.cueOut ?? 0, sg = initialCuePoints.segueDuration ?? 0;
    ciRef.current = ci; coRef.current = co; sgRef.current = sg;
    setCueIn(ci); setCueOut(co); setSegue(sg);
    ctRef.current = ci; setCt(ci);
    setPlaying(false); playingRef.current = false;
    durRef.current = 0; setDur(0);
    zoomRef.current = 1; setZoom(1); panRef.current = 0; setPan(0);
    setWaveReady(false);
    const audio = audioRef.current; if (!audio) return;
    const src = audioUrl || `/api/tracks/${trackId}/stream`;
    const onMeta = () => { if (Number.isFinite(audio.duration) && audio.duration > 0) { durRef.current = audio.duration; setDur(audio.duration); } };
    const onEnded = () => { setPlaying(false); playingRef.current = false; audio.currentTime = ciRef.current; ctRef.current = ciRef.current; setCt(ciRef.current); };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.src = src; audio.preload = "metadata"; audio.load();
    const N = 600, ph2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { const p = i/N; ph2[i] = Math.max(0,(0.3+Math.sin(p*Math.PI*14)*0.18+(Math.random()-0.5)*0.22)*Math.min(p*8,1)*Math.min((1-p)*8,1)); }
    waveRef.current = ph2; draw();
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(src, { signal: ctrl.signal }); if (!resp.ok) return;
        const buf = await resp.arrayBuffer();
        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const ac = new AC(); const decoded = await ac.decodeAudioData(buf); await ac.close();
        const raw = decoded.getChannelData(0), out = new Float32Array(N);
        const block = Math.floor(raw.length / N); let mx = 0;
        for (let i = 0; i < N; i++) { let s=0; for (let j=0;j<block;j++) s+=Math.abs(raw[i*block+j]); out[i]=s/block; if(out[i]>mx) mx=out[i]; }
        if (mx > 0) for (let i = 0; i < N; i++) out[i] /= mx;
        waveRef.current = out; setWaveReady(true);
      } catch (e) { console.warn("waveform:", e); }
    })();
    return () => { ctrl.abort(); audio.removeEventListener("loadedmetadata", onMeta); audio.removeEventListener("durationchange", onMeta); audio.removeEventListener("ended", onEnded); };
  }, [open]); // eslint-disable-line

  const THRESH = 10;
  const hitHandle = (x: number, W: number) => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current, fs = Math.max(ci, co - sg);
    const hits: [number, "cueIn"|"cueOut"|"segue"][] = [[Math.abs(x-toX(ci,W)),"cueIn"],[Math.abs(x-toX(co,W)),"cueOut"],[Math.abs(x-toX(fs,W)),"segue"]];
    hits.sort((a,b)=>a[0]-b[0]);
    return hits[0][0] <= THRESH ? hits[0][1] : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId); e.preventDefault();
    const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left;
    const h = hitHandle(x, rect.width);
    if (h) dragRef.current = h;
    else { const t = toSec(x, rect.width); ctRef.current = t; setCt(t); if (audioRef.current) audioRef.current.currentTime = t; draw(); }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas || !dragRef.current) return;
    const rect = canvas.getBoundingClientRect(), t = toSec(e.clientX - rect.left, rect.width), d = durRef.current || 1;
    if (dragRef.current === "cueIn") { const n = clamp(t,0,coRef.current); ciRef.current=n; setCueIn(n); }
    else if (dragRef.current === "cueOut") { const n=clamp(t,ciRef.current,d); coRef.current=n; setCueOut(n); sgRef.current=clamp(sgRef.current,0,n-ciRef.current); setSegue(sgRef.current); }
    else if (dragRef.current === "segue") { const fs=clamp(t,ciRef.current,coRef.current); sgRef.current=coRef.current-fs; setSegue(sgRef.current); }
    draw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => { dragRef.current=null; canvasRef.current?.releasePointerCapture(e.pointerId); };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const d = durRef.current||1, factor = e.deltaY<0?1.5:1/1.5;
    const newZ = clamp(zoomRef.current*factor,1,32), ws = d/newZ;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), mouseT = toSec(e.clientX-rect.left, rect.width);
    const np = clamp(mouseT-(mouseT-panRef.current)/(zoomRef.current/newZ),0,Math.max(0,d-ws));
    zoomRef.current=newZ; panRef.current=np; setZoom(newZ); setPan(np); draw();
  };

  // Click overview to navigate
  const onOverviewClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overviewRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), d = durRef.current||1;
    const t = clamp(((e.clientX-rect.left)/rect.width)*d, 0, d);
    const ws = winSize(), np = clamp(t - ws/2, 0, d-ws);
    panRef.current=np; setPan(np); draw();
  };

  const doZoom = (newZ: number) => {
    const d=durRef.current||1, z=clamp(newZ,1,32), ws=d/z;
    const np=clamp(ctRef.current-ws/2,0,Math.max(0,d-ws));
    zoomRef.current=z; panRef.current=np; setZoom(z); setPan(np); draw();
  };

  const fitRegion = () => {
    const d=durRef.current||1, ci=ciRef.current, co=coRef.current;
    const span=Math.max(co-ci,0.5), pad=span*0.3, ws=span+pad*2;
    const z=clamp(d/ws,1,32), actualWs=d/z, np=clamp(ci-pad,0,Math.max(0,d-actualWs));
    zoomRef.current=z; panRef.current=np; setZoom(z); setPan(np); draw();
  };

  const togglePlay = async () => {
    const audio=audioRef.current; if (!audio) return;
    if (playing) { audio.pause(); setPlaying(false); playingRef.current=false; return; }
    const src=audioUrl||`/api/tracks/${trackId}/stream`;
    if (!audio.src||audio.src===window.location.href) { audio.src=src; audio.load(); }
    try { await audio.play(); setPlaying(true); playingRef.current=true; }
    catch(err:any) { toast({title:"Playback failed",description:err?.message,variant:"destructive"}); }
  };

  const stop = () => {
    const audio=audioRef.current; if (!audio) return;
    audio.pause(); audio.currentTime=ciRef.current; ctRef.current=ciRef.current; setCt(ciRef.current);
    setPlaying(false); playingRef.current=false; draw();
  };

  const jumpTo = (t: number) => { const audio=audioRef.current; if(audio) audio.currentTime=t; ctRef.current=t; setCt(t); draw(); };

  const setToPlayhead = (which: "cueIn"|"cueOut"|"segue") => {
    const t=ctRef.current, d=durRef.current||1;
    if (which==="cueIn") { const n=clamp(t,0,coRef.current); ciRef.current=n; setCueIn(n); }
    else if (which==="cueOut") { const n=clamp(t,ciRef.current,d); coRef.current=n; setCueOut(n); sgRef.current=clamp(sgRef.current,0,n-ciRef.current); setSegue(sgRef.current); }
    else { const fs=clamp(t,ciRef.current,coRef.current); sgRef.current=coRef.current-fs; setSegue(sgRef.current); }
    draw();
  };

  const save = async () => {
    try {
      const res=await fetch(`/api/tracks/${trackId}/cuepoints`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({cueIn,cueOut,segueDuration:segue})});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({title:"Saved",description:"Cue points updated."}); onSuccess?.(); setTimeout(()=>onOpenChange(false),300);
    } catch(e:any) { toast({title:"Save failed",description:e?.message,variant:"destructive"}); }
  };

  const fadeStart = Math.max(cueIn, cueOut - segue);
  const d = dur || cueOut || 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[98vw] w-[1400px] p-0 bg-[#0d0d1f] border border-[#2a2a4a] shadow-2xl overflow-y-auto max-h-[95vh]">
        <div className="flex flex-col">

          {/* Title + zoom */}
          <div className="flex items-center justify-between px-5 py-2.5 bg-[#080818] border-b border-[#2a2a4a]">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[10px] font-bold text-[#3a3a6a] uppercase tracking-widest font-mono shrink-0">Cue Editor</span>
              <span className="text-sm font-bold text-white font-mono truncate">{trackTitle}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={()=>doZoom(zoom/2)} disabled={zoom<=1} className="px-2 py-1 text-xs font-mono bg-[#1a1a30] hover:bg-[#252540] text-[#6060a0] hover:text-white border border-[#2a2a4a] rounded disabled:opacity-30 transition-colors">−</button>
              <span className="text-xs font-mono text-[#5050a0] w-16 text-center tabular-nums">{zoom.toFixed(1)}× zoom</span>
              <button onClick={()=>doZoom(zoom*2)} disabled={zoom>=32} className="px-2 py-1 text-xs font-mono bg-[#1a1a30] hover:bg-[#252540] text-[#6060a0] hover:text-white border border-[#2a2a4a] rounded disabled:opacity-30 transition-colors">+</button>
              <button onClick={fitRegion} className="px-2.5 py-1 text-xs font-mono bg-[#1a1a30] hover:bg-[#252540] text-cyan-500 hover:text-cyan-300 border border-[#2a2a4a] rounded transition-colors">Fit</button>
              <button onClick={()=>doZoom(1)} className="px-2.5 py-1 text-xs font-mono bg-[#1a1a30] hover:bg-[#252540] text-[#6060a0] hover:text-white border border-[#2a2a4a] rounded transition-colors">Full</button>
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-3 px-5 py-2 bg-[#080818] border-b border-[#2a2a4a]">
            <button onClick={stop} className="w-7 h-7 flex items-center justify-center bg-[#1a1a30] hover:bg-[#252540] border border-[#3a3a5a] rounded text-[#6060a0] hover:text-white transition-colors">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1"/></svg>
            </button>
            <button onClick={togglePlay} className={`w-9 h-9 flex items-center justify-center rounded border transition-colors ${playing?"bg-amber-500/20 border-amber-500/60 text-amber-400":"bg-cyan-500/20 border-cyan-500/60 text-cyan-400"} hover:opacity-80`}>
              {playing
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="3.5" height="10" rx="1"/><rect x="7.5" y="1" width="3.5" height="10" rx="1"/></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg>}
            </button>
            <div className="font-mono text-2xl text-white tracking-widest tabular-nums select-none">{fmt(ct)}</div>
            <div className="font-mono text-xs text-[#404070] tabular-nums">/ {fmt(d)}</div>
            <div className="flex-1"/>
            <button onClick={()=>jumpTo(cueIn)} className="px-2.5 py-1 text-xs font-mono bg-green-950/60 hover:bg-green-900/60 text-green-400 border border-green-900/50 rounded transition-colors">▶ IN</button>
            <button onClick={()=>jumpTo(fadeStart)} className="px-2.5 py-1 text-xs font-mono bg-amber-950/60 hover:bg-amber-900/60 text-amber-400 border border-amber-900/50 rounded transition-colors">↘ SEG</button>
            <button onClick={()=>jumpTo(Math.max(0,cueOut-3))} className="px-2.5 py-1 text-xs font-mono bg-red-950/60 hover:bg-red-900/60 text-red-400 border border-red-900/50 rounded transition-colors">OUT ▶</button>
          </div>

          {/* Waveform */}
          <canvas ref={canvasRef} height={220} className="w-full block" style={{cursor:"crosshair",touchAction:"none",userSelect:"none"}}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}/>

          {/* Overview minimap */}
          <canvas ref={overviewRef} height={48} className="w-full block border-t border-[#1a1a30]" style={{cursor:"pointer"}} onClick={onOverviewClick}/>

          {/* Three panels */}
          <div className="grid grid-cols-3 border-t border-[#2a2a4a] divide-x divide-[#2a2a4a]">
            {/* Cue In */}
            <div className="p-4 bg-[#080f08]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-green-500"/><span className="text-[10px] font-bold text-green-600 font-mono uppercase tracking-widest">Trim In</span></div>
                <button onClick={()=>setToPlayhead("cueIn")} className="text-[10px] font-mono px-2 py-0.5 bg-green-950/50 hover:bg-green-900/50 text-green-500 border border-green-900/40 rounded transition-colors">SET</button>
              </div>
              <div className="font-mono text-2xl text-green-300 tabular-nums mb-2">{fmt(cueIn)}</div>
              <input type="range" min={0} max={d} step={0.01} value={cueIn} onChange={e=>{const n=clamp(+e.target.value,0,coRef.current);ciRef.current=n;setCueIn(n);draw();}} className="w-full accent-green-500 mb-2"/>
              <NumField value={cueIn} accent="border-green-700 focus:border-green-500" onChange={v=>{const n=clamp(v,0,coRef.current);ciRef.current=n;setCueIn(n);draw();}}/>
            </div>
            {/* Segue */}
            <div className="p-4 bg-[#0f0d04]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-amber-500"/><span className="text-[10px] font-bold text-amber-600 font-mono uppercase tracking-widest">Segue</span></div>
                <button onClick={()=>setToPlayhead("segue")} className="text-[10px] font-mono px-2 py-0.5 bg-amber-950/50 hover:bg-amber-900/50 text-amber-500 border border-amber-900/40 rounded transition-colors">SET</button>
              </div>
              <div className="font-mono text-2xl text-amber-300 tabular-nums mb-0.5">{fmt(fadeStart)}</div>
              <div className="font-mono text-xs text-amber-800 mb-2">{segue.toFixed(2)}s duration</div>
              <input type="range" min={0} max={Math.max(0.01,cueOut-cueIn)} step={0.01} value={segue} onChange={e=>{const n=clamp(+e.target.value,0,coRef.current-ciRef.current);sgRef.current=n;setSegue(n);draw();}} className="w-full accent-amber-500 mb-2"/>
              <NumField value={segue} accent="border-amber-700 focus:border-amber-500" onChange={v=>{const n=clamp(v,0,coRef.current-ciRef.current);sgRef.current=n;setSegue(n);draw();}}/>
            </div>
            {/* Cue Out */}
            <div className="p-4 bg-[#0f0808]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-red-500"/><span className="text-[10px] font-bold text-red-700 font-mono uppercase tracking-widest">Trim Out</span></div>
                <button onClick={()=>setToPlayhead("cueOut")} className="text-[10px] font-mono px-2 py-0.5 bg-red-950/50 hover:bg-red-900/50 text-red-500 border border-red-900/40 rounded transition-colors">SET</button>
              </div>
              <div className="font-mono text-2xl text-red-300 tabular-nums mb-2">{fmt(cueOut)}</div>
              <input type="range" min={0} max={d} step={0.01} value={cueOut} onChange={e=>{const n=clamp(+e.target.value,ciRef.current,d);coRef.current=n;setCueOut(n);sgRef.current=clamp(sgRef.current,0,n-ciRef.current);setSegue(sgRef.current);draw();}} className="w-full accent-red-500 mb-2"/>
              <NumField value={cueOut} accent="border-red-700 focus:border-red-500" onChange={v=>{const n=clamp(v,ciRef.current,d);coRef.current=n;setCueOut(n);sgRef.current=clamp(sgRef.current,0,n-ciRef.current);setSegue(sgRef.current);draw();}}/>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-5 py-2.5 bg-[#080818] border-t border-[#2a2a4a]">
            <div className="font-mono text-xs text-[#3a3a6a] space-x-3">
              <span><span className="text-green-500">{fmt(cueIn)}</span> → <span className="text-red-400">{fmt(cueOut)}</span></span>
              <span>active <span className="text-white">{fmt(cueOut-cueIn)}</span></span>
              <span>segue <span className="text-amber-400">{segue.toFixed(2)}s</span></span>
            </div>
            <div className="flex gap-2">
              <button onClick={()=>onOpenChange(false)} className="px-4 py-1.5 text-sm font-mono bg-[#1a1a30] hover:bg-[#252540] text-[#6060a0] hover:text-white border border-[#3a3a5a] rounded transition-colors">Cancel</button>
              <button onClick={save} className="px-7 py-1.5 text-sm font-bold font-mono bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors">Save</button>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}

function NumField({value,accent,onChange}:{value:number;accent:string;onChange:(v:number)=>void}) {
  const [local,setLocal]=useState(value.toFixed(2));
  useEffect(()=>{setLocal(value.toFixed(2));},[value]);
  const commit=()=>{const n=parseFloat(local);if(!isNaN(n))onChange(n);else setLocal(value.toFixed(2));};
  return <input type="number" value={local} step="0.01" min="0" onChange={e=>setLocal(e.target.value)} onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()} className={`w-full bg-[#080818] border ${accent} rounded px-3 py-1.5 text-sm font-mono text-white focus:outline-none focus:ring-1 focus:ring-offset-0 transition-colors`}/>;
}
