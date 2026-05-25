const express = require('express');
const https = require('https');
const http = require('http');
const openai = require('../lib/openai');
const supabase = require('../lib/supabase');

// Fetch a URL and return the raw text body
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'MGPBlogs/1.0' } }, (res) => {
      // follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Pull <title> and <description> from RSS items (no XML dependency)
function parseRssItems(xml, limit = 8) {
  const items = [];
  const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
  const titleRe = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i;
  const descRe = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/i;
  const linkRe = /<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>|<link>([\s\S]*?)<\/link>/i;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const titleM = titleRe.exec(block);
    const descM = descRe.exec(block);
    const linkM = linkRe.exec(block);
    const title = (titleM?.[1] || titleM?.[2] || '').trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const desc = (descM?.[1] || descM?.[2] || '').trim().replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 200);
    const link = (linkM?.[1] || linkM?.[2] || '').trim();
    if (title) items.push({ title, desc, link });
  }
  return items;
}

// Fetch news headlines from Australian property RSS feeds
async function fetchPropertyNews() {
  const feeds = [
    { name: 'Domain', url: 'https://www.domain.com.au/news/feed/' },
    { name: 'RealEstate.com.au', url: 'https://www.realestate.com.au/news/feed/' },
    { name: 'ABC News Property', url: 'https://www.abc.net.au/news/feed/51892/rss.xml' },
    { name: 'Perth Now Property', url: 'https://www.perthnow.com.au/real-estate/rss' },
  ];

  const results = await Promise.allSettled(feeds.map(async (feed) => {
    const xml = await fetchUrl(feed.url);
    const items = parseRssItems(xml, 6);
    return { source: feed.name, items };
  }));

  const news = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.items.length > 0) {
      news.push(r.value);
    }
  }
  return news;
}

const router = express.Router();

async function getContext(postsLimit = 3, documentIds = [], specificPostIds = []) {
  const queries = [
    supabase.from('guidelines').select('title, content').order('created_at', { ascending: false }),
    supabase.from('posts').select('title, content').order('created_at', { ascending: false }).limit(postsLimit),
  ];

  if (documentIds.length > 0) {
    queries.push(supabase.from('documents').select('title, content').in('id', documentIds));
  } else {
    queries.push(Promise.resolve({ data: [], error: null }));
  }

  if (specificPostIds.length > 0) {
    queries.push(supabase.from('posts').select('title, content').in('id', specificPostIds));
  } else {
    queries.push(Promise.resolve({ data: [], error: null }));
  }

  const [guidelinesRes, recentPostsRes, documentsRes, specificPostsRes] = await Promise.all(queries);

  if (guidelinesRes.error) console.error('[context] guidelines error:', guidelinesRes.error.message);
  if (recentPostsRes.error) console.error('[context] posts error:', recentPostsRes.error.message);
  if (documentsRes?.error) console.error('[context] documents error:', documentsRes.error.message);
  if (specificPostsRes?.error) console.error('[context] specific posts error:', specificPostsRes.error.message);

  const guidelinesData = guidelinesRes.data || [];
  const postsData = recentPostsRes.data || [];
  const documentsData = documentsRes?.data || [];
  const specificPostsData = specificPostsRes?.data || [];

  console.log(`[context] guidelines fetched: ${guidelinesData.length}`);
  console.log(`[context] recent posts fetched: ${postsData.length} (limit=${postsLimit})`);
  console.log(`[context] documents fetched: ${documentsData.length} (ids=${documentIds.join(', ') || 'none'})`);
  console.log(`[context] specific posts fetched: ${specificPostsData.length} (ids=${specificPostIds.join(', ') || 'none'})`);
  if (guidelinesData.length === 0) console.warn('[context] ⚠️  no guidelines in DB — AI will not get any style rules');
  if (postsData.length === 0) console.warn('[context] ⚠️  no past posts in DB — AI will not get tone reference');

  const guidelines = guidelinesData
    .map((g) => `### ${g.title}\n${g.content}`)
    .join('\n\n');

  const recentPosts = postsData
    .map((p) => `Title: ${p.title}\n\n${p.content}`)
    .join('\n\n---\n\n');

  const documents = documentsData
    .map((d) => `### ${d.title}\n${d.content}`)
    .join('\n\n---\n\n');

  const specificPosts = specificPostsData
    .map((p) => `Title: ${p.title}\n\n${p.content}`)
    .join('\n\n---\n\n');

  return { guidelines, recentPosts, documents, specificPosts };
}

const BASE_PROMPT = `You are writing a real estate blog in the tone and style of MGP Property (Wingman).

## Tone & Style
- Direct, clear, and confident
- No fluff, no generic marketing language
- Avoid "it's not just..." or "we're more than..."
- No emotional storytelling
- No corporate or AI-sounding phrases
- Each sentence must express one clear idea
- Do not list three vague items in one sentence
- Write like you are speaking to a client in a serious conversation
- Use Australian English spelling throughout — e.g. "recognised" not "recognized", "colour" not "color", "organised" not "organized", "behaviour" not "behavior", "licence" not "license", "centre" not "center"
- This blog is written for an Australian audience — use Australian real estate terminology and context
- Use specific examples, real scenarios, and concrete details — not vague generalisations
- Sentences should be short to medium length. Vary rhythm. Avoid long run-on sentences.

## Length & Depth
- The post must be substantial — minimum 600 words, ideally 800–1000 words
- Every section must be fully developed — do not write one or two sentences per section and move on
- Each subheading section should have 2–4 paragraphs of real content
- Go deep on the mechanism and contrast sections — these are the most valuable parts
- Do not pad with filler — add depth through specific detail, not repetition

## Structure (follow in order)
1. **Hook** — Start with a common belief or assumption sellers have. Challenge it directly. 2–3 sentences max.
2. **Problem** — Explain what actually goes wrong in real situations. Focus on where sellers lose control, clarity, or money. Be specific — name the actual mistakes or misconceptions.
3. **Mechanism (How it really works)** — Break down what actually drives outcomes. Examples: buyer behaviour, competition, timing, negotiation. This is the core of the post — spend the most words here.
4. **Contrast** — Show the difference between poor execution and a structured approach. Use a before/after or scenario comparison.
5. **Impact** — Explain how this affects the final result. Be specific about what is at stake — price, time, stress, control.
6. **Resolution** — Show how a clear, structured approach improves outcomes. Do not hype. Keep it grounded. Reference real process steps if relevant.
7. **Final Thought** — End with a sharp, simple takeaway. One or two sentences only. Close with a sentence that references MGP Property — e.g. "At MGP Property, we..." — keep it grounded, not a sales pitch.`;

function buildSystemPrompt(guidelines, recentPosts, documents, specificPosts) {
  return `${BASE_PROMPT}
${guidelines ? `\n## Additional Writing Guidelines\n${guidelines}` : ''}
${documents ? `\n## Reference Documents — Case Studies & Brand Assets (MANDATORY USE)\nThe documents below are case studies and brand assets you MUST weave into the post as concrete examples. For each document provided:\n- Reference it explicitly in the post as an example (e.g. "For example, in one recent case…", "We saw this with a recent vendor…").\n- Pull specific details, numbers, scenarios, or quotes from the document — do not summarise vaguely.\n- Use it inside the Mechanism, Contrast, or Impact section where it fits best.\n- If multiple documents are provided, use each one at least once.\nDo NOT invent case studies — only use the ones below.\n\n${documents}` : ''}
${specificPosts ? `\n## Specific Source Posts (USE THESE AS PRIMARY SOURCE MATERIAL — pull facts, angles, and arguments from here)\n${specificPosts}` : ''}
${recentPosts ? `\n## Past Blog Posts — MANDATORY REFERENCE\nBefore you write a single word, do the following:\n1. Read every past post below carefully\n2. Note how each post opens — what is the first sentence pattern?\n3. Note the subheading style — how are they worded, how often do they appear?\n4. Note paragraph length — how many sentences per paragraph?\n5. Note sentence rhythm — short punchy sentences or longer ones? Mixed?\n6. Note how ideas transition between paragraphs\nOnly after completing this analysis, write the new post replicating that exact style.\nYour output must feel like it came from the same writer as these posts.\n\n${recentPosts}` : '\n## WARNING: No past posts available — follow the tone and structure rules strictly.'}

## Formatting Requirements
- Use subheadings (sub-topics) like the past posts do — do not write one long unbroken block
- Use markdown formatting (## for subheadings)
- Match the paragraph length and rhythm of the past posts

Always respond with JSON: { "title": "...", "content": "..." }
The "content" field must be the full blog post in markdown, including subheadings.`;
}

// POST /api/generate — generate a new blog post (start of conversation)
// Body: { title, notes?, outline?, recentPostsLimit?, documentIds?, specificPostIds? }
// Returns: { title, content, messages }  — frontend must store `messages` and send it back for edits
router.post('/', async (req, res) => {
  const { title, notes, outline, recentPostsLimit, documentIds, specificPostIds } = req.body;

  if (!title) return res.status(400).json({ error: 'title is required' });

  const limit = parseInt(recentPostsLimit) || 3;
  const docIds = Array.isArray(documentIds) ? documentIds : [];
  const postIds = Array.isArray(specificPostIds) ? specificPostIds : [];
  const { guidelines, recentPosts, documents, specificPosts } = await getContext(limit, docIds, postIds);

  const outlineText = typeof outline === 'string' && outline.trim()
    ? `\n\nOutline (cover every point, in order):\n${outline.trim()}`
    : '';

  const messages = [
    { role: 'system', content: buildSystemPrompt(guidelines, recentPosts, documents, specificPosts) },
    {
      role: 'user',
      content: `Write a blog post with this title: "${title}"${notes ? `\n\nNotes: ${notes}` : ''}${outlineText}`,
    },
  ];

  console.log(`\n========== [generate] ==========`);
  console.log(`title: "${title}"`);
  console.log(`notes: "${notes || ''}"`);
  console.log(`outline provided: ${outlineText ? 'yes' : 'no'}`);
  console.log(`recentPostsLimit: ${limit}`);
  console.log(`\n--- SYSTEM PROMPT SENT TO AI ---`);
  console.log(messages[0].content);
  console.log(`\n--- USER PROMPT SENT TO AI ---`);
  console.log(messages[1].content);
  console.log(`================================\n`);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message;
    const result = JSON.parse(assistantMessage.content);

    console.log(`\n--- AI RESPONSE ---`);
    console.log(`Title: ${result.title}`);
    console.log(`\nContent:\n${result.content}`);
    console.log(`================================\n`);

    // Return the post + full message history so frontend can continue the chat
    res.json({
      title: result.title,
      content: result.content,
      messages: [...messages, { role: 'assistant', content: assistantMessage.content }],
    });
  } catch (err) {
    console.error(`[generate] error — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate/refine — refine an existing draft via chat
// Body: { messages, instruction }
// Returns: { title, content, messages }
router.post('/refine', async (req, res) => {
  const { messages, instruction } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (!instruction) {
    return res.status(400).json({ error: 'instruction is required' });
  }

  const updatedMessages = [
    ...messages,
    { role: 'user', content: `${instruction}\n\nRespond with the full updated post as JSON: { "title": "...", "content": "..." }` },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: updatedMessages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message;
    const result = JSON.parse(assistantMessage.content);

    res.json({
      title: result.title,
      content: result.content,
      messages: [...updatedMessages, { role: 'assistant', content: assistantMessage.content }],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate/outline — generate a list of talking points (sense-check stage)
// Body: { title, notes?, recentPostsLimit?, documentIds? }
// Returns: { outline: string[], messages }  — frontend stores `messages` and sends back to refine or to /generate
router.post('/outline', async (req, res) => {
  const { title, notes, recentPostsLimit, documentIds, specificPostIds } = req.body;

  if (!title) return res.status(400).json({ error: 'title is required' });

  const limit = parseInt(recentPostsLimit) || 3;
  const docIds = Array.isArray(documentIds) ? documentIds : [];
  const postIds = Array.isArray(specificPostIds) ? specificPostIds : [];
  const { guidelines, recentPosts, documents, specificPosts } = await getContext(limit, docIds, postIds);

  const systemPrompt = `${buildSystemPrompt(guidelines, recentPosts, documents, specificPosts)}

## Current Task: Outline Only
Do NOT write the full blog post yet. Produce a structured outline of 4–7 MAIN points. Each main point must have 2–4 SUB-points underneath it that add detail (specific arguments, examples, evidence, or angles to cover under that main point). Ground every point in the MGP brand voice and any reference documents above.

- Main points = the section-level ideas of the post (one short sentence each).
- Sub-points = the supporting detail under each main point (one specific sentence each — not vague).
- If any Reference Documents (case studies / brand assets) are provided above, EVERY case study MUST appear as a sub-point somewhere in the outline. Phrase it as a concrete example, e.g. "Example: [specific detail from the case study]" — name the document or scenario so it is clear which case study is being referenced.

Respond with JSON in this exact shape:
{ "outline": [
  { "main": "Main point 1", "subs": ["sub-point 1a", "sub-point 1b", "sub-point 1c"] },
  { "main": "Main point 2", "subs": ["sub-point 2a", "sub-point 2b"] }
] }`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Generate the outline for a blog post titled: "${title}"${notes ? `\n\nNotes: ${notes}` : ''}`,
    },
  ];

  console.log(`\n========== [outline] ==========`);
  console.log(`title: "${title}"`);
  console.log(`notes: "${notes || ''}"`);
  console.log(`recentPostsLimit: ${limit}`);
  console.log(`================================\n`);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message;
    const result = JSON.parse(assistantMessage.content);
    const outline = normalizeOutline(result.outline);

    console.log(`\n--- AI OUTLINE (${outline.length} main points) ---`);
    outline.forEach((p, i) => {
      console.log(`${i + 1}. ${p.main}`);
      p.subs.forEach((s, j) => console.log(`   ${i + 1}.${j + 1} ${s}`));
    });
    console.log(`================================\n`);

    res.json({
      outline,
      messages: [...messages, { role: 'assistant', content: assistantMessage.content }],
    });
  } catch (err) {
    console.error(`[outline] error — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Coerce AI output into [{ main, subs: [] }] regardless of whether it returned the new or old shape
function normalizeOutline(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return { main: item, subs: [] };
      if (item && typeof item === 'object') {
        const main = typeof item.main === 'string' ? item.main : '';
        const subs = Array.isArray(item.subs) ? item.subs.filter((s) => typeof s === 'string') : [];
        if (!main) return null;
        return { main, subs };
      }
      return null;
    })
    .filter(Boolean);
}

// POST /api/generate/topics — suggest 5 new blog topic ideas, informed by current AU property news
// Body: { recentPostsLimit? }
// Returns: { topics: [{ title, why, isHot?, newsSource?, newsHeadline?, newsUrl? }], newsHeadlines: [...] }
router.post('/topics', async (req, res) => {
  const { recentPostsLimit } = req.body;
  const limit = parseInt(recentPostsLimit) || 50;

  // Fetch existing post titles + live news in parallel
  const [postsResult, news] = await Promise.all([
    supabase.from('posts').select('title').order('created_at', { ascending: false }).limit(limit),
    fetchPropertyNews().catch((err) => {
      console.error('[topics] news fetch failed:', err.message);
      return [];
    }),
  ]);

  if (postsResult.error) {
    console.error('[topics] posts fetch error:', postsResult.error.message);
    return res.status(500).json({ error: postsResult.error.message });
  }

  const existingTitles = (postsResult.data || []).map((p) => p.title);

  // Format news for the prompt
  let newsBlock = '';
  const allHeadlines = [];
  if (news.length > 0) {
    newsBlock = '\n\n## Current Australian Property News (this week)\nUse these headlines to identify HOT topics that are trending right now. For any suggestion that ties to a news story, mark it as a hot topic and reference the news source.\n\n';
    for (const feed of news) {
      newsBlock += `**${feed.source}:**\n`;
      for (const item of feed.items) {
        newsBlock += `- ${item.title}${item.desc ? ` — ${item.desc}` : ''}\n`;
        allHeadlines.push({ source: feed.source, title: item.title, link: item.link || '' });
      }
      newsBlock += '\n';
    }
  }

  const systemPrompt = `You are a content strategist for MGP Property, a real estate agency in Perth, Western Australia specialising in the southern suburbs (Melville, Alfred Cove, Myaree, Mount Pleasant, Ardross, Booragoon, Applecross, Bicton, Attadale).

MGP Property's main service areas:
- Residential property sales
- Property leasing and management
- Property development
- Property appraisals and valuations

Their blog topics typically cover:
- Seller guidance (preparation, staging, timing, negotiation, agent selection)
- Buyer education (market tactics, priorities, open homes)
- Market analysis and suburb-specific data (Perth southern suburbs)
- Agency philosophy and process transparency
- Local lifestyle and community content

The blog tone is: direct, clear, no fluff, no generic marketing, no emotional storytelling. Written for serious sellers and buyers in Perth's southern suburbs.

Your task: suggest exactly 5 NEW blog topic ideas that MGP Property has NOT yet written about. Mix of:
- Topics that fill a content gap in their existing posts
- At least 1–2 HOT topics tied directly to current Australian property news headlines provided below

Each suggestion must:
- Be a specific, concrete topic angle — not generic (e.g. NOT "tips for selling your home" but "Why the first 7 days on market determine your final sale price in Perth's southern suburbs")
- Be relevant to Perth's southern suburbs real estate market
- Fit the MGP Property brand voice (direct, data-driven, consultative)
- For hot topics: clearly connect to the news story and explain how MGP's angle on it would be relevant to their clients

Respond with JSON: { "topics": [ { "title": "...", "why": "...", "isHot": false, "newsSource": "", "newsHeadline": "" }, ... ] }
- "title": sharp, specific blog post title
- "why": 1–2 sentences — why this topic now, what gap or news angle it addresses
- "isHot": true if this is tied to a current news story, false otherwise
- "newsSource": name of the news source if isHot is true, otherwise empty string
- "newsHeadline": if isHot is true, copy the EXACT headline text from the news block below that inspired this topic — character-for-character match. Otherwise empty string.`;

  const existingList = existingTitles.length > 0
    ? `\n\nAlready published posts (DO NOT suggest similar topics):\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : '\n\nNo posts published yet.';

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Suggest 5 new blog topic ideas for MGP Property.${existingList}${newsBlock}` },
  ];

  console.log(`\n========== [topics] ==========`);
  console.log(`existing posts checked: ${existingTitles.length}`);
  console.log(`news feeds fetched: ${news.length} (${allHeadlines.length} headlines)`);
  console.log(`================================\n`);

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.8,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const rawTopics = Array.isArray(result.topics) ? result.topics : [];

    // For hot topics, match the AI's quoted headline back to our headline list
    // to attach the real source + url (so the AI can't hallucinate them).
    const normalize = (s) => (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const topics = rawTopics.map((t) => {
      if (!t.isHot || !t.newsHeadline) return t;
      const target = normalize(t.newsHeadline);
      let match = allHeadlines.find((h) => normalize(h.title) === target);
      if (!match) {
        // fall back to a contains match
        match = allHeadlines.find((h) => normalize(h.title).includes(target) || target.includes(normalize(h.title)));
      }
      if (match) {
        return { ...t, newsHeadline: match.title, newsSource: match.source, newsUrl: match.link || '' };
      }
      return t;
    });

    console.log(`--- AI suggested ${topics.length} topics ---`);
    topics.forEach((t, i) => console.log(`${i + 1}. ${t.isHot ? '🔥 HOT' : '   '} ${t.title}${t.newsHeadline ? ` (← ${t.newsHeadline})` : ''}`));
    console.log(`================================\n`);

    res.json({ topics, newsHeadlines: allHeadlines });
  } catch (err) {
    console.error(`[topics] error — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate/outline/refine — chat-refine the outline
// Body: { messages, instruction }
// Returns: { outline: string[], messages }
router.post('/outline/refine', async (req, res) => {
  const { messages, instruction } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (!instruction) {
    return res.status(400).json({ error: 'instruction is required' });
  }

  const updatedMessages = [
    ...messages,
    {
      role: 'user',
      content: `${instruction}\n\nRespond with the full updated outline as JSON in this exact shape:\n{ "outline": [ { "main": "...", "subs": ["...", "..."] }, ... ] }`,
    },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: updatedMessages,
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message;
    const result = JSON.parse(assistantMessage.content);
    const outline = normalizeOutline(result.outline);

    res.json({
      outline,
      messages: [...updatedMessages, { role: 'assistant', content: assistantMessage.content }],
    });
  } catch (err) {
    console.error(`[outline/refine] error — ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
