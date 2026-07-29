import type { AnalysisSessionResult } from './analysisSession';

type ImportWorkerResponse =
  | { ok: true; session: AnalysisSessionResult }
  | { ok: false; message: string };

export function importAnalysisSessionJson(
  text: string,
): Promise<AnalysisSessionResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./analysisSessionImport.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<ImportWorkerResponse>) => {
      worker.terminate();
      if (!event.data.ok) {
        reject(new Error(event.data.message));
        return;
      }
      resolve(event.data.session);
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The browser could not validate the selected analysis.'));
    };
    worker.postMessage({ text });
  });
}
