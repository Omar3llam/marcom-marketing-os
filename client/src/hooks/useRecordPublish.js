// ============================================================
// useRecordPublish Hook — record a manual Meta publish
// ============================================================
// Closes the attribution link AFTER a human published an ad manually in
// Meta Ads Manager (using copy/briefs from an approved artifact). The user
// re-enters the real Meta IDs; we POST them to /api/attribution/publish,
// which records a PublishedCreative row. This NEVER calls the Meta API or
// creates anything in Meta — it records an external action that happened.
//
// Honest failure states: the api client maps transport errors to domain
// errors but drops the 404/409 response bodies, so we surface specific,
// user-correctable messages keyed on httpStatus (the user is hand-typing
// real IDs — validation/dedup errors here are expected, not generic faults).
// ============================================================
import { useState, useCallback } from 'react';
import { api } from '../lib/api.js';

/**
 * Map a mapped domain error to a specific, honest, user-facing message.
 * @param {Object} err - AppError (has httpStatus, message, context)
 * @returns {string}
 */
function friendlyMessage(err) {
  const status = err?.httpStatus;
  // The 400 branch of the api client preserves the server body under
  // context.details; 404/409 do not, so those get an explicit local message.
  const serverError = err?.context?.details?.error;

  if (status === 409) {
    return 'This artifact is already linked to a published Meta ad. Each ad ID can only be recorded once.';
  }
  if (status === 403) {
    return 'You do not have permission to record a publish. This requires a Buyer or Strategist seat.';
  }
  if (status === 404) {
    return 'Could not find that artifact in your workspace.';
  }
  if (status === 400) {
    return serverError || 'Some required Meta IDs are missing or invalid. Check the ad ID and campaign ID.';
  }
  return err?.message || 'Failed to record the publish. Please try again.';
}

/**
 * Hook for recording a manual Meta publish against an approved artifact.
 *
 * @param {Object} [opts]
 * @param {Function} [opts.onSuccess] - called with the created PublishedCreative
 * @returns {{ recordPublish: Function, submitting: boolean, error: string|null, published: Object|null, reset: Function }}
 */
export function useRecordPublish({ onSuccess } = {}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [published, setPublished] = useState(null);

  const recordPublish = useCallback(async (artifactId, values) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await api.post('/api/attribution/publish', {
        artifactId,
        metaAdId: values.metaAdId?.trim(),
        metaCampaignId: values.metaCampaignId?.trim(),
        // Optional fields — send only when provided (schema allows null).
        metaAdsetId: values.metaAdsetId?.trim() || undefined,
        adName: values.adName?.trim() || undefined,
      });

      const created = response.data?.publishedCreative ?? null;
      setPublished(created);
      onSuccess?.(created);
      return created;
    } catch (err) {
      setError(friendlyMessage(err));
      throw err;
    } finally {
      setSubmitting(false);
    }
  }, [onSuccess]);

  const reset = useCallback(() => {
    setError(null);
    setPublished(null);
  }, []);

  return { recordPublish, submitting, error, published, reset };
}
