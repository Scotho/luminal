export type SocialPlatform = 'discord' | 'steam' | 'twitch' | 'youtube';

export interface ValidationResult {
  valid: boolean;
  value: string;
  error?: string;
}

function ok(value: string): ValidationResult {
  return { valid: true, value };
}

function fail(value: string, error: string): ValidationResult {
  return { valid: false, value, error };
}

function validateDiscord(input: string): ValidationResult {
  if (input === '') return ok(input);

  // Legacy Name#0000 format
  const legacyRe = /^[a-zA-Z0-9_.]{2,32}#\d{4}$/;
  if (legacyRe.test(input)) return ok(input);

  // Modern username: 2-32 chars, alphanumeric + dots + underscores
  const modernRe = /^[a-zA-Z0-9_.]{2,32}$/;
  if (modernRe.test(input)) return ok(input);

  if (input.length < 2) return fail(input, 'Discord username must be at least 2 characters.');
  if (input.length > 32) return fail(input, 'Discord username must be at most 32 characters.');
  return fail(input, 'Discord username may only contain letters, numbers, dots, and underscores.');
}

function validateSteam(input: string): ValidationResult {
  if (input === '') return ok(input);

  // Full steamcommunity.com URL
  const urlRe = /^https?:\/\/steamcommunity\.com\/(id|profiles)\/[^\s/].*$/;
  if (urlRe.test(input)) return ok(input);

  // Reject any other URL
  if (/^https?:\/\//i.test(input)) {
    return fail(input, 'Only steamcommunity.com URLs are allowed.');
  }

  // Custom ID: 2-32 chars, alphanumeric + underscore + hyphen
  const idRe = /^[a-zA-Z0-9_-]{2,32}$/;
  if (idRe.test(input)) return ok(input);

  if (input.length < 2) return fail(input, 'Steam ID must be at least 2 characters.');
  if (input.length > 32) return fail(input, 'Steam ID must be at most 32 characters.');
  return fail(input, 'Steam custom ID may only contain letters, numbers, underscores, and hyphens.');
}

function validateTwitch(input: string): ValidationResult {
  if (input === '') return ok(input);

  // Reject any URL
  if (/^https?:\/\//i.test(input)) {
    return fail(input, 'Enter your Twitch username, not a URL.');
  }

  // 4-25 chars, alphanumeric + underscores only
  const re = /^[a-zA-Z0-9_]{4,25}$/;
  if (re.test(input)) return ok(input);

  if (input.length < 4) return fail(input, 'Twitch username must be at least 4 characters.');
  if (input.length > 25) return fail(input, 'Twitch username must be at most 25 characters.');
  return fail(input, 'Twitch username may only contain letters, numbers, and underscores.');
}

function validateYouTube(input: string): ValidationResult {
  if (input === '') return ok(input);

  // Full youtube.com URL: /@handle, /channel/..., /c/...
  const urlRe = /^https?:\/\/(www\.)?youtube\.com\/(@[^\s/]+|channel\/[^\s/]+|c\/[^\s/]+)/;
  if (urlRe.test(input)) return ok(input);

  // Reject any other URL
  if (/^https?:\/\//i.test(input)) {
    return fail(input, 'Only youtube.com URLs are allowed.');
  }

  // @handle format
  if (/^@[^\s]+$/.test(input)) return ok(input);

  return fail(input, 'YouTube must be an @handle or a youtube.com URL.');
}

export function validateSocial(platform: SocialPlatform, input: string): ValidationResult {
  const trimmed = input.trim();
  switch (platform) {
    case 'discord': return validateDiscord(trimmed);
    case 'steam':   return validateSteam(trimmed);
    case 'twitch':  return validateTwitch(trimmed);
    case 'youtube': return validateYouTube(trimmed);
  }
}
