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
    # Extract cue points and metadata
    cue_in_str = string.trim(process.read("jq -r '.track.cue_in // \"0\"' /tmp/next_track.json"))
    cue_out_str = string.trim(process.read("jq -r '.track.cue_out // empty' /tmp/next_track.json"))
    segue_str = string.trim(process.read("jq -r '.track.segue_duration // \"3\"' /tmp/next_track.json"))
    
    # Log to play history
    ignore(process.run("curl -s -X POST -H 'Content-Type: application/json' -d '{\"filepath\":\"" ^ filepath ^ "\"}' http://localhost:3006/api/stream/now-playing"))
    
    # Build annotations list
    ann_parts = ref([])
    
    # Add cue_in if set and not 0
    if cue_in_str != "" and cue_in_str != "null" and cue_in_str != "0" then
      ann_parts := list.append(ann_parts(), ["liq_cue_in=\"" ^ cue_in_str ^ "\""])
    end
    
    # Add cue_out if set
    if cue_out_str != "" and cue_out_str != "null" then
      ann_parts := list.append(ann_parts(), ["liq_cue_out=\"" ^ cue_out_str ^ "\""])
    end
    
    # Add segue duration for crossfade
    if segue_str != "" and segue_str != "null" then
      ann_parts := list.append(ann_parts(), ["liq_segue_duration=\"" ^ segue_str ^ "\""])
    end
    
    # Build URI with annotations
    if list.length(ann_parts()) > 0 then
      annotations = string.concat(separator=",", ann_parts())
      uri = "annotate:" ^ annotations ^ ":" ^ filepath
      print("Playing with annotations: #{annotations} - #{filepath}")
      request.create(uri)
    else
      print("Playing (no annotations): #{filepath}")
      request.create(filepath)
    end
  else
    print("No track returned from API")
    null()
  end
end

# Create dynamic source
radio = request.dynamic(id="main", get_next_track)

# Use built-in crossfade with:
# - duration: how long to crossfade (3 seconds default)
# - fade_out: fade out the old track (3 seconds)
# - fade_in: NO FADE IN (0 seconds) - tracks start COLD at full volume
radio = crossfade(duration=3., fade_out=3., fade_in=0., radio)

# Audio processing for consistent volume
radio = compress(ratio=4., threshold=-20., attack=10., release=100., radio)
radio = limit(radio)
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
