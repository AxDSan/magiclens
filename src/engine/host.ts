import type { EngineCommand, EngineEvent } from '../shared/messages';
import { cancelJob, runAnalysis, runOcr } from './engine';

/** Runs engine commands in the current document (Firefox/Safari background page, offscreen). */
export function dispatchEngineCommand(cmd: EngineCommand, emit: (event: EngineEvent) => void) {
  switch (cmd.type) {
    case 'ocr': {
      const { type: _type, settings, ...job } = cmd;
      void runOcr(job, settings, emit);
      break;
    }
    case 'analyze': {
      const { type: _type, settings, ...job } = cmd;
      void runAnalysis(job, settings, emit);
      break;
    }
    case 'cancel':
      cancelJob(cmd.id);
      break;
  }
}
