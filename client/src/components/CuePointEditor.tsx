import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CuePointEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  trackTitle: string;
  audioUrl: string;
  initialCuePoints: {
    cueIn: number;
    cueOut: number;
    segueDuration: number;
  };
  trackType?: string; // "song" or other types
  onSuccess?: () => void; // Callback after successful save
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
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const lastTapRef = useRef<number>(0);
  const TAP_MS = 350;

  // IMPORTANT: duration should NOT be initialized from cueOut.
  // It should come from the <audio> element only.
  const [duration, setDuration] = useState<number>(0);
  const durationRef = useRef<number>(0);

  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration);

  const [dragging, setDragging] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [wasPlayingBeforeScrub, setWasPlayingBeforeScrub] = useState(false);
  const [isTimelineScrubbing, setIsTimelineScrubbing] = useState(false);

  const [snapMode, setSnapMode] = useState<"off" | "0.10" | "0.01">("off");
  const animationFrameRef = useRef<number | null>(null);

  // ---------- helpers ----------
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

  const sanitize = (v: number) => {
    if (isNaN(v) || !isFinite(v)) return 0;
    return v;
  };

  const applySnap = (value: number): number => {
    if (snapMode === "off") return value;
    const snapValue = snapMode === "0.10" ? 0.1 : 0.01;
    return Math.round(value / snapValue) * snapValue;
  };

  /**
   * Canonical constraint function BUT it can take an override duration to avoid stale closure issues.
   */
  const applyConstraints = (
    next: { cueIn?: number; cueOut?: number; segueDuration?: number },
    overrideDuration?: number
  ) => {
    const dur = overrideDuration && overrideDuration > 0
      ? overrideDuration
      : (durationRef.current > 0 ? durationRef.current : Math.max(cueOut, 0));

    let newCueIn = sanitize(next.cueIn !== undefined ? next.cueIn : cueIn);
    let newCueOut = sanitize(next.cueOut !== undefined ? next.cueOut : cueOut);
    let newSegue = sanitize(next.segueDuration !== undefined ? next.segueDuration : segueDuration);

    newCueIn = clamp(newCueIn, 0, dur);
    newCueOut = clamp(newCueOut, 0, dur);
    newSegue = Math.max(0, newSegue);

    // Enforce cueIn <= cueOut - segueDuration
    if (newCueIn > newCueOut - newSegue) {
      if (next.cueIn !== undefined) {
        newCueIn = Math.max(0, newCueOut - newSegue);
      } else if (next.cueOut !== undefined) {
        newCueOut = Math.min(dur, newCueIn + newSegue);
      } else if (next.segueDuration !== undefined) {
        newSegue = Math.max(0, newCueOut - newCueIn);
      }
    }

    // Enforce segueDuration <= cueOut - cueIn
    if (newSegue > newCueOut - newCueIn) {
      newSegue = Math.max(0, newCueOut - newCueIn);
    }

    setCueIn(newCueIn);
    setCueOut(newCueOut);
    setSegueDuration(newSegue);
  };

  const formatTime = (seconds: number) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return "--:--.--";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // ---------- waveform ----------
  const tryFetchAudioBuffer = async (url: string): Promise<ArrayBuffer | null> => {
    try {
      const response = await fetch(url, { mode: "cors" });
      if (response.ok) return await response.arrayBuffer();
    } catch {
      // ignore
    }
    try {
      const response = await fetch(url, {
        headers: { Range: "bytes=0-2000000" },
        mode: "cors",
      });
      if (response.ok) return await response.arrayBuffer();
    } catch {
      // ignore
    }
    return null;
  };

  const generateWaveform = async (audio: HTMLAudioElement) => {
    // keep placeholder waveform, attempt real decode in background
    try {
      const arrayBuffer = await tryFetchAudioBuffer(audio.src);
      if (!arrayBuffer) throw new Error("Could not fetch audio data");

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const samples = 500;
      const rawData = audioBuffer.getChannelData(0);
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData: number[] = [];

      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }

      const max = Math.max(...filteredData);
      const normalized = max > 0 ? filteredData.map((n) => n / max) : filteredData;
      setWaveformData(normalized);
    } catch {
      // stream not decodable; keep placeholder waveform
    }
  };

  // ---------- open/reset ----------
  useEffect(() => {
    if (!open) return;

    // reset cues to initial (do NOT touch duration here)
    applyConstraints({
      cueIn: initialCuePoints.cueIn,
      cueOut: initialCuePoints.cueOut,
      segueDuration: initialCuePoints.segueDuration,
    });

    setCurrentTime(0);
    setIsPlaying(false);

    // placeholder waveform immediately
    const samples = 500;
    const waveform: number[] = [];
    for (let i = 0; i < samples; i++) {
      const position = i / samples;
      const base = 0.3 + Math.sin(position * Math.PI * 8) * 0.2;
      const variation = Math.random() * 0.3;
      const fadeIn = Math.min(position * 5, 1);
      const fadeOut = Math.min((1 - position) * 5, 1);
      waveform.push((base + variation) * fadeIn * fadeOut);
    }
    setWaveformData(waveform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackId]);

  // ---------- audio duration + events (CORE FIX) ----------
  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;

    const setDurationSafe = (d: number) => {
      if (cancelled) return;
      if (!isFinite(d) || isNaN(d) || d <= 0) return;

      durationRef.current = d;
      setDuration(d);

      // If cueOut wasn't set, set it to duration.
      if (!initialCuePoints.cueOut || initialCuePoints.cueOut === 0) {
        applyConstraints({ cueOut: d }, d);
      }

      // If segue wasn't set, default based on type.
      if (!initialCuePoints.segueDuration || initialCuePoints.segueDuration === 0) {
        const defaultSegue = trackType === "song" ? 3.0 : 0.5;
        applyConstraints({ segueDuration: defaultSegue }, d);
      }
    };

    const tryReadDuration = (source: string) => {
      const d = audio.duration;
      // Helpful debug if needed:
      // console.log("[duration]", source, { readyState: audio.readyState, duration: d });
      if (isFinite(d) && !isNaN(d) && d > 0) setDurationSafe(d);
    };

    const onLoadedMetadata = () => tryReadDuration("loadedmetadata");
    const onCanPlayThrough = () => tryReadDuration("canplaythrough");
    const onDurationChange = () => tryReadDuration("durationchange");
    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplaythrough", onCanPlayThrough);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);

    // Make sure correct src is applied, then load.
    audio.src = audioUrl;
    audio.preload = "metadata";
    audio.load();

    // Immediate attempt
    tryReadDuration("immediate");

    // Short polling fallback (stops early)
    let ticks = 0;
    const poll = window.setInterval(() => {
      ticks += 1;
      if (cancelled) return;
      if (durationRef.current > 0) {
        window.clearInterval(poll);
        return;
      }
      tryReadDuration("poll");
      if (ticks >= 60) window.clearInterval(poll); // ~3s at 50ms
    }, 50);

    // waveform generation can happen once we have *some* readiness
    // (even if duration is late, it's fine)
    const waveformKick = window.setTimeout(() => {
      if (!cancelled) generateWaveform(audio);
    }, 150);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(waveformKick);

      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplaythrough", onCanPlayThrough);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackId, audioUrl, trackType]);

  // Draw waveform
  useEffect(() => {
    if (!canvasRef.current || waveformData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const barWidth = width / waveformData.length;

    ctx.clearRect(0, 0, width, height);

    const dur = durationRef.current > 0 ? durationRef.current : duration;

    waveformData.forEach((value, i) => {
      const barHeight = value * height * 0.8;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      let color = "#3b82f6"; // blue
      if (dur > 0) {
        const position = (i / waveformData.length) * dur;

        if (position < cueIn) {
          color = "#6b7280"; // gray
        } else if (position >= cueIn && position < cueOut - segueDuration) {
          color = "#3b82f6"; // blue
        } else if (position >= cueOut - segueDuration && position < cueOut) {
          color = "#eab308"; // yellow
        } else {
          color = "#6b7280"; // gray
        }
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Fade borders
    const dur2 = durationRef.current > 0 ? durationRef.current : duration;
    if (dur2 > 0 && segueDuration > 0 && cueOut > 0) {
      const fadeStartX = ((cueOut - segueDuration) / dur2) * width;
      const fadeEndX = (cueOut / dur2) * width;

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

    // Playback cursor
    if (dur2 > 0 && currentTime > 0) {
      const cursorX = (currentTime / dur2) * width;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ef4444";
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, height);
      ctx.stroke();

      ctx.shadowBlur = 0;
    }
  }, [waveformData, cueIn, cueOut, segueDuration, currentTime, duration]);

  // Animation loop for smooth playback cursor
  useEffect(() => {
    if (!isPlaying || !audioRef.current || !canvasRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const animate = () => {
      if (audioRef.current && canvasRef.current) {
        setCurrentTime(audioRef.current.currentTime || 0);
      }
      if (isPlaying) animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying]);

  // ---------- playback ----------
  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {
        toast({
          title: "Error",
          description: "Unable to play audio (autoplay policy or load issue).",
          variant: "destructive",
        });
      });
    }
  };

  const handleStop = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // ---------- save ----------
  const handleSave = async () => {
    try {
      const response = await fetch(
        `${window.location.origin}/api/tracks/${trackId}/cuepoints`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cueIn, cueOut, segueDuration }),
        }
      );

      if (response.ok) {
        toast({ title: "Success", description: "Cue points saved successfully" });
        onSuccess?.();
        setTimeout(() => onOpenChange(false), 500);
      } else {
        toast({
          title: "Error",
          description: `Failed to save cue points (${response.status})`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to save cue points:", error);
      toast({
        title: "Error",
        description: "Failed to save cue points",
        variant: "destructive",
      });
    }
  };

  // ---------- waveform scrubbing (pointer) ----------
  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const dur = durationRef.current > 0 ? durationRef.current : duration;

    if (!canvas || !audio || dur <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const t0 = percent * dur;

    audio.currentTime = t0;
    setCurrentTime(t0);

    const now = Date.now();
    if (now - lastTapRef.current < TAP_MS) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      lastTapRef.current = 0;
      return;
    }

    lastTapRef.current = now;
    setIsScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const handleWaveformPointerMove = (e: PointerEvent) => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const dur = durationRef.current > 0 ? durationRef.current : duration;

    if (!isScrubbing || !canvas || !audio || dur <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * dur;

    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformPointerUp = () => {
    if (!isScrubbing) return;
    setIsScrubbing(false);

    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    setWasPlayingBeforeScrub(false);
  };

  useEffect(() => {
    if (!isScrubbing) return;

    document.addEventListener("pointermove", handleWaveformPointerMove);
    document.addEventListener("pointerup", handleWaveformPointerUp);

    return () => {
      document.removeEventListener("pointermove", handleWaveformPointerMove);
      document.removeEventListener("pointerup", handleWaveformPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScrubbing]);

  // ---------- timeline scrubbing (mouse) ----------
  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".cursor-ew-resize")) return;

    const audio = audioRef.current;
    const timeline = timelineRef.current;
    const dur = durationRef.current > 0 ? durationRef.current : duration;

    if (!timeline || !audio || dur <= 0) return;

    setIsTimelineScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    }

    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * dur;

    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleTimelineMouseMove = (e: MouseEvent) => {
    const audio = audioRef.current;
    const timeline = timelineRef.current;
    const dur = durationRef.current > 0 ? durationRef.current : duration;

    if (!isTimelineScrubbing || !timeline || !audio || dur <= 0) return;

    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * dur;

    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleTimelineMouseUp = () => {
    if (!isTimelineScrubbing) return;

    setIsTimelineScrubbing(false);

    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    setWasPlayingBeforeScrub(false);
  };

  useEffect(() => {
    if (!isTimelineScrubbing) return;

    document.addEventListener("mousemove", handleTimelineMouseMove);
    document.addEventListener("mouseup", handleTimelineMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleTimelineMouseMove);
      document.removeEventListener("mouseup", handleTimelineMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimelineScrubbing]);

  // ---------- marker dragging ----------
  const handleMarkerDrag = (
    e: React.MouseEvent<HTMLDivElement>,
    marker: "cueIn" | "fadeStart" | "cueOut"
  ) => {
    e.preventDefault();
    setDragging(marker);

    const handleMouseMove = (ev: MouseEvent) => {
      const timeline = timelineRef.current;
      const dur = durationRef.current > 0 ? durationRef.current : duration;
      if (!timeline || dur <= 0) return;

      const rect = timeline.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      const percent = x / rect.width;
      let time = clamp(percent * dur, 0, dur);

      time = applySnap(time);

      if (marker === "cueIn") {
        applyConstraints({ cueIn: time }, dur);
      } else if (marker === "fadeStart") {
        const newFadeStart = clamp(time, cueIn, cueOut);
        applyConstraints({ segueDuration: cueOut - newFadeStart }, dur);
      } else if (marker === "cueOut") {
        applyConstraints({ cueOut: time }, dur);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const durForUI = durationRef.current > 0 ? durationRef.current : duration;
  const startPercent = durForUI > 0 ? (cueIn / durForUI) * 100 : 0;
  const fadePercent = durForUI > 0 ? ((cueOut - segueDuration) / durForUI) * 100 : 0;
  const endPercent = durForUI > 0 ? (cueOut / durForUI) * 100 : 0;

  return (
    // IMPORTANT: remove key-based remounting inside a portal
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        {/* Keep audio mounted; preload metadata */}
        <audio ref={audioRef} src={audioUrl} preload="metadata" />

        <div className="bg-gray-900 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{trackTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {/* Playback Controls */}
            <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg">
              <Button
                onClick={handlePlayPause}
                className="bg-blue-600 hover:bg-blue-700"
                size="lg"
              >
                {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
              </Button>
              <Button
                onClick={handleStop}
                className="bg-gray-700 hover:bg-gray-600"
                size="lg"
              >
                <Square className="h-6 w-6" />
              </Button>
              <div className="flex-1 text-center">
                <div className="text-2xl font-mono">
                  {formatTime(currentTime)} / {formatTime(durForUI)}
                </div>
              </div>

              {/* Snap Mode Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm">Snap:</span>
                <select
                  value={snapMode}
                  onChange={(e) => setSnapMode(e.target.value as "off" | "0.10" | "0.01")}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                >
                  <option value="off">Off</option>
                  <option value="0.10">0.10s</option>
                  <option value="0.01">0.01s</option>
                </select>
              </div>
            </div>

            {/* Waveform Visualization */}
            <div className="bg-gray-800 p-3 rounded-lg">
              <h3 className="font-bold mb-2 text-base">WAVEFORM</h3>
              <canvas
                ref={canvasRef}
                width={1300}
                height={120}
                className="w-full h-[120px] bg-gray-900 rounded cursor-crosshair"
                style={{ touchAction: "none" }}
                onPointerDown={handleWaveformPointerDown}
              />
            </div>

            {/* Timeline with Markers */}
            <div className="bg-gray-800 p-3 rounded-lg">
              <h3 className="font-bold mb-2 text-base">TIMELINE MARKERS</h3>
              <div className="bg-gray-800 p-2 rounded">
                <div className="flex justify-between text-sm mb-2">
                  <span>0:00</span>
                  <span>{formatTime(durForUI)}</span>
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
                    style={{ left: `${fadePercent}%` }}
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

                  {/* Active Region */}
                  <div
                    className="absolute top-0 bottom-0 bg-blue-500 opacity-30"
                    style={{
                      left: `${startPercent}%`,
                      width: `${endPercent - startPercent}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Numerical Inputs */}
            <div className="grid grid-cols-3 gap-6 bg-gray-800 p-6 rounded-lg">
              <div>
                <label className="block text-sm font-bold mb-2 text-green-400">
                  CUE IN (Start)
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
                  SEGUE DURATION (Fade Length)
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
                  CUE OUT (End)
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

            {/* Action Buttons */}
            <div className="flex justify-end gap-4">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-gray-700 text-base px-6 py-3"
                size="lg"
              >
                CANCEL
              </Button>
              <Button
                onClick={handleSave}
                className="bg-blue-600 hover:bg-blue-700 text-base px-6 py-3"
                size="lg"
              >
                SAVE CUE POINTS
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
