const express = require('express');
const supabase = require('../lib/supabase');

const router = express.Router();

// GET /api/guidelines — get all guidelines
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('guidelines')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/guidelines — add a guideline
router.post('/', async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  const { data, error } = await supabase
    .from('guidelines')
    .insert({ title, content })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/guidelines/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabase
    .from('guidelines')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
