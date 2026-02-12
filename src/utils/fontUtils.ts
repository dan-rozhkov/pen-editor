import type { SceneNode } from '@/types/scene';

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

// ~250 most popular Google Fonts by usage
export const GOOGLE_FONTS = [
  'ABeeZee', 'Abel', 'Abril Fatface', 'Acme', 'Alegreya', 'Alegreya Sans',
  'Alfa Slab One', 'Alice', 'Alike', 'Allan', 'Allerta', 'Allura',
  'Amatic SC', 'Amiri', 'Architects Daughter', 'Archivo', 'Archivo Black',
  'Archivo Narrow', 'Arimo', 'Arsenal', 'Arvo', 'Asap', 'Asap Condensed',
  'Assistant', 'Audiowide', 'Average Sans',
  'Bangers', 'Barlow', 'Barlow Condensed', 'Barlow Semi Condensed',
  'Be Vietnam Pro', 'Bebas Neue', 'Bitter', 'Black Ops One', 'Bodoni Moda',
  'Bree Serif', 'Bungee',
  'Cabin', 'Cairo', 'Cantarell', 'Cardo', 'Carlito', 'Catamaran',
  'Caveat', 'Chakra Petch', 'Changa', 'Chivo', 'Cinzel', 'Cinzel Decorative',
  'Comfortaa', 'Commissioner', 'Concert One', 'Cookie', 'Cormorant',
  'Cormorant Garamond', 'Courgette', 'Crete Round', 'Crimson Pro',
  'Crimson Text', 'Cuprum',
  'DM Mono', 'DM Sans', 'DM Serif Display', 'DM Serif Text',
  'Dancing Script', 'Didact Gothic', 'Domine', 'Dosis', 'Droid Sans',
  'EB Garamond', 'El Messiri', 'Electrolize', 'Encode Sans',
  'Encode Sans Condensed', 'Exo', 'Exo 2',
  'Fira Code', 'Fira Mono', 'Fira Sans', 'Fira Sans Condensed',
  'Fira Sans Extra Condensed', 'Fjalla One', 'Francois One',
  'Frank Ruhl Libre', 'Fraunces',
  'Gelasio', 'Gloria Hallelujah', 'Gothic A1', 'Great Vibes', 'Gruppo',
  'Heebo', 'Hind', 'Hind Madurai', 'Hind Siliguri',
  'IBM Plex Mono', 'IBM Plex Sans', 'IBM Plex Sans Condensed',
  'IBM Plex Serif', 'Inconsolata', 'Indie Flower', 'Inter Tight',
  'Istok Web',
  'Jost', 'Josefin Sans', 'Josefin Slab',
  'Kalam', 'Kanit', 'Karla', 'Kaushan Script', 'Khand',
  'Lato', 'League Spartan', 'Lexend', 'Lexend Deca', 'Libre Baskerville',
  'Libre Caslon Text', 'Libre Franklin', 'Lilita One', 'Limelight',
  'Lobster', 'Lobster Two', 'Lora', 'Lusitana',
  'M PLUS 1p', 'M PLUS Rounded 1c', 'Macondo', 'Mali', 'Manrope',
  'Marcellus', 'Martel', 'Maven Pro', 'Merienda', 'Merriweather',
  'Merriweather Sans', 'Mitr', 'Montserrat', 'Montserrat Alternates',
  'Mukta', 'Mulish', 'Muli',
  'Nanum Gothic', 'Nanum Myeongjo', 'Neuton', 'Newsreader',
  'Noticia Text', 'Noto Color Emoji', 'Noto Sans', 'Noto Sans Arabic',
  'Noto Sans Display', 'Noto Sans HK', 'Noto Sans JP', 'Noto Sans KR',
  'Noto Sans SC', 'Noto Sans TC', 'Noto Serif', 'Noto Serif JP',
  'Nunito', 'Nunito Sans',
  'Old Standard TT', 'Oleo Script', 'Open Sans', 'Orbitron', 'Oswald',
  'Outfit', 'Overpass', 'Oxygen',
  'PT Mono', 'PT Sans', 'PT Sans Caption', 'PT Sans Narrow', 'PT Serif',
  'Pacifico', 'Passion One', 'Pathway Gothic One', 'Patrick Hand',
  'Patua One', 'Pattaya', 'Permanent Marker', 'Philosopher',
  'Play', 'Playfair Display', 'Playfair Display SC', 'Plus Jakarta Sans',
  'Podkova', 'Poiret One', 'Poppins', 'Pragati Narrow', 'Press Start 2P',
  'Prompt', 'Proza Libre', 'Public Sans', 'Puritan',
  'Quantico', 'Quattrocento', 'Quattrocento Sans', 'Questrial', 'Quicksand',
  'Rajdhani', 'Raleway', 'Readex Pro', 'Red Hat Display', 'Red Hat Text',
  'Righteous', 'Roboto', 'Roboto Condensed', 'Roboto Flex', 'Roboto Mono',
  'Roboto Serif', 'Roboto Slab', 'Rokkitt', 'Rosario', 'Rubik',
  'Rubik Mono One', 'Russo One',
  'Sacramento', 'Saira', 'Saira Condensed', 'Satisfy', 'Sawarabi Gothic',
  'Sawarabi Mincho', 'Secular One', 'Sen', 'Shadows Into Light',
  'Signika', 'Signika Negative', 'Silkscreen', 'Slabo 27px',
  'Sora', 'Source Code Pro', 'Source Sans 3', 'Source Serif 4',
  'Space Grotesk', 'Space Mono', 'Special Elite', 'Spectral',
  'Stint Ultra Condensed',
  'Tajawal', 'Tangerine', 'Teko', 'Tinos', 'Titan One', 'Titillium Web',
  'Ubuntu', 'Ubuntu Condensed', 'Ubuntu Mono', 'Unbounded', 'Unna',
  'Urbanist',
  'Varela Round', 'Vollkorn',
  'Work Sans',
  'Yanone Kaffeesatz', 'Yantramanav', 'Yellowtail', 'Yeseva One',
  'Zen Kaku Gothic New', 'Zilla Slab',
];

const googleFontsSet = new Set(GOOGLE_FONTS);

function normalizeFontFamilyName(family: string): string {
  // Keep only first family from CSS-like lists: `"Inter", sans-serif` -> `Inter`
  const primary = family.split(",")[0]?.trim() ?? "";
  // Strip matching single/double quotes
  return primary.replace(/^["']|["']$/g, "");
}

export interface SystemFont {
  family: string;
  isSystemFont: boolean;
  isGoogleFont?: boolean;
}

let fontCache: SystemFont[] | null = null;

export function isFontAccessSupported(): boolean {
  return 'queryLocalFonts' in window;
}

export function isGoogleFont(family: string): boolean {
  return googleFontsSet.has(normalizeFontFamilyName(family));
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

  // Build set of system font families for dedup
  const systemFamilies = new Set(systemFonts.map((f) => f.family));

  // Use system fonts if available, otherwise use common fonts fallback
  const baseFonts: SystemFont[] =
    systemFonts.length > 0
      ? systemFonts
      : COMMON_FONTS.map((family) => ({
          family,
          isSystemFont: false,
        }));

  // Add Google Fonts that aren't already in the system font list
  const googleFontEntries: SystemFont[] = GOOGLE_FONTS
    .filter((family) => !systemFamilies.has(family))
    .map((family) => ({
      family,
      isSystemFont: false,
      isGoogleFont: true,
    }));

  fontCache = [...baseFonts, ...googleFontEntries];

  return fontCache;
}

// --- Google Font loading ---

let fontLoadCallback: (() => void) | null = null;

export function registerFontLoadCallback(cb: () => void) {
  fontLoadCallback = cb;
}

const loadedGoogleFonts = new Set<string>();
const loadingGoogleFonts = new Map<string, Promise<void>>();

export function loadGoogleFont(family: string): Promise<void> {
  const normalizedFamily = normalizeFontFamilyName(family);
  if (!normalizedFamily) {
    return Promise.resolve();
  }

  if (loadedGoogleFonts.has(normalizedFamily)) {
    return Promise.resolve();
  }

  const existing = loadingGoogleFonts.get(normalizedFamily);
  if (existing) {
    return existing;
  }

  const encodedFamily = normalizedFamily.replace(/ /g, '+');
  const url = `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;

  const promise = new Promise<void>((resolve) => {
    link.onload = () => {
      // Wait for the font faces to actually be ready
      document.fonts.ready.then(() => {
        loadedGoogleFonts.add(normalizedFamily);
        loadingGoogleFonts.delete(normalizedFamily);
        resolve();
        fontLoadCallback?.();
      });
    };
    link.onerror = () => {
      console.warn(`Failed to load Google Font: ${normalizedFamily}`);
      loadingGoogleFonts.delete(normalizedFamily);
      resolve(); // resolve anyway to not block
    };
  });

  loadingGoogleFonts.set(normalizedFamily, promise);
  document.head.appendChild(link);

  return promise;
}

function collectFontFamilies(nodes: SceneNode[]): Set<string> {
  const families = new Set<string>();
  for (const node of nodes) {
    if (node.type === 'text' && node.fontFamily) {
      families.add(node.fontFamily);
    }
    if ('children' in node && Array.isArray((node as { children?: SceneNode[] }).children)) {
      const childFamilies = collectFontFamilies((node as { children: SceneNode[] }).children);
      for (const f of childFamilies) {
        families.add(f);
      }
    }
  }
  return families;
}

export function loadGoogleFontsFromNodes(nodes: SceneNode[]): Promise<void> {
  const families = collectFontFamilies(nodes);
  const promises: Promise<void>[] = [];

  for (const family of families) {
    if (isGoogleFont(family)) {
      promises.push(loadGoogleFont(family));
    }
  }

  return promises.length > 0 ? Promise.all(promises).then(() => {}) : Promise.resolve();
}
