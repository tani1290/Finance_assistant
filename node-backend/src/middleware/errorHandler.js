/**
 * Global Error Handler Middleware
 * Owner: Jinay Golecha (jinay_golecha)
 */

const errorHandler = (err, req, res, next) => {
  // Log error server-side (never expose stack to client in production)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.path} — ${err.message}`);
    if (process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
  }

  // Prisma-specific errors
  if (err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ENTRY',
        message: `A record with that ${err.meta?.target?.join(', ')} already exists.`,
      },
    });
  }

  if (err.code === 'P2025') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested record was not found.',
      },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid authentication token.' },
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: { code: 'TOKEN_EXPIRED', message: 'Authentication token has expired.' },
    });
  }

  // Validation errors from express-validator
  if (err.type === 'VALIDATION_ERROR') {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: err.message,
        details: err.details || [],
      },
    });
  }

  // Default 500 internal server error
  const statusCode = err.statusCode || err.status || 500;
  return res.status(statusCode).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: (process.env.NODE_ENV === 'production' && statusCode >= 500)
        ? 'An internal server error occurred.'
        : err.message || 'An internal server error occurred.',
    },
  });
};

/**
 * 404 Not Found handler — for unmatched routes
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found.`,
    },
  });
};

module.exports = { errorHandler, notFoundHandler };
