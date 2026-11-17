# ODDITY

Name the answer nobody else would. Every prompt has hundreds of right answers; the rarer yours is, the farther your pixel rocket flies: past the clouds, the Space Station, the Moon, Mars, Saturn, out to Voyager and beyond.

- **Daily mission**: 7 prompts, 25 seconds each, the same for everyone on Earth that UTC day. Global board and "what everyone said" stats.
- **Archive**: fly any past mission (not on the board).
- **Unlimited**: Classic (7 prompts) or Endless (3 fuel cells; a miss or skip costs one, a True Oddity refills one), in 12 packs or everything mixed.
- **Friends**: rooms of up to 40 (6-digit code or invite link), 5 to 50 prompts, 5 to 60 seconds; quick match with strangers. Same answer as another player = both get half (Copycat rule).

Tiers: Ground Control 10 · Copycat 15 · Low Orbit 30 · Deep Space 60 · Far Out 85 · True Oddity 100.

Spelling slips get "Did you mean …?" (Enter or Yes takes it). Anything still in the box when time runs out is submitted, and a close spelling counts as meant.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## Deploy

Render (free) via `render.yaml`. Every push to `main` redeploys. The free server sleeps after ~15 min idle (~40 s to wake), and its disk is wiped on restart, so the daily board resets then.

## Optional AI judge

Answers are judged against hand-written banks (`public/banks.js`, `public/banks-more.js`, ~14,000 answers). To also let an AI rule on answers that are not in the banks, add a free Google AI Studio key as the `GEMINI_API_KEY` environment variable on Render. Rulings are cached so the same answer always scores the same.

## Adding prompts

Each prompt is two lines: the prompt, then answers from most common to rarest, groups split by `|`, aliases joined with `/`. Start the prompt with `~` when answers are people (a surname alone then counts). Run `npm test` after.
