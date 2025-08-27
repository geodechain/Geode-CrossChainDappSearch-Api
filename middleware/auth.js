const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware to authenticate JWT access tokens
 * 
 * This middleware:
 * 1. Extracts the JWT token from the Authorization header
 * 2. Verifies the token using the JWT secret
 * 3. Checks token expiry and validity
 * 4. Adds decoded user information to req.user
 * 5. Calls next() if authentication succeeds
 * 
 * Usage: router.get('/protected', authenticateToken, (req, res) => { ... })
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateToken = (req, res, next) => {
  // Extract the Authorization header from the request
  const authHeader = req.headers['authorization'];

  // Parse the token from "Bearer <token>" format
  // Split by space and take the second part (the actual token)
  const token = authHeader && authHeader.split(' ')[1];

  // Check if token is provided
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access token required',
      message: 'Please provide a valid access token in the Authorization header'
    });
  }

  // Verify the JWT token using the secret and validation options
  jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  }, (err, decoded) => {
    if (err) {
      // Handle different types of JWT verification errors
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          error: 'Token expired',
          message: 'Access token has expired. Please refresh your token.'
        });
      }

      // Handle other JWT errors (invalid signature, malformed token, etc.)
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid token',
        message: 'Invalid or malformed access token'
      });
    }

    // Token is valid, add decoded information to request object
    // This makes the user/client information available to subsequent middleware/routes
    req.user = decoded;

    // Continue to the next middleware or route handler
    next();
  });
};

/**
 * Middleware to authenticate JWT refresh tokens
 * 
 * This middleware:
 * 1. Extracts the refresh token from the request body
 * 2. Verifies the refresh token using the refresh secret
 * 3. Checks token expiry and validity
 * 4. Adds decoded user information to req.user
 * 5. Calls next() if authentication succeeds
 * 
 * Usage: router.post('/refresh', authenticateRefreshToken, (req, res) => { ... })
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateRefreshToken = (req, res, next) => {
  // Extract refresh token from request body
  const { refreshToken } = req.body;

  // Check if refresh token is provided
  if (!refreshToken) {
    return res.status(401).json({ 
      success: false, 
      error: 'Refresh token required',
      message: 'Please provide a refresh token'
    });
  }

  // Verify the refresh token using the refresh secret and validation options
  jwt.verify(refreshToken, config.jwt.refreshSecret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  }, (err, decoded) => {
    if (err) {
      // Handle different types of JWT verification errors
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          error: 'Refresh token expired',
          message: 'Refresh token has expired. Please authenticate again.'
        });
      }

      // Handle other JWT errors (invalid signature, malformed token, etc.)
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid refresh token',
        message: 'Invalid or malformed refresh token'
      });
    }

    // Refresh token is valid, add decoded information to request object
    // This makes the user/client information available to subsequent middleware/routes
    req.user = decoded;

    // Continue to the next middleware or route handler
    next();
  });
};

// Export the middleware functions for use in routes
module.exports = {
  authenticateToken,
  authenticateRefreshToken
};