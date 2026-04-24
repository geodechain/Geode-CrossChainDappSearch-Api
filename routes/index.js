var express = require('express');
var router = express.Router();

// Import required modules
const db = require('../db');                           // Database connection and query interface
const { authenticateToken } = require('../middleware/auth');  // JWT authentication middleware

/**
 * GET /
 * 
 * Root route that renders the main index page.
 * This is typically the landing page or home page of the application.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
router.get('/', function(req, res, next) {
  // Render the index.jade template with the title "Express"
  res.render('index', { title: 'Express' });
});

/**
 * GET /api/example
 * 
 * Example protected API endpoint that demonstrates:
 * - JWT token authentication using authenticateToken middleware
 * - Database query execution
 * - Error handling and response formatting
 * 
 * This endpoint requires a valid JWT access token in the Authorization header.
 * Format: Authorization: Bearer <token>
 * 
 * @param {Object} req - Express request object (includes req.user from auth middleware)
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
router.get('/api/example', authenticateToken, async function (req, res, next) {
  try {
    const result = await db.query('select count(*) from reviews_make');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    // Log the error for debugging
    console.error('Database query error:', err);

    // Return error response to client
    res.status(500).json({
      success: false,
      error: 'Database query failed'
    });
  }
});

module.exports = router;
