var express = require('express');
var router = express.Router();

const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});

router.get('/api/example', authenticateToken, async function (req, res, next) {
  try {
    const result = await db.query('select count(*) from reviews_make');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Database query failed' });
  }
});

module.exports = router;
