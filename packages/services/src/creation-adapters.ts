import type { JobRecord, PlatformConfig } from '@sha/core';
import type { CreationAdapter, CreationOutcome } from './deps';

/**
 * The only production creation adapter. It contacts NO platform: it prepares
 * registration instructions and hands control to the human, who completes
 * signup (including any captcha, phone or email verification) on the platform.
 */
export class GuidedManualCreationAdapter implements CreationAdapter {
  readonly key = 'guided_manual';

  async prepare(job: JobRecord, platform: PlatformConfig): Promise<CreationOutcome> {
    return {
      outcome: 'awaiting_verification',
      message: 'Prepared guided manual registration. Waiting for the user to complete signup on the platform.',
      nextAction: {
        type: 'manual_registration',
        registrationUrl: platform.registrationUrl,
        steps: platform.manualSteps,
        prefill: { handle: job.handle, email: job.email },
        entityDescription: platform.entityDescription,
        ...(platform.entityType === 'linked_profile' && platform.derivedFrom
          ? { warning: `This handle is inherited from ${platform.derivedFrom}. Claim it there first.` }
          : {}),
      },
    };
  }
}

/** Test double. Never registered outside automated tests. */
export class MockCreationAdapter implements CreationAdapter {
  readonly key = 'mock';
  readonly calls: string[] = [];
  constructor(private readonly behaviour: 'awaiting' | 'succeed' | 'fail' | 'throw' = 'awaiting') {}

  async prepare(job: JobRecord, platform: PlatformConfig): Promise<CreationOutcome> {
    this.calls.push(`${platform.slug}:${job.handle}`);
    switch (this.behaviour) {
      case 'succeed':
        return { outcome: 'succeeded', message: 'Mock adapter reported success (simulated).' };
      case 'fail':
        return { outcome: 'failed', error: 'Mock adapter reported failure (simulated).' };
      case 'throw':
        throw new Error('mock transient failure');
      default:
        return new GuidedManualCreationAdapter().prepare(job, platform);
    }
  }
}
