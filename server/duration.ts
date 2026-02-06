import { spawn } from "child_process";

/**
 * Extract audio duration from a file using ffprobe
 * @param filepath - Absolute path to the audio file
 * @returns Duration in seconds, or null if extraction fails
 */
export async function extractDuration(filepath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filepath
    ]);

    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Duration] ffprobe failed for ${filepath}:`, errorOutput);
        resolve(null);
        return;
      }

      const duration = parseFloat(output.trim());
      if (isNaN(duration) || duration <= 0) {
        console.error(`[Duration] Invalid duration for ${filepath}:`, output);
        resolve(null);
        return;
      }

      console.log(`[Duration] Extracted duration for ${filepath}: ${duration}s`);
      resolve(duration);
    });

    ffprobe.on('error', (error) => {
      console.error(`[Duration] Failed to spawn ffprobe for ${filepath}:`, error);
      resolve(null);
    });
  });
}
