import React, { useState, useEffect, useRef } from "react";
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
  const [duration, setDuration] = useState(0);
  const [cueIn, setCueIn] = useState(initialCuePoints.cueIn);
  const [cueOut, setCueOut] = useState(initialCuePoints.cueOut);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints.segueDuration);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setCueIn(initialCuePoints.cueIn);
    setCueOut(initialCuePoints.cueOut);
    setSegueDuration(initialCuePoints.segueDuration);
  }, [initialCuePoints, open]);

  useEffect(() => {
    if (audioRef.current && open) {
      const audio = audioRef.current;
      console.log('CuePointEditor: Setting up audio loading');
      
      const updateDuration = () => {
        const dur = audio.duration || 0;
        if (dur > 0 && !isNaN(dur)) {
          setDuration(dur);
          // If no cueOut was set, use full duration
          if (initialCuePoints.cueOut === 0 || !initialCuePoints.cueOut) {
            setCueOut(dur);
          }
          setIsLoading(false);
        } else if (initialCuePoints.cueOut > 0) {
          // Use cueOut as fallback duration
          setDuration(initialCuePoints.cueOut);
          setIsLoading(false);
        }
      };
      
      // Check if audio is already loaded (readyState >= 1 means metadata is available)
      if (audio.readyState >= 1) {
        updateDuration();
      }
      
      const handleLoadedMetadata = () => {
        updateDuration();
      };
      
      const handleError = () => {
        console.error('Audio failed to load');
        // Use cueOut as fallback
        if (initialCuePoints.cueOut > 0) {
          setDuration(initialCuePoints.cueOut);
        }
        setIsLoading(false);
      };
      
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('error', handleError);
      
      // Timeout fallback: always stop loading after 3 seconds
      const timeout = setTimeout(() => {
        console.log('Audio loading timeout fired, using fallback');
        // Try one more time to get duration
        if (audio.duration > 0 && !isNaN(audio.duration)) {
          setDuration(audio.duration);
        } else if (initialCuePoints.cueOut > 0) {
          // Use cueOut as fallback
          setDuration(initialCuePoints.cueOut);
        }
        setIsLoading(false);
      }, 3000);
      
      return () => {
        console.log('CuePointEditor: Cleaning up audio loading');
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('error', handleError);
        clearTimeout(timeout);
      };
    }
  }, [audioUrl, open, initialCuePoints.cueOut]);

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/tracks/${trackId}/cuepoints`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          cueIn: Number(cueIn), 
          cueOut: Number(cueOut), 
          segueDuration: Number(segueDuration) 
        }),
      });
      if (response.ok) {
        onOpenChange(false);
      } else {
        alert('Failed to save cue points');
      }
    } catch (error) {
      console.error('Failed to save cue points:', error);
      alert('Error saving cue points');
    }
  };

  const handleMouseDown = (marker: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(marker);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !timelineRef.current || duration === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, x / rect.width));
    const time = percent * duration;

    if (dragging === 'start') {
      setCueIn(Math.max(0, Math.min(time, cueOut - segueDuration)));
    } else if (dragging === 'fade') {
      const fadeStart = cueOut - segueDuration;
      setCueIn(Math.max(0, Math.min(time, fadeStart)));
    } else if (dragging === 'end') {
      setCueOut(Math.max(cueIn + segueDuration, Math.min(duration, time)));
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const fadeStart = cueOut - segueDuration;
  const startPercent = duration > 0 ? (cueIn / duration) * 100 : 0;
  const fadePercent = duration > 0 ? (fadeStart / duration) * 100 : 0;
  const endPercent = duration > 0 ? (cueOut / duration) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl">
        {isLoading ? (
          <div className="flex items-center justify-center p-20">
            <div className="text-center">
              <div className="text-lg mb-2">Loading track information...</div>
              <div className="text-sm text-gray-400">Please wait</div>
            </div>
          </div>
        ) : (
        <div className="bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl">Edit Cue Points: {trackTitle}</DialogTitle>
        </DialogHeader>

        <audio ref={audioRef} src={audioUrl} />

        <div className="space-y-6">
          <div className="bg-blue-600 p-4 rounded">
            <h3 className="font-bold mb-2">How to Set Cue Points</h3>
            <ol className="text-sm space-y-1">
              <li>1. Drag the colored markers on the timeline to set positions</li>
              <li>2. Or use the numeric inputs below for precise times</li>
              <li>3. GREEN = Play Start, YELLOW = Fade Start, RED = Play End</li>
              <li>4. Click Save when done</li>
            </ol>
          </div>

          <div className="space-y-2">
            <div className="text-sm text-gray-400">Duration: {duration.toFixed(2)}s</div>
            <div 
              ref={timelineRef}
              className="relative h-72 bg-gray-800 rounded cursor-crosshair"
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="absolute inset-0 flex">
                <div style={{width: `${startPercent}%`}} className="bg-gray-700" />
                <div style={{width: `${fadePercent - startPercent}%`}} className="bg-green-600 opacity-30" />
                <div style={{width: `${endPercent - fadePercent}%`}} className="bg-yellow-600 opacity-30" />
                <div style={{width: `${100 - endPercent}%`}} className="bg-gray-700" />
              </div>

              <div 
                style={{left: `${startPercent}%`}}
                className="absolute top-0 bottom-0 w-1 bg-green-500 cursor-ew-resize"
                onMouseDown={handleMouseDown('start')}
              >
                <div className="absolute -top-2 -left-3 w-6 h-6 bg-green-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold">
                  S
                </div>
                <div className="absolute -bottom-8 -left-10 text-sm font-bold text-green-400 whitespace-nowrap">
                  START {cueIn.toFixed(1)}s
                </div>
              </div>

              <div 
                style={{left: `${fadePercent}%`}}
                className="absolute top-0 bottom-0 w-1 bg-yellow-500 cursor-ew-resize"
                onMouseDown={handleMouseDown('fade')}
              >
                <div className="absolute -top-2 -left-3 w-6 h-6 bg-yellow-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold">
                  F
                </div>
                <div className="absolute -bottom-8 -left-10 text-sm font-bold text-yellow-400 whitespace-nowrap">
                  FADE {fadeStart.toFixed(1)}s
                </div>
              </div>

              <div 
                style={{left: `${endPercent}%`}}
                className="absolute top-0 bottom-0 w-1 bg-red-500 cursor-ew-resize"
                onMouseDown={handleMouseDown('end')}
              >
                <div className="absolute -top-2 -left-3 w-6 h-6 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-xs font-bold">
                  E
                </div>
                <div className="absolute -bottom-8 -left-10 text-sm font-bold text-red-400 whitespace-nowrap">
                  END {cueOut.toFixed(1)}s
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">PLAY START (seconds)</label>
              <input
                type="number"
                step="0.1"
                value={cueIn}
                onChange={(e) => setCueIn(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-green-500 rounded text-white text-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">FADE DURATION (seconds)</label>
              <input
                type="number"
                step="0.1"
                value={segueDuration}
                onChange={(e) => setSegueDuration(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-yellow-500 rounded text-white text-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">PLAY END (seconds)</label>
              <input
                type="number"
                step="0.1"
                value={cueOut}
                onChange={(e) => setCueOut(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-red-500 rounded text-white text-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
              Save Cue Points
            </Button>
          </div>
        </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
