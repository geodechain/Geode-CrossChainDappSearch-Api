const jwt = require('jsonwebtoken');
const config = require('../config');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Access token required',
      message: 'Please provide a valid access token in the Authorization header'
    });
  }

  jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  }, (err, decoded) => {
    if (err) {
      console.log(err, " >>>>> err")
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          error: 'Token expired',
          message: 'Access token has expired. Please refresh your token.'
        });
      }
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid token',
        message: 'Invalid or malformed access token'
      });
    }

    req.user = decoded;
    next();
  });
};

const authenticateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ 
      success: false, 
      error: 'Refresh token required',
      message: 'Please provide a refresh token'
    });
  }

  jwt.verify(refreshToken, config.jwt.refreshSecret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience
  }, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          error: 'Refresh token expired',
          message: 'Refresh token has expired. Please authenticate again.'
        });
      }
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid refresh token',
        message: 'Invalid or malformed refresh token'
      });
    }

    req.user = decoded;
    next();
  });
};

module.exports = {
  authenticateToken,
  authenticateRefreshToken
};