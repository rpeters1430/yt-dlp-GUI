const safeRegex = require('safe-regex2');

const MAX_PATTERN_LENGTH = 200;

// Returns an error message for a pattern that can't be stored, or null when it's usable.
// Patterns are delimiter-free and always compiled case-insensitively.
function validatePattern(pattern, label) {
  if (pattern === null || pattern === undefined || pattern === '') return null;
  if (typeof pattern !== 'string') return `${label} regex must be text`;
  if (pattern.length > MAX_PATTERN_LENGTH) return `${label} regex must be ${MAX_PATTERN_LENGTH} characters or fewer`;
  try {
    new RegExp(pattern, 'i');
  } catch (_) {
    return `${label} must be a valid regular expression`;
  }
  if (!safeRegex(pattern)) return `${label} regex is unsafe (it could take too long to evaluate)`;
  return null;
}

function validateWatchFilters({ matchTitle, rejectTitle } = {}) {
  return [
    validatePattern(normalizePattern(matchTitle), 'Include title'),
    validatePattern(normalizePattern(rejectTitle), 'Exclude title'),
  ].filter(Boolean);
}

function normalizePattern(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : (value || null);
}

// The configuration error for a watch's stored filters (e.g. a legacy pattern saved before
// validation existed), or null when they're usable.
function watchConfigError(watch) {
  const errors = validateWatchFilters({ matchTitle: watch.match_title, rejectTitle: watch.reject_title });
  return errors.length ? errors.join('; ') : null;
}

// Order: include regex, exclude regex, minimum duration, maximum duration. The first rule
// that fails becomes the reason. An unknown duration never fails a duration rule.
function evaluateEntry(entry, watch) {
  const title = String((entry && entry.title) || '').trim();
  const include = normalizePattern(watch.match_title);
  const exclude = normalizePattern(watch.reject_title);

  if (include && !new RegExp(include, 'i').test(title)) {
    return { eligible: false, reason: 'Include title regex did not match' };
  }
  if (exclude && new RegExp(exclude, 'i').test(title)) {
    return { eligible: false, reason: 'Exclude title regex matched' };
  }
  const duration = typeof entry.duration === 'number' && Number.isFinite(entry.duration) ? entry.duration : null;
  if (duration !== null) {
    if (watch.min_duration && duration < watch.min_duration) {
      return { eligible: false, reason: `Shorter than ${watch.min_duration} seconds` };
    }
    if (watch.max_duration && duration > watch.max_duration) {
      return { eligible: false, reason: `Longer than ${watch.max_duration} seconds` };
    }
  }
  return { eligible: true, reason: null };
}

module.exports = { MAX_PATTERN_LENGTH, validatePattern, validateWatchFilters, watchConfigError, evaluateEntry };
