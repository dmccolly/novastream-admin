Yep — I can see the repo now, and I pulled the current client/src/components/CuePointEditor.tsx from dmccolly/novastream-admin.
Two important truths at once:
I can fix the duration bug in the code (right now, with a full file).
In this session, the GitHub connector lets me read/search, but it’s failing on update flows (I can’t reliably write changes back to the repo via the connector tools here). So I’m going to give you the entire corrected file to paste in, and it will fix the exact “0:00.00 / 0:00.00 but CueOut is 285.02” symptom.
Why your timer is stuck at 0:00 / 0:00
For streamed audio, browsers often leave audio.duration as 0, NaN, or Infinity. Your UI currently shows duration from audio.duration, so it sticks at zero. Meanwhile, you already have a real length in initialCuePoints.cueOut / cueOut (285.02).
Correct fix: compute an effective duration = browser duration if valid, otherwise fall back to cueOut.
✅ ENTIRE FILE — replace client/src/components/CuePointEditor.tsx with this
Tsx
Copy code
"use client";

import { useEffect, useRef, useState } from "react";
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
  trackType?: string;
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Duration must survive dialog re-renders
  const durationRef = useRef<number | null>(null);

  const [duration, setDuration] = useState<number>(0);
  const [cueIn, setCueIn] = useState<number>(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState<number>(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState<number>(
    initialCuePoints.segueDuration || 0
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const num = (v?: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const formatTime = (seconds?: number) => {
    const s = num(seconds);
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(2, "0")}`;
  };

  // Effective duration:
  // 1) real browser duration if finite
  // 2) else cueOut (DB-known length)
  // 3) else initialCuePoints.cueOut
  // 4) else 0
  const getEffectiveDuration = () => {
    const d = durationRef.current ?? duration;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;

    if (typeof cueOut === "number" && Number.isFinite(cueOut) && cueOut > 0) return cueOut;

    const initOut = initialCuePoints?.cueOut;
    if (typeof initOut === "number" && Number.isFinite(initOut) && initOut > 0) return initOut;

    return 0;
  };

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(v, max));

  const applyConstraints = (
    next: { cueIn?: number; cueOut?: number; segueDuration?: number },
    overrideDuration?: number
  ) => {
    const dur =
      overrideDuration && overrideDuration > 0
        ? overrideDuration
        : getEffectiveDuration();

    let newCueIn = num(next.cueIn ?? cueIn);
    let newCueOut = num(next.cueOut ?? cueOut);
    let newSegue = num(next.segueDuration ?? segueDuration);

    newCueIn = clamp(newCueIn, 0, dur);
    newCueOut = clamp(newCueOut, 0, dur);
    newSegue = clamp(newSegue, 0, dur);

    if (newCueIn > newCueOut - newSegue) newCueIn = Math.max(0, newCueOut - newSegue);
    if (newSegue > newCueOut - newCueIn) newSegue = newCueOut - newCueIn;

    setCueIn(newCueIn);
    setCueOut(newCueOut);
    setSegueDuration(newSegue);
  };

  // Reset cues when dialog opens (do NOT reset duration)
  useEffect(() => {
    if (!open) return;
    setCueIn(initialCuePoints.cueIn || 0);
    setCueOut(initialCuePoints.cueOut || 0);
    setSegueDuration(initialCuePoints.segueDuration || 0);
    setCurrentTime(0);
    setIsPlaying(false);

    // If browser duration never becomes valid for the stream, we still want UI to show something.
    // So seed durationRef from cueOut when available (but allow browser duration to override later).
    if (
      (durationRef.current == null || durationRef.current <= 0) &&
      typeof initialCuePoints.cueOut === "number" &&
      Number.isFinite(initialCuePoints.cueOut) &&
      initialCuePoints.cueOut > 0
    ) {
      durationRef.current = initialCuePoints.cueOut;
      setDuration(initialCuePoints.cueOut);
    }
  }, [open, trackId, initialCuePoints]);

  // Core: robust duration binding for stream + Radix Dialog
  useEffect(() => {
    if (!open) return;
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;

    const setDurationSafe = () => {
      if (cancelled) return;

      const d = audio.duration;

      // If we get a real duration from the browser, store it and update UI.
      if (Number.isFinite(d) && d > 0) {
        durationRef.current = d;
        setDuration(d);

        // Defaults if DB values are empty
        if (!initialCuePoints.cueOut) applyConstraints({ cueOut: d }, d);
        if (!initialCuePoints.segueDuration) {
          const def = trackType === "song" ? 3 : 0.5;
          applyConstraints({ segueDuration: def }, d);
        }
        return;
      }

      // If duration is not available (stream), fall back to cueOut so timer never shows 0:00/0:00
      const fallback = getEffectiveDuration();
      if (fallback > 0) {
        durationRef.current = fallback;
        setDuration(fallback);
      }
    };

    const onLoadedMetadata = () => setDurationSafe();
    const onCanPlayThrough = () => setDurationSafe();
    const onDurationChange = () => setDurationSafe();
    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0);

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("canplaythrough", onCanPlayThrough);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("timeupdate", onTimeUpdate);

    audio.src = audioUrl;
    audio.preload = "metadata";
    audio.load();

    // Immediate attempt + short polling fallback
    setDurationSafe();
    let ticks = 0;
    const poll = window.setInterval(() => {
      ticks++;
      if (durationRef.current && durationRef.current > 0) {
        window.clearInterval(poll);
        return;
      }
      setDurationSafe();
      if (ticks > 60) window.clearInterval(poll);
    }, 50);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("canplaythrough", onCanPlayThrough);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackId, audioUrl, trackType, initialCuePoints]);

  const handlePlayPause = async () => {
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
          description: "Browser blocked autoplay.",
          variant: "destructive",
        });
      }
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

  const handleSave = async () => {
    try {
      // SAME-ORIGIN: works on your DigitalOcean app at http://137.184.12.217:3006/*
      const res = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cueIn, cueOut, segueDuration }),
      });

      if (!res.ok) throw new Error();

      toast({ title: "Saved", description: "Cue points saved." });
      onSuccess?.();
      setTimeout(() => onOpenChange(false), 400);
    } catch {
      toast({
        title: "Save failed",
        description: "Could not save cue points.",
        variant: "destructive",
      });
    }
  };

  const durForUI = getEffectiveDuration();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        <audio ref={audioRef} preload="metadata" />

        <div className="bg-gray-900 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{trackTitle}</DialogTitle>
            <DialogDescription>
              Edit cue in/out and segue. Duration falls back to Cue Out for streamed audio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div className="flex items-center gap-4 bg-gray-800 p-4 rounded-lg">
              <Button onClick={handlePlayPause}>
                {isPlaying ? <Pause /> : <Play />}
              </Button>
              <Button onClick={handleStop}>
                <Square />
              </Button>

              <div className="flex-1 text-center text-2xl font-mono">
                {formatTime(currentTime)} / {formatTime(durForUI)}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 bg-gray-800 p-6 rounded-lg">
              <input
                type="number"
                value={cueIn.toFixed(2)}
                onChange={(e) => applyConstraints({ cueIn: parseFloat(e.target.value) || 0 })}
                className="bg-gray-900 border-2 border-green-500 rounded px-3 py-2 font-mono"
              />
              <input
                type="number"
                value={segueDuration.toFixed(2)}
                onChange={(e) =>
                  applyConstraints({ segueDuration: parseFloat(e.target.value) || 0 })
                }
                className="bg-gray-900 border-2 border-yellow-500 rounded px-3 py-2 font-mono"
              />
              <input
                type="number"
                value={cueOut.toFixed(2)}
                onChange={(e) => applyConstraints({ cueOut: parseFloat(e.target.value) || 0 })}
                className="bg-gray-900 border-2 border-red-500 rounded px-3 py-2 font-mono"
              />
            </div>

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
What you’ll see immediately after replacing the file
That top display will stop showing 0:00.00 / 0:00.00 as long as cueOut exists (like 285.02).
If the browser later learns a real audio.duration, it will override the fallback automatically.
If you want me to also eliminate the .toLocaleString() crash across the app, I can do that next by searching the repo for toLocaleString( and replacing those calls with a safe formatter (whole files only) — but one step at a time: the file above fixes the duration display that’s killing you right now.