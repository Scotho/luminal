import { describe, it, expect } from 'vitest';
import { validateSocial } from './socialValidation';

describe('validateSocial - Discord', () => {
  it('accepts a valid username (2-32 alphanumeric chars)', () => {
    const result = validateSocial('discord', 'CoolPlayer99');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('CoolPlayer99');
    expect(result.error).toBeUndefined();
  });

  it('accepts username with dots and underscores', () => {
    const result = validateSocial('discord', 'cool.player_99');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('cool.player_99');
  });

  it('accepts legacy Name#0000 format', () => {
    const result = validateSocial('discord', 'Player#1234');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('Player#1234');
  });

  it('accepts legacy format with 4-digit discriminator', () => {
    const result = validateSocial('discord', 'CoolGamer#9999');
    expect(result.valid).toBe(true);
  });

  it('accepts minimum length username (2 chars)', () => {
    const result = validateSocial('discord', 'ab');
    expect(result.valid).toBe(true);
  });

  it('accepts maximum length username (32 chars)', () => {
    const result = validateSocial('discord', 'a'.repeat(32));
    expect(result.valid).toBe(true);
  });

  it('rejects username that is too short (1 char)', () => {
    const result = validateSocial('discord', 'a');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects username that is too long (33 chars)', () => {
    const result = validateSocial('discord', 'a'.repeat(33));
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects username with disallowed special chars', () => {
    const result = validateSocial('discord', 'player@home');
    expect(result.valid).toBe(false);
  });

  it('accepts empty string (clearing field)', () => {
    const result = validateSocial('discord', '');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace before validation', () => {
    const result = validateSocial('discord', '  CoolPlayer  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('CoolPlayer');
  });
});

describe('validateSocial - Steam', () => {
  it('accepts a valid custom ID (alphanumeric+underscore+hyphen)', () => {
    const result = validateSocial('steam', 'cool_player-99');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('cool_player-99');
  });

  it('accepts minimum length custom ID (2 chars)', () => {
    const result = validateSocial('steam', 'ab');
    expect(result.valid).toBe(true);
  });

  it('accepts maximum length custom ID (32 chars)', () => {
    const result = validateSocial('steam', 'a'.repeat(32));
    expect(result.valid).toBe(true);
  });

  it('accepts steamcommunity.com /id/ URL', () => {
    const result = validateSocial('steam', 'https://steamcommunity.com/id/coolplayer');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('https://steamcommunity.com/id/coolplayer');
  });

  it('accepts steamcommunity.com /profiles/ URL', () => {
    const result = validateSocial('steam', 'https://steamcommunity.com/profiles/76561198000000000');
    expect(result.valid).toBe(true);
  });

  it('accepts http steamcommunity.com URL', () => {
    const result = validateSocial('steam', 'http://steamcommunity.com/id/someone');
    expect(result.valid).toBe(true);
  });

  it('rejects arbitrary URL', () => {
    const result = validateSocial('steam', 'https://evil.com/malware');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects custom ID that is too short (1 char)', () => {
    const result = validateSocial('steam', 'a');
    expect(result.valid).toBe(false);
  });

  it('rejects custom ID that is too long (33 chars)', () => {
    const result = validateSocial('steam', 'a'.repeat(33));
    expect(result.valid).toBe(false);
  });

  it('accepts empty string (clearing field)', () => {
    const result = validateSocial('steam', '');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace before validation', () => {
    const result = validateSocial('steam', '  coolplayer  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('coolplayer');
  });
});

describe('validateSocial - Twitch', () => {
  it('accepts a valid channel name (alphanumeric + underscores)', () => {
    const result = validateSocial('twitch', 'cool_streamer99');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('cool_streamer99');
  });

  it('accepts minimum length name (4 chars)', () => {
    const result = validateSocial('twitch', 'abcd');
    expect(result.valid).toBe(true);
  });

  it('accepts maximum length name (25 chars)', () => {
    const result = validateSocial('twitch', 'a'.repeat(25));
    expect(result.valid).toBe(true);
  });

  it('rejects name that is too short (3 chars)', () => {
    const result = validateSocial('twitch', 'abc');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects name that is too long (26 chars)', () => {
    const result = validateSocial('twitch', 'a'.repeat(26));
    expect(result.valid).toBe(false);
  });

  it('rejects name with dots', () => {
    const result = validateSocial('twitch', 'cool.streamer');
    expect(result.valid).toBe(false);
  });

  it('rejects name with hyphens', () => {
    const result = validateSocial('twitch', 'cool-streamer');
    expect(result.valid).toBe(false);
  });

  it('rejects arbitrary URL', () => {
    const result = validateSocial('twitch', 'https://evil.com/scam');
    expect(result.valid).toBe(false);
  });

  it('rejects special characters', () => {
    const result = validateSocial('twitch', 'cool@streamer');
    expect(result.valid).toBe(false);
  });

  it('accepts empty string (clearing field)', () => {
    const result = validateSocial('twitch', '');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace before validation', () => {
    const result = validateSocial('twitch', '  coolstreamer  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('coolstreamer');
  });
});

describe('validateSocial - YouTube', () => {
  it('accepts @handle format', () => {
    const result = validateSocial('youtube', '@CoolChannel');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('@CoolChannel');
  });

  it('accepts full youtube.com /@handle URL', () => {
    const result = validateSocial('youtube', 'https://www.youtube.com/@CoolChannel');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('https://www.youtube.com/@CoolChannel');
  });

  it('accepts youtube.com /channel/ URL', () => {
    const result = validateSocial('youtube', 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx');
    expect(result.valid).toBe(true);
  });

  it('accepts youtube.com /c/ URL', () => {
    const result = validateSocial('youtube', 'https://www.youtube.com/c/CoolChannel');
    expect(result.valid).toBe(true);
  });

  it('accepts youtube.com without www', () => {
    const result = validateSocial('youtube', 'https://youtube.com/@CoolChannel');
    expect(result.valid).toBe(true);
  });

  it('rejects arbitrary URL', () => {
    const result = validateSocial('youtube', 'https://evil.com/scam');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects non-@ plain text (not a valid handle)', () => {
    const result = validateSocial('youtube', 'notahandle');
    expect(result.valid).toBe(false);
  });

  it('accepts empty string (clearing field)', () => {
    const result = validateSocial('youtube', '');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('');
  });

  it('trims whitespace before validation', () => {
    const result = validateSocial('youtube', '  @CoolChannel  ');
    expect(result.valid).toBe(true);
    expect(result.value).toBe('@CoolChannel');
  });
});
