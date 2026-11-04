const SAMPLE = 48;
const PALE = 235;
const BAR_SHARE = 0.97;
const MIN_BAR = 0.05;
const MAX_ZOOM = 1.8;

function isBlank(pixels: Uint8ClampedArray, offset: number): boolean {
  const [r, g, b, a] = [
    pixels[offset]!,
    pixels[offset + 1]!,
    pixels[offset + 2]!,
    pixels[offset + 3]!,
  ];
  return a < 16 || (r > PALE && g > PALE && b > PALE);
}

function columnIsBlank(
  pixels: Uint8ClampedArray,
  size: number,
  x: number
): boolean {
  let blank = 0;
  for (let y = 0; y < size; y++) {
    if (isBlank(pixels, (y * size + x) * 4)) blank++;
  }
  return blank / size >= BAR_SHARE;
}

/** The share of a square image's width taken by each of its side bars, which
    Slack adds to make a narrow portrait square. RGBA pixels, row by row. */
export function sideBarShare(pixels: Uint8ClampedArray, size: number): number {
  let x = 0;
  while (
    x < size / 2 &&
    columnIsBlank(pixels, size, x) &&
    columnIsBlank(pixels, size, size - 1 - x)
  ) {
    x++;
  }
  return x / size;
}

export function zoomForBars(share: number): number {
  return share < MIN_BAR ? 1 : Math.min(1 / (1 - 2 * share), MAX_ZOOM);
}

const zooms = new Map<string, number>();

/** How far to zoom a loaded picture so its side bars fall outside the frame. */
export function faceZoom(image: HTMLImageElement): number {
  const known = zooms.get(image.src);
  if (known !== undefined) return known;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 1;
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
  const zoom = zoomForBars(sideBarShare(data, SAMPLE));
  zooms.set(image.src, zoom);
  return zoom;
}
