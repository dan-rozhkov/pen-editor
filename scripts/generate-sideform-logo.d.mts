// Types for the plain-JS generator, so SideformLogo.test.tsx type-checks.
export type ParsedLogoPath = { d: string; x: string; y: string; evenOdd: boolean };
export declare function parseLogoSvg(svg: string): ParsedLogoPath[];
