import { SorobanResurrectConfig } from './SorobanResurrectConfig';
import { logger } from './logger';

export class ResurrectError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ResurrectError';
  }
}

export class RestoreFeeExceededError extends ResurrectError {
  constructor(
    public readonly computedFeeStroops: number,
    public readonly maxRestoreFeeStroops: number,
  ) {
    super(
      `Computed restore fee ${computedFeeStroops} stroops exceeds the configured cap of ${maxRestoreFeeStroops} stroops`,
      'RESTORE_FEE_CAP_EXCEEDED',
    );
    this.name = 'RestoreFeeExceededError';
  }
}

export function calculateRestoreFee(
  config: SorobanResurrectConfig,
  footprintEntries: number,
): number {
  const computedFeeStroops = footprintEntries * config.restoreFeePerEntryStroops;

  if (
    config.maxRestoreFeeStroops !== undefined &&
    computedFeeStroops > config.maxRestoreFeeStroops
  ) {
    logger.warn('Restore fee exceeds configured cap', {
      computedFeeStroops,
      maxRestoreFeeStroops: config.maxRestoreFeeStroops,
    });
    throw new RestoreFeeExceededError(
      computedFeeStroops,
      config.maxRestoreFeeStroops,
    );
  }

  return computedFeeStroops;
}
