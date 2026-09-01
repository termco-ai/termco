// Dev-only .mjs scripts (e.g. scripts/eager-graph.mjs) imported by a benchmark
// test have no types; allow them without noImplicitAny complaints.
declare module "*.mjs";
