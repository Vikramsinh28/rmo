import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  DescribeCollectionCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  RekognitionClient,
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';
import sharp from 'sharp';

export interface IndexedFaceResult {
  faceId: string;
  facesDetected: number;
}

export interface FaceMatchResult {
  faceId: string;
  confidence: number;
}

export interface DetectedFaceBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FaceIndexProvider {
  ensureCollection(collectionId: string): Promise<void>;
  indexFace(input: {
    collectionId: string;
    externalImageId: string;
    imageBytes: Uint8Array;
  }): Promise<IndexedFaceResult>;
  deleteFaces(collectionId: string, faceIds: string[]): Promise<void>;
}

export interface FaceSearchProvider {
  detectFaces(imageBytes: Uint8Array): Promise<DetectedFaceBox[]>;
  searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<FaceMatchResult | null>;
}

function createRekognitionClient() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return new RekognitionClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export class AwsRekognitionFaceProvider implements FaceIndexProvider, FaceSearchProvider {
  constructor(private readonly client: RekognitionClient) {}

  async ensureCollection(collectionId: string): Promise<void> {
    try {
      await this.client.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
      return;
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
    try {
      await this.client.send(new CreateCollectionCommand({ CollectionId: collectionId }));
    } catch (error) {
      if (!(error instanceof ResourceAlreadyExistsException)) throw error;
    }
  }

  async indexFace(input: {
    collectionId: string;
    externalImageId: string;
    imageBytes: Uint8Array;
  }): Promise<IndexedFaceResult> {
    const response = await this.client.send(new IndexFacesCommand({
      CollectionId: input.collectionId,
      ExternalImageId: input.externalImageId,
      Image: { Bytes: input.imageBytes },
      DetectionAttributes: ['DEFAULT'],
      MaxFaces: 1,
      QualityFilter: 'AUTO',
    }));
    const face = response.FaceRecords?.[0]?.Face;
    if (!face?.FaceId) {
      const reason = response.UnindexedFaces?.[0]?.Reasons?.[0] || 'NO_FACE';
      const error = new Error(reason);
      error.name = 'FaceIndexRejected';
      throw error;
    }
    return {
      faceId: face.FaceId,
      facesDetected: response.FaceRecords?.length || 1,
    };
  }

  async deleteFaces(collectionId: string, faceIds: string[]): Promise<void> {
    if (faceIds.length === 0) return;
    await this.client.send(new DeleteFacesCommand({
      CollectionId: collectionId,
      FaceIds: faceIds,
    }));
  }

  async detectFaces(imageBytes: Uint8Array): Promise<DetectedFaceBox[]> {
    const response = await this.client.send(new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ['DEFAULT'],
    }));
    return (response.FaceDetails || [])
      .map(face => face.BoundingBox)
      .filter((box): box is NonNullable<typeof box> => Boolean(box))
      .map(box => ({
        left: box.Left || 0,
        top: box.Top || 0,
        width: box.Width || 0,
        height: box.Height || 0,
      }))
      .filter(box => box.width > 0.02 && box.height > 0.02)
      .slice(0, 5);
  }

  async searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<FaceMatchResult | null> {
    const response = await this.client.send(new SearchFacesByImageCommand({
      CollectionId: input.collectionId,
      Image: { Bytes: input.imageBytes },
      FaceMatchThreshold: input.threshold,
      MaxFaces: 1,
    }));
    const match = response.FaceMatches?.[0];
    if (!match?.Face?.FaceId || match.Similarity == null) return null;
    return {
      faceId: match.Face.FaceId,
      confidence: match.Similarity,
    };
  }
}

/** Test-only provider. Never used unless FACE_ENROLLMENT_PROVIDER=mock or FACE_RECOGNITION_PROVIDER=mock. */
export class MockFaceIndexProvider implements FaceIndexProvider, FaceSearchProvider {
  private faces = new Map<string, string>();

  async ensureCollection(collectionId: string): Promise<void> {
    void collectionId;
  }

  async indexFace(input: {
    collectionId: string;
    externalImageId: string;
    imageBytes: Uint8Array;
  }): Promise<IndexedFaceResult> {
    if (input.imageBytes.byteLength < 100) {
      const error = new Error('NO_FACE');
      error.name = 'FaceIndexRejected';
      throw error;
    }
    if (Buffer.from(input.imageBytes).toString('utf8').includes('FORCE_FAIL')) {
      throw new Error('Mock provider forced failure');
    }
    const faceId = `mock-face-${input.externalImageId}`;
    this.faces.set(faceId, input.collectionId);
    return { faceId, facesDetected: 1 };
  }

  async deleteFaces(collectionId: string, faceIds: string[]): Promise<void> {
    void collectionId;
    faceIds.forEach(id => this.faces.delete(id));
  }

  async detectFaces(imageBytes: Uint8Array): Promise<DetectedFaceBox[]> {
    const text = Buffer.from(imageBytes).toString('utf8');
    if (text.includes('NO_FACE_DETECT')) return [];
    if (text.includes('MULTI_FACE')) {
      return [
        { left: 0.1, top: 0.1, width: 0.3, height: 0.4 },
        { left: 0.55, top: 0.15, width: 0.3, height: 0.4 },
      ];
    }
    return [{ left: 0.25, top: 0.2, width: 0.4, height: 0.5 }];
  }

  async searchFace(input: {
    collectionId: string;
    imageBytes: Uint8Array;
    threshold: number;
  }): Promise<FaceMatchResult | null> {
    void input.collectionId;
    void input.threshold;
    const text = Buffer.from(input.imageBytes).toString('latin1');
    if (text.includes('FORCE_FAIL')) throw new Error('Mock recognition failure');
    if (text.includes('UNKNOWN')) return null;
    if (text.includes('LOW_CONF')) {
      return { faceId: 'mock-low-confidence', confidence: 50 };
    }
    // Delimited marker: FACEID:<id>| — avoids padding bytes extending the capture.
    const marker = text.match(/FACEID:([a-zA-Z0-9_-]+)\|/);
    if (marker) {
      return { faceId: marker[1], confidence: 97.4 };
    }
    if (process.env.MOCK_RECOGNITION_FACE_ID) {
      return { faceId: process.env.MOCK_RECOGNITION_FACE_ID, confidence: 97.4 };
    }
    return null;
  }
}

function useMockFaceProvider() {
  return (
    process.env.FACE_RECOGNITION_PROVIDER === 'mock'
    || process.env.FACE_ENROLLMENT_PROVIDER === 'mock'
  );
}

export function getFaceIndexProvider(): FaceIndexProvider {
  if (useMockFaceProvider()) {
    return new MockFaceIndexProvider();
  }
  const client = createRekognitionClient();
  if (!client) {
    const error = new Error('AWS Rekognition is not configured for this environment.');
    error.name = 'AwsNotConfigured';
    throw error;
  }
  return new AwsRekognitionFaceProvider(client);
}

export function getFaceSearchProvider(): FaceSearchProvider {
  if (useMockFaceProvider()) {
    return new MockFaceIndexProvider();
  }
  const client = createRekognitionClient();
  if (!client) {
    const error = new Error('AWS Rekognition is not configured for this environment.');
    error.name = 'AwsNotConfigured';
    throw error;
  }
  return new AwsRekognitionFaceProvider(client);
}

export function recognitionMatchThreshold() {
  const value = Number(process.env.FACE_RECOGNITION_MATCH_THRESHOLD || 90);
  if (!Number.isFinite(value) || value < 1 || value > 100) return 90;
  return value;
}

export function recognitionCooldownMs() {
  const value = Number(process.env.FACE_RECOGNITION_COOLDOWN_MS || 5000);
  if (!Number.isFinite(value) || value < 0) return 5000;
  return value;
}

export async function cropFaceJpeg(imageBytes: Uint8Array, box: DetectedFaceBox) {
  try {
    const image = sharp(imageBytes, { failOn: 'none' });
    const meta = await image.metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (width < 8 || height < 8) {
      return Buffer.from(imageBytes);
    }
    const padX = box.width * 0.15;
    const padY = box.height * 0.15;
    const left = Math.max(0, Math.floor((box.left - padX) * width));
    const top = Math.max(0, Math.floor((box.top - padY) * height));
    const right = Math.min(width, Math.ceil((box.left + box.width + padX) * width));
    const bottom = Math.min(height, Math.ceil((box.top + box.height + padY) * height));
    const cropWidth = Math.max(8, right - left);
    const cropHeight = Math.max(8, bottom - top);
    return image
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return Buffer.from(imageBytes);
  }
}

export function divisionCollectionId(divisionId: number) {
  return `rmo-local-division-${divisionId}`;
}

export function externalImageIdForUser(userId: number) {
  return `rmo-user-${userId}`;
}
