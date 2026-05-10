#!/bin/bash
# Get next track from API and output pipe-delimited: filepath|cue_in|cue_out|segue_duration
RESPONSE=$(curl -s --max-time 5 http://localhost:3001/api/stream/next-track)
FILEPATH=$(echo "$RESPONSE" | jq -r '.track.filepath // empty')
if [ -z "$FILEPATH" ]; then
  exit 1
fi
CUE_IN=$(echo "$RESPONSE" | jq -r '(.track.cue_in // 0) | tostring')
CUE_OUT=$(echo "$RESPONSE" | jq -r '(.track.cue_out // "") | tostring')
SEGUE=$(echo "$RESPONSE" | jq -r '(.track.segue_duration // 3) | tostring')
echo "${FILEPATH}###${CUE_IN}###${CUE_OUT}###${SEGUE}"
