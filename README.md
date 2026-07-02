# Sega.JPEG

Client-side LSB steganography. Hide a text message inside an image's least
significant bits, entirely in the browser — no server, no upload, no build
step.

**Live concept:** upload a cover image, type a message, embed it, download
the resulting PNG. It looks identical to the original but carries your data
in the noise floor of the pixels. Reverse the process to extract it back out.

## How it works

- Each pixel has three color channels (R, G, B). Stega overwrites the
  **least significant bit** of each channel with one bit of your message —
  a change of at most ±1 per channel, invisible to the eye.
- The first 32 bits embedded are a length header, so extraction knows
  exactly how many bytes to read back out.
- An optional passphrase XORs the message bytes against a deterministic
  keystream (seeded from the passphrase) before embedding. This is **light
  obfuscation, not real encryption** — it stops a casual look at the bytes,
  it will not stop someone who wants to break it. Say so out loud in the UI
  on purpose.
- Capacity is `width × height × 3` bits. A 500×500 image holds roughly
  93KB of text.
- Output is always PNG. JPEG re-compression is lossy and will destroy the
  embedded bits — the tool always exports PNG regardless of the input
  format.

## Files

```
index.html   structure
style.css    design system (see tokens at the top of the file)
script.js    all embed/extract/UI logic, no dependencies
.nojekyll    tells GitHub Pages not to run Jekyll over the repo
```

No build tooling, no npm install, no framework. Open `index.html` directly
in a browser and it works.

## Deploy to GitHub Pages

1. Create a new repository and push these files to the `main` branch:
   ```
   git init
   git add .
   git commit -m "Stega: client-side LSB steganography"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source** →
   select **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Your site goes live at `https://<your-username>.github.io/<repo-name>/`.

That's it — no Actions workflow required for a static site like this,
though you're welcome to add one.

## Notes for developers extending this

- All logic lives in `script.js` in a single IIFE — no globals leak except
  what the page needs.
- `embedIntoImageData` / `extractBitsFromImageData` operate directly on
  `ImageData.data` (a flat `Uint8ClampedArray`), skipping the alpha channel
  so transparency is left untouched.
- The "reveal bit-plane" toggle on the embed drop zone renders the actual
  LSB of each channel as black/white noise — useful for demonstrating (or
  debugging) exactly where the payload lives.
- Update the `#gh-link` href in `script.js` to point at your own repo once
  deployed.

## License

MIT — do whatever you want with it.
