import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, Square } from "lucide-react";

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
}

export default function CuePointEditor({
  open,
  onOpenChange,
  trackId,
  trackTitle,
  audioUrl,
  initialCuePoints,
}: CuePointEditorProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  
  const [duration, setDuration] = useState(initialCuePoints.cueOut || 0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);

  // Reset values when modal opens
  useEffect(() => {
    setCueIn(initialCuePoints.cueIn);
    setCueOut(initialCuePoints.cueOut);
    setSegueDuration(initialCuePoints.segueDuration);
    setDuration(initialCuePoints.cueOut || 0);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [initialCuePoints, open]);

  // Load audio and generate waveform
  useEffect(() => {
    if (!audioRef.current || !open) return;
    
    const audio = audioRef.current;
    
    const handleLoadedMetadata = () => {
      const dur = audio.duration || 0;
      if (dur > 0 && !isNaN(dur)) {
        setDuration(dur);
        if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
          setCueOut(dur);
        }
        generateWaveform(audio);
      }
    };
    
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      audio.currentTime = 0;
    };
    
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    
    if (audio.readyState >= 1) {
      handleLoadedMetadata();
    }
    
    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
    };
  }, [audioUrl, open, initialCuePoints.cueOut]);

  // Generate waveform visualization
  const generateWaveform = async (audio: HTMLAudioElement) => {
    try {
      const response = await fetch(audio.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0);
      const samples = 500;
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
      console.error('Error generating waveform:', error);
      const placeholder = Array.from({ length: 500 }, () => Math.random() * 0.5 + 0.25);
      setWaveformData(placeholder);
    }
  };

  // Draw waveform on canvas
  useEffect(() => {
    if (!canvasRef.current || waveformData.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const width = canvas.width;
    const height = canvas.height;
    const barWidth = width / waveformData.length;
    
    ctx.clearRect(0, 0, width, height);
    
    waveformData.forEach((value, index) => {
      const barHeight = value * height * 0.8;
      const x = index * barWidth;
      const y = (height - barHeight) / 2;
      
      const time = (index / waveformData.length) * duration;
      if (time < cueIn || time > cueOut) {
        ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
      } else if (time >= cueOut - segueDuration) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.8)';
      } else {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
      }
      
      ctx.fillRect(x, y, barWidth - 1, barHeight);
    });
    
    if (currentTime > 0) {
      const x = (currentTime / duration) * width;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [waveformData, cueIn, cueOut, segueDuration, duration, currentTime]);

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
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/tracks/${trackId}/cue-points`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cueIn,
          cueOut,
          segueDuration,
        }),
      });

      if (response.ok) {
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Failed to save cue points:", error);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration === 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;

    // Snap to nearest marker
    const markers = [
      { name: "cueIn", value: cueIn, setter: setCueIn },
      { name: "fadeStart", value: cueOut - segueDuration, setter: (v: number) => setSegueDuration(cueOut - v) },
      { name: "cueOut", value: cueOut, setter: setCueOut },
    ];

    const closest = markers.reduce((prev, curr) => {
      return Math.abs(curr.value - time) < Math.abs(prev.value - time)
        ? curr
        : prev;
    });

    closest.setter(time);
  };

  const handleMarkerDrag = (e: React.MouseEvent, marker: string) => {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1400px]">
        <audio ref={audioRef} src={audioUrl} />
        
        <div className="bg-gray-900 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl">{trackTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
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
            </div>

            {/* Waveform Visualization */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h3 className="font-bold mb-4 text-lg">WAVEFORM</h3>
              <canvas
                ref={canvasRef}
                width={1300}
                height={200}
                className="w-full h-[200px] bg-gray-900 rounded cursor-crosshair"
                onClick={(e) => {
                  if (!canvasRef.current || !audioRef.current || duration === 0) return;
                  const rect = canvasRef.current.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percent = x / rect.width;
                  const time = percent * duration;
                  audioRef.current.currentTime = time;
                }}
              />
            </div>

            {/* Timeline with Markers */}
            <div className="bg-gray-800 p-6 rounded-lg">
              <h3 className="font-bold mb-4 text-lg">TIMELINE MARKERS</h3>
              <div className="bg-gray-800 p-4 rounded">
                <div className="flex justify-between text-sm mb-2">
                  <span>0:00</span>
                  <span>{formatTime(duration)}</span>
                </div>

                <div
                  ref={timelineRef}
                  className="relative h-24 bg-gray-700 rounded cursor-pointer"
                  onClick={handleTimelineClick}
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
                  className="w-full bg-gray-900 border-2 border-green-500 rounded px-4 py-3 text-lg font-mono"
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
                  className="w-full bg-gray-900 border-2 border-yellow-500 rounded px-4 py-3 text-lg font-mono"
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
                  className="w-full bg-gray-900 border-2 border-red-500 rounded px-4 py-3 text-lg font-mono"
                  step="0.1"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-4">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-gray-700 text-lg px-8 py-6"
                size="lg"
              >
                CANCEL
              </Button>
              <Button
                onClick={handleSave}
                className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-6"
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
