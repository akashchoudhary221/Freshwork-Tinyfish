# Freshwork

A small live job search app built for the TinyFish × TechnoJam brief. It searches Greenhouse, Lever, Ashby, LinkedIn, and Indeed; reads promising pages; scores and deduplicates results; and links straight to the original listing. Users can set their role, location, level, keywords, and sources. Preferences are saved in their browser.

## Start in a few minutes

1. Install Node.js 18 or newer if it is not already installed.
2. Create a TinyFish API key at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).
3. In PowerShell, from this project folder, run:

   ```powershell
   $env:TINYFISH_API_KEY = "your-key-here"
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000).

The key stays on the server and is never sent to the browser. Search uses TinyFish Search once per selected source, then TinyFish Fetch reads up to eight listing pages for cleaner details. “Ask Agent” runs TinyFish Agent on an individual listing to extract a structured role summary and skills. Search and Fetch need an active TinyFish key and network access.

## Configuration

- `TINYFISH_API_KEY` — required TinyFish key.
- `PORT` — optional port (defaults to `3000`).

## Project files

- `server.js` — static server and protected TinyFish API routes.
- `index.html`, `styles.css`, `app.js` — responsive website and interactions.

