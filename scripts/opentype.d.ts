// The parts of opentype.js 2 that scripts/brand.ts uses (the package ships no types).
declare module "opentype.js" {
  interface BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  interface Path {
    getBoundingBox(): BoundingBox;
    toPathData(decimalPlaces?: number): string;
  }
  interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path;
    getAdvanceWidth(text: string, fontSize: number): number;
  }
  const opentype: { parse(buffer: ArrayBuffer): Font };
  export default opentype;
}
