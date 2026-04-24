const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * Stripe Configuration
 *
 * Initializes the Stripe client using the secret key from environment variables.
 * All payment processing and webhook verification flows through this instance.
 */
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Validates if the provided string is a valid Polkadot/Substrate account address.
 * Polkadot addresses use Base58 encoding and are typically 47-48 characters long.
 *
 * @param {string} accountId - The account address to validate
 * @returns {boolean} True if valid, false otherwise
 */
function isValidAccountId(accountId) {
  if (!accountId || typeof accountId !== 'string') return false;
  if (accountId.length < 47 || accountId.length > 48) return false;
  const base58Regex = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  return base58Regex.test(accountId);
}

/**
 * Validates if a value is a valid positive integer for use as a DApp ID.
 *
 * @param {*} dappId - The value to validate
 * @returns {boolean} True if it is a valid positive integer
 */
function isValidDappId(dappId) {
  return dappId && Number.isInteger(Number(dappId)) && Number(dappId) > 0;
}

/**
 * Validates if a value is a valid boost amount in USD.
 * Must be a positive integer between 1 and 100 inclusive.
 *
 * @param {*} amount - The dollar amount to validate
 * @returns {boolean} True if valid
 */
function isValidAmount(amount) {
  const num = Number(amount);
  return Number.isInteger(num) && num >= 1 && num <= 100;
}

/**
 * POST /api/boost/create-payment-intent
 *
 * Creates a Stripe PaymentIntent for boosting a DApp. The caller specifies
 * the target DApp, the dollar amount, and their Polkadot account address.
 * On success, the client receives a clientSecret to complete payment via
 * Stripe Elements on the frontend.
 *
 * @route POST /api/boost/create-payment-intent
 * @param {Object} req.body
 * @param {number} req.body.dapp_id    - Target DApp ID (must exist in dapps_main)
 * @param {number} req.body.amount     - Dollar amount (integer, 1-100)
 * @param {string} req.body.account_id - Polkadot wallet address of the booster
 * @returns {Object} JSON with clientSecret and transaction ID
 */
router.post('/api/boost/create-payment-intent', authenticateToken, async function (req, res, next) {
  try {
    const { dapp_id, amount, account_id } = req.body;

    if (!isValidDappId(dapp_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing dapp_id. Must be a positive integer.'
      });
    }

    if (!isValidAmount(amount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing amount. Must be an integer between 1 and 100.'
      });
    }

    if (!isValidAccountId(account_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing account_id. Must be a valid Polkadot address.'
      });
    }

    // Verify the DApp exists
    const dappCheck = await db.query('SELECT dapp_id FROM dapps_main WHERE dapp_id = $1', [dapp_id]);
    if (dappCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'DApp not found' });
    }

    const amountNum = Number(amount);
    const points = amountNum;

    // Create a Stripe PaymentIntent (amount in cents)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountNum * 100,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        dapp_id: String(dapp_id),
        account_id: account_id,
        points: String(points)
      }
    });

    // Record the pending transaction
    const insertResult = await db.query(
      `INSERT INTO boost_transactions (dapp_id, account_id, amount_usd, points, stripe_payment_intent_id, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [dapp_id, account_id, amountNum, points, paymentIntent.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        transactionId: insertResult.rows[0].id
      }
    });
  } catch (err) {
    console.error('Error creating payment intent:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent',
      message: err.message
    });
  }
});

/**
 * POST /api/boost/webhook
 *
 * Stripe webhook endpoint that processes payment lifecycle events.
 * On successful payment, credits boost points to the target DApp.
 * On failure, marks the transaction accordingly.
 *
 * This endpoint receives a raw request body (not JSON-parsed) and
 * verifies the Stripe webhook signature before processing.
 *
 * @route POST /api/boost/webhook
 */
router.post('/api/boost/webhook', async function (req, res, next) {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const { dapp_id, points } = paymentIntent.metadata;

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // Mark the transaction as completed (guard against duplicate webhooks)
        const updateTxn = await client.query(
          `UPDATE boost_transactions
           SET status = 'completed', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1 AND status = 'pending'`,
          [paymentIntent.id]
        );

        // Only increment points if a pending row was actually updated
        if (updateTxn.rowCount > 0) {
          await client.query(
            `UPDATE dapp_boosts
             SET boost_point = boost_point + $1, updated_at = NOW()
             WHERE dapp_id = $2`,
            [Number(points), Number(dapp_id)]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      await db.query(
        `UPDATE boost_transactions
         SET status = 'failed', updated_at = NOW()
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntent.id]
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /api/boost/top
 *
 * Returns paginated boosted DApps ordered by total boost points descending.
 * Supports optional `page` and `limit` query parameters (default: page=1, limit=3).
 * Joins with dapps_main for display fields and reviews_make for ratings.
 * The response shape matches /dapp-search to allow frontend component reuse.
 *
 * @route GET /api/boost/top
 * @param {number} [req.query.page=1]  - Page number (1-indexed)
 * @param {number} [req.query.limit=3] - Results per page
 * @returns {Object} JSON array of boosted DApps with pagination metadata
 */
router.get('/api/boost/top', authenticateToken, async function (req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, parseInt(req.query.limit) || 3);
    const offset = (page - 1) * limit;

    // Run data query and count query in parallel
    const [result, countResult] = await Promise.all([
      db.query(
        `SELECT
           dm.dapp_id,
           dm.name,
           dm.logo,
           dm.link,
           dm.chains,
           dm.categories,
           COALESCE(rm.ratings, 0) AS ratings,
           db.boost_point
         FROM dapp_boosts db
         JOIN dapps_main dm ON dm.dapp_id = db.dapp_id
         LEFT JOIN reviews_make rm ON rm.dapp_id = db.dapp_id
         WHERE db.boost_point > 0
         ORDER BY db.boost_point DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      db.query(
        `SELECT COUNT(*) FROM dapp_boosts WHERE boost_point > 0`
      )
    ]);

    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });
  } catch (err) {
    console.error('Error fetching top boosted DApps:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top boosted DApps',
      message: err.message
    });
  }
});

/**
 * GET /api/boost/status/:dapp_id
 *
 * Returns the current boost point total for a single DApp.
 *
 * @route GET /api/boost/status/:dapp_id
 * @param {number} req.params.dapp_id - The DApp ID to look up
 * @returns {Object} JSON with dapp_id and boost_point
 */
router.get('/api/boost/status/:dapp_id', authenticateToken, async function (req, res, next) {
  try {
    const { dapp_id } = req.params;

    if (!dapp_id || isNaN(dapp_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dapp_id parameter'
      });
    }

    const result = await db.query(
      'SELECT boost_point FROM dapp_boosts WHERE dapp_id = $1',
      [dapp_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'DApp not found' });
    }

    return res.status(200).json({
      success: true,
      data: {
        dapp_id: Number(dapp_id),
        boost_point: result.rows[0].boost_point
      }
    });
  } catch (err) {
    console.error('Error fetching boost status:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch boost status',
      message: err.message
    });
  }
});

/**
 * GET /api/boost/history/:dapp_id
 *
 * Returns an aggregated list of users who have boosted a given DApp,
 * ordered by total contribution descending. Useful for displaying
 * a leaderboard on the DApp detail page.
 *
 * @route GET /api/boost/history/:dapp_id
 * @param {number} req.params.dapp_id - The DApp ID
 * @returns {Object} JSON with array of booster summaries
 */
router.get('/api/boost/history/:dapp_id', authenticateToken, async function (req, res, next) {
  try {
    const { dapp_id } = req.params;

    if (!dapp_id || isNaN(dapp_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dapp_id parameter'
      });
    }

    const result = await db.query(
      `SELECT
         account_id,
         SUM(points) AS total_points,
         COUNT(*) AS boost_count,
         MAX(created_at) AS last_boosted_at
       FROM boost_transactions
       WHERE dapp_id = $1 AND status = 'completed'
       GROUP BY account_id
       ORDER BY total_points DESC
       LIMIT 20`,
      [dapp_id]
    );

    return res.status(200).json({
      success: true,
      data: {
        dapp_id: Number(dapp_id),
        boosters: result.rows
      }
    });
  } catch (err) {
    console.error('Error fetching boost history:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch boost history',
      message: err.message
    });
  }
});

/**
 * GET /api/boost/my-boosts
 *
 * Returns all DApps that the specified account has boosted,
 * along with the user's contribution totals and overall DApp boost points.
 *
 * @route GET /api/boost/my-boosts
 * @param {string} req.query.account_id - Polkadot wallet address
 * @returns {Object} JSON with array of boost summaries per DApp
 */
router.get('/api/boost/my-boosts', authenticateToken, async function (req, res, next) {
  try {
    const { account_id } = req.query;

    if (!isValidAccountId(account_id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing account_id. Must be a valid Polkadot address.'
      });
    }

    const result = await db.query(
      `SELECT
         bt.dapp_id,
         dm.name,
         dm.logo,
         SUM(bt.points) AS my_points,
         COUNT(*) AS boost_count,
         MAX(bt.created_at) AS last_boosted_at,
         db.boost_point AS total_dapp_points
       FROM boost_transactions bt
       JOIN dapps_main dm ON dm.dapp_id = bt.dapp_id
       JOIN dapp_boosts db ON db.dapp_id = bt.dapp_id
       WHERE bt.account_id = $1 AND bt.status = 'completed'
       GROUP BY bt.dapp_id, dm.name, dm.logo, db.boost_point
       ORDER BY last_boosted_at DESC`,
      [account_id]
    );

    return res.status(200).json({
      success: true,
      data: {
        account_id: account_id,
        boosts: result.rows
      }
    });
  } catch (err) {
    console.error('Error fetching user boosts:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user boosts',
      message: err.message
    });
  }
});

module.exports = router;

