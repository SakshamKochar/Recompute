# Diagnostic engine (engine/diagnostics.py) and NVIDIA reader (engine/nvidia_reader.py)

The diagnostic engine turns one server's test report into four things: a verdict for every GPU, a 0 to 100 health score with every deduction itemised, a grade from A+ to D, and the inputs the decision model needs. The marketplace price, the repair bill and the harvest value all come from it; nothing is typed in by hand.

## What it reads
- **NVIDIA DCGM diagnostics (`dcgmi diag`)**, per test and per GPU: pass, warn, fail or skip. The engine checks that a report contains exactly the tests its declared level runs (DCGM 4.6: level 1 software checks; level 2 adds memory and PCIe; level 3 adds the compute diagnostic, memory bandwidth, targeted stress, targeted power and NVLink bandwidth where available; level 4 adds memtest and the pulse test). A level-4 test in a level-3 report means the report is inconsistent, and it is graded D.
- **Memory telemetry (nvidia-smi)** per GPU: correctable errors, rows remapped after correctable and uncorrectable errors, the remap-pending and remap-failure flags, and Xid codes 48, 63, 64, 74, 92, 94, 95 and 160.
- **Clock events** under load: HW_SLOWDOWN, HW_THERMAL, HW_POWER_BRAKE and SW_THERMAL.
- **Chassis**: power-on hours, cosmetic condition, and faults outside the GPUs (power supply, fan, drive, network card).

## The rules that come from NVIDIA (SOURCED)
| Evidence | Meaning | What the engine does |
|---|---|---|
| Remap failure or Xid 64 | Spare memory rows exhausted | GPU fails: replace it |
| Xid 95 | Uncontained memory error | GPU degraded; grade at most C |
| Uncorrectable error repaired by remap (Xid 48 + 63) | Memory repaired itself | GPU degraded; grade at most B |
| Remap pending | Repair applies at next GPU reset | Action: reset before shipping (no penalty) |
| Xid 92 | High correctable-error rate | GPU on watch |

## The rubric (HYPOTHESIS, every number in docs/ASSUMPTIONS.csv)
Points, caps and thresholds are the team's rubric until a refurbisher's grading data can calibrate them. Every deduction shows its evidence, so a judge can follow any grade back to the telemetry line that caused it.

## From diagnostics to dollars
- **Working GPUs** = 8 minus failed GPUs. Only working GPUs earn rental income.
- **Repair bill** = failed GPUs x used GPU price + failed chassis parts (fault_costs.csv). Repair is possible for up to 2 GPU swaps and any priced chassis part.
- **Harvest value** = (working GPUs x used GPU price x 0.9 + platform parts) x 0.92 - $1,650 teardown - $400 freight. This reproduces Swayam's Price Build exactly ($73,013.65 for an A100, $194,876 for an H100 with 7 working GPUs).
- **Server price** = 8 x used GPU price + platform parts, which reproduces the sourced profile prices ($100,000 A100, $255,700 H100).
- **Repaired option**: the engine projects the report after the repair (faulted parts replaced, power-brake events caused by a failed power supply cleared, full level-4 retest; unrelated warnings and wear stay) and prices the server at the grade it would then earn.

## Safety
Malformed reports are rejected with a list of every problem, never graded: wrong number of per-GPU results, unknown result words, negative counts, impossible levels, unknown fields. A skipped test costs a point and is disclosed. A server with no diagnostics can be sold only as untested (grade D). Fuzzed with 12,000 corrupted reports: zero crashes.


## Reading NVIDIA's output (engine/nvidia_reader.py)

ReCompute runs no tests on any GPU. NVIDIA's tools already test and report on every data-center GPU; the reader turns their output into the report the engine grades. An operator uploads up to four things:

| Input | Command | What it gives |
|---|---|---|
| Diagnostic results | `dcgmi diag -r 3 --json` (or `-r 4`) | per-test, per-GPU results with NVIDIA error codes |
| GPU telemetry | `nvidia-smi -q -x` (or `--query-remapped-rows ... --format=csv`) | memory self-repair counts, remap flags, spare-row histogram, ECC counters, serials, PCI addresses |
| Kernel log | `dmesg` or `journalctl -k` | Xid error events, attached to a GPU by PCI address |
| NVLink counters | `dcgmi nvlink --errors --gpuid N --json` (one per GPU) | CRC, replay and recovery errors per link; one link far above the others points to a bad bridge or cable |
| Chassis record | entered by the operator | power supplies, fans, hours, cosmetics (NVIDIA tools do not cover these) |

### Rules taken from NVIDIA's own code and documents
- **Format:** both DCGM 4.x (`"DCGM Diagnostic"`, entity ids) and the legacy 2.x/3.x layout (`"DCGM GPU Diagnostic"`, `gpu_ids` strings, uppercase statuses, ten named deployment checks). Source: NVIDIA/DCGM 4.6.1 `dcgmi/Diag.cpp` and NVIDIA's official JSON schema.
- **A warning prints as "Fail".** NVIDIA's JSON shows a WARN result as `Fail`; the real severity is the warning's error code. The reader classifies by error code through NVIDIA's catalogue of 133 codes (`data/sources/nvidia_dcgm_error_catalog.csv`): ISOLATE fails the GPU, MONITOR and TRIAGE are warnings, CONFIG means the test environment was the problem (not tested), and a row-remap failure fails the GPU.
- **Version drift:** older DCGM versions printed different severities for the same code (for example code 55 as ISOLATE where the current table says CONFIG). Codes are stable, so the reader uses the current catalogue and records the disagreement.
- **Cascades:** after a GPU's first hardware failure NVIDIA marks later tests failed; those are not counted again.
- **Skipped GPUs:** after a pending, uncorrectable or failed row remap (or page-retirement condition) NVIDIA skips that GPU in later tests with a fixed message. The reader reports it as untested with the action "reset and rerun", never as passing.
- **Run level** is the highest level whose tests actually ran. A test NVIDIA skipped on every GPU is an evidence gap, not a result.
- **Xids** follow NVIDIA's Xid Catalog (172 entries): app-level ones (for example 13, 31, 94, and 92 whose action is IGNORE) do not touch the hardware grade; reset-level ones need a reset and retest; Xid 64 fails the GPU in NVIDIA's words, "unrecoverable memory hardware damage".
- **Hardware facts found during deployment checks** belong to their GPU, not the whole system.
- **N/A is unknown, never clean.** Inside a virtual machine nvidia-smi hides row-remap data; confidence drops and the report says so.
- **Spare-row histogram** (max, high, partial, low, none) shows a GPU running out of self-repair capacity before it fails.

### Verified on real NVIDIA output
Tests run on real captures (tests/fixtures/nvidia/PROVENANCE.md): NVIDIA's own legacy diagnostic sample, real nvidia-smi XML from an A100 in a cloud VM and from drivers 510 and 535, and real Xid kernel lines. On NVIDIA's legacy sample a naive reader would report a level-3 pass; the real reading is a level-2 run with ECC switched off on GPU 0.

### The demo
The four demo sellers are SIMULATED files in NVIDIA's exact formats (data/demo_inputs/), validated against NVIDIA's official schema, and read by the same code a real upload would use.

### Robustness
Corrupted NVIDIA files are rejected with a reason, never crash the reader: 9,000 fuzzed files, zero crashes. Fuzzing found and fixed one serious case: a corrupted GPU id of one trillion made the reader try to build a trillion-entry list. GPU ids above 63 are now rejected.


## Capturing a server (tools/capture_nvidia.sh)
One command on the server, as root, with the GPUs idle: `sudo bash capture_nvidia.sh 3`. It runs only NVIDIA tools (nvidia-smi, dcgmi diag, dcgmi nvlink, the kernel log), writes a folder plus a `.tar.gz`, and leaves a `chassis.json` for the operator to fill in (hours, cosmetics, power supply or fan faults). Level 3 takes about 15 to 30 minutes on 8 GPUs; level 4 adds memtest and the pulse test. ReCompute loads the `.tar.gz` with `load_capture()` and grades it; archive paths that would escape the folder are refused.

PCIe replay counts come from nvidia-smi (`pci/replay_counter`, present in every real capture we have). NVLink counts come from NVIDIA's own JSON; a GPU with no NVLink output stays unknown, never zero.

## Status (2026-10-02)
- Tests: 93, including real NVIDIA captures. Fuzzing: 12,000 engine reports, 9,000 NVIDIA diagnostic and nvidia-smi files, 4,000 NVLink files, zero crashes.
- Open: one capture from a real, healthy A100 or H100 (a few dollars of rented GPU time with the script above) to replace the simulated demo files; calibration of the rubric points against a refurbisher's grading data.


## Capturing a real server (tools/capture_nvidia.sh)

One command on the server, as root with the GPUs idle: `sudo bash capture_nvidia.sh 3`. It runs only NVIDIA's tools and writes a folder plus a `.tar.gz` to upload:

| File | NVIDIA command |
|---|---|
| nvidia_smi.xml | `nvidia-smi -q -x` |
| remapped_rows.csv | `nvidia-smi --query-remapped-rows=... --format=csv` |
| kernel.log | Xid lines from `dmesg` or `journalctl -k` |
| nvlink_gpu<N>.json | `dcgmi nvlink --errors --gpuid N --json` |
| dcgm_diag.json | `dcgmi diag -r 3 --json` (level 3 runs about 15 to 30 minutes on 8 GPUs) |
| chassis.json | template the operator fills in: hours, cosmetic, faults NVIDIA tools cannot see |

`engine/nvidia_reader.load_capture()` reads the `.tar.gz` (refusing any file that would land outside its folder) or the folder. The output carries no hostname.

If NVIDIA's diagnostic could not run (common in rented containers without full privileges), the server is graded as untested and every other file is still used.

## NVLink and PCIe
- **NVLink:** per-link CRC FLIT, CRC data, replay and recovery counts, in the exact layout NVIDIA/DCGM `dcgmi/Nvlink.cpp` writes. One link far above its siblings (10 times their median and at least 100 errors, a HYPOTHESIS threshold) is reported as a likely connector, cable or bridge problem with the action "reseat and recheck". Per NVIDIA-ecosystem guidance, link versus link is the comparison that matters.
- **PCIe:** `pci/replay_counter` from nvidia-smi; a rolled-over counter is treated as very high.
- A GPU with no NVLink or PCIe data is unknown, never zero.
