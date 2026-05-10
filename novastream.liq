#!/usr/bin/liquidsoap

# Allow running as root
settings.init.allow_root := true

# Enable logging
settings.log.stdout := true
settings.log.level := 3

# Function to get next track from API
def get_next_track() =
  # Call external script that fetches and parses track data
  # Returns: filepath###cue_in###cue_out###segue_duration
  track_data = string.trim(process.read("/root/get_next_track.sh"))
  
  if track_data != "" then
    # Split the ###-delimited data (using ### avoids regex pipe issue)
    parts = string.split(separator="###", track_data)
    filepath = list.nth(parts, 0)
    cue_in_str = list.nth(parts, 1)
    cue_out_str = list.nth(parts, 2)
    segue_str = list.nth(parts, 3)
    
    print("Got track: #{filepath}")
    
    # Build annotations list
    ann_parts = ref([])
    
    # Add cue_in if set and not 0
    if cue_in_str != "" and cue_in_str != "null" and cue_in_str != "0" and cue_in_str != "0.0" then
      ann_parts := list.append(ann_parts(), ["liq_cue_in=\"" ^ cue_in_str ^ "\""])
    end
    
    # Add cue_out if set
    if cue_out_str != "" and cue_out_str != "null" then
      ann_parts := list.append(ann_parts(), ["liq_cue_out=\"" ^ cue_out_str ^ "\""])
    end
    
    # Use liq_fade_out for segue duration, liq_fade_in=0 (tracks start cold)
    if segue_str != "" and segue_str != "null" then
      ann_parts := list.append(ann_parts(), ["liq_fade_out=\"" ^ segue_str ^ "\""])
    end
    ann_parts := list.append(ann_parts(), ["liq_fade_in=\"0\""])
    
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

# on_track fires when a track ACTUALLY starts playing (not at pre-fetch time)
# This drives the Now Playing display with accurate timing
radio = source.on_track(radio, fun(m) ->
  filepath = m["filename"]
  if filepath != "" then
    ignore(process.run("curl -s -X POST -H 'Content-Type: application/json' -d '{\"filepath\":\"" ^ filepath ^ "\"}' http://localhost:3001/api/stream/now-playing"))
    print("Now playing: #{filepath}")
  end
end)

# Apply crossfade using liq_fade_in and liq_fade_out from track metadata
radio = crossfade(radio)

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
  password="NvS!ream_2026",
  mount="stream",
  radio
)
