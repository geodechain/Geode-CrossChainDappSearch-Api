const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');
const { authenticateRefreshToken } = require('../middleware/auth');

/**
 * Validate client credentials against database
 * This function checks if the provided clientId and clientSecret match
 * a valid, active client in the api_clients table
 * 
 * @param {string} clientId - The client identifier
 * @param {string} clientSecret - The plain text client secret
 * @returns {Promise<boolean>} - True if credentials are valid, false otherwise
 */
const validateClientCredentials = async (clientId, clientSecret) => {
  try {
    // Query the api_clients table for the provided clientId
    // Using parameterized query to prevent SQL injection
    const result = await db.query(
      'SELECT client_id, client_secret, is_active FROM api_clients WHERE client_id = $1',
      [clientId]
    );

    // Check if client exists in database
    if (result.rows.length === 0) {
      console.log(`Client ID not found: ${clientId}`);
      return false;
    }

    const client = result.rows[0];

    // Check if client account is active (can be deactivated without deletion)
    if (!client.is_active) {
      console.log(`Client is inactive: ${clientId}`);
      return false;
    }

    // Compare the provided plain text client secret with the bcrypt hash stored in database
    // bcrypt.compare() handles the salt extraction and comparison automatically
    const isValidSecret = await bcrypt.compare(clientSecret, client.client_secret);
    
    if (!isValidSecret) {
      console.log(`Invalid client secret for client: ${clientId}`);
      return false;
    }

    console.log(`Client credentials validated successfully for: ${clientId}`);
    return true;

  } catch (error) {
    console.error('Client validation error:', error);
    return false;
  }
};

/**
 * POST /auth/generate-token
 * Generate JWT access and refresh tokens for a valid client
 * 
 * Request body:
 * - clientId: string - The client identifier
 * - clientSecret: string - The client secret (plain text)
 * 
 * Response:
 * - accessToken: JWT access token (15 minutes expiry)
 * - refreshToken: JWT refresh token (7 days expiry)
 * - tokenType: Always "Bearer"
 * - expiresIn: Access token expiry in seconds
 * - refreshTokenExpiresIn: Refresh token expiry in seconds
 */
router.post('/generate-token', async (req, res) => {
  try {
    // Extract client credentials from request body
    const { clientId, clientSecret } = req.body;

    // Validate that both credentials are provided
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Client ID and Client Secret are required'
      });
    }

    // Validate client credentials against database
    // This replaces the previous placeholder validation
    const isValidClient = await validateClientCredentials(clientId, clientSecret);
    
    if (!isValidClient) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Invalid client ID or client secret'
      });
    }

    // Generate JWT access token
    // Contains clientId and type for identification and validation
    const accessToken = jwt.sign(
      {
        clientId: clientId,  // Include clientId in token payload for tracking
        type: 'access'        // Token type for different validation rules
      },
      config.jwt.secret,     // Use JWT secret from config (different from client secret)
      {
        expiresIn: config.jwt.accessTokenExpiry,  // 15 minutes from config
        issuer: config.jwt.issuer,                // API issuer identifier
        audience: config.jwt.audience             // Intended audience
      }
    );

    // Generate JWT refresh token
    // Used to get new access tokens without re-authenticating
    const refreshToken = jwt.sign(
      {
        clientId: clientId,  // Same clientId for consistency
        type: 'refresh'       // Different type for refresh validation
      },
      config.jwt.refreshSecret,  // Separate secret for refresh tokens
      {
        expiresIn: config.jwt.refreshTokenExpiry,  // 7 days from config
        issuer: config.jwt.issuer,                 // Same issuer
        audience: config.jwt.audience              // Same audience
      }
    );

    // Return success response with tokens and metadata
    res.json({
      success: true,
      data: {
        accessToken,                    // JWT access token
        refreshToken,                   // JWT refresh token
        tokenType: 'Bearer',            // Token type for Authorization header
        expiresIn: 900,                 // 15 minutes in seconds (hardcoded for consistency)
        refreshTokenExpiresIn: 604800   // 7 days in seconds (hardcoded for consistency)
      },
      message: 'Tokens generated successfully'
    });

  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Token generation failed',
      message: 'Failed to generate authentication tokens'
    });
  }
});

/**
 * POST /auth/refresh-token
 * Generate new access and refresh tokens using a valid refresh token
 * 
 * This endpoint requires the refresh token to be validated first
 * through the authenticateRefreshToken middleware
 * 
 * Request body:
 * - refreshToken: string - Valid refresh token
 * 
 * Response:
 * - New access and refresh tokens with updated expiry
 */
router.post('/refresh-token', authenticateRefreshToken, async (req, res) => {
  try {
    // Extract clientId from the decoded refresh token (set by middleware)
    const { clientId } = req.user;

    // Generate new access token with same payload structure
    const newAccessToken = jwt.sign(
      {
        clientId: clientId,
        type: 'access'
      },
      config.jwt.secret,
      {
        expiresIn: config.jwt.accessTokenExpiry,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      }
    );

    // Generate new refresh token
    // This allows for token rotation and better security
    const newRefreshToken = jwt.sign(
      {
        clientId: clientId,
        type: 'refresh'
      },
      config.jwt.refreshSecret,
      {
        expiresIn: config.jwt.refreshTokenExpiry,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience
      }
    );

    // Return new tokens
    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: 900,                 // 15 minutes
        refreshTokenExpiresIn: 604800   // 7 days
      },
      message: 'Tokens refreshed successfully'
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed',
      message: 'Failed to refresh authentication tokens'
    });
  }
});

/**
 * POST /auth/validate-token
 * Validate a JWT access token and return token information
 * 
 * This endpoint is useful for clients to check if their token is still valid
 * and to extract information from the token payload
 * 
 * Request headers:
 * - Authorization: Bearer <token>
 * 
 * Response:
 * - valid: boolean - Whether the token is valid
 * - clientId: string - The client ID from the token
 * - type: string - The token type (access/refresh)
 */
router.post('/validate-token', (req, res) => {
  try {
    // Extract token from Authorization header
    // Format: "Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];  // Split "Bearer" and token

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
        message: 'Access token is required'
      });
    }

    // Verify the JWT token using the same secret and options used for signing
    jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    }, (err, decoded) => {
      if (err) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token',
          message: 'Token is invalid or expired'
        });
      }

      // Token is valid, return decoded information
      res.json({
        success: true,
        data: {
          valid: true,
          clientId: decoded.clientId,  // Client ID from token payload
          type: decoded.type            // Token type from payload
        },
        message: 'Token is valid'
      });
    });

  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Token validation failed',
      message: 'Failed to validate token'
    });
  }
});

module.exports = router;