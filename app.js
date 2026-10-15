const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const form = $('#searchForm');
const content = $('#resultsContent');
const toast = $('#toast');
let currentJobs = [];
let currentPreferences = {};
let toastTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function preferencesFromForm() {
  const data = new FormData(form);
  return {
    role: String(data.get('role') || '').trim(),
    location: String(data.get('location') || '').trim(),
    seniority: String(data.get('seniority') || '').trim(),
    keywords: String(data.get('keywords') || '').split(',').map(x => x.trim()).filter(Boolean),
    sources: data.getAll('source'),
  };
}
function savePreferences() {
  try { localStorage.setItem('freshwork-preferences', JSON.stringify(preferencesFromForm())); } catch {}
}
function restorePreferences() {
  try {
    const prefs = JSON.parse(localStorage.getItem('freshwork-preferences') || 'null');
    if (!prefs) return;
    $('#role').value = prefs.role || '';
    $('#location').value = prefs.location || '';
    $('#seniority').value = prefs.seniority || '';
    $('#keywords').value = (prefs.keywords || []).join(', ');
    $$('input[name="source"]').forEach(input => { input.checked = (prefs.sources || []).includes(input.value); });
  } catch {}
}
function esc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function companyName(job) {
  const name = (job.site_name || '').replace(/^www\./, '').split('.')[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Company';
}
function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function applyFilters() {
  const sort = $('#sortSelect')?.value || 'match';
  const jobs = [...currentJobs];
  if (sort === 'match') jobs.sort((a, b) => b.matchScore - a.matchScore);
  if (sort === 'newest') jobs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  if (sort === 'company') jobs.sort((a, b) => companyName(a).localeCompare(companyName(b)));
  $('#resultCount').textContent = String(jobs.length);
  content.innerHTML = jobs.map(renderJob).join('');
}
function renderJob(job, index) {
  const company = companyName(job);
  const title = job.pageTitle && job.pageTitle.length < 110 ? job.pageTitle.split(' | ')[0] : job.title;
  const snippet = job.details || job.snippet || 'Open the listing to see the full role details and application instructions.';
  const date = formatDate(job.date);
  const matched = [...(job.matchedTerms || []), ...(job.agentSkills || [])].filter((term, i, all) => term.length > 1 && all.indexOf(term) === i).slice(0, 4);
  const chips = matched.map(word => `<span class="match-chip">${esc(word)}</span>`).join('');
  const agentTag = job.agentAnalysis ? '<span class="source-tag agent-complete">Agent analyzed</span>' : '';
  return `<article class="result-card" data-index="${index}">
    <div class="result-top"><div><div class="company-line"><span class="company-badge">${esc(company.slice(0, 1).toUpperCase())}</span><span class="company-name">${esc(company)}</span><span class="source-tag">${esc(job.sourceLabel || 'Web')}</span>${agentTag}</div><h3 class="job-title">${esc(title)}</h3></div><span class="match-badge">${esc(job.matchScore)}% MATCH</span></div>
    <div class="job-meta"><span>⌖ ${esc(job.location || currentPreferences.location || 'Location on listing')}</span>${date ? `<span>◷ Found ${esc(date)}</span>` : ''}</div>
    <p class="job-snippet">${esc(snippet.slice(0, 460))}${snippet.length > 460 ? '…' : ''}</p>
    <div class="result-bottom"><div class="match-chips">${chips || '<span class="match-chip">Open role</span>'}</div><div class="card-actions"><button class="analyze-button" type="button" data-analyze="${index}">✳ Ask Agent</button><a class="apply-button" href="${esc(job.url)}" target="_blank" rel="noopener noreferrer">View & apply ↗</a></div></div>
    <div class="analysis" hidden></div>
  </article>`;
}
function showLoading() {
  $('#resultsToolbar').hidden = true;
  $('#resultsFooter').hidden = true;
  content.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><strong>Out looking for the good ones…</strong><span>Searching live company pages and job boards.</span></div>';
  $('#connectionLabel').textContent = 'Searching live career pages…';
}
function showError(message) {
  $('#resultsToolbar').hidden = true;
  $('#resultsFooter').hidden = true;
  content.innerHTML = `<div class="error-state"><div class="error-icon">✳</div><h3>We hit a small snag</h3><p>${esc(message)}</p></div>`;
  $('#connectionLabel').textContent = 'Ready when you are';
}
async function search(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const prefs = preferencesFromForm();
  if (!prefs.sources.length) { notify('Choose at least one place to search.'); return; }
  currentPreferences = prefs;
  savePreferences();
  const button = $('.search-button');
  button.disabled = true;
  $('.button-arrow').textContent = '…';
  showLoading();
  try {
    const response = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search failed. Try again.');
    currentJobs = data.jobs || [];
    if (data.agentStatus === 'unavailable') notify(`Free results loaded; TinyFish Agent did not run: ${data.agentMessage || 'check your wallet or API settings'}`);
    if (!currentJobs.length) {
      content.innerHTML = '<div class="empty-state"><div class="empty-illustration"><span>⌕</span><span class="orbit orbit-one"></span><span class="orbit orbit-two"></span><span class="orbit orbit-three"></span></div><h3>No close matches just yet.</h3><p>Try a broader role name, add a nearby city,<br />or search a few more sources.</p></div>';
    } else {
      $('#resultsToolbar').hidden = false;
      $('#resultsFooter').hidden = false;
      $('#sortSelect').value = 'match';
      applyFilters();
    }
    $('#resultsTitle').innerHTML = currentJobs.length ? `Worth a closer<br /><span class="serif-accent">look.</span>` : `A little room<br /><span class="serif-accent">to explore.</span>`;
    $('#refreshTime').textContent = `Updated ${new Date(data.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('#connectionLabel').textContent = `Live across ${(data.searchedSources || []).length} sources`;
    $('#resultsToolbar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    $('.button-arrow').textContent = '↗';
  }
}

async function analyze(button) {
  const index = Number(button.dataset.analyze);
  const job = currentJobs[index];
  const article = button.closest('.result-card');
  const box = $('.analysis', article);
  if (box.dataset.loaded === 'true') { box.hidden = !box.hidden; return; }
  button.disabled = true;
  button.textContent = '✳ Reading…';
  box.hidden = false;
  box.textContent = 'TinyFish Agent is reading the live listing and pulling out the useful bits…';
  try {
    const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, preferences: currentPreferences }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The Agent could not read this listing.');
    const result = data.analysis || {};
    const skills = Array.isArray(result.skills) ? result.skills.join(', ') : '';
    const lines = [result.title && `<strong>${esc(result.title)}</strong>`, result.company && esc(result.company), result.location && `⌖ ${esc(result.location)}`, result.seniority && `Level: ${esc(result.seniority)}`, result.summary && `\n${esc(result.summary)}`, skills && `\nSkills: ${esc(skills)}`].filter(Boolean);
    box.innerHTML = lines.join('<br>') || 'No extra details found. Use the listing link to read more.';
    box.dataset.loaded = 'true';
  } catch (error) {
    box.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = '✳ Ask Agent';
  }
}

form.addEventListener('submit', search);
$('#sortSelect').addEventListener('change', applyFilters);
content.addEventListener('click', event => {
  const button = event.target.closest('[data-analyze]');
  if (button) analyze(button);
});
$('#aboutButton').addEventListener('click', () => $('#howItWorks').scrollIntoView({ behavior: 'smooth' }));
$$('input, select', form).forEach(input => input.addEventListener('change', savePreferences));
restorePreferences();

fetch('/api/status').then(response => response.json()).then(status => {
  if (!status.configured) {
    $('#connectionLabel').textContent = 'Add your TinyFish key to get started';
    return;
  }
  $('#connectionLabel').textContent = 'Live search, ready when you are';
}).catch(() => {});
