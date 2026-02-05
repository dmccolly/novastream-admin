import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const timelineRef = useRef<HTMLDivElement>(null);
  
  // Initialize duration with cueOut if available, otherwise 0
  const [duration, setDuration] = useState(initialCuePoints.cueOut || 0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration);
  const [dragging, setDragging] = useState<string | null>(null);

  // Reset values when modal opens or initialCuePoints change
  useEffect(() => {
    setCueIn(initialCuePoints.cueIn);
    setCueOut(initialCuePoints.cueOut);
    setSegueDuration(initialCuePoints.segueDuration);
    setDuration(initialCuePoints.cueOut || 0);
  }, [initialCuePoints, open]);

  // Try to load audio metadata in the background
  useEffect(() => {
    if (audioRef.current && open) {
      const audio = audioRef.current;
      
      const handleLoadedMetadata = () => {
        const dur = audio.duration || 0;
        if (dur > 0 && !isNaN(dur)) {
          setDuration(dur);
          // If no cueOut was set, use full duration
          if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
            setCueOut(dur);
          }
        }
      };
      
      const handleError = () => {
        // On error, keep using the fallback duration from cueOut
        if (initialCuePoints.cueOut > 0) {
          setDuration(initialCuePoints.cueOut);
        }
      };
      
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('error', handleError);
      
      // Try to load immediately if already loaded
      if (audio.readyState >= 1) {
        handleLoadedMetadata();
      }
      
      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('error', handleError);
      };
    }
  }, [audioUrl, open, initialCuePoints.cueOut]);

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
    return `${mins}:${secs.toString().padStart(2, "0")}`;
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
      <DialogContent className="max-w-7xl">
        {/* Hidden audio element for loading metadata */}
        <audio ref={audioRef} src={audioUrl} style={{display: 'none'}} />
        
        <div className="bg-gray-900 text-white">
          <DialogHeader>
            <DialogTitle className="text-xl">Edit Cue Points: {trackTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="bg-blue-600 p-4 rounded">
              <h3 className="font-bold mb-2">How to Set Cue Points</h3>
              <ol className="text-sm space-y-1">
                <li>1. Drag the colored markers on the timeline to set positions</li>
                <li>2. Green = Cue In (start), Yellow = Fade Start, Red = Cue Out (end)</li>
                <li>3. Click "SAVE" to apply changes</li>
              </ol>
            </div>

            <div>
              <h3 className="font-bold mb-2">Timeline</h3>
              <div className="bg-gray-800 p-4 rounded">
                <div className="flex justify-between text-sm mb-2">
                  <span>0:00</span>
                  <span>{formatTime(duration)}</span>
                </div>

                <div
                  ref={timelineRef}
                  className="relative h-16 bg-gray-700 rounded cursor-pointer"
                  onClick={handleTimelineClick}
                >
                  {/* Cue In Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-green-500 cursor-ew-resize hover:w-2 transition-all"
                    style={{ left: `${startPercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "cueIn")}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap">
                      {formatTime(cueIn)}
                    </div>
                  </div>

                  {/* Fade Start Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-yellow-500 cursor-ew-resize hover:w-2 transition-all"
                    style={{ left: `${fadePercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "fadeStart")}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap">
                      {formatTime(cueOut - segueDuration)}
                    </div>
                  </div>

                  {/* Cue Out Marker */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-red-500 cursor-ew-resize hover:w-2 transition-all"
                    style={{ left: `${endPercent}%` }}
                    onMouseDown={(e) => handleMarkerDrag(e, "cueOut")}
                  >
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap">
                      {formatTime(cueOut)}
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

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Cue In (Start)
                </label>
                <input
                  type="number"
                  value={cueIn.toFixed(2)}
                  onChange={(e) => setCueIn(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2"
                  step="0.1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Segue Duration
                </label>
                <input
                  type="number"
                  value={segueDuration.toFixed(2)}
                  onChange={(e) =>
                    setSegueDuration(parseFloat(e.target.value) || 0)
                  }
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2"
                  step="0.1"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Cue Out (End)
                </label>
                <input
                  type="number"
                  value={cueOut.toFixed(2)}
                  onChange={(e) => setCueOut(parseFloat(e.target.value) || 0)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2"
                  step="0.1"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-gray-700"
              >
                CANCEL
              </Button>
              <Button
                onClick={handleSave}
                className="bg-blue-600 hover:bg-blue-700"
              >
                SAVE
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
