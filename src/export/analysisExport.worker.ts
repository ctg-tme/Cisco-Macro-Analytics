import type { AnalysisSessionResult } from '../analysis/analysisSession';
import { createAnalysisExportArchive } from './analysisExport';

interface ExportWorkerRequest {
  session: AnalysisSessionResult;
}

type ExportWorkerResponse =
  | { ok: true; archive: ArrayBuffer }
  | { ok: false; message: string };

interface ExportWorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage(message: ExportWorkerResponse, transfer?: Transferable[]): void;
}

const workerScope = self as unknown as ExportWorkerScope;

workerScope.onmessage = (event) => {
  try {
    const archive = createAnalysisExportArchive(event.data.session);
    const transferable = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;
    workerScope.postMessage({ ok: true, archive: transferable }, [transferable]);
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : 'ZIP export failed.',
    });
  }
};
