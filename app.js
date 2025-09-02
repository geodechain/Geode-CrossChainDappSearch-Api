// Import required modules and dependencies
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const cors = require('cors');

/**
 * CORS Configuration
 * 
 * Cross-Origin Resource Sharing (CORS) settings to control which domains
 * can access the API. This is important for security and browser compatibility.
 * 
 * Allowed Origins:
 * - geodeapps.com and all subpaths (production)
 * - localhost with any port (development)
 * - Requests with no origin (mobile apps, Postman, curl)
 */
const allowedOrigins = [
  /^https:\/\/geodeapps\.com(\/.*)?$/, // geodeapps.com and subpaths
  /^http:\/\/localhost(:\d+)?$/,      // localhost with any port
  /^https:\/\/localhost(:\d+)?$/      // localhost with any port (https)
];

/**
 * CORS Options Configuration
 * 
 * Defines how CORS requests are handled:
 * - origin: Function to validate request origins
 * - credentials: Allow cookies and authentication headers
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // Check if origin matches any allowed pattern
    if (allowedOrigins.some(pattern => pattern.test(origin))) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

// Import route modules
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var dappSearchRouter = require('./routes/dapp-search');
var singleDappRouter = require('./routes/singleDapp');
var authRouter = require('./routes/auth');
var favoritesRouter = require('./routes/favorites'); 

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors(corsOptions));

app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/', dappSearchRouter);
app.use('/', singleDappRouter);
app.use('/', favoritesRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // Set error information for view rendering
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // Render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;