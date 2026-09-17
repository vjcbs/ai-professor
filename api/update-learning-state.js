// Backs the updateLearningState ElevenLabs tool.
// Called when the agent identifies a gap that keeps showing up, so next
// session's greeting can name it specifically instead of generically.
import { getDoc, upsertDoc, slugify, isConfigured } from '../lib/couchbase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_name, recurring_gaps, next_challenge } = req.body || {};
  if (!user_name) return res.status(400).json({ error: 'user_name is required' });

  if (!isConfigured()) {
    return res.status(200).json({ saved: false, note: 'Memory store not configured yet.' });
  }

  const userId = slugify(user_name);

  try {
    const existing = (await getDoc(`learning_state:${userId}`)) || {
      user_id: userId,
      recurring_gaps: [],
    };

    const mergedGaps =
      Array.isArray(recurring_gaps) && recurring_gaps.length
        ? Array.from(new Set([...(existing.recurring_gaps || []), ...recurring_gaps]))
        : existing.recurring_gaps || [];

    const updated = {
      user_id: userId,
      recurring_gaps: mergedGaps,
      next_challenge: next_challenge || existing.next_challenge || null,
      updated_at: new Date().toISOString(),
    };

    await upsertDoc(`learning_state:${userId}`, updated);
    return res.status(200).json({ saved: true, learning_state: updated });
  } catch (err) {
    console.error('updateLearningState error:', err);
    return res.status(200).json({ saved: false, error: 'save_failed' });
  }
}
