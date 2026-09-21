#!/bin/bash
# id chip.ai / Pockit Engineers Diagnostic Engine V1.0 - macOS
#
# Mirrors the JSON schema Pockit-PC-Diagnostic-V1.0.ps1 produces (Machine /
# AutomaticDiagnostics / Complaint / Checks / Summary / DiagnosticErrors) so
# the backend, dashboard, PDF report and history-comparison logic need zero
# changes to accept a Mac's results - only this script is OS-specific.
#
# UNTESTED ON REAL HARDWARE as of writing. Field names/output formats for
# `pmset` and `system_profiler` have shifted across macOS versions over the
# years - anywhere this matters is called out in a comment. Treat the first
# few real runs as validation, not as a finished, trusted tool the way the
# Windows script is at this point.
#
# Usage: ./Pockit-Mac-Diagnostic-V1.0.sh --session-id ID --backend-url URL
#          [--complaint TEXT] [--category NAME]
#
# Deliberately no `set -e`/`set -u` for the whole script - the same
# resilience choice the Windows script makes with its Safe{} wrapper: one
# unexpected command/output format shouldn't take down the entire scan.
# Individual risky commands are guarded with `2>/dev/null` instead. An EXIT
# trap below is the backstop - if something still crashes the script before
# it posts a result, the session gets marked failed rather than sitting at
# "running" forever with no explanation.

SESSION_ID=""
BACKEND_URL="http://localhost:4000"
COMPLAINT=""
CATEGORY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --session-id) SESSION_ID="$2"; shift 2 ;;
    --backend-url) BACKEND_URL="$2"; shift 2 ;;
    --complaint) COMPLAINT="$2"; shift 2 ;;
    --category) CATEGORY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -z "$SESSION_ID" ]; then
  echo "Missing --session-id" >&2
  exit 1
fi

LOG_FILE="$(cd "$(dirname "$0")" && pwd)/pockit-last-run.log"
log() { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$1" >> "$LOG_FILE" 2>/dev/null; }

# ---- JSON helpers ----------------------------------------------------------
# No dependency on jq/python3 - neither is guaranteed present on a customer
# Mac. curl is: it ships with the OS and is what every request below uses.

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/}"
  s="${s//$'\t'/ }"
  printf '%s' "$s"
}
# Wraps a string value for JSON; pass literal "null" through unescaped/unquoted.
jstr() { if [ "$1" = "null" ]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi; }
jnum() { if [ -z "${1:-}" ] || [ "$1" = "null" ]; then printf 'null'; else printf '%s' "$1"; fi; }

# Reads one value out of an XML plist by key name (e.g. `ioreg -a` output) -
# no dependency on plutil/jq/python3. Looks for "<key>NAME</key>" then reads
# the value on the following line, since plist XML always puts a dict's
# value tag immediately after its key tag regardless of nesting depth.
# Handles <integer>/<string>/<real> (strips the tags) and self-closing
# <true/>/<false/> (which would otherwise strip to an empty string).
plist_value() {
  local key="$1" xml="$2"
  printf '%s' "$xml" | awk -v key="$key" '
    found {
      if ($0 ~ /<true\/>/) { print "true"; exit }
      if ($0 ~ /<false\/>/) { print "false"; exit }
      line=$0; gsub(/<[^>]*>/,"",line); gsub(/^[ \t]+|[ \t]+$/,"",line); print line; exit
    }
    $0 ~ "<key>" key "</key>" { found=1; next }
  '
}

DIAG_ERRORS=()
add_error() { DIAG_ERRORS+=("\"$(json_escape "$1")\""); }

LIVE_FINDINGS_JSON="[]"
progress() {
  local percent="$1" stage="$2" message="$3"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
  local entry='{"At":'"$(jstr "$now")"',"Stage":'"$(jstr "$stage")"',"Text":'"$(jstr "$message")"'}'
  if [ "$LIVE_FINDINGS_JSON" = "[]" ]; then
    LIVE_FINDINGS_JSON="[$entry]"
  else
    LIVE_FINDINGS_JSON="${LIVE_FINDINGS_JSON%]},$entry]"
  fi
  local body='{"Percent":'"$percent"',"Stage":'"$(jstr "$stage")"',"Message":'"$(jstr "$message")"',"Findings":'"$LIVE_FINDINGS_JSON"'}'
  curl -s -m 5 -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/progress" \
    -H "Content-Type: application/json; charset=utf-8" -d "$body" >/dev/null 2>&1
  log "progress $percent $stage: $message"
}

CHECKS_JSON=""
add_check() {
  local area="$1" status="$2" confidence="$3" value="$4" details="$5"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
  local entry='{"Area":'"$(jstr "$area")"',"Status":'"$(jstr "$status")"',"Confidence":'"$confidence"',"Value":'"$(jstr "$value")"',"Details":'"$(jstr "$details")"',"CheckedAt":'"$(jstr "$now")"'}'
  if [ -z "$CHECKS_JSON" ]; then CHECKS_JSON="$entry"; else CHECKS_JSON="$CHECKS_JSON,$entry"; fi
}

POSTED="false"
on_exit() {
  local code=$?
  if [ "$POSTED" != "true" ]; then
    log "Script exited (code $code) before posting a result - reporting failure so the session doesn't hang."
    curl -s -m 10 -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/fail" \
      -H "Content-Type: application/json" \
      -d '{"error":"Mac agent exited unexpectedly (exit code '"$code"') before completing"}' >/dev/null 2>&1
  fi
}
trap on_exit EXIT

log "Scan started for session $SESSION_ID (backend $BACKEND_URL)"
progress 4 "connecting" "Diagnostic agent connected to this PC."

# ---- Machine info -----------------------------------------------------------
HW_INFO="$(system_profiler SPHardwareDataType 2>/dev/null)"
MODEL_NAME="$(printf '%s' "$HW_INFO" | awk -F': ' '/Model Name/{print $2; exit}')"
MODEL_ID="$(printf '%s' "$HW_INFO" | awk -F': ' '/Model Identifier/{print $2; exit}')"
CHIP="$(printf '%s' "$HW_INFO" | awk -F': ' '/Chip|Processor Name/{print $2; exit}')"
SERIAL="$(printf '%s' "$HW_INFO" | awk -F': ' '/Serial Number/{print $2; exit}')"
RAM_RAW="$(printf '%s' "$HW_INFO" | awk -F': ' '/Memory/{print $2; exit}')"
RAM_GB="$(printf '%s' "$RAM_RAW" | grep -oE '[0-9]+' | head -1)"
COMPUTER_NAME="$(scutil --get ComputerName 2>/dev/null)"
OS_VERSION="$(sw_vers -productVersion 2>/dev/null)"
OS_BUILD="$(sw_vers -buildVersion 2>/dev/null)"
ARCH="$(uname -m 2>/dev/null)"

FORM_FACTOR="Unknown"
case "$MODEL_NAME" in
  *MacBook*) FORM_FACTOR="Laptop" ;;
  *iMac*) FORM_FACTOR="All-in-One" ;;
  *"Mac mini"*|*"Mac Pro"*|*"Mac Studio"*) FORM_FACTOR="Desktop" ;;
esac
[ -z "$MODEL_NAME" ] && add_error "SPHardwareDataType : no output (system_profiler may be slow/unavailable)"

progress 8 "system" "Apple $MODEL_NAME - macOS $OS_VERSION"

# ---- Performance (CPU/RAM, 10x 1s samples) ---------------------------------
CPU_SUM=0; CPU_MAX=0; CPU_SAMPLES=0
MEM_SUM=0; MEM_MAX=0; MEM_SAMPLES=0
PAGESIZE="$(pagesize 2>/dev/null || echo 4096)"
for i in 1 2 3 4 5 6 7 8 9 10; do
  # `top -l 2` (not -l 1) because the first sample of CPU usage from `top`
  # on macOS is meaningless (no prior interval to diff against).
  CPU_LINE="$(top -l 2 -n 0 -s 0 2>/dev/null | grep "CPU usage" | tail -1)"
  CPU_IDLE="$(printf '%s' "$CPU_LINE" | grep -oE '[0-9.]+% idle' | grep -oE '[0-9.]+')"
  if [ -n "$CPU_IDLE" ]; then
    CPU_PCT=$(awk "BEGIN{printf \"%.1f\", 100-$CPU_IDLE}")
    CPU_SUM=$(awk "BEGIN{print $CPU_SUM+$CPU_PCT}")
    CPU_SAMPLES=$((CPU_SAMPLES+1))
    if awk "BEGIN{exit !($CPU_PCT>$CPU_MAX)}"; then CPU_MAX=$CPU_PCT; fi
  fi
  VM="$(vm_stat 2>/dev/null)"
  # $NF (last field), not a fixed position - "Pages wired down:" has one more
  # word than "Pages free:"/"Pages active:"/"Pages inactive:", which shifted
  # a fixed $3 onto the wrong token when this was tested against real
  # vm_stat output shape.
  PAGES_FREE="$(printf '%s' "$VM" | awk '/Pages free/{gsub("\\.","",$NF); print $NF}')"
  PAGES_ACTIVE="$(printf '%s' "$VM" | awk '/Pages active/{gsub("\\.","",$NF); print $NF}')"
  PAGES_INACTIVE="$(printf '%s' "$VM" | awk '/Pages inactive/{gsub("\\.","",$NF); print $NF}')"
  PAGES_WIRED="$(printf '%s' "$VM" | awk '/Pages wired/{gsub("\\.","",$NF); print $NF}')"
  if [ -n "$PAGES_FREE" ] && [ -n "$PAGES_ACTIVE" ]; then
    # Inactive pages are reclaimable disk cache, not real memory pressure -
    # macOS deliberately keeps them near-full on a perfectly healthy system
    # (Activity Monitor's own pressure gauge excludes them the same way).
    # Counting them as "used" - what a straight Windows-style calculation
    # would do - showed 99% RAM "usage" on a real, unremarkable MacBook,
    # which would flag Performance as Attention on nearly every Mac tested.
    USED=$((PAGES_ACTIVE+PAGES_WIRED))
    TOTAL=$((PAGES_ACTIVE+PAGES_INACTIVE+PAGES_WIRED+PAGES_FREE))
    if [ "$TOTAL" -gt 0 ]; then
      MEM_PCT=$(awk "BEGIN{printf \"%.1f\", ($USED/$TOTAL)*100}")
      MEM_SUM=$(awk "BEGIN{print $MEM_SUM+$MEM_PCT}")
      MEM_SAMPLES=$((MEM_SAMPLES+1))
      if awk "BEGIN{exit !($MEM_PCT>$MEM_MAX)}"; then MEM_MAX=$MEM_PCT; fi
    fi
  fi
  [ "$i" -lt 10 ] && sleep 1
done
CPU_AVG="null"; [ "$CPU_SAMPLES" -gt 0 ] && CPU_AVG=$(awk "BEGIN{printf \"%.1f\", $CPU_SUM/$CPU_SAMPLES}")
MEM_AVG="null"; [ "$MEM_SAMPLES" -gt 0 ] && MEM_AVG=$(awk "BEGIN{printf \"%.1f\", $MEM_SUM/$MEM_SAMPLES}")
PERF_STATUS="Good"
if awk "BEGIN{exit !($CPU_MAX>=95 || $MEM_MAX>=95)}" 2>/dev/null; then PERF_STATUS="Attention"
elif awk "BEGIN{exit !($CPU_AVG>=80 || $MEM_AVG>=85)}" 2>/dev/null; then PERF_STATUS="Watch"; fi
add_check "Performance" "$PERF_STATUS" 85 "${CPU_AVG}% CPU avg / ${MEM_AVG}% RAM avg" "Screening only."

# ---- Startup items ----------------------------------------------------------
# No direct equivalent of Win32_StartupCommand. launchctl covers background
# agents/daemons (LaunchAgents/LaunchDaemons); GUI Login Items (System
# Settings > General > Login Items) are a separate list this doesn't see -
# reading that list via AppleScript triggers an Automation permission prompt,
# which would break the "no interruptions" requirement, so it's left out.
#
# Informational only, no Watch/Attention threshold - unlike Windows (where
# ~10-20 startup entries is a normal ceiling), a real, unremarkable Mac
# tested here had 467 non-Apple launchd jobs loaded (browser/app helpers,
# print subsystem, etc. - most launchd jobs simply aren't com.apple.-
# prefixed even when they're routine). One data point isn't enough to set a
# real threshold, and guessing one wrong would flag nearly every Mac.
STARTUP_COUNT="$(launchctl list 2>/dev/null | awk 'NR>1' | grep -vc '^com\.apple\.')"
add_check "Startup Programs" "Good" 50 "$STARTUP_COUNT non-Apple background item(s) loaded" "Counts launchd agents/daemons only - does not include GUI Login Items (System Settings > General > Login Items), which this script deliberately doesn't read to avoid a permission prompt interrupting the scan. Informational only - macOS's launchd ecosystem runs far more background jobs than Windows' startup-program model, so a raw count here isn't a reliable health signal the way it is on Windows."

progress 20 "performance" "CPU ${CPU_AVG}% avg, RAM ${MEM_AVG}% avg over 10s sample."

# ---- Storage ------------------------------------------------------------
DF_LINE="$(df -k / 2>/dev/null | tail -1)"
TOTAL_KB="$(printf '%s' "$DF_LINE" | awk '{print $2}')"
FREE_KB="$(printf '%s' "$DF_LINE" | awk '{print $4}')"
STORAGE_FREE_PCT="null"; STORAGE_FREE_GB="null"; STORAGE_TOTAL_GB="null"
if [ -n "$TOTAL_KB" ] && [ "$TOTAL_KB" -gt 0 ] 2>/dev/null; then
  STORAGE_FREE_PCT=$(awk "BEGIN{printf \"%.1f\", ($FREE_KB/$TOTAL_KB)*100}")
  STORAGE_FREE_GB=$(awk "BEGIN{printf \"%.1f\", $FREE_KB/1024/1024}")
  STORAGE_TOTAL_GB=$(awk "BEGIN{printf \"%.1f\", $TOTAL_KB/1024/1024}")
fi
DISK_INFO="$(diskutil info / 2>/dev/null)"
# `diskutil info` right-pads its labels in aligned columns (many spaces
# between the colon and the value, e.g. "SMART Status:              Verified")
# - trim, don't just split on ": ", or the value comes out full of padding.
SMART_STATUS="$(printf '%s' "$DISK_INFO" | awk -F':' '/SMART Status/{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2; exit}')"
DISK_PROTOCOL="$(printf '%s' "$DISK_INFO" | awk -F':' '/Protocol/{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2; exit}')"
# "Device / Media Name" (e.g. "APPLE SSD AP0512M Media") is a standard,
# well-documented diskutil field - used for the report's Processor/RAM/
# Storage section. Not attempting per-DIMM RAM manufacturer the same way:
# system_profiler's memory output differs significantly between Intel and
# Apple Silicon Macs and often reports it as a raw hex JEDEC code rather
# than a name, and there's no real Mac available to verify a parser against.
# Match "Media Name" broadly, not just "Device / Media Name" - diskutil's
# exact label has varied across macOS versions ("Device / Media Name" is the
# modern/documented form, but older variants use bare "Media Name") and
# came back empty on a real Sonoma 14.7 machine despite matching known
# real-world examples of the modern label, so widen the match rather than
# guess at yet another exact label.
DISK_MEDIA_NAME="$(printf '%s' "$DISK_INFO" | awk -F':' '/Media Name/{gsub(/^[ \t]+|[ \t]+$/,"",$2); print $2; exit}')"
STORAGE_STATUS="Good"
case "$SMART_STATUS" in
  *Fail*|*Failing*) STORAGE_STATUS="Attention" ;;
esac
if [ "$STORAGE_STATUS" = "Good" ] && awk "BEGIN{exit !($STORAGE_FREE_PCT!=\"null\" && $STORAGE_FREE_PCT<10)}" 2>/dev/null; then STORAGE_STATUS="Watch"; fi
SMART_DETAILS="SMART status: ${SMART_STATUS:-not reported}."
[ "$SMART_STATUS" = "Not Supported" ] && SMART_DETAILS="SMART status not exposed by this Mac's storage controller (common on Apple Silicon, where the internal SSD is managed differently) - not evaluated, not itself a sign of a problem."
add_check "Storage" "$STORAGE_STATUS" 85 "$DISK_PROTOCOL - ${STORAGE_FREE_PCT}% free (${STORAGE_FREE_GB}GB of ${STORAGE_TOTAL_GB}GB)" "$SMART_DETAILS"
progress 34 "storage" "Storage: $STORAGE_STATUS - ${STORAGE_FREE_PCT}% free."

# ---- Battery ----------------------------------------------------------------
PMSET_RAW="$(pmset -g batt 2>/dev/null)"
HAS_BATTERY="$(printf '%s' "$PMSET_RAW" | grep -c "InternalBattery")"
BATT_PERCENT="$(printf '%s' "$PMSET_RAW" | grep -oE '[0-9]+%' | head -1 | tr -d '%')"
BATT_STATE="$(printf '%s' "$PMSET_RAW" | grep -oE '(charging|discharging|charged|finishing charge)' | head -1)"
BATT_SOURCE="$(printf '%s' "$PMSET_RAW" | grep -oE "AC Power|Battery Power" | head -1)"

# ioreg reads the same underlying IOKit battery driver data Apple's own
# tools use, as structured plist - far more stable across macOS versions
# than system_profiler's human-formatted text (whose exact field names and
# presence have already shifted under us once this session - see the
# Storage Media Name fix above). Preferred source; system_profiler is kept
# only as a fallback for whatever ioreg doesn't expose on a given Mac.
IOREG_BATT="$(ioreg -arc AppleSmartBattery 2>/dev/null)"
IO_CYCLE_COUNT="$(plist_value CycleCount "$IOREG_BATT")"
IO_DESIGN_CAP="$(plist_value DesignCapacity "$IOREG_BATT")"
# Max-capacity key name varies by Mac generation - try known candidates in
# order rather than assume one; same reasoning as the Storage fix.
IO_MAX_CAP="$(plist_value AppleRawMaxCapacity "$IOREG_BATT")"
[ -z "$IO_MAX_CAP" ] && IO_MAX_CAP="$(plist_value NominalChargeCapacity "$IOREG_BATT")"
[ -z "$IO_MAX_CAP" ] && IO_MAX_CAP="$(plist_value MaxCapacity "$IOREG_BATT")"
IO_CHARGE_LIMIT_ENABLED="$(plist_value ChargeLimitEnabled "$IOREG_BATT")"
IO_OPT_CHARGING="$(plist_value OptimizedBatteryChargingEngaged "$IOREG_BATT")"
IO_CHARGE_LIMIT="$(plist_value ChargeLimit "$IOREG_BATT")"
# Temperature is centi-degrees Celsius, Voltage is millivolts - both are raw
# ioreg units, not display-ready. Real degradation signals a technician
# would want (unusually high charging temperature, voltage sag under load),
# not previously captured.
IO_TEMP_RAW="$(plist_value Temperature "$IOREG_BATT")"
IO_VOLTAGE_RAW="$(plist_value Voltage "$IOREG_BATT")"
BATT_TEMP_C=""
[ -n "$IO_TEMP_RAW" ] 2>/dev/null && BATT_TEMP_C="$(awk "BEGIN{printf \"%.1f\", $IO_TEMP_RAW/100}" 2>/dev/null)"
BATT_VOLTAGE_V=""
[ -n "$IO_VOLTAGE_RAW" ] 2>/dev/null && BATT_VOLTAGE_V="$(awk "BEGIN{printf \"%.2f\", $IO_VOLTAGE_RAW/1000}" 2>/dev/null)"

POWER_INFO="$(system_profiler SPPowerDataType 2>/dev/null)"
CYCLE_COUNT="$(printf '%s' "$POWER_INFO" | awk -F': ' '/Cycle Count/{print $2; exit}')"
BATT_CONDITION="$(printf '%s' "$POWER_INFO" | awk -F': ' '/Condition/{print $2; exit}')"
MAX_CAPACITY_PCT="$(printf '%s' "$POWER_INFO" | awk -F': ' '/Maximum Capacity/{gsub("%","",$2); print $2; exit}')"

# Prefer ioreg's raw capacities (compute the % ourselves - works on any Mac
# generation) over system_profiler's pre-computed "Maximum Capacity" field,
# which isn't always present at all (confirmed missing on a real Sonoma
# 14.7 Intel MacBook Pro tested this session).
HEALTH_PCT=""
if [ -n "$IO_DESIGN_CAP" ] && [ -n "$IO_MAX_CAP" ] && [ "$IO_DESIGN_CAP" -gt 0 ] 2>/dev/null; then
  HEALTH_PCT="$(awk "BEGIN{printf \"%.1f\", ($IO_MAX_CAP/$IO_DESIGN_CAP)*100}")"
elif [ -n "$MAX_CAPACITY_PCT" ]; then
  HEALTH_PCT="$MAX_CAPACITY_PCT"
fi
FINAL_CYCLE_COUNT="${IO_CYCLE_COUNT:-$CYCLE_COUNT}"
CHARGE_CAPPED="false"
[ "$IO_CHARGE_LIMIT_ENABLED" = "true" ] || [ "$IO_OPT_CHARGING" = "true" ] && CHARGE_CAPPED="true"

BATT_STATUS="Good"
if [ "$HAS_BATTERY" -eq 0 ] 2>/dev/null; then
  BATT_STATUS="Unknown"
  add_check "Battery" "Unknown" 90 "No battery detected" "Expected on a desktop Mac (iMac/Mac mini/Mac Studio/Mac Pro) - not itself a fault."
else
  if [ -n "$HEALTH_PCT" ] 2>/dev/null; then
    if awk "BEGIN{exit !($HEALTH_PCT<60)}" 2>/dev/null; then BATT_STATUS="Attention"
    elif awk "BEGIN{exit !($HEALTH_PCT<80)}" 2>/dev/null; then BATT_STATUS="Watch"; fi
  elif [ "$BATT_CONDITION" = "Service Recommended" ]; then BATT_STATUS="Watch"
  elif [ "$BATT_CONDITION" = "Replace Now" ] || [ "$BATT_CONDITION" = "Replace Soon" ]; then BATT_STATUS="Attention"
  fi
  HEALTH_TEXT="unknown"
  [ -n "$HEALTH_PCT" ] && HEALTH_TEXT="${HEALTH_PCT}%"
  [ -z "$HEALTH_PCT" ] && [ -n "$BATT_CONDITION" ] && HEALTH_TEXT="$BATT_CONDITION"
  CHARGE_CAP_NOTE=""
  [ "$CHARGE_CAPPED" = "true" ] && CHARGE_CAP_NOTE=" Charge limiting is active on this Mac (Optimized Battery Charging and/or a set charge limit${IO_CHARGE_LIMIT:+ of ${IO_CHARGE_LIMIT}%}) - this explains a charge level that stalls below 100% by design, not a fault."
  # Informational only, no status threshold - a single temperature/voltage
  # reading needs context (ambient, load, charging state) to call fault vs
  # normal, which this script doesn't have; not confident enough in a
  # cutoff to gate Attention/Watch on it the way HEALTH_PCT does.
  TEMP_VOLT_NOTE=""
  [ -n "$BATT_TEMP_C" ] && TEMP_VOLT_NOTE=" Temperature: ${BATT_TEMP_C}°C."
  [ -n "$BATT_VOLTAGE_V" ] && TEMP_VOLT_NOTE="$TEMP_VOLT_NOTE Voltage: ${BATT_VOLTAGE_V}V."
  add_check "Battery" "$BATT_STATUS" 90 "${BATT_PERCENT}% charge; health $HEALTH_TEXT" "From macOS's battery driver ($FINAL_CYCLE_COUNT cycles).${BATT_CONDITION:+ Apple condition rating: $BATT_CONDITION.}${CHARGE_CAP_NOTE}${TEMP_VOLT_NOTE}"
fi
progress 46 "battery" "Battery: ${BATT_PERCENT:-not detected}% charge${HEALTH_PCT:+, health ${HEALTH_PCT}%}."

# ---- Drivers / kernel extensions --------------------------------------------
# macOS has no direct equivalent of Device Manager problem codes. Third-party
# kernel extensions (kexts) are the closest analog, but are increasingly rare
# / deprecated in favor of System Extensions on modern macOS, especially
# Apple Silicon - so this is informational only, not a fault detector, unlike
# the Windows Drivers check.
THIRD_PARTY_KEXTS="$(kextstat 2>/dev/null | grep -vc 'com\.apple\.')"
add_check "Drivers" "Good" 50 "$THIRD_PARTY_KEXTS third-party kernel extension(s) loaded" "macOS doesn't expose Device-Manager-style problem codes the way Windows does - this is a count only, not a health signal. Informational."
progress 58 "drivers" "$THIRD_PARTY_KEXTS third-party kernel extension(s) loaded."

# ---- Components / network ---------------------------------------------------
DISPLAY_INFO="$(system_profiler SPDisplaysDataType 2>/dev/null)"
DISPLAY_COUNT="$(printf '%s' "$DISPLAY_INFO" | grep -cE '^\s+(Color LCD|[A-Za-z0-9 ]+):$' 2>/dev/null)"
[ -z "$DISPLAY_COUNT" ] && DISPLAY_COUNT=0
add_check "Display" "$([ "$DISPLAY_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 80 "$DISPLAY_COUNT display(s) reported by macOS" "Visual faults require user testing."
add_check "Monitor" "$([ "$DISPLAY_COUNT" -gt 0 ] 2>/dev/null && echo Good || echo Unknown)" 80 "$DISPLAY_COUNT display(s) reported" "Confirms macOS has a display output; does not test picture quality."

CAMERA_INFO="$(system_profiler SPCameraDataType 2>/dev/null)"
CAMERA_COUNT="$(printf '%s' "$CAMERA_INFO" | grep -cE '^\s{4}\S.*:$' 2>/dev/null)"
[ -z "$CAMERA_COUNT" ] && CAMERA_COUNT=0
add_check "Camera" "$([ "$CAMERA_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 85 "Camera detected ($CAMERA_COUNT candidate device(s))" "Detection does not prove image quality; a functional test is still needed."

AUDIO_INFO="$(system_profiler SPAudioDataType 2>/dev/null)"
AUDIO_COUNT="$(printf '%s' "$AUDIO_INFO" | grep -cE ':$' 2>/dev/null)"
[ -z "$AUDIO_COUNT" ] && AUDIO_COUNT=0
add_check "Audio" "$([ "$AUDIO_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 80 "$AUDIO_COUNT audio device(s)" "Detection does not prove playback/mic quality."

# Built-in keyboard/trackpad are physically guaranteed on any MacBook; on a
# desktop Mac they're external (Bluetooth/USB) and only detected if paired.
if [ "$FORM_FACTOR" = "Laptop" ]; then
  add_check "Keyboard" "Detected" 90 "Built-in keyboard (MacBook)" "Not every key is tested."
  add_check "Touchpad" "Detected" 90 "Built-in trackpad (MacBook)" "Gestures not tested."
else
  KB_COUNT="$(system_profiler SPBluetoothDataType SPUSBDataType 2>/dev/null | grep -icE 'keyboard')"
  # "magic" alone would double-count - Apple prefixes several peripheral
  # types with it (Magic Keyboard, Magic Mouse, Magic Trackpad), so matching
  # on it here also caught keyboards when tested against sample output.
  MOUSE_COUNT="$(system_profiler SPBluetoothDataType SPUSBDataType 2>/dev/null | grep -icE 'mouse|trackpad')"
  add_check "Keyboard" "$([ "$KB_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 70 "$KB_COUNT external keyboard(s) paired/connected" "Desktop Mac - no built-in keyboard; only paired/connected devices are visible here."
  add_check "Touchpad" "$([ "$MOUSE_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 70 "$MOUSE_COUNT external pointing device(s) paired/connected" "Desktop Mac - no built-in trackpad; only paired/connected devices are visible here."
fi

# SPUSBDataType alone only shows currently-connected devices and comes back
# essentially empty when nothing is plugged in (confirmed real behavior, not
# a parsing bug - verified against a real M1 MacBook Air with nothing in its
# ports, which reported "Unknown" USB despite having working Thunderbolt/
# USB4 controllers). SPUSBHostDataType separately enumerates the physical
# controllers themselves, which are always present on real hardware - query
# both so an idle Mac with nothing plugged in still correctly shows
# "controllers present" instead of a misleading "Unknown".
USB_INFO="$(system_profiler SPUSBDataType SPUSBHostDataType 2>/dev/null)"
USB_COUNT="$(printf '%s' "$USB_INFO" | grep -cE ':$' 2>/dev/null)"
[ -z "$USB_COUNT" ] && USB_COUNT=0
add_check "USB" "$([ "$USB_COUNT" -gt 0 ] 2>/dev/null && echo Detected || echo Unknown)" 80 "$USB_COUNT USB controller/hub/device entr$([ "$USB_COUNT" -eq 1 ] 2>/dev/null && echo y || echo ies)" "Counts USB controllers, hubs and connected devices - not physical ports. An empty port shows up here only once something has been plugged into it, so this cannot confirm every port works."

INTERNET_OK="false"
curl -s -m 3 -o /dev/null "https://1.1.1.1" 2>/dev/null && INTERNET_OK="true"
DNS_OK="false"
host www.apple.com >/dev/null 2>&1 && DNS_OK="true"
ADAPTER_COUNT="$(networksetup -listallhardwareports 2>/dev/null | grep -c 'Hardware Port')"
NET_STATUS="Good"
[ "$INTERNET_OK" = "false" ] || [ "$DNS_OK" = "false" ] && NET_STATUS="Watch"
add_check "Network" "$NET_STATUS" 85 "$ADAPTER_COUNT adapter(s); Internet=$INTERNET_OK; DNS=$DNS_OK" "Point-in-time connectivity. Tests a direct connection to a public IP and hostname - on a network that requires a proxy or blocks direct external access by policy, this can report Watch even though the user's own internet access works fine."

progress 76 "components" "Display, camera, audio, keyboard, trackpad and USB enumerated. Network: $([ "$INTERNET_OK" = "true" ] && echo connected || echo unreachable)."

# ---- Complaint handling ------------------------------------------------------
COMPLAINT_PROVIDED="false"
COMPLAINT_INVESTIGATION_JSON=""
COMPLAINT_CATEGORY="None"
if [ -n "$COMPLAINT" ]; then
  COMPLAINT_PROVIDED="true"
  if [ -n "$CATEGORY" ]; then
    COMPLAINT_CATEGORY="$CATEGORY"
  else
    LC_COMPLAINT="$(printf '%s' "$COMPLAINT" | tr '[:upper:]' '[:lower:]')"
    COMPLAINT_CATEGORY="General"
    case "$LC_COMPLAINT" in
      *batter*|*charg*|*adapter*|*power*) COMPLAINT_CATEGORY="Battery" ;;
      *wifi*|*wi-fi*|*wireless*|*internet*|*network*|*disconnect*) COMPLAINT_CATEGORY="Network" ;;
      *slow*|*lag*|*freeze*|*hang*|*performance*|*hot*|*overheat*) COMPLAINT_CATEGORY="Performance" ;;
      *screen*|*display*|*flicker*|*pixel*|*brightness*|*monitor*) COMPLAINT_CATEGORY="Display" ;;
      *camera*|*webcam*) COMPLAINT_CATEGORY="Camera" ;;
      *microphone*|*mic*) COMPLAINT_CATEGORY="Microphone" ;;
      *speaker*|*sound*|*audio*) COMPLAINT_CATEGORY="Audio" ;;
      *keyboard*|*key*) COMPLAINT_CATEGORY="Keyboard" ;;
      *trackpad*|*mouse*|*cursor*) COMPLAINT_CATEGORY="Input" ;;
      *usb*|*pendrive*) COMPLAINT_CATEGORY="USB" ;;
    esac
  fi

  if [ "$COMPLAINT_CATEGORY" = "Battery" ] && [ "$HAS_BATTERY" -gt 0 ] 2>/dev/null; then
    log "Running 60s battery/AC test"
    progress 78 "battery-test" "Starting 60-second battery/AC charging test."
    FIRST_PCT=""; LAST_PCT=""
    ANY_CHARGING="false"; ANY_DISCHARGING="false"; ANY_CHARGED="false"
    for j in 1 2 3 4 5 6 7; do
      P_RAW="$(pmset -g batt 2>/dev/null)"
      P_PCT="$(printf '%s' "$P_RAW" | grep -oE '[0-9]+%' | head -1 | tr -d '%')"
      P_STATE="$(printf '%s' "$P_RAW" | grep -oE '(charging|discharging|charged|finishing charge)' | head -1)"
      [ -z "$FIRST_PCT" ] && FIRST_PCT="$P_PCT"
      LAST_PCT="$P_PCT"
      [ "$P_STATE" = "charging" ] || [ "$P_STATE" = "finishing charge" ] && ANY_CHARGING="true"
      [ "$P_STATE" = "discharging" ] && ANY_DISCHARGING="true"
      [ "$P_STATE" = "charged" ] && ANY_CHARGED="true"
      ELAPSED=$(( (j-1)*10 ))
      progress $((78 + j*2)) "battery-test" "Charging test ${ELAPSED}s/60s - charge ${P_PCT}%."
      [ "$j" -lt 7 ] && sleep 10
    done
    DELTA="null"
    if [ -n "$FIRST_PCT" ] && [ -n "$LAST_PCT" ]; then DELTA=$((LAST_PCT-FIRST_PCT)); fi
    FINDING="UNABLE_TO_DETERMINE"; EXPLANATION="Insufficient telemetry to determine charging state."; INV_CONFIDENCE=40
    if [ "$DELTA" != "null" ] && [ "$DELTA" -gt 0 ] 2>/dev/null; then
      FINDING="CHARGING_CONFIRMED"; EXPLANATION="Battery percentage increased while the test ran."; INV_CONFIDENCE=95
    elif [ "$DELTA" != "null" ] && [ "$DELTA" -lt 0 ] 2>/dev/null; then
      FINDING="BATTERY_DISCHARGING_DURING_TEST"; EXPLANATION="Battery percentage decreased during the test."; INV_CONFIDENCE=90
    elif [ "$ANY_CHARGED" = "true" ] && [ "$LAST_PCT" -ge 95 ] 2>/dev/null; then
      FINDING="FULL_OR_NEAR_FULL"; EXPLANATION="macOS reported a fully-charged state."; INV_CONFIDENCE=90
    elif [ "$ANY_CHARGING" = "true" ] && [ "$DELTA" = "0" ]; then
      FINDING="AC_CHARGING_STATE_REPORTED_BUT_PERCENTAGE_DID_NOT_INCREASE"
      if [ "$CHARGE_CAPPED" = "true" ]; then
        EXPLANATION="macOS reported an active charging state, but the percentage did not rise - and this Mac has charge limiting active (Optimized Battery Charging and/or a set charge limit${IO_CHARGE_LIMIT:+ of ${IO_CHARGE_LIMIT}%}), confirmed via the battery driver, not just a guess. This almost certainly explains it, not a fault."
        INV_CONFIDENCE=90
      else
        EXPLANATION="macOS reported an active charging state, but the coarse percentage did not rise during 60 seconds. Charge limiting (Optimized Battery Charging / a set charge limit) was checked and is NOT active on this Mac, so that's ruled out as the explanation - worth a closer look."
        INV_CONFIDENCE=70
      fi
    elif [ "$ANY_DISCHARGING" = "true" ] && [ "$DELTA" = "0" ]; then
      FINDING="NOT_CHARGING_OR_POWER_NOT_SUSTAINING_BATTERY"; EXPLANATION="macOS reported discharging while the charger was supposed to be connected, and the percentage did not rise."; INV_CONFIDENCE=75
    fi
    progress 95 "battery-test" "Charging test result: $FINDING"
    COMPLAINT_INVESTIGATION_JSON='{"Category":"Battery","MonitoringSeconds":60,"ChargeDeltaPercentagePoints":'"$(jnum "$DELTA")"',"Finding":'"$(jstr "$FINDING")"',"Confidence":'"$INV_CONFIDENCE"',"Explanation":'"$(jstr "$EXPLANATION")"',"CustomerMeaning":'"$(jstr "This is a screening result. Adapter wattage, USB-C PD negotiation, DC jack condition and physical charger output may require hardware-specific or physical testing.")"'}'
  elif [ "$COMPLAINT_CATEGORY" = "Battery" ]; then
    # No battery hardware on this Mac (desktop, or detection failed) - post a
    # definitive result instead of leaving ComplaintInvestigation null. The
    # frontend's Battery/Charging panel only flips off "Not started" once a
    # result is posted, so on a desktop Mac with a battery complaint it was
    # stuck showing "Not started" forever even after the scan finished -
    # unlike the Windows script, which always posts a real (even if
    # UNABLE_TO_DETERMINE) result for the same complaint category.
    log "Battery complaint on hardware with no battery detected - skipping charging test"
    progress 95 "battery-test" "No battery detected on this Mac - charging test does not apply."
    COMPLAINT_INVESTIGATION_JSON='{"Category":"Battery","MonitoringSeconds":0,"ChargeDeltaPercentagePoints":'"$(jnum null)"',"Finding":'"$(jstr "NO_BATTERY_DETECTED")"',"Confidence":95,"Explanation":'"$(jstr "This Mac has no internal battery (desktop, or battery not detected), so a charging test does not apply.")"',"CustomerMeaning":'"$(jstr "This is a screening result. Adapter wattage, USB-C PD negotiation, DC jack condition and physical charger output may require hardware-specific or physical testing.")"'}'
  fi
fi

# ---- Finalize ----------------------------------------------------------------
ATTENTION_COUNT="$(printf '%s' "$CHECKS_JSON" | grep -o '"Status":"Attention"' | wc -l | tr -d ' ')"
WATCH_COUNT="$(printf '%s' "$CHECKS_JSON" | grep -o '"Status":"Watch"' | wc -l | tr -d ' ')"
UNKNOWN_COUNT="$(printf '%s' "$CHECKS_JSON" | grep -o '"Status":"Unknown"' | wc -l | tr -d ' ')"
OVERALL="NO_IMMEDIATE_ISSUE_DETECTED"
[ "$ATTENTION_COUNT" -gt 0 ] 2>/dev/null && OVERALL="NEEDS_ATTENTION"
[ "$OVERALL" = "NO_IMMEDIATE_ISSUE_DETECTED" ] && [ "$WATCH_COUNT" -gt 0 ] 2>/dev/null && OVERALL="WATCH"
[ "$OVERALL" = "NO_IMMEDIATE_ISSUE_DETECTED" ] && [ "$UNKNOWN_COUNT" -gt 0 ] 2>/dev/null && OVERALL="PARTIALLY_ASSESSED"

ERRORS_JSON="$(IFS=,; echo "${DIAG_ERRORS[*]:-}")"

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"
REPORT_JSON='{
  "SchemaVersion":"1.0","GeneratedAt":'"$(jstr "$NOW_ISO")"',"CollectionMode":"WEBAPP_TRIGGERED",
  "Machine":{"Manufacturer":"Apple","Model":'"$(jstr "${MODEL_NAME:-$MODEL_ID}")"',"ComputerName":'"$(jstr "$COMPUTER_NAME")"',"OS":"macOS","OSVersion":'"$(jstr "$OS_VERSION")"',"Build":'"$(jstr "$OS_BUILD")"',"Architecture":'"$(jstr "$ARCH")"',"RAM_GB":'"$(jnum "$RAM_GB")"',"RAMModules":[],"CPU":'"$(jstr "$CHIP")"',"BIOS":null,"SerialNumber":'"$(jstr "$SERIAL")"',"FormFactor":'"$(jstr "$FORM_FACTOR")"',"StorageModel":'"$(jstr "${DISK_MEDIA_NAME:-null}")"'},
  "AutomaticDiagnostics":{
    "BatteryBaseline":{"Battery":['"$([ "$HAS_BATTERY" -gt 0 ] 2>/dev/null && echo '{}' )"'],"ChargePercent":'"$(jnum "$BATT_PERCENT")"',"HealthPercent":'"$(jnum "$HEALTH_PCT")"',"CycleCount":'"$(jnum "$FINAL_CYCLE_COUNT")"'},
    "Storage":{"SystemDrive":{"FreePercent":'"$(jnum "$STORAGE_FREE_PCT")"',"FreeGB":'"$(jnum "$STORAGE_FREE_GB")"',"TotalGB":'"$(jnum "$STORAGE_TOTAL_GB")"'}},
    "Drivers":{"ProblemCount":0,"OtherProblemCount":0},
    "ComplaintInvestigation":'"${COMPLAINT_INVESTIGATION_JSON:-null}"'
  },
  "Complaint":{"Provided":'"$COMPLAINT_PROVIDED"',"Description":'"$(jstr "${COMPLAINT:-null}")"',"Category":'"$(jstr "$COMPLAINT_CATEGORY")"'},
  "Checks":['"$CHECKS_JSON"'],
  "Summary":{"Checks":'"$( [ -z "$CHECKS_JSON" ] && echo 0 || echo "$CHECKS_JSON" | grep -o '"Area"' | wc -l | tr -d ' ')"',"Attention":'"$ATTENTION_COUNT"',"Watch":'"$WATCH_COUNT"',"Unknown":'"$UNKNOWN_COUNT"',"OverallStatus":'"$(jstr "$OVERALL")"',"CustomerProblemProvided":'"$COMPLAINT_PROVIDED"',"FunctionalTestsStillAvailable":["Display","Camera","Microphone","Speaker","Keyboard","Trackpad","USB Port","Headphone"]},
  "DiagnosticErrors":['"$ERRORS_JSON"']
}'

log "Scan complete, posting to $BACKEND_URL/api/sessions/$SESSION_ID/complete"
HTTP_CODE="$(curl -s -o /dev/null -w "%{http_code}" -m 15 -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/complete" \
  -H "Content-Type: application/json; charset=utf-8" -d "$REPORT_JSON" 2>/dev/null)"

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  log "FAILED to post results (HTTP $HTTP_CODE), reporting failure"
  curl -s -m 10 -X POST "$BACKEND_URL/api/sessions/$SESSION_ID/fail" \
    -H "Content-Type: application/json" -d '{"error":"Mac agent failed to post results (HTTP '"$HTTP_CODE"')"}' >/dev/null 2>&1
  POSTED="true"
else
  POSTED="true"
  log "Posted successfully."
fi
