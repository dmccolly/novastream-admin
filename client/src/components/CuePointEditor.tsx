import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

// ─── helpers ─────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ─── types ────────────────────────────────────────────────────────────────────
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CuePointEditor({
  open, onOpenChange, trackId, trackTitle, audioUrl,
  initialCuePoints, onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  // ── audio ──
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // ── canvas ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // ── mutable refs (avoid stale closures in RAF/events) ──
  const durRef = useRef(0);
  const ciRef = useRef(0);
  const coRef = useRef(0);
  const sgRef = useRef(0);   // segue duration (seconds before cueOut)
  const ctRef = useRef(0);
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);
  const dragRef = useRef<"cueIn" | "cueOut" | "segue" | "playhead" | null>(null);
  const playingRef = useRef(false);
  const hasFadeRef = useRef(true);

  // ── react state ──
  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(0);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasFade, setHasFade] = useState(true);
  const [saving, setSaving] = useState(false);

  // keep refs in sync
  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { hasFadeRef.current = hasFade; }, [hasFade]);

  // ── coordinate helpers ──
  const winSize = useCallback(() => (durRef.current || 1) / zoomRef.current, []);
  const toX = useCallback((sec: number, W: number) =>
    ((sec - panRef.current) / winSize()) * W, [winSize]);
  const toSec = useCallback((x: number, W: number) =>
    clamp(panRef.current + (x / W) * winSize(), 0, durRef.current || 1), [winSize]);

  // ─── DRAW ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const d = durRef.current || 1;
    const wave = waveRef.current;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fadeStart = co - sg;  // where the fade begins
    const ph = ctRef.current;
    const hasFd = hasFadeRef.current;

    // ── background ──
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, W, H);

    // ── waveform ──
    if (wave && wave.length > 0) {
      const ws = winSize();
      const startSec = panRef.current;
      const endSec = startSec + ws;
      const samplesPerPx = wave.length / d;

      for (let px = 0; px < W; px++) {
        const sec = startSec + (px / W) * ws;
        if (sec < 0 || sec > d) continue;
        const si = Math.floor(sec * samplesPerPx);
        const amp = wave[Math.min(si, wave.length - 1)] || 0;
        const bh = Math.max(2, amp * (H - 32) * 0.9);
        const by = (H - 32 - bh) / 2;

        // color: outside cue region = dark grey, active = blue, fade zone = red
        if (sec < ci || sec > co) {
          ctx.fillStyle = "#2d3561";
        } else if (hasFd && sec >= fadeStart && fadeStart < co) {
          // fade zone — gradient from blue to red
          const t = (sec - fadeStart) / Math.max(0.001, co - fadeStart);
          const r = Math.round(25 + t * 200);
          const g = Math.round(118 - t * 100);
          const b = Math.round(210 - t * 180);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = "#4a9eff";
        }
        ctx.fillRect(px, by, 1, bh);
      }
    } else {
      // no waveform yet — draw placeholder bars
      ctx.fillStyle = "#2d3561";
      for (let px = 0; px < W; px += 3) {
        const bh = 20 + Math.sin(px * 0.08) * 15 + Math.random() * 5;
        ctx.fillRect(px, (H - 32 - bh) / 2, 2, bh);
      }
    }

    // ── timeline ruler ──
    ctx.fillStyle = "#0d0d1a";
    ctx.fillRect(0, H - 32, W, 32);
    ctx.fillStyle = "#555";
    ctx.fillRect(0, H - 33, W, 1);

    const ws = winSize();
    const startSec = panRef.current;
    // pick a tick interval
    const rawInterval = ws / 10;
    const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const tickInterval = intervals.find(i => i >= rawInterval) || 300;

    ctx.fillStyle = "#888";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    const firstTick = Math.ceil(startSec / tickInterval) * tickInterval;
    for (let t = firstTick; t <= startSec + ws + tickInterval; t += tickInterval) {
      const x = toX(t, W);
      if (x < 0 || x > W) continue;
      ctx.fillStyle = "#444";
      ctx.fillRect(x, H - 32, 1, 8);
      ctx.fillStyle = "#888";
      ctx.fillText(fmt(t), x, H - 8);
    }

    // ── fade region overlay ──
    if (hasFd && fadeStart < co && fadeStart >= ci) {
      const fsX = toX(fadeStart, W);
      const coX = toX(co, W);
      if (coX > fsX) {
        const grad = ctx.createLinearGradient(fsX, 0, coX, 0);
        grad.addColorStop(0, "rgba(220, 80, 20, 0)");
        grad.addColorStop(1, "rgba(220, 80, 20, 0.25)");
        ctx.fillStyle = grad;
        ctx.fillRect(fsX, 0, coX - fsX, H - 32);
      }
    }

    // ── marker lines ──
    const drawMarker = (
      sec: number,
      color: string,
      label: string,
      labelSide: "left" | "right"
    ) => {
      const x = toX(sec, W);
      if (x < -2 || x > W + 2) return;
      // line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H - 32);
      ctx.stroke();

      // triangle handle at top
      ctx.fillStyle = color;
      ctx.beginPath();
      if (labelSide === "left") {
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 14, 0);
        ctx.lineTo(x, 14);
      } else {
        ctx.moveTo(x, 0);
        ctx.lineTo(x - 14, 0);
        ctx.lineTo(x, 14);
      }
      ctx.closePath();
      ctx.fill();

      // label
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px sans-serif";
      ctx.textAlign = labelSide === "left" ? "left" : "right";
      const lx = labelSide === "left" ? x + 3 : x - 3;
      ctx.fillText(label, lx, 11);
    };

    // segue marker (dashed orange)
    if (hasFd) {
      const sgX = toX(fadeStart, W);
      if (sgX >= -2 && sgX <= W + 2) {
        ctx.strokeStyle = "#ff9800";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sgX, 0);
        ctx.lineTo(sgX, H - 32);
        ctx.stroke();
        ctx.setLineDash([]);
        // triangle
        ctx.fillStyle = "#ff9800";
        ctx.beginPath();
        ctx.moveTo(sgX - 7, 0);
        ctx.lineTo(sgX + 7, 0);
        ctx.lineTo(sgX, 14);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("SEG", sgX, 11);
      }
    }

    drawMarker(ci, "#00e676", "IN", "right");
    drawMarker(co, "#ff1744", "OUT", "left");

    // ── playhead ──
    const phX = toX(ph, W);
    if (phX >= 0 && phX <= W) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, H - 32);
      ctx.stroke();
      ctx.setLineDash([]);
      // playhead triangle
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(phX - 6, 0);
      ctx.lineTo(phX + 6, 0);
      ctx.lineTo(phX, 10);
      ctx.closePath();
      ctx.fill();
    }
  }, [toX, winSize]);

  // ── RAF loop ──
  const startRaf = useCallback(() => {
    const loop = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        const t = audio.currentTime;
        ctRef.current = t;
        setCt(t);

        // ── Real-time fade via GainNode ──
        const gainNode = gainNodeRef.current;
        const ac = audioCtxRef.current;
        if (gainNode && ac && hasFadeRef.current) {
          const co = coRef.current;
          const fadeStart = co - sgRef.current;
          if (t >= fadeStart && t < co && sgRef.current > 0) {
            // linearly ramp gain from 1 → 0 over the fade zone
            const progress = (t - fadeStart) / sgRef.current;
            gainNode.gain.setValueAtTime(
              Math.max(0, 1 - progress),
              ac.currentTime
            );
          } else if (t < fadeStart) {
            // before fade zone: full volume
            gainNode.gain.setValueAtTime(1.0, ac.currentTime);
          }
        }

        // auto-stop at cueOut
        if (t >= coRef.current) {
          audio.pause();
          // reset gain for next play
          if (gainNodeRef.current && audioCtxRef.current) {
            gainNodeRef.current.gain.setValueAtTime(1.0, audioCtxRef.current.currentTime);
          }
          setPlaying(false);
          playingRef.current = false;
        }
      }
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [draw]);

  // ─── LOAD AUDIO + WAVEFORM ────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !audioUrl) return;

    // reset
    waveRef.current = null;
    setWaveReady(false);
    setLoading(true);
    durRef.current = 0;
    setDur(0);

    const ci = initialCuePoints.cueIn ?? 0;
    const sg = initialCuePoints.segueDuration ?? 3;
    const co = initialCuePoints.cueOut ?? 0;
    ciRef.current = ci; setCueIn(ci);
    coRef.current = co; setCueOut(co);
    sgRef.current = sg; setSegue(sg);
    ctRef.current = ci; setCt(ci);
    zoomRef.current = 1; setZoom(1);
    panRef.current = 0; setPan(0);

    // create audio element + Web Audio API chain for real-time fade
    const audio = new Audio();
    audioRef.current = audio;
    audio.crossOrigin = "anonymous";
    audio.src = audioUrl;
    audio.preload = "auto";

    // Build: audio element -> MediaElementSource -> GainNode -> destination
    try {
      const ac = new (window.AudioContext || (window as any).webkitAudioContext)() as AudioContext;
      audioCtxRef.current = ac;
      const gainNode = ac.createGain();
      gainNode.gain.value = 1.0;
      gainNodeRef.current = gainNode;
      const src = ac.createMediaElementSource(audio);
      sourceNodeRef.current = src;
      src.connect(gainNode);
      gainNode.connect(ac.destination);
    } catch (e) {
      // Web Audio API not available - fall back to plain audio
      console.warn("Web Audio API unavailable:", e);
    }

    // decode waveform
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(audioUrl, { signal: ctrl.signal });
        const buf = await resp.arrayBuffer();
        if (ctrl.signal.aborted) return;
        const ac = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ac.decodeAudioData(buf);
        if (ctrl.signal.aborted) return;
        const d = decoded.duration;
        durRef.current = d;
        setDur(d);

        // downsample to ~2000 samples
        const ch = decoded.getChannelData(0);
        const N = 2000;
        const step = Math.floor(ch.length / N);
        const wave = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          let mx = 0;
          for (let j = 0; j < step; j++) {
            const v = Math.abs(ch[i * step + j] || 0);
            if (v > mx) mx = v;
          }
          wave[i] = mx;
        }
        waveRef.current = wave;
        setWaveReady(true);
        setLoading(false);
        ac.close();

        // fit view to cue region with some padding
        const pad = Math.max(1, (co - ci) * 0.15);
        const regionDur = (co - ci) + pad * 2;
        const newZoom = clamp(d / regionDur, 1, 20);
        const newPan = clamp(ci - pad, 0, d - d / newZoom);
        zoomRef.current = newZoom; setZoom(newZoom);
        panRef.current = newPan; setPan(newPan);
      } catch (e: any) {
        if (e.name !== "AbortError") {
          setLoading(false);
          setWaveReady(false);
        }
      }
    })();

    startRaf();

    return () => {
      ctrl.abort();
      audio.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Clean up Web Audio nodes
      try {
        sourceNodeRef.current?.disconnect();
        gainNodeRef.current?.disconnect();
        audioCtxRef.current?.close();
      } catch (_) {}
      sourceNodeRef.current = null;
      gainNodeRef.current = null;
      audioCtxRef.current = null;
    };
  }, [open, audioUrl]);

  // resize canvas when dialog opens
  useEffect(() => {
    if (!open) return;
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    const t = setTimeout(resize, 50);
    window.addEventListener("resize", resize);
    return () => { clearTimeout(t); window.removeEventListener("resize", resize); };
  }, [open]);

  // ─── MOUSE INTERACTION ────────────────────────────────────────────────────
  const getHit = useCallback((x: number, W: number): "cueIn" | "cueOut" | "segue" | null => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fadeStart = co - sg;
    const ciX = toX(ci, W);
    const coX = toX(co, W);
    const sgX = toX(fadeStart, W);
    const HIT = 10;
    if (Math.abs(x - ciX) < HIT) return "cueIn";
    if (Math.abs(x - coX) < HIT) return "cueOut";
    if (hasFadeRef.current && Math.abs(x - sgX) < HIT) return "segue";
    return null;
  }, [toX]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = canvas.width;
    const hit = getHit(x, W);
    if (hit) {
      dragRef.current = hit;
      e.preventDefault();
    } else {
      // click to seek
      const sec = toSec(x, W);
      ctRef.current = sec; setCt(sec);
      if (audioRef.current) audioRef.current.currentTime = sec;
    }
  }, [getHit, toSec]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const W = canvas.width;
    const d = durRef.current || 1;

    // cursor
    const hit = getHit(x, W);
    canvas.style.cursor = hit ? "ew-resize" : "crosshair";

    if (!dragRef.current) return;
    const sec = toSec(x, W);

    if (dragRef.current === "cueIn") {
      const v = clamp(sec, 0, coRef.current - 0.1);
      ciRef.current = v; setCueIn(v);
    } else if (dragRef.current === "cueOut") {
      const v = clamp(sec, ciRef.current + 0.1, d);
      coRef.current = v; setCueOut(v);
    } else if (dragRef.current === "segue") {
      // segue marker = fadeStart = co - sg
      // dragging it changes sg = co - fadeStart
      const fadeStart = clamp(sec, ciRef.current, coRef.current - 0.05);
      const newSg = coRef.current - fadeStart;
      sgRef.current = newSg; setSegue(newSg);
    }
  }, [getHit, toSec]);

  const onMouseUp = useCallback(() => { dragRef.current = null; }, []);

  // scroll to zoom
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const d = durRef.current || 1;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const W = canvas.width;
    const focusSec = toSec(mx, W);

    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const newZoom = clamp(zoomRef.current * factor, 1, 40);
    const newWs = d / newZoom;
    const newPan = clamp(focusSec - (mx / W) * newWs, 0, d - newWs);
    zoomRef.current = newZoom; setZoom(newZoom);
    panRef.current = newPan; setPan(newPan);
  }, [toSec]);

  // ─── TRANSPORT ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      // Resume AudioContext if suspended (browser autoplay policy)
      const ac = audioCtxRef.current;
      if (ac && ac.state === "suspended") ac.resume();

      if (ctRef.current >= coRef.current) {
        audio.currentTime = ciRef.current;
        ctRef.current = ciRef.current;
      }
      // Reset gain to full before starting playback
      if (gainNodeRef.current && ac) {
        gainNodeRef.current.gain.cancelScheduledValues(ac.currentTime);
        gainNodeRef.current.gain.setValueAtTime(1.0, ac.currentTime);
      }
      audio.play().catch(() => {});
      setPlaying(true);
      playingRef.current = true;
    } else {
      audio.pause();
      // Reset gain when pausing
      const ac = audioCtxRef.current;
      if (gainNodeRef.current && ac) {
        gainNodeRef.current.gain.cancelScheduledValues(ac.currentTime);
        gainNodeRef.current.gain.setValueAtTime(1.0, ac.currentTime);
      }
      setPlaying(false);
      playingRef.current = false;
    }
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    // Reset gain on stop
    const ac = audioCtxRef.current;
    if (gainNodeRef.current && ac) {
      gainNodeRef.current.gain.cancelScheduledValues(ac.currentTime);
      gainNodeRef.current.gain.setValueAtTime(1.0, ac.currentTime);
    }
    audio.currentTime = ciRef.current;
    ctRef.current = ciRef.current;
    setCt(ciRef.current);
    setPlaying(false);
    playingRef.current = false;
  }, []);

  const seekTo = useCallback((sec: number) => {
    const t = clamp(sec, 0, durRef.current || 1);
    ctRef.current = t; setCt(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }, []);

  // ─── ZOOM CONTROLS ───────────────────────────────────────────────────────
  const fitRegion = useCallback(() => {
    const d = durRef.current || 1;
    const ci = ciRef.current, co = coRef.current;
    const pad = Math.max(0.5, (co - ci) * 0.1);
    const regionDur = (co - ci) + pad * 2;
    const newZoom = clamp(d / regionDur, 1, 40);
    const newWs = d / newZoom;
    const newPan = clamp(ci - pad, 0, d - newWs);
    zoomRef.current = newZoom; setZoom(newZoom);
    panRef.current = newPan; setPan(newPan);
  }, []);

  const fullView = useCallback(() => {
    zoomRef.current = 1; setZoom(1);
    panRef.current = 0; setPan(0);
  }, []);

  // ─── SAVE ─────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration: hasFade ? segue : 0 }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Saved", description: `Cue points saved for "${trackTitle}"` });
      onSuccess?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const fadeStart = cueOut - segue;

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div style={{
        width: "min(1100px, 96vw)",
        background: "#12121f",
        borderRadius: 8,
        border: "1px solid #333",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "'Segoe UI', Arial, sans-serif",
      }}>

        {/* ── TITLE BAR ── */}
        <div style={{
          background: "#1e1e3a",
          borderBottom: "1px solid #333",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ color: "#4a9eff", fontSize: 13, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            Cue Editor
          </span>
          <span style={{ color: "#ccc", fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {trackTitle}
          </span>
          {dur > 0 && (
            <span style={{ color: "#888", fontSize: 12, fontFamily: "monospace" }}>
              {fmt(dur)}
            </span>
          )}
          <button
            onClick={() => onOpenChange(false)}
            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px" }}
          >
            ✕
          </button>
        </div>

        {/* ── TOOLBAR ── */}
        <div style={{
          background: "#16162a",
          borderBottom: "1px solid #2a2a45",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}>
          {/* Transport */}
          <button
            onClick={stop}
            title="Stop"
            style={btnStyle("#333", "#555")}
          >
            ■
          </button>
          <button
            onClick={togglePlay}
            title={playing ? "Pause" : "Play"}
            style={btnStyle(playing ? "#1a5a1a" : "#1a3a5a", playing ? "#2a8a2a" : "#2a5a8a")}
          >
            {playing ? "⏸" : "▶"}
          </button>

          <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />

          {/* Timecode */}
          <span style={{
            fontFamily: "monospace", fontSize: 16, fontWeight: 700,
            color: "#00e676", background: "#0a0a15", padding: "3px 10px",
            borderRadius: 4, border: "1px solid #1a3a1a", minWidth: 90, textAlign: "center",
          }}>
            {fmt(ct)}
          </span>

          <div style={{ width: 1, height: 24, background: "#333", margin: "0 4px" }} />

          {/* Jump buttons */}
          <button onClick={() => seekTo(cueIn)} title="Jump to Cue In" style={btnStyle("#1a2a1a", "#2a4a2a")}>
            <span style={{ color: "#00e676", fontWeight: 700, fontSize: 11 }}>▶ IN</span>
          </button>
          {hasFade && (
            <button onClick={() => seekTo(fadeStart)} title="Jump to Segue" style={btnStyle("#2a1a0a", "#4a3a1a")}>
              <span style={{ color: "#ff9800", fontWeight: 700, fontSize: 11 }}>▶ SEG</span>
            </button>
          )}
          <button onClick={() => seekTo(Math.max(0, cueOut - 3))} title="Jump near Cue Out" style={btnStyle("#2a0a0a", "#4a1a1a")}>
            <span style={{ color: "#ff1744", fontWeight: 700, fontSize: 11 }}>OUT ▶</span>
          </button>

          <div style={{ flex: 1 }} />

          {/* Zoom */}
          <button onClick={fitRegion} style={btnStyle("#222", "#444")} title="Fit cue region">
            <span style={{ fontSize: 11, color: "#aaa" }}>Fit Region</span>
          </button>
          <button onClick={fullView} style={btnStyle("#222", "#444")} title="Full view">
            <span style={{ fontSize: 11, color: "#aaa" }}>Full View</span>
          </button>
          <span style={{ color: "#666", fontSize: 11, fontFamily: "monospace" }}>
            {zoom.toFixed(1)}×
          </span>
        </div>

        {/* ── WAVEFORM CANVAS ── */}
        <div style={{ position: "relative", flex: "0 0 240px", background: "#1a1a2e" }}>
          {loading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#4a9eff", fontSize: 13, background: "rgba(18,18,31,0.8)", zIndex: 2,
            }}>
              Loading waveform…
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ display: "block", width: "100%", height: 240, cursor: "crosshair" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
          />
        </div>

        {/* ── HINT ── */}
        <div style={{
          background: "#0d0d1a", padding: "4px 12px",
          color: "#555", fontSize: 11, fontFamily: "monospace",
          borderTop: "1px solid #1a1a2e",
        }}>
          Drag markers to adjust • Scroll to zoom • Click to seek
        </div>

        {/* ── CUE POINT PANELS ── */}
        <div style={{
          background: "#16162a",
          borderTop: "1px solid #2a2a45",
          padding: "12px 16px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 12,
        }}>
          {/* CUE IN */}
          <CuePanel
            label="CUE IN"
            color="#00e676"
            value={cueIn}
            min={0}
            max={cueOut - 0.1}
            dur={dur}
            onChange={(v) => { ciRef.current = v; setCueIn(v); }}
            onSet={() => { const v = ctRef.current; ciRef.current = v; setCueIn(v); }}
          />

          {/* SEGUE */}
          <div style={{ opacity: hasFade ? 1 : 0.4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff9800" }} />
              <span style={{ color: "#ff9800", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>SEGUE / FADE</span>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasFade}
                  onChange={e => { setHasFade(e.target.checked); hasFadeRef.current = e.target.checked; }}
                  style={{ accentColor: "#ff9800" }}
                />
                <span style={{ color: "#888", fontSize: 10 }}>Enable</span>
              </label>
            </div>
            {hasFade && (
              <>
                <div style={{ color: "#ff9800", fontFamily: "monospace", fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 4 }}>
                  {fmt(fadeStart)}
                </div>
                <div style={{ color: "#666", fontSize: 10, textAlign: "center", marginBottom: 6 }}>
                  Fade duration: {segue.toFixed(2)}s
                </div>
                <input
                  type="range" min={0} max={Math.max(0, cueOut - cueIn)} step={0.01}
                  value={segue}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    sgRef.current = v; setSegue(v);
                  }}
                  style={{ width: "100%", accentColor: "#ff9800" }}
                />
                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  <input
                    type="number" value={segue.toFixed(2)} step="0.01" min="0"
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { sgRef.current = v; setSegue(v); } }}
                    style={numInputStyle("#ff9800")}
                  />
                  <button
                    onClick={() => { const fs = ctRef.current; const newSg = Math.max(0, coRef.current - fs); sgRef.current = newSg; setSegue(newSg); }}
                    style={setButtonStyle("#ff9800")}
                    title="Set segue at playhead"
                  >
                    ◉ Set
                  </button>
                </div>
              </>
            )}
          </div>

          {/* CUE OUT */}
          <CuePanel
            label="CUE OUT"
            color="#ff1744"
            value={cueOut}
            min={cueIn + 0.1}
            max={dur}
            dur={dur}
            onChange={(v) => { coRef.current = v; setCueOut(v); }}
            onSet={() => { const v = ctRef.current; coRef.current = v; setCueOut(v); }}
          />
        </div>

        {/* ── SAVE BAR ── */}
        <div style={{
          background: "#0d0d1a",
          borderTop: "1px solid #2a2a45",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
        }}>
          <button
            onClick={() => onOpenChange(false)}
            style={{
              background: "#222", border: "1px solid #444", color: "#aaa",
              padding: "7px 20px", borderRadius: 5, cursor: "pointer", fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saving ? "#1a3a5a" : "#1565c0",
              border: "1px solid #2a6aaa",
              color: "#fff",
              padding: "7px 28px",
              borderRadius: 5,
              cursor: saving ? "default" : "pointer",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {saving ? "Saving…" : "Save Cue Points"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CuePanel sub-component ───────────────────────────────────────────────────
function CuePanel({
  label, color, value, min, max, dur,
  onChange, onSet,
}: {
  label: string; color: string; value: number;
  min: number; max: number; dur: number;
  onChange: (v: number) => void; onSet: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <span style={{ color, fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>{label}</span>
      </div>
      <div style={{ color, fontFamily: "monospace", fontSize: 20, fontWeight: 700, textAlign: "center", marginBottom: 4 }}>
        {fmt(value)}
      </div>
      <div style={{ color: "#666", fontSize: 10, textAlign: "center", marginBottom: 6 }}>
        {dur > 0 ? `${((value / dur) * 100).toFixed(1)}% of track` : "—"}
      </div>
      <input
        type="range" min={min} max={max || 1} step={0.01}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color }}
      />
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        <input
          type="number" value={value.toFixed(2)} step="0.01" min={min}
          onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(clamp(v, min, max || 9999)); }}
          style={numInputStyle(color)}
        />
        <button onClick={onSet} style={setButtonStyle(color)} title={`Set ${label} at playhead`}>
          ◉ Set
        </button>
      </div>
    </div>
  );
}

// ─── style helpers ────────────────────────────────────────────────────────────
function btnStyle(bg: string, hoverBg: string): React.CSSProperties {
  return {
    background: bg, border: "1px solid #444", color: "#fff",
    padding: "4px 10px", borderRadius: 4, cursor: "pointer",
    fontSize: 14, lineHeight: 1.4, minWidth: 32, textAlign: "center",
  };
}

function numInputStyle(accentColor: string): React.CSSProperties {
  return {
    flex: 1, background: "#0a0a15", border: `1px solid ${accentColor}44`,
    color: accentColor, fontFamily: "monospace", fontSize: 13,
    padding: "4px 6px", borderRadius: 4, outline: "none", minWidth: 0,
  };
}

function setButtonStyle(accentColor: string): React.CSSProperties {
  return {
    background: `${accentColor}22`, border: `1px solid ${accentColor}66`,
    color: accentColor, fontFamily: "monospace", fontSize: 11,
    padding: "4px 8px", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap",
  };
}
