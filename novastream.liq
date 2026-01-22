#!/usr/bin/liquidsoap

# Allow running as root
settings.init.allow_root := true

# Enable logging
settings.log.stdout := true
settings.log.level := 3

# Function to get next track from API
def get_next_track() =
  # Write JSON to temp file, then parse it
  ignore(process.run("curl -s http://localhost:3006/api/stream/next-track > /tmp/next_track.json"))
  
  # Extract filepath using jq from file
  filepath = string.trim(process.read("jq -r '.track.filepath // empty' /tmp/next_track.json"))
  
  if filepath != "" then
    # Extract cue_out
    cue_out_str = string.trim(process.read("jq -r '.track.cue_out // empty' /tmp/next_track.json"))
    
    # Log to play history
    ignore(process.run("curl -s -X POST -H 'Content-Type: application/json' -d '{\"filepath\":\"" ^ filepath ^ "\"}' http://localhost:3006/api/stream/now-playing"))
    
    # Build request with cue_out annotation if available
    if cue_out_str != "" and cue_out_str != "null" then
      uri = "annotate:liq_cue_out=\"" ^ cue_out_str ^ "\":" ^ filepath
      print("Playing with segue at #{cue_out_str}s: #{filepath}")
      request.create(uri)
    else
      print("Playing (no segue): #{filepath}")
      request.create(filepath)
    end
  else
    print("No track returned from API")
    null()
  end
end

# Create dynamic source
radio = request.dynamic(id="main", get_next_track)

# Audio processing for consistent volume
# Aggressive compression to even out dynamics (ratio 4:1, threshold -20dB)
radio = compress(ratio=4., threshold=-20., attack=10., release=100., radio)

# Hard limiter to prevent clipping
radio = limit(radio)

# Boost overall level by 50%
radio = amplify(1.5, radio)

# Make it safe with silence fallback
radio = mksafe(radio)

# Output to Icecast
output.icecast(
  %mp3(bitrate=192),
  host="localhost",
  port=8000,
  password="novastream2024",
  mount="stream",
  radio
)
