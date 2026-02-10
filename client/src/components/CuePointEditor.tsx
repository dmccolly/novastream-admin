*** Begin Patch
*** Update File: client/src/components/CuePointEditor.tsx
@@
-useEffect(() => {
-    if (!canvasRef.current || waveformData.length === 0) return;
+useEffect(() => {
+    // Ensure the canvas has mounted before drawing the waveform. When the dialog
+    // first opens, React renders the component twice: once to measure layout and
+    // again when refs have been attached. Without checking `open` here and
+    // including it in the dependency list, the effect runs too early (when
+    // `canvasRef.current` is still null) and never runs again, leaving the
+    // waveform blank. By returning early when the dialog is closed and adding
+    // `open` as a dependency, the waveform will always be drawn once the
+    // canvas exists.
+    if (!open) return;
+    if (!canvasRef.current || waveformData.length === 0) return;
@@
-}, [waveformData, cueIn, cueOut, segueDuration, currentTime, getEffectiveDuration]);
+}, [open, waveformData, cueIn, cueOut, segueDuration, currentTime, getEffectiveDuration]);
*** End Patch
