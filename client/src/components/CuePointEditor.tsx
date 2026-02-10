import { useState, useRef, useEffect, useCallback } from "react";
import { X, Play, Pause, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

interface CuePointEditorProps {
  open: boolean;
  onClose: () => void;
  trackId: number;
  trackName: string;
  audioUrl: string;
  initialCueIn?: number;
  initialCueOut?: number;
  initialSegueDuration?: number;
  trackType?: string;
}

export default function CuePointEditor({
  open,
  onClose,
  trackId,
  trackName,
  audioUrl,
  initialCueIn = 0,
  initialCueOut = 0,
  initialSegueDuration = 0,
  trackType = "music",
}: CuePointEditorProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  
  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCueIn);
  const [cueOut, setCueOut] = useState(initialCueOut);
  const [segueDuration, setSegueDuration] = useState(initialSegueDuration);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [wasPlayingBeforeScrub, setWasPlayingBeforeScrub] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Initialize audio and load duration immediately
  useEffect(() => {
    if (!open) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      setDuration(dur);

      // Set default cue points if not already set
      if (initialCueOut === 0) {
        setCueOut(dur);
      }

      // Set default fade based on track type
      if (initialSegueDuration === 0) {
        if (trackType.toLowerCase() === "music") {
          setSegueDuration(3.0); // 3 seconds for music
        } else {
          setSegueDuration(0.5); // 0.5 seconds for commercials/jingles
        }
      }

      // Generate waveform data
      generateWaveformData(audio);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      audio.src = "";
    };
  }, [open, audioUrl, initialCueOut, initialSegueDuration, trackType]);

  const generateWaveformData = async (audio: HTMLAudioElement) => {
    try {
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0);
      const samples = 1300;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      
      for (let i = 0; i < samples; i++) {
        const blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      
      setWaveformData(filteredData);
    } catch (error) {
      console.error("Error generating waveform:", error);
    }
  };

  const getEffectiveDuration = useCallback(() => {
    return cueOut - cueIn;
  }, [cueIn, cueOut]);

  // Draw waveform
  useEffect(() => {
    // Ensure the canvas has mounted before drawing the waveform. When the dialog
    // first opens, React renders the component twice: once to measure layout and
    // again when refs have been attached. Without checking `open` here and
    // including it in the dependency list, the effect runs too early (when
    // `canvasRef.current` is still null) and never runs again, leaving the
    // waveform blank. By returning early when the dialog is closed and adding
    // `open` as a dependency, the waveform will always be drawn once the
    // canvas exists.
    if (!open) return;
    if (!canvasRef.current || waveformData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = canvas.width / waveformData.length;
    const maxAmplitude = Math.max(...waveformData);

    waveformData.forEach((amplitude, i) => {
      const x = i * barWidth;
      const barHeight = (amplitude / maxAmplitude) * (canvas.height - 10);
      const y = (canvas.height - barHeight) / 2;

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
  }, [open, waveformData, cueIn, cueOut, segueDuration, currentTime, getEffectiveDuration]);

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

  const handleReset = () => {
    if (!audioRef.current) return;
    setCueIn(0);
    setCueOut(duration);
    if (trackType.toLowerCase() === "music") {
      setSegueDuration(3.0);
    } else {
      setSegueDuration(0.5);
    }
    audioRef.current.currentTime = 0;
    setCurrentTime(0);
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cueIn,
          cueOut,
          segueDuration,
        }),
      });

      if (response.ok) {
        onClose();
      }
    } catch (error) {
      console.error("Error saving cue points:", error);
    }
  };

  const handleMouseDown = (marker: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(marker);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!dragging || !canvasRef.current || duration === 0) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(x / rect.width, 1));
    const time = percent * duration;

    if (dragging === "cueIn") {
      setCueIn(Math.max(0, Math.min(time, cueOut - 0.1)));
    } else if (dragging === "cueOut") {
      setCueOut(Math.max(cueIn + 0.1, Math.min(time, duration)));
    } else if (dragging === "fadeStart") {
      const newFadeStart = Math.max(cueIn, Math.min(time, cueOut - 0.1));
      setSegueDuration(cueOut - newFadeStart);
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  useEffect(() => {
    if (dragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, cueIn, cueOut, duration]);

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
    if (!timelineRef.current || !audioRef.current || duration === 0) return;
    
    setIsScrubbing(true);
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

  if (!open) return null;

  const cueInPercent = (cueIn / duration) * 100;
  const cueOutPercent = (cueOut / duration) * 100;
  const fadeStartPercent = ((cueOut - segueDuration) / duration) * 100;
  const currentPercent = (currentTime / duration) * 100;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-4 flex justify-between items-center z-10">
          <h2 className="text-xl font-bold text-white">{trackName}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <X className="text-white" size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Transport Controls */}
          <div className="flex items-center justify-between bg-gray-900 p-4 rounded-lg">
            <div className="flex items-center gap-4">
              <button
                onClick={handlePlayPause}
                className="p-3 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                {isPlaying ? (
                  <Pause className="text-white" size={24} />
                ) : (
                  <Play className="text-white" size={24} />
                )}
              </button>
              <button
                onClick={handleReset}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                title="Reset"
              >
                <RotateCcw className="text-white" size={20} />
              </button>
              <div className="text-white font-mono text-lg">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Zoom:</span>
              <button
                onClick={() => setZoom(Math.max(1, zoom - 0.5))}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="text-white" size={20} />
              </button>
              <span className="text-white font-mono text-sm w-12 text-center">
                {zoom}x
              </span>
              <button
                onClick={() => setZoom(Math.min(4, zoom + 0.5))}
                className="p-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="text-white" size={20} />
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-gray-900 p-4 rounded-lg">
            <p className="text-gray-300 text-sm text-center">
              SELECT A MARKER TO PLACE, THEN CLICK ON WAVEFORM
            </p>
            <div className="flex justify-center gap-6 mt-2">
              <button className="px-4 py-2 bg-green-600 text-white rounded">
                CUE IN (Start)
              </button>
              <button className="px-4 py-2 bg-yellow-600 text-white rounded">
                FADE START
              </button>
              <button className="px-4 py-2 bg-red-600 text-white rounded">
                CUE OUT (End)
              </button>
            </div>
          </div>

          {/* Waveform */}
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={1300}
                height={120}
                className="w-full h-[120px] bg-gray-900 rounded cursor-crosshair"
                onMouseDown={handleWaveformMouseDown}
              />
              
              {/* Cue In Marker */}
              <div
                style={{ left: `${cueInPercent}%` }}
                className="absolute top-0 bottom-0 w-1 bg-green-500 cursor-ew-resize"
                onMouseDown={handleMouseDown("cueIn")}
              >
                <div className="absolute -top-2 -left-2 w-4 h-4 bg-green-500 rounded-full border-2 border-white" />
              </div>

              {/* Fade Start Marker */}
              <div
                style={{ left: `${fadeStartPercent}%` }}
                className="absolute top-0 bottom-0 w-1 bg-yellow-500 cursor-ew-resize"
                onMouseDown={handleMouseDown("fadeStart")}
              >
                <div className="absolute -top-2 -left-2 w-4 h-4 bg-yellow-500 rounded-full border-2 border-white" />
              </div>

              {/* Cue Out Marker */}
              <div
                style={{ left: `${cueOutPercent}%` }}
                className="absolute top-0 bottom-0 w-1 bg-red-500 cursor-ew-resize"
                onMouseDown={handleMouseDown("cueOut")}
              >
                <div className="absolute -top-2 -left-2 w-4 h-4 bg-red-500 rounded-full border-2 border-white" />
              </div>

              {/* Current Time Marker */}
              <div
                style={{ left: `${currentPercent}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
              >
                <div className="absolute -top-1 -left-1.5 w-3 h-3 bg-white rounded-full" />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-gray-900 p-4 rounded-lg">
            <div className="space-y-2">
              <div className="text-gray-400 text-sm">WAVEFORM (DRAG MARKERS TO ADJUST)</div>
              <div className="relative">
                <div
                  ref={timelineRef}
                  className="relative h-16 bg-gray-700 rounded cursor-pointer"
                  onMouseDown={handleTimelineMouseDown}
                >
                  {/* Cue In Marker */}
                  <div
                    style={{ left: `${cueInPercent}%` }}
                    className="absolute top-0 bottom-0 w-1 bg-green-500"
                  />
                  {/* Fade Region */}
                  <div
                    style={{
                      left: `${fadeStartPercent}%`,
                      width: `${cueOutPercent - fadeStartPercent}%`,
                    }}
                    className="absolute top-0 bottom-0 bg-yellow-500 opacity-30"
                  />
                  {/* Cue Out Marker */}
                  <div
                    style={{ left: `${cueOutPercent}%` }}
                    className="absolute top-0 bottom-0 w-1 bg-red-500"
                  />
                  {/* Current Time */}
                  <div
                    style={{ left: `${currentPercent}%` }}
                    className="absolute top-0 bottom-0 w-0.5 bg-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Cue Point Values */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-900 border-2 border-green-600 rounded-lg p-4">
              <div className="text-green-400 text-sm font-semibold mb-2">
                CUE IN (Start)
              </div>
              <div className="text-white text-3xl font-mono">
                {formatTime(cueIn)}
              </div>
            </div>

            <div className="bg-yellow-900 border-2 border-yellow-600 rounded-lg p-4">
              <div className="text-yellow-400 text-sm font-semibold mb-2">
                SEGUE DURATION
                <br />
                (Fade Length)
              </div>
              <input
                type="number"
                value={segueDuration.toFixed(2)}
                onChange={(e) => setSegueDuration(parseFloat(e.target.value) || 0)}
                step="0.1"
                min="0"
                max={cueOut - cueIn}
                className="w-full bg-yellow-800 text-white text-3xl font-mono rounded px-2 py-1 border border-yellow-600"
              />
            </div>

            <div className="bg-red-900 border-2 border-red-600 rounded-lg p-4">
              <div className="text-red-400 text-sm font-semibold mb-2">
                CUE OUT (End)
              </div>
              <div className="text-white text-3xl font-mono">
                {formatTime(cueOut)}
              </div>
            </div>
          </div>

          {/* Save/Cancel Buttons */}
          <div className="flex justify-end gap-4">
            <button
              onClick={onClose}
              className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
