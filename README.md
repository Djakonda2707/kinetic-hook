# Kinetic Hook

```bash
git clone https://github.com/Djakonda2707/kinetic-hook.git && cd kinetic-hook
npm install
node scripts/make.mjs "Your AI agent can edit video now." --emphasis "video,now"
```

Your clip is in `out/your-ai-agent-can-edit-video-now.mp4`.

![Demo: "Your AI agent can edit video now." landing word by word](demo.gif)

A free skill for Claude Code and other AI coding agents. One sentence in, a 4–6 second vertical hook clip
out: the words land one by one, the key words hit in a colour block, the line holds, the words leave.
Put it in front of any Reel, TikTok or Short. Everything renders on your machine; no accounts, no keys.

## What it makes

- 1080×1920, 30 fps, H.264 MP4, 4–6 seconds, with a silent AAC track so it joins cleanly with other clips
  (`--sfx` adds a tick per word and a low hit on key words, generated in code)
- up to 12 words, 1–2 of them emphasised; lines sized to fill the frame width
- text kept inside the Reels/TikTok/Shorts safe zones
- a poster `.jpg`, and a looping `.gif` with `--gif`

[demo.mp4](demo.mp4) is the clip above, made with the command above.

## Requirements

- Node.js 22 or newer
- ffmpeg and ffprobe in your PATH
- Chrome: HyperFrames downloads its own copy on the first run

Check everything with `node scripts/doctor.mjs`; it prints the exact fix for your OS.

## Use it from Claude Code

As a plugin:

```
/plugin marketplace add Djakonda2707/kinetic-hook
/plugin install kinetic-hook@cutskills
```

Or as a personal skill:

```bash
git clone https://github.com/Djakonda2707/kinetic-hook.git ~/.claude/skills/kinetic-hook
npm install --prefix ~/.claude/skills/kinetic-hook
```

Then ask: *"Make a kinetic hook: 'Stop scrolling. This takes two minutes.'"* The agent follows
[SKILL.md](SKILL.md): build, check, contact sheet, render, ffprobe. Other agents (Codex, Cursor and so on)
can follow the same file.

## Step by step

```bash
node scripts/build.mjs "Stop scrolling. This takes two minutes." --emphasis "Stop,two"
node scripts/frames.mjs "out/stop-scrolling-this-takes-two-minutes/hook.json"   # look at contact.jpg
node scripts/render.mjs "out/stop-scrolling-this-takes-two-minutes/hook.json" --gif
```

Options: `--lines "Line one|line two"` for your own line breaks, `--label "Tip 3"` for a small top label,
`--sfx` for sound. Colours, sizes and timing live in `template/tokens.json`.

## Troubleshooting

- A render sits at "Rendering project" for minutes: re-run it with `--isolated-cache`.
- Anything else: `node scripts/doctor.mjs`.

## More styles

This one makes the first five seconds. The paid styles at [cutskills.com](https://cutskills.com) make the
whole video:

- **Link to Ad**: give your agent a website URL, get a 20-second vertical ad with a voiceover and real
  screenshots; every line is checked against what the site says.
- **Kinetic Explainer**: a 30–60 second kinetic-typography explainer with a voiceover, three themes and six
  layouts.
- **Talking Head Steps**: your selfie video with word-timed captions, step cards placed around your face and
  punch-in zooms.

## License

MIT. Videos you make with it are yours.
