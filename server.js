require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── In-memory store ──────────────────────────────────────────────────────────
let currentMessage = {
  content: 'Something beautiful is on its way...',
  type: 'morning',
  created_at: new Date(),
};

// ─── Claude ───────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const prompts = {
  morning:   `Write a sweet good morning message for Kinna to wake up to. Make her feel loved, beautiful, and excited for the day ahead.`,
  afternoon: `Write a sweet good afternoon message for Kinna. Remind her that Ricky is thinking about her in the middle of the day and that she's always on his mind.`,
  evening:   `Write a sweet good evening message for Kinna. Make her feel cherished as her day winds down, warm and loved going into the night.`,
};

async function generateMessage(type) {
  const systemPrompt = `You write short, sweet, deeply personal love messages from Ricky to his girlfriend Kinna.
Every message must include a genuine compliment about how beautiful Kinna is — make it feel specific and heartfelt, not generic.
Tone: warm, romantic, heartfelt, and genuine. Not cheesy or generic — make it feel real and personal.
Length: 2–4 sentences. Sign off with "— Ricky" at the end.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompts[type] }],
  });

  return response.content[0].text.trim();
}

async function triggerNewMessage(type) {
  console.log(`Generating ${type} message...`);
  try {
    const content = await generateMessage(type);
    currentMessage = { content, type, created_at: new Date() };
    console.log(`[${new Date().toISOString()}] New ${type} message saved.`);
  } catch (err) {
    console.error('Error generating message:', err.message);
  }
}

// ─── Cron jobs — 8am, 2pm, 6pm Pacific ───────────────────────────────────────
cron.schedule('0 8  * * *', () => triggerNewMessage('morning'),   { timezone: 'America/Los_Angeles' });
cron.schedule('0 14 * * *', () => triggerNewMessage('afternoon'), { timezone: 'America/Los_Angeles' });
cron.schedule('0 18 * * *', () => triggerNewMessage('evening'),   { timezone: 'America/Los_Angeles' });

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/message', (req, res) => {
  res.json(currentMessage);
});

// Manual send — protected by ADMIN_SECRET if set
app.post('/api/send', (req, res) => {
  const { content, type, secret } = req.body;

  if (process.env.ADMIN_SECRET && secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }

  const validTypes = ['morning', 'afternoon', 'evening'];
  const msgType = validTypes.includes(type) ? type : getCurrentType();

  currentMessage = { content: content.trim(), type: msgType, created_at: new Date() };
  console.log(`[${new Date().toISOString()}] Manual message sent.`);
  res.json({ ok: true, message: currentMessage });
});

// Next message time among 8am, 2pm, 6pm Pacific
app.get('/api/next', (req, res) => {
  const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const h  = la.getHours();

  let next = new Date(la);
  next.setSeconds(0);
  next.setMilliseconds(0);

  if (h < 8) {
    next.setHours(8, 0, 0, 0);
  } else if (h < 14) {
    next.setHours(14, 0, 0, 0);
  } else if (h < 18) {
    next.setHours(18, 0, 0, 0);
  } else {
    // After 6pm — next is 8am tomorrow
    next.setDate(next.getDate() + 1);
    next.setHours(8, 0, 0, 0);
  }

  res.json({ nextMs: next - la });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
function getCurrentType() {
  const la = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const h  = la.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

async function start() {
  // Set correct type immediately so the label is right even before generation
  currentMessage.type = getCurrentType();

  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  await triggerNewMessage(getCurrentType());
}

start().catch(console.error);
