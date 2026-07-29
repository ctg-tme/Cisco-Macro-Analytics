import type { AnalysisSessionResult } from '../analysis/analysisSession';

type ExportWorkerResponse =
  | { ok: true; archive: ArrayBuffer }
  | { ok: false; message: string };

export function createAnalysisExportBlob(
  session: AnalysisSessionResult,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./analysisExport.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      worker.terminate();
      if (!event.data.ok) {
        reject(new Error(event.data.message));
        return;
      }
      resolve(new Blob([event.data.archive], { type: 'application/zip' }));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The browser could not prepare the ZIP export.'));
    };
    worker.postMessage({ session });
  });
}
