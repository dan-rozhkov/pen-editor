export const COMMON_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Palatino',
  'Garamond',
  'Inter',
  'Bookman',
  'Comic Sans MS',
  'Trebuchet MS',
  'Arial Black',
  'Impact',
  'Lucida Sans Unicode',
  'Tahoma',
  'Monaco',
  'Courier',
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
];

export interface SystemFont {
  family: string;
  isSystemFont: boolean;
}

let fontCache: SystemFont[] | null = null;

export function isFontAccessSupported(): boolean {
  return 'queryLocalFonts' in window;
}

async function querySystemFonts(): Promise<SystemFont[]> {
  if (!isFontAccessSupported()) {
    return [];
  }

  try {
    // @ts-expect-error Font Access API is not in TypeScript lib yet
    const fonts = await window.queryLocalFonts();

    const uniqueFamilies = new Set<string>();
    const systemFonts: SystemFont[] = [];

    for (const font of fonts) {
      const family = font.family;
      if (!uniqueFamilies.has(family)) {
        uniqueFamilies.add(family);
        systemFonts.push({
          family,
          isSystemFont: true,
        });
      }
    }

    return systemFonts.sort((a, b) => a.family.localeCompare(b.family));
  } catch (error) {
    console.warn('Font Access API failed:', error);
    return [];
  }
}

export async function getAvailableFonts(): Promise<SystemFont[]> {
  if (fontCache !== null) {
    return fontCache;
  }

  const systemFonts = await querySystemFonts();

  if (systemFonts.length > 0) {
    fontCache = systemFonts;
  } else {
    fontCache = COMMON_FONTS.map((family) => ({
      family,
      isSystemFont: false,
    }));
  }

  return fontCache;
}
