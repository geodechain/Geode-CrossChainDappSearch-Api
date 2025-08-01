const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db');
const { authenticateRefreshToken } = require('../middleware/auth');

// Validate client credentials against database
const validateClientCredentials = async (clientId, clientSecret) => {
  try {
    // Query the api_clients table for the provided clientId
    const result = await db.query(
      'SELECT client_id, client_secret, is_active FROM api_clients WHERE client_id = $1',
      [clientId]
    );

    if (result.rows.length === 0) {
      console.log(`Client ID not found: ${clientId}`);
      return false;
    }

    const client = result.rows[0];

    // Check if client is active
    if (!client.is_active) {
      console.log(`Client is inactive: ${clientId}`);
      return false;
    }

    // Compare the provided client secret with the hashed secret in database
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

// Generate tokens for a client
router.post('/generate-token', async (req, res) => {
  try {
    const { clientId, clientSecret } = req.body;

    // Validate input
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
        message: 'Client ID and Client Secret are required'
      });
    }

    // Validate client credentials against database
    const isValidClient = await validateClientCredentials(clientId, clientSecret);
    
    if (!isValidClient) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Invalid client ID or client secret'
      });
    }

    // Generate access token
    const accessToken = jwt.sign(
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

    // Generate refresh token
    const refreshToken = jwt.sign(
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

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: 900, // 15 minutes in seconds
        refreshTokenExpiresIn: 604800 // 7 days in seconds
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

// Refresh access token using refresh token
router.post('/refresh-token', authenticateRefreshToken, async (req, res) => {
  try {
    const { clientId } = req.user;

    // Generate new access token
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

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        tokenType: 'Bearer',
        expiresIn: 900, // 15 minutes in seconds
        refreshTokenExpiresIn: 604800 // 7 days in seconds
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

// Validate token endpoint
router.post('/validate-token', (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
        message: 'Access token is required'
      });
    }

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

      res.json({
        success: true,
        data: {
          valid: true,
          clientId: decoded.clientId,
          type: decoded.type
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