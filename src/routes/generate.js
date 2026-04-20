const express = require('express');
const openai = require('../lib/openai');
const supabase = require('../lib/supabase');

const router = express.Router();

async function getContext(postsLimit = 3, documentIds = []) {
  const queries = [
    supabase.from('guidelines').select('title, content').order('created_at', { ascending: false }),
    supabase.from('posts').select('title, content').order('created_at', { ascending: false }).limit(postsLimit),
  ];

  if (documentIds.length > 0) {
    queries.push(supabase.from('documents').select('title, content').in('id', documentIds));
  }

  const [guidelinesRes, recentPostsRes, documentsRes] = await Promise.all(queries);

  if (guidelinesRes.error) console.error('[context] guidelines error:', guidelinesRes.error.message);
  if (recentPostsRes.error) console.error('[context] posts error:', recentPostsRes.error.message);
  if (documentsRes?.error) console.error('[context] documents error:', documentsRes.error.message);

  const guidelinesData = guidelinesRes.data || [];
  const postsData = recentPostsRes.data || [];
  const documentsData = documentsRes?.data || [];

  console.log(`[context] guidelines fetched: ${guidelinesData.length}`);
  console.log(`[context] recent posts fetched: ${postsData.length} (limit=${postsLimit})`);
  console.log(`[context] documents fetched: ${documentsData.length} (ids=${documentIds.join(', ') || 'none'})`);
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

  return { guidelines, recentPosts, documents };
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

function buildSystemPrompt(guidelines, recentPosts, documents) {
  return `${BASE_PROMPT}
${guidelines ? `\n## Additional Writing Guidelines\n${guidelines}` : ''}
${documents ? `\n## Reference Documents (brand assets, case studies — use these as factual reference when relevant)\n${documents}` : ''}
${recentPosts ? `\n## Past Blog Posts — MANDATORY REFERENCE\nBefore you write a single word, do the following:\n1. Read every past post below carefully\n2. Note how each post opens — what is the first sentence pattern?\n3. Note the subheading style — how are they worded, how often do they appear?\n4. Note paragraph length — how many sentences per paragraph?\n5. Note sentence rhythm — short punchy sentences or longer ones? Mixed?\n6. Note how ideas transition between paragraphs\nOnly after completing this analysis, write the new post replicating that exact style.\nYour output must feel like it came from the same writer as these posts.\n\n${recentPosts}` : '\n## WARNING: No past posts available — follow the tone and structure rules strictly.'}

## Formatting Requirements
- Use subheadings (sub-topics) like the past posts do — do not write one long unbroken block
- Use markdown formatting (## for subheadings)
- Match the paragraph length and rhythm of the past posts

Always respond with JSON: { "title": "...", "content": "..." }
The "content" field must be the full blog post in markdown, including subheadings.`;
}

// POST /api/generate — generate a new blog post (start of conversation)
// Body: { title, notes? }
// Returns: { title, content, messages }  — frontend must store `messages` and send it back for edits
router.post('/', async (req, res) => {
  const { title, notes, recentPostsLimit, documentIds } = req.body;

  if (!title) return res.status(400).json({ error: 'title is required' });

  const limit = parseInt(recentPostsLimit) || 3;
  const docIds = Array.isArray(documentIds) ? documentIds : [];
  const { guidelines, recentPosts, documents } = await getContext(limit, docIds);

  const messages = [
    { role: 'system', content: buildSystemPrompt(guidelines, recentPosts, documents) },
    {
      role: 'user',
      content: `Write a blog post with this title: "${title}"${notes ? `\n\nNotes: ${notes}` : ''}`,
    },
  ];

  console.log(`\n========== [generate] ==========`);
  console.log(`title: "${title}"`);
  console.log(`notes: "${notes || ''}"`);
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

module.exports = router;
