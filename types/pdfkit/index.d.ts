// Type definitions for PDFKit
declare module 'pdfkit' {
  class PDFDocument {
    constructor(options?: {
      autoFirstPage?: boolean;
      size?: [number, number] | string;
      layout?: 'portrait' | 'landscape';
      margins?: { top: number; bottom: number; left: number; right: number };
    });

    // Core methods
    pipe(stream: NodeJS.WritableStream): this;
    addPage(options?: any): this;
    end(): void;

    // Text methods
    fontSize(size: number): this;
    font(src: string, family?: string, size?: number): this;
    text(text: string, x?: number, y?: number, options?: any): this;
    moveDown(y?: number): this;
    fillColor(color: string): this;
    
    // Image methods
    image(src: any, x?: number, y?: number, options?: {
      width?: number;
      height?: number;
      scale?: number;
      fit?: [number, number];
      align?: string;
      valign?: string;
    }): this;

    // Add other methods as needed
    [key: string]: any;
  }

  export = PDFDocument;
}
