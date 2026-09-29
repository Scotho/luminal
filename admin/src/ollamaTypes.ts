// admin/src/ollamaTypes.ts

export type OllamaRole = 'primary' | 'fast' | 'specialized' | 'none';

export interface OllamaPreset {
  name: string;        // e.g. "qwen3:14b"
  label: string;       // e.g. "Qwen3 14B"
  role: OllamaRole;
  description: string;
}

export interface OllamaConfig {
  roles: Record<string, OllamaRole>;
  defaultModel: string | null;
  presets: OllamaPreset[];
  serverAutoStart: boolean;
}

export interface OllamaStatus {
  running: boolean;
  version: string | null;
  loaded: OllamaLoadedModel[];
}

export interface OllamaLoadedModel {
  name: string;
  size_vram: number;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  expires_at: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}
