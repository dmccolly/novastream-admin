import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
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

type MarkerType = 'start' | 'fade' | 'end';

export default function CuePointEditor({
  open,
  onOpenChange,
  trackId,
  trackTitle,
  audioUrl,
  initialCuePoints,
  onSave,
}: CuePointEditorProps) {
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  
  // Cue points in seconds
  const [cueIn, setCueIn] = useState(initialCuePoints?.cueIn || 0);
  const [cueOut, setCueOut] = useState(initialCuePoints?.cueOut || 0);
  const [segueDuration, setSegueDuration] = useState(initialCuePoints?.segueDuration || 3);
  
  // Active marker selection mode
  const [activeMarker, setActiveMarker] = useState<MarkerType | null>(null);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!open || !waveformRef.current) return;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#4F46E5',
      progressColor: '#818CF8',
      cursorColor: '#EF4444',
      barWidth: 2,
      barRadius: 3,
      cursorWidth: 2,
      height: 300,
      barGap: 2,
      normalize: true,
      backend: 'MediaElement', // Use MediaElement for faster loading
      mediaControls: false,
      xhr: {
        requestHeaders: [
          {
            key: 'cache-control',
            value: 'no-cache'
          }
        ]
      }
    });

    if (!audioUrl) {
      setLoadError('No audio URL provided');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    // Set a timeout for loading
    const loadTimeout = setTimeout(() => {
      if (isLoading) {
        setLoadError('Waveform loading timed out. You can still set cue points using the time inputs below.');
        setIsLoading(false);
        toast.error('Waveform loading timed out');
      }
    }, 15000); // 15 second timeout

    ws.load(audioUrl);

    ws.on('ready', () => {
      clearTimeout(loadTimeout);
      const dur = ws.getDuration();
      setDuration(dur);
      if (cueOut === 0) {
        setCueOut(dur);
      }
      setIsLoading(false);
    });

    ws.on('error', (error) => {
      clearTimeout(loadTimeout);
      console.error('WaveSurfer error:', error);
      setLoadError(`Failed to load audio: ${error}`);
      setIsLoading(false);
      toast.error('Failed to load audio waveform');
    });

    ws.on('audioprocess', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('finish', () => {
      setIsPlaying(false);
    });

    wavesurfer.current = ws;

    return () => {
      ws.destroy();
    };
  }, [open, audioUrl]);

  // Handle waveform click to set markers
  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wavesurfer.current || !activeMarker) return;

    const bounds = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - bounds.left;
    const percent = x / bounds.width;
    const time = percent * duration;

    switch (activeMarker) {
      case 'start':
        setCueIn(Math.max(0, Math.min(time, cueOut - segueDuration - 0.1)));
        toast.success(`Play Start set to ${time.toFixed(2)}s`);
        setActiveMarker(null);
        break;
      case 'fade':
        const fadeStart = Math.max(cueIn + 0.1, Math.min(time, cueOut - 0.1));
        setSegueDuration(cueOut - fadeStart);
        toast.success(`Fade Start set to ${fadeStart.toFixed(2)}s`);
        setActiveMarker(null);
        break;
      case 'end':
        setCueOut(Math.max(cueIn + segueDuration + 0.1, Math.min(time, duration)));
        toast.success(`Play End set to ${time.toFixed(2)}s`);
        setActiveMarker(null);
        break;
    }
  };

  const togglePlayPause = () => {
    if (!wavesurfer.current) return;
    wavesurfer.current.playPause();
    setIsPlaying(!isPlaying);
  };

  const jumpToStart = () => {
    if (!wavesurfer.current) return;
    wavesurfer.current.seekTo(cueIn / duration);
  };

  const jumpToFade = () => {
    if (!wavesurfer.current) return;
    const fadeStart = cueOut - segueDuration;
    wavesurfer.current.seekTo(fadeStart / duration);
  };

  const jumpToEnd = () => {
    if (!wavesurfer.current) return;
    wavesurfer.current.seekTo(Math.max(0, (cueOut - 5) / duration));
  };

  const handleSave = () => {
    onSave({ cueIn, cueOut, segueDuration });
    toast.success("Cue points saved successfully");
    onOpenChange(false);
  };

  const fadeStart = cueOut - segueDuration;
  const effectiveDuration = cueOut - cueIn;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            Edit Cue Points: {trackTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Instructions */}
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              How to Set Cue Points
            </h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800 dark:text-blue-200">
              <li>Click a button below to activate a marker (START, FADE, or END)</li>
              <li>Click on the waveform where you want to place that marker</li>
              <li>The marker will be set and you'll see it visualized below</li>
              <li>Repeat for other markers as needed</li>
              <li>Click Save when done</li>
            </ol>
          </div>

          {/* Marker Selection Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={() => setActiveMarker(activeMarker === 'start' ? null : 'start')}
              variant={activeMarker === 'start' ? 'default' : 'outline'}
              className={activeMarker === 'start' ? 'bg-green-600 hover:bg-green-700' : ''}
              size="lg"
            >
              <SkipBack className="mr-2 h-5 w-5" />
              Set PLAY START
            </Button>
            <Button
              onClick={() => setActiveMarker(activeMarker === 'fade' ? null : 'fade')}
              variant={activeMarker === 'fade' ? 'default' : 'outline'}
              className={activeMarker === 'fade' ? 'bg-yellow-600 hover:bg-yellow-700' : ''}
              size="lg"
            >
              Set FADE START
            </Button>
            <Button
              onClick={() => setActiveMarker(activeMarker === 'end' ? null : 'end')}
              variant={activeMarker === 'end' ? 'default' : 'outline'}
              className={activeMarker === 'end' ? 'bg-red-600 hover:bg-red-700' : ''}
              size="lg"
            >
              <SkipForward className="mr-2 h-5 w-5" />
              Set PLAY END
            </Button>
          </div>

          {/* Active Marker Indicator */}
          {activeMarker && (
            <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-700 rounded-lg p-3 text-center">
              <p className="text-yellow-900 dark:text-yellow-100 font-semibold">
                👆 Click on the waveform below to set {activeMarker.toUpperCase()} marker
              </p>
            </div>
          )}

          {/* Waveform */}
          <div className="space-y-2">
            <div 
              ref={waveformRef}
              onClick={handleWaveformClick}
              className={`relative rounded-lg overflow-hidden border-2 ${
                activeMarker 
                  ? 'border-yellow-400 cursor-crosshair shadow-lg' 
                  : 'border-gray-300 dark:border-gray-700'
              }`}
              style={{ minHeight: '300px' }}
            >
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
                  <div className="text-white text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-2"></div>
                    <p>Loading waveform...</p>
                  </div>
                </div>
              )}
              {loadError && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/20">
                  <div className="text-red-600 dark:text-red-400 text-center p-4">
                    <p className="font-semibold">Failed to load audio</p>
                    <p className="text-sm mt-1">{loadError}</p>
                    <p className="text-xs mt-2">Audio URL: {audioUrl || 'Not provided'}</p>
                  </div>
                </div>
              )}
            </div>
            
            {/* Visual Markers */}
            {duration > 0 && (
              <div className="relative h-8 bg-gray-100 dark:bg-gray-800 rounded">
                {/* Play Start Marker */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-green-500"
                  style={{ left: `${(cueIn / duration) * 100}%` }}
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-green-600 whitespace-nowrap">
                    ▼ START
                  </div>
                </div>

                {/* Fade Region */}
                <div
                  className="absolute top-0 bottom-0 bg-yellow-400/30"
                  style={{
                    left: `${(fadeStart / duration) * 100}%`,
                    width: `${(segueDuration / duration) * 100}%`,
                  }}
                />

                {/* Fade Start Marker */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-yellow-500"
                  style={{ left: `${(fadeStart / duration) * 100}%` }}
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-yellow-600 whitespace-nowrap">
                    ▼ FADE
                  </div>
                </div>

                {/* Play End Marker */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-red-500"
                  style={{ left: `${(cueOut / duration) * 100}%` }}
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-red-600 whitespace-nowrap">
                    ▼ END
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-4">
            <Button onClick={jumpToStart} variant="outline" size="sm">
              Jump to Start
            </Button>
            <Button onClick={togglePlayPause} size="lg">
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
            </Button>
            <Button onClick={jumpToFade} variant="outline" size="sm">
              Jump to Fade
            </Button>
            <Button onClick={jumpToEnd} variant="outline" size="sm">
              Jump to End
            </Button>
          </div>

          {/* Time Display */}
          <div className="text-center text-sm text-gray-600 dark:text-gray-400">
            {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
          </div>

          {/* Cue Point Values with Editable Inputs */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div className="text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">PLAY START</div>
              <div className="text-2xl font-bold text-green-600 mb-2">{cueIn.toFixed(2)}s</div>
              <input
                type="number"
                value={cueIn}
                onChange={(e) => setCueIn(parseFloat(e.target.value) || 0)}
                step="0.1"
                min="0"
                max={cueOut}
                className="w-full px-2 py-1 text-center border rounded bg-white dark:bg-gray-800 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">Track begins playing</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">FADE DURATION</div>
              <div className="text-2xl font-bold text-yellow-600 mb-2">{segueDuration.toFixed(2)}s</div>
              <input
                type="number"
                value={segueDuration}
                onChange={(e) => setSegueDuration(parseFloat(e.target.value) || 0)}
                step="0.1"
                min="0"
                max="30"
                className="w-full px-2 py-1 text-center border rounded bg-white dark:bg-gray-800 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">Crossfade length</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">PLAY END</div>
              <div className="text-2xl font-bold text-red-600 mb-2">{cueOut.toFixed(2)}s</div>
              <input
                type="number"
                value={cueOut}
                onChange={(e) => setCueOut(parseFloat(e.target.value) || 0)}
                step="0.1"
                min={cueIn}
                max={duration || 999}
                className="w-full px-2 py-1 text-center border rounded bg-white dark:bg-gray-800 text-sm"
              />
              <div className="text-xs text-gray-500 mt-1">Track stops playing</div>
            </div>
          </div>

          {/* Summary Info */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
              <div className="font-semibold text-blue-900 dark:text-blue-100">Effective Duration</div>
              <div className="text-lg text-blue-600 dark:text-blue-400">{effectiveDuration.toFixed(2)}s</div>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
              <div className="font-semibold text-blue-900 dark:text-blue-100">Fade Starts At</div>
              <div className="text-lg text-blue-600 dark:text-blue-400">{fadeStart.toFixed(2)}s</div>
            </div>
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
              <div className="font-semibold text-blue-900 dark:text-blue-100">Next Track Cue</div>
              <div className="text-lg text-blue-600 dark:text-blue-400">{fadeStart.toFixed(2)}s</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button onClick={() => onOpenChange(false)} variant="outline">
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-green-600 hover:bg-green-700">
              Save Cue Points
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
