import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./sfxContext', () => {
  const mockBuffer = { duration: 1.0, length: 48000, sampleRate: 48000, numberOfChannels: 1, getChannelData: vi.fn() };
  const mockCtx = {
    decodeAudioData: vi.fn().mockResolvedValue(mockBuffer),
    sampleRate: 48000,
  };
  return {
    getCtx: vi.fn(() => mockCtx),
    getSfxOutput: vi.fn(),
    getSfxVolume: vi.fn(() => 1.0),
  };
});

const mockResponse = {
  ok: true,
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
};
global.fetch = vi.fn().mockResolvedValue(mockResponse);

import { preloadVehicleAudio, getVehicleBuffer, isVehicleLoaded, resetLoader } from './vehicleSfxLoader';

describe('vehicleSfxLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLoader();
  });

  it('preloadVehicleAudio loads spectre samples', async () => {
    await preloadVehicleAudio('bike');
    expect(isVehicleLoaded('bike')).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('getVehicleBuffer returns buffer after load', async () => {
    await preloadVehicleAudio('bike');
    const buf = getVehicleBuffer('bike', 'idle');
    expect(buf).toBeDefined();
    expect(buf!.duration).toBe(1.0);
  });

  it('getVehicleBuffer returns null for unloaded vehicle', () => {
    const buf = getVehicleBuffer('hoverboard', 'idle');
    expect(buf).toBeNull();
  });

  it('does not re-fetch if already loaded', async () => {
    await preloadVehicleAudio('bike');
    const firstCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await preloadVehicleAudio('bike');
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firstCount);
  });

  it('preloadVehicleAudio loads slingshot samples', async () => {
    await preloadVehicleAudio('car');
    expect(isVehicleLoaded('car')).toBe(true);
  });

  it('preloadVehicleAudio for hoverboard is a no-op', async () => {
    await preloadVehicleAudio('hoverboard');
    expect(isVehicleLoaded('hoverboard')).toBe(true);
  });
});
