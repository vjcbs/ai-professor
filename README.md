# Case Partner — Recap Feed

A minimal live-updating page that displays the recap sent by your ElevenLabs
`send_case_recap` tool. Two files, no dependencies, no build step.

## Deploy

1. Create a new GitHub repo (public or private, doesn't matter) and push
   these two files (`index.html`, `api/recap.js`) to it.
2. Go to vercel.com, sign in with "Continue with GitHub".
3. Click "Add New" -> "Project", select this repo, click "Deploy".
   No configuration needed -- Vercel auto-detects the `api/` folder as
   serverless functions and serves `index.html` as the root page.
4. Once deployed, you'll get a URL like `https://your-project.vercel.app`.

## Wire it into ElevenLabs

In your `send_case_recap` webhook tool:
- Change the URL from `https://httpbin.org/post` to
  `https://your-project.vercel.app/api/recap`
- Keep everything else the same (POST method, JSON body, `summary` field).

## Test it

1. Open `https://your-project.vercel.app` in a browser tab -- keep it open
   during your recording.
2. Run your demo conversation in ElevenLabs Preview.
3. When the agent calls `send_case_recap`, the page should update within
   ~2 seconds showing the recap text and a timestamp.

## Note on persistence

The recap is stored in memory on the server, which resets on a cold start.
This is fine for a live demo (the POST and the page load happen seconds
apart, on the same warm instance) but isn't meant to persist data long-term.
If you needed real persistence, you'd add a small database (e.g. Vercel KV) --
not necessary for this demo.
