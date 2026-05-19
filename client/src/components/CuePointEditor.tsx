import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

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

const HIT = 24; // px — generous hit zone for markers
const CANVAS_H = 340; // px

export default function CuePointEditor({
  open, onOpenChange, trackId, trackTitle, audioUrl,
  initialCuePoints, onSuccess,
}: CuePointEditorProps) {
  const { toast } = useToast();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // mutable refs to avoid stale closures in RAF/events
  const durRef = useRef(0);
  const ciRef = useRef(0);
  const coRef = useRef(0);
  const sgRef = useRef(0);  // segue duration in seconds
  const ctRef = useRef(0);
  const waveRef = useRef<Float32Array | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef(0);
  const dragRef = useRef<"cueIn" | "cueOut" | "segue" | null>(null);
  const playingRef = useRef(false);
  const hasFadeRef = useRef(true);

  const [dur, setDur] = useState(0);
  const [cueIn, setCueIn] = useState(0);
  const [cueOut, setCueOut] = useState(0);
  const [segue, setSegue] = useState(3);
  const [ct, setCt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  const [waveReady, setWaveReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasFade, setHasFade] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => { ciRef.current = cueIn; }, [cueIn]);
  useEffect(() => { coRef.current = cueOut; }, [cueOut]);
  useEffect(() => { sgRef.current = segue; }, [segue]);
  useEffect(() => { ctRef.current = ct; }, [ct]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { hasFadeRef.current = hasFade; }, [hasFade]);

  const winSize = useCallback(() => (durRef.current || 1) / zoomRef.current, []);
  const toX = useCallback((sec: number, W: number) =>
    ((sec - panRef.current) / winSize()) * W, [winSize]);
  const toSec = useCallback((x: number, W: number) =>
    clamp(panRef.current + (x / W) * winSize(), 0, durRef.current || 1), [winSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const RULER_H = 36;
    const TRACK_H = H - RULER_H;
    const d = durRef.current || 1;
    const wave = waveRef.current;
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fadeStart = co - sg;
    const ph = ctRef.current;
    const hasFd = hasFadeRef.current;

    // background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, W, TRACK_H);

    // waveform
    if (wave && wave.length > 0) {
      const ws = winSize();
      const startSec = panRef.current;
      const samplesPerPx = wave.length / d;

      for (let px = 0; px < W; px++) {
        const sec = startSec + (px / W) * ws;
        if (sec < 0 || sec > d) continue;
        const si = Math.min(Math.floor(sec * samplesPerPx), wave.length - 1);
        const amp = wave[si] || 0;
        const bh = Math.max(2, amp * (TRACK_H - 8) * 0.88);
        const by = (TRACK_H - bh) / 2;

        if (sec < ci || sec > co) {
          ctx.fillStyle = "#1f2937";
        } else if (hasFd && sec >= fadeStart && fadeStart < co) {
          const t = (sec - fadeStart) / Math.max(0.001, co - fadeStart);
          const r = Math.round(74 + t * 181);
          const g = Math.round(222 - t * 190);
          const b = Math.round(128 - t * 128);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = "#3b82f6";
        }
        ctx.fillRect(px, by, 1, bh);
      }
    } else {
      ctx.fillStyle = "#1f2937";
      for (let px = 0; px < W; px += 3) {
        const bh = 20 + Math.sin(px * 0.08) * 15;
        ctx.fillRect(px, (TRACK_H - bh) / 2, 2, bh);
      }
    }

    // fade overlay
    if (hasFd && fadeStart < co && fadeStart >= ci) {
      const fsX = toX(fadeStart, W);
      const coX = toX(co, W);
      if (coX > fsX) {
        const grad = ctx.createLinearGradient(fsX, 0, coX, 0);
        grad.addColorStop(0, "rgba(239,68,68,0)");
        grad.addColorStop(1, "rgba(239,68,68,0.22)");
        ctx.fillStyle = grad;
        ctx.fillRect(fsX, 0, coX - fsX, TRACK_H);
      }
    }

    // ruler background
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, TRACK_H, W, RULER_H);
    ctx.fillStyle = "#374151";
    ctx.fillRect(0, TRACK_H, W, 1);

    // ruler ticks
    const ws = winSize();
    const startSec = panRef.current;
    const rawInterval = ws / 10;
    const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const tickInterval = intervals.find(i => i >= rawInterval) || 300;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    const firstTick = Math.ceil(startSec / tickInterval) * tickInterval;
    for (let t = firstTick; t <= startSec + ws + tickInterval; t += tickInterval) {
      const x = toX(t, W);
      if (x < 0 || x > W) continue;
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(x, TRACK_H + 1, 1, 8);
      ctx.fillStyle = "#9ca3af";
      ctx.fillText(fmt(t), x, H - 6);
    }

    // draw marker with large visible handle
    const drawMarker = (sec: number, color: string, label: string, side: "left" | "right") => {
      const x = toX(sec, W);
      if (x < -2 || x > W + 2) return;

      // colored line
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, TRACK_H);
      ctx.stroke();

      // large filled handle bar at top
      const BAR_W = 52, BAR_H = 22;
      const bx = side === "right" ? x : x - BAR_W;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(bx, 0, BAR_W, BAR_H, 3);
      ctx.fill();

      // label text
      ctx.fillStyle = "#000";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, bx + BAR_W / 2, 15);
    };

    // segue marker
    if (hasFd) {
      const sgX = toX(fadeStart, W);
      if (sgX >= -2 && sgX <= W + 2) {
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(sgX, 0);
        ctx.lineTo(sgX, TRACK_H);
        ctx.stroke();
        ctx.setLineDash([]);
        // centered handle
        const BAR_W = 64, BAR_H = 22;
        ctx.fillStyle = "#f97316";
        ctx.beginPath();
        ctx.roundRect(sgX - BAR_W / 2, 0, BAR_W, BAR_H, 3);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`SEGUE ${sg.toFixed(1)}s`, sgX, 15);
      }
    }

    drawMarker(ci, "#22c55e", `IN  ${fmt(ci)}`, "right");
    drawMarker(co, "#ef4444", `OUT ${fmt(co)}`, "left");

    // playhead
    const phX = toX(ph, W);
    if (phX >= 0 && phX <= W) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, TRACK_H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(phX - 7, 0);
      ctx.lineTo(phX + 7, 0);
      ctx.lineTo(phX, 13);
      ctx.closePath();
      ctx.fill();
    }
  }, [toX, winSize]);

  const startRaf = useCallback(() => {
    const loop = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        const t = audio.currentTime;
        ctRef.current = t;
        setCt(t);

        const gainNode = gainNodeRef.current;
        const ac = audioCtxRef.current;
        if (gainNode && ac && hasFadeRef.current) {
          const co = coRef.current;
          const fadeStart = co - sgRef.current;
          if (t >= fadeStart && t < co && sgRef.current > 0) {
            const progress = (t - fadeStart) / sgRef.current;
            gainNode.gain.setValueAtTime(Math.max(0, 1 - progress), ac.currentTime);
          } else if (t < fadeStart) {
            gainNode.gain.setValueAtTime(1.0, ac.currentTime);
          }
        }

        if (t >= coRef.current) {
          audio.pause();
          if (gainNodeRef.current && audioCtxRef.current)
            gainNodeRef.current.gain.setValueAtTime(1.0, audioCtxRef.current.currentTime);
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

  // load audio + decode waveform
  useEffect(() => {
    if (!open || !audioUrl) return;

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

    const audio = new Audio();
    audioRef.current = audio;
    audio.crossOrigin = "anonymous";
    audio.src = audioUrl;
    audio.preload = "auto";

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
      console.warn("Web Audio API unavailable:", e);
    }

    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch(audioUrl, { signal: ctrl.signal });
        const buf = await resp.arrayBuffer();
        if (ctrl.signal.aborted) return;
        const ac2 = new (window.AudioContext || (window as any).webkitAudioContext)();
        const decoded = await ac2.decodeAudioData(buf);
        if (ctrl.signal.aborted) return;
        const d = decoded.duration;
        durRef.current = d;
        setDur(d);

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
        ac2.close();

        // auto-zoom to cue region
        const pad = Math.max(1, (co - ci) * 0.15);
        const regionDur = (co - ci) + pad * 2;
        const newZoom = clamp(d / regionDur, 1, 20);
        const newPan = clamp(ci - pad, 0, d - d / newZoom);
        zoomRef.current = newZoom; setZoom(newZoom);
        panRef.current = newPan; setPan(newPan);
      } catch (e: any) {
        if (e.name !== "AbortError") { setLoading(false); }
      }
    })();

    startRaf();

    return () => {
      ctrl.abort();
      audio.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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

  // resize canvas
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

  // hit detection — must match the handle positions drawn above
  const getHit = useCallback((x: number, W: number): "cueIn" | "cueOut" | "segue" | null => {
    const ci = ciRef.current, co = coRef.current, sg = sgRef.current;
    const fadeStart = co - sg;
    const ciX = toX(ci, W);
    const coX = toX(co, W);
    const sgX = toX(fadeStart, W);
    if (Math.abs(x - ciX) < HIT) return "cueIn";
    if (Math.abs(x - coX) < HIT) return "cueOut";
    if (hasFadeRef.current && Math.abs(x - sgX) < HIT) return "segue";
    return null;
  }, [toX]);

  const applyDrag = useCallback((x: number, W: number) => {
    const d = durRef.current || 1;
    const sec = toSec(x, W);
    if (dragRef.current === "cueIn") {
      const v = clamp(sec, 0, coRef.current - 0.1);
      ciRef.current = v; setCueIn(v);
    } else if (dragRef.current === "cueOut") {
      const v = clamp(sec, ciRef.current + 0.1, d);
      coRef.current = v; setCueOut(v);
    } else if (dragRef.current === "segue") {
      const fadeStart = clamp(sec, ciRef.current, coRef.current - 0.05);
      const newSg = coRef.current - fadeStart;
      sgRef.current = newSg; setSegue(newSg);
    }
  }, [toSec]);

  // mouse events
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas || !dragRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      applyDrag(x * (canvas.width / rect.width), canvas.width);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [applyDrag]);

  // touch events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = clamp(e.touches[0].clientX - rect.left, 0, rect.width);
      applyDrag(x * (canvas.width / rect.width), canvas.width);
    };
    const onTouchEnd = () => { dragRef.current = null; };
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    return () => { canvas.removeEventListener("touchmove", onTouchMove); canvas.removeEventListener("touchend", onTouchEnd); };
  }, [applyDrag]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const hit = getHit(x, canvas.width);
    if (hit) {
      dragRef.current = hit;
      e.preventDefault();
      e.stopPropagation();
    } else {
      const sec = toSec(x, canvas.width);
      ctRef.current = sec; setCt(sec);
      if (audioRef.current) audioRef.current.currentTime = sec;
    }
  }, [getHit, toSec]);

  const onTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
    const hit = getHit(x, canvas.width);
    if (hit) {
      dragRef.current = hit;
      e.preventDefault();
      e.stopPropagation();
    } else {
      const sec = toSec(x, canvas.width);
      ctRef.current = sec; setCt(sec);
      if (audioRef.current) audioRef.current.currentTime = sec;
    }
  }, [getHit, toSec]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const hit = getHit(x, canvas.width);
    canvas.style.cursor = hit ? "ew-resize" : "crosshair";
  }, [getHit]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const d = durRef.current || 1;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const focusSec = toSec(mx, canvas.width);
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    const newZoom = clamp(zoomRef.current * factor, 1, 40);
    const newWs = d / newZoom;
    const newPan = clamp(focusSec - (mx / canvas.width) * newWs, 0, d - newWs);
    zoomRef.current = newZoom; setZoom(newZoom);
    panRef.current = newPan; setPan(newPan);
  }, [toSec]);

  // transport
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) {
      const ac = audioCtxRef.current;
      if (ac && ac.state === "suspended") ac.resume();
      if (ctRef.current >= coRef.current) {
        audio.currentTime = ciRef.current;
        ctRef.current = ciRef.current;
      }
      if (gainNodeRef.current && ac) {
        gainNodeRef.current.gain.cancelScheduledValues(ac.currentTime);
        gainNodeRef.current.gain.setValueAtTime(1.0, ac.currentTime);
      }
      audio.play().catch(() => {});
      setPlaying(true);
      playingRef.current = true;
    } else {
      audio.pause();
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

  // spacebar
  useEffect(() => {
    if (!waveReady) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waveReady, togglePlay]);

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
  const activeRegionDur = cueOut - cueIn;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div
        style={{
          width: "min(1200px, 97vw)",
          background: "#111827",
          borderRadius: 10,
          border: "1px solid #374151",
          boxShadow: "0 24px 64px rgba(0,0,0,0.85)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          fontFamily: "'Segoe UI', Arial, sans-serif",
          maxHeight: "95vh",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* TITLE BAR */}
        <div style={{
          background: "#1f2937",
          borderBottom: "1px solid #374151",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <span style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase" }}>
            Cue Editor
          </span>
          <span style={{ color: "#e5e7eb", fontSize: 14, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {trackTitle}
          </span>
          {dur > 0 && (
            <span style={{ color: "#6b7280", fontSize: 12, fontFamily: "monospace" }}>
              {fmt(dur)}
            </span>
          )}
          <button
            onClick={() => onOpenChange(false)}
            style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "0 4px" }}
          >
            ✕
          </button>
        </div>

        {/* TOOLBAR */}
        <div style={{
          background: "#1f2937",
          borderBottom: "1px solid #374151",
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}>
          <button onClick={stop} title="Stop & return to cue in" style={btn("#374151")}>■ Stop</button>
          <button
            onClick={togglePlay}
            title={playing ? "Pause (Space)" : "Play from here (Space)"}
            style={btn(playing ? "#166534" : "#1d4ed8")}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>

          <div style={{ width: 1, height: 26, background: "#374151", margin: "0 4px" }} />

          <span style={{
            fontFamily: "monospace", fontSize: 18, fontWeight: 700,
            color: "#22c55e", background: "#0f172a", padding: "3px 12px",
            borderRadius: 4, border: "1px solid #166534", minWidth: 96, textAlign: "center",
          }}>
            {fmt(ct)}
          </span>

          <div style={{ width: 1, height: 26, background: "#374151", margin: "0 4px" }} />

          <button onClick={() => seekTo(cueIn)} title="Jump to Cue In" style={btn("#14532d")}>
            <span style={{ color: "#22c55e", fontSize: 11, fontWeight: 700 }}>▶ IN</span>
          </button>
          {hasFade && (
            <button onClick={() => seekTo(fadeStart)} title="Jump to segue point" style={btn("#7c2d12")}>
              <span style={{ color: "#fb923c", fontSize: 11, fontWeight: 700 }}>▶ SEGUE</span>
            </button>
          )}
          <button onClick={() => seekTo(Math.max(0, cueOut - 5))} title="Jump 5s before Cue Out" style={btn("#7f1d1d")}>
            <span style={{ color: "#f87171", fontSize: 11, fontWeight: 700 }}>OUT -5s ▶</span>
          </button>

          <div style={{ flex: 1 }} />

          <button onClick={fitRegion} style={btn("#374151")} title="Zoom to cue region">
            <span style={{ fontSize: 11, color: "#d1d5db" }}>Fit Region</span>
          </button>
          <button onClick={fullView} style={btn("#374151")} title="Show full track">
            <span style={{ fontSize: 11, color: "#d1d5db" }}>Full Track</span>
          </button>
          <span style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", minWidth: 36 }}>
            {zoom.toFixed(1)}×
          </span>
        </div>

        {/* WAVEFORM CANVAS */}
        <div style={{ position: "relative", flex: `0 0 ${CANVAS_H}px`, background: "#111827" }}>
          {loading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#60a5fa", fontSize: 14, background: "rgba(17,24,39,0.85)", zIndex: 2,
            }}>
              Loading waveform…
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ display: "block", width: "100%", height: CANVAS_H, cursor: "crosshair", touchAction: "none" }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onTouchStart={onTouchStart}
            onWheel={onWheel}
          />
        </div>

        {/* HINT */}
        <div style={{
          background: "#0f172a", padding: "4px 14px",
          color: "#4b5563", fontSize: 11, fontFamily: "monospace",
          borderTop: "1px solid #1f2937",
        }}>
          Drag colored handles to adjust • Scroll to zoom • Click waveform to seek • Space = play/pause
        </div>

        {/* CUE POINT PANELS */}
        <div style={{
          background: "#1f2937",
          borderTop: "1px solid #374151",
          padding: "14px 18px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
        }}>
          {/* CUE IN */}
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "12px 14px", border: "1px solid #22c55e33" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e" }} />
              <span style={{ color: "#22c55e", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>CUE IN</span>
            </div>
            <div style={{ color: "#22c55e", fontFamily: "monospace", fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 2 }}>
              {fmt(cueIn)}
            </div>
            <div style={{ color: "#6b7280", fontSize: 11, textAlign: "center", marginBottom: 8 }}>
              {dur > 0 ? `${((cueIn / dur) * 100).toFixed(1)}% into track` : "—"}
            </div>
            <input
              type="range" min={0} max={cueOut - 0.1 || 1} step={0.01}
              value={cueIn}
              onChange={e => { const v = parseFloat(e.target.value); ciRef.current = v; setCueIn(v); }}
              style={{ width: "100%", accentColor: "#22c55e", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number" value={cueIn.toFixed(2)} step="0.01" min="0"
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const c = clamp(v, 0, cueOut - 0.1); ciRef.current = c; setCueIn(c); } }}
                style={numInput("#22c55e")}
              />
              <button
                onClick={() => { const v = ctRef.current; ciRef.current = v; setCueIn(v); }}
                style={setBtn("#22c55e")}
                title="Set cue in at playhead position"
              >
                ◉ Set Here
              </button>
            </div>
          </div>

          {/* SEGUE */}
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "12px 14px", border: `1px solid ${hasFade ? "#f9731633" : "#37415166"}`, opacity: hasFade ? 1 : 0.5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#f97316" }} />
              <span style={{ color: "#f97316", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>SEGUE</span>
              <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={hasFade}
                  onChange={e => { setHasFade(e.target.checked); hasFadeRef.current = e.target.checked; }}
                  style={{ accentColor: "#f97316", width: 16, height: 16 }}
                />
                <span style={{ color: "#9ca3af", fontSize: 11 }}>Enable</span>
              </label>
            </div>

            {/* Primary: segue duration */}
            <div style={{ color: "#f97316", fontFamily: "monospace", fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 2 }}>
              {hasFade ? `${segue.toFixed(2)}s` : "—"}
            </div>
            <div style={{ color: "#6b7280", fontSize: 11, textAlign: "center", marginBottom: 8, lineHeight: 1.4 }}>
              {hasFade ? <>Next track starts <strong style={{ color: "#fb923c" }}>{segue.toFixed(1)}s</strong> before cue out<br /><span style={{ color: "#4b5563" }}>Fade starts at {fmt(fadeStart)}</span></> : "No fade — hard cut at cue out"}
            </div>

            {hasFade && (
              <>
                <input
                  type="range" min={0} max={Math.min(30, Math.max(0, activeRegionDur - 0.1))} step={0.1}
                  value={segue}
                  onChange={e => { const v = parseFloat(e.target.value); sgRef.current = v; setSegue(v); }}
                  style={{ width: "100%", accentColor: "#f97316", marginBottom: 8 }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="number" value={segue.toFixed(2)} step="0.1" min="0" max="30"
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) { sgRef.current = v; setSegue(v); } }}
                    style={numInput("#f97316")}
                  />
                  <button
                    onClick={() => { const fs = ctRef.current; const newSg = Math.max(0, coRef.current - fs); sgRef.current = newSg; setSegue(newSg); }}
                    style={setBtn("#f97316")}
                    title="Set segue: next track will start at current playhead position"
                  >
                    ◉ Set Here
                  </button>
                </div>
              </>
            )}
          </div>

          {/* CUE OUT */}
          <div style={{ background: "#0f172a", borderRadius: 8, padding: "12px 14px", border: "1px solid #ef444433" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444" }} />
              <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>CUE OUT</span>
            </div>
            <div style={{ color: "#ef4444", fontFamily: "monospace", fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 2 }}>
              {fmt(cueOut)}
            </div>
            <div style={{ color: "#6b7280", fontSize: 11, textAlign: "center", marginBottom: 8 }}>
              Active region: {fmt(activeRegionDur)}
            </div>
            <input
              type="range" min={cueIn + 0.1} max={dur || 1} step={0.01}
              value={cueOut}
              onChange={e => { const v = parseFloat(e.target.value); coRef.current = v; setCueOut(v); }}
              style={{ width: "100%", accentColor: "#ef4444", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number" value={cueOut.toFixed(2)} step="0.01"
                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { const c = clamp(v, cueIn + 0.1, dur || 9999); coRef.current = c; setCueOut(c); } }}
                style={numInput("#ef4444")}
              />
              <button
                onClick={() => { const v = ctRef.current; coRef.current = v; setCueOut(v); }}
                style={setBtn("#ef4444")}
                title="Set cue out at playhead position"
              >
                ◉ Set Here
              </button>
            </div>
          </div>
        </div>

        {/* SAVE BAR */}
        <div style={{
          background: "#111827",
          borderTop: "1px solid #374151",
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
        }}>
          <button
            onClick={() => onOpenChange(false)}
            style={{
              background: "#374151", border: "1px solid #4b5563", color: "#d1d5db",
              padding: "8px 22px", borderRadius: 6, cursor: "pointer", fontSize: 14,
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saving ? "#1e3a5f" : "#1d4ed8",
              border: "1px solid #2563eb",
              color: "#fff",
              padding: "8px 30px",
              borderRadius: 6,
              cursor: saving ? "default" : "pointer",
              fontSize: 14,
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

function btn(bg: string): React.CSSProperties {
  return {
    background: bg, border: "1px solid #4b5563", color: "#f9fafb",
    padding: "5px 12px", borderRadius: 5, cursor: "pointer",
    fontSize: 13, lineHeight: 1.4, whiteSpace: "nowrap",
  };
}

function numInput(color: string): React.CSSProperties {
  return {
    flex: 1, background: "#111827", border: `1px solid ${color}55`,
    color: color, fontFamily: "monospace", fontSize: 13,
    padding: "5px 7px", borderRadius: 5, outline: "none", minWidth: 0,
  };
}

function setBtn(color: string): React.CSSProperties {
  return {
    background: `${color}18`, border: `1px solid ${color}55`,
    color: color, fontFamily: "monospace", fontSize: 11,
    padding: "5px 9px", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap",
  };
}
