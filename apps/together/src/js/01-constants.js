/* ---------------------------------------------------------------- constants */
const STAGES = [
  { id: "dating",  name: "Dating",           blurb: "Know each other deeply: values, dreams, families, money." },
  { id: "engaged", name: "Engaged",          blurb: "Say yes, plan the wedding, align on the big life questions." },
  { id: "married", name: "Newlyweds",        blurb: "Build shared habits, finances and a safety net." },
  { id: "home",    name: "Our home",         blurb: "Save a deposit, choose where to live, make it ours." },
  { id: "kids",    name: "Starting a family", blurb: "Pregnancy, parental leave, wills and insurance." },
  { id: "family",  name: "Raising kids",     blurb: "School years, education funds, keeping couple time alive." },
  { id: "growth",  name: "Midlife & growth", blurb: "Careers, health, big adventures, caring for parents." },
  { id: "nest",    name: "Empty nest",       blurb: "Kids fly out; rediscover each other." },
  { id: "retire",  name: "Retirement",       blurb: "Retire together with enough to live the life you want." },
  { id: "golden",  name: "Golden years",    blurb: "Health, grandkids, legacy, and growing old side by side." },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((stage, index) => [stage.id, index]));

const CATEGORIES = {
  love:   { name: "Love" },
  money:  { name: "Money" },
  home:   { name: "Home" },
  family: { name: "Family" },
  health: { name: "Health" },
  career: { name: "Career" },
  travel: { name: "Travel" },
  growth: { name: "Growth" },
};

const TALKS = [
  { id: "values", stage: "dating", title: "Our values & dealbreakers", questions: [
    "What three values matter most to each of us?", "What would be a dealbreaker in a marriage?",
    "How do we each want to handle faith, culture and traditions?"] },
  { id: "money", stage: "dating", title: "Money history & habits", questions: [
    "Do we have debts? How much, and the plan to clear them?", "Are we savers or spenders? What does money mean to each of us?",
    "Joint account, separate, or both?"] },
  { id: "conflict", stage: "dating", title: "How we fight fair", questions: [
    "How do we each react under stress?", "What helps us calm down and repair after an argument?",
    "What words or behaviours are off-limits?"] },
  { id: "kids", stage: "engaged", title: "Kids: if, when, how many", questions: [
    "Do we both want children? How many, and roughly when?", "What if we face fertility problems — adoption, IVF?",
    "Which parenting values matter most (discipline, education, faith)?"] },
  { id: "families", stage: "engaged", title: "Our families & in-laws", questions: [
    "How often will we see each family? Holidays — whose turn?", "Would we ever live with or financially support parents?",
    "How do we protect our couple decisions from outside pressure?"] },
  { id: "wedding", stage: "engaged", title: "The wedding we really want", questions: [
    "Big party or small and meaningful?", "What budget feels right without starting married life in debt?",
    "Who pays for what?"] },
  { id: "roles", stage: "married", title: "Home life & fair share", questions: [
    "How do we split chores so both feel it is fair?", "How much alone time and friend time does each of us need?",
    "What is our weekly date-night ritual?"] },
  { id: "where", stage: "home", title: "Where we put down roots", questions: [
    "City, suburb or countryside? Near which family?", "Rent longer or buy? What price range is safe?",
    "Would we move for one partner's career?"] },
  { id: "parenting", stage: "kids", title: "Becoming parents", questions: [
    "How will we share night feeds, leave and childcare?", "Who is guardian for our kids if something happens to us?",
    "How do we keep our relationship first while parenting?"] },
  { id: "baby-research", stage: "kids", title: "Protecting us after the baby", questions: [
    "Research note: in Gottman's Bringing Baby Home studies, about two-thirds of new mothers reported a drop in relationship satisfaction in the years after the first baby. Couples who protected friendship and fondness did better.",
    "What will we do each week to stay a couple, not only parents?", "How will we share night duty and ask for help before we're exhausted?"] },
  { id: "protect", stage: "kids", title: "Protecting our family", questions: [
    "Do we have wills, life insurance and an emergency fund (3–6 months)?", "Where are important documents and passwords kept?",
    "What would we do if one of us could not work?"] },
  { id: "career", stage: "growth", title: "Careers & dreams in midlife", questions: [
    "Is either of us craving a change, a study or a sabbatical?", "How do we support each other's ambitions fairly?",
    "What adventure do we want before 60?"] },
  { id: "parents", stage: "growth", title: "Caring for ageing parents", questions: [
    "What care might our parents need, and who helps?", "How will we share costs and time between siblings?",
    "How do we avoid burnout while caring?"] },
  { id: "nest", stage: "nest", title: "Us again, after the kids", questions: [
    "What did we love doing before kids that we want back?", "Downsize, move, or stay?",
    "How much will we keep supporting adult kids?"] },
  { id: "retire", stage: "retire", title: "Our retirement picture", questions: [
    "At what age would we each like to stop working?", "What does a normal week look like in retirement?",
    "How much do we need per year to live that life?"] },
  { id: "legacy", stage: "golden", title: "Legacy & end-of-life wishes", questions: [
    "What do we want our grandkids to remember about us?", "What are our wishes for medical care and funerals?",
    "Who inherits what — and have we written it down?"] },
];

/** 8-week Foundations program. Educational summaries of published research — not therapy. */
const PROGRAM = [
  { title: "Love Maps: know each other's inner world", sourceName: "The Gottman Institute — Sound Relationship House", sourceUrl: "https://www.gottman.com/about/the-gottman-method/",
    idea: "In John Gottman's model of lasting relationships, the foundation is a detailed \u201clove map\u201d: knowing your partner's worries, hopes, friends and history. Gottman describes couples with rich love maps as better prepared for big changes like a move or a new baby.",
    exercise: ["Take turns asking the questions below. Listen, don't fix.", "Write one new thing you learned about each other in the notes."],
    prompts: ["What is stressing you most right now?", "Who do you feel closest to at the moment, apart from me?", "What's a dream you haven't said out loud yet?", "What would your perfect ordinary Saturday look like?"] },
  { title: "Turn toward each other's bids", sourceName: "APA — Lessons from the \u2018Love Lab\u2019 (Gottman)", sourceUrl: "https://www.apa.org/news/podcasts/speaking-of-psychology/loving-relationships",
    idea: "A \u201cbid\u201d is any small attempt to connect: a comment, a sigh, a question. In Gottman's six-year follow-up of newlyweds, couples still married had turned toward bids 86% of the time; couples who divorced, 33%.",
    exercise: ["For seven days, each notice three bids a day from your partner and respond, even briefly.", "At the end of the week, share which response felt best to receive."],
    prompts: ["What small things do I do that tell you I'm paying attention?", "When do you feel ignored, even if I don't mean it?"] },
  { title: "Five positives for every negative", sourceName: "The Gottman Institute — The Natural Principles of Love (PDF)", sourceUrl: "https://www.johngottman.net/wp-content/uploads/2011/05/The-Natural-Principles-of-Love.pdf",
    idea: "Gottman's research found that stable couples show about five positive interactions for every negative one during conflict, while couples heading for divorce average about 0.8 to 1. Positivity is a buffer, not a denial of problems.",
    exercise: ["Each day this week, tell your partner one specific appreciation (\u201cI noticed\u2026 and it meant\u2026\u201d).", "Use the monthly check-in to record your favourite one."],
    prompts: ["What's something I did recently that you appreciated but didn't mention?", "How do you most like to receive appreciation?"] },
  { title: "Know the Four Horsemen \u2014 and their antidotes", sourceName: "The Gottman Institute — research on couples", sourceUrl: "https://www.gottman.com/about/research/couples/",
    idea: "Gottman identified four patterns that predict relationship breakdown: criticism, contempt, defensiveness and stonewalling. Their antidotes: a gentle start-up (complain about the situation, not the person), building a culture of appreciation, taking responsibility for your part, and calming yourself with a real break before continuing.",
    exercise: ["Each name the horseman you fall into most often (be honest about yourself, not your partner).", "Agree on a signal that means \u201cI need a break, I'll come back in 20 minutes\u201d."],
    prompts: ["How can I raise a complaint so it feels gentle to you?", "What helps you calm down when you feel flooded?"] },
  { title: "Speaker\u2013Listener: be heard before solving", sourceName: "PREP (Markman & Stanley) — Speaker-Listener Technique", sourceUrl: "https://twointoone.co.uk/university/library/preddiv/index3.html",
    idea: "From the PREP program by Howard Markman and Scott Stanley: one person holds \u201cthe floor\u201d (any object) and speaks for themselves in short chunks; the other only paraphrases what they heard, without rebutting. Then you swap. Problem-solving comes later, once both feel understood.",
    exercise: ["Pick a small, low-stakes topic and practise for 10 minutes each way.", "Only move to solutions when both say \u201cyes, you got it\u201d."],
    prompts: ["What did it feel like to be paraphrased accurately?", "Which topic should we use this with next?"] },
  { title: "Live with perpetual problems", sourceName: "The Gottman Institute — The Natural Principles of Love (PDF)", sourceUrl: "https://www.johngottman.net/wp-content/uploads/2011/05/The-Natural-Principles-of-Love.pdf",
    idea: "Gottman's research suggests about 69% of relationship conflicts are perpetual: rooted in lasting differences in personality or needs. Happy couples don't solve them; they keep a friendly, curious dialogue about them instead of gridlock.",
    exercise: ["Choose one recurring disagreement (tidiness, money style, time with family).", "Each explain the story, value or dream behind your position. No persuading."],
    prompts: ["What does this issue mean to you, deep down?", "What small compromise could we both live with for now?"] },
  { title: "Money as a team", sourceName: "Practical guide (not a research claim)", sourceUrl: "",
    idea: "Money is one of the topics couples most need to talk about calmly. A short, regular \u201cmoney date\u201d makes it routine instead of a crisis. This week is a practical guide using your Money tab, not a research finding.",
    exercise: ["Open the Money tab together: review each savings pot and the retirement estimate.", "Agree on one shared goal for the next 3 months and a no-questions-asked personal spending amount for each of you."],
    prompts: ["What did money feel like in your family growing up?", "What would feel like \u201cenough\u201d to you?"] },
  { title: "Make it last: the weekly State of the Union", sourceName: "The Gottman Institute — How to have a State of the Union meeting", sourceUrl: "https://www.gottman.com/blog/how-to-have-a-state-of-the-union-meeting/",
    idea: "The Gottman Institute recommends a weekly \u201cState of the Union\u201d meeting: start with appreciations, talk about what went well, then discuss one issue calmly with the goal of understanding before problem-solving, and finish with \u201cWhat can I do to make you feel loved this week?\u201d",
    exercise: ["Hold your first meeting this week (about an hour), and put it in your calendar weekly.", "Use the monthly check-in in Together as your bigger review."],
    prompts: ["Five things I appreciated about you this week\u2026", "What can I do to make you feel loved this week?"] },
];

const DEFAULT_FUNDS = [
  { name: "Emergency fund", kind: "safety", milestoneTitle: "" },
  { name: "Wedding", kind: "wedding", milestoneTitle: "Wedding day" },
  { name: "Home deposit", kind: "home", milestoneTitle: "Buy our first home" },
];

