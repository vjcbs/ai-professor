// Backs the getStudentContext ElevenLabs tool.
// Called once at the start of a session so the agent can greet a returning
// student by name and reference a specific gap from their last attempt.
import { getDoc, slugify, isConfigured } from '../lib/couchbase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_name } = req.body || {};
  if (!user_name) return res.status(400).json({ error: 'user_name is required' });

  if (!isConfigured()) {
    return res.status(200).json({
      returning_user: false,
      note: 'Memory store not configured yet -- treat this as a first-time student.',
    });
  }

  const userId = slugify(user_name);

  try {
    const [profile, learningState, lastAttempt] = await Promise.all([
      getDoc(`student_profile:${userId}`),
      getDoc(`learning_state:${userId}`),
      getDoc(`case_attempt_latest:${userId}`),
    ]);

    if (!profile && !learningState && !lastAttempt) {
      return res.status(200).json({ returning_user: false, user_id: userId });
    }

    return res.status(200).json({
      returning_user: true,
      user_id: userId,
      profile: profile || null,
      learning_state: learningState || null,
      last_attempt: lastAttempt || null,
    });
  } catch (err) {
    console.error('getStudentContext error:', err);
    // Fail soft -- a memory lookup problem should never break the session.
    return res.status(200).json({ returning_user: false, error: 'lookup_failed' });
  }
}
