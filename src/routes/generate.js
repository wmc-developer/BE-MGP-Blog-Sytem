const express = require('express');
const openai = require('../lib/openai');
const supabase = require('../lib/supabase');

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
