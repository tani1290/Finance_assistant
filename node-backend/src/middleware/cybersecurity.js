/**
 * FinPro Cybersecurity Hardening Middleware
 * Enterprise defense-in-depth for Node.js + Express
 */

/**
 * Sanitizes input string to prevent stored/reflected XSS attacks
 * Strips script tags, javascript: pseudo-protocols, and malicious event handlers
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:[^\s"'>]*/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/on\w+\s*=\s*[^\s>]+/gi, '');
}

/**
 * Deep sanitization for objects and arrays
 */
function deepSanitize(target) {
  if (!target || typeof target !== 'object') {
    return typeof target === 'string' ? sanitizeString(target) : target;
  }

  if (Array.isArray(target)) {
    return target.map(item => deepSanitize(item));
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(target)) {
    // Prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cleaned[key] = deepSanitize(value);
  }
  return cleaned;
}

/**
 * Basic Input Sanitizer Middleware
 */
const inputSanitizer = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = deepSanitize(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = deepSanitize(req.query);
  }
  if (req.params && typeof req.params === 'object') {
    req.params = deepSanitize(req.params);
  }
  next();
};

/**
 * HTTP Parameter Pollution (HPP) defense
 * Prevents attackers from supplying duplicate parameters in queries (e.g. ?id=1&id=2)
 */
const hppProtection = (req, res, next) => {
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        // Retain only the last value to prevent array confusion attacks
        req.query[key] = req.query[key][req.query[key].length - 1];
      }
    }
  }
  next();
};

/**
 * Enterprise Security Response Headers Middleware
 */
const securityHeaders = (req, res, next) => {
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Anti-clickjacking / framing defense
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  
  // Legacy XSS filter
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer privacy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Restrict sensitive browser APIs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  
  // Enforce HSTS in production (1 year)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Remove server technology fingerprinting
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');

  next();
};

module.exports = {
  inputSanitizer,
  hppProtection,
  securityHeaders,
};
