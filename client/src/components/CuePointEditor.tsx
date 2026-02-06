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
}

export default function CuePointEditor({
  open,
  onOpenChange,
  trackId,
  trackTitle,
  audioUrl,
  initialCuePoints,
  trackType = "other", // Default to "other" if not specified
}: CuePointEditorProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  
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

  // Reset values when modal opens and generate initial waveform
  useEffect(() => {
    if (!open) return;
    
    setCueIn(initialCuePoints.cueIn);
    setCueOut(initialCuePoints.cueOut);
    setSegueDuration(initialCuePoints.segueDuration);
    
    // CRITICAL: Use initialCuePoints.cueOut as the initial duration
    // This is the track's actual duration from the database
    const initialDuration = initialCuePoints.cueOut || 0;
    setDuration(initialDuration);
    
    // Update display immediately with database duration
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };
    
    if (initialDuration > 0) {
      // Duration will be set by the polling mechanism
      // No DOM manipulation needed
    }
    
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

  // Load audio and generate waveform
  useEffect(() => {
    if (!audioRef.current || !open) return;
    
    const audio = audioRef.current;
    
    const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };
    
    const updateDurationDisplay = (dur: number) => {
      setDuration(dur);
      
      // Set default cueOut if not already set
      if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
        setCueOut(dur);
      }
      
      // Set default segueDuration if not already set (or if it's 0)
      if (initialCuePoints.segueDuration === 0 || !initialCuePoints.segueDuration) {
        const defaultSegue = trackType === "song" ? 3.0 : 0.5;
        setSegueDuration(defaultSegue);
      }
      
      // NO DOM MANIPULATION - Let React handle the rendering
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
      // React will handle rendering - no DOM manipulation needed
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    
    // CRITICAL FIX: Poll for duration availability
    let attempts = 0;
    const maxAttempts = 50; // 50 attempts * 50ms = 2.5 seconds max
    let pollInterval: number | null = null;
    
    const checkDuration = () => {
      attempts++;
      
      if (audio.readyState >= 1 && audio.duration > 0 && !isNaN(audio.duration)) {
        // Duration is available!
        updateDurationDisplay(audio.duration);
        generateWaveform(audio);
        if (pollInterval !== null) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return true;
      }
      
      if (attempts >= maxAttempts) {
        // Give up and use initialCuePoints.cueOut as fallback
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
    
    // Start polling immediately
    audio.load();
    
    // Try immediately
    if (!checkDuration()) {
      // If not available, start polling every 50ms
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
  }, [audioUrl, open, initialCuePoints]);

  // Generate waveform visualization
  const generateWaveform = async (audio: HTMLAudioElement) => {
    // Create a realistic-looking waveform pattern immediately
    const samples = 500;
    const waveform: number[] = [];
    
    for (let i = 0; i < samples; i++) {
      // Create a natural-looking waveform with variation
      const position = i / samples;
      const base = 0.3 + Math.sin(position * Math.PI * 8) * 0.2;
      const variation = Math.random() * 0.3;
      const fadeIn = Math.min(position * 5, 1);
      const fadeOut = Math.min((1 - position) * 5, 1);
      waveform.push((base + variation) * fadeIn * fadeOut);
    }
    
    setWaveformData(waveform);
    
    // Try to generate real waveform in background (non-blocking)
    try {
      const response = await fetch(audio.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
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
      console.log('Could not generate detailed waveform, using placeholder');
    }
  };

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

      // Highlight current playback position
      if (Math.abs(position - currentTime) < duration / waveformData.length) {
        color = "#ef4444"; // red
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });
  }, [waveformData, cueIn, cueOut, segueDuration, currentTime, duration]);

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

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !audioRef.current || duration === 0) return;

    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;

    audioRef.current.currentTime = time;
  };

  const handleWaveformMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !audioRef.current || duration === 0) return;
    
    setIsScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);
    
    // Pause audio while scrubbing
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    
    // Set initial position
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));
    const time = percent * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformMouseMove = (e: MouseEvent) => {
    if (!isScrubbing || !canvasRef.current || !audioRef.current || duration === 0) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));
    const time = percent * duration;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleWaveformMouseUp = () => {
    if (!isScrubbing) return;
    
    setIsScrubbing(false);
    
    // Resume playback if it was playing before scrubbing
    if (wasPlayingBeforeScrub && audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
    
    setWasPlayingBeforeScrub(false);
  };

  // Add global mouse listeners for scrubbing
  useEffect(() => {
    if (isScrubbing) {
      document.addEventListener('mousemove', handleWaveformMouseMove);
      document.addEventListener('mouseup', handleWaveformMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handleWaveformMouseMove);
        document.removeEventListener('mouseup', handleWaveformMouseUp);
      };
    }
  }, [isScrubbing, duration]);

  const handleTimelineMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't interfere with marker dragging
    if ((e.target as HTMLElement).closest('.cursor-ew-resize')) return;
    
    if (!timelineRef.current || !audioRef.current || duration === 0) return;
    
    setIsTimelineScrubbing(true);
    setWasPlayingBeforeScrub(isPlaying);
    
    // Pause audio while scrubbing
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    
    // Set initial position
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
    
    // Resume playback if it was playing before scrubbing
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
      const time = Math.max(0, Math.min(percent * duration, duration));

      if (marker === "cueIn") {
        setCueIn(Math.min(time, cueOut - segueDuration));
      } else if (marker === "fadeStart") {
        const newFadeStart = Math.max(cueIn, Math.min(time, cueOut));
        setSegueDuration(cueOut - newFadeStart);
      } else if (marker === "cueOut") {
        setCueOut(Math.max(time, cueIn + segueDuration));
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
                <div className="text-2xl font-mono" data-time-display>{formatTime(currentTime)} / {formatTime(duration)}</div>
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
                onMouseDown={handleWaveformMouseDown}
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
                  onChange={(e) => setCueIn(parseFloat(e.target.value) || 0)}
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
                  onChange={(e) =>
                    setSegueDuration(parseFloat(e.target.value) || 0)
                  }
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
                  onChange={(e) => setCueOut(parseFloat(e.target.value) || 0)}
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
