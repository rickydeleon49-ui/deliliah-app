require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      type VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('Database ready.');
}

// ─── Claude ──────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateMessage(type) {
  const isMorning = type === 'morning';

  const systemPrompt = `You write short, sweet, deeply personal love messages from Ricky to his girlfriend Delilah.
Ricky's pet name for Delilah is "cum slut" — use it naturally and affectionately within the message.
Tone: warm, sweet, intimate, loving. Not cheesy or generic.
Length: 2–4 sentences. Sign off with "— Ricky" at the end.`;

  const userPrompt = isMorning
    ? `Write a sweet good morning message for Delilah to wake up to. Make her feel loved, beautiful, and excited for the day.`
    : `Write a sweet good evening message for Delilah. Make her feel cherished, remind her she's always on Ricky's mind, and wish her a peaceful night.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text.trim();
}

// ─── Message helpers ─────────────────────────────────────────────────────────
async function saveMessage(content, type) {
  await pool.query('INSERT INTO messages (content, type) VALUES ($1, $2)', [content, type]);
}

async function getLatestMessage() {
  const result = await pool.query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1');
  return result.rows[0] || null;
}

async function triggerNewMessage(type) {
  console.log(`Generating ${type} message...`);
  try {
    const content = await generateMessage(type);
    await saveMessage(content, type);
    console.log(`[${new Date().toISOString()}] New ${type} message saved.`);
  } catch (err) {
    console.error('Error generating message:', err.message);
  }
}

// ─── Cron jobs — 8am & 8pm Pacific ───────────────────────────────────────────
cron.schedule('0 8 * * *', () => triggerNewMessage('morning'), {
  timezone: 'America/Los_Angeles',
});

cron.schedule('0 20 * * *', () => triggerNewMessage('evening'), {
  timezone: 'America/Los_Angeles',
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/message', async (req, res) => {
  try {
    const message = await getLatestMessage();
    res.json(message || { content: 'Something beautiful is on its way...', type: 'morning', created_at: new Date() });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch message' });
  }
});

// Next message time (8am or 8pm Pacific, whichever is next)
app.get('/api/next', (req, res) => {
  const now = new Date();
  // Get current time in LA
  const la = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const h = la.getHours();
  const m = la.getMinutes();
  const s = la.getSeconds();

  let next = new Date(la);
  next.setSeconds(0);
  next.setMilliseconds(0);

  if (h < 8 || (h === 8 && m === 0 && s === 0)) {
    next.setHours(8, 0, 0, 0);
  } else if (h < 20) {
    next.setHours(20, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
  }

  const diffMs = next - la;
  res.json({ nextMs: diffMs });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDB();

  // Seed a message on first boot if DB is empty
  const existing = await getLatestMessage();
  if (!existing) {
    const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const type = la.getHours() < 12 ? 'morning' : 'evening';
    await triggerNewMessage(type);
  }

  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

start().catch(console.error);
