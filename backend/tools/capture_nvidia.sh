#!/usr/bin/env bash
# ReCompute capture: runs NVIDIA's own tools on this server and saves their output for ReCompute to grade.
# ReCompute runs no tests of its own; everything below is an NVIDIA command.
#
# Usage (as root, with the GPUs idle):   sudo bash capture_nvidia.sh [diag_level]
#   diag_level 3 (default) runs NVIDIA's long diagnostic (about 15 to 30 minutes on 8 GPUs);
#   4 adds memtest and the pulse test (about an hour or more); 1 or 2 are quick checks with low confidence.
# Needs: NVIDIA driver (nvidia-smi) and NVIDIA DCGM (dcgmi, nv-hostengine).
#   If DCGM is missing on Ubuntu with NVIDIA's CUDA repository configured:
#     apt-get install -y datacenter-gpu-manager-4-cuda12   (see NVIDIA's DCGM install guide for other systems)
# Output: a folder recompute_capture_<time>/ and a .tar.gz of it. Upload the .tar.gz to ReCompute.
set -u
LEVEL="${1:-3}"
case "$LEVEL" in 1|2|3|4) ;; *) echo "diag_level must be 1, 2, 3 or 4"; exit 2;; esac
OUT="recompute_capture_$(date -u +%Y%m%dT%H%M%SZ)"   # no hostname: it is not needed and should not travel with the file
mkdir -p "$OUT"
log() { echo "[recompute] $*" | tee -a "$OUT/capture.log"; }

command -v nvidia-smi >/dev/null || { log "nvidia-smi not found: the NVIDIA driver is not installed"; exit 1; }
log "capture started (UTC $(date -u +%FT%TZ)), diag level $LEVEL"
nvidia-smi --version > "$OUT/versions.txt" 2>&1

log "1/5 nvidia-smi full query (XML)"
nvidia-smi -q -x > "$OUT/nvidia_smi.xml" 2>>"$OUT/capture.log"

log "2/5 row-remap table (CSV)"
nvidia-smi --query-remapped-rows=gpu_bus_id,gpu_uuid,remapped_rows.correctable,remapped_rows.uncorrectable,remapped_rows.pending,remapped_rows.failure \
  --format=csv > "$OUT/remapped_rows.csv" 2>>"$OUT/capture.log" || log "remapped rows not supported on this GPU (pre-Ampere)"

log "3/5 kernel Xid events"
{ dmesg -T 2>/dev/null || journalctl -k --no-pager 2>/dev/null; } | grep "NVRM: Xid" > "$OUT/kernel.log" || true
log "    $(wc -l < "$OUT/kernel.log") Xid line(s) found"

if command -v dcgmi >/dev/null; then
  if ! dcgmi discovery -l >/dev/null 2>&1; then
    log "    starting nv-hostengine"
    nv-hostengine >/dev/null 2>&1 || true
    sleep 3
  fi
  dcgmi --version >> "$OUT/versions.txt" 2>&1
  log "4/5 NVLink error counters per GPU"
  for i in $(nvidia-smi --query-gpu=index --format=csv,noheader); do
    dcgmi nvlink --errors --gpuid "$i" --json > "$OUT/nvlink_gpu$i.json" 2>>"$OUT/capture.log" || rm -f "$OUT/nvlink_gpu$i.json"
  done
  log "5/5 NVIDIA diagnostic: dcgmi diag -r $LEVEL (do not use the GPUs until it finishes)"
  dcgmi diag -r "$LEVEL" --json > "$OUT/dcgm_diag.json" 2>>"$OUT/capture.log"
  log "    diagnostic finished with exit code $?"
else
  log "dcgmi not found: NVLink counters and the diagnostic were skipped. ReCompute will grade this server as untested."
fi

cat > "$OUT/chassis.json" <<'EOF'
{
  "power_on_hours": 0,
  "cosmetic": "good",
  "faults": []
}
EOF
log "edit $OUT/chassis.json: power-on hours, cosmetic (like_new, good, fair or worn), and any faults NVIDIA tools cannot see,"
log "  for example {\"part\": \"PSU\", \"detail\": \"power supply 2 reports no output\"}"
tar -czf "$OUT.tar.gz" "$OUT" && log "done: upload $OUT.tar.gz"
