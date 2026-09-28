import { getFaceSearchProvider } from '@/services/external/aws/rekognition';

export interface IdentityProviderMatch {
  faceId: string;
  confidence: number;
}

export interface IdentityResolutionProvider {
  readonly name: 'aws' | 'mock';
  searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<IdentityProviderMatch | null>;
}

export class AwsIdentityResolutionProvider implements IdentityResolutionProvider {
  readonly name = 'aws' as const;

  async searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<IdentityProviderMatch | null> {
    // Reuse Phase 8 Rekognition client — never accept browser collection IDs upstream.
    const provider = getFaceSearchProvider();
    return provider.searchFace(input);
  }
}

export class MockIdentityResolutionProvider implements IdentityResolutionProvider {
  readonly name = 'mock' as const;

  async searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<IdentityProviderMatch | null> {
    void input.collectionId;
    void input.threshold;
    const delayMs = Number(process.env.MOCK_IDENTITY_DELAY_MS || 0);
    if (Number.isFinite(delayMs) && delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    const mode = (process.env.MOCK_IDENTITY_RESULT || '').toLowerCase();
    if (mode === 'unavailable') {
      const error = new Error('Mock identity unavailable');
      error.name = 'AwsNotConfigured';
      throw error;
    }
    if (mode === 'unknown') return null;
    // Default / recognized: prefer explicit face id, else scan FACEID marker.
    if (process.env.MOCK_RECOGNITION_FACE_ID) {
      return { faceId: process.env.MOCK_RECOGNITION_FACE_ID, confidence: 96.4 };
    }
    const text = Buffer.from(input.imageBytes).toString('latin1');
    const marker = text.match(/FACEID:([a-zA-Z0-9_-]+)\|/);
    if (marker) return { faceId: marker[1], confidence: 96.4 };
    return null;
  }
}

export function getIdentityResolutionProvider(): IdentityResolutionProvider {
  const value = (process.env.IDENTITY_RESOLUTION_PROVIDER || 'aws').trim().toLowerCase();
  if (value === 'mock') return new MockIdentityResolutionProvider();
  return new AwsIdentityResolutionProvider();
}
