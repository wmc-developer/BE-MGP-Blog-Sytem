const express = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();

// GET /api/posts — list all past posts
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/posts/count — total number of saved posts (for frontend to show limit picker)
router.get('/count', async (req, res) => {
  const { count, error } = await supabase
    .from('posts')
    .select('*', { count: 'exact', head: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ count });
});

// GET /api/posts/:id — get single post
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Post not found' });
  res.json(data);
});

// POST /api/posts — save a generated post (user clicked "Select / Save")
router.post('/', async (req, res) => {
  const { title, content, notes, messages } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({ title, content, notes, messages })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/posts/:id — edit a saved post (title, content, topic, keywords)
router.put('/:id', async (req, res) => {
  const { title, content, notes, messages } = req.body;

  if (!title && !content) {
    return res.status(400).json({ error: 'provide at least title or content to update' });
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  if (notes !== undefined) updates.notes = notes;
  if (messages !== undefined) updates.messages = messages;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/posts/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('posts')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
