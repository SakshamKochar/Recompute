/**
 * Labels for the backend's lifecycle states and events (app/lifecycle.py). Which events are possible is
 * never decided here: the asset response's allowed_events and override_events are the only source.
 */
export const STATES = {
  RECEIVED: { label: "Received", long: "Received · awaiting a decision", phase: "awaiting" },
  LISTED: { label: "Listed", long: "Listed for sale", phase: "motion" },
  ACTIVATING: { label: "Activating", long: "Activating compute", phase: "motion" },
  COMPUTING: { label: "Computing", long: "Earning on rented compute", phase: "motion" },
  DRAINING: { label: "Draining", long: "Draining workloads for a buyer", phase: "motion" },
  SANITIZING: { label: "Sanitizing", long: "Wiping and preparing to ship", phase: "motion" },
  REPAIRING: { label: "Repairing", long: "In repair", phase: "motion" },
  SOLD: { label: "Sold", long: "Sold · chapter complete", phase: "complete" },
  HARVESTED: { label: "Harvested", long: "Harvested for parts · chapter complete", phase: "complete" },
  RECYCLED: { label: "Recycled", long: "Recycled · chapter complete", phase: "complete" },
};

export const STATE_ORDER = Object.keys(STATES);

export const EVENTS = {
  received: { label: "Received", verb: "Received into inventory" },
  list: { label: "List for sale", verb: "Listed" },
  activate: { label: "Activate compute", verb: "Compute activation started" },
  start_compute: { label: "Start earning", verb: "Started earning on compute" },
  buyer_found: { label: "Buyer found", verb: "Buyer found; draining" },
  drained: { label: "Drained and wiped", verb: "Drained; sanitizing" },
  sell: { label: "Mark as sold", verb: "Sold" },
  repair: { label: "Send to repair", verb: "Sent to repair" },
  harvest: { label: "Harvest parts", verb: "Harvested" },
  recycle: { label: "Recycle", verb: "Recycled" },
};

export const stateInfo = (s) => STATES[s] || { label: s || "Unknown", long: s || "Unknown state", phase: "unknown" };
export const eventInfo = (e) => EVENTS[e] || { label: e, verb: e };
export const isTerminal = (s) => stateInfo(s).phase === "complete";
export const isInMotion = (s) => stateInfo(s).phase === "motion";
