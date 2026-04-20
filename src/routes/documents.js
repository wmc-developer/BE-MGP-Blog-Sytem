const express = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();

// GET /api/documents — get all documents
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/documents/:id — get single document
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Document not found' });
  res.json(data);
});

// POST /api/documents — add a document
router.post('/', async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({ title, content })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/documents/:id — update a document
router.put('/:id', async (req, res) => {
  const { title, content } = req.body;

  if (!title && !content) {
    return res.status(400).json({ error: 'provide at least title or content to update' });
  }

  const updates = {};
  if (title !== undefined) updates.title = title;
  if (content !== undefined) updates.content = content;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('documents')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
