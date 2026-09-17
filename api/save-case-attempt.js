// Backs the saveCaseAttempt ElevenLabs tool.
// Called once the agent has a clear read on how this attempt went, so the
// specifics (thesis, evidence used, tradeoffs missed, rough score) get
// written down before the session ends.
import { upsertDoc, getDoc, slugify, isConfigured } from '../lib/couchbase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    user_name,
    conversation_id,
    mode,
    thesis,
    evidence_used,
    missed_tradeoffs,
    score,
    course,
    weak_areas,
  } = req.body || {};

  if (!user_name) return res.status(400).json({ error: 'user_name is required' });

  if (!isConfigured()) {
    return res.status(200).json({ saved: false, note: 'Memory store not configured yet.' });
  }

  const userId = slugify(user_name);
  const timestamp = new Date().toISOString();
  const attempt = {
    user_id: userId,
    conversation_id: conversation_id || null,
    mode: mode || null,
    thesis: thesis || null,
    evidence_used: evidence_used || null,
    missed_tradeoffs: missed_tradeoffs || null,
    score: score ?? null,
    timestamp,
  };

  try {
    const writes = [
      upsertDoc(`case_attempt:${userId}:${timestamp}`, attempt), // history trail
      upsertDoc(`case_attempt_latest:${userId}`, attempt), // O(1) lookup for getStudentContext
    ];

    // Opportunistically keep the student_profile doc current -- this is the
    // only tool that ever supplies course/weak_areas, so it's the natural
    // place to create or refresh that record.
    if (course || (Array.isArray(weak_areas) && weak_areas.length)) {
      const existingProfile = (await getDoc(`student_profile:${userId}`)) || {
        user_id: userId,
        name: user_name,
        weak_areas: [],
      };
      const mergedWeakAreas = Array.isArray(weak_areas)
        ? Array.from(new Set([...(existingProfile.weak_areas || []), ...weak_areas]))
        : existingProfile.weak_areas || [];
      writes.push(
        upsertDoc(`student_profile:${userId}`, {
          user_id: userId,
          name: user_name,
          course: course || existingProfile.course || null,
          weak_areas: mergedWeakAreas,
        })
      );
    }

    await Promise.all(writes);
    return res.status(200).json({ saved: true, user_id: userId, timestamp });
  } catch (err) {
    console.error('saveCaseAttempt error:', err);
    return res.status(200).json({ saved: false, error: 'save_failed' });
  }
}
