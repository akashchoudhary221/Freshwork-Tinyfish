const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const key = process.env.TINYFISH_API_KEY;
const SOURCES = {
  greenhouse: { label: 'Greenhouse', domains: 'boards.greenhouse.io,job-boards.greenhouse.io' },
  lever: { label: 'Lever', domains: 'jobs.lever.co' },
  ashby: { label: 'Ashby', domains: 'jobs.ashbyhq.com' },
  linkedin: { label: 'LinkedIn', domains: 'linkedin.com/jobs' },
  indeed: { label: 'Indeed', domains: 'indeed.com' },
};
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 50_000) reject(new Error('Request too large')); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
async function tfFetch(host, endpoint, options = {}) {
  // TinyFish Search and Fetch are served from the root of their product hosts;
  // the Agent API lives under /v1 on agent.tinyfish.ai.
  const prefix = host === 'agent.tinyfish.ai' ? '/v1/' : '/';
  const response = await fetch(`https://${host}${prefix}${endpoint}`, {
    ...options,
    headers: { 'X-API-Key': key, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  if (!response.ok) {
    const message = data?.error?.message || data?.message || raw.slice(0, 220).replace(/\s+/g, ' ');
    throw new Error(message || `TinyFish returned ${response.status}`);
  }
  if (!raw) throw new Error('TinyFish returned an empty response.');
  try { return JSON.parse(raw); } catch { throw new Error('TinyFish returned an unexpected response format.'); }
}
function safeHttpUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; }
  catch { return null; }
}
function scoreJob(job, prefs) {
  const text = `${job.title} ${job.snippet} ${job.company} ${job.site_name}`.toLowerCase();
  const terms = [prefs.role, prefs.seniority, ...(prefs.keywords || []).filter(Boolean)].map(s => String(s).toLowerCase().trim()).filter(s => s.length > 1);
  const hits = terms.filter(term => text.includes(term));
  let score = terms.length ? Math.round(hits.length / terms.length * 78) : 45;
  if (prefs.location && text.includes(prefs.location.toLowerCase())) score += 15;
  if (/careers|jobs|job|greenhouse|lever|ashby/i.test(`${job.site_name} ${job.url}`)) score += 7;
  return { ...job, matchScore: Math.min(99, score), matchedTerms: hits };
}
async function searchJobsLive(prefs) {
  if (!key) throw new Error('Add your TinyFish key to TINYFISH_API_KEY, then restart the app.');
  const activeSources = (prefs.sources || Object.keys(SOURCES)).filter(id => SOURCES[id]);
  const role = String(prefs.role || '').trim();
  if (!role) throw new Error('Add a role to search for.');
  if (!activeSources.length) throw new Error('Choose at least one job source.');
  const keywords = (prefs.keywords || []).filter(Boolean).join(' ');
  const query = [role, keywords, prefs.seniority].filter(Boolean).join(' ');
  const results = await Promise.all(activeSources.map(async id => {
    const source = SOURCES[id];
    const params = new URLSearchParams({ query: `${query} ${prefs.location || ''} jobs careers`, purpose: `Find current ${role} job openings for a candidate looking in ${prefs.location || 'any location'}. Return individual open roles with application links.`, include_domains: source.domains, language: 'en' });
    const data = await tfFetch('api.search.tinyfish.ai', `?${params}`);
    return (data.results || []).map(item => ({ ...item, sourceId: id, sourceLabel: source.label, url: safeHttpUrl(item.url) })).filter(x => x.url);
  }));

  const all = results.flat();
  // Merge duplicate URLs and near-identical role titles across portals.
  const unique = new Map();
  for (const item of all) {
    const normalized = item.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    const titleKey = `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(item.site_name || '').toLowerCase()}`;
    const key = normalized || titleKey;
    const previous = unique.get(key);
    if (!previous || (item.snippet || '').length > (previous.snippet || '').length) unique.set(key, item);
  }
  const jobs = [...unique.values()]
    .map(job => scoreJob(job, { ...prefs, keywords: (prefs.keywords || []).concat(keywords.split(/\s+/)) }))
    .sort((a, b) => b.matchScore - a.matchScore).slice(0, 30);

  // Fetch a small batch of live listing pages for cleaner descriptions and fresh metadata.
  const toFetch = jobs.slice(0, 8);
  if (toFetch.length) {
    try {
      const details = await tfFetch('api.fetch.tinyfish.ai', '', { method: 'POST', body: JSON.stringify({ urls: toFetch.map(j => j.url), format: 'markdown', purpose: 'Extract job title, employer, location, seniority and a concise listing summary. Preserve application links.' }) });
      const byUrl = new Map((details.results || []).map(d => [d.url, d]));
      for (const job of jobs) {
        const detail = byUrl.get(job.url);
        if (!detail) continue;
        if (detail.title && detail.title.length > 3) job.pageTitle = detail.title;
        const excerpt = typeof detail.text === 'string' ? detail.text.replace(/\s+/g, ' ').trim().slice(0, 460) : '';
        if (excerpt.length > 80) job.details = excerpt;
      }
    } catch (err) {
      // Search results remain useful even when a career page blocks extraction.
      console.warn('TinyFish Fetch enrichment skipped:', err.message);
    }
  }
  // Search and Fetch are free products. Run one bounded Agent pass on the best
  // match so every search also uses the wallet-metered TinyFish Agent meaningfully.
  let agentStatus = 'not-run';
  let agentMessage = '';
  if (jobs.length) {
    try {
      const best = jobs[0];
      best.agentAnalysis = await runAgentOnListing(best.url, prefs);
      const summary = best.agentAnalysis?.summary;
      if (summary && summary.length > 50) best.details = summary;
      best.agentSkills = best.agentAnalysis?.skills || [];
      agentStatus = 'completed';
    } catch (error) {
      agentStatus = 'unavailable';
      agentMessage = error.message;
      console.warn('TinyFish Agent enrichment skipped:', error.message);
    }
  }
  return { jobs, searchedSources: activeSources.map(id => SOURCES[id].label), query, refreshedAt: new Date().toISOString(), agentStatus, agentMessage };
}

async function runAgentOnListing(url, preferences = {}) {
  if (!key) throw new Error('Add your TinyFish key to TINYFISH_API_KEY, then restart the app.');
  if (!safeHttpUrl(url)) throw new Error('This listing does not have a valid application page.');
  const schema = { type: 'object', properties: { title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, seniority: { type: 'string' }, summary: { type: 'string' }, skills: { type: 'array', items: { type: 'string' } }, apply_url: { type: 'string' } }, required: ['title', 'company', 'summary', 'skills'] };
  const data = await tfFetch('agent.tinyfish.ai', 'automation/run', { method: 'POST', body: JSON.stringify({ url, goal: `Read this live job posting and return the role details as structured JSON. Candidate preferences: ${JSON.stringify(preferences)}. Summarize the work, note the most relevant skills, and preserve the genuine application URL.`, output_schema: schema, agent_config: { max_duration_seconds: 30 } }) });
  if (data.status && data.status !== 'COMPLETED') throw new Error(data.error?.message || 'Agent could not analyze this listing.');
  let result = data.result;
  if (typeof result === 'string') { try { result = JSON.parse(result); } catch {} }
  return result || {};
}

async function analyzeJob(body) {
  const url = safeHttpUrl(body.url);
  if (!url) throw new Error('This listing does not have a valid application page.');
  const analysis = await runAgentOnListing(url, body.preferences || {});
  return { analysis };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, { configured: Boolean(key), sources: Object.keys(SOURCES).length });
  if (req.method === 'POST' && url.pathname === '/api/search') {
    try { return send(res, 200, await searchJobsLive(await readBody(req))); }
    catch (e) { return send(res, 400, { error: e.message || 'Search failed. Check the API key and try again.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    try { return send(res, 200, await analyzeJob(await readBody(req))); }
    catch (e) { return send(res, 400, { error: e.message || 'Analysis failed.' }); }
  }
  let file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  file = path.resolve(root, file);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (error, bytes) => {
    if (error) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  });
});

server.listen(port, () => console.log(`Freshwork is running at http://localhost:${port}`));
