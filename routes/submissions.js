/**
 * routes/submissions.js
 *
 * Handles the full lifecycle of dApp submissions: creation, review listing,
 * approval, and rejection. All endpoints require JWT authentication via the
 * authenticateToken middleware, making this an admin/internal-facing router.
 *
 * Endpoints:
 *   POST   /api/submissions                          - Submit a new dApp for review
 *   GET    /api/submissions                          - List all submissions (admin)
 *   GET    /api/submissions/:submission_id           - Fetch a single submission
 *   PATCH  /api/submissions/:submission_id/approve   - Approve and promote to dapps_main
 *   PATCH  /api/submissions/:submission_id/reject    - Reject with optional reason
 *
 * Auth: All routes require a valid JWT (Bearer token).
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { cleanWebsiteUrl, generateDappId } = require('../utils/dapp-helpers');

/**
 * Converts a value to a comma-separated string suitable for TEXT columns in dapps_main.
 *
 * dapp_submissions stores chains/categories as JSON strings (e.g. '["Ethereum","Polygon"]'),
 * but dapps_main stores them as plain comma-separated TEXT (e.g. 'Ethereum,Polygon').
 * This helper bridges that schema difference during the approve flow.
 *
 * Handles three cases:
 *  1. Valid JSON array  → joins with commas
 *  2. Parse failure     → returns the raw string as-is (already comma-separated or single value)
 *  3. Non-string type   → coerces to string
 */
function jsonToCommaSeparated(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.join(',');
  } catch {}
  return typeof value === 'string' ? value : String(value);
}

/** Basic RFC-5322-lite email check. Only enforces structural validity, not deliverability. */
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Attempts to parse a JSON string stored in a DB TEXT column back into its
 * original JS type (array, object, etc.). Falls back to the raw value if
 * parsing fails, so the response is never broken by malformed stored data.
 */
function parseJsonField(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

/**
 * Produces a lowercase, slash-free version of a URL for equality comparisons.
 * Strips trailing slashes and all forward slashes so that
 * "https://app.xyz/", "https://app.xyz", and "HTTPS://APP.XYZ" all match.
 * Used as a fallback when the DB comparison can't leverage an index.
 */
function normalizeUrlComparison(url) {
  return url ? url.toLowerCase().replace(/\/?$/, '').replace(/\//g, '') : '';
}

/**
 * POST /api/submissions
 *
 * Creates a new dApp submission with status='pending'. The record lives in
 * dapp_submissions until an admin approves or rejects it via the PATCH routes.
 *
 * Validation order (fail-fast):
 *   1. Optional contact_email format check (done before required-field check so
 *      we can return a specific error message rather than a generic one)
 *   2. Required fields: name, website, description, chains, categories
 *   3. URL sanity check via cleanWebsiteUrl()
 *   4. Duplicate detection against both dapp_submissions and dapps_main
 */
router.post('/api/submissions', authenticateToken, async function (req, res, next) {
  try {
    const {
      name,
      website,
      description,
      chains,
      categories,
      full_description,
      logo_url,
      social_links,
      tags,
      contact_name,
      contact_email
    } = req.body;

    // Collect all missing required fields so the caller gets a single
    // actionable error rather than fixing one field at a time.
    const missing = [];
    if (!name || !name.trim()) missing.push('name');
    if (!website || !website.trim()) missing.push('website');
    if (!description || !description.trim()) missing.push('description');
    if (!chains || (Array.isArray(chains) && chains.length === 0)) missing.push('chains');
    if (!categories || (Array.isArray(categories) && categories.length === 0)) missing.push('categories');

    // Validate email before the generic missing-fields check so we can return
    // the specific "Invalid contact email" message while email is still optional.
    if (contact_email && contact_email.trim() && !isValidEmail(contact_email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact email'
      });
    }

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing
      });
    }

    // Normalise the URL (strip trailing slashes, lowercase scheme, etc.)
    // before storing and before running duplicate checks.
    const cleanedWebsite = cleanWebsiteUrl(website);
    if (!cleanedWebsite) {
      return res.status(400).json({
        success: false,
        error: 'Invalid website URL'
      });
    }

    // normalizedWebsite is computed here for potential future use but the
    // duplicate queries below perform equivalent normalisation inline via SQL.
    const normalizedWebsite = normalizeUrlComparison(cleanedWebsite);

    // Duplicate check against pending/existing submissions.
    // LOWER(REPLACE(website, '/', '')) mirrors normalizeUrlComparison() in SQL
    // so that "https://app.xyz/" and "https://app.xyz" are treated as the same.
    const duplicateSubmission = await db.query(
      `SELECT submission_id, name FROM public.dapp_submissions
       WHERE LOWER(REPLACE(website, '/', '')) = LOWER(REPLACE($1, '/', ''))
       LIMIT 1`,
      [cleanedWebsite]
    );

    if (duplicateSubmission.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A submission with this website already exists',
        existing: { submission_id: duplicateSubmission.rows[0].submission_id, name: duplicateSubmission.rows[0].name }
      });
    }

    // Also check dapps_main so submitters don't re-submit already-listed dApps.
    const duplicateDapp = await db.query(
      `SELECT dapp_id, name FROM public.dapps_main
       WHERE LOWER(REPLACE(website, '/', '')) = LOWER(REPLACE($1, '/', ''))
       LIMIT 1`,
      [cleanedWebsite]
    );

    if (duplicateDapp.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A dApp with this website already exists',
        existing: { dapp_id: duplicateDapp.rows[0].dapp_id, name: duplicateDapp.rows[0].name }
      });
    }

    // Serialise array fields to JSON strings for storage in TEXT columns.
    // They will be re-parsed by parseJsonField() when read back out.
    const chainsStr = Array.isArray(chains) ? JSON.stringify(chains) : chains;
    const categoriesStr = Array.isArray(categories) ? JSON.stringify(categories) : categories;
    const tagsStr = tags ? (Array.isArray(tags) ? JSON.stringify(tags) : tags) : null;
    const socialLinksStr = social_links ? JSON.stringify(social_links) : null;

    // Status is hardcoded to 'pending'; it transitions to 'approved'/'rejected'
    // only through the PATCH endpoints which require an authenticated reviewer.
    const insertResult = await db.query(
      `INSERT INTO public.dapp_submissions
        (name, website, description, full_description, logo_url, chains, categories, social_links, tags, contact_name, contact_email, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', NOW(), NOW())
       RETURNING *`,
      [
        name.trim(),
        cleanedWebsite,
        description.trim(),
        full_description ? full_description.trim() : null,
        logo_url || null,
        chainsStr,
        categoriesStr,
        socialLinksStr,
        tagsStr,
        contact_name ? contact_name.trim() : null,
        contact_email ? contact_email.trim() : null
      ]
    );

    return res.status(201).json({
      success: true,
      data: insertResult.rows[0],
      message: 'Submission created successfully'
    });
  } catch (err) {
    console.error('Error creating submission:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to create submission',
      message: err.message
    });
  }
});

/**
 * GET /api/submissions
 *
 * Returns all submissions ordered newest-first. Intended for the admin review
 * dashboard. JSON-encoded TEXT columns (chains, categories, social_links, tags)
 * are parsed back into their original JS types before returning so consumers
 * don't need to double-parse.
 */
router.get('/api/submissions', authenticateToken, async function (req, res, next) {
  try {
    const result = await db.query(
      `SELECT * FROM public.dapp_submissions ORDER BY created_at DESC`
    );

    // Deserialise TEXT columns that were stored as JSON strings on insert.
    const data = result.rows.map((row) => ({
      ...row,
      chains: parseJsonField(row.chains),
      categories: parseJsonField(row.categories),
      social_links: parseJsonField(row.social_links),
      tags: parseJsonField(row.tags)
    }));

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch submissions',
      message: err.message
    });
  }
});

/**
 * GET /api/submissions/:submission_id
 *
 * Fetches a single submission by its primary key. submission_id is validated
 * as a positive integer before hitting the DB to prevent type coercion issues
 * with Number(NaN) === 0 and similar edge cases.
 */
router.get('/api/submissions/:submission_id', authenticateToken, async function (req, res, next) {
  try {
    const submissionId = Number(req.params.submission_id);
    // Reject floats, NaN, zero, and negative values — only positive integers are valid PKs.
    if (!submissionId || !Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid submission_id' });
    }

    const result = await db.query(
      `SELECT * FROM public.dapp_submissions WHERE submission_id = $1 LIMIT 1`,
      [submissionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    // Deserialise JSON TEXT fields (same pattern as the list endpoint).
    const row = result.rows[0];
    return res.json({
      success: true,
      data: {
        ...row,
        chains: parseJsonField(row.chains),
        categories: parseJsonField(row.categories),
        social_links: parseJsonField(row.social_links),
        tags: parseJsonField(row.tags)
      }
    });
  } catch (err) {
    console.error('Error fetching submission detail:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch submission detail',
      message: err.message
    });
  }
});

/**
 * PATCH /api/submissions/:submission_id/approve
 *
 * Promotes a pending submission into the live dapps_main table. This is the
 * most critical write path in the submissions flow — it touches two tables and
 * must be atomic, so it uses an explicit transaction via a dedicated pool client.
 *
 * Pre-transaction duplicate checks (performed before BEGIN so failures don't
 * leave an open transaction):
 *   1. Website URL collision against dapps_main
 *   2. Name collision (case/whitespace-insensitive) against dapps_main
 *   3. dapp_id collision (generateDappId is deterministic; collisions are rare
 *      but possible if two dApps share a URL root)
 *
 * Transaction steps (BEGIN → INSERT → UPDATE → COMMIT):
 *   - INSERT into dapps_main with chains/categories converted from JSON arrays
 *     to comma-separated strings (schema difference between the two tables)
 *   - UPDATE dapp_submissions to status='approved' with reviewer metadata
 *   - ROLLBACK automatically on any failure so we never get a dApp in
 *     dapps_main without its corresponding submission being marked approved.
 */
router.patch('/api/submissions/:submission_id/approve', authenticateToken, async function (req, res, next) {
  // Use a dedicated client (not the pool shorthand) to enable manual transaction control.
  const client = await db.pool.connect();

  try {
    const submissionId = Number(req.params.submission_id);
    const { reviewed_by } = req.body;

    if (!submissionId || !Number.isInteger(submissionId) || submissionId <= 0) {
      client.release();
      return res.status(400).json({ success: false, error: 'Invalid submission_id' });
    }

    if (!reviewed_by || typeof reviewed_by !== 'string' || reviewed_by.trim() === '') {
      client.release();
      return res.status(400).json({ success: false, error: 'reviewed_by is required' });
    }

    const submissionResult = await client.query(
      `SELECT * FROM public.dapp_submissions WHERE submission_id = $1 LIMIT 1`,
      [submissionId]
    );

    if (submissionResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    const submission = submissionResult.rows[0];
    // Guard against double-approvals or approving already-rejected submissions.
    if (submission.status !== 'pending') {
      client.release();
      return res.status(400).json({ success: false, error: 'Only pending submissions can be approved' });
    }

    const cleanedWebsite = cleanWebsiteUrl(submission.website);
    if (!cleanedWebsite) {
      client.release();
      return res.status(400).json({ success: false, error: 'Invalid website URL on submission' });
    }

    // Deterministically generate a dapp_id from the website URL.
    // Checked for collision below before inserting.
    const dappId = generateDappId(cleanedWebsite);

    // --- Pre-transaction duplicate checks ---

    // Check 1: website URL collision (same normalisation as the POST route).
    const duplicateWebsite = await client.query(
      `SELECT dapp_id, name FROM public.dapps_main
       WHERE LOWER(REPLACE(website, '/', '')) = LOWER(REPLACE($1, '/', ''))
       LIMIT 1`,
      [cleanedWebsite]
    );

    if (duplicateWebsite.rows.length > 0) {
      client.release();
      return res.status(409).json({
        success: false,
        error: 'A dApp with this website already exists',
        existing: duplicateWebsite.rows[0]
      });
    }

    // Check 2: name collision — catches cases where the same dApp was submitted
    // twice with slightly different URLs but the same display name.
    const duplicateName = await client.query(
      `SELECT dapp_id, name FROM public.dapps_main
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       LIMIT 1`,
      [submission.name]
    );

    if (duplicateName.rows.length > 0) {
      client.release();
      return res.status(409).json({
        success: false,
        error: 'A dApp with this name already exists',
        existing: duplicateName.rows[0]
      });
    }

    // Check 3: generated dapp_id collision. generateDappId() is deterministic
    // so this guards against hash/slug collisions on unusual URLs.
    const existingId = await client.query(
      `SELECT dapp_id FROM public.dapps_main WHERE dapp_id = $1 LIMIT 1`,
      [dappId]
    );

    if (existingId.rows.length > 0) {
      client.release();
      return res.status(409).json({
        success: false,
        error: 'ID collision detected while approving submission'
      });
    }

    // --- Atomic transaction: promote submission to live listing ---
    await client.query('BEGIN');

    // dapps_main stores chains/categories as comma-separated TEXT (e.g. "Ethereum,Polygon")
    // whereas dapp_submissions stores them as JSON arrays (e.g. '["Ethereum","Polygon"]').
    // jsonToCommaSeparated() handles this schema mismatch on promotion.
    const chainsStr = jsonToCommaSeparated(submission.chains);
    const categoriesStr = jsonToCommaSeparated(submission.categories);
    const tagsStr = submission.tags ? jsonToCommaSeparated(submission.tags) : null;
    // social_links is kept as a JSON string in both tables; only re-serialise if it
    // was somehow parsed into an object before reaching this point.
    const socialLinksStr = submission.social_links ? (typeof submission.social_links === 'string' ? submission.social_links : JSON.stringify(submission.social_links)) : null;

    // Both `link` and `website` are set to cleanedWebsite. `link` is the canonical
    // deep-link used in the UI; `website` is the human-readable URL used for display.
    await client.query(
      `INSERT INTO public.dapps_main
         (dapp_id, name, description, full_description, logo, link, website, chains, categories, social_links, tags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
      [
        dappId,
        submission.name,
        submission.description,
        submission.full_description,
        submission.logo_url,
        cleanedWebsite,
        cleanedWebsite,
        chainsStr,
        categoriesStr,
        socialLinksStr,
        tagsStr
      ]
    );

    // Mark the submission as approved and record who approved it and when.
    await client.query(
      `UPDATE public.dapp_submissions
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), updated_at = NOW()
       WHERE submission_id = $2`,
      [reviewed_by.trim(), submissionId]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      data: { dapp_id: dappId },
      message: 'Submission approved and dApp added to listing'
    });
  } catch (err) {
    // Roll back both writes if anything fails so the tables stay consistent.
    await client.query('ROLLBACK');
    console.error('Error approving submission:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to approve submission',
      message: err.message
    });
  } finally {
    // Always release the client back to the pool, even on error.
    client.release();
  }
});

/**
 * PATCH /api/submissions/:submission_id/reject
 *
 * Marks a submission as rejected. Unlike the approve flow, rejection only
 * touches dapp_submissions (no dapps_main write), so no transaction is needed.
 * reject_reason is optional — admins may reject silently or with a message.
 *
 * The UPDATE's RETURNING * doubles as an existence check: 0 rows returned means
 * the submission_id wasn't found, avoiding a separate SELECT round-trip.
 */
router.patch('/api/submissions/:submission_id/reject', authenticateToken, async function (req, res, next) {
  try {
    const submissionId = Number(req.params.submission_id);
    const { reviewed_by, reject_reason } = req.body;

    if (!submissionId || !Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid submission_id' });
    }

    if (!reviewed_by || typeof reviewed_by !== 'string' || reviewed_by.trim() === '') {
      return res.status(400).json({ success: false, error: 'reviewed_by is required' });
    }

    // RETURNING * lets us detect a missing submission_id without a prior SELECT.
    const result = await db.query(
      `UPDATE public.dapp_submissions
       SET status = 'rejected', reject_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE submission_id = $3
       RETURNING *`,
      [reject_reason ? reject_reason.trim() : null, reviewed_by.trim(), submissionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Submission not found' });
    }

    return res.json({ success: true, data: result.rows[0], message: 'Submission rejected' });
  } catch (err) {
    console.error('Error rejecting submission:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to reject submission',
      message: err.message
    });
  }
});

module.exports = router;
