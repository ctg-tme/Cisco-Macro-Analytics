import type { AnalysisSessionResult } from './analysisSession';
import { parseAnalysisSessionJson } from './analysisSessionImport';

interface ImportWorkerRequest {
  text: string;
}

type ImportWorkerResponse =
  | { ok: true; session: AnalysisSessionResult }
  | { ok: false; message: string };

interface ImportWorkerScope {
  onmessage: ((event: MessageEvent<ImportWorkerRequest>) => void) | null;
  postMessage(message: ImportWorkerResponse): void;
}

const workerScope = self as unknown as ImportWorkerScope;

workerScope.onmessage = (event) => {
  try {
    workerScope.postMessage({
      ok: true,
      session: parseAnalysisSessionJson(event.data.text),
    });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'Analysis import failed.',
    });
  }
};
