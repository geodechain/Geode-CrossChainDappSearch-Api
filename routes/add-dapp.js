const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * Generate a deterministic integer dapp_id from a URL using MD5 hash.
 * Mirrors the logic in data-pull-automations/services/scrapeMagicSquareDapp.service.ts
 *
 * @param {string} url - The URL to hash
 * @returns {number} - Positive 31-bit integer ID
 */
function generateDappId(url) {
  const hash = crypto.createHash('md5').update(url).digest('hex');
  return parseInt(hash.substring(0, 8), 16) & 0x7FFFFFFF;
}

/**
 * Strip query parameters (UTM tracking, etc.) from a URL and normalize.
 * Mirrors cleanWebsiteUrl() from data-pull-automations.
 *
 * @param {string} raw - Raw URL input
 * @returns {string|null} - Cleaned URL or null if invalid
 */
function cleanWebsiteUrl(raw) {
  if (!raw || raw.trim() === '') return null;
  try {
    const u = new URL(raw);
    let clean = u.origin + u.pathname;
    if (u.pathname === '/' || u.pathname === '') {
      clean = u.origin + '/';
    } else {
      clean = clean.replace(/\/+$/, '');
    }
    return clean;
  } catch {
    return raw.trim();
  }
}

/**
 * POST /api/dapps
 *
 * Add a new dApp to the store. Requires JWT authentication.
 *
 * Request body:
 * - name (string, required)
 * - description (string, required)
 * - website (string, required) - official website URL
 * - chains (string|string[], required) - blockchain networks
 * - categories (string|string[], required) - dApp categories
 * - full_description (string, optional)
 * - logo (string, optional) - URL to logo image
 * - social_links (object[], optional) - e.g. [{title, url, type}]
 * - tags (string[], optional)
 *
 * Response:
 * - 201: { success: true, data: { dapp_id, name, ... } }
 * - 400: validation error
 * - 409: duplicate dApp
 * - 500: server error
 */
router.post('/api/dapps', authenticateToken, async function (req, res, next) {
  try {
    const { name, description, website, chains, categories, full_description, logo, social_links, tags } = req.body;

    // --- Validate required fields ---
    const missing = [];
    if (!name || name.trim() === '') missing.push('name');
    if (!description || description.trim() === '') missing.push('description');
    if (!website || website.trim() === '') missing.push('website');
    if (!chains || (Array.isArray(chains) && chains.length === 0)) missing.push('chains');
    if (!categories || (Array.isArray(categories) && categories.length === 0)) missing.push('categories');

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        missing
      });
    }

    // --- Clean and normalize website URL ---
    const cleanedWebsite = cleanWebsiteUrl(website);
    if (!cleanedWebsite) {
      return res.status(400).json({
        success: false,
        error: 'Invalid website URL'
      });
    }

    // --- Check for duplicates ---
    // 1. By cleaned website URL (case-insensitive, trailing slash normalized)
    const byWebsite = await db.query(
      `SELECT dapp_id, name FROM public.dapps_main
       WHERE LOWER(REPLACE(website, '/', '')) = LOWER(REPLACE($1, '/', ''))
       LIMIT 1`,
      [cleanedWebsite]
    );
    if (byWebsite.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A dApp with this website already exists',
        existing: { dapp_id: byWebsite.rows[0].dapp_id, name: byWebsite.rows[0].name }
      });
    }

    // 2. By name (case-insensitive)
    const byName = await db.query(
      `SELECT dapp_id, name FROM public.dapps_main
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       LIMIT 1`,
      [name]
    );
    if (byName.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'A dApp with this name already exists',
        existing: { dapp_id: byName.rows[0].dapp_id, name: byName.rows[0].name }
      });
    }

    // --- Generate dapp_id ---
    const dappId = generateDappId(cleanedWebsite);

    // Check for ID collision (extremely unlikely with MD5 but safe)
    const byId = await db.query(
      `SELECT dapp_id FROM public.dapps_main WHERE dapp_id = $1 LIMIT 1`,
      [dappId]
    );
    if (byId.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'ID collision detected. Please try a slightly different website URL.'
      });
    }

    // --- Normalize array fields to JSON strings (matching existing DB format) ---
    const chainsStr = Array.isArray(chains) ? JSON.stringify(chains) : chains;
    const categoriesStr = Array.isArray(categories) ? JSON.stringify(categories) : categories;
    const tagsStr = tags ? (Array.isArray(tags) ? JSON.stringify(tags) : tags) : null;
    const socialLinksStr = social_links ? JSON.stringify(social_links) : null;

    // --- Insert into dapps_main ---
    const insertResult = await db.query(
      `INSERT INTO public.dapps_main
        (dapp_id, name, description, full_description, logo, link, website, chains, categories, social_links, tags, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
       RETURNING dapp_id, name, description, full_description, logo, link, website, chains, categories, social_links, tags, created_at`,
      [
        dappId,
        name.trim(),
        description.trim(),
        full_description ? full_description.trim() : null,
        logo || null,
        cleanedWebsite,    // link = website
        cleanedWebsite,
        chainsStr,
        categoriesStr,
        socialLinksStr,
        tagsStr
      ]
    );

    res.status(201).json({
      success: true,
      data: insertResult.rows[0],
      message: 'dApp added successfully. Reviews will be generated automatically.'
    });

  } catch (err) {
    console.error('Error adding dApp:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to add dApp',
      message: err.message
    });
  }
});

module.exports = router;
