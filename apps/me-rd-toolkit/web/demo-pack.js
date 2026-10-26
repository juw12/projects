/* Generic demo content so the public app is usable without a private data pack.
   Everything here is common textbook engineering guidance – replace it by loading your own data pack. */
window.ME_DEMO_PACK = {
  meta: { name: "Demo pack (generic)", generated: "", roots: [], demo: true },
  checklists: [
    {
      key: "design",
      name: "Design Review (demo)",
      stage: "Design",
      src: "",
      items: [
        { id: "d-1", cat: "Inputs", catEn: "Inputs", no: "1", title: "Product requirements, cosmetic spec and test plan received", spec: ["Customer spec, CMF, reliability and safety requirements confirmed"], fill: [], note: [] },
        { id: "d-2", cat: "Plastic", catEn: "Plastic parts", no: "1", title: "Nominal wall uniform", spec: ["Avoid abrupt thickness changes; transition gradually"], fill: [], note: [] },
        { id: "d-3", cat: "Plastic", catEn: "Plastic parts", no: "2", title: "Draft on all faces in pull direction", spec: ["Textured faces need more draft than polished faces"], fill: [], note: [] },
        { id: "d-4", cat: "Plastic", catEn: "Plastic parts", no: "3", title: "Ribs sized to avoid sink", spec: ["Rib root typically 50–70 % of nominal wall"], fill: [], note: [] },
        { id: "d-5", cat: "Assembly", catEn: "Assembly", no: "1", title: "Tolerance stack-up done for cosmetic gaps and functional fits", spec: ["Worst case and RSS reported against spec"], fill: [], note: [] },
        { id: "d-6", cat: "Assembly", catEn: "Assembly", no: "2", title: "Snap-fit strain within material allowable", spec: ["Hand-calc or CAE; add over-travel stop"], fill: [], note: [] }
      ]
    }
  ],
  flow: [
    { phase: "Concept", stage: "Kick-off", task: "Requirements & schedule agreed", note: "" },
    { phase: "Concept", stage: "Kick-off", task: "Preliminary layout and cost estimate", note: "" },
    { phase: "EVT", stage: "Design", task: "3D design and design review", note: "" },
    { phase: "EVT", stage: "Design", task: "Tolerance analysis report", note: "" },
    { phase: "DVT", stage: "Tooling", task: "Tooling DFM and T1 trial shot", note: "" },
    { phase: "DVT", stage: "Validation", task: "Reliability tests", note: "" },
    { phase: "PVT", stage: "Pilot run", task: "Capability run and Cpk on key dimensions", note: "" },
    { phase: "MP", stage: "Release", task: "Final part approval", note: "" }
  ],
  flowSrc: "",
  rules: [
    {
      group: "General",
      title: "Plastic part basics (textbook)",
      src: "",
      items: [
        { k: "Nominal wall", v: "Keep uniform; thick sections cause sink and long cycle time" },
        { k: "Rib root", v: "50–70 % of wall, height ≤ 3 × wall" },
        { k: "Boss", v: "Core out bosses, connect to walls with ribs" },
        { k: "Draft", v: "≥ 1° polished, more on textured faces" }
      ]
    }
  ],
  ulMaterials: null,
  tests: null,
  approval: null,
  lessons: [],
  sops: [],
  projects: [],
  library: [],
  calc: {}
};
