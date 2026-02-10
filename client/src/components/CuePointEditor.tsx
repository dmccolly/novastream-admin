"use client";

import React, { useEffect, useRef, useState } from "react";
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

  // IMPORTANT: duration must not depend on cueOut, but we WILL use cueOut as a fallback for streamed audio.
  const [duration, setDuration] = useState(0);
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

  // ---------------- helpers ----------------
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  const sanitize = (v: number) => (isNaN(v) || !isFinite(v) ? 0 : v);

  const applySnap = (value: number): number => {
    if (snapMode === "off") return value;
    const snapValue = snapMode === "0.10" ? 0.1 : 0.01;
    return Math.round(value / snapValue) * snapValue;
  };

  // The one source of truth the UI uses:
  // If browser gives a real duration, use it. Otherwise use cueOut (which you already have).
  const getEffectiveDuration = () => {
    const d = durationRef.current > 0 ? durationRef.current : duration;
    if (d > 0) return d;
    if (cueOut > 0) return cueOut; // fallback for streamed audio where duration never becomes finite
    return 0;
  };

  const formatTime = (seconds: number) => {
    const s = sanitize(seconds);
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // Canonical constraints, but use effective duration
 
