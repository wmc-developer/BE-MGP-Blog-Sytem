require('dotenv').config();
const express = require('express');
const cors = require('cors');

const postsRouter = require('./routes/posts');
const guidelinesRouter = require('./routes/guidelines');
const documentsRouter = require('./routes/documents');
const generateRouter = require('./routes/generate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/posts', postsRouter);
app.use('/api/guidelines', guidelinesRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/generate', generateRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
