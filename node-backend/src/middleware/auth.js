const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

/**
 * Routes that may authenticate with a `?token=` query parameter.
 *
 * This exists only for the Server-Sent Events stream: the browser EventSource
 * API cannot set an Authorization header, and the stream is the one endpoint
 * that genuinely needs it (polling, exports and every other call use
 * `Authorization: Bearer`). Keeping the allowlist explicit means all other
 * endpoints reject query tokens, so JWTs can no longer leak through URLs
 * (browser history, Referer, proxy/access logs, shared links).
 */
const QUERY_TOKEN_PATHS = new Set(['/api/v1/realtime/stream']);

const allowsQueryToken = (req) => {
  const pathname = (req.originalUrl || req.url || '').split('?')[0];
  return QUERY_TOKEN_PATHS.has(pathname);
};

/**
 * JWT Authentication Middleware
 * Verifies the Bearer token in Authorization header (or, on the SSE stream
 * route only, a `?token=` query parameter).
 * Sets req.user to the authenticated user object
 */
const authenticate = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token && allowsQueryToken(req)) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication token is required.' },
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'Access token has expired. Please refresh.' },
        });
      }
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid authentication token.' },
      });
    }

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        username: true,
        firstName: true,
        lastName: true,
        role: true,
        isPremium: true,
        isActive: true,
        currency: true,
        timezone: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User account not found or deactivated.' },
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { authenticate };
