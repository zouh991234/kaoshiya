/// <reference types="vite/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?worker' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}
