/**
 * FinPro — Log Sanitizer
 * Owner: Jinay Golecha (jinay_golecha)
 *
 * Ops/health probes must never echo a raw upstream error message back to a
 * client, and any diagnostic they *do* write to the server log has to be safe
 * to keep. A sick dependency can put credentials, bearer tokens, signed-URL
 * query parameters or an over-long provider payload into its error text.
 *
 * `sanitizeErrorForLog` reduces arbitrary error text to a bounded, single-line
 * string with the known secret shapes redacted. It is deliberately conservative:
 * it keeps the human-readable reason (so an operator can still diagnose the
 * failure) while removing the parts that must never be persisted in a log.
 */

// Query parameters that commonly carry credentials, tokens or URL signatures.
// Matched case-insensitively and tolerant of a `?`, `&`, whitespace or other
// separator in front of the key (error text is not always a well-formed URL).
const SENSITIVE_QUERY_PARAMS = [
  'api_token', 'apitoken', 'apikey', 'api_key', 'access_token', 'refresh_token',
  'id_token', 'authorization', 'auth', 'token', 'secret', 'client_secret',
  'password', 'passwd', 'pwd', 'sig', 'signature',
  'x-amz-signature', 'x-amz-credential', 'x-amz-security-token',
  'x-goog-signature', 'x-goog-credential',
];

const DEFAULT_MAX_LENGTH = 300;

/** scheme://user:pass@host -> scheme://***:***@host */
function redactUrlUserInfo(text) {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/?#\s@]+)@/gi, '$1***:***@');
}

/** key=value for known-sensitive keys -> key=*** (value only, key preserved). */
function redactSensitiveQueryParams(text) {
  let out = text;
  for (const param of SENSITIVE_QUERY_PARAMS) {
    const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^A-Za-z0-9_])(${escaped})=([^&\\s"'<>]+)`, 'gi');
    out = out.replace(re, '$1$2=***');
  }
  return out;
}

/** Well-known token *shapes* that are secret regardless of the surrounding key. */
function redactTokenShapes(text) {
  return text
    // AWS access key id / temporary session key id
    .replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '***AWS_KEY***')
    // JSON Web Token (header.payload.signature)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '***JWT***')
    // Authorization header credentials
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1***');
}

/**
 * @param {unknown} err        Anything: an Error, a string, or null/undefined.
 * @param {{maxLength?: number}} [options]
 * @returns {string} A single-line, bounded, secret-redacted message. Never throws.
 */
function sanitizeErrorForLog(err, options = {}) {
  let text;
  if (err == null) {
    text = 'Unknown error';
  } else if (typeof err === 'string') {
    text = err;
  } else {
    text = err.message || String(err);
  }

  text = redactUrlUserInfo(text);
  text = redactSensitiveQueryParams(text);
  text = redactTokenShapes(text);
  // Collapse control characters so a crafted message cannot forge extra log
  // lines, and squeeze runs of whitespace.
  text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  if (!text) text = 'Unknown error';

  const maxLength = Number.isInteger(options.maxLength) && options.maxLength > 0
    ? options.maxLength
    : DEFAULT_MAX_LENGTH;
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;

  return text;
}

module.exports = { sanitizeErrorForLog };
