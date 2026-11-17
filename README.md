# Outlier

Rarest-answer trivia. Every prompt has many right answers; the rarer yours, the farther you drift from the crowd (100 points = 1σ).

- **Daily**: same 7 prompts for the whole world each UTC day, one try, global board and "what everyone said" stats.
- **Unlimited**: 11 genres (General, Minecraft, Music, Gaming, Geography, History, Animals, Food, Sports, Movies & TV, Science) or everything mixed.
- **Multiplayer**: private rooms (6-digit code or invite link, up to 16 players) and quick match with strangers. Same answer as another player = both get half.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # engine + server tests
```

## Deploy (free, Render)

1. Push this folder to a GitHub repo.
2. On render.com: **New → Blueprint**, pick the repo. `render.yaml` sets everything up.
3. Share the `https://outlier-xxxx.onrender.com` URL. Every push to `main` redeploys.

Free tier notes: the server sleeps after ~15 min idle and takes ~40 s to wake (the game shows "Waking the server…"). The daily board is kept on local disk, which Render's free plan wipes on restart or redeploy.

## Adding prompts

Edit `public/banks.js`. Each prompt is two lines: the prompt, then answers grouped from most common to rarest with `|`. Aliases go with `/`. Start the prompt with `~` when answers are people (a surname alone then counts). Run `npm test` after.
