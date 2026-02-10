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
  const audioRef = useRef<HTMLAudioElement>(null);
  const { toast } = useToast();

  const durationRef = useRef(0);

  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const num = (v?: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

  const formatTime = (seconds?: number) => {
    const s = num(seconds);
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
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
        : durationRef.current || 0;

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

  useEffect(() => {
    if (!open) return;
    setCueIn(initialCuePoints.cueIn || 0);
    setCueOut(initialCuePoints.cueOut || 0);
    setSegueDuration(initialCuePoints.segueDuration || 0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [open, trackId, initialCuePoints]);

  useEffect(() => {
    if (!open || !audioRef.current) return;
    const audio = audioRef.current;

    const setDur = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);

        if (!initialCuePoints.cueOut) applyConstraints({ cueOut: audio.duration }, audio.duration);
        if (!initialCuePoints.segueDuration) {
          const def = trackType === "song" ? 3 : 0.5;
          applyConstraints({ segueDuration: def }, audio.duration);
        }
      }
    };

    audio.addEventListener("loadedmetadata", setDur);
    audio.addEventListener("canplaythrough", setDur);
    audio.addEventListener("durationchange", setDur);
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime || 0));

    audio.src = audioUrl;
    audio.preload = "metadata";
    audio.load();

    return () => {
      audio.removeEventListener("loadedmetadata", setDur);
      audio.removeEventListener("canplaythrough", setDur);
      audio.removeEventListener("durationchange", setDur);
    };
  }, [open, audioUrl, trackId, trackType]);

  const handlePlayPause = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
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
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSave = async () => {
    try {
      const res = await fetch(
        `http://137.184.12.217:3006/api/tracks/${trackId}/cuepoints`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cueIn, cueOut, segueDuration }),
        }
      );

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        <audio ref={audioRef} src={audioUrl} preload="metadata" />

        <div className="bg-gray-900 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{trackTitle}</DialogTitle>
            <DialogDescription>Edit cue in/out and segue.</DialogDescription>
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
                {formatTime(currentTime)} / {formatTime(durationRef.current)}
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
