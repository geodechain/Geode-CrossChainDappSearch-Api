/**
 * routes/dapp-search.js
 *
 * Provides the main dApp discovery endpoint used by the frontend search UI.
 * Supports multi-value filtering by category and chain, optional rating
 * threshold, partial name search, and paginated results.
 *
 * Endpoints:
 *   GET /dapp-search  - Search and filter dApps
 *
 * Auth: Requires a valid JWT (Bearer token) via authenticateToken middleware.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * Builds a SQL OR clause for a TEXT column that stores comma-separated values.
 *
 * dapps_main stores chains and categories as comma-separated TEXT
 * (e.g. "Ethereum,Polygon"), so a single equality check per requested value is
 * used rather than ANY() or array operators. Multiple values are joined with OR
 * so a dApp matching *any* of the requested values is returned.
 *
 * SQL INJECTION NOTE: Values are interpolated directly into the SQL string
 * rather than passed as parameterised placeholders. This is acceptable here
 * because filter values (category names, chain names) come from a known,
 * controlled set defined by the frontend dropdowns — they are not free-text
 * user input. If this endpoint is ever exposed to arbitrary user strings,
 * parameterised IN() or a whitelist check must replace this approach.
 *
 * @param {string} field  - Qualified column name, e.g. "dm.categories"
 * @param {string[]} values - Array of filter values
 * @returns {string} SQL fragment like "(dm.categories = 'DeFi' OR dm.categories = 'Gaming')"
 *                   or '' if values is empty
 *
 * Example:
 *   buildOrClause('dm.categories', ['DeFi', 'Gaming'])
 *   → "dm.categories = 'DeFi' OR dm.categories = 'Gaming'"
 */
function buildOrClause(field, values) {
    if (!values || values.length === 0) return '';

    if (!Array.isArray(values)) values = [values];

    return values.map(val => `${field} = '${val}'`).join(' OR ');
}

/**
 * GET /dapp-search
 *
 * Main search and discovery endpoint for the dApp listing UI.
 *
 * Query parameters:
 *   category  string|string[]  Filter by one or more category names (OR logic).
 *                              Accepts a comma-separated string or repeated keys.
 *   chain     string|string[]  Filter by one or more chain names (OR logic).
 *   ratings   number           Minimum average rating threshold (inclusive).
 *                              Only applied when explicitly provided — see note below.
 *   name      string           Case-insensitive partial name search (ILIKE).
 *   limit     number           Results per page. Default: 20.
 *   page      number           1-based page number. Default: 1.
 *
 * JOIN strategy:
 *   LEFT JOIN reviews_make so dApps with no rating rows are still returned.
 *   A regular JOIN would silently exclude newly approved dApps that have not
 *   yet received any reviews.
 *
 * Rating filter design decision:
 *   The ratings filter is ONLY added to the WHERE clause when the caller
 *   explicitly passes a `ratings` query param. If we defaulted to `ratings >= 1`
 *   unconditionally, newly approved dApps (which have no entry in reviews_make
 *   yet) would never appear in search results — the LEFT JOIN would produce
 *   NULL for rm.ratings, and NULL >= 1 is FALSE in SQL.
 *
 * Response:
 *   { data: DApp[], total: number } — paginated rows plus total count for the UI.
 */
router.get('/dapp-search', authenticateToken, async function (req, res, next) {
    try {
        let { category, chain, ratings, name, limit = 20, page = 1 } = req.query;
        limit = parseInt(limit);
        page = parseInt(page);
        const offset = (page - 1) * limit;

        // WHERE clauses are accumulated here and joined with AND.
        // whereParams holds parameterised values; limit/offset are appended after
        // so their $N indices are always last.
        let whereClauses = [];
        let whereParams = [];
        let paramIndex = 1;

        // Category filter: accept both repeated query keys (?category=DeFi&category=Gaming)
        // and a single comma-separated string (?category=DeFi,Gaming).
        if (category) {
            const categories = Array.isArray(category) ? category : (typeof category === 'string' ? category.split(',') : [category]);
            const clause = buildOrClause('dm.categories', categories);
            if (clause) whereClauses.push(`(${clause})`);
        }

        // Chain filter: same multi-value handling as category above.
        if (chain) {
            const chainsArr = Array.isArray(chain) ? chain : (typeof chain === 'string' ? chain.split(',') : [chain]);
            const clause = buildOrClause('dm.chains', chainsArr);
            if (clause) whereClauses.push(`(${clause})`);
        }

        // Rating filter: only applied when explicitly requested.
        // Omitting this when ratings is absent ensures newly approved dApps
        // (which have NULL ratings via the LEFT JOIN) are still visible by default.
        // The value is interpolated directly (not parameterised) because it is a
        // numeric literal produced by parseFloat — not raw user string input.
        if (ratings) {
            whereClauses.push(`rm.ratings >= ${parseFloat(ratings)}`);
        }

        // Name search: uses a parameterised placeholder to safely handle
        // arbitrary user-supplied text with ILIKE for case-insensitive matching.
        if (name) {
            whereClauses.push(`dm.name ILIKE $${paramIndex}`);
            whereParams.push(`%${name}%`);
            paramIndex++;
        }

        let whereSQL = '';
        console.log(whereClauses, "whereclo")
        if (whereClauses.length > 0) {
            whereSQL = 'WHERE ' + whereClauses.join(' AND ');
        }

        // WHERE params come first; limit and offset are appended so their $N
        // indices are always at the end of the params array.
        const limitParam = `$${paramIndex}`;
        const offsetParam = `$${paramIndex + 1}`;
        const queryParams = [...whereParams, limit, offset];

        // LEFT JOIN keeps dApps with no reviews_make row (NULL ratings) in the result set.
        // ORDER BY rm.ratings DESC naturally floats NULLs to the bottom in PostgreSQL.
        const query = `
            SELECT
                dm.dapp_id,
                dm.name,
                dm.chains,
                dm.categories,
                dm.logo,
                dm.link,
                rm.ratings::float AS ratings
            FROM
                dapps_main dm
            LEFT JOIN
                reviews_make rm ON dm.dapp_id = rm.dapp_id
            ${whereSQL}
            ORDER BY
                rm.ratings DESC
            LIMIT ${limitParam} OFFSET ${offsetParam}
        `;

        console.log(query, queryParams, "query")

        const result = await db.query(query, queryParams);

        // Count query for pagination — reuses same whereSQL and whereParams.
        const countQuery = `
            SELECT COUNT(*) AS total
            FROM dapps_main dm
            LEFT JOIN reviews_make rm ON dm.dapp_id = rm.dapp_id
            ${whereSQL}
        `;

        const countResult = await db.query(countQuery, whereParams);
        const total = parseInt(countResult.rows[0].total, 10);

        res.json({ data: result.rows, total });

    } catch (e) {
        next(e);
    }
});

module.exports = router;
