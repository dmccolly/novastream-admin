"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * CuePointEditor is a fully interactive audio cue point editor.  It renders a
 * waveform preview of the track, provides a timeline with draggable markers
 * for cue in, cue out and segue duration, and persists changes back to the
 * server.  This component uses a resilient duration strategy: it reads
 * `audio.duration` when available but falls back to the provided cueOut
 * value if metadata is unavailable (common with streaming sources).  The
 * timeline and waveform always reference the most accurate duration known.
 */
interface CuePointEditorProps {
  /** Whether the editor dialog is open */
  open: boolean;
  /** Callback for when the dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** Identifier of the track being edited */
  trackId: string;
  /** Human‐readable title of the track */
  trackTitle: string;
  /** URL to the audio source; must be reachable by the browser */
  audioUrl: string;
  /** Initial cue points loaded from the backend */
  initialCuePoints: {
    cueIn: number;
    cueOut: number;
    segueDuration: number;
  };
  /** Optional track type – "song" gives longer default segue durations */
  trackType?: string;
  /** Called after a successful save */
  onSuccess?: () => void;
}

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
  // Refs for DOM elements
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // A ref storing the last known audio duration.  This persists across
  // component re-renders and remounts (for example through portals) and is
  // updated whenever the browser exposes a finite duration.  Without this
  // fallback, streaming sources often report `Infinity` or `NaN` and the UI
  // never updates.
  const durationRef = useRef<number | null>(null);

  // State for the displayed duration.  We keep this separate from the ref
  // because React state drives re-renders for the UI.  The ref is the true
  // source of truth; state mirrors it when updated.
  const [duration, setDuration] = useState<number>(0);

  // Cue point states.  These are controlled numbers that will always be
  // clamped and snapped according to the current duration.  They start at
  // initial values from props and may be adjusted by the user.
  const [cueIn, setCueIn] = useState<number>(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState<number>(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState<number>(initialCuePoints.segueDuration || 0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // Waveform data; either a placeholder sine wave or real decoded data
  const [waveformData, setWaveformData] = useState<number[]>([]);
  // Scrubbing state for pointer events on the waveform
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [wasPlayingBeforeScrub, setWasPlayingBeforeScrub] = useState<boolean>(false);
  // Timeline scrubbing state for mouse events
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState<boolean>(false);
  const [wasPlayingBeforeTimelineScrub, setWasPlayingBeforeTimelineScrub] = useState<boolean>(false);
  // Marker dragging state; identifies which marker is being dragged
  const [dragging, setDragging] = useState<"cueIn" | "fadeStart" | "cueOut" | null>(null);

  // Snap mode for constraints
  const [snapMode, setSnapMode] = useState<"off" | "0.10" | "0.01">("off");

  // Reference for requestAnimationFrame when playing; used to cancel the loop
  const animationFrameRef = useRef<number | null>(null);

  /**
   * Utility: clamp a number between min and max.
   */
  const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(value, max));
  };

  /**
   * Utility: ensure a value is a finite number; if not, return 0.  This
   * prevents NaN and Infinity from propagating through the UI.
   */
  const sanitize = (value: number): number => {
    return !Number.isFinite(value) || Number.isNaN(value) ? 0 : value;
  };

  /**
   * Apply snap to a value based on the current snapMode.  When snapMode is
   * "off" the value is returned unchanged.  Otherwise it is rounded to
   * increments of 0.10 or 0.01 seconds.
   */
  const applySnap = (value: number): number => {
    if (snapMode === "off") return value;
    const step = snapMode === "0.10" ? 0.1 : 0.01;
    return Math.round(value / step) * step;
  };

  /**
   * Compute the effective duration used for UI and constraints.  Use
   * audio.duration if it is finite; otherwise fall back to the last known
   * durationRef or cueOut.  This ensures the UI has a meaningful length
   * even for streaming audio where the duration is unknown.
   */
  const getEffectiveDuration = useCallback((): number => {
    const d = durationRef.current ?? 0;
    if (Number.isFinite(d) && d > 0) return d;
    if (duration > 0) return duration;
    if (cueOut > 0) return cueOut;
    return 0;
  }, [duration, cueOut]);

  /**
   * Format a number of seconds into mm:ss.hh format.  Handles invalid numbers
   * gracefully by returning 0:00.00.
   */
  const formatTime = (seconds: number): string => {
    const s = sanitize(seconds);
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    const hh = Math.floor((s - mm * 60 - ss) * 100);
    return `${mm}:${ss.toString().padStart(2, "0")}.${hh.toString().padStart(2, "0")}`;
  };

  /**
   * Enforce cue point ordering and duration bounds.  This function will
   * internally clamp and snap cueIn, cueOut and segueDuration to produce
   * sensible values where cueIn <= fadeStart <= cueOut and fadeStart +
   * segueDuration <= cueOut.  Optionally accepts an override duration to
   * account for newly computed durations outside React state.
   */
  const applyConstraints = useCallback(
    (
      next: { cueIn?: number; cueOut?: number; segueDuration?: number },
      overrideDuration?: number
    ) => {
      const d = overrideDuration ?? getEffectiveDuration();
      let newCueIn = sanitize(next.cueIn !== undefined ? next.cueIn : cueIn);
      let newCueOut = sanitize(next.cueOut !== undefined ? next.cueOut : cueOut);
      let newSegue = sanitize(next.segueDuration !== undefined ? next.segueDuration : segueDuration);

      // Snap values if needed
      newCueIn = applySnap(newCueIn);
      newCueOut = applySnap(newCueOut);
      newSegue = applySnap(newSegue);

      // Clamp to [0, d]
      newCueIn = clamp(newCueIn, 0, d);
      newCueOut = clamp(newCueOut, 0, d);
      newSegue = clamp(newSegue, 0, d);

      // If cueIn is beyond cueOut - segue, adjust appropriately
      if (newCueIn > newCueOut - newSegue) {
        if (next.cueIn !== undefined) {
          newCueIn = clamp(newCueOut - newSegue, 0, d);
        } else if (next.cueOut !== undefined) {
          newCueOut = clamp(newCueIn + newSegue, 0, d);
        } else if (next.segueDuration !== undefined) {
          newSegue = clamp(newCueOut - newCueIn, 0, d);
        }
      }

      // Ensure segueDuration <= cueOut - cueIn
      if (newSegue > newCueOut - newCueIn) {
        newSegue = Math.max(0, newCueOut - newCueIn);
      }

      setCueIn(newCueIn);
      setCueOut(newCueOut);
      setSegueDuration(newSegue);
    },
    [applySnap, cueIn, cueOut, segueDuration, getEffectiveDuration]
  );

  /**
   * Generate a placeholder waveform.  This is a simple dampened sine wave with
   * random variations used until a real waveform can be decoded.  It runs
   * synchronously.
   */
  const generatePlaceholderWaveform = useCallback(() => {
    const samples = 500;
    const data: number[] = [];
    for (let i = 0; i < samples; i++) {
      const position = i / samples;
      const base = 0.3 + Math.sin(position * Math.PI * 8) * 0.2;
      const variation = Math.random() * 0.3;
      const fadeIn = Math.min(position * 5, 1);
      const fadeOut = Math.min((1 - position) * 5, 1);
      data.push((base + variation) * fadeIn * fadeOut);
    }
    setWaveformData(data);
  }, []);

  /**
   * Attempt to fetch and decode the audio buffer for generating a real
   * waveform.  Some streaming sources cannot be decoded due to CORS or
   * incomplete data.  When decoding fails, the placeholder waveform is
   * retained.
   */
  const generateWaveform = useCallback(
    async (audio: HTMLAudioElement) => {
      // Use the existing placeholder until we decode
      try {
        const controller = new AbortController();
        const signal = controller.signal;
        // Cancel fetch if it takes too long
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(audio.src, { signal });
        clearTimeout(timeout);
        if (!response.ok) throw new Error("Failed to fetch audio");
        const arrayBuffer = await response.arrayBuffer();
        const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
        const audioContext = new AudioCtx();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const samples = 500;
        const rawData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(rawData.length / samples);
        const filtered: number[] = [];
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          const start = i * blockSize;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[start + j]);
          }
          filtered.push(sum / blockSize);
        }
        const max = Math.max(...filtered);
        const normalized = max > 0 ? filtered.map((n) => n / max) : filtered;
        setWaveformData(normalized);
      } catch (err) {
        // If decoding fails, keep the placeholder
      }
    },
    []
  );

  /**
   * Draw the waveform onto the canvas.  This effect runs whenever the
   * waveform data or cue points change.  It shades different sections of the
   * waveform to indicate cue regions and draws the playhead.
   */
  useEffect(() => {
    if (!canvasRef.current || waveformData.length === 0) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / waveformData.length;
    const d = getEffectiveDuration();
    for (let i = 0; i < waveformData.length; i++) {
      const value = waveformData[i];
      const barHeight = value * height * 0.8;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      // Determine color based on cue regions
      let color = "#3b82f6"; // blue default
      if (d > 0) {
        const position = (i / waveformData.length) * d;
        if (position < cueIn) {
          color = "#6b7280"; // gray before start
        } else if (position >= cueIn && position < cueOut - segueDuration) {
          color = "#3b82f6"; // blue active region
        } else if (position >= cueOut - segueDuration && position < cueOut) {
          color = "#eab308"; // yellow fade region
        } else {
          color = "#6b7280"; // gray after end
        }
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    }
    // Draw fade start and end markers on waveform
    if (d > 0 && segueDuration > 0 && cueOut > 0) {
      const fadeStartX = ((cueOut - segueDuration) / d) * width;
      const fadeEndX = (cueOut / d) * width;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(fadeStartX, 0);
      ctx.lineTo(fadeStartX, height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fadeEndX, 0);
      ctx.lineTo(fadeEndX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Draw playhead
    if (d > 0 && currentTime >= 0) {
      const x = (currentTime / d) * width;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [waveformData, cueIn, cueOut, segueDuration, currentTime, getEffectiveDuration]);

  /**
   * When the dialog is opened, initialize cue points and generate the
   * placeholder waveform.  This runs only on open change.
   */
  useEffect(() => {
    if (!open) return;
    setCueIn(initialCuePoints.cueIn || 0);
    setCueOut(initialCuePoints.cueOut || 0);
    setSegueDuration(initialCuePoints.segueDuration || 0);
    setCurrentTime(0);
    setIsPlaying(false);
    generatePlaceholderWaveform();
  }, [open, initialCuePoints, generatePlaceholderWaveform]);

  /**
   * Load audio metadata and establish event listeners.  This effect listens
   * for multiple events to detect when a finite duration becomes available.
   * It also sets up timeupdate to track the playhead.
   */
  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;
    const updateDurationFromAudio = (reason: string) => {
      if (cancelled) return;
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        durationRef.current = d;
        setDuration(d);
        // If cueOut was not provided or zero, default to full length
        if (!initialCuePoints.cueOut) {
          applyConstraints({ cueOut: d }, d);
        }
        // If segueDuration not provided, use type default
        if (!initialCuePoints.segueDuration) {
          const defaultSegue = trackType === "song" ? 3.0 : 0.5;
          applyConstraints({ segueDuration: defaultSegue }, d);
        }
        // Kick off waveform generation
        generateWaveform(audio);
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime || 0);
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    audio.addEventListener("loadedmetadata", () => updateDurationFromAudio("loadedmetadata"));
    audio.addEventListener("canplaythrough", () => updateDurationFromAudio("canplaythrough"));
    audio.addEventListener("durationchange", () => updateDurationFromAudio("durationchange"));
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.src = audioUrl;
    audio.preload = "metadata";
    audio.load();
    // Immediate check
    updateDurationFromAudio("initial");
    // Poll for duration availability
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (durationRef.current && durationRef.current > 0) {
        clearInterval(poll);
      } else {
        updateDurationFromAudio("poll");
        if (attempts > 60) clearInterval(poll);
      }
    }, 50);
    return () => {
      cancelled = true;
      clearInterval(poll);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [open, audioUrl, trackId, initialCuePoints, trackType, applyConstraints, generateWaveform]);

  /**
   * Manage the play/pause toggle.  Attempts to play the audio and updates
   * state accordingly.  Browser autoplay policies can block playback; if so
   * a toast is shown.
   */
  const togglePlayPause = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        toast({
          title: "Playback blocked",
          description: "The browser prevented autoplay.",
          variant: "destructive",
        });
      }
    }
  };

  /**
   * Stop playback and reset current time.  Used by the stop button.
   */
  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  /**
   * Save the current cue points to the server.  Sends a PATCH request to
   * `/api/tracks/:id/cuepoints`.  On success shows a toast and calls
   * onSuccess; on failure shows a destructive toast.
   */
  const handleSave = async () => {
    try {
      const res = await fetch(
        `/api/tracks/${trackId}/cuepoints`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cueIn, cueOut, segueDuration }),
        }
      );
      if (!res.ok) throw new Error();
      toast({ title: "Saved", description: "Cue points saved successfully." });
      onSuccess?.();
      // Close dialog after a short delay
      setTimeout(() => onOpenChange(false), 400);
    } catch {
      toast({
        title: "Save failed",
        description: "Unable to save cue points.",
        variant: "destructive",
      });
    }
  };

  /**
   * Waveform pointer handlers for touch and mouse.  Supports scrubbing and
   * double-tap to toggle play/pause.  During scrubbing, playback is paused
   * and resumed based on prior state.
   */
  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    const d = getEffectiveDuration();
    if (d <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * d;
    audio.currentTime = time;
    setCurrentTime(time);
    // Double tap detection
    const now = Date.now();
    if (now - (handleWaveformPointerDown as any).lastTap < TAP_MS) {
      togglePlayPause();
      (handleWaveformPointerDown as any).lastTap = 0;
      return;
    }
    (handleWaveformPointerDown as any).lastTap = now;
    // Begin scrubbing
    setIsScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    }
  };
  // Initialize lastTap property
  (handleWaveformPointerDown as any).lastTap = 0;
  const handleWaveformPointerMove = useCallback(
    (e: PointerEvent) => {
      const canvas = canvasRef.current;
      const audio = audioRef.current;
      const d = getEffectiveDuration();
      if (!isScrubbing || !canvas || !audio || d <= 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = clamp(x / rect.width, 0, 1);
      const time = percent * d;
      audio.currentTime = time;
      setCurrentTime(time);
    },
    [isScrubbing, getEffectiveDuration]
  );
  const handleWaveformPointerUp = useCallback(() => {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    setWasPlayingBeforeScrub(false);
  }, [isScrubbing, wasPlayingBeforeScrub]);
  // Effect to attach pointermove/up during scrubbing
  useEffect(() => {
    if (!isScrubbing) return;
    document.addEventListener("pointermove", handleWaveformPointerMove);
    document.addEventListener("pointerup", handleWaveformPointerUp);
    return () => {
      document.removeEventListener("pointermove", handleWaveformPointerMove);
      document.removeEventListener("pointerup", handleWaveformPointerUp);
    };
  }, [isScrubbing, handleWaveformPointerMove, handleWaveformPointerUp]);

  /**
   * Timeline scrubbing with mouse.  When the user clicks the timeline (not
   * dragging markers), they can scrub the playhead.
   */
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".cursor-ew-resize")) return;
    const timeline = timelineRef.current;
    const audio = audioRef.current;
    const d = getEffectiveDuration();
    if (!timeline || !audio || d <= 0) return;
    setIsTimelineScrubbing(true);
    setWasPlayingBeforeTimelineScrub(isPlaying);
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    }
    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * d;
    audio.currentTime = time;
    setCurrentTime(time);
  };
  const handleTimelineMouseMove = useCallback(
    (e: MouseEvent) => {
      const timeline = timelineRef.current;
      const audio = audioRef.current;
      const d = getEffectiveDuration();
      if (!isTimelineScrubbing || !timeline || !audio || d <= 0) return;
      const rect = timeline.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = clamp(x / rect.width, 0, 1);
      const time = percent * d;
      audio.currentTime = time;
      setCurrentTime(time);
    },
    [isTimelineScrubbing, getEffectiveDuration]
  );
  const handleTimelineMouseUp = useCallback(() => {
    if (!isTimelineScrubbing) return;
    setIsTimelineScrubbing(false);
    if (wasPlayingBeforeTimelineScrub && audioRef.current) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    setWasPlayingBeforeTimelineScrub(false);
  }, [isTimelineScrubbing, wasPlayingBeforeTimelineScrub]);
  useEffect(() => {
    if (!isTimelineScrubbing) return;
    document.addEventListener("mousemove", handleTimelineMouseMove);
    document.addEventListener("mouseup", handleTimelineMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleTimelineMouseMove);
      document.removeEventListener("mouseup", handleTimelineMouseUp);
    };
  }, [isTimelineScrubbing, handleTimelineMouseMove, handleTimelineMouseUp]);

  /**
   * Drag handlers for markers.  These modify cueIn, fadeStart (implicitly
   * adjusting segueDuration), and cueOut.  They use mouse events because
   * pointer events interfere with marker selection in some browsers.
   */
  const handleMarkerDrag = (
    e: React.MouseEvent<HTMLDivElement>,
    marker: "cueIn" | "fadeStart" | "cueOut"
  ) => {
    e.preventDefault();
    setDragging(marker);
    const handleMove = (ev: MouseEvent) => {
      const timeline = timelineRef.current;
      const d = getEffectiveDuration();
      if (!timeline || d <= 0) return;
      const rect = timeline.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      const percent = x / rect.width;
      let time = applySnap(percent * d);
      // Modify the appropriate value
      if (marker === "cueIn") {
        applyConstraints({ cueIn: time }, d);
      } else if (marker === "fadeStart") {
        // fadeStart marker adjusts segueDuration
        const newFadeStart = clamp(time, cueIn, cueOut);
        applyConstraints({ segueDuration: cueOut - newFadeStart }, d);
      } else if (marker === "cueOut") {
        applyConstraints({ cueOut: time }, d);
      }
    };
    const handleUp = () => {
      setDragging(null);
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  };

  /**
   * Animation loop to update currentTime during playback.  This uses
   * requestAnimationFrame so the playhead smoothly animates even when
   * timeupdate events are sparse.
   */
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime || 0);
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying]);

  // Derived values for timeline marker positions (in percent)
  const effectiveDuration = getEffectiveDuration();
  const startPercent = effectiveDuration > 0 ? (cueIn / effectiveDuration) * 100 : 0;
  const fadeStartPercent =
    effectiveDuration > 0 ? ((cueOut - segueDuration) / effectiveDuration) * 100 : 0;
  const endPercent = effectiveDuration > 0 ? (cueOut / effectiveDuration) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        {/* Hidden audio element; we bind events in effect */}
        <audio ref={audioRef} />
        <div className="bg-gray-900 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{trackTitle}</DialogTitle>
            <DialogDescription>
              Adjust cue points, fade, and preview the track.
            </DialogDescription>
          </DialogHeader>
          {/* Playback Controls */}
          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg">
              <Button onClick={togglePlayPause} className="" size="lg">
                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
              </Button>
              <Button onClick={handleStop} className="" size="lg">
                <Square className="h-6 w-6" />
              </Button>
              <div className="flex-1 text-center text-2xl font-mono">
                {formatTime(currentTime)} / {formatTime(effectiveDuration)}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Snap:</span>
                <select
                  value={snapMode}
                  onChange={(e) => setSnapMode(e.target.value as any)}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  <option value="off">Off</option>
                  <option value="0.10">0.10s</option>
                  <option value="0.01">0.01s</option>
                </select>
              </div>
            </div>
            {/* Waveform */}
            <div className="bg-gray-800 p-3 rounded-lg">
              <h3 className="font-bold mb-2 text-base">Waveform</h3>
              <canvas
                ref={canvasRef}
                width={1300}
                height={120}
                className="w-full h-[120px] bg-gray-900 rounded cursor-crosshair"
                style={{ touchAction: "none" }}
                onPointerDown={handleWaveformPointerDown}
              />
            </div>
            {/* Timeline */}
            <div className="bg-gray-800 p-3 rounded-lg">
              <h3 className="font-bold mb-2 text-base">Timeline Markers</h3>
              <div className="bg-gray-800 p-2 rounded">
                <div className="flex justify-between text-sm mb-2">
                  <span>0:00</span>
                  <span>{formatTime(effectiveDuration)}</span>
                </div>
                <div
                  ref={timelineRef}
                  className="relative h-16 bg-gray-700 rounded cursor-pointer"
                  onMouseDown={handleTimelineMouseDown}
                >
                  {/* Cue In Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-2 bg-green-500 cursor-ew-resize hover:w-3 transition-all z-10"
                    style={{ left: `${startPercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "cueIn")}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap bg-green-500 px-2 py-1 rounded">
                      START: {formatTime(cueIn)}
                    </div>
                  </div>
                  {/* Fade Start Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-2 bg-yellow-500 cursor-ew-resize hover:w-3 transition-all z-10"
                    style={{ left: `${fadeStartPercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "fadeStart")}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap bg-yellow-500 px-2 py-1 rounded text-black">
                      FADE: {formatTime(cueOut - segueDuration)}
                    </div>
                  </div>
                  {/* Cue Out Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-2 bg-red-500 cursor-ew-resize hover:w-3 transition-all z-10"
                    style={{ left: `${endPercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "cueOut")}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap bg-red-500 px-2 py-1 rounded">
                      END: {formatTime(cueOut)}
                    </div>
                  </div>
                  {/* Active region shading */}
                  <div
                    className="absolute top-0 bottom-0 bg-blue-500 opacity-30"
                    style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
                  />
                </div>
              </div>
            </div>
            {/* Numeric inputs */}
            <div className="grid grid-cols-3 gap-6 bg-gray-800 p-6 rounded-lg">
              <div>
                <label className="block text-sm font-bold mb-2 text-green-400">
                  Cue In (Start)
                </label>
                <input
                  type="number"
                  value={cueIn.toFixed(2)}
                  onChange={(e) => applyConstraints({ cueIn: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-gray-900 border-2 border-green-500 rounded px-3 py-2 text-base font-mono"
                  step="0.1"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2 text-yellow-400">
                  Segue Duration (Fade Length)
                </label>
                <input
                  type="number"
                  value={segueDuration.toFixed(2)}
                  onChange={(e) => applyConstraints({ segueDuration: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-gray-900 border-2 border-yellow-500 rounded px-3 py-2 text-base font-mono"
                  step="0.1"
                />
              </div>
              <div>
                <label className="block text-sm font-bold mb-2 text-red-400">
                  Cue Out (End)
                </label>
                <input
                  type="number"
                  value={cueOut.toFixed(2)}
                  onChange={(e) => applyConstraints({ cueOut: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-gray-900 border-2 border-red-500 rounded px-3 py-2 text-base font-mono"
                  step="0.1"
                />
              </div>
            </div>
            {/* Action buttons */}
            <div className="flex justify-end gap-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save Cue Points</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
