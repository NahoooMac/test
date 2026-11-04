// Face-liveness acceptance rules (pure functions, unit-tested).
//
// The app measures head pose with MediaPipe Face Landmarker and reports, per action, what it saw
// while the rider held the pose. The server re-checks those numbers against the thresholds that
// were issued with the session, enforces the order and the time limit, and refuses frames outside
// a live session. A determined attacker controls the client, so these checks raise the bar; they
// are not proof of liveness. Admins review the frames and the signals below before approving.
import { randomInt } from 'node:crypto';
import type { LivenessAction, LivenessMetrics, LivenessStepRecord, LivenessThresholds } from '@dp/shared';

/** Consecutive-frame yaw jump that no real head makes (a spliced or switched video). */
export const MAX_FRAME_JUMP_DEG = 45;
/** Below this yaw jitter while holding, the "face" barely moves at all (photo or screen). */
export const STATIC_JITTER_DEG = 0.15;
/** Faster than this for the whole sequence is not a human following instructions. */
export const MIN_SESSION_MS = 3000;

/** "Look straight" first, then right and left in random order, then back to the centre. */
export function newSequence(): LivenessAction[] {
  const turns: LivenessAction[] = randomInt(2) === 0 ? ['right', 'left'] : ['left', 'right'];
  return ['straight', ...turns, 'center'];
}

/** Why a reported action is not acceptable, or null when it passes. */
export function rejectReason(
  action: LivenessAction,
  m: LivenessMetrics,
  t: LivenessThresholds,
): string | null {
  if (m.faceCount === 0) return 'No face was detected.';
  if (m.faceCount > 1) return 'More than one face is in view. Only you should be in the picture.';
  if (m.faceArea < t.minFaceArea) return 'Move closer: your face is too small in the picture.';
  if (Math.abs(m.pitchDeg) > t.maxPitchDeg) return 'Keep your head level (do not look up or down).';
  if (m.holdMs < t.holdMs) return 'Hold the position a little longer.';
  if (m.maxStepDeg > MAX_FRAME_JUMP_DEG) return 'The movement was not continuous. Please try again.';
  switch (action) {
    case 'straight':
    case 'center':
      if (Math.abs(m.yawDeg) > t.centerYawDeg) return 'Look straight at the camera.';
      break;
    case 'right':
      if (m.yawDeg < t.turnYawDeg) return 'Turn your head further to the right.';
      break;
    case 'left':
      if (m.yawDeg > -t.turnYawDeg) return 'Turn your head further to the left.';
      break;
  }
  if ((action === 'right' || action === 'left') && m.faceShift > t.maxFaceShift) {
    return 'Keep the phone still and turn only your head.';
  }
  return null;
}

/** Signals for the reviewer (never an automatic decision). */
export function reviewFlags(steps: LivenessStepRecord[], failedAttempts: number): string[] {
  const flags: string[] = [];
  if (steps.length && steps.every((s) => s.metrics.jitterDeg < STATIC_JITTER_DEG)) flags.push('static_face');
  if (steps.some((s) => s.metrics.maxStepDeg > MAX_FRAME_JUMP_DEG * 0.6)) flags.push('abrupt_movement');
  if (steps.length && steps.reduce((n, s) => n + s.metrics.blinks, 0) === 0) flags.push('no_blink');
  if (steps.length > 1) {
    const ms = Date.parse(steps.at(-1)!.completedAt) - Date.parse(steps[0]!.startedAt);
    if (ms < MIN_SESSION_MS * 2) flags.push('very_fast');
  }
  if (failedAttempts >= 5) flags.push('many_failed_attempts');
  return flags;
}
