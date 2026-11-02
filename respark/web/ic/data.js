/*
  Industrial Connect: company content file
  ------------------------------------------
  Edit this file to put in your own company, products, figures and contacts.
  Everything shown in the app comes from here (or from the Admin > Content editor,
  which can export an updated copy of this file).

  NOTE: All numbers, certifications and names below are PLACEHOLDERS for the demo.
  Replace them with verified company information before publishing.
*/
window.COMPANY_DATA = {
  company: {
    name: "Apex Industrial",
    legalName: "Apex Industrial Manufacturing Co., Ltd.",
    tagline: "Precision components & fluid systems for heavy industry",
    founded: 1998,
    hq: "Your City, Country",
    about:
      "We design and manufacture precision power-transmission parts, piping components and pumps for OEMs in mining, energy, water and process industries. Our vertically integrated plant covers forging, CNC machining, heat treatment, assembly and testing under one roof.",
    stats: [
      { label: "Years in operation", value: "25+" },
      { label: "Factory floor area", value: "42,000 m²" },
      { label: "Export countries", value: "31" },
      { label: "Active B2B clients", value: "380+" }
    ],
    certifications: [
      "ISO 9001:2015 Quality",
      "ISO 14001:2015 Environment",
      "ISO 45001:2018 Safety",
      "EN 10204 3.1 material certs"
    ]
  },

  contact: {
    email: "sales@apex-industrial.example",
    investorEmail: "ir@apex-industrial.example",
    procurementEmail: "procurement@apex-industrial.example",
    phone: "+00 000 0000 000",
    whatsapp: "",
    address: "Plot 12, Industrial Estate, Your City, Country"
  },

  settings: {
    // Optional: paste a form endpoint (Formspree, Make, Zapier, your CRM webhook)
    // and every inquiry will also be POSTed there as JSON.
    formEndpoint: "",
    // Demo PIN for the Admin dashboard (#/admin). Change before sharing.
    adminPin: "1234",
    currency: "USD"
  },

  audiences: {
    customer: {
      kicker: "For buyers, OEMs & EPC contractors",
      title: "Precision components, built to your drawing and delivered on time.",
      text: "From single prototypes to 10,000-piece runs: gears, shafts, flanges, valves and pumps, machined and tested in-house with full material traceability.",
      primary: { label: "Browse products", href: "#/products" },
      secondary: { label: "Request a quote", href: "#/quote" }
    },
    investor: {
      kicker: "For investors & strategic partners",
      title: "A profitable, export-led manufacturer ready to scale.",
      text: "Five years of double-digit growth, healthy EBITDA margins and a funded expansion plan into automated 5-axis machining and new export markets.",
      primary: { label: "View investor brief", href: "#/investors" },
      secondary: { label: "Talk to our CFO", href: "#/investors" }
    },
    supplier: {
      kicker: "For material & service suppliers",
      title: "Grow with a reliable, long-term industrial buyer.",
      text: "We buy over 3,000 t of steel and a wide range of services every year. Register once, get qualified, and receive RFQs that match your capability.",
      primary: { label: "What we source", href: "#/suppliers" },
      secondary: { label: "Register as supplier", href: "#/suppliers" }
    }
  },

  products: [
    {
      id: "hg-200",
      name: "HG-200 Spur & Helical Gears",
      category: "Power Transmission",
      model: "gear",
      color: "#a7b0bd",
      featured: true,
      summary: "Case-hardened alloy steel gears, module 2–8, ground to DIN 6.",
      description:
        "Made-to-drawing spur and helical gears for gearboxes, conveyors and mining drives. Forged blanks, hobbed and ground teeth, carburized and case hardened, 100% inspected on gear measuring centre.",
      specs: {
        Material: "42CrMo4 / 18CrNiMo7-6",
        Module: "2 – 8",
        "Number of teeth": "18 – 120",
        "Max. outside diameter": "600 mm",
        Hardness: "HRC 58 – 62 (case)",
        Accuracy: "DIN 6 (ground)"
      },
      applications: ["Gearboxes", "Conveyor drives", "Mining equipment"],
      moq: "20 pcs",
      leadTime: "4 – 6 weeks"
    },
    {
      id: "wn-150",
      name: "WN-150 Weld Neck Flanges",
      category: "Piping Components",
      model: "flange",
      color: "#9aa3ad",
      featured: true,
      summary: "Forged weld-neck flanges to ASME B16.5, Class 150 – 2500.",
      description:
        "Forged and machined weld-neck flanges in carbon and stainless steel. Raised-face or RTJ, supplied with EN 10204 3.1 mill certificates and full heat-number traceability.",
      specs: {
        Standard: "ASME B16.5 / EN 1092-1",
        Sizes: '1/2" – 24"',
        "Pressure class": "150 – 2500",
        Material: "A105, F304L, F316L, F51",
        Facing: "RF / RTJ / FF",
        Certification: "EN 10204 3.1"
      },
      applications: ["Oil & gas", "Petrochemical", "Power plants"],
      moq: "50 pcs",
      leadTime: "3 – 5 weeks"
    },
    {
      id: "cp-80",
      name: "CP-80 Centrifugal Pump",
      category: "Fluid Handling",
      model: "pump",
      color: "#2f6db5",
      featured: true,
      summary: "End-suction centrifugal pump, up to 120 m³/h and 80 m head.",
      description:
        "Robust end-suction pump set on a common baseplate with IE3 motor. Back-pull-out design for fast maintenance. Each unit is performance tested on our in-house test bench.",
      specs: {
        Flow: "5 – 120 m³/h",
        Head: "up to 80 m",
        "Motor power": "1.5 – 45 kW (IE3)",
        Casing: "Ductile iron / SS316",
        Seal: "Mechanical seal, single/double",
        Testing: "ISO 9906 performance test"
      },
      applications: ["Water treatment", "HVAC", "Process plants"],
      moq: "1 unit",
      leadTime: "6 – 8 weeks"
    },
    {
      id: "bv-300",
      name: "BV-300 Flanged Ball Valve",
      category: "Fluid Handling",
      model: "valve",
      color: "#c0392b",
      featured: false,
      summary: "Full-bore flanged ball valves, DN15 – DN300, PN16 – PN40.",
      description:
        "Two-piece full-bore ball valves with PTFE or metal seats. Lever, gearbox or actuator operated. ISO 5211 top flange for direct actuator mounting.",
      specs: {
        Sizes: "DN15 – DN300",
        "Pressure rating": "PN16 – PN40",
        "Body material": "WCB / CF8M",
        Seats: "PTFE / RPTFE / metal",
        Operation: "Lever / gear / actuator",
        "Top flange": "ISO 5211"
      },
      applications: ["Water", "Chemical", "Oil & gas"],
      moq: "10 pcs",
      leadTime: "4 – 6 weeks"
    },
    {
      id: "ps-500",
      name: "PS-500 Precision Shafts",
      category: "Power Transmission",
      model: "shaft",
      color: "#b8c0ca",
      featured: false,
      summary: "Turned and ground stepped shafts up to 3 m, h6 tolerance.",
      description:
        "CNC-turned, induction hardened and cylindrically ground shafts for motors, pumps and rollers. Keyways, splines and threads machined in one setup.",
      specs: {
        Material: "C45, 42CrMo4, SS420",
        "Max. length": "3,000 mm",
        "Diameter range": "10 – 250 mm",
        Tolerance: "h6 / g6",
        "Surface finish": "Ra 0.4 µm",
        Hardening: "Induction, HRC 50 – 55"
      },
      applications: ["Pumps", "Electric motors", "Conveyor rollers"],
      moq: "10 pcs",
      leadTime: "3 – 4 weeks"
    },
    {
      id: "mb-40",
      name: "MB-40 CNC Machined Brackets",
      category: "Custom Fabrication",
      model: "bracket",
      color: "#4f7cac",
      featured: true,
      summary: "5-axis machined aluminium & steel brackets, ±0.02 mm.",
      description:
        "Build-to-print structural brackets and housings, machined from billet on 5-axis centres. Anodizing, powder coating and assembly with inserts available.",
      specs: {
        Material: "Al 6061-T6, 7075, S355",
        Process: "5-axis CNC milling",
        Tolerance: "±0.02 mm",
        "Max. envelope": "800 × 600 × 500 mm",
        Finish: "Anodize / powder coat / zinc",
        Inspection: "CMM report on request"
      },
      applications: ["Automation", "Rail", "Machinery"],
      moq: "5 pcs",
      leadTime: "2 – 3 weeks"
    }
  ],

  capabilities: [
    { title: "CNC Machining", detail: "48 CNC turning & milling centres, including 12 five-axis machines. Repeatable ±0.01 mm." },
    { title: "Forging & Casting", detail: "Closed-die forging up to 250 kg and partner foundries for ductile iron and steel castings." },
    { title: "Heat Treatment", detail: "In-house carburizing, induction hardening, quench & temper with certified furnaces." },
    { title: "Fabrication & Welding", detail: "Certified welders (ISO 9606), robotic MIG cells and stress relieving." },
    { title: "Surface Finishing", detail: "Grinding to Ra 0.2 µm, shot blasting, painting, anodizing via approved partners." },
    { title: "Quality Laboratory", detail: "CMM, gear measuring centre, spectrometer, hardness & ultrasonic testing." }
  ],

  caseStudies: [
    {
      title: "Cutting lead time for a mining gearbox OEM",
      client: "Tier-1 mining equipment OEM",
      challenge: "Imported gears had 16-week lead times and frequent quality escapes.",
      solution: "Local forged blanks, dedicated gear-grinding cell and kanban stock agreement.",
      metric: "−62% lead time"
    },
    {
      title: "Pump packages for a municipal water project",
      client: "EPC contractor, water utility",
      challenge: "40 pump sets with witnessed performance tests on a tight schedule.",
      solution: "Parallel assembly lines and an expanded ISO 9906 test bench.",
      metric: "Delivered 3 weeks early"
    },
    {
      title: "Lightweight brackets for rail interiors",
      client: "Rolling-stock manufacturer",
      challenge: "Reduce weight while meeting fire and fatigue requirements.",
      solution: "Topology-optimized 5-axis machined Al 7075 design with DFM review.",
      metric: "−28% part weight"
    }
  ],

  investors: {
    headline: "Profitable growth with a clear plan to double capacity by 2028.",
    currencyUnit: "USD M",
    financials: [
      { year: 2020, revenue: 14.1, ebitdaMargin: 12.5 },
      { year: 2021, revenue: 16.8, ebitdaMargin: 13.9 },
      { year: 2022, revenue: 19.9, ebitdaMargin: 15.2 },
      { year: 2023, revenue: 23.4, ebitdaMargin: 16.1 },
      { year: 2024, revenue: 27.6, ebitdaMargin: 17.0 }
    ],
    extraKpis: [
      { label: "Customer retention", value: "94%" },
      { label: "Export share of sales", value: "46%" },
      { label: "Order backlog", value: "7.5 months" }
    ],
    thesis: [
      "Near-shoring trend: OEMs moving supply chains closer to end markets.",
      "Vertically integrated plant gives cost and lead-time advantage over traders.",
      "Diversified customer base: no single client above 12% of revenue.",
      "Experienced management team with 20+ years in heavy industry."
    ],
    ask: {
      amount: "USD 12M",
      round: "Growth equity / strategic partnership",
      useOfFunds: [
        { label: "Automated 5-axis machining line", pct: 40 },
        { label: "MES & factory digitalization", pct: 25 },
        { label: "Export market expansion", pct: 20 },
        { label: "Working capital", pct: 15 }
      ]
    },
    roadmap: [
      { period: "2025", title: "Automation phase 1", text: "Robotic loading on 8 CNC cells; MES rollout." },
      { period: "2026", title: "New machining hall", text: "+12,000 m² hall with automated 5-axis line." },
      { period: "2027", title: "Export expansion", text: "Sales offices in two new regions; API & ATEX certifications." },
      { period: "2028", title: "2× capacity", text: "Target revenue USD 55M with EBITDA above 18%." }
    ],
    team: [
      { name: "A. Founder", role: "CEO & Founder", bio: "25 years in precision manufacturing; built the company from a 6-machine workshop." },
      { name: "B. Finance", role: "CFO", bio: "Former Big-4 audit director; led two industrial M&A transactions." },
      { name: "C. Operations", role: "COO", bio: "Lean six-sigma black belt; ex-plant manager at a global gearbox OEM." }
    ]
  },

  suppliers: {
    intro:
      "We are always looking for reliable partners for raw materials, outsourced processes and indirect services. Qualified suppliers join our Approved Vendor List and receive RFQs directly.",
    categories: [
      { name: "Steel bar & forgings", detail: "42CrMo4, C45, 18CrNiMo7-6, SS304/316", volume: "~3,200 t / year" },
      { name: "Castings", detail: "Ductile iron & steel castings, 5 – 500 kg", volume: "~600 t / year" },
      { name: "Surface treatment", detail: "Anodizing, zinc plating, painting, nitriding", volume: "Ongoing" },
      { name: "Motors & bearings", detail: "IE3/IE4 motors 1.5 – 45 kW, rolling bearings", volume: "~1,500 units / year" },
      { name: "Tooling & cutting tools", detail: "Carbide inserts, hobs, grinding wheels", volume: "Ongoing" },
      { name: "Logistics & packaging", detail: "Export crating, sea & air freight forwarding", volume: "Ongoing" }
    ],
    requirements: [
      "ISO 9001 certified, or certification in progress",
      "Material certificates (EN 10204 3.1) where applicable",
      "On-time delivery performance of 95% or better",
      "Ability to support PPAP / first-article inspection",
      "Commitment to our supplier code of conduct (safety, environment, ethics)"
    ],
    process: [
      { step: "Register", text: "Submit your company profile and capabilities." },
      { step: "Qualification", text: "Document review and, if needed, a site audit." },
      { step: "Trial order", text: "Sample or first-article order to verify quality." },
      { step: "Approved vendor", text: "Listed on our AVL and invited to regular RFQs." }
    ]
  }
};
