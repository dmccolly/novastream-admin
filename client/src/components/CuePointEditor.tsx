import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, Pause, SkipBack, SkipForward, Save } from "lucide-react";
import { toast } from "sonner";
import WaveSurfer from "wavesurfer.js";

interface CuePointEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  trackTitle: string;
  audioUrl: string;
  initialCuePoints?: {
    cueIn: number;
    cueOut: number;
    segueDuration: number;
  };
  onSave: (cuePoints: { cueIn: number; cueOut: number; segueDuration: number }) => void;
}

export default function CuePointEditor({
  open,
  onOpenChange,
  trackId,
  trackTitle,
  audioUrl,
  initialCuePoints,
  onSave,
}: CuePointEditorProps) {
  const [waveformContainer, setWaveformContainer] = useState<HTMLDivElement | null>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const waveformWrapperRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Cue points in seconds
  const [cueIn, setCueIn] = useState(initialCuePoints?.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints?.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints?.segueDuration || 3);

  // Dragging state
  const [draggingMarker, setDraggingMarker] = useState<'cueIn' | 'fadeStart' | 'cueOut' | null>(null);

  // Callback ref to capture the container element when it mounts
  const waveformRef = (node: HTMLDivElement | null) => {
    if (node !== null) {
      setWaveformContainer(node);
    }
  };

  // Initialize WaveSurfer when container is available
  useEffect(() => {
    if (!open || !waveformContainer || !audioUrl) {
      return;
    }

    // Create WaveSurfer instance
    wavesurfer.current = WaveSurfer.create({
      container: waveformContainer,
      waveColor: "rgb(147, 51, 234)",
      progressColor: "rgb(168, 85, 247)",
      cursorColor: "rgb(255, 255, 255)",
      barWidth: 2,
      barGap: 1,
      height: 128,
      normalize: true,
    });

    // Load audio after creation
    wavesurfer.current.load(audioUrl);

    // Event listeners
    wavesurfer.current.on("ready", () => {
      const dur = wavesurfer.current?.getDuration() || 0;
      setDuration(dur);
      
      // Set default cue out if not set
      if (!initialCuePoints?.cueOut) {
        setCueOut(dur);
      }
    });

    wavesurfer.current.on("timeupdate", (time) => {
      setCurrentTime(time);
    });

    wavesurfer.current.on("play", () => setIsPlaying(true));
    wavesurfer.current.on("pause", () => setIsPlaying(false));
    wavesurfer.current.on("error", (error) => {
      console.error("WaveSurfer error:", error);
      toast.error("Failed to load audio waveform");
    });

    return () => {
      wavesurfer.current?.destroy();
    };
  }, [open, audioUrl, waveformContainer]);

  // Convert time to pixel position
  const timeToPixel = (time: number): number => {
    if (!waveformWrapperRef.current || duration === 0) return 0;
    const width = waveformWrapperRef.current.clientWidth;
    return (time / duration) * width;
  };

  // Convert pixel position to time
  const pixelToTime = (pixel: number): number => {
    if (!waveformWrapperRef.current || duration === 0) return 0;
    const width = waveformWrapperRef.current.clientWidth;
    return (pixel / width) * duration;
  };

  // Handle marker drag start
  const handleMarkerMouseDown = (marker: 'cueIn' | 'fadeStart' | 'cueOut') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingMarker(marker);
  };

  // Handle mouse move for dragging
  useEffect(() => {
    if (!draggingMarker || !waveformWrapperRef.current) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = waveformWrapperRef.current!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(duration, pixelToTime(x)));

      if (draggingMarker === 'cueIn') {
        setCueIn(Math.min(time, cueOut - 0.5));
      } else if (draggingMarker === 'fadeStart') {
        const newFadeDuration = cueOut - time;
        setSegueDuration(Math.max(0, Math.min(10, newFadeDuration)));
      } else if (draggingMarker === 'cueOut') {
        setCueOut(Math.max(time, cueIn + 0.5));
      }
    };

    const handleMouseUp = () => {
      setDraggingMarker(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingMarker, duration, cueIn, cueOut]);

  const togglePlayPause = () => {
    wavesurfer.current?.playPause();
  };

  const seekToCueIn = () => {
    wavesurfer.current?.setTime(cueIn);
  };

  const seekToCueOut = () => {
    wavesurfer.current?.setTime(Math.max(0, cueOut - 5));
  };

  const handleSave = () => {
    onSave({ cueIn, cueOut, segueDuration });
    toast.success("Cue points saved");
    onOpenChange(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const fadeStart = cueOut - segueDuration;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Edit Cue Points: {trackTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Waveform Display with Custom Markers */}
          <div className="bg-background/50 rounded-lg p-4 border border-border">
            <div className="relative" ref={waveformWrapperRef}>
              <div ref={waveformRef} className="w-full min-h-[128px]" />
              
              {/* Custom Marker Overlays */}
              {duration > 0 && (
                <>
                  {/* Fade Region (Yellow shaded area) */}
                  <div
                    className="absolute top-0 bottom-0 bg-yellow-500/20 border-l-2 border-r-2 border-yellow-500 pointer-events-none"
                    style={{
                      left: `${timeToPixel(fadeStart)}px`,
                      width: `${timeToPixel(cueOut) - timeToPixel(fadeStart)}px`,
                    }}
                  />

                  {/* Cue In Marker (Green) */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-green-500 cursor-ew-resize"
                    style={{ left: `${timeToPixel(cueIn)}px` }}
                  >
                    <div
                      className="absolute -top-8 left-1/2 -translate-x-1/2 bg-green-500 text-white px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap cursor-grab active:cursor-grabbing shadow-lg"
                      onMouseDown={handleMarkerMouseDown('cueIn')}
                    >
                      ▼ PLAY START
                    </div>
                  </div>

                  {/* Fade Start Marker (Yellow) */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 cursor-ew-resize"
                    style={{ left: `${timeToPixel(fadeStart)}px` }}
                  >
                    <div
                      className="absolute -top-8 left-1/2 -translate-x-1/2 bg-yellow-500 text-black px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap cursor-grab active:cursor-grabbing shadow-lg"
                      onMouseDown={handleMarkerMouseDown('fadeStart')}
                    >
                      ▼ FADE START
                    </div>
                  </div>

                  {/* Cue Out Marker (Red) */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 cursor-ew-resize"
                    style={{ left: `${timeToPixel(cueOut)}px` }}
                  >
                    <div
                      className="absolute -top-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-3 py-1 rounded-md text-xs font-bold whitespace-nowrap cursor-grab active:cursor-grabbing shadow-lg"
                      onMouseDown={handleMarkerMouseDown('cueOut')}
                    >
                      ▼ PLAY END
                    </div>
                  </div>
                </>
              )}
            </div>
            
            {/* Playback Controls */}
            <div className="flex items-center justify-between mt-12">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={seekToCueIn}
                  title="Jump to Play Start"
                >
                  <SkipBack className="h-4 w-4" />
                </Button>
                <Button
                  variant="default"
                  size="icon"
                  onClick={togglePlayPause}
                >
                  {isPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={seekToCueOut}
                  title="Jump to Play End (5s before)"
                >
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
              <div className="font-mono text-sm text-muted-foreground">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>

          {/* Cue Point Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Play Start */}
            <div className="space-y-2">
              <Label className="text-green-500 font-display text-base">PLAY START</Label>
              <Input
                type="number"
                step="0.1"
                value={cueIn.toFixed(2)}
                onChange={(e) => setCueIn(Math.max(0, Math.min(parseFloat(e.target.value) || 0, cueOut - 0.5)))}
                className="font-mono text-lg"
              />
              <p className="text-sm text-muted-foreground">
                Track begins playing at {formatTime(cueIn)}
              </p>
            </div>

            {/* Fade Duration */}
            <div className="space-y-2">
              <Label className="text-yellow-500 font-display text-base">FADE DURATION</Label>
              <Input
                type="number"
                step="0.5"
                value={segueDuration.toFixed(1)}
                onChange={(e) => setSegueDuration(Math.max(0, Math.min(parseFloat(e.target.value) || 0, 10)))}
                className="font-mono text-lg"
              />
              <p className="text-sm text-muted-foreground">
                {segueDuration.toFixed(1)}s crossfade before end
              </p>
            </div>

            {/* Play End */}
            <div className="space-y-2">
              <Label className="text-red-500 font-display text-base">PLAY END</Label>
              <Input
                type="number"
                step="0.1"
                value={cueOut.toFixed(2)}
                onChange={(e) => setCueOut(Math.max(cueIn + 0.5, Math.min(parseFloat(e.target.value) || duration, duration)))}
                className="font-mono text-lg"
              />
              <p className="text-sm text-muted-foreground">
                Track stops playing at {formatTime(cueOut)}
              </p>
            </div>
          </div>

          {/* Info Display */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Effective Duration:</span>
                <div className="text-primary font-bold font-mono text-lg">{formatTime(cueOut - cueIn)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Fade Starts At:</span>
                <div className="text-yellow-500 font-bold font-mono text-lg">{formatTime(fadeStart)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Next Track Cue:</span>
                <div className="text-blue-500 font-bold font-mono text-lg">{formatTime(fadeStart)}</div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} className="bg-primary">
            <Save className="h-4 w-4 mr-2" />
            Save Cue Points
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
