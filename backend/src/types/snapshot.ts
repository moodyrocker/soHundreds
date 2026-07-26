export type SnapshotPlatform =
  | 'google_analytics'
  | 'google_ads'
  | 'meta_ads'
  | 'shopify';

export type SnapshotProbeResult = {
  platform: SnapshotPlatform;
  connectionReady: boolean;
  dataAvailable: boolean;
  error: string | null;
  errorCode: string | null;
  userMessage: string | null;
};

export type SnapshotFetchFailure = {
  ok: false;
  error: string;
  errorCode: string | null;
  userMessage: string | null;
};

export type SnapshotFetchSuccess<T> = {
  ok: true;
  data: T;
};

export type SnapshotFetchResult<T> = SnapshotFetchSuccess<T> | SnapshotFetchFailure;

export function idleProbe(platform: SnapshotPlatform): SnapshotProbeResult {
  return {
    platform,
    connectionReady: false,
    dataAvailable: false,
    error: null,
    errorCode: null,
    userMessage: null,
  };
}

export function probeFromFetch<T>(
  platform: SnapshotPlatform,
  connectionReady: boolean,
  result: SnapshotFetchResult<T>
): SnapshotProbeResult {
  if (!connectionReady) return idleProbe(platform);
  if (result.ok) {
    return {
      platform,
      connectionReady: true,
      dataAvailable: true,
      error: null,
      errorCode: null,
      userMessage: null,
    };
  }
  return {
    platform,
    connectionReady: true,
    dataAvailable: false,
    error: result.error,
    errorCode: result.errorCode,
    userMessage: result.userMessage,
  };
}
