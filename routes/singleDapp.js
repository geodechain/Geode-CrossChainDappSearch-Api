/**
 * routes/singleDapp.js
 *
 * Returns a comprehensive detail view for a single dApp, aggregating data
 * from five tables into one structured response object. Used by the dApp
 * detail page in the frontend.
 *
 * Endpoints:
 *   GET /api/dapps/:dapp_id  - Fetch full dApp detail by ID
 *
 * Auth: Requires a valid JWT (Bearer token) via authenticateToken middleware.
 *
 * Response shape:
 *   { success, data: { name, description, full_description, logo, website,
 *     chains[], categories[], social_links[], tags[], smartcontract,
 *     metrics: { balance, transactions, uaw, volume },
 *     ratings, summarized_review,
 *     reviews: { [platform]: { review, link } } } }
 */

var express = require('express');
var router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * Normalises a raw database field value into a clean JS type for the API response.
 *
 * dapps_main stores chains/categories/tags/social_links in TEXT columns using
 * several different formats depending on how they were written (comma-separated,
 * JSON array string, bare JSON objects, or native PG array). This function
 * handles every observed format so callers always receive a JS array or object.
 *
 * Field-specific rules:
 *   social_links  - Stored as a bare JSON object string (no enclosing []).
 *                   Wrapped in [] before parsing so JSON.parse succeeds.
 *   tags          - Stored as JSON objects with at least a `name` key.
 *                   Only the name is extracted to keep the response flat.
 *   categories /
 *   chains        - May arrive as a native PG array (already JS array) or as a
 *                   comma-separated/JSON string; returned as-is if already parsed.
 *
 * Fallback chain for string fields:
 *   1. JSON array string ("[…]")  → JSON.parse, or split on commas if parse fails
 *   2. Comma-separated string     → split on ','
 *   3. Single value               → returned as-is
 *
 * @param {string|Array|Object} field     Raw value from the DB row
 * @param {string}              fieldName Column name — drives field-specific logic
 * @returns {Array|string|Object|null}
 */
function parsePostgresArray(field, fieldName = '') {
  if (!field || field === 'null' || field === '') {
    return null;
  }

  try {
    if (typeof field === 'string') {
      // social_links: stored as a bare JSON object (e.g. {"platform":"twitter","url":"…"})
      // without enclosing brackets. Wrapping in [] turns it into a valid JSON array.
      if (fieldName === 'social_links') {
        const jsonString = `[${field}]`;
        try {
          return JSON.parse(jsonString);
        } catch (e) {
          console.error('Error parsing social_links:', e);
          return [];
        }
      }

      // tags: each entry is a JSON object; only the `name` property is surfaced
      // to keep the API response simple and avoid leaking internal tag metadata.
      if (fieldName === 'tags') {
        const jsonString = `[${field}]`;
        try {
          const parsed = JSON.parse(jsonString);
          return parsed.map(tag => tag.name);
        } catch (e) {
          console.error('Error parsing tags:', e);
          return [];
        }
      }

      // Generic JSON array string (e.g. '["Ethereum","Polygon"]').
      if (field.startsWith('[') && field.endsWith(']')) {
        try {
          return JSON.parse(field);
        } catch (e) {
          // Malformed JSON — fall back to splitting on commas after stripping brackets.
          return field.slice(1, -1).split(',').map(item => item.trim());
        }
      }

      // Plain comma-separated string (e.g. "Ethereum,Polygon") — the format used
      // by dapps_main after promotion from dapp_submissions via jsonToCommaSeparated().
      if (field.includes(',')) {
        return field.split(',').map(item => item.trim());
      }

      // Single value — return the string directly.
      return field;
    }

    if (Array.isArray(field)) {
      // Native PG array fields (categories, chains) need no further processing.
      if (fieldName === 'categories' || fieldName === 'chains') {
        return field;
      }

      // tags as a PG array: elements may be JSON strings or objects with a `name` key.
      if (fieldName === 'tags') {
        return field.map(item => {
          if (typeof item === 'string') {
            try {
              const parsed = JSON.parse(item);
              return parsed.name || item;
            } catch (e) {
              return item;
            }
          }
          return item.name || item;
        });
      }

      return field;
    }

    // Already an object — return as-is (e.g. if the PG driver auto-parsed JSON).
    return field;
  } catch (e) {
    console.error(`Error parsing ${fieldName}:`, e);
    return field;
  }
}

/**
 * GET /api/dapps/:dapp_id
 *
 * Returns the full detail record for a single dApp by aggregating data from
 * five joined tables in one query, then reshaping the result in application code.
 *
 * JOIN strategy:
 *   All four joins are INNER JOINs. This means a dApp will return 404 if it
 *   lacks a row in top_reviews, smart_contract_info, aggregated_metrics, or
 *   reviews_make. This is intentional — the detail page requires complete data.
 *
 *   top_reviews may have multiple rows per dApp (one per platform), which causes
 *   the query to return multiple result rows. All metadata columns (name, chains,
 *   metrics, etc.) are repeated identically across those rows — only platform,
 *   review, and link vary. The response-building step handles this by reading
 *   metadata from the first row only, then iterating all rows to collect reviews.
 *
 * Response shape:
 *   Flat DB columns are restructured into a nested object:
 *   - balance/transactions/uaw/volume → grouped under `metrics`
 *   - platform/review/link rows       → keyed by platform name under `reviews`
 *   - chains/categories/social_links/tags → parsed from raw TEXT via parsePostgresArray()
 */
router.get('/api/dapps/:dapp_id', authenticateToken, async function (req, res, next) {
  try {
    const { dapp_id } = req.params;

    // isNaN handles non-numeric strings; the check also rejects empty strings.
    if (!dapp_id || isNaN(dapp_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dapp_id parameter'
      });
    }

    // Single query fetches all five tables at once.
    // Multiple rows are returned when top_reviews has more than one platform entry
    // for this dApp — metadata columns repeat but platform/review/link differ.
    const query = `
      SELECT
        dm.name,
        dm.description,
        dm.full_description,
        dm.logo,
        dm.website,
        dm.chains,
        dm.categories,
        dm.social_links,
        dm.tags,
        sc.smartcontract,
        am.balance,
        am.transactions,
        am.uaw,
        am.volume,
        tr.link,
        tr.platform,
        tr.review,
        rm.ratings::float AS ratings,
        rm.summarized_review
      FROM dapps_main AS dm
      JOIN top_reviews AS tr ON dm.dapp_id = tr.dapp_id
      JOIN smart_contract_info AS sc ON sc.dapp_id = dm.dapp_id
      JOIN aggregated_metrics AS am ON am.dapp_id = dm.dapp_id
      JOIN reviews_make AS rm ON rm.dapp_id = dm.dapp_id
      WHERE dm.dapp_id = $1
    `;

    const result = await db.query(query, [dapp_id]);

    // 0 rows means either the dApp doesn't exist or it's missing a required
    // related row (smart_contract_info, aggregated_metrics, etc.) — both cases
    // are surfaced as 404 since the detail page cannot render partial data.
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Dapp not found'
      });
    }

    // All repeated metadata is identical across rows — read it once from row 0.
    const firstRow = result.rows[0];

    // Build the base response object. TEXT columns with structured data are
    // parsed by parsePostgresArray() into proper JS arrays/objects.
    // Metrics are nested under a single key to group related numeric fields.
    const dappData = {
      name: firstRow.name,
      description: firstRow.description,
      full_description: firstRow.full_description,
      logo: firstRow.logo,
      website: firstRow.website,
      chains: parsePostgresArray(firstRow.chains, 'chains'),
      categories: parsePostgresArray(firstRow.categories, 'categories'),
      social_links: parsePostgresArray(firstRow.social_links, 'social_links'),
      tags: parsePostgresArray(firstRow.tags, 'tags'),
      smartcontract: firstRow.smartcontract,
      metrics: {
        balance: firstRow.balance,
        transactions: firstRow.transactions,
        uaw: firstRow.uaw,       // Unique Active Wallets
        volume: firstRow.volume
      },
      ratings: firstRow.ratings,
      summarized_review: firstRow.summarized_review,
      reviews: {}  // Populated below by iterating all rows
    };

    // Each row corresponds to one platform review from top_reviews.
    // Keying by platform name gives O(1) lookup on the frontend and deduplicates
    // if the same platform somehow appears twice.
    result.rows.forEach(row => {
      if (row.platform && row.review) {
        dappData.reviews[row.platform] = {
          review: row.review,
          link: row.link
        };
      }
    });

    res.json({
      success: true,
      data: dappData
    });

  } catch (err) {
    console.error('Error fetching dapp data:', err);
    res.status(500).json({
      success: false,
      error: 'Database query failed',
      message: err.message
    });
  }
});

module.exports = router;