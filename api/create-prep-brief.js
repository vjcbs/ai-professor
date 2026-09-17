// Backs the createPrepBrief ElevenLabs tool.
// Called at the very end of a session to lock in a final recommendation,
// feedback, and a concrete next-practice prompt for the following session.
import { upsertDoc, slugify, isConfigured } from '../lib/couchbase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_name, recommendation, feedback, next_practice_prompt } = req.body || {};
  if (!user_name) return res.status(400).json({ error: 'user_name is required' });

  if (!isConfigured()) {
    return res.status(200).json({ saved: false, note: 'Memory store not configured yet.' });
  }

  const userId = slugify(user_name);
  const timestamp = new Date().toISOString();
  const brief = {
    user_id: userId,
    recommendation: recommendation || null,
    feedback: feedback || null,
    next_practice_prompt: next_practice_prompt || null,
    timestamp,
  };

  try {
    await Promise.all([
      upsertDoc(`prep_brief:${userId}:${timestamp}`, brief), // history trail
      upsertDoc(`prep_brief_latest:${userId}`, brief), // O(1) lookup
    ]);
    return res.status(200).json({ saved: true, brief });
  } catch (err) {
    console.error('createPrepBrief error:', err);
    return res.status(200).json({ saved: false, error: 'save_failed' });
  }
}
