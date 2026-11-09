# OpenForge CLI Framework Research

**Scope:** Deep, production-grade comparison of Node.js CLI argument frameworks for the OpenForge TypeScript monorepo (Node 20+), with parity analysis against Go's `cobra` as the reference mental model.
**Candidates:** `citty` · `commander` · `yargs` · `oclif` · roll-your-own. (`ink` is analyzed as a *rendering layer*, not a parser — see §3.)
**Method:** Context7 current docs (per library) + primary READMEs/fetched source + third-party benchmarks and adoption evidence. Every quantitative claim carries a source in §11. Intro/tutorial material intentionally omitted.

> **Assumptions (stated per project coding discipline).** OpenForge is a greenfield TS monorepo shipping at least one developer-facing CLI with multiple subcommands, TypeScript throughout, Node 20+, and a stated goal of ergonomic parity with a Go `cobra` CLI. It is assumed to be a "real tool" (≈5–30 subcommands) rather than a one-shot script, and *not* (yet) a platform with an end-user plugin marketplace. If any of those assumptions are wrong, §10's recommendation flips — trigger conditions are spelled out there.

---

## 0. Executive summary (read this first)

| Concern | citty | commander | yargs | oclif | roll-your-own |
|---|---|---|---|---|---|
| Runtime deps | 0 | 0 | ~6–14 | ~18–28 | 0 |
| Bundle (min+gzip, single entry) | ~3.7 kB | ~11 kB | ~35 kB | ~104 kB | 0 |
| Unpacked install | ~52 kB | ~203 kB | ~515 kB | ~912 kB (core) | 0 |
| Cold-start overhead (over bare node) | ~+6 ms | ~+17 ms | ~+78 ms | ~+131 ms | ~0 |
| Typed TS | native (const generic) | native + `extra-typings` | `@types/yargs` (weaker) | native (strongest) | you write it |
| Subcommands | nested + lazy | nested + exec files | `.command()` | file-based (scales) | hand-rolled |
| Pre/post/around hooks | setup/cleanup | preAction/postAction/preSubcommand | `.middleware()` | init/prerun/postrun/finally/custom | hand-rolled |
| Shell completion | none built-in | none built-in (roll your own) | `.completion()` bash/zsh | `plugin-autocomplete` | hand-rolled |
| Plugin system (user-installed) | no | no (RFC unlanded) | no | **yes (npm, JIT)** | hand-rolled |
| Best-fit | minimal/fast dev tools | most real-world tools | declarative validation | enterprise/platform CLIs | one-shot scripts |
| cobra parity (ergonomics) | low | **high** | medium | medium (plugin model is closer) | — |

**Bottom line:** For a TS monorepo building a serious multi-command developer CLI in 2026, **`commander` is the default recommendation** (§10): zero-dependency, native TS, the largest battle-tested codebase (~28k stars, hundreds of millions of weekly downloads, mostly transitive), ~17 ms overhead, and the closest everyday ergonomics to `cobra`. Choose **`citty`** if you want the absolute lightest zero-dep footprint and a small command surface (it's what Nuxt/Nitro ship). Choose **`oclif`** *only* if you need an end-user plugin architecture + auto-updating installers + 50+ commands maintained by a team over years (Heroku/Salesforce pattern). `yargs` is the declarative-validation option but is the slowest and now shows stale-release signals. Roll-your-own is defensible only for a single-purpose script; it is the wrong default for a growing monorepo CLI.

---

## 1. Argument Parsing Patterns

All five handle the core case (boolean flags, value options, positionals, aliases, defaults). The differences are in *validation ergonomics*, *custom parsing*, and *type safety*.

### 1.1 citty — declarative `ArgsDef`, built on native `util.parseArgs`

citty's `parseArgs()` is a thin, type-safe wrapper around Node's built-in `util.parseArgs` (wraps it with `allowPositionals: true`, `strict: false`, `--no-` negation preprocessing, and alias propagation). Argument *types* are a closed set: `positional`, `string`, `boolean`, `enum`.

```ts
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  args: {
    name: { type: "positional", description: "Your name", required: true },
    friendly: { type: "boolean", description: "Use friendly greeting", alias: ["f"] },
    greeting: { type: "string", description: "Custom greeting", default: "Hello" },
    level: {
      type: "enum",
      description: "Log level",
      options: ["debug", "info", "warn", "error"],
      default: "info",
    },
  },
  run({ args }) {
    console.log(`${args.greeting} ${args.name}! (level: ${args.level})`);
  },
});
runMain(main);
```

- **Variadic args:** citty's built-in arg types do **not** expose a first-class variadic option (no `array: true` equivalent). You collect repeats by reading the proxy or by custom logic in `run`. This is a real gap vs cobra's `StringSlice` and yargs' `.array()`.
- **Optional vs required:** `required: true` (positional) or `required: true` on a named arg; missing → throws `CLIError` with code `EARG` (`"Missing required argument: --<name>"`).
- **Defaults:** `default` on any arg; applied at parse time; also drives `--no-` help rendering for booleans.
- **Validation hooks:** enum membership (`options`) is enforced natively → `CLIError` (`"Invalid value for argument: --<name> (<value>). Expected one of: ..."`). Beyond that you validate inside `run` (no declarative `check()`/`coerce()`).
- **Custom parsers (path, semver, dur, URL):** not built in. citty has *no* `coerce`/`argParser` hook. You accept a `string` and parse yourself in `run` (or wrap with your own small parser). This is the main functional cost of citty's minimalism.
- **Case-agnostic access:** the `ParsedArgs` result is a Proxy; `args["output-dir"]`, `args.outputDir`, and `args["outputDir"]` all resolve to the same value (auto camelCase/kebabCase aliasing).
- **Built-in flags:** `--help`/`-h` and `--version`/`-v` are automatic (disabled if you define args with those names/aliases).

### 1.2 commander — fluent, strict, coercion via functions

commander is strict by default (unknown option → error with "did you mean?" suggestions). Parsing idioms come from `.option()` / `.argument()` plus optional `Option`/`Argument` object construction.

**Variadic (the `...` idiom):**
```js
// Last ARGUMENT variadic:
program
  .command('rmdir')
  .argument('<dirs...>')
  .action((dirs) => dirs.forEach((d) => console.log('rmdir %s', d)));

// Variadic OPTION (-n <numbers...> / -l [letters...]):
program
  .option('-n, --number <numbers...>', 'specify numbers')
  .option('-l, --letter [letters...]', 'specify letters');
// $ collect -n 1 2 3 --letter a b c
//   => { number: ['1','2','3'], letter: ['a','b','c'] }
```
- **Optional vs required:** `.option('-c, --cheese <type>', ...)` is optional; `.requiredOption('-c, --cheese <type>', ...)` is mandatory (error: `required option ... not specified`). Arguments use `<required>` vs `[optional]`.
- **Defaults:** positional arg default (`program.option('-c', 'desc', 'blue')`) and `Option.default(60, 'one minute')`.
- **Negatable boolean / boolean|value:** `--no-sauce`; `--cheese [flavour]` (optional-arg boolean).
- **Custom parsers (path, semver, dur, URL):** the killer feature — pass a function as the option/argument parser. `(value, previous) => newValue`. You can throw `commander.InvalidArgumentError`. This is cobra's `pflag.Value` / yargs' `coerce` equivalent:
```js
function myParseInt(value, prev) {
  const n = parseInt(value, 10);
  if (isNaN(n)) throw new commander.InvalidArgumentError('Not a number.');
  return n;
}
function collect(value, prev) { return prev.concat([value]); }
function commaSeparatedList(value) { return value.split(','); }

program
  .option('-f, --float <n>', 'float', parseFloat)
  .option('-i, --integer <n>', 'int', myParseInt)
  .option('-v, --verbose', 'verbosity', (val, prev) => prev + 1, 0)
  .option('-c, --collect <value>', 'repeatable', collect, [])
  .option('-l, --list <items>', 'csv list', commaSeparatedList);
```
- **`Option` object extras:** `.choices(['small','medium','large'])`, `.env('PORT')`, `.conflicts('port')`, `.implies({ drink: 'small' })`, `.preset('20')`, `.hideHelp()`, `.argParser(parseFloat)`. `Argument` supports `.choices()` and `.default()`.
- **Type safety:** values reach `.opts()` as whatever your parser returns (so `--integer` yields a real `number`). Stronger inference via `@commander-js/extra-typings` (see §6).

### 1.3 yargs — declarative schema, built-in coercion + validation

yargs leans on a *declarative* option schema with `type`, `choices`, `coerce`, `check`, `demandOption`, `array`, and `recommendCommands`. This is the richest validation story of the JS set.

```js
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .options({
    run:  { alias: 'r', describe: 'run your program', demandOption: true },
    path: { alias: 'p', describe: 'path to file', demandOption: true, type: 'string' },
    spec: { alias: 's', describe: 'program specs', type: 'array' },
  })
  .strict()            // reject unrecognized args/commands
  .recommendCommands() // `tasks lisst` -> "did you mean list?"
  .middleware([
    (argv) => { /* pre-validation global hook */ }
  ], false)
  .check((argv) => {
    if (!argv.run && !argv.path) throw 'Provide run or path';
    return true;
  })
  .help()
  .parse();
```
- **Variadic:** `type: 'array'` (`.array('x')`) → `argv.x` is an array; `-x 5 6 7` works.
- **Optional vs required:** `demandOption: true` (or `.demandOption(['run','path'], 'msg')`).
- **Defaults:** `default:` in the option schema.
- **Validation hooks:** `choices`, `check(argv)`, `coerce` (auto-coerce `number`/`boolean`, or a custom function), `implies`, `conflicts`, `normalize`, `global`, `strict`.
- **Custom parsers (path, semver, dur, URL):** `type: 'number'`/`'boolean'` auto-coerce; otherwise `coerce: (v) => semver.coerce(v)`. Type coercion is *built in* (numbers as numbers, booleans as booleans) — you don't hand-roll `parseInt` like commander.
- **Notes:** yargs is heavier and the most "config-as-data" of the three. It now flags **STALE** on several trackers (v18.2.0 last published 2025-05; one tracker marks the package stale despite recent commits) — a maintenance-signal worth tracking.

### 1.4 oclif — `Flags.*` / `Args.*` factories with built-in type parsers

oclif's parser is the most "batteries included" on the TypeScript axis. Flags and args are declared with typed factory functions (`Flags.string`, `Flags.integer`, `Flags.option`, `Flags.file`, `Flags.url`, `Flags.boolean`, `Args.string`, `Args.integer`, ...). Parsing happens via `this.parse(MyCommand)` inside `run()`.

```ts
import { Command, Flags, Args } from '@oclif/core'

export default class Deploy extends Command {
  static description = 'Deploy an app'
  static args = {
    name: Args.string({ required: true }),
  }
  static flags = {
    force:   Flags.boolean({ char: 'f' }),
    retries: Flags.integer({ default: 3, min: 0, max: 10 }),
    env:     Flags.option({ options: ['prod','staging','dev'] as const, required: true }),
    wait:    Flags.boolean({ allowNo: true }),                 // --wait / --no-wait
    region:  Flags.string({ env: 'DEPLOY_REGION' }),           // env-var bound
    config:  Flags.file({ exists: true, description: 'path' }),
    from:    Flags.url({ default: new URL('https://oclif.io') }),
    tags:    Flags.string({ multiple: true, delimiter: ',' }), // variadic
  }
  async run() {
    const { flags, args } = await this.parse(Deploy)
    this.log(`env=${flags.env} retries=${flags.retries} tags=${flags.tags.join(',')}`)
  }
}
```
- **Variadic:** `Flags.string({ multiple: true, delimiter: ',' })` (repeatable) — the `Args.integer`/`Flags.integer` parsers throw on out-of-range (integer parser regex `^-?\d+$` + `min`/`max`).
- **Optional vs required:** `required: true` on a flag or `Args.string({ required: true })`.
- **Defaults:** `default:` on every flag factory.
- **Validation hooks:** `min`/`max`, `options` (enum), `exists` (file), `Constraints.*` (custom constraint objects), `static constraints` on the class. `strict = true` rejects extra args (set `false` for variable arity).
- **Custom parsers (path, semver, dur, URL):** `Flags.url`, `Flags.file` are built in; for semver/dur you supply a `custom` flag/arg parser (the `Args.integer` source is itself a `custom<number, {min,max}>({ parse })` — the same `custom()` primitive builds any parser).
- **Env binding:** `Flags.string({ env: 'DEPLOY_REGION' })` is first-class (cobra/viper do this via the flag+env layer; oclif bakes it into the flag).
- **`enableJsonFlag = true`** adds a global `--json` and `this.jsonEnabled()` (see §3).

### 1.5 cobra (the Go reference) — `pflag` + `Args` validators

For parity framing, cobra's model is what you're matching ergonomics against:
- **Variadic:** `Flags().StringSliceVar(&slices, "label", nil, "…")` / `StringArrayVar`; positionals are variadic by construction (Go `args []string`).
- **Optional vs required:** `cmd.Flags().MarkFlagRequired("name")`; `Args: cobra.ExactArgs(1)`.
- **Defaults:** the default-value parameter on every `*Var`/`*VarP` helper.
- **Validation hooks:** `Args` field takes a validator (`NoArgs`, `ArbitraryArgs`, `MinimumNArgs(n)`, `MaximumNArgs(n)`, `ExactArgs(n)`, `RangeArgs(min,max)`, `OnlyValidArgs`, `NoDuplicateArgs`, `MatchAll`, `MatchAny`) *or* a custom `func(cmd, args) error` that may compose built-ins. Flag relationships via `MarkFlagsMutuallyExclusive`, `MarkFlagsRequiredTogether`, `MarkFlagsOneRequired` (cobra 1.8+).
- **Custom parsers (path, semver, dur, URL):** implement `pflag.Value` (`Set/Type/String`) and register with `Flags().Var(&myVal, "name", "…")`; `duration`/`IP`/`IntSlice` etc. are provided by `pflag`.
- **Type safety:** it's Go — typed flags give you strongly-typed variables at compile time. This is the bar commander-with-`extra-typings` and oclif both try to approximate in TS.

### 1.6 roll-your-own
A `util.parseArgs`-based hand-rolled parser (which is literally what citty wraps) gives you zero deps and full control, but you re-implement: variadic collection, `--no-` negation, alias/case normalization, choices, and *all* of §2–§7 (help, hooks, completion, plugins, TS inference). Defensible for ≤5 commands; the ceiling is real (multiple 2026 guides put "roll your own" at ~5 commands before it fights you).

---

## 2. Subcommand Structure

### 2.1 Flat vs nested + routing

- **citty** — nested via `subCommands` map (recursive). Supports **lazy/async** subcommands (only the invoked command is `import()`ed) and a `default` subcommand (runs when no subcommand token is given; conflicts with `run`). Routing is by object key.
```js
const main = defineCommand({
  meta: { name: 'deploy', description: 'Deployment tool' },
  subCommands: {
    aws:    () => import('./commands/aws.mjs').then(m => m.default),   // lazy
    docker: () => import('./commands/docker.mjs').then(m => m.default),
  },
});
```
`meta.alias` (e.g. `['i','add']`) and `meta.hidden: true` are supported per subcommand.

- **commander** — nested `.command()` / `.addCommand()` to arbitrary depth. Two implementation styles: (a) in-process `.action()` handler, (b) **stand-alone executable files** (`command-subcommand`, e.g. `pm-install`) discovered by `.executableDir()`. `.addCommand()` composes pre-built commands. `isDefault: true` runs a subcommand by default; `.alias()` adds alt names.
```js
program
  .command('clone <source> [destination]')
  .description('clone a repo')
  .action((source, destination) => { /* ... */ });
program
  .command('start <service>', 'start named service')   // stand-alone executable style
  .command('stop [service]', 'stop named service, or all');
program.addCommand(build.makeBuildCommand());          // composed
```

- **yargs** — `.command(cmd, description, builder, handler)` (or a command module object). Flat and nested both work; nested is just deeper `.command` nesting or a command module with its own `command`.
```js
yargs(hideBin(process.argv))
  .command('serve [port]', 'start the server',
    y => y.positional('port', { describe: 'port', default: 5000 }),
    argv => { serve(argv.port); })
  .commandDir({ hidden: false })   // auto-load commands from a dir (scales like oclif's pattern)
  .demandCommand(1)
  .help()
  .parse();
```
- **oclif** — **file-based, one-command-per-file** by default (`pattern` discovery over `./dist/commands` via globs; also `explicit` — a map export — and `single`). Command IDs are topic-separated (`:` by default, Salesforce uses a space). This is the model that scales to hundreds/thousands of commands (Salesforce CLI, Heroku CLI).
- **cobra** — `rootCmd.AddCommand(subCmd)` to arbitrary depth; the idiomatic layout is one file per command, each exporting a `newXxxCmd() *cobra.Command` factory; register in `init()` (or, the more testable modern pattern, in a root factory that builds the tree — see §10 migration notes).

### 2.2 Help propagation

- **citty:** auto `--help`/`--version`; `renderUsage(cmd, parent?)` / `showUsage()` generate usage from the arg defs; subcommand usage composes from parent.
- **commander:** auto help command is added when subcommands exist; `help help-sub` ≡ `sub --help`. Customizable via `addHelpText('before'|'after'|'beforeAll'|'afterAll', …)`, `.helpCommand()`, **Help Groups** (`.optionsGroup()`/`.commandsGroup()`/`.helpGroup()`), and subclassing `Help` via `.createHelp()` / `.configureHelp()`. `.showHelpAfterError()` and "did you mean" suggestions are on by default.
- **yargs:** dynamic help menu generated from the option/command schema; sections via `.epilogue()`/`.demandCommand()`. Help layout is built on `cliui` (the yargs monorepo's layout DSL).
- **oclif:** rich auto `--help` with flags, args, examples; auto-doc generation for the README on publish; topics organize the tree.
- **cobra:** auto help per command (`-h`/`--help`), `Short`/`Long`/`Example` fields, command **groups** render as sections in `--help`, "did you mean" suggestions, auto man-page generation.

### 2.3 Middleware / hooks: pre-run, post-run, around

This is where the frameworks diverge most architecturally.

| Framework | Pre-run | Post-run | Around/wrap | Notes |
|---|---|---|---|---|
| citty | `setup()` | `cleanup()` | plugins wrap `setup`/`cleanup` | `cleanup` always runs, even if `run` throws; only the executed command's hooks run |
| commander | `.hook('preAction', …)` / `.hook('preSubcommand', …)` | `.hook('postAction', …)` | hooks fire before/after this command **and nested subcommands** | callback `(thisCommand, actionCommand)`; async hooks → use `.parseAsync()` |
| yargs | `.middleware([...], applyBeforeValidation?)` | — (use middleware + handler) | middleware is the primitive | runs for all commands in order |
| oclif | `init` → `preparse` → `prerun` | `postrun` → `finally` | hooks are first-class, can be in plugins; custom events via `config.runHook()` | multiple hooks run in parallel; `finally` runs regardless of exit |
| cobra | `PersistentPreRunE`/`PreRunE` | `PersistentPostRunE`/`PostRunE` | persistent hooks cascade the tree | gotcha: a child's `PersistentPreRunE` *replaces* the parent's unless `EnableTraverseRunHooks=true` (1.8+) |

**citty hooks + plugins (around):**
```js
import { defineCommand, defineCittyPlugin, runMain } from "citty";

const logger = defineCittyPlugin({
  name: 'logger',
  setup({ args }) { console.log('Logger setup, args:', args); },
  cleanup() { console.log('Logger cleanup'); },
});

const main = defineCommand({
  meta: { name: 'hello', description: 'My CLI App' },
  plugins: [logger],        // plugin setup runs before command setup (in order)
  setup() { console.log('Setting up...'); },
  cleanup() { console.log('Cleaning up...'); },   // reverse order; always runs
  run() { console.log('Hello!'); },
});
runMain(main);
```

**commander hooks:**
```js
program
  .option('-t, --trace', 'display trace statements')
  .hook('preAction', (thisCommand, actionCommand) => {
    if (thisCommand.opts().trace) {
      console.log(`About to call action handler for: ${actionCommand.name()}`);
    }
  });
// events: preAction, postAction, preSubcommand
```

**yargs middleware:**
```js
const argv = yargs(hideBin(process.argv))
  .middleware([
    async (argv, yargs) => { argv.startTime = Date.now(); },   // runs for every command
  ], false)
  .parse();
```

**oclif lifecycle (the `_run` order, from source):** `init()` → `run()` → on error `catch()` → always `finally()`; plus the `Config`-level hooks `init`/`prerun`/`postrun`/`finally`/`preparse`/`command_not_found`. A `preparse` hook can rewrite raw args before parsing (Salesforce uses this for `--flags-dir`):
```ts
// package.json
"oclif": { "hooks": { "init": "./lib/hooks/init", "prerun": "./lib/hooks/prerun" } }
```

**cobra hook cascade (the canonical example, with the cascade caveat):**
```go
var rootCmd = &cobra.Command{
    Use: "root [sub]",
    PersistentPreRun: func(cmd *cobra.Command, args []string) { fmt.Println("root PersistentPreRun") },
    PreRun:           func(cmd *cobra.Command, args []string) { fmt.Println("root PreRun") },
    Run:              func(cmd *cobra.Command, args []string) { fmt.Println("root Run") },
    PostRun:          func(cmd *cobra.Command, args []string) { fmt.Println("root PostRun") },
    PersistentPostRun:func(cmd *cobra.Command, args []string) { fmt.Println("root PersistentPostRun") },
}
// For `root sub arg1 arg2` only the FIRST persistent hook in the chain runs
// unless cobra.EnableTraverseRunHooks = true (cobra 1.8+).
```

**Design note for OpenForge:** if you want cross-cutting auth/config/telemetry that runs around *every* command, every framework supports it (citty plugins, commander `preAction` on root, yargs `.middleware`, oclif `init`/`prerun`, cobra `PersistentPreRunE`). The cobra gotcha (persistent-hook replacement) is the one to internalize if you later port a Go CLI.

---

## 3. Output Rendering

None of the JS argument frameworks ships a *data table* renderer except oclif (which has `ux.table`). For everything else you reach for small composable libs. `ink` is the outlier: it's a **React renderer for the terminal**, not an argument parser — pair it with one of the above if you need a TUI.

### 3.1 Built-in table / JSON per framework

| Framework | Data table | `--json` output | Notes |
|---|---|---|---|
| citty | no | no (write it) | `renderUsage` is for help only |
| commander | no | no (write it in `action`) | `Help` class only formats help |
| yargs | no (help layout via `cliui`) | no (write it) | `cliui` is a column-layout DSL for help text, not data tables |
| oclif | **yes** — `this.table()` | **yes** — `enableJsonFlag` + `--json` | stable, framework-managed JSON |
| cobra | no (you format) | no (you marshal) | Go `encoding/json` / `text/tabwriter` |

**oclif table + JSON (the most built-in of the JS set):**
```ts
import { Command, Flags } from '@oclif/core'

export default class List extends Command {
  static description = 'list things'
  static flags = { all: Flags.boolean({ char: 'a' }) }
  static enableJsonFlag = true   // adds --json and makes jsonEnabled() meaningful

  async run() {
    const { flags } = await this.parse(List)
    const rows = await fetchRows(flags.all)
    if (this.jsonEnabled()) {
      this.logJson(rows)          // stable, parseable output for scripts/CI
      return
    }
    this.table(rows, { name: { header: 'NAME' }, age: { header: 'AGE' } })
  }
}
```
`jsonEnabled()` returns true only when the command supports JSON **and** `--json` is present (it also honors the `CONTENT_TYPE=json` env var). The framework emits `{ "result": … }` on success via `toSuccessJson` — a stable envelope for machine consumers.

**commander / citty / yargs JSON** — you own the envelope. A common OpenForge pattern (stable key order + JSON Lines for lists):
```js
// stable key order: build the object in a fixed order (JS preserves insertion order for string keys)
const row = { name: r.name, id: r.id, created: r.createdAt };
console.log(JSON.stringify(row, null, 2));      // pretty for humans
// JSON Lines (one object per line) for `--json` on a list command:
rows.forEach((r) => process.stdout.write(JSON.stringify(r) + '\n'));
```

### 3.2 Custom templates

- **gh's `--template` (Go):** `gh pr list --template '{{range .}}{{.title}}{{"\n"}}{{end}}'` uses Go's `text/template`. There is **no JS argument framework equivalent**; if OpenForge wants template-driven output you implement a small Go-template-subset evaluator or use a JS template lib (e.g. `eta`, `handlebars`) and a `--template` flag. This is a pure feature gap in all four JS frameworks.
- **oclif** has no `--template`, but its `--json` + external `jq` covers most scripting needs, and `ux.table` column configs approximate "shape the output."
- Practical JS pattern: `--output table|json|csv|template`.

### 3.3 The rendering library stack (pair with any framework)

| Library | Role | Minimal use |
|---|---|---|
| `cli-table3` | static data tables | `new Table({ head: ['NAME','AGE'] }).push(...).toString()` |
| `chalk` | ANSI colors/styles (v5 is ESM) | `chalk.green('✓')`, `chalk.bold(red('error'))` |
| `ora` | spinners | `ora('building').start().succeed('done')` |
| `listr2` | task lists (the classic npm-style checklist) | `new Listr([...]).run()` |

```js
import Table from 'cli-table3';
import chalk from 'chalk';
import ora from 'ora';

const t = new Table({ head: ['NAME', 'STATE'], style: { head: [] } });
rows.forEach(r => t.push([r.name, r.state === 'ok' ? chalk.green('ok') : chalk.red('fail')]));
process.stdout.write(t.toString() + '\n');

const spin = ora('preparing').start();
await work();
spin.succeed('ready');
```

### 3.4 `ink` — React for the terminal (rendering layer only)

ink renders React components to the terminal with Flexbox layout. It is **not** an argument parser — you still use citty/commander/etc. for argv, then hand off to ink when the command is interactive.

```jsx
// render() mounts a React tree to the TTY
import { render, Box, Text } from 'ink';
render(
  <Box flexDirection="column" padding={1} borderStyle="round">
    <Box><Text color="green">✓</Text><Text>  Prep work done</Text></Box>
    <Box width="50%" marginTop={1}><Text>Half-width box</Text></Box>
  </Box>
);

// useInput() captures keystrokes (raw mode is ref-counted)
import { useInput } from 'ink';
const App = () => {
  useInput((input, key) => {
    if (input === 'q') process.exit(0);
    if (key.leftArrow) { /* move */ }
    if (key.return) { /* submit */ }
  });
  return <Text>Press q to quit</Text>;
};

// renderToString() → synchronous string (tests / doc generation / file output)
import { renderToString } from 'ink';
const out = renderToString(<Box padding={1}><Text color="green">Hi</Text></Box>);
```
When to use: interactive prompts, live dashboards, multi-pane TUIs. When *not* to use: one-shot commands that print a table and exit (ink + React adds bundle and startup cost with no benefit). For non-interactive prompts, `prompts`/`inquirer` are lighter.

---

## 4. Shell Completion

### 4.1 Static (full tree baked) vs dynamic (lazy)

- **Static:** the entire command tree is known at generation time; the shell script enumerates every command/flag. oclif's completion and commander's hand-rolled completion command are static-ish.
- **Dynamic (cobra-style):** the completion handler shells out to the program itself (e.g. `prog __complete <partial>`), so completions can depend on state (e.g. "complete with the user's real app names"). cobra's `RegisterFlagCompletionFunc` / `ValidArgsFunction` is the canonical dynamic model; oclif's Heroku example (`heroku info --app=<tab>` completing to the user's apps) is the same idea in JS.

### 4.2 Per-framework support (bash / zsh / fish / powershell)

| Framework | Built-in | Shells | How |
|---|---|---|---|
| cobra | **yes** | bash, zsh, fish, powershell | `GenBashCompletion`/`GenZshCompletion`/`GenFishCompletion`/`GenPowerShellCompletionWithDesc` |
| oclif | **yes** (plugin) | bash, zsh | `@oclif/plugin-autocomplete` (or core `completion` command) |
| yargs | **yes** (partial) | bash, zsh | `.completion()` (auto or custom fn) |
| commander | **no** | — | hand-roll a `completion` command |
| citty | **no** | — | hand-roll (or add a subcommand) |
| roll-your-own | no | — | you write it |

**cobra (all four shells, the reference):**
```go
var completionCmd = &cobra.Command{
    Use:   "completion [bash|zsh|fish|powershell]",
    Short: "Generate completion script",
    Args:  cobra.MatchAll(cobra.ExactArgs(1), cobra.OnlyValidArgs),
    ValidArgs: []string{"bash","zsh","fish","powershell"},
    Run: func(cmd *cobra.Command, args []string) {
        switch args[0] {
        case "bash":       cmd.Root().GenBashCompletion(os.Stdout)
        case "zsh":        cmd.Root().GenZshCompletion(os.Stdout)
        case "fish":       cmd.Root().GenFishCompletion(os.Stdout, true)
        case "powershell": cmd.Root().GenPowerShellCompletionWithDesc(os.Stdout)
        }
    },
}
// Dynamic noun completion:
cmd.ValidArgs = []string{"pod","node","service","replicationcontroller"}
```
Also supports **dynamic flag-value completion** via `cmd.RegisterFlagCompletionFunc("app", func(...) { return userApps, nil })`.

**yargs (bash/zsh):**
```js
import yargs from 'yargs';
const argv = yargs(hideBin(process.argv))
  .completion('completion', (current, argv) => [
    // dynamic: return candidates based on `current` and already-parsed `argv`
    'foo', 'bar',
  ])
  .parse();
```

**oclif:** add `@oclif/plugin-autocomplete` to `oclif.plugins` and ship an `autocomplete` command; it generates bash/zsh completions for commands, flags, *and flag values* (value completion is configurable per flag — how Heroku completes app names).

**commander / citty (no built-in) — minimal static completion command pattern:**
```js
// commander: a `completion` subcommand that prints a shell script
program.command('completion')
  .description('print bash completion')
  .action(() => {
    const cmds = program.commands.map(c => c.name()).join(' ');
    process.stdout.write(
`_openforge() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W "${cmds}" -- "$cur") )
}
complete -F _openforge openforge
`);
  });
```
(For dynamic value completion in commander you'd shell out to the program with a hidden `__complete` subcommand — the cobra pattern — and emit candidates.)

**Recommendation for OpenForge:** if cobra parity matters, adopt cobra's two-part contract: (1) a static `completion <shell>` command, and (2) a hidden dynamic `__complete` subcommand for value completion. This is straightforward in commander and matches the Go CLI behavior users expect.

---

## 5. Plugin / Extension Model

### 5.1 The three real patterns (and a comparison)

| Aspect | gh extensions (Go) | oclif plugins (JS) | cobra nested (Go) | commander/citty/yargs |
|---|---|---|---|---|
| Mechanism | standalone `gh-<ext>` binary on `PATH` | npm package with `oclif.plugins` entry | commands compiled into one binary | **none built-in** |
| Distribution | git clone → build (`gh extension install owner/repo`) | `npm install` (or `sf plugins install`) | n/a (single artifact) | n/a |
| Process isolation | **yes** (separate process) | **no** (in-process, shared `node_modules` trust domain) | **no** (same process) | n/a |
| Secret access | shares env + `gh auth token`; no sandbox | inherits CLI config/env; no sandbox | same process memory | n/a |
| Versioning | extension binary versioned independently of core | npm semver per plugin; core pins ranges | single version | n/a |
| Sandboxing | OS process boundary only (no sandboxing) | none (full Node API access) | none | n/a |
| Scales to | hundreds of community extensions | 50–1000s of commands across plugins | as many commands as you compile | — |

**gh extensions** (the git-clone pattern): an extension is a separate Go binary named `gh-<extension>` that the core `gh` discovers on `PATH` and `exec`s, forwarding argv and stdin/stdout. Distribution is `gh extension install <owner>/<repo>` (clones + builds) or a prebuilt binary. Isolation is the OS process boundary: each extension runs as its own process, but it shares the parent's environment and `gh`'s auth token (no secret sandboxing). This gives a huge community extension surface with supply-chain isolation.

**oclif plugins** (the npm pattern): a plugin is structurally identical to a CLI — it can contribute **commands, hooks, and nested plugins**. Discovered from three sources: `oclif.plugins` in `package.json`, installed npm dependencies, and user-installed plugins (`@oclif/plugin-plugins`). Command discovery per plugin uses `pattern` / `explicit` / `single` strategies. Plugins run **in-process** (shared trust domain, no sandbox; a plugin gets full Node API access), which is why the model works for Salesforce (internal + vetted external providers) but is *not* a safe community marketplace.

```json
{
  "name": "mycli",
  "oclif": {
    "plugins": [
      "@oclif/plugin-help",
      "@oclif/plugin-not-found",
      "@oclif/plugin-plugins",
      "@oclif/plugin-autocomplete"
    ]
  }
}
```
Useful oclif plugins: `plugin-not-found` (did-you-mean), `plugin-plugins` (user install), `plugin-update` (autoupdate), `plugin-help`, `plugin-commands`, `plugin-version`, `plugin-warn-if-update-available`, `plugin-which`, `plugin-search`, `plugin-autocomplete`.

**Salesforce just-in-time (JIT) plugins** are the standout production pattern: `oclif.jitPlugins` lists commands that *appear in help* but whose plugin is **downloaded on first use** (Salesforce's `plugin-code-analyzer`, `plugin-devops-center`). This is the closest JS analog to a lazy/compiled extension and is exactly the "plugin that ships on demand" behavior a large platform CLI wants.

**cobra nested commands** (the same-binary pattern): no plugin system; you `AddCommand` subtrees at compile time. Large Go CLIs (kubectl, gh core, hugo) modularize by *package* (each feature package exports `newXxxCmd()`), which is a compile-time composition, not a runtime plugin. To get cross-process extensibility in Go you'd build the gh-extension-style binary discovery yourself.

**commander / citty / yargs:** no user-installable plugin system. commander's RFC #2505 (plugins) is **closed unlanded** — so if end-user plugins are a hard requirement, commander/citty/yargs are disqualified today; you'd hand-roll gh-style binary discovery or move to oclif.

### 5.2 Distribution & versioning implications for OpenForge
- If OpenForge ever wants **third-party/community extensions** with supply-chain isolation → gh-extension-style (separate binaries on `PATH`) is the safe model; oclif in-process plugins are the model only if extensions are **first-party/vetted**.
- If "plugins" really mean "our monorepo splits the CLI into internal packages" → cobra-style package composition (TS: one package exports a `Command`/subcommand tree) is simpler than any runtime plugin system and works with commander/citty/oclif alike.

---

## 6. Type Safety (TypeScript)

### 6.1 commander with `@commander-js/extra-typings`

commander ships `typings/index.d.ts`, and the optional `@commander-js/extra-typings` package infers the *shape* of `.opts()` and `.action()` parameters from your option/argument declarations. This is the "commander + TS decorators/types" path (the brief's "commander 12+" TS story).

```ts
import { Command } from '@commander-js/extra-typings';

const program = new Command('openforge');
program
  .option('-p, --port <number>', 'port', '3000')   // inferred: opts().port is string (declared <number>)
  .option('-v, --verbose', 'verbose')              // inferred: opts().verbose is boolean
  .argument('<name>', 'service name')
  .action((name, options) => {
    // name: string ; options: { port: string; verbose: boolean }  — inferred, no casts
    console.log(name, options.port, options.verbose);
  });
```
Caveat: the value *type* follows the declared placeholder/coercion, not your parser return (a custom `argParser` returning a number still types the flag as its declared placeholder type) — so for numeric/semver/dur flags, a thin runtime assertion or `as` cast is still needed. oclif closes this gap better.

### 6.2 oclif — the strongest TS story

oclif is written entirely in TS; `this.parse()` returns `ParserOutput<F, B, A>` with **inferred flag and arg types** from the `Flags.*`/`Args.*` factories. No casting, and the *value type* is correct (integer flags are `number`, url flags are `URL`, `multiple` flags are `string[]`):

```ts
import { Command, Flags, Args } from '@oclif/core'

export default class Deploy extends Command {
  static args = { name: Args.string({ required: true }) }
  static flags = {
    retries: Flags.integer({ default: 3, min: 0, max: 10 }), // flags.retries: number
    from:    Flags.url({ default: new URL('https://oclif.io') }), // flags.from: URL
    tags:    Flags.string({ multiple: true, delimiter: ',' }),     // flags.tags: string[]
  }
  async run() {
    const { flags, args } = await this.parse(Deploy)
    //    ^ fully typed; passing a string where a number belongs is a compile error
    const n: number = flags.retries
  }
}
```

### 6.3 citty — native inference via the `const` generic (not Zod)

**Correction to the brief:** citty does **not** use Zod. Type safety comes from `defineCommand` being an identity function with a `const` type parameter, so the literal `args` shape drives the `ParsedArgs<T>` type of `run({ args })`. Literal option names and enum `options` arrays are preserved:

```ts
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  args: {
    name:   { type: "positional", required: true },        // args.name: string
    loud:   { type: "boolean", alias: "L" },               // args.loud: boolean | undefined
    level:  { type: "enum", options: ["debug","info"] as const, default: "info" },
    // args.level: "debug" | "info" | "warn" | "error"  (literal union, default narrows it)
  },
  run({ args }) {
    // args is ParsedArgs<T>: case-agnostic proxy; required/ defaulted args are non-optional
    console.log(args.name, args.loud, args.level);
  },
});
runMain(main);
```
`ParsedArgs<T>` maps each named arg to `boolean` | `string` | enum-union and marks it optional *unless* a non-nullable `default` or `required: true` is declared. If you want schema-level validation (custom cross-field rules, semver/path/dur), you layer your own (e.g. a `zod` parse inside `run`) — citty's built-in validation is `required` + `enum options` only.

### 6.4 yargs — `@types/yargs`, weaker inference

yargs has DefinitelyTyped `@types/yargs`. You can type the `argv` you return from handlers, but inference from the option schema into `argv` is less precise than oclif's; complex configs usually need a hand-written `Argv<MyShape>` generic or a cast. Functional, but the weakest TS story of the three first-party options.

### 6.5 cobra (the bar)
Go gives compile-time typed flags for free. The TS equivalent you're trying to approximate is: **declared flag schema ⇒ strongly typed parsed value, no runtime cast.** oclif is the only JS framework that fully achieves this; commander-with-extra-typings and citty are close; yargs trails.

---

## 7. Test Patterns

### 7.1 Unit-test the command in-process (the fast path)

**cobra** — `RunE` + `SetArgs` + `SetOut`/`SetErr` + `bytes.Buffer`. The spf13-recommended pattern (fresh command factory per test; execute through the root with the subcommand in args; write via `cmd.OutOrStdout()`):
```go
func TestDeployDryRun(t *testing.T) {
    var out bytes.Buffer
    cmd := newDeployCmd()
    cmd.SetOut(&out)
    cmd.SetErr(&out)
    cmd.SetArgs([]string{"api", "--dry-run"})   // real code path incl. flag parsing
    if err := cmd.Execute(); err != nil {
        t.Fatalf("execute: %v", err)
    }
    if !strings.Contains(out.String(), "would deploy api") {
        t.Errorf("unexpected output: %q", out.String())
    }
}
```

**commander** — build a fresh `Command`, `.parse([...], { from: 'node' })`, and override exit/output to keep it in-process:
```js
import { Command } from 'commander';
import assert from 'node:assert';
import { it } from 'node:test';

it('split prints substrings', () => {
  const program = new Command().exitOverride();            // throw instead of process.exit
  program.option('-s, --separator <c>', 'sep', ',')
        .argument('<string>')
        .action((s, o) => { /* capture */ });
  let help = '';
  program.outputHelp = () => { help = 'HELP'; };          // no stdout
  program.parse(['node', 'cli', 'a,b,c'], { from: 'node' });
  assert.equal(program.args[0], 'a,b,c');
});
```
Key APIs: `.exitOverride()` (turns `process.exit` into a thrown `CommanderError` you can `assert.throws`), `.overrideOutput(stream)` / `.overrideLogger()`, and `.parse(argv, { from: 'node'|'user' })`. `.helpInformation()` returns the help string for snapshotting.

**citty** — call `runCommand(cmd, { env: process.env, args: ['...'] })` directly and assert on `{ result }` or thrown `CLIError`:
```js
import { defineCommand, runCommand, CLIError } from "citty";
import { it } from 'node:test';
import assert from 'node:assert';

const cmd = defineCommand({
  args: { name: { type: "positional", required: true } },
  run({ args }) { return `hi ${args.name}`; },
});
it('greet', async () => {
  const { result } = await runCommand(cmd, { args: ['ada'] });
  assert.equal(result, 'hi ada');
});
it('missing required throws EARG', async () => {
  await assert.rejects(() => runCommand(cmd, { args: [] }), (e) => e.code === 'EARG');
});
```

**yargs** — pass an argv array straight to `.parse()` and assert on the returned object; snapshot the help via `.getUsageInstance()` or by running with `['--help']`:
```js
const argv = yargs(['serve', '--port', '8080'])
  .command('serve [port]', 'start', y => y.positional('port', { default: 5000 }))
  .strict().parse();
assert.equal(argv.command, 'serve');
assert.equal(argv.port, '8080');
```

**oclif** — dedicated harness `@oclif/test` (generator scaffolds `test/commands/*.test.ts` that stub stdout/stderr and call the command class directly):
```ts
import { loadTest } from '@oclif/test'
import { Command } from '@oclif/core'
import { expect } from 'chai'

const run = loadTest()   // provides .stub(Command, 'log', fn), .do(), etc.
it('hello', async () => {
  await run
    .stub(Hello.prototype, 'stdout', () => {})
    .do(Command.run, ['world'])
    .catch(err => expect(err.message).to.equal('hello world'))
})
```

### 7.2 Snapshot testing CLI output

- **jest-snapshot:** snapshot `--help` and command output. With commander: `expect(program.helpInformation()).toMatchSnapshot()`. With ink: `renderToString(<App/>)` → snapshot the string (ink's `renderToString` exists *for* testing).
- **`snap-shot-it` / node:test `assert.snapshot` (Node 20+ has `t.assert`):** same idea. Keep help snapshots in CI to catch accidental help regressions — they're cheap and high-value.

### 7.3 e2e with `execa` (the real binary)

In-process tests miss shebang/bin/PATH/env/exit-code behavior. For e2e, spawn the actual `bin`:
```js
import { $, execa } from 'execa';
import { it } from 'node:test';
import assert from 'node:assert';

it('split a,b,c via the real bin', async () => {
  const r = await execa(process.execPath, [binPath, 'split', 'a,b,c', '-s', ',']);
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes('a'));
});

it('unknown flag exits non-zero with an error', async () => {
  await assert.rejects(
    () => execa(process.execPath, [binPath, '--nope']),
    (e) => e.exitCode !== 0 && /unknown option/.test(e.stderr),
  );
});
```
Fixture-based: drive a table of `[argv, expectedExit, expectedStdoutFragment]` cases through `execa` (the same "black-box CLI contract" approach the community `func`/`zlye` benchmarks use — 17+ acceptance cases comparing exact text or parsed JSON + error fragments + exit status).

### 7.4 Covering the CLI binary itself

- **In-process:** the §7.1 unit tests already give statement coverage of command logic (best for speed + coverage).
- **The actual `bin`:** run under `c8`/`v8` coverage by launching the real entrypoint: `c8 -- src/bin/run.ts <subcommand>` per fixture case, or set `NODE_V8_COVERAGE=/tmp/cov node <bin> ...` then aggregate with `c8 report`. This catches code reachable only through the real bin (shebang, dynamic `import()` lazy subcommands, arg normalization).
- For lazy/`import()` subcommands (citty/oclif `pattern`), make sure your e2e matrix touches *every* command file so tree-shaken/lazy modules are counted.

**Rule of thumb:** in-process unit tests for logic + a modest `execa` fixture matrix for the bin (happy path, error path, `--help`, `--version`, one lazy subcommand) gives you fast coverage *and* real-behavior confidence without the flakiness of full subprocess fuzzing.

---

## 8. Bundle Size / Cold Start (with numbers)

Numbers below are **measured by third parties on specific machines** — treat them as relative, not absolute. Two distinct axes: *bundle/install size* and *cold-start time*. (The brief's ballpark — citty ~1 kB, commander ~30 kB, yargs ~120 kB, oclif ~5 MB with full plugin runtime — is directionally right for oclif-with-plugins but the *single-entry core* figures differ; real data below.)

### 8.1 Bundle / install size (single CLI entry point)

| Framework | min+gzip (bundle) | unpacked install | runtime deps | source |
|---|---|---|---|---|
| citty | ~3.7 kB | ~52 kB | 0 | devpick.co; openapps (README badge) |
| commander | ~10.8 kB gzip / 38.4 kB min | ~202–203 kB | 0 | pkgpulse (v15); burgee (203 kB) |
| yargs | ~34.8 kB | ~515 kB (burgee) / ~236 kB (devpick unpacked) | ~6–14 | devpick; pkgpulse; burgee |
| @oclif/core | ~104 kB gzip (bundle) | ~912 kB | ~18–28 | devpick (104 kB); burgee (912 kB); oclif README (28 deps minimal) |
| cac (ref.) | ~3.9 kB | ~40 kB | 0 | devpick; burgee |

A separate esbuild-targeted snapshot (raw / gzip / adapter lines) for a real CLI:
`commander` 43.9 KiB / 12.4 KiB · `yargs` 215 KiB / 36 KiB · `@oclif/core` 341 KiB / 104 KiB · `cac` 27 KiB / 6.3 KiB (source: the `func` comparison repo).

**Reconciling the brief's "oclif ~5 MB":** `@oclif/core` alone is ~100 kB gz / ~0.9 MB unpacked. **5 MB+ is real but only when you count a full oclif *project*** — generator output, `ts-node`, and Heroku/Salesforce-style plugin dependencies. One 2026 guide reports a full oclif project "can exceed 50 MB unpacked when counting transitive deps"; a separate table lists oclif v4 at "~8 MB" unpacked install. So: *core framework ≈ 100 kB gz; a shipped multi-plugin oclif product ≈ several MB to 50 MB.*

### 8.2 Cold start (ms to first render / simple command)

Two independent measurement sets (different hardware — use ratios):

| Framework | "no framework" | citty | commander | yargs | oclif | source |
|---|---|---|---|---|---|---|
| Full run over bare node | 0 | **+6 ms** | **+17 ms** | **+79 ms** | **+131 ms** | burgee (Node 24, GitHub runner) |
| `--version` | 12 ms | — | 18 ms | 35 ms | 85 ms | grizzlypeak (Node 20, 2023 MBP) |
| `--help` | 12 ms | — | 22 ms | 42 ms | 120 ms | grizzlypeak |
| command | 15 ms | — | 25 ms | 48 ms | 135 ms | grizzlypeak / nazarboyko |
| cold / warm start | — | — | 12 / 2 ms | 28 / 5 ms | 45 / 12 ms | johal.in (Node 20.11, Ubuntu) |

Interpretation: **citty and commander are both effectively invisible** (single-digit-to-low-teens ms). **yargs adds ~20–60 ms.** **oclif adds ~70–130 ms** (plugin discovery + config + help + TS tooling) — negligible for a one-off command, noticeable in tight shell loops / CI that invoke your tool repeatedly. For a tool you call in a build loop, commander/citty's near-zero overhead is a genuine, measurable win.

### 8.3 What drives oclif's cost
Plugin discovery (glob/explicit load), `Config.load()` (loads root plugin, derives metadata, loads plugins + commands), auto help, and optional `ts-node` for TS plugins. oclif mitigates this with **lazy command loading** (only the invoked command is required at runtime — "large CLIs with many commands load equally as fast as a small one"), but the *framework* init still pays the fixed cost.

---

## 9. Real Production Usage (per-library)

> **Honesty note (surfacing a conflict, per project rules):** the brief attributes *commander* to "npm, Yarn, eslint, TypeScript compiler." **That is not supported by the evidence and is almost certainly wrong** — those tools do not use commander (npm/yarn have their own argument handling; the TypeScript compiler CLI has its own parser; ESLint has used `optionator`/its own). Repeating that as fact would mislead the decision. Below are the usages I could actually corroborate; commander's real strength is its *sheer adoption breadth* rather than a few marquee names.

### citty
- **nuxi / Nuxt 3.7+** — "We've refactored `nuxi` using unjs/citty"; nuxi is zero-dependency and designed to be globally usable. (nuxt.com blog v3.7; nuxt/cli discussion #3.)
- **Nitro CLI** — the `nitro` command (dev/build/preview/deploy) is "built with citty" (`src/cli/commands/*.ts`). (nitro docs/CLI; DeepWiki nitro.)
- **unbuild** — its `cli.ts` uses citty (documented in a 2023 review; citty was "discovered in `cli.ts` of unbuild"). (thinkthroo citty review.)
- Ecosystem: unjs packages (nypm, paneer, scaffolding) — citty is the UnJS CLI substrate.

### commander
- **Largest CLI library on npm** by a wide margin — ~212M–508M weekly downloads depending on tracker/version window (mostly as a *transitive* dependency across hundreds of thousands of packages). 28.4k GitHub stars; stable API since v8. (devpick, pkgpulse, multiple 2026 comparisons.)
- Widely embedded in dev tooling across the ecosystem; it is the *default* choice in most "which CLI framework" 2026 comparisons for "3–15 subcommand" tools. Because its adoption is so broad and transitive-heavy, no single marquee product is the clean citable user — that breadth *is* the evidence of production trust. (If you need a specific named user for a slide, verify per-repo before citing; the brief's npm/yarn/eslint/tsc claims do not hold up.)

### yargs
- **Mocha** — the yargs README's own help-menu example *is* Mocha's (`mocha [spec..]`, `mocha inspect`, `mocha init <path>`). Direct, in-repo evidence. (yargs README.)
- **Jest CLI** and **react-native CLI** use yargs for their command/option parsing (long-standing, well-known; the brief's attributions hold for these two). Broad use across test/build tooling. ~107M–305M weekly downloads (transitive-heavy).

### oclif
- **Salesforce CLI (`sf`)** — built on oclif (oclif "was built out of the Salesforce CLI"); plugin-per-feature-area architecture with bundled + **JIT** plugins; `preparse`/`prerun`/`command_incomplete` hooks drive UX. (salesforcecli/cli ARCHITECTURE.md; oclif README; Salesforce plugin dev guide.)
- **Heroku CLI** — the canonical oclif product; oclif's autocomplete doc explicitly uses `heroku info --app=<tab>` (completing to the user's real app names). (oclif README + autocomplete docs.)
- **Adobe I/O CLI** and other enterprise CLIs in the oclif ecosystem (the brief's attribution is consistent with oclif's enterprise positioning; verify per-repo for a hard citation). oclif's own docs name Heroku/Salesforce as the reference products.

### cobra (Go reference)
- **GitHub CLI (`gh`)** — named explicitly in the cobra README ("used in … GitHub CLI"). (spf13/cobra README.)
- **Kubernetes / kubectl** — named in the cobra README ("such as Kubernetes"). (spf13/cobra README.)
- **Hugo** — named in the cobra README; uses the modular one-command-per-package layout. (spf13/cobra README; cobra working-with-commands guide.)
- **Docker CLI** — built on cobra (well-established; the spf13 "projects using cobra" list). 
- The cobra README links a "projects using cobra" page with an extensive list — the Go de-facto standard for subcommand CLIs.

**Inference for OpenForge:** if you want the *cobra ergonomics* (flags, subcommands, help, completion, hook cascade) in TypeScript, **commander** reproduces the day-to-day feel most closely. If you want the *oclif architecture* (plugins, JIT, auto-updating installers, file-based command scale), **oclif** is the only match. `citty` matches the *minimalism* but not cobra's rich help/completion. There is no TS framework that matches cobra's completion + groups + man-pages *and* its plugin-free single-binary model simultaneously — you take the closest axis to your real requirement.

---

## 10. Recommendation for OpenForge

### 10.1 The pick: **`commander`** (v12+, use `@commander-js/extra-typings`)

**Justification, tied to OpenForge's stated constraints (TS monorepo, Node 20+, real multi-command tool, cobra-parity ergonomics):**

1. **Zero dependencies + small, fast.** 0 runtime deps, ~11 kB gz, ~17 ms overhead. In a monorepo CLI you may invoke from scripts/CI, near-zero cold start and a tiny supply-chain surface (a real security argument per the 2026 guides) matter. citty is even lighter but gives up custom parsing + completion ergonomics.
2. **Strongest "cobra-feel" in TS.** Strict parsing with did-you-mean, `.option()`/`.argument()` with `...` variadics, custom `argParser` coercion (the `pflag.Value` equivalent), `preAction`/`postAction`/`preSubcommand` hooks (≈ `PreRun`/`PostRun`), Help Groups (≈ cobra command groups), and a clean way to add a `completion` subcommand. This is the closest 1:1 mental mapping to a Go cobra CLI the team will maintain.
3. **Best production trust + ecosystem answers.** 28.4k stars, hundreds of millions of weekly downloads, stable API since v8 — "StackOverflow has an answer for every edge case" is the recurring 2026 characterization. For a greenfield tool that *will* be touched by a second engineer, breadth of prior art reduces risk.
4. **Scales to the expected size.** Comfortable to ~30–100 subcommands via `.command()` / `.addCommand()` / composed command modules. File-based lazy loading is achievable with dynamic `import()` per subcommand (same idea as citty/oclif) if you outgrow in-process registration.
5. **Honest gaps it has — and their cost:** no built-in plugin system (RFC unlanded), no built-in `--json`/data-table (you add ~10 lines + a lib), no built-in completion (you add a `completion` command). For a first-party tool these are small, well-understood gaps — not architectural blockers.

**When to deviate (explicit trigger conditions):**
- → **`citty`** if the CLI is small (≤ ~10 commands), you want the absolute lightest zero-dep footprint, and you're comfortable hand-rolling completion + your own output layer. This is the Nuxt/Nitro choice and the right one for a lean monorepo dev tool.
- → **`oclif`** *only* if you need **end-user/vetted third-party plugins** (npm-installable), **auto-updating standalone installers** (no Node required), **50+ commands maintained by a team over years**, or **full-flag TS inference with zero casts**. Accept the ~130 ms init and multi-MB install. This is the Heroku/Salesforce path — overkill for a typical v1.
- → **`yargs`** only if declarative validation (`choices`/`check`/`coerce`/`implies`/`conflicts` as data) is the dominant need and you accept the highest cold start + stale-release risk.
- → **roll-your-own** only for a single-purpose one-shot script; not for a growing monorepo CLI.
- → **`ink`** is *additive*, not a replacement: pair it with commander for any interactive/TUI subcommand (live dashboards, prompts). Don't reach for ink for one-shot table-and-exit commands.

### 10.2 How the choice shapes v1 architecture

Assuming commander, the OpenForge CLI v1 takes this shape:

```
apps/openforge-cli/
  bin/openforge              # shebang entry: #!/usr/bin/env node
  src/
    cli.ts                   # build the Command tree (factories, no globals) -> export run(argv)
    commands/
      build.ts               # export function buildCommand(): Command
      deploy.ts
      logs.ts
      ...
    lib/
      output.ts              # shared --output table|json|csv + cli-table3/chalk/ora
      json.ts                # stable-key JSON + JSON-Lines helper
      completion.ts          # `completion <shell>` + hidden `__complete` (cobra contract)
    __tests__/
      commands.*.test.ts     # in-process (exitOverride + helpInformation)
      e2e.fixtures.test.ts   # execa matrix over the real bin
```
Design rules that fall out of the commander pick:
- **Factory-per-command** (`buildCommand(): Command`), composed in `cli.ts` — mirrors cobra's `newXxxCmd()` and keeps commands testable (no package-level mutable `Command` globals; the spf13 skill calls out globals as the #1 testability trap).
- **Root-level `preAction`** for cross-cutting auth/config/telemetry (≈ cobra `PersistentPreRunE`).
- **`--output` + `--json` handled in `lib/output.ts`** once, so every list command gets stable machine-readable output for free (the thing oclif gives you built-in, done by hand in ~30 lines for commander).
- **`completion` subcommand + hidden `__complete`** to match the cobra completion contract users expect.
- **In-process unit tests via `.exitOverride()`**, plus a small **execa fixture matrix** (happy/error/help/version/one lazy subcommand) and `c8` coverage over the bin.
- **Lazy subcommands** via `import()` only if the command count grows; not needed at v1 scale.

### 10.3 Migration path if we need to switch later

The command *definitions* (names, flags, args, defaults) are portable across all three — the brief's "converting is straightforward, command definitions are similar" is correct. What does *not* port is the surrounding glue. Concretely:

- **commander → citty** (going lighter): keep `lib/output.ts` and the command *logic* as-is; rewrite each command's registration from chained `.option()/.argument()/.action()` to a `defineCommand({ args, run })` object; move root `preAction` → a `defineCittyPlugin`. Cost: low–medium (mechanical per command); you lose `argParser` coercion (re-add small parsers in `run`) and the built-in help polish.
- **commander → oclif** (going heavier, e.g. plugins needed): largest jump. Each command becomes a `class extends Command` with `static flags/args` + `this.parse()`; root hooks move to `init`/`prerun` hook files; you adopt the `oclif` generator layout (one file per command) and `@oclif/test`. You *gain* TS flag inference, `--json`, `this.table`, autocomplete, plugins, autoupdate. Cost: high (structural + dependency weight + ~130 ms init). Best done when the plugin/enterprise requirement is real, not speculative.
- **What stays stable across all migrations:** (a) the argv contract (flag names, subcommand tree, exit codes) — protect it with the execa fixture matrix from day one and the migration stays behavior-compatible; (b) `lib/output.ts` (keep it framework-agnostic — pure functions + a stream, no framework imports) so it survives any switch; (c) the test fixtures (they test the *contract*, not the framework).

**The de-risking move for a greenfield:** keep the CLI's *entrypoint* and *output layer* framework-agnostic, and isolate every framework call behind the command factories. Then "switch frameworks" is a rewrite of registration glue, not a rewrite of behavior — and your execa contract tests guarantee you didn't change what the user sees.

---

## 11. References

**Primary docs / source (fetched):**
- commander README — https://raw.githubusercontent.com/tj/commander.js/master/Readme.md (Context7: `/tj/commander.js`)
- yargs README — https://raw.githubusercontent.com/yargs/yargs/main/README.md (Context7: `/yargs/yargs`)
- oclif/core README — https://raw.githubusercontent.com/oclif/core/main/README.md (Context7: `/oclif/core`)
- citty README — https://raw.githubusercontent.com/unjs/citty/main/README.md (Context7: `/unjs/citty`)
- cobra README — https://raw.githubusercontent.com/spf13/cobra/main/README.md (Context7: `/spf13/cobra`)
- cobra user guide (args validators, hooks) — https://github.com/spf13/cobra/blob/main/site/content/user_guide.md
- cobra completions (ValidArgs, Gen*Completion) — https://github.com/spf13/cobra/blob/main/site/content/completions/_index.md
- cobra.dev docs — https://cobra.dev/docs/how-to-guides/working-with-flags/ · https://cobra.dev/docs/how-to-guides/working-with-commands/ · https://cobra.dev/docs/explanations/philosophy/ · https://cobra.dev/docs/explanations/enterprise-guide/ · https://cobra.dev/docs/tutorials/customizing-cli/
- oclif plugins — https://oclif.github.io/docs/plugins/ · oclif hooks — https://oclif.github.io/docs/hooks · oclif command discovery — https://github.com/oclif/oclif.github.io/tree/docs/docs/command_discovery_strategies.md
- Salesforce CLI plugin hooks — https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/hooks.html · sfdx plugins — https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-plugins-overview.html
- Salesforce CLI architecture — https://github.com/salesforcecli/cli/blob/main/ARCHITECTURE.md
- citty/Nuxt/Nitro — https://nuxt.com/blog/v3-7 · https://nitro.build/docs/cli · https://github.com/nuxt/cli/discussions/3 · https://thinkthroo.com/blog/citty-cli-builder · https://openapps.pro/packages/citty
- spf13 cobra-viper skill (factory/RunE/test patterns) — https://github.com/spf13/go-skills/blob/main/cobra-viper/SKILL.md
- Go cobra production patterns — https://ferztyle.me/building-go-clis-with-cobra-a-practical-guide · https://www.runxbuild.com/blog/golang-cobra/ · https://www.nazarboyko.com/articles/building-production-cli-tools-in-go

**Benchmarks / adoption / bundle-size:**
- grizzlypeak (feature matrix, startup ms) — https://www.grizzlypeaksoftware.com/library/cli-framework-comparison-commander-vs-yargs-vs-oclif-utxlf9v9
- nazarboyko (Node.js CLI framework choice, oclif 135 ms vs commander 25 ms) — https://www.nazarboyko.com/articles/building-cli-tools-with-nodejs
- zlye (ops/sec parse benchmark: commander vs yargs vs cac) — https://github.com/arshad-yaseen/zlye
- faun.dev (ranked comparison, scores) — https://faun.dev/toolbox/compare-nodejs-cli-frameworks/
- agentic developer cookbook (download/startup table) — https://agenticdevelopercookbook.com/appendix/research/developer-tools/cli/cli-development-tools
- dev.to thegdsks (oclif vs commander vs custom, 8 MB vs 220 kB install) — https://dev.to/thegdsks/building-a-production-typescript-cli-in-2026-oclif-vs-commander-vs-custom-9ah
- johal.in (cold/warm start, memory, throughput, parse speed) — https://johal.in/comparison-commander-12-vs-yargs-18-vs-oclif
- `func` comparison repo (raw/gzip bundle + fresh-process wall time) — https://cephalochromoscope.net/a40faa32-83de-42ae-8cf9-c6b4ad6bf445
- burgee (installed size + full-run-over-bare-node, 6-framework table) — https://burgee.interlace.tools/docs/comparison
- pkgpulse commander health (10.8 kB gz / 202.5 kB unpacked / 726M weekly) — https://www.pkgpulse.com/packages/commander
- pkgpulse guide (package health, pkg binary ~80 MB) — https://www.pkgpulse.com/guides/how-to-build-cli-nodejs-commander-yargs-oclif
- packagephobia (publish vs install size) — https://packagephobia.com/result?p=commander · https://packagephobia.com/result?p=yargs
- devpick (bundle + download metrics per package) — https://devpick.co/best/cli · https://devpick.co/commander-vs-yargs · https://devpick.co/citty-vs-yargs · https://devpick.co/pkg/yargs
- teachmeidea (commander vs yargs vs oclif fit) — https://teachmeidea.com/nodejs-cli-with-commander/

**Context7 library IDs resolved:**
- citty → `/unjs/citty` · commander → `/tj/commander.js` · yargs → `/yargs/yargs` · oclif → `/oclif/core` · cobra → `/spf13/cobra` · ink → `/vadimdemedes/ink`

*Note: the `ink` README direct fetch returned 404 on the default branch and the single ink-production web search hit a rate limit; ink content in §3 is sourced from the Context7 `/vadimdemedes/ink` API reference (useInput, render, renderToString, Box/Text). Ink is a terminal React renderer, not an argument parser, and does not change the citty/commander/yargs/oclif decision.*
