# Competitive analysis · v3.0.0 study layer

What popular study and AI-learning apps do well, what 光耀同行 adopted, and where it deliberately differs. Competitor descriptions summarize publicly documented product behavior as of October 2026 and are not endorsements or exhaustive reviews.

| App | What makes it sticky | Adopted in v3 | Deliberately different |
| --- | --- | --- | --- |
| Duolingo | Bite-sized lessons, streaks, streak freezes, daily XP goals, immediate feedback, mobile-first habit loop | 3–5 minute interactive lessons, XP, streak + up to 2 earned freezes, daily goal (10/20/30 XP), instant explanations | No hearts/lives, no paywall, no guilt notifications, no public league ranking by default |
| Anki | Spaced-repetition scheduling that measurably improves retention | Simplified SM-2 review (again/hard/good/easy), keyboard shortcuts, 7-day forecast, auto-generated cards from every lesson | Cards are created for you from lessons; no deck management needed |
| Quizlet | Low-friction flashcards and multiple study modes | Cloze, tap-to-order and MCQ practice; "make a flashcard" from the tutor | No ads, no account wall |
| Brilliant | Learning by doing rather than reading | Each lesson mixes reading with interactive steps and a reflection | Values/practice content rather than STEM puzzles |
| NotebookLM | Answers grounded in the user's sources, with citations | Offline tutor 光光 retrieves only from course passages and cites the lesson; honest "not found" answers | Works without network or account; cloud AI is opt-in only |
| Khanmigo / ChatGPT Study Mode | Socratic tutoring that guides instead of handing out answers | "Quiz me", step-by-step hints, answer withheld until the learner asks; grounded system prompt for opt-in cloud AI | Consent dialog before any text leaves the device |
| Forest / focus timers | Lightweight focus sessions | 10/15/25-minute focus timer counted in stats | No virtual-tree purchases |
| Strava-style sharing | Shareable progress moments | PNG share card (native share or download) | Shares only what the learner chooses; no social feed by default |

## Differentiators

- **Cooperative, not competitive:** group weekly goals and opt-in leaderboards, aligned with the community's values.
- **Respectful motivation:** no hearts, no loss-aversion pressure, freezes earned automatically, reflection journal stays on the device.
- **Grounded AI:** answers cite course passages; unknown questions are admitted rather than invented.
- **Accessible:** text size up to extra-large, dark theme, Traditional Chinese text-to-speech with adjustable rate, keyboard review.
- **Offline-capable PWA:** one installable app for desktop and phone; the study layer is cached with the shell.

## Honest limits

- Lesson content is sample material written for the demo, not official teaching content.
- Progress, cards and journal entries are stored locally; there are no real accounts, sync or backend.
- The offline tutor is a keyword/bigram retriever, not a language model. The optional cloud AI uses Puter's browser SDK and was not exercised against the live service in automated tests.
- "Better than" claims require real-user retention and learning-outcome studies; none have been run.
- Physical phones, screen readers and real classroom use have not been validated.
