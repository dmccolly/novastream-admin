import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square, Check, X } from "lucide-react";
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
  trackType = "other", // Default to "other" if not specified
  onSuccess,
}: CuePointEditorProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const lastTapRef = useRef<number>(0);
  const TAP_MS = 350;
  
  const [duration, setDuration] = useState(initialCuePoints.cueOut || 0);
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
  const [snapMode, setSnapMode] = useState<'off' | '0.10' | '0.01'>('off');
  const animationFrameRef = useRef<number | null>(null);

  // Helper: clamp value between min and max
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

  // Helper: sanitize numeric value
  const sanitize = (v: number) => {
    if (isNaN(v) || !isFinite(v)) return 0;
    return v;
  };

  // Helper: apply snap if enabled
  const applySnap = (value: number): number => {
    if (snapMode === 'off') return value;
    const snapValue = snapMode === '0.10' ? 0.1 : 0.01;
    return Math.round(value / snapValue) * snapValue;
  };

  // Canonical constraint function
  const applyConstraints = (next: { cueIn?: number; cueOut?: number; segueDuration?: number }) => {
    const dur = duration > 0 ? duration : Math.max(cueOut, 0);
    
    // Start with current values
    let newCueIn = sanitize(next.cueIn !== undefined ? next.cueIn : cueIn);
    let newCueOut = sanitize(next.cueOut !== undefined ? next.cueOut : cueOut);
    let newSegue = sanitize(next.segueDuration !== undefined ? next.segueDuration : segueDuration);
    
    // Clamp to duration bounds
    newCueIn = clamp(newCueIn, 0, dur);
    newCueOut = clamp(newCueOut, 0, dur);
    newSegue = Math.max(0, newSegue);
    
    // Enforce cueIn <= cueOut - segueDuration
    if (newCueIn > newCueOut - newSegue) {
      if (next.cueIn !== undefined) {
        // User changed cueIn, adjust it
        newCueIn = Math.max(0, newCueOut - newSegue);
      } else if (next.cueOut !== undefined) {
        // User changed cueOut, adjust it
        newCueOut = Math.min(dur, newCueIn + newSegue);
      } else if (next.segueDuration !== undefined) {
        // User changed segue, adjust it
        newSegue = Math.max(0, newCueOut - newCueIn);
      }
    }
    
    // Enforce segueDuration <= cueOut - cueIn
    if (newSegue > newCueOut - newCueIn) {
      newSegue = newCueOut - newCueIn;
    }
    
    // Apply all updates
    setCueIn(newCueIn);
    setCueOut(newCueOut);
    setSegueDuration(newSegue);
  };

  // Reset values when modal opens and generate initial waveform
  useEffect(() => {
    if (!open) return;
    
    const initialDuration = initialCuePoints.cueOut || 0;
    setDuration(initialDuration);
    
    // Apply constraints to initial values
    applyConstraints({
      cueIn: initialCuePoints.cueIn,
      cueOut: initialCuePoints.cueOut,
      segueDuration: initialCuePoints.segueDuration
    });
    
    setCurrentTime(0);
    setIsPlaying(false);
    
    // Generate placeholder waveform immediately
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
  }, [initialCuePoints, open, trackType]);

  // Helper: try to fetch audio buffer with fallback strategies
  const tryFetchAudioBuffer = async (url: string): Promise<ArrayBuffer | null> => {
    try {
      // Try normal fetch first
      const response = await fetch(url, { mode: "cors" });
      if (response.ok) {
        return await response.arrayBuffer();
      }
    } catch (error) {
      console.log('Normal fetch failed, trying range fetch');
    }
    
    try {
      // Try range fetch as fallback
      const response = await fetch(url, {
        headers: { Range: "bytes=0-2000000" },
        mode: "cors"
      });
      if (response.ok) {
        return await response.arrayBuffer();
      }
    } catch (error) {
      console.log('Range fetch failed');
    }
    
    return null;
  };

  // Generate waveform visualization
  const generateWaveform = async (audio: HTMLAudioElement) => {
    // Keep placeholder waveform (already set)
    
    // Try to generate real waveform in background (non-blocking)
    try {
      const arrayBuffer = await tryFetchAudioBuffer(audio.src);
      
      if (!arrayBuffer) {
        throw new Error('Could not fetch audio data');
      }
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const samples = 500;
      const rawData = audioBuffer.getChannelData(0);
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData: number[] = [];
      
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      
      const max = Math.max(...filteredData);
      const normalized = filteredData.map(n => n / max);
      setWaveformData(normalized);
    } catch (error) {
      console.log('Using simplified waveform (stream is not decodable)');
      // Keep placeholder waveform
    }
  };

  // Load audio and generate waveform
  useEffect(() => {
    if (!audioRef.current || !open) return;
    
    const audio = audioRef.current;
    
    // Immediately check if duration is already available
    if (audio.readyState >= 1 && audio.duration > 0 && !isNaN(audio.duration)) {
      console.log('Duration immediately available:', audio.duration);
      setDuration(audio.duration);
      if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
        applyConstraints({ cueOut: audio.duration });
      }
      if (initialCuePoints.segueDuration === 0 || !initialCuePoints.segueDuration) {
        const defaultSegue = trackType === "song" ? 3.0 : 0.5;
        applyConstraints({ segueDuration: defaultSegue });
      }
      generateWaveform(audio);
    }
    
    const updateDurationDisplay = (dur: number) => {
      setDuration(dur);
      
      // Set default cueOut if not already set
      if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
        applyConstraints({ cueOut: dur });
      }
      
      // Set default segueDuration if not already set (or if it's 0)
      if (initialCuePoints.segueDuration === 0 || !initialCuePoints.segueDuration) {
        const defaultSegue = trackType === "song" ? 3.0 : 0.5;
        applyConstraints({ segueDuration: defaultSegue });
      }
    };
    
    const handleLoadedMetadata = () => {
      const dur = audio.duration || 0;
      if (dur > 0 && !isNaN(dur)) {
        updateDurationDisplay(dur);
        generateWaveform(audio);
      }
    };
    
    const handleTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    
    // Poll for duration availability
    let attempts = 0;
    const maxAttempts = 50;
    let pollInterval: number | null = null;
    
    const checkDuration = () => {
      attempts++;
      
      if (audio.readyState >= 1 && audio.duration > 0 && !isNaN(audio.duration)) {
        updateDurationDisplay(audio.duration);
        generateWaveform(audio);
        if (pollInterval !== null) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return true;
      }
      
      if (attempts >= maxAttempts) {
        if (pollInterval !== null) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (initialCuePoints.cueOut > 0) {
          updateDurationDisplay(initialCuePoints.cueOut);
        }
        return false;
      }
      
      return false;
    };
    
    audio.load();
    
    if (!checkDuration()) {
      pollInterval = window.setInterval(checkDuration, 50);
    }
    
    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      if (pollInterval !== null) {
        clearInterval(pollInterval);
      }
    };
  }, [audioUrl, open, initialCuePoints, trackType]);

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

    waveformData.forEach((value, i) => {
      const barHeight = value * height * 0.8;
      const x = i * barWidth;
      const y = (height - barHeight) / 2;

      // Determine color based on position
      const position = (i / waveformData.length) * duration;
      let color = "#3b82f6"; // blue
      
      if (position < cueIn) {
        color = "#6b7280"; // gray
      } else if (position >= cueIn && position < cueOut - segueDuration) {
        color = "#3b82f6"; // blue
      } else if (position >= cueOut - segueDuration && position < cueOut) {
        color = "#eab308"; // yellow
      } else {
        color = "#6b7280"; // gray
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });

    // Draw borders around fade section for visibility
    if (segueDuration > 0 && cueOut > 0) {
      const fadeStartX = ((cueOut - segueDuration) / duration) * width;
      const fadeEndX = (cueOut / duration) * width;
      
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

    // Draw playback cursor line
    if (currentTime > 0 && duration > 0) {
      const cursorX = (currentTime / duration) * width;
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
        const time = audioRef.current.currentTime;
        setCurrentTime(time);
      }
      
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms
      .toString()
      .padStart(2, "0")}`;
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
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
    console.log("Saving cue points:", { trackId, cueIn, cueOut, segueDuration });
    try {
      const response = await fetch(`${window.location.origin}/api/tracks/${trackId}/cuepoints`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cueIn,
          cueOut,
          segueDuration,
        }),
      });

      console.log("Save response:", response.status, response.ok);

      if (response.ok) {
        console.log("Showing success toast");
        toast({
          title: "Success",
          description: "Cue points saved successfully",
        });
        if (onSuccess) {
          onSuccess();
        }
        setTimeout(() => onOpenChange(false), 500);
      } else {
        console.log("Showing error toast - response not ok");
        toast({
          title: "Error",
          description: `Failed to save cue points (${response.status})`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to save cue points:", error);
      console.log("Showing error toast - exception");
      toast({
        title: "Error",
        description: "Failed to save cue points",
        variant: "destructive",
      });
    }
  };

  // Waveform pointer down handler (mobile-friendly)
  const handleWaveformPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !audioRef.current || duration === 0) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const t0 = percent * duration;
    
    // Seek immediately
    audioRef.current.currentTime = t0;
    setCurrentTime(t0);
    
    // Check for double tap
    const now = Date.now();
    if (now - lastTapRef.current < TAP_MS) {
      // Double tap: toggle play/pause
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      lastTapRef.current = 0;
      return;
    }
    
    // Single tap: set up for potential scrubbing
    lastTapRef.current = now;
    setIsScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleWaveformPointerMove = (e: PointerEvent) => {
    if (!isScrubbing || !canvasRef.current || !audioRef.current || duration === 0) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = clamp(x / rect.width, 0, 1);
    const time = percent * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformPointerUp = () => {
    if (!isScrubbing) return;
    
    setIsScrubbing(false);
    
    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
    
    setWasPlayingBeforeScrub(false);
  };

  // Add global pointer listeners for scrubbing
  useEffect(() => {
    if (isScrubbing) {
      document.addEventListener('pointermove', handleWaveformPointerMove);
      document.addEventListener('pointerup', handleWaveformPointerUp);
      
      return () => {
        document.removeEventListener('pointermove', handleWaveformPointerMove);
        document.removeEventListener('pointerup', handleWaveformPointerUp);
      };
    }
  }, [isScrubbing, duration]);

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't interfere with marker dragging
    if ((e.target as HTMLElement).closest('.cursor-ew-resize')) return;
    
    if (!timelineRef.current || !audioRef.current || duration === 0) return;
    
    setIsTimelineScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);
    
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));
    const time = percent * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleTimelineMouseMove = (e: MouseEvent) => {
    if (!isTimelineScrubbing || !timelineRef.current || !audioRef.current || duration === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));
    const time = percent * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleTimelineMouseUp = () => {
    if (!isTimelineScrubbing) return;
    
    setIsTimelineScrubbing(false);
    
    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
    
    setWasPlayingBeforeScrub(false);
  };

  // Add global mouse listeners for timeline scrubbing
  useEffect(() => {
    if (isTimelineScrubbing) {
      document.addEventListener('mousemove', handleTimelineMouseMove);
      document.addEventListener('mouseup', handleTimelineMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleTimelineMouseMove);
        document.removeEventListener('mouseup', handleTimelineMouseUp);
      };
    }
  }, [isTimelineScrubbing, duration]);

  const handleMarkerDrag = (
    e: React.MouseEvent<HTMLDivElement>,
    marker: "cueIn" | "fadeStart" | "cueOut"
  ) => {
    e.preventDefault();
    setDragging(marker);

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || duration === 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = x / rect.width;
      let time = clamp(percent * duration, 0, duration);
      
      // Apply snap
      time = applySnap(time);

      if (marker === "cueIn") {
        applyConstraints({ cueIn: time });
      } else if (marker === "fadeStart") {
        const newFadeStart = clamp(time, cueIn, cueOut);
        applyConstraints({ segueDuration: cueOut - newFadeStart });
      } else if (marker === "cueOut") {
        applyConstraints({ cueOut: time });
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

  const startPercent = duration > 0 ? (cueIn / duration) * 100 : 0;
  const fadePercent = duration > 0 ? ((cueOut - segueDuration) / duration) * 100 : 0;
  const endPercent = duration > 0 ? (cueOut / duration) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} key={open ? trackId : 'closed'}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        <audio ref={audioRef} src={audioUrl} />
        
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
                <div className="text-2xl font-mono">{formatTime(currentTime)} / {formatTime(duration)}</div>
              </div>
              
              {/* Snap Mode Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm">Snap:</span>
                <select
                  value={snapMode}
                  onChange={(e) => setSnapMode(e.target.value as 'off' | '0.10' | '0.01')}
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
                  <span>{formatTime(duration)}</span>
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
