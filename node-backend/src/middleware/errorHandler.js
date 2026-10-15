/**
 * Global Error Handler Middleware
 * Owner: Jinay Golecha (jinay_golecha)
 * Handles: API Key errors, Auth errors, Rate limits, Model errors, etc.
 */

const errorHandler = (err, req, res, next) => {
  // Log error server-side (never expose stack to client in production)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.path} — ${err.message}`);
    if (process.env.NODE_ENV === 'development') {
      console.error(err.stack);
    }
  }

  // Helper: get effective status code from err
  const codeFromMessage = err.message && /^\d{3}$/.test(err.message.split(' ')[0])
    ? parseInt(err.message.split(' ')[0])
    : null;
  const statusCode = err.statusCode || err.status || codeFromMessage;

  // ── API Key Error ──
  if (err.code === 'API_KEY_ERROR' || (err.message && err.message.includes('API Key'))) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'API_KEY_ERROR',
        message: 'API key configuration error. Please contact support.',
      },
    });
  }

  // ── Authentication Error (401) ──
  if (err.name === 'JsonWebTokenError' || err.code === 'UNAUTHORIZED') {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'Authentication failed. Please log in again.',
      },
    });
  }
  if (err.message) {
    const msg = err.message.toLowerCase();
    if (msg.includes('401') || msg.includes('invalid credentials') ||
        msg.includes('invalid token') || msg.includes('token expired') ||
        msg.includes('authentication failed') || msg.includes('unauthorized')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Authentication failed. Please log in again.',
        },
      });
    }
  }

  // ── Permission Error (403) ──
  if (err.code === 'FORBIDDEN' || (err.message && err.message.includes('403'))) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'PERMISSION_ERROR',
        message: 'You do not have permission to perform this action.',
      },
    });
  }

  // ── Rate Limit Error (429) ──
  if (err.status === 429 || err.code === 'RATE_LIMIT_EXCEEDED' ||
      (err.message && err.message.toLowerCase().includes('rate limit'))) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_ERROR',
        message: 'Rate limit exceeded. Please try again shortly.',
      },
    });
  }

  // ── Insufficient Credits Error ──
  if (err.code === 'INSUFFICIENT_CREDITS' ||
      (err.message && err.message.toLowerCase().includes('insufficient') || err.message.toLowerCase().includes('credits'))) {
    return res.status(402).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_CREDITS',
        message: 'Insufficient credits. Please top up your account or upgrade your plan.',
      },
    });
  }

  // ── Model Not Found Error (404) ──
  if (err.code === 'NOT_FOUND' || err.status === 404 ||
      (err.message && err.message.toLowerCase().includes('404') || err.message.toLowerCase().includes('not_found') || err.message.toLowerCase().includes('not found'))) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'MODEL_NOT_FOUND',
        message: 'The requested model or resource was not found.',
      },
    });
  }

  // ── Provider Unavailable Error (503) ──
  if (err.code === 'SERVICE_UNAVAILABLE' || err.status === 503 ||
      (err.message && err.message.toLowerCase().includes('unavailable'))) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Service temporarily unavailable. Please try again later.',
      },
    });
  }

  // ── Request Timeout Error (504) ──
  if (err.code === 'TIMEOUT_ERROR' || err.code === 'ECONNABORTED' ||
      (err.message && err.message.toLowerCase().includes('timeout'))) {
    return res.status(504).json({
      success: false,
      error: {
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out. The server took too long to respond.',
      },
    });
  }

  // ── Context Length Exceeded Error ──
  if (err.code === 'CONTEXT_LENGTH_EXCEEDED' ||
      (err.message && err.message.toLowerCase().includes('context'))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'CONTEXT_LENGTH_EXCEEDED',
        message: 'Context length exceeded. Please shorten your request.',
      },
    });
  }

  // ── Invalid Request Error (400) ──
  if (err.status === 400 || err.code === 'VALIDATION_ERROR' ||
      (err.message && err.message.toLowerCase().includes('invalid request'))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'Invalid request. Please check your input and try again.',
      },
    });
  }

  // ── Unsupported Model Error ──
  if (err.code === 'UNSUPPORTED_MODEL' || err.message?.toLowerCase().includes('unsupported model')) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'UNSUPPORTED_MODEL',
        message: 'The requested model is not supported. Please use a supported model.',
      },
    });
  }

  // ── Streaming Error ──
  if (err.code === 'STREAMING_ERROR' || (err.message && err.message.toLowerCase().includes('stream'))) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'STREAMING_ERROR',
        message: 'Streaming error occurred. Please try again.',
      },
    });
  }

  // ── Connection Error ──
  if (err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ||
      (err.message && err.message.toLowerCase().includes('connection'))) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'CONNECTION_ERROR',
        message: 'Connection error. Please check your network and try again.',
      },
    });
  }

  // ── Network Error ──
  if (err.code === 'ENOTFOUND' || err.code === 'EADDRINFO' ||
      (err.message && err.message.toLowerCase().includes('network'))) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Network error. Please check your connection and try again.',
      },
    });
  }

  // ── JSON Parsing Error ──
  if (err.code === 'JSON_PARSE_ERROR' || (err.message && err.message.toLowerCase().includes('json'))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'JSON_PARSING_ERROR',
        message: 'Invalid JSON response from server.',
      },
    });
  }

  // ── Tool Calling Error ──
  if (err.code === 'TOOL_CALLING_ERROR' || (err.message && err.message.toLowerCase().includes('tool'))) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'TOOL_CALLING_ERROR',
        message: 'Tool calling error occurred.',
      },
    });
  }

  // ── Function Calling Error ──
  if (err.code === 'FUNCTION_CALLING_ERROR' || (err.message && err.message.toLowerCase().includes('function'))) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'FUNCTION_CALLING_ERROR',
        message: 'Function calling error occurred.',
      },
    });
  }

  // ── Token Limit Error ──
  if (err.code === 'TOKEN_LIMIT_ERROR' || err.message?.toLowerCase().includes('token limit')) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'TOKEN_LIMIT_ERROR',
        message: 'Token limit exceeded. Please shorten your request.',
      },
    });
  }

  // Default 500 internal server error
  return res.status(statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: (process.env.NODE_ENV === 'production' && (statusCode || 500) >= 500)
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