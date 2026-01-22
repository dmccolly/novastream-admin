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
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, Save } from "lucide-react";
import { toast } from "sonner";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";

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
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regionsPlugin = useRef<RegionsPlugin | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  // Cue points in seconds
  const [cueIn, setCueIn] = useState(initialCuePoints?.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints?.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints?.segueDuration || 3);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!open || !waveformRef.current) return;

    // Create WaveSurfer instance
    wavesurfer.current = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "rgb(147, 51, 234)",
      progressColor: "rgb(168, 85, 247)",
      cursorColor: "rgb(255, 255, 255)",
      barWidth: 2,
      barGap: 1,
      height: 128,
      normalize: true,
      backend: "WebAudio",
    });

    // Add regions plugin for cue point markers
    regionsPlugin.current = wavesurfer.current.registerPlugin(RegionsPlugin.create());

    // Load audio
    wavesurfer.current.load(audioUrl);

    // Event listeners
    wavesurfer.current.on("ready", () => {
      const dur = wavesurfer.current?.getDuration() || 0;
      setDuration(dur);
      
      // Set default cue out if not set
      if (!initialCuePoints?.cueOut) {
        setCueOut(dur);
      }

      // Create initial regions
      createRegions();
    });

    wavesurfer.current.on("timeupdate", (time) => {
      setCurrentTime(time);
    });

    wavesurfer.current.on("play", () => setIsPlaying(true));
    wavesurfer.current.on("pause", () => setIsPlaying(false));

    return () => {
      wavesurfer.current?.destroy();
    };
  }, [open, audioUrl]);

  // Create visual regions for cue points
  const createRegions = () => {
    if (!regionsPlugin.current || !wavesurfer.current) return;

    // Clear existing regions
    regionsPlugin.current.clearRegions();

    const dur = wavesurfer.current.getDuration();

    // Cue In marker (green)
    regionsPlugin.current.addRegion({
      start: cueIn,
      end: cueIn + 0.1,
      color: "rgba(34, 197, 94, 0.3)",
      drag: true,
      resize: false,
    });

    // Cue Out marker (red)
    regionsPlugin.current.addRegion({
      start: cueOut,
      end: cueOut + 0.1,
      color: "rgba(239, 68, 68, 0.3)",
      drag: true,
      resize: false,
    });

    // Segue/Fade region (yellow)
    const segueStart = Math.max(0, cueOut - segueDuration);
    regionsPlugin.current.addRegion({
      start: segueStart,
      end: cueOut,
      color: "rgba(234, 179, 8, 0.2)",
      drag: false,
      resize: false,
    });
  };

  // Update regions when cue points change
  useEffect(() => {
    if (regionsPlugin.current && duration > 0) {
      createRegions();
    }
  }, [cueIn, cueOut, segueDuration, duration]);

  const togglePlayPause = () => {
    wavesurfer.current?.playPause();
  };

  const seekToCueIn = () => {
    wavesurfer.current?.setTime(cueIn);
  };

  const seekToCueOut = () => {
    wavesurfer.current?.setTime(Math.max(0, cueOut - 5)); // 5 seconds before cue out
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            Edit Cue Points: {trackTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Waveform Display */}
          <div className="bg-background/50 rounded-lg p-4 border border-border">
            <div ref={waveformRef} className="w-full" />
            
            {/* Playback Controls */}
            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={seekToCueIn}
                  title="Jump to Cue In"
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
                  title="Jump to Cue Out (5s before)"
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
            {/* Cue In */}
            <div className="space-y-2">
              <Label className="text-green-500 font-display">CUE IN (Start Point)</Label>
              <Input
                type="number"
                step="0.1"
                value={cueIn.toFixed(1)}
                onChange={(e) => setCueIn(parseFloat(e.target.value) || 0)}
                className="font-mono"
              />
              <Slider
                value={[cueIn]}
                onValueChange={([value]) => setCueIn(value)}
                max={duration}
                step={0.1}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground font-mono">
                {formatTime(cueIn)}
              </p>
            </div>

            {/* Cue Out */}
            <div className="space-y-2">
              <Label className="text-red-500 font-display">CUE OUT (End Point)</Label>
              <Input
                type="number"
                step="0.1"
                value={cueOut.toFixed(1)}
                onChange={(e) => setCueOut(parseFloat(e.target.value) || duration)}
                className="font-mono"
              />
              <Slider
                value={[cueOut]}
                onValueChange={([value]) => setCueOut(value)}
                max={duration}
                step={0.1}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground font-mono">
                {formatTime(cueOut)}
              </p>
            </div>

            {/* Segue Duration */}
            <div className="space-y-2">
              <Label className="text-yellow-500 font-display">SEGUE (Fade Duration)</Label>
              <Input
                type="number"
                step="0.5"
                value={segueDuration.toFixed(1)}
                onChange={(e) => setSegueDuration(parseFloat(e.target.value) || 0)}
                className="font-mono"
              />
              <Slider
                value={[segueDuration]}
                onValueChange={([value]) => setSegueDuration(value)}
                max={10}
                step={0.5}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground font-mono">
                {segueDuration.toFixed(1)}s fade
              </p>
            </div>
          </div>

          {/* Info Display */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-sm font-mono">
              <div>
                <span className="text-muted-foreground">Playback Start:</span>
                <div className="text-green-500 font-bold">{formatTime(cueIn)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Playback End:</span>
                <div className="text-red-500 font-bold">{formatTime(cueOut)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Effective Duration:</span>
                <div className="text-primary font-bold">{formatTime(cueOut - cueIn)}</div>
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
